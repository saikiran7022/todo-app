const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory session store
const sessions = new Map();

// Config — override via env vars
const USERS = {
  [process.env.AUTH_USER || 'admin']: process.env.AUTH_PASS || 'password123'
};

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

// ── Auth routes ──────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (USERS[username] && USERS[username] === password) {
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

// ── Todo routes (protected) ──────────────────────────────
// Per-user todo storage
const userTodos = new Map();
let nextId = 1;

function getTodos(username) {
  if (!userTodos.has(username)) userTodos.set(username, []);
  return userTodos.get(username);
}

app.get('/api/todos', requireAuth, (req, res) => {
  res.json(getTodos(req.user.username));
});

app.post('/api/todos', requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text is required' });
  }
  const todos = getTodos(req.user.username);
  const todo = { id: nextId++, text: text.trim(), completed: false, createdAt: new Date().toISOString() };
  todos.push(todo);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const todos = getTodos(req.user.username);
  const todo = todos.find(t => t.id === id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  if (req.body.completed !== undefined) todo.completed = req.body.completed;
  if (req.body.text !== undefined) todo.text = req.body.text.trim();
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
