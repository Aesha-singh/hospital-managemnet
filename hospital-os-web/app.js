'use strict';
/*
 * Hospital OS — client-side simulator.
 * Patients = processes, sensors = devices, hospital resources = system resources.
 * Triage drives dynamic priority; Banker's Algorithm guards every allocation.
 * All state lives in memory and is persisted to localStorage (no backend, no polling).
 */
(() => {
  const TICK_MS = 3000;
  const HIST = 30;          // readings kept per sensor (ring buffer)
  const LOG_MAX = 200;      // events kept in the activity log
  const STORE = 'hospital-os-v1';

  // ---------------------------------------------------------------- config
  const SENSOR_TYPES = {
    heart_rate:     { label: 'Heart Rate',       short: 'HR',   unit: 'bpm',         min: 60,   max: 100, icon: 'heart',   tint: '#e11d48', color: '#3b82f6' },
    respiration:    { label: 'Respiration Rate', short: 'Resp', unit: 'breaths/min', min: 12,   max: 20,  icon: 'wind',    tint: '#64748b', color: '#06b6d4' },
    spo2:           { label: 'Blood Oxygen',     short: 'SpO2', unit: '%',           min: 95,   max: 100, icon: 'lungs',   tint: '#f43f5e', color: '#22c55e', cap: 100 },
    temperature:    { label: 'Body Temperature', short: 'Temp', unit: '°C',          min: 36.1, max: 37.5, icon: 'thermo', tint: '#ea580c', color: '#f59e0b' },
    blood_pressure: { label: 'Blood Pressure',   short: 'BP',   unit: 'mmHg',        min: 90,   max: 120, icon: 'droplet', tint: '#dc2626', color: '#e11d48' },
    ecg:            { label: 'ECG',              short: 'ECG',  unit: 'mV',          min: 0.5,  max: 2.0, icon: 'activity', tint: '#7c3aed', color: '#8b5cf6', dp: 2 },
  };
  const TRIAGE = { green: 'Stable', yellow: 'Serious', red: 'Critical' };
  const RANK = { green: 0, yellow: 1, red: 2 };
  const COND_TRIAGE = { stable: 'green', fair: 'green', serious: 'yellow', critical: 'red' };
  const WARDS = ['ICU', 'General', 'Emergency', 'Cardiology', 'Pediatrics'];
  const RESOURCE_DEFS = [
    ['blood_units', 'Blood Units', 'units', 50],
    ['icu_beds', 'ICU Beds', 'beds', 10],
    ['ventilators', 'Ventilators', 'units', 6],
    ['ambulances', 'Ambulances', 'vehicles', 5],
    ['ward_beds', 'Ward Beds', 'beds', 30],
    ['doctors', 'Doctors', 'staff', 10],
    ['nurses', 'Nurses', 'staff', 18],
    ['surgical_rooms', 'Surgical Rooms', 'rooms', 4],
  ];
  // triage level -> { resource: [allocate now, declared max need] }
  const PLAN = {
    red:    { icu_beds: [1, 1], ventilators: [1, 1], doctors: [1, 1], nurses: [2, 2], blood_units: [2, 4] },
    yellow: { ward_beds: [1, 1], nurses: [1, 2] },
    green:  { ward_beds: [1, 1] },
  };
  const SEED = [
    [101, 'John Carter', 54, 'male', 'critical', 'ICU', true, ['heart_rate', 'respiration', 'spo2', 'temperature']],
    [102, 'Emily Davis', 32, 'female', 'serious', 'General', false, []],
    [103, 'Michael Lee', 67, 'male', 'critical', 'ICU', true, ['heart_rate', 'respiration', 'spo2', 'temperature']],
    [104, 'Sarah Wilson', 28, 'female', 'fair', 'General', false, []],
    [105, 'Robert King', 45, 'male', 'serious', 'Emergency', true, ['blood_pressure', 'heart_rate', 'spo2']],
    [106, 'Lisa Brown', 38, 'female', 'stable', 'General', false, []],
    [107, 'David Chen', 59, 'male', 'serious', 'ICU', true, ['heart_rate', 'spo2', 'temperature']],
    [108, 'Aesha Singh', 21, 'female', 'fair', 'General', true, ['blood_pressure', 'heart_rate', 'ecg']],
    [109, 'Rachana Rao', 41, 'female', 'stable', 'General', true, ['heart_rate', 'spo2', 'respiration']],
    [110, 'Meera Patel', 35, 'female', 'fair', 'Emergency', true, ['temperature', 'heart_rate', 'ecg']],
  ];

  const ICONS = {
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    stetho: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    trendUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    trendDown: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    shieldCheck: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    shieldAlert: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    battery: '<rect width="16" height="10" x="2" y="7" rx="2"/><line x1="22" x2="22" y1="11" y2="13"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="currentColor"/>',
    wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
    lungs: '<path d="M6.08 9C2.5 11 2 16 2 18c0 1.1.9 2 2 2 3 0 5-1 5-4V8.5C9 7.5 8 6 6.5 6.5"/><path d="M17.92 9C21.5 11 22 16 22 18c0 1.1-.9 2-2 2-3 0-5-1-5-4V8.5c0-1 1-2.5 2.5-2"/><path d="M12 4v7"/><path d="M9 13c1.5 0 3-1 3-2 0 1 1.5 2 3 2"/>',
    thermo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" fill="currentColor"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  };
  const icon = (name, cls = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  // ---------------------------------------------------------------- utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => r.querySelectorAll(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const fmtVal = (v, T) => (v == null ? '—' : v.toFixed(T.dp ?? 1));
  const sep = u => (u === '%' || u === '°C' ? '' : ' ');
  const withUnit = (v, T) => fmtVal(v, T) + sep(T.unit) + T.unit;
  const lim = (v, T) => String(+v.toFixed(2)) + sep(T.unit) + T.unit; // safe-range limits without trailing zeros
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isOut = (s, v = s.last) => { const T = SENSOR_TYPES[s.type]; return v != null && (v < T.min || v > T.max); };
  const sIcon = type => `<span class="sico" style="color:${SENSOR_TYPES[type].tint}">${icon(SENSOR_TYPES[type].icon)}</span>`;
  const triagePill = t => `<span class="pill tri-${t}">${TRIAGE[t]}</span>`;

  // ---------------------------------------------------------------- simulation core (from report §4.3–4.5)
  function generateReading(sensor, allowSpike = true) {
    const T = SENSOR_TYPES[sensor.type];
    const range = T.max - T.min, center = (T.min + T.max) / 2;
    const last = sensor.last ?? center;
    // natural variation: small random walk pulled toward centre
    let next = last + (Math.random() - 0.5) * range * 0.08 + (center - last) * 0.1;
    // 8% chance of anomaly (spike)
    if (allowSpike && Math.random() < 0.08) next = last + (Math.random() < 0.5 ? -1 : 1) * range * (0.15 + Math.random() * 0.25);
    if (T.cap != null) next = Math.min(next, T.cap);
    const f = 10 ** (T.dp ?? 1);
    return Math.round(Math.max(0, next) * f) / f;
  }

  // Sensor reliability (0–100): battery health, how suddenly the reading moved over the last
  // few samples (a jump that persists becomes trusted), and agreement with the patient's other sensors.
  const TRUST_LOW = 50;     // below this a reading cannot escalate a patient to Critical
  const TRUST_IGNORE = 30;  // below this a reading is left out of triage altogether
  function computeTrust(s, others) {
    if (s.status === 'offline') return 0;
    const T = SENSOR_TYPES[s.type], range = T.max - T.min, h = s.hist.slice(-4);
    let jump = 0;
    for (let i = 1; i < h.length; i++) jump = Math.max(jump, Math.abs(h[i] - h[i - 1]) / range);
    const stability = clamp(1 - (jump - 0.08) / 0.25, 0, 1);
    const battery = clamp(s.battery / 50, 0, 1);
    const agreement = !isOut(s) ? 1 : others.some(o => o !== s && o.status !== 'offline' && isOut(o)) ? 1 : 0.5;
    return Math.round(100 * (0.25 * battery + 0.45 * stability + 0.3 * agreement));
  }
  const trustClass = t => (t >= 80 ? 'hi' : t >= TRUST_LOW ? 'mid' : 'lo');

  function computeTriage(readings) {
    let hasRed = false, hasYellow = false;
    for (const { sensor, value } of readings) {
      const trust = sensor.trust ?? 100;
      if (trust < TRUST_IGNORE) continue;
      const T = SENSOR_TYPES[sensor.type];
      const deviation = value < T.min ? T.min - value : value > T.max ? value - T.max : 0;
      if (deviation === 0) continue;
      const severity = deviation / (T.max - T.min);
      const threshold = ['spo2', 'heart_rate', 'ecg'].includes(sensor.type) ? 0.15 : 0.25;
      if (severity > threshold || (sensor.type === 'spo2' && value < 90) ||
          (sensor.type === 'heart_rate' && (value > 130 || value < 45))) {
        if (trust >= TRUST_LOW) hasRed = true; else hasYellow = true;
      } else hasYellow = true;
    }
    return hasRed ? 'red' : hasYellow ? 'yellow' : 'green';
  }

  function bankers(resources, allocations) {
    const keys = resources.map(r => r.key);
    const work = resources.map(r => r.available);
    const tri = pid => RANK[patient(pid)?.triage] ?? 0;
    // most critical patients are considered first so the safe sequence is clinically meaningful
    const pids = [...new Set(allocations.map(a => a.pid))].sort((a, b) => tri(b) - tri(a) || a - b);
    const get = (pid, k) => allocations.find(a => a.pid === pid && a.key === k);
    const alloc = pids.map(pid => keys.map(k => get(pid, k)?.allocated || 0));
    const need = pids.map(pid => keys.map(k => { const a = get(pid, k); return a ? a.max - a.allocated : 0; }));
    const finished = pids.map(() => false), sequence = [], steps = [];
    const nameOf = pid => patient(pid)?.name ?? `PID ${pid}`;
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < pids.length; i++) {
        if (finished[i] || !need[i].every((n, j) => n <= work[j])) continue;
        const released = [];
        for (let j = 0; j < keys.length; j++) {
          work[j] += alloc[i][j];
          if (alloc[i][j]) released.push(`${resources[j].name} ×${alloc[i][j]}`);
        }
        finished[i] = true;
        sequence.push(nameOf(pids[i]));
        steps.push({ name: nameOf(pids[i]), released });
        progress = true;
      }
    }
    const safe = finished.every(Boolean);
    const blocked = pids.filter((_, i) => !finished[i]).map(nameOf);
    return {
      safe, sequence, steps, blocked, t: Date.now(),
      message: safe
        ? (sequence.length ? 'Safe — every patient can complete treatment with the resources available.' : 'Safe — no resources are currently allocated.')
        : `Unsafe — available resources cannot cover every patient's needs (${blocked.join(', ')}).`,
    };
  }

  // ---------------------------------------------------------------- state
  let state;
  const ui = { view: 'monitor', selectedPid: null, hoverX: null, query: '', pfilter: 'all' };
  let chartModel = null;

  // Storage backend: the local SQLite server (server.js) when it is reachable, else this browser's localStorage.
  let backend = false;
  let dbStatus = 'ok', lastSync = null, dbSnap = null, dbLoading = false;
  let pendingReadings = [], pendingLogs = [], resetPending = false;

  const patient = pid => state.patients.find(p => p.pid === pid);
  const sensorsOf = pid => state.sensors.filter(s => s.pid === pid);
  const resource = key => state.resources.find(r => r.key === key);
  const allocOf = (pid, key) => state.allocations.find(a => a.pid === pid && a.key === key);

  function addLog(type, msg) {
    const e = { type, msg, t: Date.now() };
    state.log.unshift(e);
    if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
    if (backend) pendingLogs.push(e);
  }

  function pushReading(s, v) {
    if (backend) pendingReadings.push({ sensor_id: s.id, pid: s.pid, value: v, is_alert: isOut(s, v) ? 1 : 0, t: Date.now() });
    s.prev = s.last; s.last = v;
    s.hist.push(v);
    if (s.hist.length > HIST) s.hist.shift();
  }

  function makeSensor(pid, type) {
    const s = { id: `SEN-${pid}-${SENSOR_TYPES[type].short}`, pid, type, last: null, prev: null,
      battery: Math.round(70 + Math.random() * 30), status: 'online', trust: 100, hist: [] };
    for (let i = 0; i < HIST; i++) pushReading(s, generateReading(s, false)); // warm-up history
    return s;
  }

  function seed() {
    pendingReadings = []; pendingLogs = []; resetPending = true;
    state = {
      v: 1, running: true, nextPid: 111, patients: [], sensors: [], allocations: [], log: [], lastSafety: null,
      resources: RESOURCE_DEFS.map(([key, name, unit, total]) => ({ key, name, unit, total, available: total })),
    };
    for (const [pid, name, age, gender, condition, ward, monitoring, types] of SEED) {
      state.patients.push({ pid, name, age, gender, condition, ward, contact: '', triage: 'green', monitoring, admitted: Date.now() });
      types.forEach(t => state.sensors.push(makeSensor(pid, t)));
    }
    addLog('system', `Monitoring started — ${state.patients.length} patients admitted, ${state.sensors.length} sensors connected`);
    reconcileAll();
    return state;
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.v === 1 && Array.isArray(s.patients) && Array.isArray(s.resources)) return s;
    } catch (e) { /* storage unavailable or corrupt: fall back to seed */ }
    return seed();
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (backend) return sync();
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }, 250);
  }

  // Rows for the database: sensors carry their safe range, the in-memory history stays client-side.
  function snapshot() {
    return {
      running: state.running, nextPid: state.nextPid, lastSafety: state.lastSafety,
      patients: state.patients.map(p => ({ ...p, priority: RANK[p.triage] })),
      sensors: state.sensors.map(({ hist, ...s }) => ({ ...s, min: SENSOR_TYPES[s.type].min, max: SENSOR_TYPES[s.type].max })),
      resources: state.resources, allocations: state.allocations,
    };
  }

  let syncing = false, syncAgain = false;
  async function sync() {
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    const readings = pendingReadings, logs = pendingLogs, reset = resetPending;
    pendingReadings = []; pendingLogs = []; resetPending = false;
    try {
      const r = await fetch('api/state', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset, state: snapshot(), readings, logs }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      dbStatus = 'ok';
      lastSync = Date.now();
      if (ui.view === 'database') refreshDb();
    } catch (e) {
      // keep unsent rows for the next attempt (bounded so a long outage can't grow memory forever)
      pendingReadings = readings.concat(pendingReadings).slice(-5000);
      pendingLogs = logs.concat(pendingLogs).slice(-LOG_MAX);
      resetPending = reset || resetPending;
      dbStatus = 'error';
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; sync(); }
    }
  }

  async function refreshDb() {
    if (!backend || dbLoading) return;
    dbLoading = true;
    try {
      const r = await fetch('api/db', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      dbSnap = await r.json();
      dbStatus = 'ok';
    } catch (e) {
      dbStatus = 'error';
    } finally {
      dbLoading = false;
      if (ui.view === 'database') render();
    }
  }

  // ---------------------------------------------------------------- resources
  function commitAlloc(pid, key, amount, max) {
    const r = resource(key);
    let a = allocOf(pid, key);
    if (!a) state.allocations.push(a = { pid, key, allocated: 0, max: 0 });
    r.available -= amount;
    a.allocated += amount;
    a.max = max;
  }

  function release(pid, key) {
    const a = allocOf(pid, key);
    if (!a) return;
    resource(key).available += a.allocated;
    state.allocations.splice(state.allocations.indexOf(a), 1);
  }

  const refreshSafety = () => (state.lastSafety = bankers(state.resources, state.allocations));

  // Banker's resource-request algorithm: grant only if the resulting state is safe.
  function tryAllocate(pid, key, amount, max) {
    const r = resource(key), a = allocOf(pid, key);
    const newAlloc = (a ? a.allocated : 0) + amount;
    max = Math.max(max ?? (a ? a.max : newAlloc), newAlloc);
    if (!Number.isInteger(amount) || amount < 1) return { ok: false, reason: 'amount must be a positive whole number' };
    if (max > r.total) return { ok: false, reason: `max need ${max} exceeds total ${r.name} (${r.total})` };
    if (amount > r.available) return { ok: false, reason: `only ${r.available} ${r.name} available` };
    const simRes = state.resources.map(x => (x.key === key ? { ...x, available: x.available - amount } : x));
    const simAlloc = state.allocations.filter(x => x !== a).concat({ pid, key, allocated: newAlloc, max });
    if (!bankers(simRes, simAlloc).safe) return { ok: false, reason: "remaining resources would not cover every patient's treatment" };
    commitAlloc(pid, key, amount, max);
    return { ok: true };
  }

  // Allocation level follows triage: escalations apply at once, de-escalations only after
  // the patient has stayed at the lower level for RELEASE_TICKS, so brief spikes don't churn resources.
  const RELEASE_TICKS = 5;
  function updateAllocLevel(p) {
    p.allocLevel ??= p.triage;
    if (RANK[p.triage] >= RANK[p.allocLevel]) { p.allocLevel = p.triage; p.calm = 0; return; }
    p.calm = (p.calm || 0) + 1;
    if (p.calm >= RELEASE_TICKS) { p.allocLevel = p.triage; p.calm = 0; }
  }

  // Bring a patient's holdings in line with the plan for their allocation level. Returns true if anything changed.
  function syncAllocations(p) {
    const plan = PLAN[p.allocLevel ?? p.triage];
    const granted = [], released = [], waiting = [];
    for (const a of state.allocations.filter(a => a.pid === p.pid)) {
      const want = plan[a.key];
      if (!want) { released.push(resource(a.key).name); release(p.pid, a.key); continue; }
      if (a.allocated > want[0]) {
        resource(a.key).available += a.allocated - want[0];
        released.push(`${resource(a.key).name} ×${a.allocated - want[0]}`);
        a.allocated = want[0];
      }
      a.max = Math.max(want[1], a.allocated);
    }
    for (const [key, [want, max]] of Object.entries(plan)) {
      const cur = allocOf(p.pid, key)?.allocated || 0;
      if (cur >= want) continue;
      if (tryAllocate(p.pid, key, want - cur, max).ok) granted.push(`${resource(key).name} ×${want - cur}`);
      else waiting.push(resource(key).name);
    }
    const before = (p.waiting || []).join();
    p.waiting = waiting;
    if (granted.length) addLog('alloc', `Allocated to ${p.name} (${TRIAGE[p.allocLevel ?? p.triage]}): ${granted.join(', ')}`);
    if (released.length) addLog('alloc', `Released from ${p.name}: ${released.join(', ')}`);
    if (waiting.length && waiting.join() !== before) addLog('denied', `${p.name} waiting for ${waiting.join(', ')} — none available`);
    return !!(granted.length || released.length);
  }

  // Reconcile every admitted patient's resources and refresh the safety check.
  function reconcileAll() {
    let changed = false;
    for (const p of state.patients) { updateAllocLevel(p); if (syncAllocations(p)) changed = true; }
    refreshSafety();
    return changed;
  }

  // ---------------------------------------------------------------- live monitoring loop (§5.3)
  function tick() {
    for (const p of state.patients) {
      if (!p.monitoring) continue;
      const readings = [];
      for (const s of sensorsOf(p.pid)) {
        const T = SENSOR_TYPES[s.type];
        if (s.status === 'offline') {
          if (Math.random() < 0.25) {
            if (s.battery <= 0) s.battery = 100;
            s.status = 'online';
            addLog('sensor', `${T.label} sensor on ${p.name} back online`);
          } else continue; // offline sensors are excluded from triage
        }
        s.battery = Math.max(0, s.battery - 0.02);
        if (s.battery <= 0 || Math.random() < 0.003) {
          s.status = 'offline';
          addLog('sensor', `${T.label} sensor on ${p.name} lost signal (${s.id}) — excluded from triage`);
          continue;
        }
        const v = generateReading(s);
        pushReading(s, v);
        readings.push({ sensor: s, value: v, wasAlert: s.status === 'alert' });
      }
      // score reliability once every sensor has its new reading, so agreement uses current values
      const ss = sensorsOf(p.pid);
      for (const r of readings) {
        const s = r.sensor, T = SENSOR_TYPES[s.type], v = r.value;
        s.trust = computeTrust(s, ss);
        const out = isOut(s, v);
        if (out && !r.wasAlert) {
          const low = v < T.min;
          const detail = `${p.name} — ${withUnit(v, T)} (${low ? 'below' : 'above'} threshold ${lim(low ? T.min : T.max, T)})`;
          if (s.trust >= TRUST_LOW) addLog('alert', `${T.label} alert: ${detail}`);
          else addLog('lowtrust', `Low-confidence ${T.label} reading: ${detail}, reliability ${s.trust}%`);
        }
        s.status = out ? 'alert' : 'online';
      }
      for (const s of ss) if (s.status === 'offline') s.trust = 0;
      const t = computeTriage(readings);
      if (t !== p.triage) {
        addLog('triage', `Patient ${p.name} (PID ${p.pid}) triage changed: ${p.triage.toUpperCase()} → ${t.toUpperCase()}`);
        p.triage = t;
      }
    }
    reconcileAll();
    save();
    render();
  }

  // ---------------------------------------------------------------- derived stats
  function stats() {
    const mon = state.patients.filter(p => p.monitoring);
    const monSet = new Set(mon.map(p => p.pid));
    const active = state.sensors.filter(s => monSet.has(s.pid));
    const total = state.resources.reduce((n, r) => n + r.total, 0);
    const free = state.resources.reduce((n, r) => n + r.available, 0);
    return {
      mon, monitored: mon.length,
      critical: mon.filter(p => p.triage === 'red').length,
      activeSensors: active.length,
      alerts: active.filter(s => s.status === 'alert' && (s.trust ?? 100) >= TRUST_LOW).length,
      online: state.sensors.filter(s => s.status !== 'offline').length,
      lowTrust: active.filter(s => s.status !== 'offline' && (s.trust ?? 100) < TRUST_LOW).length,
      totalSensors: state.sensors.length,
      util: total ? Math.round(((total - free) / total) * 100) : 0,
      free,
    };
  }

  // ---------------------------------------------------------------- views
  const empty = msg => `<div class="empty">${msg}</div>`;

  function spark(s) {
    const T = SENSOR_TYPES[s.type], h = s.hist.slice(-20);
    if (h.length < 2) return '<svg class="spark"></svg>';
    const lo = Math.min(...h, T.min), hi = Math.max(...h, T.max), span = hi - lo || 1;
    const pts = h.map((v, i) => `${((i / (h.length - 1)) * 62 + 1).toFixed(1)},${(20 - ((v - lo) / span) * 18).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 64 22" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${isOut(s) ? '#dc2626' : '#22c55e'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  function readingCard(p) {
    const rows = sensorsOf(p.pid).map(s => {
      const T = SENSOR_TYPES[s.type], off = s.status === 'offline', lowT = !off && (s.trust ?? 100) < TRUST_LOW;
      return `<div class="vrow ${off ? 'off' : ''}">${sIcon(s.type)}<span class="lbl" title="${T.label}">${T.label}</span>
        <span class="val ${!off && isOut(s) ? (lowT ? 'warn' : 'bad') : ''} ${lowT ? 'lowtrust' : ''}" ${lowT ? `title="Low reliability (${s.trust}%)"` : ''}>${off ? 'offline' : `${fmtVal(s.last, T)}<small>${sep(T.unit)}${T.unit}</small>`}</span>${spark(s)}</div>`;
    }).join('');
    return `<button class="reading-card ${p.triage === 'red' ? 'crit' : ''}" data-action="open-patient" data-pid="${p.pid}">
      <div class="rc-top"><div><h3>${esc(p.name)}</h3><div class="muted small">PID ${p.pid}</div></div>${triagePill(p.triage)}</div>
      ${rows || empty('No sensors attached')}</button>`;
  }

  const LOG_STYLE = {
    alert: ['alert', 'c-red', 'ALERT'], triage: ['activity', 'c-amber', 'TRIAGE'], admit: ['userPlus', 'c-blue', 'ADMIT'],
    discharge: ['logout', 'c-grey', 'DISCHARGE'], sensor: ['radio', 'c-grey', 'SENSOR'], alloc: ['stetho', 'c-cyan', 'ALLOCATION'],
    denied: ['shieldAlert', 'c-red', 'WAITING'], lowtrust: ['radio', 'c-amber', 'LOW CONFIDENCE'], safety: ['shieldCheck', 'c-green', 'SAFETY'], system: ['activity', 'c-grey', 'SYSTEM'],
  };
  function logRow(e, boxed = false) {
    const [ic, cls, label] = LOG_STYLE[e.type] || LOG_STYLE.system;
    return `<div class="log-row ${e.type} ${boxed ? 'boxed' : ''}">${icon(ic, cls)}<div><div>${esc(e.msg)}</div>
      <div class="meta">${boxed ? '' : label + ' · '}${fmtTime(e.t)}</div></div></div>`;
  }

  function statCard(label, value, hint, ic, color) {
    return `<div class="card stat"><div><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>
      <div class="tile ${color}">${icon(ic)}</div></div>`;
  }

  function viewMonitor(st) {
    return `
    <section class="stat-grid">
      ${statCard('Monitored Patients', st.monitored, `${st.critical} critical`, 'users', 'blue')}
      ${statCard('Active Alerts', st.alerts, st.alerts ? `${st.alerts} sensor${st.alerts > 1 ? 's' : ''} out of range` : 'All clear', 'alert', 'red')}
      ${statCard('Resource Utilization', `${st.util}%`, `${st.free} units free`, 'trendUp', 'cyan')}
      ${statCard('Online Sensors', st.online, `of ${st.totalSensors} total${st.lowTrust ? ` · ${st.lowTrust} low reliability` : ''}`, 'radio', 'green')}
    </section>
    <section class="card">
      <div class="card-head"><h2>${icon('radio', 'teal')} Live Sensor Readings ${state.running ? '<span class="live"><i></i>LIVE</span>' : '<span class="paused">PAUSED</span>'}</h2>
        <a class="link" href="#sensors">View All ${icon('chevron')}</a></div>
      ${st.mon.length ? `<div class="reading-grid">${[...st.mon].sort((a, b) => RANK[b.triage] - RANK[a.triage] || a.pid - b.pid).map(readingCard).join('')}</div>`
        : empty('No patients are being monitored. Start monitoring from the <a class="link" href="#patients">Patients</a> page.')}
    </section>
    <section class="card">
      <div class="card-head"><h2>System Activity &amp; Alerts</h2><span class="muted small">${state.log.length} events</span></div>
      <div class="log" data-keep="mlog">${state.log.map(e => logRow(e)).join('') || empty('No events yet.')}</div>
    </section>`;
  }

  function patientCard(p) {
    const n = sensorsOf(p.pid).length;
    return `<article class="card pcard">
      <div class="pc-top"><div class="pid">${p.pid}</div>
        <div class="pc-id"><h3 title="${esc(p.name)}">${esc(p.name)}</h3><div class="muted">${p.age}y ${p.gender} · ${esc(p.ward)}</div></div>
        ${triagePill(p.triage)}</div>
      <div class="chips"><span class="chip cond-${p.condition}">${p.condition}</span>
        ${p.monitoring ? `<span class="chip sensors">${icon('radio')} ${n} sensor${n === 1 ? '' : 's'}</span>` : '<span class="chip idle">Not monitored</span>'}</div>
      <div class="pc-actions">
        <button class="btn-link blue" data-action="manage" data-pid="${p.pid}">${icon('radio')} Manage Sensors</button>
        <button class="btn-link ${p.monitoring ? 'amber' : 'green'}" data-action="toggle-mon" data-pid="${p.pid}">${p.monitoring ? 'Stop' : 'Start'} Monitoring</button>
        <button class="icon-btn" data-action="discharge" data-pid="${p.pid}" title="Discharge and remove ${esc(p.name)}" aria-label="Discharge ${esc(p.name)}">${icon('trash')}</button>
      </div></article>`;
  }

  function viewPatients() {
    const q = ui.query.trim().toLowerCase();
    const list = state.patients.filter(p =>
      (ui.pfilter === 'all' || (ui.pfilter === 'monitored' && p.monitoring) || (ui.pfilter === 'critical' && p.triage === 'red')) &&
      (!q || p.name.toLowerCase().includes(q) || String(p.pid).includes(q) || p.ward.toLowerCase().includes(q)));
    const monitored = state.patients.filter(p => p.monitoring).length;
    const seg = (k, l) => `<button class="${ui.pfilter === k ? 'on' : ''}" data-action="pfilter" data-k="${k}">${l}</button>`;
    return `
    <section class="page-head">
      <div class="ph-left"><div class="ph-icon">${icon('users')}</div>
        <div><h2>Patient Registry</h2><div class="muted">${state.patients.length} patients · ${monitored} monitored</div></div></div>
      <button class="btn primary" data-action="admit">${icon('userPlus')} Admit Patient</button>
    </section>
    <div class="toolbar">
      <input id="psearch" class="search" type="search" placeholder="Search name, PID or ward…" value="${esc(ui.query)}" aria-label="Search patients">
      <div class="seg" role="group" aria-label="Filter">${seg('all', 'All')}${seg('monitored', 'Monitored')}${seg('critical', 'Critical')}</div>
    </div>
    ${list.length ? `<section class="pgrid">${list.map(patientCard).join('')}</section>` : empty('No patients match.')}`;
  }

  function sensorCard(s, p) {
    const T = SENSOR_TYPES[s.type], v = s.last;
    let status = !p.monitoring && s.status !== 'offline' ? 'idle' : s.status;
    if (status === 'alert' && (s.trust ?? 100) < TRUST_LOW) status = 'unverified';
    const range = T.max - T.min, lo = T.min - range * 0.6, hi = T.max + range * 0.6;
    const pos = v == null ? 0 : clamp(((v - lo) / (hi - lo)) * 100, 0, 100);
    const out = status !== 'offline' && status !== 'unverified' && isOut(s);
    const center = (T.min + T.max) / 2;
    const d = v != null && s.prev != null ? v - s.prev : 0;
    const away = Math.abs(v - center) > Math.abs(s.prev - center);
    const dev = status === 'offline' ? 'Signal lost — reading excluded from triage'
      : v < T.min ? `Below safe range by ${withUnit(T.min - v, T)}`
      : v > T.max ? `Above safe range by ${withUnit(v - T.max, T)}` : 'Within safe range';
    return `<article class="card sensor-card ${status}">
      <div class="sc-head"><div><div class="sc-name">${sIcon(s.type)} ${T.label}</div><div class="mono muted small">${s.id}</div></div>
        <span class="pill st-${status}">${{ online: 'ONLINE', alert: 'ALERT', unverified: 'UNVERIFIED', offline: 'OFFLINE', idle: 'PAUSED' }[status]}</span></div>
      <div class="sc-value"><span class="big mono ${out ? 'bad' : ''}">${status === 'offline' ? '--' : fmtVal(v, T)}</span><span class="unit">${T.unit}</span>
        ${d && status !== 'offline' ? `<span class="delta ${away ? 'away' : 'toward'}">${icon(d > 0 ? 'trendUp' : 'trendDown')}${Math.abs(d).toFixed(T.dp ?? 1)}</span>` : ''}</div>
      <div class="thresh" title="Position within safe range"><div class="safe" style="left:${((T.min - lo) / (hi - lo)) * 100}%;width:${(range / (hi - lo)) * 100}%"></div>
        <div class="marker ${out ? 'bad' : ''}" style="left:${pos}%"></div></div>
      <div class="sc-foot"><span>Safe ${+T.min.toFixed(2)}–${lim(T.max, T)}</span>
        <span class="batt ${s.battery < 20 ? 'low' : ''}">${icon('battery')} ${Math.round(s.battery)}%</span></div>
      <div class="dev ${out ? 'bad' : status === 'offline' ? 'off' : ''}">${dev}</div>
      ${trustRow(s)}</article>`;
  }

  function trustRow(s) {
    const t = s.status === 'offline' ? 0 : Math.round(s.trust ?? 100), c = trustClass(t);
    const note = s.status === 'offline' ? 'No signal'
      : t < TRUST_IGNORE ? 'Ignored for triage' : t < TRUST_LOW ? 'Cannot raise to Critical' : t < 80 ? 'Fair' : 'Reliable';
    return `<div class="trust" title="Based on battery, reading stability and agreement with this patient's other sensors">
      <div class="trust-top"><span>Reliability</span><span class="trust-val ${c}">${t}% · ${note}</span></div>
      <div class="trust-bar"><i class="${c}" style="width:${t}%"></i></div></div>`;
  }

  function viewSensors() {
    const withSensors = state.patients.filter(p => sensorsOf(p.pid).length);
    if (!withSensors.length) return `<section class="card">${empty('No sensors attached yet. Attach sensors from the <a class="link" href="#patients">Patients</a> page.')}</section>`;
    if (!withSensors.some(p => p.pid === ui.selectedPid)) ui.selectedPid = (withSensors.find(p => p.monitoring) || withSensors[0]).pid;
    const p = patient(ui.selectedPid), ss = sensorsOf(p.pid);
    const chips = withSensors.map(x => {
      const n = x.monitoring ? sensorsOf(x.pid).filter(s => s.status === 'alert' && (s.trust ?? 100) >= TRUST_LOW).length : 0;
      return `<button class="chip-btn ${x.pid === p.pid ? 'on' : ''}" data-action="select-patient" data-pid="${x.pid}">
        <span class="dot ${x.monitoring ? x.triage : 'idle'}"></span>${esc(x.name)}${n ? `<span class="mini-badge">${n}</span>` : ''}</button>`;
    }).join('');
    const alerts = state.log.filter(e => e.type === 'alert' || e.type === 'lowtrust').slice(0, 25);
    return `
    <section class="card"><div class="card-head"><h2>${icon('radio', 'teal')} Sensor Monitor</h2></div>
      <div class="chip-row" data-keep="chips">${chips}</div></section>
    <section class="card phead"><div class="pid">${p.pid}</div>
      <div><h2>${esc(p.name)}</h2><div class="muted">${p.age}y ${p.gender} · ${esc(p.ward)} · ${p.condition}${p.monitoring ? '' : ' · not monitored'}</div></div>
      ${triagePill(p.triage)}</section>
    <section class="card">
      <div class="card-head"><h2>Vital Signs — Live Chart</h2>
        <div class="legend"><span><i class="safe-key"></i>Safe range</span>${ss.map(s => `<span><i style="background:${SENSOR_TYPES[s.type].color}"></i>${SENSOR_TYPES[s.type].label}</span>`).join('')}</div></div>
      <div id="chart" class="chart"></div>
    </section>
    <section class="sgrid">${ss.map(s => sensorCard(s, p)).join('')}</section>
    <section class="card"><div class="card-head"><h2>${icon('alert', 'c-red')} Recent Sensor Alerts</h2></div>
      <div class="log" data-keep="salerts">${alerts.map(e => logRow(e, true)).join('') || empty('No sensor alerts yet.')}</div></section>`;
  }

  function viewResources() {
    const rcards = state.resources.map(r => {
      const pct = Math.round(((r.total - r.available) / r.total) * 100);
      return `<article class="card rcard"><div class="rc-name">${r.name}</div>
        <div><span class="big">${r.available}</span><span class="muted"> / ${r.total} ${r.unit}</span></div>
        <div class="bar"><i class="${pct > 80 ? 'hi' : pct > 50 ? 'mid' : ''}" style="width:${pct}%"></i></div>
        <div class="muted small">${pct}% in use</div></article>`;
    }).join('');

    // Capacity overview: overall status, patient mix by triage, resources running low.
    const freePct = r => (r.total ? r.available / r.total : 1);
    const low = state.resources.filter(r => freePct(r) <= 0.25).sort((a, b) => freePct(a) - freePct(b));
    const waiting = state.patients.filter(p => p.waiting?.length);
    const status = waiting.length || state.resources.some(r => freePct(r) < 0.1) ? ['red', 'Critical shortage']
      : low.length ? ['yellow', 'Under strain'] : ['green', 'Normal operations'];
    const mix = ['red', 'yellow', 'green'].map(t => [t, state.patients.filter(p => p.triage === t).length]);
    const nPatients = state.patients.length || 1;
    const overview = `<section class="card overview">
      <div class="card-head"><h2>${icon('stetho', 'teal')} Capacity Overview</h2><span class="pill tri-${status[0]} status-pill">${status[1]}</span></div>
      <div class="ov-grid">
        <div><div class="ov-label">Patients by triage</div>
          <div class="mix-bar" role="img" aria-label="${mix.map(([t, n]) => `${n} ${TRIAGE[t]}`).join(', ')}">
            ${mix.filter(([, n]) => n).map(([t, n]) => `<i class="mx-${t}" style="width:${(n / nPatients) * 100}%"></i>`).join('')}</div>
          <div class="mix-legend">${mix.map(([t, n]) => `<span><span class="dot ${t}"></span>${TRIAGE[t]} <b>${n}</b></span>`).join('')}</div></div>
        <div><div class="ov-label">Low availability</div>
          ${low.length ? `<div class="low-list">${low.map(r => `<span class="low-chip ${freePct(r) < 0.1 ? 'crit' : ''}">${r.name} <b>${r.available}/${r.total}</b></span>`).join('')}</div>`
            : '<div class="ov-ok">All resources above 25% availability</div>'}</div>
      </div></section>`;

    const waitCard = `<section class="card">
      <div class="card-head"><h2>Waiting for Resources</h2><span class="muted small">${waiting.length} patient${waiting.length === 1 ? '' : 's'}</span></div>
      ${waiting.length ? `<div class="wait-list">${waiting.map(p => `<div class="wait-row"><div><b>${esc(p.name)}</b>
          <div class="muted small">PID ${p.pid} · ${esc(p.ward)}</div></div>${triagePill(p.triage)}
          <div class="wait-need">${p.waiting.map(w => `<span class="low-chip crit">${w}</span>`).join('')}</div></div>`).join('')}</div>`
        : empty('Every patient has the resources their triage level requires.')}
    </section>`;

    const s = state.lastSafety;
    const safety = s ? `<section class="card safety ${s.safe ? 'ok' : 'bad'}">
      <div class="sf-head">${icon(s.safe ? 'shieldCheck' : 'shieldAlert')}<div><h2>Resource Safety Check</h2>
        <p class="sf-msg">${esc(s.message)}</p><div class="muted small">Checked automatically · ${fmtTime(s.t)}</div></div></div>
      ${s.blocked.length ? `<h4>At risk</h4><div class="seq">${s.blocked.map(n => `<span class="seq-chip blocked">${esc(n)}</span>`).join('')}</div>` : ''}
      ${s.sequence.length ? `<h4>Treatment order</h4><div class="seq">${s.sequence.map((n, i) => `<span class="seq-chip"><span class="seq-n">${i + 1}</span>${esc(n)}</span>`).join('')}</div>` : ''}
    </section>` : '';

    // One row per patient, listing everything they currently hold.
    const holders = state.patients
      .map(p => ({ p, held: state.allocations.filter(a => a.pid === p.pid && a.allocated > 0) }))
      .filter(x => x.held.length)
      .sort((a, b) => RANK[b.p.triage] - RANK[a.p.triage] || a.p.pid - b.p.pid);
    const rows = holders.map(({ p, held }) => `<tr><td><b>${esc(p.name)}</b><div class="muted small">PID ${p.pid}</div></td>
      <td>${esc(p.ward)}</td><td>${triagePill(p.triage)}</td>
      <td><div class="held">${held.map(a => `<span class="held-chip">${resource(a.key).name}${a.allocated > 1 ? ` ×${a.allocated}` : ''}</span>`).join('')}</div></td></tr>`).join('');

    return `
    ${overview}
    <section class="rgrid">${rcards}</section>
    <div class="two-col">${waitCard}${safety}</div>
    <section class="card"><div class="card-head"><h2>Patient Resources</h2><span class="muted small">${holders.length} patient${holders.length === 1 ? '' : 's'}</span></div>
      ${rows ? `<div class="table-wrap"><table class="alloc-table"><thead><tr><th>Patient</th><th>Ward</th><th>Triage</th><th>Assigned resources</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : empty('No resources are currently assigned.')}
    </section>`;
  }

  const TABLE_INFO = {
    patients: 'Admitted patients with ward, condition and triage level.',
    sensors: 'Monitoring devices attached to each patient.',
    sensor_readings: 'Every recorded vital-sign reading.',
    resources: 'Hospital resources with total and available counts.',
    allocations: 'Resources currently assigned to each patient.',
    simulation_logs: 'Admission, discharge, alert, triage and allocation events.',
  };

  function dbCell(col, v) {
    if (v == null) return '<span class="muted">NULL</span>';
    if (/_at$/.test(col) && typeof v === 'number') return fmtTime(v);
    const s = String(v);
    return esc(s.length > 70 ? s.slice(0, 70) + '…' : s);
  }

  function viewDatabase() {
    if (!backend) {
      return `<section class="card db-off"><div class="ph-icon">${icon('database')}</div><div>
        <h2>Database unavailable</h2>
        <p>The records server is not connected.</p></div></section>`;
    }
    if (!dbSnap) { refreshDb(); return `<section class="card">${empty('Loading database…')}</section>`; }
    const total = dbSnap.tables.reduce((n, t) => n + t.count, 0);
    const head = `<section class="card db-head"><div class="ph-icon">${icon('database')}</div>
      <div><h2>SQLite database · ${esc(dbSnap.file)}</h2>
        <div class="muted">${dbSnap.tables.length} tables · ${total.toLocaleString()} rows · ${(dbSnap.sizeBytes / 1024).toFixed(0)} KB on disk</div></div>
      <div class="db-status ${dbStatus}"><span class="dot ${dbStatus === 'ok' ? 'green' : 'red'}"></span>
        ${dbStatus === 'ok' ? `Synced ${lastSync ? fmtTime(lastSync) : ''}` : 'Server unreachable'}</div></section>`;
    const tables = dbSnap.tables.map(t => `<section class="card">
      <div class="card-head"><h2 class="mono">${t.name}</h2><span class="pill st-online">${t.count.toLocaleString()} rows</span></div>
      <p class="muted small db-desc">${TABLE_INFO[t.name] || ''}</p>
      ${t.rows.length ? `<div class="table-wrap" data-keep="db-${t.name}"><table class="dbt"><thead><tr>${t.columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.map(r => `<tr>${t.columns.map(c => `<td>${dbCell(c, r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${t.count > t.rows.length ? `<div class="muted small db-more">Showing the latest ${t.rows.length} of ${t.count.toLocaleString()} rows</div>` : ''}`
        : empty('No rows yet.')}
    </section>`).join('');
    return head + tables;
  }

  const VIEWS = {
    monitor: ['Live Monitor', viewMonitor],
    patients: ['Patients', viewPatients],
    sensors: ['Sensors', viewSensors],
    resources: ['Resources', viewResources],
    database: ['Database', viewDatabase],
  };

  // ---------------------------------------------------------------- chart
  const PL = 4, PR = 10, CH = 256;
  function renderChart() {
    const el = $('#chart');
    if (!el) return;
    const ss = sensorsOf(ui.selectedPid).filter(s => s.hist.length > 1);
    const W = Math.max(260, el.clientWidth), pt = 12, pb = 12, LO = -0.6, HI = 1.6;
    const y = n => pt + ((HI - clamp(n, LO, HI)) / (HI - LO)) * (CH - pt - pb);
    const x = i => PL + (i / (HIST - 1)) * (W - PL - PR);
    const series = ss.map(s => {
      const T = SENSOR_TYPES[s.type], off = HIST - s.hist.length;
      return { s, T, off, pts: s.hist.map((v, i) => [x(i + off), y((v - T.min) / (T.max - T.min)), v]) };
    });
    let svg = `<svg width="${W}" height="${CH}" role="img" aria-label="Vital signs trend for the selected patient">
      <rect class="band" x="0" y="${y(1)}" width="${W}" height="${y(0) - y(1)}"/>`;
    for (const n of [-0.5, 0, 0.5, 1, 1.5]) svg += `<line class="grid" x1="0" x2="${W}" y1="${y(n)}" y2="${y(n)}"/>`;
    svg += `<text class="axis" x="8" y="${y(1) + 14}">safe max</text><text class="axis" x="8" y="${y(0) - 6}">safe min</text>`;
    for (const { T, pts } of series) svg += `<polyline class="line" stroke="${T.color}" points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    for (const { T, pts } of series) {
      for (const [px, py, v] of pts) if (v < T.min || v > T.max) svg += `<circle class="alert-pt" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.5"/>`;
      const l = pts[pts.length - 1];
      svg += `<circle cx="${l[0].toFixed(1)}" cy="${l[1].toFixed(1)}" r="4" fill="${T.color}" stroke="#fff" stroke-width="1.5"/>`;
    }
    svg += `<line id="chart-guide" class="guide" x1="-10" x2="-10" y1="0" y2="${CH}"/></svg><div id="chart-tip" class="chart-tip" hidden></div>`;
    el.innerHTML = svg;
    chartModel = { W, x, series };
    el.onpointermove = e => { ui.hoverX = e.clientX - el.getBoundingClientRect().left; drawHover(); };
    el.onpointerleave = () => { ui.hoverX = null; drawHover(); };
    drawHover();
  }

  function drawHover() {
    const g = $('#chart-guide'), tip = $('#chart-tip');
    if (!g || !chartModel) return;
    if (ui.hoverX == null || !chartModel.series.length) { g.setAttribute('x1', -10); g.setAttribute('x2', -10); tip.hidden = true; return; }
    const { W, x, series } = chartModel;
    const i = clamp(Math.round(((ui.hoverX - PL) / (W - PL - PR)) * (HIST - 1)), 0, HIST - 1);
    const gx = x(i);
    g.setAttribute('x1', gx); g.setAttribute('x2', gx);
    const ago = ((HIST - 1 - i) * TICK_MS) / 1000;
    tip.innerHTML = `<div class="tip-h">${ago ? `${ago}s ago` : 'latest'}</div>` + series.map(({ s, T, off }) => {
      const v = s.hist[i - off];
      return v == null ? '' : `<div><i style="background:${T.color}"></i>${T.label}<b class="${isOut(s, v) ? 'bad' : ''}">${withUnit(v, T)}</b></div>`;
    }).join('');
    tip.hidden = false;
    tip.style.left = `${gx > W / 2 ? gx - tip.offsetWidth - 12 : gx + 12}px`;
  }

  // ---------------------------------------------------------------- home page
  function renderHome(st) {
    document.title = 'Hospital OS — Real-time Patient Monitoring';
    $('#hs-patients').textContent = state.patients.length;
    $('#hs-sensors').textContent = st.online;
    $('#hs-alerts').textContent = st.alerts;
    $('#hs-beds').textContent = resource('icu_beds')?.available ?? 0;
    const top = [...st.mon].sort((a, b) => RANK[b.triage] - RANK[a.triage] || a.pid - b.pid).slice(0, 4);
    $('#home-preview').innerHTML = top.map(p => {
      const s = sensorsOf(p.pid).find(x => x.type === 'heart_rate' && x.status !== 'offline')
        || sensorsOf(p.pid).find(x => x.status !== 'offline');
      const T = s && SENSOR_TYPES[s.type];
      return `<a class="hp-row" href="#sensors" data-action="open-patient" data-pid="${p.pid}">
        <span class="dot ${p.triage}"></span><span class="hp-name">${esc(p.name)}<small>PID ${p.pid} · ${esc(p.ward)}</small></span>
        <span class="hp-val">${s ? `${fmtVal(s.last, T)}<small> ${T.unit}</small>` : '—'}</span>${triagePill(p.triage)}</a>`;
    }).join('') || '<div class="hp-empty">No patients are being monitored right now.</div>';
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (document.hidden) return; // simulation keeps running; skip painting in background tabs
    const st = stats();
    const onHome = ui.view === 'home';
    document.body.classList.toggle('on-home', onHome);
    $('#home').hidden = !onHome;
    if (onHome) return renderHome(st);
    const [title, viewFn] = VIEWS[ui.view];
    $('#page-title').textContent = title;
    document.title = `${st.alerts ? `(${st.alerts}) ` : ''}${title} — Hospital OS`;
    $('#h-mon').textContent = st.monitored;
    $('#h-sens').textContent = st.activeSensors;
    const ha = $('#h-alerts');
    ha.textContent = st.alerts;
    ha.classList.toggle('danger', st.alerts > 0);
    $$('.nav-item').forEach(el => {
      const on = el.dataset.view === ui.view;
      el.classList.toggle('active', on);
      on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current');
    });
    const badge = $('#nav-badge');
    badge.textContent = st.alerts;
    badge.hidden = !st.alerts;
    const run = $('#run-btn');
    run.className = `run-btn ${state.running ? 'on' : 'off'}`;
    run.innerHTML = state.running ? '<span class="pulse"></span>Monitoring Active' : `${icon('play')} Start Monitoring`;
    run.title = state.running ? 'Pause monitoring' : 'Resume monitoring';
    $('#tick-info').textContent = backend && dbStatus !== 'ok' ? 'Connection lost — retrying' : `Last update ${fmtTime(Date.now())}`;

    // preserve scroll positions and focus across re-renders
    const keep = {};
    $$('[data-keep]').forEach(el => (keep[el.dataset.keep] = [el.scrollLeft, el.scrollTop]));
    const focused = document.activeElement?.id;
    const sel = focused && document.activeElement.selectionStart;
    $('#view').innerHTML = viewFn(st);
    $$('[data-keep]').forEach(el => { const k = keep[el.dataset.keep]; if (k) [el.scrollLeft, el.scrollTop] = k; });
    if (focused) { const el = document.getElementById(focused); if (el && $('#view').contains(el)) { el.focus(); if (sel != null) el.setSelectionRange(sel, sel); } }
    if (ui.view === 'sensors') renderChart();
  }

  // ---------------------------------------------------------------- modals & toasts
  function toast(msg, kind = 'ok') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  let lastFocus = null;
  function openModal(title, body, footer = '') {
    const root = $('#modal-root');
    if (root.hidden) lastFocus = document.activeElement;
    root.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h3>${esc(title)}</h3><button class="close" data-action="close-modal" aria-label="Close">${icon('x')}</button></header>${body}${footer}</div>`;
    root.hidden = false;
    (root.querySelector('input, select') || root.querySelector('.close')).focus();
  }
  function closeModal() {
    const root = $('#modal-root');
    root.hidden = true;
    root.innerHTML = '';
    lastFocus?.focus?.();
  }

  function admitModal() {
    const opt = a => a.map(v => `<option value="${v}">${v}</option>`).join('');
    const checks = Object.entries(SENSOR_TYPES).map(([k, T]) =>
      `<label class="check"><input type="checkbox" name="sensor" value="${k}" ${['heart_rate', 'spo2', 'temperature'].includes(k) ? 'checked' : ''}>${sIcon(k)} ${T.label}</label>`).join('');
    openModal('Admit Patient', `<form data-form="admit"><div class="body">
      <label class="field">Full name<input name="name" required maxlength="60" autocomplete="off"></label>
      <div class="row2"><label class="field">Age<input name="age" type="number" min="0" max="120" value="40" required></label>
        <label class="field">Gender<select name="gender">${opt(['male', 'female', 'other'])}</select></label></div>
      <div class="row2"><label class="field">Condition<select name="condition">${opt(['stable', 'fair', 'serious', 'critical'])}</select></label>
        <label class="field">Ward<select name="ward">${opt(WARDS)}</select></label></div>
      <label class="field">Contact (optional)<input name="contact" maxlength="60" autocomplete="off"></label>
      <div class="field">Attach sensors<div class="checks">${checks}</div></div>
      <label class="check"><input type="checkbox" name="monitor" checked> Start monitoring immediately</label>
    </div><footer><button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
      <button class="btn primary">${icon('userPlus')} Admit</button></footer></form>`);
  }

  function manageModal(pid) {
    const p = patient(pid);
    const rows = Object.entries(SENSOR_TYPES).map(([k, T]) => {
      const s = sensorsOf(pid).find(x => x.type === k);
      return `<div class="srow">${sIcon(k)}<div class="grow"><div>${T.label}</div>
        <div class="muted small">${s ? `${s.id} · ${withUnit(s.last, T)} · battery ${Math.round(s.battery)}%` : `Safe ${+T.min.toFixed(2)}–${lim(T.max, T)}`}</div></div>
        ${s ? `<button class="release" data-action="detach" data-pid="${pid}" data-type="${k}">Remove</button>`
            : `<button class="btn-link blue" data-action="attach" data-pid="${pid}" data-type="${k}">${icon('plus')} Attach</button>`}</div>`;
    }).join('');
    openModal(`Manage Sensors — ${p.name}`, `<div class="body">${rows}</div>`,
      '<footer><button class="btn primary" data-action="close-modal">Done</button></footer>');
  }

  // In-page confirmation (native confirm() is blocked when the page is embedded).
  let pendingConfirm = null;
  function confirmModal(title, msg, label, fn) {
    pendingConfirm = fn;
    openModal(title, `<div class="body"><p>${esc(msg)}</p></div>`,
      `<footer><button class="btn ghost" data-action="close-modal">Cancel</button>
        <button class="btn danger" data-action="confirm-yes">${esc(label)}</button></footer>`);
  }

  // ---------------------------------------------------------------- shift report (CSV)
  function csvCell(v) {
    if (v == null) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+@\t\r]|^-(?!\d)/.test(s)) s = "'" + s; // keep spreadsheets from running cell formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  const csvRow = cells => cells.map(csvCell).join(',');
  const stamp = t => {
    const d = new Date(t), z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  };

  function buildShiftReport() {
    const now = Date.now(), st = stats();
    const since = state.log.length ? state.log[state.log.length - 1].t : now;
    const held = pid => state.allocations.filter(a => a.pid === pid && a.allocated > 0)
      .map(a => `${resource(a.key).name}${a.allocated > 1 ? ' x' + a.allocated : ''}`).join('; ');
    const lines = [
      csvRow(['Shift Report', 'General Hospital — Patient Monitoring']),
      csvRow(['Generated', stamp(now)]),
      csvRow(['Period covered', `${stamp(since)} to ${stamp(now)}`]),
      csvRow(['Patients admitted', state.patients.length]),
      csvRow(['Patients monitored', st.monitored]),
      csvRow(['Critical patients', state.patients.filter(p => p.triage === 'red').length]),
      csvRow(['Active alerts', st.alerts]),
      csvRow(['Resource utilisation %', st.util]),
      csvRow(['Resource safety check', state.lastSafety?.message ?? '']),
      '',
      'PATIENTS',
      csvRow(['PID', 'Name', 'Age', 'Gender', 'Ward', 'Condition', 'Triage', 'Monitoring', 'Sensors', 'Assigned resources', 'Waiting for', 'Admitted']),
      ...state.patients.map(p => csvRow([p.pid, p.name, p.age, p.gender, p.ward, p.condition, TRIAGE[p.triage], p.monitoring ? 'Yes' : 'No',
        sensorsOf(p.pid).length, held(p.pid), (p.waiting || []).join('; '), p.admitted ? stamp(p.admitted) : ''])),
      '',
      'SENSORS',
      csvRow(['Sensor ID', 'PID', 'Patient', 'Type', 'Last reading', 'Unit', 'Safe min', 'Safe max', 'Status', 'Battery %', 'Reliability %']),
      ...state.sensors.map(s => {
        const T = SENSOR_TYPES[s.type];
        return csvRow([s.id, s.pid, patient(s.pid)?.name, T.label, s.last == null ? '' : fmtVal(s.last, T), T.unit, T.min, T.max,
          s.status, Math.round(s.battery), s.status === 'offline' ? 0 : Math.round(s.trust ?? 100)]);
      }),
      '',
      'RESOURCES',
      csvRow(['Resource', 'Total', 'Available', 'In use', 'Utilisation %']),
      ...state.resources.map(r => csvRow([r.name, r.total, r.available, r.total - r.available, Math.round(((r.total - r.available) / r.total) * 100)])),
      '',
      'EVENTS',
      csvRow(['Time', 'Type', 'Event']),
      ...state.log.map(e => csvRow([stamp(e.t), (LOG_STYLE[e.type] || LOG_STYLE.system)[2], e.msg])),
    ];
    return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads the dashes and symbols correctly
  }

  function exportShiftReport() {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    const name = `shift-report-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.csv`;
    const url = URL.createObjectURL(new Blob([buildShiftReport()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addLog('system', `Shift report exported (${name})`);
    toast(`Downloaded ${name}`);
  }

  // ---------------------------------------------------------------- actions
  const ACTIONS = {
    'toggle-run'() {
      state.running = !state.running;
      addLog('system', state.running ? 'Monitoring resumed' : 'Monitoring paused');
      toast(state.running ? 'Monitoring resumed' : 'Monitoring paused');
    },
    'confirm-yes'() {
      const fn = pendingConfirm;
      pendingConfirm = null;
      closeModal();
      fn?.();
    },
    admit: admitModal,
    manage: ({ pid }) => manageModal(+pid),
    'close-modal': closeModal,
    'toggle-mon'({ pid }) {
      const p = patient(+pid);
      if (!p.monitoring && !sensorsOf(p.pid).length) { toast(`Attach a sensor to ${p.name} first.`, 'err'); return manageModal(p.pid); }
      p.monitoring = !p.monitoring;
      if (!p.monitoring) sensorsOf(p.pid).forEach(s => s.status === 'alert' && (s.status = 'online'));
      addLog('system', `${p.monitoring ? 'Started' : 'Stopped'} monitoring ${p.name} (PID ${p.pid})`);
    },
    discharge({ pid }) {
      const p = patient(+pid);
      confirmModal('Discharge patient', `Discharge ${p.name} (PID ${p.pid})? Their sensors and resource allocations will be removed.`, 'Discharge', () => {
        state.allocations.filter(a => a.pid === p.pid).forEach(a => release(p.pid, a.key));
        state.sensors = state.sensors.filter(s => s.pid !== p.pid);
        state.patients = state.patients.filter(x => x !== p);
        reconcileAll(); // freed resources go to anyone waiting
        addLog('discharge', `Discharged ${p.name} (PID ${p.pid}) — sensors removed, resources released`);
        toast(`${p.name} discharged`);
      });
    },
    attach({ pid, type }) {
      const p = patient(+pid);
      state.sensors.push(makeSensor(p.pid, type));
      p.monitoring = true;
      addLog('sensor', `${SENSOR_TYPES[type].label} sensor attached to ${p.name}`);
      manageModal(p.pid);
    },
    detach({ pid, type }) {
      const p = patient(+pid);
      state.sensors = state.sensors.filter(s => !(s.pid === p.pid && s.type === type));
      if (!sensorsOf(p.pid).length) { p.monitoring = false; p.triage = 'green'; }
      addLog('sensor', `${SENSOR_TYPES[type].label} sensor removed from ${p.name}`);
      reconcileAll();
      manageModal(p.pid);
    },
    'select-patient'({ pid }) { ui.selectedPid = +pid; ui.hoverX = null; },
    'open-patient'({ pid }) { ui.selectedPid = +pid; location.hash = 'sensors'; },
    pfilter({ k }) { ui.pfilter = k; },
    export: exportShiftReport,
  };

  const FORMS = {
    admit(d) {
      const name = d.get('name').trim();
      if (!name) return false;
      const pid = Math.max(state.nextPid, ...state.patients.map(p => p.pid + 1));
      state.nextPid = pid + 1;
      const condition = d.get('condition'), ward = d.get('ward'), types = d.getAll('sensor');
      state.patients.push({ pid, name, age: +d.get('age'), gender: d.get('gender'), condition, ward,
        contact: d.get('contact').trim(), triage: COND_TRIAGE[condition], monitoring: !!(types.length && d.get('monitor')), admitted: Date.now() });
      types.forEach(t => state.sensors.push(makeSensor(pid, t)));
      addLog('admit', `Admitted ${name} (PID ${pid}) — ${condition}, ${ward}${types.length ? `, ${types.length} sensor${types.length > 1 ? 's' : ''} attached` : ''}`);
      reconcileAll();
      toast(`${name} admitted as PID ${pid}`);
    },
  };

  // ---------------------------------------------------------------- wiring
  document.addEventListener('click', e => {
    const root = $('#modal-root');
    if (e.target === root) return closeModal();
    const el = e.target.closest('[data-action]');
    if (!el || !ACTIONS[el.dataset.action]) return;
    e.preventDefault();
    ACTIONS[el.dataset.action](el.dataset);
    save();
    render();
  });

  document.addEventListener('submit', e => {
    const kind = e.target.dataset.form;
    if (!FORMS[kind]) return;
    e.preventDefault();
    if (FORMS[kind](new FormData(e.target)) === false) return;
    closeModal();
    save();
    render();
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'psearch') { ui.query = e.target.value; render(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal-root').hidden) closeModal();
  });

  function route() {
    const v = location.hash.slice(1);
    const homeAnchor = ['', 'home', 'features', 'how'].includes(v);
    ui.view = homeAnchor ? 'home' : VIEWS[v] ? v : 'monitor';
    ui.hoverX = null;
    if (ui.view === 'database') refreshDb();
    render();
    const target = homeAnchor && v && v !== 'home' && document.getElementById(v);
    if (target) target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    else window.scrollTo(0, 0);
  }

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderChart, 120); });
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', render);

  // static sidebar icons
  $$('[data-icon]').forEach(el => (el.outerHTML = icon(el.dataset.icon)));

  // Boot: use the SQLite server when the page was served by server.js, otherwise fall back to localStorage.
  (async () => {
    try {
      const r = await fetch('api/state', { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
        const d = await r.json();
        backend = true;
        if (d.state) state = d.state;
        else { seed(); save(); }
      }
    } catch (e) { /* opened as a file or hosted without the server */ }
    if (!backend) state = load();
    reconcileAll();
    route();
    setInterval(() => { if (state.running) tick(); }, TICK_MS);
  })();
})();
