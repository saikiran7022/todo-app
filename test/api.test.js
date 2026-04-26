const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

process.env.PORT = 0;
process.env.DB_PATH = path.join(__dirname, 'test.db');
process.env.JWT_SECRET = 'test-secret';

let server, baseUrl, tokenA, tokenB, userA, userB, listId, taskId;

before(async () => {
  // Clean test db
  try { require('fs').unlinkSync(process.env.DB_PATH); } catch {}
  const app = require('../server');
  server = app.server;
  await new Promise(resolve => server.on('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});
after(() => { server.close(); try { require('fs').unlinkSync(process.env.DB_PATH); } catch {} });

async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const hdrs = { 'Content-Type': 'application/json' };
    if (token) hdrs['x-auth-token'] = token;
    const r = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: hdrs }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d || '{}') }));
    });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

describe('Auth', () => {
  test('register user A', async () => {
    const r = await req('POST', '/api/auth/register', { username: 'alice', password: 'pass123' });
    assert.equal(r.status, 201); assert.ok(r.body.token);
    tokenA = r.body.token; userA = { id: r.body.userId, username: 'alice' };
  });
  test('register user B', async () => {
    const r = await req('POST', '/api/auth/register', { username: 'bob', password: 'pass456' });
    assert.equal(r.status, 201); tokenB = r.body.token; userB = { id: r.body.userId, username: 'bob' };
  });
  test('duplicate username → 409', async () => {
    assert.equal((await req('POST', '/api/auth/register', { username: 'alice', password: 'validpass' })).status, 409);
  });
  test('short password → 400', async () => {
    assert.equal((await req('POST', '/api/auth/register', { username: 'new', password: '123' })).status, 400);
  });
  test('login valid', async () => {
    const r = await req('POST', '/api/auth/login', { username: 'alice', password: 'pass123' });
    assert.equal(r.status, 200); assert.ok(r.body.token);
  });
  test('login invalid → 401', async () => {
    assert.equal((await req('POST', '/api/auth/login', { username: 'alice', password: 'wrong' })).status, 401);
  });
  test('GET /me', async () => {
    const r = await req('GET', '/api/auth/me', null, tokenA);
    assert.equal(r.status, 200); assert.equal(r.body.username, 'alice');
  });
  test('GET /me no token → 401', async () => {
    assert.equal((await req('GET', '/api/auth/me')).status, 401);
  });
});

describe('Lists', () => {
  test('create list', async () => {
    const r = await req('POST', '/api/lists', { name: 'Home', mode: 'couple' }, tokenA);
    assert.equal(r.status, 201); assert.equal(r.body.name, 'Home'); listId = r.body.id;
  });
  test('get lists', async () => {
    const r = await req('GET', '/api/lists', null, tokenA);
    assert.equal(r.status, 200); assert.ok(Array.isArray(r.body)); assert.ok(r.body.length >= 1);
  });
  test('invite member', async () => {
    const r = await req('POST', `/api/lists/${listId}/invite`, { username: 'bob' }, tokenA);
    assert.equal(r.status, 200);
  });
  test('get members', async () => {
    const r = await req('GET', `/api/lists/${listId}/members`, null, tokenA);
    assert.equal(r.status, 200); assert.equal(r.body.length, 2);
  });
});

describe('Tasks', () => {
  test('create task with all fields', async () => {
    const r = await req('POST', '/api/tasks', {
      list_id: listId, title: 'Pay rent', priority: 'high', color: 'red',
      tags: ['finance'], quadrant: 'ui', due_at: '2025-12-01', estimated_minutes: 30
    }, tokenA);
    assert.equal(r.status, 201);
    assert.equal(r.body.title, 'Pay rent');
    assert.equal(r.body.priority, 'high');
    assert.deepEqual(r.body.tags, ['finance']);
    assert.equal(r.body.quadrant, 'ui');
    assert.ok(r.body.owner);
    taskId = r.body.id;
  });
  test('create task → 400 no title', async () => {
    assert.equal((await req('POST', '/api/tasks', { list_id: listId, title: '' }, tokenA)).status, 400);
  });
  test('get tasks for list', async () => {
    const r = await req('GET', `/api/tasks?list_id=${listId}`, null, tokenA);
    assert.equal(r.status, 200); assert.ok(Array.isArray(r.body));
  });
  test('patch task status', async () => {
    const r = await req('PATCH', `/api/tasks/${taskId}`, { status: 'doing' }, tokenA);
    assert.equal(r.status, 200); assert.equal(r.body.status, 'doing');
  });
  test('patch completed syncs status', async () => {
    const r = await req('PATCH', `/api/tasks/${taskId}`, { completed: true }, tokenA);
    assert.equal(r.status, 200); assert.equal(r.body.status, 'done');
  });
  test('patch is_top_goal', async () => {
    const r = await req('PATCH', `/api/tasks/${taskId}`, { is_top_goal: true }, tokenA);
    assert.equal(r.status, 200); assert.ok(r.body.is_top_goal);
  });
  test('patch unknown → 404', async () => {
    assert.equal((await req('PATCH', '/api/tasks/99999', { status: 'doing' }, tokenA)).status, 404);
  });
});

describe('Handoffs', () => {
  test('handoff requires note', async () => {
    assert.equal((await req('POST', `/api/tasks/${taskId}/handoff`, { to_user_id: userB.id, note: '' }, tokenA)).status, 400);
  });
  test('handoff with note', async () => {
    const r = await req('POST', `/api/tasks/${taskId}/handoff`, { to_user_id: userB.id, note: 'Please handle this — I have context: landlord needs check by Friday' }, tokenA);
    assert.equal(r.status, 201);
    assert.ok(r.body.handoffs?.length >= 1);
    assert.equal(r.body.owner?.id, userB.id);
  });
});

describe('Negotiations', () => {
  test('accept negotiation', async () => {
    const r = await req('POST', `/api/tasks/${taskId}/negotiate`, { type: 'accept' }, tokenB);
    assert.equal(r.status, 201); assert.equal(r.body.type, 'accept');
  });
  test('counter requires reason', async () => {
    assert.equal((await req('POST', `/api/tasks/${taskId}/negotiate`, { type: 'counter' }, tokenA)).status, 400);
  });
  test('counter with reason', async () => {
    const r = await req('POST', `/api/tasks/${taskId}/negotiate`, { type: 'counter', reason: 'Can we push to next week?', proposed_due_at: '2025-12-08' }, tokenA);
    assert.equal(r.status, 201);
  });
});

describe('Stakes', () => {
  test('attach stake to task', async () => {
    const r = await req('POST', `/api/tasks/${taskId}/stake`, { type: 'money', value: '$10' }, tokenA);
    assert.equal(r.status, 201); assert.equal(r.body.type, 'money');
  });
});

describe('Brain dump (bulk)', () => {
  test('bulk create', async () => {
    const r = await req('POST', '/api/tasks/bulk', { list_id: listId, texts: ['Write docs', 'Review PR', 'Update deps'], priority: 'low' }, tokenA);
    assert.equal(r.status, 201); assert.equal(r.body.length, 3);
  });
  test('bulk empty → 400', async () => {
    assert.equal((await req('POST', '/api/tasks/bulk', { list_id: listId, texts: [] }, tokenA)).status, 400);
  });
});

describe('Delete', () => {
  test('delete task', async () => {
    const created = await req('POST', '/api/tasks', { list_id: listId, title: 'To delete' }, tokenA);
    assert.equal((await req('DELETE', `/api/tasks/${created.body.id}`, null, tokenA)).status, 200);
  });
  test('delete unknown → 404', async () => {
    assert.equal((await req('DELETE', '/api/tasks/99999', null, tokenA)).status, 404);
  });
});
