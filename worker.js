let schemaPromise;

const SESSION_COOKIE = 'qrpass_session';
const SESSION_DAYS = 30;
const DEFAULT_COMPANY = {
  companyName: '',
  logoDataUrl: '',
  headerColor: '#181916',
  accentColor: '#f0c400',
  backgroundColor: '#e9e7df',
  setupCompleted: false
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function cleanText(value, max = 5000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function cleanDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanColor(value, fallback) {
  const text = cleanText(value, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
}

function cleanLogo(value) {
  const text = cleanText(value, 800000);
  if (!text) return '';
  return text.startsWith('data:image/png;base64,') ? text : null;
}

function normalizeEmail(value) { return cleanText(value, 254).toLowerCase(); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function normalizeCompanyCode(value) { return cleanText(value, 12).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function validSecret(value, min = 20, max = 200) {
  const text = cleanText(value, max);
  return text.length >= min && /^[-_A-Za-z0-9]+$/.test(text) ? text : '';
}

function parseCookies(request) {
  const result = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key) result[key] = part.slice(index + 1).trim();
  }
  return result;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function constantEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function companyFromRow(row) {
  if (!row) return { ...DEFAULT_COMPANY };
  return {
    companyName: row.company_name || '',
    logoDataUrl: row.logo_data_url || '',
    headerColor: row.header_color || DEFAULT_COMPANY.headerColor,
    accentColor: row.accent_color || DEFAULT_COMPANY.accentColor,
    backgroundColor: row.background_color || DEFAULT_COMPANY.backgroundColor,
    setupCompleted: Boolean(row.setup_completed)
  };
}

function machineFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    assetId: row.asset_id || '',
    area: row.area || '',
    manufacturer: row.manufacturer || '',
    model: row.model || '',
    serial: row.serial || '',
    interval: Number(row.interval_days) || 90,
    lastMaintenance: row.last_maintenance || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: []
  };
}

function entryFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    text: row.text || '',
    createdAt: row.created_at,
    resolved: Boolean(row.resolved),
    resolvedAt: row.resolved_at || null
  };
}

async function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions_v2 (
        token_hash TEXT PRIMARY KEY, actor_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
        role TEXT NOT NULL, label TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
        asset_id TEXT, area TEXT, manufacturer TEXT, model TEXT, serial TEXT,
        interval_days INTEGER NOT NULL DEFAULT 90, last_maintenance TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, machine_id TEXT NOT NULL,
        type TEXT NOT NULL, title TEXT NOT NULL, text TEXT, created_at TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0, resolved_at TEXT
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS company_settings (
        tenant_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '', logo_data_url TEXT,
        header_color TEXT NOT NULL DEFAULT '#181916', accent_color TEXT NOT NULL DEFAULT '#f0c400',
        background_color TEXT NOT NULL DEFAULT '#e9e7df', setup_completed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS company_access (
        tenant_id TEXT PRIMARY KEY, company_code TEXT NOT NULL UNIQUE, pin_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, display_name TEXT NOT NULL,
        pin_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_v2_tenant ON sessions_v2(tenant_id, role)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_v2_expiry ON sessions_v2(expires_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_machines_tenant ON machines(tenant_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_entries_machine ON entries(tenant_id, machine_id, created_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_entries_open ON entries(tenant_id, resolved, type)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id, active)'),
      env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_pin ON employees(tenant_id, pin_hash)')
    ]).catch(error => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

async function createUniqueCompanyCode(env) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bytes = new Uint8Array(7);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
    const exists = await env.DB.prepare('SELECT tenant_id FROM company_access WHERE company_code = ?').bind(code).first();
    if (!exists) return code;
  }
  throw new Error('Firmen-Code konnte nicht erzeugt werden.');
}

async function ensureCompanyAccess(env, tenantId) {
  let row = await env.DB.prepare(
    'SELECT tenant_id, company_code, pin_salt FROM company_access WHERE tenant_id = ?'
  ).bind(tenantId).first();
  if (row) return row;

  const code = await createUniqueCompanyCode(env);
  const salt = randomToken(16);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO company_access (tenant_id, company_code, pin_salt, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(tenantId, code, salt, now).run();
  return { tenant_id: tenantId, company_code: code, pin_salt: salt };
}

async function createSession(env, actorId, tenantId, role, label = '') {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 86400000);
  await env.DB.prepare(`
    INSERT INTO sessions_v2 (token_hash, actor_id, tenant_id, role, label, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tokenHash, actorId, tenantId, role, cleanText(label, 254), createdAt.toISOString(), expiresAt.toISOString()).run();
  return token;
}

async function getSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT token_hash, actor_id, tenant_id, role, label, expires_at
    FROM sessions_v2 WHERE token_hash = ? AND expires_at > ?
  `).bind(tokenHash, now).first();
  if (!row) {
    await env.DB.prepare('DELETE FROM sessions_v2 WHERE token_hash = ?').bind(tokenHash).run().catch(() => {});
    return null;
  }
  if (row.role === 'employee') {
    const employee = await env.DB.prepare(
      'SELECT active, display_name FROM employees WHERE id = ? AND tenant_id = ?'
    ).bind(row.actor_id, row.tenant_id).first();
    if (!employee || !employee.active) {
      await env.DB.prepare('DELETE FROM sessions_v2 WHERE token_hash = ?').bind(tokenHash).run().catch(() => {});
      return null;
    }
    row.label = employee.display_name;
  }
  return {
    tokenHash: row.token_hash,
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    role: row.role,
    label: row.label || ''
  };
}

function requireAdmin(session) {
  return session?.role === 'admin' ? null : json({ error: 'Keine Berechtigung.' }, 403);
}

async function authSalt(url, env) {
  const email = normalizeEmail(url.searchParams.get('email'));
  if (!validEmail(email)) return json({ error: 'E-Mail oder Passwort ist falsch.' }, 401);
  const user = await env.DB.prepare('SELECT password_salt FROM users WHERE email = ?').bind(email).first();
  if (!user) return json({ error: 'E-Mail oder Passwort ist falsch.' }, 401);
  return json({ salt: user.password_salt });
}

async function register(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);
  const companyName = cleanText(body.companyName, 180);
  const email = normalizeEmail(body.email);
  const salt = validSecret(body.passwordSalt, 20, 120);
  const verifier = validSecret(body.passwordVerifier, 30, 200);
  if (!companyName) return json({ error: 'Firmenname fehlt.' }, 400);
  if (!validEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }, 400);
  if (!salt || !verifier) return json({ error: 'Passwort konnte nicht sicher verarbeitet werden.' }, 400);
  if (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) {
    return json({ error: 'Für diese E-Mail-Adresse gibt es bereits ein Konto.' }, 409);
  }

  const firstCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  const firstUser = Number(firstCount?.count || 0) === 0;
  const tenantId = `tenant_${crypto.randomUUID()}`;
  const userId = `user_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const code = await createUniqueCompanyCode(env);
  const pinSalt = randomToken(16);
  const defaultSettings = firstUser ? await env.DB.prepare(
    "SELECT tenant_id FROM company_settings WHERE tenant_id = 'default'"
  ).first() : null;

  const statements = [
    env.DB.prepare('INSERT INTO tenants (id, created_at) VALUES (?, ?)').bind(tenantId, now),
    env.DB.prepare(`INSERT INTO users
      (id, tenant_id, email, password_hash, password_salt, role, created_at)
      VALUES (?, ?, ?, ?, ?, 'admin', ?)`
    ).bind(userId, tenantId, email, verifier, salt, now),
    env.DB.prepare(`INSERT INTO company_access (tenant_id, company_code, pin_salt, created_at)
      VALUES (?, ?, ?, ?)`
    ).bind(tenantId, code, pinSalt, now)
  ];

  if (firstUser) {
    statements.push(
      env.DB.prepare("UPDATE machines SET tenant_id = ? WHERE tenant_id = 'default'").bind(tenantId),
      env.DB.prepare("UPDATE entries SET tenant_id = ? WHERE tenant_id = 'default'").bind(tenantId)
    );
  }

  if (defaultSettings) {
    statements.push(
      env.DB.prepare("UPDATE company_settings SET tenant_id = ?, company_name = CASE WHEN company_name = '' THEN ? ELSE company_name END, updated_at = ? WHERE tenant_id = 'default'")
        .bind(tenantId, companyName, now)
    );
  } else {
    statements.push(
      env.DB.prepare(`INSERT INTO company_settings
        (tenant_id, company_name, logo_data_url, header_color, accent_color, background_color, setup_completed, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?, 0, ?)`
      ).bind(tenantId, companyName, DEFAULT_COMPANY.headerColor, DEFAULT_COMPANY.accentColor, DEFAULT_COMPANY.backgroundColor, now)
    );
  }

  try { await env.DB.batch(statements); }
  catch (error) {
    const duplicate = String(error?.message || '').toLowerCase().includes('unique');
    return json({ error: duplicate ? 'Für diese E-Mail-Adresse gibt es bereits ein Konto.' : 'Konto konnte nicht erstellt werden.' }, duplicate ? 409 : 500);
  }

  const token = await createSession(env, userId, tenantId, 'admin', email);
  return json({ ok: true, user: { email, role: 'admin' } }, 201, { 'set-cookie': sessionCookie(token) });
}

async function login(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);
  const email = normalizeEmail(body.email);
  const verifier = validSecret(body.passwordVerifier, 30, 200);
  if (!validEmail(email) || !verifier) return json({ error: 'E-Mail oder Passwort ist falsch.' }, 401);
  const user = await env.DB.prepare(`SELECT id, tenant_id, email, password_hash, role FROM users WHERE email = ?`).bind(email).first();
  if (!user || !constantEqual(verifier, user.password_hash)) return json({ error: 'E-Mail oder Passwort ist falsch.' }, 401);
  const token = await createSession(env, user.id, user.tenant_id, 'admin', user.email);
  return json({ ok: true, user: { email: user.email, role: 'admin' } }, 200, { 'set-cookie': sessionCookie(token) });
}

async function employeeChallenge(url, env) {
  const code = normalizeCompanyCode(url.searchParams.get('code'));
  if (code.length < 6) return json({ error: 'Firmen-Code nicht gefunden.' }, 404);
  const row = await env.DB.prepare(`
    SELECT a.pin_salt, c.company_name
    FROM company_access a LEFT JOIN company_settings c ON c.tenant_id = a.tenant_id
    WHERE a.company_code = ?
  `).bind(code).first();
  if (!row) return json({ error: 'Firmen-Code nicht gefunden.' }, 404);
  return json({ salt: row.pin_salt, companyName: row.company_name || '' });
}

async function employeeLogin(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);
  const code = normalizeCompanyCode(body.companyCode);
  const verifier = validSecret(body.pinVerifier, 30, 200);
  if (code.length < 6 || !verifier) return json({ error: 'Firmen-Code oder PIN ist falsch.' }, 401);
  const pinHash = await sha256(verifier);
  const row = await env.DB.prepare(`
    SELECT e.id, e.tenant_id, e.display_name
    FROM company_access a
    JOIN employees e ON e.tenant_id = a.tenant_id
    WHERE a.company_code = ? AND e.pin_hash = ? AND e.active = 1
  `).bind(code, pinHash).first();
  if (!row) return json({ error: 'Firmen-Code oder PIN ist falsch.' }, 401);
  const token = await createSession(env, row.id, row.tenant_id, 'employee', row.display_name);
  return json({ ok: true, user: { name: row.display_name, role: 'employee' } }, 200, { 'set-cookie': sessionCookie(token) });
}

async function logout(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    const hash = await sha256(token);
    await env.DB.prepare('DELETE FROM sessions_v2 WHERE token_hash = ?').bind(hash).run().catch(() => {});
  }
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

async function authSession(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ authenticated: false }, 401, { 'set-cookie': clearSessionCookie() });
  return json({
    authenticated: true,
    user: session.role === 'admin'
      ? { email: session.label, role: 'admin' }
      : { name: session.label, role: 'employee' }
  });
}

async function listEmployees(env, tenantId) {
  const access = await ensureCompanyAccess(env, tenantId);
  const result = await env.DB.prepare(`
    SELECT id, display_name, active, created_at, updated_at
    FROM employees WHERE tenant_id = ? ORDER BY display_name COLLATE NOCASE ASC
  `).bind(tenantId).all();
  return json({
    companyCode: access.company_code,
    pinSalt: access.pin_salt,
    employees: (result.results || []).map(row => ({
      id: row.id, name: row.display_name, active: Boolean(row.active),
      createdAt: row.created_at, updatedAt: row.updated_at
    }))
  });
}

async function createEmployee(request, env, tenantId) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);
  const name = cleanText(body.name, 120);
  const verifier = validSecret(body.pinVerifier, 30, 200);
  if (!name) return json({ error: 'Name fehlt.' }, 400);
  if (!verifier) return json({ error: 'PIN konnte nicht sicher verarbeitet werden.' }, 400);
  const pinHash = await sha256(verifier);
  const id = `employee_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO employees
      (id, tenant_id, display_name, pin_hash, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).bind(id, tenantId, name, pinHash, now, now).run();
  } catch (error) {
    const duplicate = String(error?.message || '').toLowerCase().includes('unique');
    return json({ error: duplicate ? 'Diese PIN wird in der Firma bereits verwendet.' : 'Mitarbeiter konnte nicht angelegt werden.' }, duplicate ? 409 : 500);
  }
  return json({ ok: true, employee: { id, name, active: true } }, 201);
}

async function updateEmployee(request, env, tenantId, employeeId) {
  const body = await readJson(request);
  if (!body || typeof body.active !== 'boolean') return json({ error: 'Ungültige Daten.' }, 400);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE employees SET active = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
    .bind(body.active ? 1 : 0, now, employeeId, tenantId).run();
  if (!result.meta?.changes) return json({ error: 'Mitarbeiter nicht gefunden.' }, 404);
  if (!body.active) {
    await env.DB.prepare("DELETE FROM sessions_v2 WHERE actor_id = ? AND tenant_id = ? AND role = 'employee'")
      .bind(employeeId, tenantId).run();
  }
  return json({ ok: true });
}

async function deleteEmployee(env, tenantId, employeeId) {
  await env.DB.prepare("DELETE FROM sessions_v2 WHERE actor_id = ? AND tenant_id = ? AND role = 'employee'")
    .bind(employeeId, tenantId).run();
  const result = await env.DB.prepare('DELETE FROM employees WHERE id = ? AND tenant_id = ?')
    .bind(employeeId, tenantId).run();
  if (!result.meta?.changes) return json({ error: 'Mitarbeiter nicht gefunden.' }, 404);
  return json({ ok: true });
}

async function getState(env, tenantId) {
  const [machinesResult, entriesResult, companyResult] = await env.DB.batch([
    env.DB.prepare(`SELECT id, name, asset_id, area, manufacturer, model, serial,
      interval_days, last_maintenance, notes, created_at, updated_at
      FROM machines WHERE tenant_id = ? ORDER BY created_at DESC`).bind(tenantId),
    env.DB.prepare(`SELECT id, machine_id, type, title, text, created_at, resolved, resolved_at
      FROM entries WHERE tenant_id = ? ORDER BY created_at ASC`).bind(tenantId),
    env.DB.prepare(`SELECT company_name, logo_data_url, header_color, accent_color, background_color, setup_completed
      FROM company_settings WHERE tenant_id = ?`).bind(tenantId)
  ]);
  const machines = (machinesResult.results || []).map(machineFromRow);
  const byId = new Map(machines.map(machine => [machine.id, machine]));
  for (const row of entriesResult.results || []) {
    const machine = byId.get(row.machine_id);
    if (machine) machine.history.push(entryFromRow(row));
  }
  return { machines, company: companyFromRow((companyResult.results || [])[0]) };
}

async function saveCompany(request, env, tenantId) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Firmendaten.' }, 400);
  const companyName = cleanText(body.companyName, 180);
  if (!companyName) return json({ error: 'Firmenname fehlt.' }, 400);
  const logoDataUrl = cleanLogo(body.logoDataUrl);
  if (logoDataUrl === null) return json({ error: 'Das Logo konnte nicht verarbeitet werden.' }, 400);
  const headerColor = cleanColor(body.headerColor, DEFAULT_COMPANY.headerColor);
  const accentColor = cleanColor(body.accentColor, DEFAULT_COMPANY.accentColor);
  const backgroundColor = cleanColor(body.backgroundColor, DEFAULT_COMPANY.backgroundColor);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO company_settings
    (tenant_id, company_name, logo_data_url, header_color, accent_color, background_color, setup_completed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET company_name=excluded.company_name, logo_data_url=excluded.logo_data_url,
      header_color=excluded.header_color, accent_color=excluded.accent_color,
      background_color=excluded.background_color, setup_completed=1, updated_at=excluded.updated_at`
  ).bind(tenantId, companyName, logoDataUrl || null, headerColor, accentColor, backgroundColor, now).run();
  return json({ ok: true, company: { companyName, logoDataUrl: logoDataUrl || '', headerColor, accentColor, backgroundColor, setupCompleted: true } });
}

async function upsertMachine(request, env, tenantId, id) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);
  const machineId = cleanText(id || body.id, 100);
  const name = cleanText(body.name, 180);
  if (!machineId || !name) return json({ error: 'Name der Maschine fehlt.' }, 400);
  const existing = await env.DB.prepare('SELECT tenant_id FROM machines WHERE id = ?').bind(machineId).first();
  if (existing && existing.tenant_id !== tenantId) return json({ error: 'Maschine nicht gefunden.' }, 404);
  const now = new Date().toISOString();
  const createdAt = cleanText(body.createdAt, 40) || now;
  const interval = Math.max(1, Math.min(36500, Number(body.interval) || 90));
  await env.DB.prepare(`INSERT INTO machines
    (id, tenant_id, name, asset_id, area, manufacturer, model, serial, interval_days, last_maintenance, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, asset_id=excluded.asset_id, area=excluded.area,
      manufacturer=excluded.manufacturer, model=excluded.model, serial=excluded.serial,
      interval_days=excluded.interval_days, last_maintenance=excluded.last_maintenance,
      notes=excluded.notes, updated_at=excluded.updated_at WHERE machines.tenant_id=excluded.tenant_id`
  ).bind(machineId, tenantId, name, cleanText(body.assetId, 120), cleanText(body.area, 160),
    cleanText(body.manufacturer, 160), cleanText(body.model, 160), cleanText(body.serial, 160),
    interval, cleanDate(body.lastMaintenance) || null, cleanText(body.notes, 5000), createdAt, now).run();
  return json({ ok: true, id: machineId });
}

async function addEntry(request, env, tenantId, machineId) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);
  const id = cleanText(body.id, 100);
  const type = cleanText(body.type, 30);
  if (!id || !new Set(['fault', 'maintenance', 'note']).has(type)) return json({ error: 'Ungültiger Eintrag.' }, 400);
  const machine = await env.DB.prepare('SELECT id FROM machines WHERE id = ? AND tenant_id = ?').bind(machineId, tenantId).first();
  if (!machine) return json({ error: 'Maschine nicht gefunden.' }, 404);
  const existingEntry = await env.DB.prepare('SELECT tenant_id FROM entries WHERE id = ?').bind(id).first();
  if (existingEntry && existingEntry.tenant_id !== tenantId) return json({ error: 'Eintrag konnte nicht gespeichert werden.' }, 409);
  const createdAt = cleanText(body.createdAt, 40) || new Date().toISOString();
  const title = cleanText(body.title, 220) || (type === 'note' ? 'Notiz' : 'Eintrag');
  const resolved = body.resolved ? 1 : 0;
  const resolvedAt = resolved ? (cleanText(body.resolvedAt, 40) || new Date().toISOString()) : null;
  const statements = [env.DB.prepare(`INSERT INTO entries
    (id, tenant_id, machine_id, type, title, text, created_at, resolved, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  ).bind(id, tenantId, machineId, type, title, cleanText(body.text, 10000), createdAt, resolved, resolvedAt)];
  if (type === 'maintenance') {
    const maintenanceDate = cleanDate(body.date) || createdAt.slice(0, 10);
    statements.push(env.DB.prepare(`UPDATE machines SET last_maintenance = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .bind(maintenanceDate, new Date().toISOString(), machineId, tenantId));
  }
  await env.DB.batch(statements);
  return json({ ok: true, id });
}

async function resolveEntry(env, tenantId, machineId, entryId) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`UPDATE entries SET resolved=1, resolved_at=?
    WHERE id=? AND machine_id=? AND tenant_id=? AND type='fault'`
  ).bind(now, entryId, machineId, tenantId).run();
  if (!result.meta?.changes) return json({ error: 'Störung nicht gefunden.' }, 404);
  return json({ ok: true, resolvedAt: now });
}

async function handleApi(request, env, url) {
  await ensureSchema(env);

  if (request.method === 'GET' && url.pathname === '/api/auth/salt') return authSalt(url, env);
  if (request.method === 'POST' && url.pathname === '/api/auth/register') return register(request, env);
  if (request.method === 'POST' && url.pathname === '/api/auth/login') return login(request, env);
  if (request.method === 'GET' && url.pathname === '/api/auth/employee-challenge') return employeeChallenge(url, env);
  if (request.method === 'POST' && url.pathname === '/api/auth/employee-login') return employeeLogin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') return logout(request, env);
  if (request.method === 'GET' && url.pathname === '/api/auth/session') return authSession(request, env);

  const session = await getSession(request, env);
  if (!session) return json({ error: 'Nicht angemeldet.' }, 401, { 'set-cookie': clearSessionCookie() });
  const tenantId = session.tenantId;

  if (request.method === 'GET' && url.pathname === '/api/state') return json(await getState(env, tenantId));

  if (url.pathname === '/api/company' && request.method === 'PUT') {
    const denied = requireAdmin(session); if (denied) return denied;
    return saveCompany(request, env, tenantId);
  }

  if (url.pathname === '/api/employees' && request.method === 'GET') {
    const denied = requireAdmin(session); if (denied) return denied;
    return listEmployees(env, tenantId);
  }
  if (url.pathname === '/api/employees' && request.method === 'POST') {
    const denied = requireAdmin(session); if (denied) return denied;
    return createEmployee(request, env, tenantId);
  }
  const employeeMatch = url.pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && request.method === 'PATCH') {
    const denied = requireAdmin(session); if (denied) return denied;
    return updateEmployee(request, env, tenantId, decodeURIComponent(employeeMatch[1]));
  }
  if (employeeMatch && request.method === 'DELETE') {
    const denied = requireAdmin(session); if (denied) return denied;
    return deleteEmployee(env, tenantId, decodeURIComponent(employeeMatch[1]));
  }

  const machineMatch = url.pathname.match(/^\/api\/machines\/([^/]+)$/);
  if (machineMatch && request.method === 'PUT') {
    const denied = requireAdmin(session); if (denied) return denied;
    return upsertMachine(request, env, tenantId, decodeURIComponent(machineMatch[1]));
  }
  const entriesMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/entries$/);
  if (entriesMatch && request.method === 'POST') {
    return addEntry(request, env, tenantId, decodeURIComponent(entriesMatch[1]));
  }
  const resolveMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/entries\/([^/]+)\/resolve$/);
  if (resolveMatch && request.method === 'PATCH') {
    const denied = requireAdmin(session); if (denied) return denied;
    return resolveEntry(env, tenantId, decodeURIComponent(resolveMatch[1]), decodeURIComponent(resolveMatch[2]));
  }

  return json({ error: 'API-Endpunkt nicht gefunden.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await handleApi(request, env, url); }
      catch (error) {
        console.error('QRPass API error', error);
        return json({ error: 'Serverfehler. Bitte erneut versuchen.' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
