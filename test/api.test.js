const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

process.env.PORT = 0;
process.env.AUTH_USER = 'admin';
process.env.AUTH_PASS = 'password123';

let server;
let baseUrl;
let authToken;

before(async () => {
  const app = require('../server');
  server = app.server;
  await new Promise(resolve => server.on('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});

after(() => server.close());

async function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-auth-token'] = token;
    const options = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Auth API', () => {
  test('POST /api/auth/login with valid credentials returns token', async () => {
    const res = await request('POST', '/api/auth/login', { username: 'admin', password: 'password123' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.username, 'admin');
    authToken = res.body.token;
  });

  test('POST /api/auth/login with invalid credentials returns 401', async () => {
    const res = await request('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
    assert.equal(res.status, 401);
  });

  test('GET /api/auth/me with valid token returns user', async () => {
    const res = await request('GET', '/api/auth/me', null, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.username, 'admin');
  });

  test('GET /api/auth/me without token returns 401', async () => {
    const res = await request('GET', '/api/auth/me');
    assert.equal(res.status, 401);
  });
});

describe('Todo API (authenticated)', () => {
  test('GET /api/todos returns empty array initially', async () => {
    const res = await request('GET', '/api/todos', null, authToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  test('GET /api/todos without token returns 401', async () => {
    const res = await request('GET', '/api/todos');
    assert.equal(res.status, 401);
  });

  test('POST /api/todos creates a todo', async () => {
    const res = await request('POST', '/api/todos', { text: 'Buy groceries' }, authToken);
    assert.equal(res.status, 201);
    assert.equal(res.body.text, 'Buy groceries');
    assert.equal(res.body.completed, false);
    assert.ok(res.body.id);
  });

  test('POST /api/todos returns 400 for empty text', async () => {
    const res = await request('POST', '/api/todos', { text: '' }, authToken);
    assert.equal(res.status, 400);
  });

  test('PATCH /api/todos/:id marks todo as completed', async () => {
    const created = await request('POST', '/api/todos', { text: 'Test task' }, authToken);
    const id = created.body.id;
    const res = await request('PATCH', `/api/todos/${id}`, { completed: true }, authToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.completed, true);
  });

  test('PATCH /api/todos/:id returns 404 for unknown id', async () => {
    const res = await request('PATCH', '/api/todos/99999', { completed: true }, authToken);
    assert.equal(res.status, 404);
  });

  test('DELETE /api/todos/:id removes a todo', async () => {
    const created = await request('POST', '/api/todos', { text: 'To delete' }, authToken);
    const id = created.body.id;
    const del = await request('DELETE', `/api/todos/${id}`, null, authToken);
    assert.equal(del.status, 200);
    const list = await request('GET', '/api/todos', null, authToken);
    assert.ok(!list.body.find(t => t.id === id));
  });

  test('DELETE /api/todos/:id returns 404 for unknown id', async () => {
    const res = await request('DELETE', '/api/todos/99999', null, authToken);
    assert.equal(res.status, 404);
  });
});
