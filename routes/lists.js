const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// Helper: check list membership
function getMember(listId, userId) {
  return db.prepare('SELECT * FROM list_members WHERE list_id=? AND user_id=?').get(listId, userId);
}

// GET all lists for current user
router.get('/', requireAuth, (req, res) => {
  const lists = db.prepare(`
    SELECT l.*, u.username as owner_name
    FROM lists l
    JOIN list_members lm ON l.id = lm.list_id
    JOIN users u ON l.owner_id = u.id
    WHERE lm.user_id = ?
    ORDER BY l.created_at DESC
  `).all(req.user.id);
  const result = lists.map(list => ({
    ...list,
    members: db.prepare(`
      SELECT u.id, u.username, u.avatar, u.accent_color, lm.role
      FROM list_members lm JOIN users u ON u.id = lm.user_id
      WHERE lm.list_id = ?
    `).all(list.id)
  }));
  res.json(result);
});

// POST create list
router.post('/', requireAuth, (req, res) => {
  const { name, mode, theme } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare('INSERT INTO lists (name, mode, theme, owner_id) VALUES (?,?,?,?)').run(name.trim(), mode||'personal', theme||'default', req.user.id);
  db.prepare('INSERT INTO list_members (list_id, user_id, role) VALUES (?,?,?)').run(r.lastInsertRowid, req.user.id, 'owner');
  res.status(201).json(db.prepare('SELECT * FROM lists WHERE id=?').get(r.lastInsertRowid));
});

// POST invite member
router.post('/:id/invite', requireAuth, (req, res) => {
  const listId = parseInt(req.params.id);
  const member = getMember(listId, req.user.id);
  if (!member || member.role !== 'owner') return res.status(403).json({ error: 'Only the owner can invite' });
  const { username } = req.body;
  const invitee = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!invitee) return res.status(404).json({ error: 'User not found' });
  if (getMember(listId, invitee.id)) return res.status(409).json({ error: 'Already a member' });
  db.prepare('INSERT INTO list_members (list_id, user_id, role) VALUES (?,?,?)').run(listId, invitee.id, 'member');
  res.json({ message: `${username} added to list` });
});

// GET list members
router.get('/:id/members', requireAuth, (req, res) => {
  const listId = parseInt(req.params.id);
  if (!getMember(listId, req.user.id)) return res.status(403).json({ error: 'Not a member' });
  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.accent_color, lm.role
    FROM list_members lm JOIN users u ON u.id = lm.user_id
    WHERE lm.list_id = ?
  `).all(listId);
  res.json(members);
});

// DELETE list
router.delete('/:id', requireAuth, (req, res) => {
  const listId = parseInt(req.params.id);
  const list = db.prepare('SELECT * FROM lists WHERE id=?').get(listId);
  if (!list) return res.status(404).json({ error: 'Not found' });
  if (list.owner_id !== req.user.id) return res.status(403).json({ error: 'Only owner can delete' });
  db.prepare('DELETE FROM lists WHERE id=?').run(listId);
  res.json({ message: 'Deleted' });
});

module.exports = router;
