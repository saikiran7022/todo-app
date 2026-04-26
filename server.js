const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ── User store (seed default admin) ─────────────────────
const users = new Map();
const defaultUser = process.env.AUTH_USER || 'admin';
const defaultPass = process.env.AUTH_PASS || 'password123';
users.set(defaultUser, { username: defaultUser, password: defaultPass });

// ── Session store ────────────────────────────────────────
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token && sessions.has(token)) {
    req.user = sessions.get(token);
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ─────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.trim().length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (users.has(username.trim())) return res.status(409).json({ error: 'Username already taken' });
  users.set(username.trim(), { username: username.trim(), password });
  const token = generateToken();
  sessions.set(token, { username: username.trim() });
  res.status(201).json({ token, username: username.trim() });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = users.get(username);
  if (user && user.password === password) {
    const token = generateToken();
    sessions.set(token, { username });
    return res.json({ token, username });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) sessions.delete(token);
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

// ── Todos ────────────────────────────────────────────────
const userTodos = new Map();
let nextId = 1;

function getTodos(username) {
  if (!userTodos.has(username)) userTodos.set(username, []);
  return userTodos.get(username);
}

function buildTodo(text, opts = {}) {
  const status = opts.status || 'todo';
  return {
    id: nextId++,
    text: text.trim(),
    completed: status === 'done',
    createdAt: new Date().toISOString(),
    tags: Array.isArray(opts.tags) ? opts.tags : [],
    color: opts.color || 'default',
    priority: opts.priority || 'medium',
    status,
    quadrant: opts.quadrant || null,
    isTopGoal: opts.isTopGoal || false,
  };
}

app.get('/api/todos', requireAuth, (req, res) => {
  res.json(getTodos(req.user.username));
});

app.post('/api/todos', requireAuth, (req, res) => {
  const { text, tags, color, priority, status, quadrant, isTopGoal } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  const todos = getTodos(req.user.username);
  const todo = buildTodo(text, { tags, color, priority, status, quadrant, isTopGoal });
  todos.push(todo);
  res.status(201).json(todo);
});

// Bulk create for brain dump
app.post('/api/todos/bulk', requireAuth, (req, res) => {
  const { texts, priority, tags } = req.body;
  if (!Array.isArray(texts) || texts.length === 0) return res.status(400).json({ error: 'texts array required' });
  const todos = getTodos(req.user.username);
  const created = texts
    .filter(t => t && t.trim())
    .map(text => {
      const todo = buildTodo(text, { priority: priority || 'medium', tags: tags || [] });
      todos.push(todo);
      return todo;
    });
  res.status(201).json(created);
});

app.patch('/api/todos/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const todos = getTodos(req.user.username);
  const todo = todos.find(t => t.id === id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  const fields = ['text', 'tags', 'color', 'priority', 'status', 'quadrant', 'isTopGoal', 'completed'];
  for (const f of fields) {
    if (req.body[f] !== undefined) todo[f] = req.body[f];
  }
  // Sync completed <-> status
  if (req.body.status === 'done') todo.completed = true;
  if (req.body.status && req.body.status !== 'done') todo.completed = false;
  if (req.body.completed === true && todo.status !== 'done') todo.status = 'done';
  if (req.body.completed === false && todo.status === 'done') todo.status = 'todo';
  res.json(todo);
});

app.delete('/api/todos/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const todos = getTodos(req.user.username);
  const index = todos.findIndex(t => t.id === id);
  if (index === -1) return res.status(404).json({ error: 'Todo not found' });
  todos.splice(index, 1);
  res.json({ message: 'Deleted' });
});

const server = app.listen(PORT, () => {
  console.log(`Todo app running at http://localhost:${PORT}`);
});

module.exports = { app, server };
