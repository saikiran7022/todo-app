const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

function isMember(listId, userId) {
  return !!db.prepare('SELECT 1 FROM list_members WHERE list_id=? AND user_id=?').get(listId, userId);
}
function getTask(id, userId) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!t || !isMember(t.list_id, userId)) return null;
  return t;
}
function parseTask(t) {
  if (!t) return null;
  return {
    ...t,
    tags: JSON.parse(t.tags || '[]'),
    pair_checked_by: JSON.parse(t.pair_checked_by || '[]'),
    requires_pair: !!t.requires_pair,
    verify_required: !!t.verify_required,
    is_top_goal: !!t.is_top_goal,
  };
}
function enrichTask(t) {
  const task = parseTask(t);
  if (!task) return null;
  task.owner = task.owner_id ? db.prepare('SELECT id,username,avatar,accent_color FROM users WHERE id=?').get(task.owner_id) : null;
  task.assigner = task.assigner_id ? db.prepare('SELECT id,username,avatar,accent_color FROM users WHERE id=?').get(task.assigner_id) : null;
  task.handoffs = db.prepare(`
    SELECT h.*, fu.username as from_username, tu.username as to_username
    FROM handoffs h
    LEFT JOIN users fu ON h.from_user_id=fu.id
    LEFT JOIN users tu ON h.to_user_id=tu.id
    WHERE h.task_id=? ORDER BY h.timestamp ASC
  `).all(task.id);
  task.negotiations = db.prepare('SELECT * FROM negotiations WHERE task_id=? ORDER BY created_at DESC').all(task.id);
  task.stakes = db.prepare('SELECT * FROM stakes WHERE task_id=?').all(task.id);
  task.subtasks = db.prepare('SELECT * FROM tasks WHERE parent_id=?').all(task.id).map(parseTask);
  return task;
}

// GET tasks for a list
router.get('/', requireAuth, (req, res) => {
  const listId = parseInt(req.query.list_id);
  if (!listId) return res.status(400).json({ error: 'list_id required' });
  if (!isMember(listId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const tasks = db.prepare('SELECT * FROM tasks WHERE list_id=? AND parent_id IS NULL ORDER BY created_at DESC').all(listId);
  res.json(tasks.map(t => enrichTask(t)));
});

// GET today's tasks across all user's lists
router.get('/today', requireAuth, (req, res) => {
  const tasks = db.prepare(`
    SELECT t.* FROM tasks t
    JOIN list_members lm ON t.list_id = lm.list_id
    WHERE lm.user_id=? AND (t.owner_id=? OR t.assigner_id=?)
    AND (date(t.due_at)=date('now') OR t.is_top_goal=1)
    AND t.status != 'done'
    ORDER BY t.priority DESC, t.due_at ASC
  `).all(req.user.id, req.user.id, req.user.id);
  res.json(tasks.map(t => enrichTask(t)));
});

// POST create task
router.post('/', requireAuth, (req, res) => {
  const { list_id, title, description, owner_id, priority, color, tags, due_at,
    estimated_minutes, location, recurrence, parent_id, requires_pair,
    verify_required, quadrant, is_top_goal, status } = req.body;
  if (!list_id || !title?.trim()) return res.status(400).json({ error: 'list_id and title required' });
  if (!isMember(list_id, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const r = db.prepare(`
    INSERT INTO tasks (list_id,title,description,owner_id,assigner_id,status,priority,color,tags,
      due_at,estimated_minutes,location,recurrence,parent_id,requires_pair,verify_required,quadrant,is_top_goal)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(list_id, title.trim(), description||null, owner_id||req.user.id, req.user.id,
    status||'todo', priority||'medium', color||'default', JSON.stringify(tags||[]),
    due_at||null, estimated_minutes||null, location||null, recurrence||null, parent_id||null,
    requires_pair?1:0, verify_required?1:0, quadrant||null, is_top_goal?1:0);
  res.status(201).json(enrichTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid)));
});

// POST bulk (brain dump)
router.post('/bulk', requireAuth, (req, res) => {
  const { list_id, texts, priority, tags } = req.body;
  if (!list_id || !Array.isArray(texts) || texts.length===0) return res.status(400).json({ error: 'list_id and texts required' });
  if (!isMember(list_id, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const created = texts.filter(t=>t?.trim()).map(title => {
    const r = db.prepare(`
      INSERT INTO tasks (list_id,title,owner_id,assigner_id,priority,tags)
      VALUES (?,?,?,?,?,?)
    `).run(list_id, title.trim(), req.user.id, req.user.id, priority||'medium', JSON.stringify(tags||[]));
    return enrichTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid));
  });
  res.status(201).json(created);
});

// GET single task
router.get('/:id', requireAuth, (req, res) => {
  const task = getTask(parseInt(req.params.id), req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(enrichTask(task));
});

// PATCH update task
router.patch('/:id', requireAuth, (req, res) => {
  const task = getTask(parseInt(req.params.id), req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const fields = ['title','description','owner_id','status','priority','color','tags','due_at',
    'estimated_minutes','location','recurrence','requires_pair','verify_required','quadrant','is_top_goal'];
  const updates = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f}=?`);
      vals.push(f==='tags'||f==='pair_checked_by' ? JSON.stringify(req.body[f]) :
        f==='requires_pair'||f==='verify_required'||f==='is_top_goal' ? (req.body[f]?1:0) : req.body[f]);
    }
  }
  // Handle 'completed' convenience field
  if (req.body.completed !== undefined) {
    updates.push('status=?');
    vals.push(req.body.completed ? 'done' : 'todo');
  }
  // Pair check-off
  if (req.body.pair_check) {
    const checked = JSON.parse(task.pair_checked_by || '[]');
    if (!checked.includes(req.user.id)) checked.push(req.user.id);
    updates.push('pair_checked_by=?'); vals.push(JSON.stringify(checked));
    // Auto-complete if both checked
    const members = db.prepare('SELECT user_id FROM list_members WHERE list_id=?').all(task.list_id);
    if (members.every(m => checked.includes(m.user_id))) {
      updates.push('status=?'); vals.push('done');
    }
  }
  if (updates.length) {
    updates.push("updated_at=datetime('now')");
    db.prepare(`UPDATE tasks SET ${updates.join(',')} WHERE id=?`).run(...vals, task.id);
  }
  res.json(enrichTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id)));
});

// DELETE task
router.delete('/:id', requireAuth, (req, res) => {
  const task = getTask(parseInt(req.params.id), req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
  res.json({ message: 'Deleted' });
});

// POST handoff
router.post('/:id/handoff', requireAuth, (req, res) => {
  const task = getTask(parseInt(req.params.id), req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const { to_user_id, note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: 'A context note is required for handoffs' });
  if (!isMember(task.list_id, to_user_id)) return res.status(400).json({ error: 'Target user is not a list member' });
  db.prepare('INSERT INTO handoffs (task_id,from_user_id,to_user_id,note) VALUES (?,?,?,?)').run(task.id, req.user.id, to_user_id, note.trim());
  db.prepare('UPDATE tasks SET owner_id=?, updated_at=datetime(\'now\') WHERE id=?').run(to_user_id, task.id);
  res.status(201).json(enrichTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id)));
});

// POST negotiation
router.post('/:id/negotiate', requireAuth, (req, res) => {
  const task = getTask(parseInt(req.params.id), req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const { type, proposed_owner_id, proposed_due_at, proposed_scope, reason } = req.body;
  if (!['accept','counter','decline'].includes(type)) return res.status(400).json({ error: 'type must be accept|counter|decline' });
  if (type==='counter' && !reason) return res.status(400).json({ error: 'A reason is required for counter-offers' });
  const r = db.prepare(`
    INSERT INTO negotiations (task_id,from_user_id,type,proposed_owner_id,proposed_due_at,proposed_scope,reason)
    VALUES (?,?,?,?,?,?,?)
  `).run(task.id, req.user.id, type, proposed_owner_id||null, proposed_due_at||null, proposed_scope||null, reason||null);
  if (type==='accept') db.prepare("UPDATE tasks SET status='doing', updated_at=datetime('now') WHERE id=?").run(task.id);
  if (type==='decline') db.prepare("UPDATE tasks SET status='declined', updated_at=datetime('now') WHERE id=?").run(task.id);
  res.status(201).json({ id: r.lastInsertRowid, type, task: enrichTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id)) });
});

// POST stake
router.post('/:id/stake', requireAuth, (req, res) => {
  const task = getTask(parseInt(req.params.id), req.user.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const { type, value } = req.body;
  if (!type || !value) return res.status(400).json({ error: 'type and value required' });
  const r = db.prepare('INSERT INTO stakes (task_id,type,value,claimant_id) VALUES (?,?,?,?)').run(task.id, type, value, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM stakes WHERE id=?').get(r.lastInsertRowid));
});

module.exports = router;
