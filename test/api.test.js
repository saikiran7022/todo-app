const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Start the server on a random port for testing
let server;
let baseUrl;

// Patch PORT for testing
process.env.PORT = 0;

before(async () => {
  const app = require('../server');
  server = app.server;
  await new Promise(resolve => server.on('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});

after(() => {
  server.close();
});

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json' }
    };
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

describe('Todo API', () => {
  test('GET /api/todos returns empty array initially', async () => {
    const res = await request('GET', '/api/todos');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  test('POST /api/todos creates a todo', async () => {
    const res = await request('POST', '/api/todos', { text: 'Buy groceries' });
    assert.equal(res.status, 201);
    assert.equal(res.body.text, 'Buy groceries');
    assert.equal(res.body.completed, false);
    assert.ok(res.body.id);
  });

  test('POST /api/todos returns 400 for empty text', async () => {
    const res = await request('POST', '/api/todos', { text: '' });
    assert.equal(res.status, 400);
  });

  test('GET /api/todos returns created todos', async () => {
    const res = await request('GET', '/api/todos');
    assert.equal(res.status, 200);
    assert.ok(res.body.length >= 1);
  });

  test('PATCH /api/todos/:id marks todo as completed', async () => {
    const created = await request('POST', '/api/todos', { text: 'Test task' });
    const id = created.body.id;
    const res = await request('PATCH', `/api/todos/${id}`, { completed: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.completed, true);
  });

  test('PATCH /api/todos/:id returns 404 for unknown id', async () => {
    const res = await request('PATCH', '/api/todos/99999', { completed: true });
    assert.equal(res.status, 404);
  });

  test('DELETE /api/todos/:id removes a todo', async () => {
    const created = await request('POST', '/api/todos', { text: 'To delete' });
    const id = created.body.id;
    const del = await request('DELETE', `/api/todos/${id}`);
    assert.equal(del.status, 200);
    const list = await request('GET', '/api/todos');
    assert.ok(!list.body.find(t => t.id === id));
  });

  test('DELETE /api/todos/:id returns 404 for unknown id', async () => {
    const res = await request('DELETE', '/api/todos/99999');
    assert.equal(res.status, 404);
  });
});
