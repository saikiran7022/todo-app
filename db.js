/**
 * Async-initialised sql.js wrapper that provides a synchronous-style API
 * compatible with the rest of the codebase.
 *
 * Drop-in replacement for better-sqlite3: db.prepare(sql).run/get/all(...)
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');

let _db = null;
let _ready = null;

function persist() {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
  } catch {}
}

function getDb() {
  if (!_db) throw new Error('DB not initialised — await db.ready() first');
  return _db;
}

function prepare(sql) {
  return {
    run(...params) {
      const db = getDb();
      const stmt = db.prepare(sql);
      stmt.run(params);
      stmt.free();
      const changes = db.getRowsModified();
      const id = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0];
      persist();
      return { changes, lastInsertRowid: id };
    },
    get(...params) {
      const db = getDb();
      const stmt = db.prepare(sql);
      stmt.bind(params);
      let row = null;
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        row = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
      }
      stmt.free();
      return row;
    },
    all(...params) {
      const db = getDb();
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const cols = stmt.getColumnNames();
      const rows = [];
      while (stmt.step()) {
        const vals = stmt.get();
        rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
      }
      stmt.free();
      return rows;
    }
  };
}

function exec(sql) {
  getDb().run(sql);
  persist();
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    energy_profile TEXT DEFAULT 'morning',
    avatar TEXT,
    accent_color TEXT DEFAULT '#6c63ff',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mode TEXT DEFAULT 'personal',
    theme TEXT DEFAULT 'default',
    owner_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS list_members (
    list_id INTEGER,
    user_id INTEGER,
    role TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (list_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER,
    assigner_id INTEGER,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    color TEXT DEFAULT 'default',
    tags TEXT DEFAULT '[]',
    due_at TEXT,
    estimated_minutes INTEGER,
    location TEXT,
    recurrence TEXT,
    parent_id INTEGER,
    requires_pair INTEGER DEFAULT 0,
    verify_required INTEGER DEFAULT 0,
    quadrant TEXT,
    is_top_goal INTEGER DEFAULT 0,
    pair_checked_by TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS handoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    from_user_id INTEGER,
    to_user_id INTEGER,
    note TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS negotiations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    from_user_id INTEGER,
    type TEXT NOT NULL,
    proposed_owner_id INTEGER,
    proposed_due_at TEXT,
    proposed_scope TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS stakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    claimant_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS closing_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    landed TEXT DEFAULT '',
    rollover TEXT DEFAULT '',
    drop_list TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );
`;

_ready = (async () => {
  const SQL = await initSqlJs();
  let data;
  try { data = fs.readFileSync(DB_PATH); } catch {}
  _db = data ? new SQL.Database(data) : new SQL.Database();
  _db.run(SCHEMA);
  persist();
})();

module.exports = { prepare, exec, ready: () => _ready };
