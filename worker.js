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
  try {
    return await request.json();
  } catch {
    return null;
  }
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
  if (!text.startsWith('data:image/png;base64,')) return null;
  return text;
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPasswordMaterial(value, min = 20, max = 200) {
  const text = cleanText(value, max);
  return text.length >= min && /^[-_A-Za-z0-9]+$/.test(text) ? text : '';
}

function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = value;
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
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
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

async function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS tenants (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin',
          created_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS machines (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          asset_id TEXT,
          area TEXT,
          manufacturer TEXT,
          model TEXT,
          serial TEXT,
          interval_days INTEGER NOT NULL DEFAULT 90,
          last_maintenance TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          machine_id TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          text TEXT,
          created_at TEXT NOT NULL,
          resolved INTEGER NOT NULL DEFAULT 0,
          resolved_at TEXT
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS company_settings (
          tenant_id TEXT PRIMARY KEY,
          company_name TEXT NOT NULL DEFAULT '',
          logo_data_url TEXT,
          header_color TEXT NOT NULL DEFAULT '#181916',
          accent_color TEXT NOT NULL DEFAULT '#f0c400',
          background_color TEXT NOT NULL DEFAULT '#e9e7df',
          setup_completed INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        )
      `),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_machines_tenant ON machines(tenant_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_entries_machine ON entries(tenant_id, machine_id, created_at)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_entries_open ON entries(tenant_id, resolved, type)')
    ]).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function createSession(env, userId, tenantId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 86400000);

  await env.DB.prepare(`
    INSERT INTO sessions (token_hash, user_id, tenant_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    userId,
    tenantId,
    createdAt.toISOString(),
    expiresAt.toISOString()
  ).run();

  return token;
}

async function getSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT s.token_hash, s.user_id, s.tenant_id, s.expires_at,
           u.email, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(tokenHash, now).first();

  if (!row) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run().catch(() => {});
    return null;
  }

  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role
  };
}

async function getPasswordSalt(env, email) {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) return randomToken(16);
  const row = await env.DB.prepare('SELECT password_salt FROM users WHERE email = ?').bind(normalized).first();
  return row?.password_salt || randomToken(16);
}

async function register(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);

  const companyName = cleanText(body.companyName, 180);
  const email = normalizeEmail(body.email);
  const salt = validPasswordMaterial(body.passwordSalt, 20, 100);
  const verifier = validPasswordMaterial(body.passwordVerifier, 32, 120);

  if (!companyName) return json({ error: 'Firmenname fehlt.' }, 400);
  if (!validEmail(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }, 400);
  if (!salt || !verifier) return json({ error: 'Passwort konnte nicht sicher verarbeitet werden.' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'Für diese E-Mail-Adresse gibt es bereits ein Konto.' }, 409);

  const firstUserResult = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  const isFirstUser = Number(firstUserResult?.count || 0) === 0;
  const tenantId = `tenant_${crypto.randomUUID()}`;
  const userId = `user_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const statements = [
    env.DB.prepare('INSERT INTO tenants (id, created_at) VALUES (?, ?)').bind(tenantId, now),
    env.DB.prepare(`
      INSERT INTO users (id, tenant_id, email, password_hash, password_salt, role, created_at)
      VALUES (?, ?, ?, ?, ?, 'admin', ?)
    `).bind(userId, tenantId, email, verifier, salt, now)
  ];

  if (isFirstUser) {
    statements.push(
      env.DB.prepare("UPDATE machines SET tenant_id = ? WHERE tenant_id = 'default'").bind(tenantId),
      env.DB.prepare("UPDATE entries SET tenant_id = ? WHERE tenant_id = 'default'").bind(tenantId),
      env.DB.prepare("UPDATE company_settings SET tenant_id = ? WHERE tenant_id = 'default'").bind(tenantId)
    );
  }

  statements.push(
    env.DB.prepare(`
      INSERT INTO company_settings (
        tenant_id, company_name, logo_data_url, header_color,
        accent_color, background_color, setup_completed, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, 0, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        company_name = CASE WHEN company_name = '' THEN excluded.company_name ELSE company_name END,
        updated_at = excluded.updated_at
    `).bind(
      tenantId,
      companyName,
      DEFAULT_COMPANY.headerColor,
      DEFAULT_COMPANY.accentColor,
      DEFAULT_COMPANY.backgroundColor,
      now
    )
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    const duplicate = message.includes('unique') || message.includes('constraint');
    return json({ error: duplicate ? 'Für diese E-Mail-Adresse gibt es bereits ein Konto.' : 'Konto konnte nicht erstellt werden.' }, duplicate ? 409 : 500);
  }

  const token = await createSession(env, userId, tenantId);
  return json(
    { ok: true, user: { email, role: 'admin' } },
    201,
    { 'set-cookie': sessionCookie(token) }
  );
}

async function login(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);

  const email = normalizeEmail(body.email);
  const verifier = validPasswordMaterial(body.passwordVerifier, 32, 120);
  if (!validEmail(email) || !verifier) return json({ error: 'E-Mail oder Passwort ist falsch.' }, 401);

  const user = await env.DB.prepare(`
    SELECT id, tenant_id, email, password_hash, role
    FROM users
    WHERE email = ?
  `).bind(email).first();

  if (!user || !constantEqual(verifier, user.password_hash)) {
    return json({ error: 'E-Mail oder Passwort ist falsch.' }, 401);
  }

  const token = await createSession(env, user.id, user.tenant_id);
  return json(
    { ok: true, user: { email: user.email, role: user.role } },
    200,
    { 'set-cookie': sessionCookie(token) }
  );
}

async function logout(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run().catch(() => {});
  }
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

async function authSession(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ authenticated: false }, 401, { 'set-cookie': clearSessionCookie() });
  return json({
    authenticated: true,
    user: {
      email: session.email,
      role: session.role
    }
  });
}

async function getState(env, tenantId) {
  const [machinesResult, entriesResult, companyResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, name, asset_id, area, manufacturer, model, serial,
             interval_days, last_maintenance, notes, created_at, updated_at
      FROM machines
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).bind(tenantId),
    env.DB.prepare(`
      SELECT id, machine_id, type, title, text, created_at, resolved, resolved_at
      FROM entries
      WHERE tenant_id = ?
      ORDER BY created_at ASC
    `).bind(tenantId),
    env.DB.prepare(`
      SELECT company_name, logo_data_url, header_color, accent_color,
             background_color, setup_completed
      FROM company_settings
      WHERE tenant_id = ?
    `).bind(tenantId)
  ]);

  const machines = (machinesResult.results || []).map(machineFromRow);
  const byId = new Map(machines.map(machine => [machine.id, machine]));

  for (const row of entriesResult.results || []) {
    const machine = byId.get(row.machine_id);
    if (machine) machine.history.push(entryFromRow(row));
  }

  return {
    machines,
    company: companyFromRow((companyResult.results || [])[0])
  };
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

  await env.DB.prepare(`
    INSERT INTO company_settings (
      tenant_id, company_name, logo_data_url, header_color,
      accent_color, background_color, setup_completed, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      company_name = excluded.company_name,
      logo_data_url = excluded.logo_data_url,
      header_color = excluded.header_color,
      accent_color = excluded.accent_color,
      background_color = excluded.background_color,
      setup_completed = 1,
      updated_at = excluded.updated_at
  `).bind(
    tenantId,
    companyName,
    logoDataUrl || null,
    headerColor,
    accentColor,
    backgroundColor,
    now
  ).run();

  return json({
    ok: true,
    company: {
      companyName,
      logoDataUrl: logoDataUrl || '',
      headerColor,
      accentColor,
      backgroundColor,
      setupCompleted: true
    }
  });
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

  await env.DB.prepare(`
    INSERT INTO machines (
      id, tenant_id, name, asset_id, area, manufacturer, model, serial,
      interval_days, last_maintenance, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      asset_id = excluded.asset_id,
      area = excluded.area,
      manufacturer = excluded.manufacturer,
      model = excluded.model,
      serial = excluded.serial,
      interval_days = excluded.interval_days,
      last_maintenance = excluded.last_maintenance,
      notes = excluded.notes,
      updated_at = excluded.updated_at
    WHERE machines.tenant_id = excluded.tenant_id
  `).bind(
    machineId,
    tenantId,
    name,
    cleanText(body.assetId, 120),
    cleanText(body.area, 160),
    cleanText(body.manufacturer, 160),
    cleanText(body.model, 160),
    cleanText(body.serial, 160),
    interval,
    cleanDate(body.lastMaintenance) || null,
    cleanText(body.notes, 5000),
    createdAt,
    now
  ).run();

  return json({ ok: true, id: machineId });
}

async function addEntry(request, env, tenantId, machineId) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);

  const id = cleanText(body.id, 100);
  const type = cleanText(body.type, 30);
  const allowedTypes = new Set(['fault', 'maintenance', 'note']);
  if (!id || !allowedTypes.has(type)) return json({ error: 'Ungültiger Eintrag.' }, 400);

  const machine = await env.DB.prepare(
    'SELECT id FROM machines WHERE id = ? AND tenant_id = ?'
  ).bind(machineId, tenantId).first();
  if (!machine) return json({ error: 'Maschine nicht gefunden.' }, 404);

  const existingEntry = await env.DB.prepare('SELECT tenant_id FROM entries WHERE id = ?').bind(id).first();
  if (existingEntry && existingEntry.tenant_id !== tenantId) return json({ error: 'Eintrag konnte nicht gespeichert werden.' }, 409);

  const createdAt = cleanText(body.createdAt, 40) || new Date().toISOString();
  const title = cleanText(body.title, 220) || (type === 'note' ? 'Notiz' : 'Eintrag');
  const resolved = body.resolved ? 1 : 0;
  const resolvedAt = resolved ? (cleanText(body.resolvedAt, 40) || new Date().toISOString()) : null;

  const statements = [
    env.DB.prepare(`
      INSERT INTO entries (
        id, tenant_id, machine_id, type, title, text, created_at, resolved, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).bind(
      id,
      tenantId,
      machineId,
      type,
      title,
      cleanText(body.text, 10000),
      createdAt,
      resolved,
      resolvedAt
    )
  ];

  if (type === 'maintenance') {
    const maintenanceDate = cleanDate(body.date) || createdAt.slice(0, 10);
    statements.push(
      env.DB.prepare(`
        UPDATE machines
        SET last_maintenance = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(maintenanceDate, new Date().toISOString(), machineId, tenantId)
    );
  }

  await env.DB.batch(statements);
  return json({ ok: true, id });
}

async function resolveEntry(env, tenantId, machineId, entryId) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE entries
    SET resolved = 1, resolved_at = ?
    WHERE id = ? AND machine_id = ? AND tenant_id = ? AND type = 'fault'
  `).bind(now, entryId, machineId, tenantId).run();

  if (!result.meta?.changes) return json({ error: 'Störung nicht gefunden.' }, 404);
  return json({ ok: true, resolvedAt: now });
}

async function handleApi(request, env, url) {
  await ensureSchema(env);

  if (request.method === 'GET' && url.pathname === '/api/auth/salt') {
    return json({ salt: await getPasswordSalt(env, url.searchParams.get('email') || '') });
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/register') return register(request, env);
  if (request.method === 'POST' && url.pathname === '/api/auth/login') return login(request, env);
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') return logout(request, env);
  if (request.method === 'GET' && url.pathname === '/api/auth/session') return authSession(request, env);

  const session = await getSession(request, env);
  if (!session) return json({ error: 'Nicht angemeldet.' }, 401, { 'set-cookie': clearSessionCookie() });
  const tenantId = session.tenantId;

  if (request.method === 'GET' && url.pathname === '/api/state') {
    return json(await getState(env, tenantId));
  }

  if (request.method === 'PUT' && url.pathname === '/api/company') {
    return saveCompany(request, env, tenantId);
  }

  const machineMatch = url.pathname.match(/^\/api\/machines\/([^/]+)$/);
  if (machineMatch && request.method === 'PUT') {
    return upsertMachine(request, env, tenantId, decodeURIComponent(machineMatch[1]));
  }

  const entriesMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/entries$/);
  if (entriesMatch && request.method === 'POST') {
    return addEntry(request, env, tenantId, decodeURIComponent(entriesMatch[1]));
  }

  const resolveMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/entries\/([^/]+)\/resolve$/);
  if (resolveMatch && request.method === 'PATCH') {
    return resolveEntry(
      env,
      tenantId,
      decodeURIComponent(resolveMatch[1]),
      decodeURIComponent(resolveMatch[2])
    );
  }

  return json({ error: 'API-Endpunkt nicht gefunden.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        console.error('QRPass API error', error);
        return json({ error: 'Serverfehler. Bitte erneut versuchen.' }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};