const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  const { username, password, timezone, accent_color } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.trim().length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim())) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, timezone, accent_color) VALUES (?, ?, ?, ?)'
  ).run(username.trim(), hash, timezone || 'UTC', accent_color || '#6c63ff');
  const token = signToken(result.lastInsertRowid);
  res.status(201).json({ token, userId: result.lastInsertRowid, username: username.trim() });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signToken(user.id);
  res.json({ token, userId: user.id, username: user.username, accent_color: user.accent_color });
});

router.get('/me', requireAuth, (req, res) => {
  const { id, username, timezone, energy_profile, avatar, accent_color } = req.user;
  res.json({ id, username, timezone, energy_profile, avatar, accent_color });
});

router.patch('/me', requireAuth, async (req, res) => {
  const { timezone, energy_profile, avatar, accent_color } = req.body;
  db.prepare(
    'UPDATE users SET timezone=COALESCE(?,timezone), energy_profile=COALESCE(?,energy_profile), avatar=COALESCE(?,avatar), accent_color=COALESCE(?,accent_color) WHERE id=?'
  ).run(timezone, energy_profile, avatar, accent_color, req.user.id);
  res.json(db.prepare('SELECT id,username,timezone,energy_profile,avatar,accent_color FROM users WHERE id=?').get(req.user.id));
});

module.exports = router;
