'use strict';
/*
 * Hospital OS — local demo backend.
 * Serves the web app and stores the simulation in a SQLite file (hospital.db)
 * using Node's built-in node:sqlite module, so no npm install is needed.
 * Tables mirror the schema described in the project report (§4.2).
 *
 *   node server.js        then open http://localhost:3000
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'hospital.db');
const MAX_READINGS = 50000; // older sensor_readings rows are trimmed beyond this

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS resources (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT,
    total INTEGER NOT NULL, available INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS patients (
    pid INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, gender TEXT, condition TEXT,
    ward TEXT, contact TEXT, triage_level TEXT, priority INTEGER, monitoring INTEGER, admitted_at INTEGER);
  CREATE TABLE IF NOT EXISTS sensors (
    id TEXT PRIMARY KEY, pid INTEGER NOT NULL, type TEXT NOT NULL, min_safe REAL, max_safe REAL,
    last_reading REAL, prev_reading REAL, battery REAL, status TEXT);
  CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sensor_id TEXT NOT NULL, pid INTEGER,
    value REAL NOT NULL, is_alert INTEGER, recorded_at INTEGER);
  CREATE INDEX IF NOT EXISTS idx_readings_sensor ON sensor_readings (sensor_id, id);
  CREATE TABLE IF NOT EXISTS allocations (
    pid INTEGER NOT NULL, resource_key TEXT NOT NULL, allocated INTEGER, max_need INTEGER,
    PRIMARY KEY (pid, resource_key));
  CREATE TABLE IF NOT EXISTS simulation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT, message TEXT, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS scheduling_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, algorithm TEXT, patient_order TEXT, gantt_data TEXT,
    avg_waiting_time REAL, avg_turnaround_time REAL, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

// columns added after the first release
try { db.exec('ALTER TABLE sensors ADD COLUMN trust REAL'); } catch { /* already present */ }

const TABLES = ['patients', 'sensors', 'sensor_readings', 'resources', 'allocations', 'simulation_logs'];
const HIST = 30;
const LOG_MAX = 200;

const getMeta = key => {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : undefined;
};
const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

// ------------------------------------------------------------------ read
function readState() {
  if (!getMeta('initialised')) return null;
  const histStmt = db.prepare('SELECT value FROM sensor_readings WHERE sensor_id = ? ORDER BY id DESC LIMIT ?');
  return {
    v: 1,
    running: getMeta('running') ?? true,
    nextPid: getMeta('nextPid') ?? 111,
    lastSafety: getMeta('lastSafety') ?? null,
    patients: db.prepare('SELECT * FROM patients ORDER BY pid').all().map(p => ({
      pid: p.pid, name: p.name, age: p.age, gender: p.gender, condition: p.condition, ward: p.ward,
      contact: p.contact ?? '', triage: p.triage_level, monitoring: !!p.monitoring, admitted: p.admitted_at,
    })),
    sensors: db.prepare('SELECT * FROM sensors ORDER BY pid, rowid').all().map(s => ({
      id: s.id, pid: s.pid, type: s.type, last: s.last_reading, prev: s.prev_reading,
      battery: s.battery, status: s.status, trust: s.trust ?? 100,
      hist: histStmt.all(s.id, HIST).map(r => r.value).reverse(),
    })),
    resources: db.prepare('SELECT * FROM resources ORDER BY rowid').all().map(r => ({ ...r })),
    allocations: db.prepare('SELECT * FROM allocations ORDER BY rowid').all().map(a => ({
      pid: a.pid, key: a.resource_key, allocated: a.allocated, max: a.max_need,
    })),
    log: db.prepare('SELECT * FROM simulation_logs ORDER BY id DESC LIMIT ?').all(LOG_MAX).map(l => ({
      type: l.event_type, msg: l.message, t: l.created_at,
    })),
  };
}

// ------------------------------------------------------------------ write
const n = v => (v === undefined ? null : v);

function writeState({ reset, state, readings = [], logs = [] }) {
  if (!state || !Array.isArray(state.patients) || !Array.isArray(state.sensors) || !Array.isArray(state.resources)) {
    throw Object.assign(new Error('invalid state payload'), { status: 400 });
  }
  db.exec('BEGIN');
  try {
    if (reset) {
      for (const t of ['patients', 'sensors', 'sensor_readings', 'resources', 'allocations', 'simulation_logs']) db.exec(`DELETE FROM ${t}`);
    }

    const pids = JSON.stringify(state.patients.map(p => p.pid));
    db.prepare('DELETE FROM patients WHERE pid NOT IN (SELECT value FROM json_each(?))').run(pids);
    const upP = db.prepare(`INSERT INTO patients (pid, name, age, gender, condition, ward, contact, triage_level, priority, monitoring, admitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pid) DO UPDATE SET name = excluded.name, age = excluded.age, gender = excluded.gender,
        condition = excluded.condition, ward = excluded.ward, contact = excluded.contact,
        triage_level = excluded.triage_level, priority = excluded.priority, monitoring = excluded.monitoring`);
    for (const p of state.patients) {
      upP.run(p.pid, p.name, n(p.age), n(p.gender), n(p.condition), n(p.ward), n(p.contact), n(p.triage),
        n(p.priority), p.monitoring ? 1 : 0, n(p.admitted) ?? Date.now());
    }

    const sids = state.sensors.map(s => s.id);
    const sidJson = JSON.stringify(sids);
    db.prepare('DELETE FROM sensors WHERE id NOT IN (SELECT value FROM json_each(?))').run(sidJson);
    db.prepare('DELETE FROM sensor_readings WHERE sensor_id NOT IN (SELECT value FROM json_each(?))').run(sidJson);
    const upS = db.prepare(`INSERT INTO sensors (id, pid, type, min_safe, max_safe, last_reading, prev_reading, battery, status, trust)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, type = excluded.type, min_safe = excluded.min_safe,
        max_safe = excluded.max_safe, last_reading = excluded.last_reading, prev_reading = excluded.prev_reading,
        battery = excluded.battery, status = excluded.status, trust = excluded.trust`);
    for (const s of state.sensors) {
      upS.run(s.id, s.pid, s.type, n(s.min), n(s.max), n(s.last), n(s.prev), n(s.battery), n(s.status), n(s.trust));
    }

    db.exec('DELETE FROM resources');
    const insR = db.prepare('INSERT INTO resources (key, name, unit, total, available) VALUES (?, ?, ?, ?, ?)');
    for (const r of state.resources) insR.run(r.key, r.name, n(r.unit), r.total, r.available);

    db.exec('DELETE FROM allocations');
    const insA = db.prepare('INSERT INTO allocations (pid, resource_key, allocated, max_need) VALUES (?, ?, ?, ?)');
    for (const a of state.allocations || []) insA.run(a.pid, a.key, a.allocated, a.max);

    const known = new Set(sids);
    const insRd = db.prepare('INSERT INTO sensor_readings (sensor_id, pid, value, is_alert, recorded_at) VALUES (?, ?, ?, ?, ?)');
    for (const r of readings) if (known.has(r.sensor_id)) insRd.run(r.sensor_id, n(r.pid), r.value, r.is_alert ? 1 : 0, n(r.t));
    db.prepare('DELETE FROM sensor_readings WHERE id <= (SELECT MAX(id) FROM sensor_readings) - ?').run(MAX_READINGS);

    const insL = db.prepare('INSERT INTO simulation_logs (event_type, message, created_at) VALUES (?, ?, ?)');
    for (const l of logs) insL.run(n(l.type), n(l.msg), n(l.t));

    setMeta.run('running', JSON.stringify(!!state.running));
    setMeta.run('nextPid', JSON.stringify(state.nextPid ?? 111));
    setMeta.run('lastSafety', JSON.stringify(state.lastSafety ?? null));
    setMeta.run('initialised', 'true');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ------------------------------------------------------------------ table browser
function inspect() {
  return {
    file: path.basename(DB_FILE),
    sizeBytes: fs.statSync(DB_FILE).size,
    tables: TABLES.map(name => ({
      name,
      count: db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,
      columns: db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name),
      rows: db.prepare(`SELECT * FROM ${name} ORDER BY rowid DESC LIMIT 8`).all().map(r => ({ ...r })),
    })),
  };
}

// ------------------------------------------------------------------ http
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 5e6) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, { state: readState() });
    if (url.pathname === '/api/state' && req.method === 'POST') { writeState(await readBody(req)); return send(res, 200, { ok: true }); }
    if (url.pathname === '/api/db' && req.method === 'GET') return send(res, 200, inspect());
    const file = STATIC[url.pathname];
    if (file && req.method === 'GET') return send(res, 200, fs.readFileSync(path.join(ROOT, file)), TYPES[path.extname(file)]);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Hospital OS running at http://localhost:${PORT}`);
  console.log(`Database file: ${DB_FILE}`);
});
