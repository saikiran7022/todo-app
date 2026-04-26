/**
 * Real-time presence layer via WebSocket
 * Events: presence_join, presence_leave, presence_update,
 *         task_updated, task_created, task_deleted,
 *         editing_start, editing_stop, typing
 */
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

// listId → Set of { ws, userId, username, accentColor, screen, editingTaskId }
const rooms = new Map();

function getUsersInList(listId) {
  const room = rooms.get(listId);
  if (!room) return [];
  return [...room].map(c => ({
    userId: c.userId,
    username: c.username,
    accentColor: c.accentColor,
    screen: c.screen,
    editingTaskId: c.editingTaskId,
  }));
}

function broadcast(listId, event, data, excludeUserId = null) {
  const room = rooms.get(listId);
  if (!room) return;
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  for (const client of room) {
    if (client.ws.readyState === 1 && client.userId !== excludeUserId) {
      client.ws.send(msg);
    }
  }
}

function broadcastPresence(listId) {
  broadcast(listId, 'presence_update', { users: getUsersInList(listId) });
}

function setup(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let client = null;

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // ── Authenticate ──────────────────────────────────
      if (msg.type === 'auth') {
        try {
          const payload = jwt.verify(msg.token, JWT_SECRET);
          const db = require('./db');
          const user = db.prepare('SELECT id,username,accent_color FROM users WHERE id=?').get(payload.userId);
          if (!user) { ws.send(JSON.stringify({ event: 'error', data: { message: 'Unknown user' } })); return; }
          client = {
            ws, userId: user.id, username: user.username,
            accentColor: user.accent_color || '#6c63ff',
            listId: msg.listId, screen: 'home', editingTaskId: null,
          };
          if (!rooms.has(msg.listId)) rooms.set(msg.listId, new Set());
          rooms.get(msg.listId).add(client);
          ws.send(JSON.stringify({ event: 'auth_ok', data: { userId: user.id, users: getUsersInList(msg.listId) } }));
          broadcastPresence(msg.listId);
        } catch { ws.send(JSON.stringify({ event: 'error', data: { message: 'Invalid token' } })); }
        return;
      }

      if (!client) return;

      // ── Screen / editing presence ─────────────────────
      if (msg.type === 'screen') { client.screen = msg.screen; broadcastPresence(client.listId); }
      if (msg.type === 'editing_start') { client.editingTaskId = msg.taskId; broadcastPresence(client.listId); }
      if (msg.type === 'editing_stop') { client.editingTaskId = null; broadcastPresence(client.listId); }

      // ── Task mutations → broadcast to room ───────────
      if (['task_created','task_updated','task_deleted'].includes(msg.type)) {
        broadcast(client.listId, msg.type, msg.data, client.userId);
      }
    });

    ws.on('close', () => {
      if (!client) return;
      const room = rooms.get(client.listId);
      if (room) { room.delete(client); if (!room.size) rooms.delete(client.listId); }
      broadcastPresence(client.listId);
    });
  });

  return wss;
}

module.exports = { setup, broadcast };
