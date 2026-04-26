const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

process.env.PORT = 0;
process.env.AUTH_USER = 'admin';
process.env.AUTH_PASS = 'password123';

let server, baseUrl, authToken;

before(async () => {
  const app = require('../server');
  server = app.server;
  await new Promise(resolve => server.on('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});
after(() => server.close());

async function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const hdrs = { 'Content-Type': 'application/json' };
    if (token) hdrs['x-auth-token'] = token;
    const options = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: hdrs };
    const r = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

describe('Auth API', () => {
  test('register new user', async () => {
    const res = await req('POST', '/api/auth/register', { username: 'testuser', password: 'pass123' });
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.username, 'testuser');
  });

  test('register duplicate username returns 409', async () => {
    await req('POST', '/api/auth/register', { username: 'dupuser', password: 'pass123' });
    const res = await req('POST', '/api/auth/register', { username: 'dupuser', password: 'pass123' });
    assert.equal(res.status, 409);
  });

  test('register short password returns 400', async () => {
    const res = await req('POST', '/api/auth/register', { username: 'newuser2', password: '123' });
    assert.equal(res.status, 400);
  });

  test('login with valid credentials', async () => {
    const res = await req('POST', '/api/auth/login', { username: 'admin', password: 'password123' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    authToken = res.body.token;
  });

  test('login with invalid credentials returns 401', async () => {
    const res = await req('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
    assert.equal(res.status, 401);
  });

  test('GET /api/auth/me with valid token', async () => {
    const res = await req('GET', '/api/auth/me', null, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.username, 'admin');
  });

  test('GET /api/auth/me without token returns 401', async () => {
    const res = await req('GET', '/api/auth/me');
    assert.equal(res.status, 401);
  });
});

describe('Todo API', () => {
  test('GET /api/todos returns array', async () => {
    const res = await req('GET', '/api/todos', null, authToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  test('GET /api/todos without token returns 401', async () => {
    const res = await req('GET', '/api/todos');
    assert.equal(res.status, 401);
  });

  test('POST creates todo with tags, color, priority', async () => {
    const res = await req('POST', '/api/todos', {
      text: 'Buy groceries', priority: 'high', color: 'red', tags: ['personal'], quadrant: 'ui'
    }, authToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.text, 'Buy groceries');
    assert.equal(res.body.priority, 'high');
    assert.equal(res.body.color, 'red');
    assert.deepEqual(res.body.tags, ['personal']);
    assert.equal(res.body.quadrant, 'ui');
  });

  test('POST returns 400 for empty text', async () => {
    const res = await req('POST', '/api/todos', { text: '' }, authToken);
    assert.equal(res.status, 400);
  });

  test('PATCH marks todo completed and syncs status', async () => {
    const created = await req('POST', '/api/todos', { text: 'Patch test' }, authToken);
    const id = created.body.id;
    const res = await req('PATCH', `/api/todos/${id}`, { completed: true }, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.completed, true);
    assert.equal(res.body.status, 'done');
  });

  test('PATCH moves to kanban status', async () => {
    const created = await req('POST', '/api/todos', { text: 'Kanban task' }, authToken);
    const id = created.body.id;
    const res = await req('PATCH', `/api/todos/${id}`, { status: 'doing' }, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'doing');
  });

  test('PATCH sets isTopGoal', async () => {
    const created = await req('POST', '/api/todos', { text: 'Top goal' }, authToken);
    const id = created.body.id;
    const res = await req('PATCH', `/api/todos/${id}`, { isTopGoal: true }, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.isTopGoal, true);
  });

  test('PATCH returns 404 for unknown id', async () => {
    const res = await req('PATCH', '/api/todos/99999', { completed: true }, authToken);
    assert.equal(res.status, 404);
  });

  test('DELETE removes todo', async () => {
    const created = await req('POST', '/api/todos', { text: 'To delete' }, authToken);
    const id = created.body.id;
    const del = await req('DELETE', `/api/todos/${id}`, null, authToken);
    assert.equal(del.status, 200);
    const list = await req('GET', '/api/todos', null, authToken);
    assert.ok(!list.body.find(t => t.id === id));
  });

  test('DELETE returns 404 for unknown id', async () => {
    const res = await req('DELETE', '/api/todos/99999', null, authToken);
    assert.equal(res.status, 404);
  });
});

describe('Bulk (Brain Dump)', () => {
  test('POST /api/todos/bulk creates multiple todos', async () => {
    const res = await req('POST', '/api/todos/bulk', {
      texts: ['Task one', 'Task two', 'Task three'], priority: 'low'
    }, authToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.length, 3);
    assert.equal(res.body[0].priority, 'low');
  });

  test('POST /api/todos/bulk returns 400 for empty array', async () => {
    const res = await req('POST', '/api/todos/bulk', { texts: [] }, authToken);
    assert.equal(res.status, 400);
  });
});
