import baseWorker from './worker-v082.js';

const SESSION_COOKIE = 'qrpass_session';
const RESET_MINUTES = 30;
let accountSchemaPromise;

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

function validSecret(value, min = 20, max = 200) {
  const text = cleanText(value, max);
  return text.length >= min && /^[-_A-Za-z0-9]+$/.test(text) ? text : '';
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function ensureAccountSchema(env) {
  if (!accountSchemaPromise) {
    accountSchemaPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      )`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, expires_at)')
    ]).catch(error => {
      accountSchemaPromise = null;
      throw error;
    });
  }
  return accountSchemaPromise;
}

async function currentAdmin(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT actor_id, tenant_id, role, label
    FROM sessions_v2
    WHERE token_hash = ? AND expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!row || row.role !== 'admin') return null;
  return {
    id: row.actor_id,
    tenantId: row.tenant_id,
    role: row.role,
    email: row.label || '',
    tokenHash
  };
}

async function accountInfo(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);

  const [user, access, company] = await Promise.all([
    env.DB.prepare('SELECT email FROM users WHERE id = ? AND tenant_id = ?').bind(admin.id, admin.tenantId).first(),
    env.DB.prepare('SELECT company_code FROM company_access WHERE tenant_id = ?').bind(admin.tenantId).first(),
    env.DB.prepare('SELECT company_name FROM company_settings WHERE tenant_id = ?').bind(admin.tenantId).first()
  ]);

  return json({
    email: user?.email || admin.email,
    companyName: company?.company_name || '',
    companyCode: access?.company_code || '',
    passwordResetMailReady: Boolean(env.RESEND_API_KEY && env.RESET_FROM_EMAIL)
  });
}

async function passwordSalt(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);
  const user = await env.DB.prepare(
    'SELECT password_salt FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(admin.id, admin.tenantId).first();
  if (!user) return json({ error: 'Admin-Konto nicht gefunden.' }, 404);
  return json({ salt: user.password_salt });
}

async function changePassword(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);

  const body = await readJson(request);
  const currentVerifier = validSecret(body?.currentVerifier, 30, 200);
  const newSalt = validSecret(body?.newSalt, 20, 120);
  const newVerifier = validSecret(body?.newVerifier, 30, 200);
  if (!currentVerifier || !newSalt || !newVerifier) {
    return json({ error: 'Passwort konnte nicht sicher verarbeitet werden.' }, 400);
  }

  const user = await env.DB.prepare(`
    SELECT id, password_hash
    FROM users
    WHERE id = ? AND tenant_id = ? AND role = 'admin'
  `).bind(admin.id, admin.tenantId).first();

  if (!user || !constantEqual(currentVerifier, user.password_hash)) {
    return json({ error: 'Das aktuelle Passwort ist falsch.' }, 401);
  }

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(newVerifier, newSalt, admin.id, admin.tenantId),
    env.DB.prepare(`
      DELETE FROM sessions_v2
      WHERE tenant_id = ? AND role = 'admin' AND token_hash <> ?
    `).bind(admin.tenantId, admin.tokenHash),
    env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(admin.id)
  ]);

  return json({ ok: true });
}

async function createUniqueCompanyCode(env) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const bytes = new Uint8Array(7);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
    const exists = await env.DB.prepare(
      'SELECT tenant_id FROM company_access WHERE company_code = ?'
    ).bind(code).first();
    if (!exists) return code;
  }
  throw new Error('Firmen-Code konnte nicht erzeugt werden.');
}

async function rotateCompanyCode(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);
  const code = await createUniqueCompanyCode(env);

  const result = await env.DB.prepare(`
    UPDATE company_access SET company_code = ? WHERE tenant_id = ?
  `).bind(code, admin.tenantId).run();
  if (!result.meta?.changes) return json({ error: 'Firmenzugang nicht gefunden.' }, 404);

  await env.DB.prepare(
    "DELETE FROM sessions_v2 WHERE tenant_id = ? AND role = 'employee'"
  ).bind(admin.tenantId).run();

  return json({ ok: true, companyCode: code, employeesLoggedOut: true });
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

async function exportCsv(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);

  const company = await env.DB.prepare(
    'SELECT company_name FROM company_settings WHERE tenant_id = ?'
  ).bind(admin.tenantId).first();

  const result = await env.DB.prepare(`
    SELECT
      m.id AS machine_id,
      m.name AS machine_name,
      m.asset_id,
      m.area,
      m.manufacturer,
      m.model,
      m.serial,
      m.interval_days,
      m.last_maintenance,
      COALESCE(m.archived, 0) AS archived,
      m.archived_at,
      e.id AS entry_id,
      e.type AS entry_type,
      e.title AS entry_title,
      e.text AS entry_text,
      e.created_at AS entry_created_at,
      e.actor_label,
      e.actor_role,
      e.resolved,
      e.resolved_at,
      e.resolved_by_label,
      e.resolved_by_role
    FROM machines m
    LEFT JOIN entries e
      ON e.machine_id = m.id AND e.tenant_id = m.tenant_id
    WHERE m.tenant_id = ?
    ORDER BY m.name COLLATE NOCASE ASC, e.created_at ASC
  `).bind(admin.tenantId).all();

  const headers = [
    'Firma','Maschine','Anlagennummer','Bereich','Hersteller','Modell','Seriennummer',
    'Archiviert','Archiviert am','Wartungsintervall Tage','Letzte Wartung',
    'Eintragstyp','Titel','Beschreibung','Erstellt am','Erstellt von','Rolle',
    'Erledigt','Erledigt am','Erledigt von','Erledigt Rolle'
  ];

  const rows = [headers.map(csvCell).join(';')];
  for (const row of result.results || []) {
    rows.push([
      company?.company_name || '',
      row.machine_name || '',
      row.asset_id || '',
      row.area || '',
      row.manufacturer || '',
      row.model || '',
      row.serial || '',
      row.archived ? 'Ja' : 'Nein',
      row.archived_at || '',
      row.interval_days ?? '',
      row.last_maintenance || '',
      row.entry_type || '',
      row.entry_title || '',
      row.entry_text || '',
      row.entry_created_at || '',
      row.actor_label || '',
      row.actor_role || '',
      row.entry_id ? (row.resolved ? 'Ja' : 'Nein') : '',
      row.resolved_at || '',
      row.resolved_by_label || '',
      row.resolved_by_role || ''
    ].map(csvCell).join(';'));
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${rows.join('\r\n')}`, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="qrpass-export-${date}.csv"`,
      'cache-control': 'no-store'
    }
  });
}

async function deleteAccount(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);

  const body = await readJson(request);
  if (cleanText(body?.confirmation, 20).toUpperCase() !== 'LÖSCHEN') {
    return json({ error: 'Bitte LÖSCHEN zur Bestätigung eingeben.' }, 400);
  }
  const currentVerifier = validSecret(body?.currentVerifier, 30, 200);
  if (!currentVerifier) return json({ error: 'Passwort fehlt.' }, 400);

  const user = await env.DB.prepare(`
    SELECT password_hash
    FROM users
    WHERE id = ? AND tenant_id = ? AND role = 'admin'
  `).bind(admin.id, admin.tenantId).first();
  if (!user || !constantEqual(currentVerifier, user.password_hash)) {
    return json({ error: 'Das aktuelle Passwort ist falsch.' }, 401);
  }

  await ensureAccountSchema(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_resets WHERE tenant_id = ?').bind(admin.tenantId),
    env.DB.prepare('DELETE FROM entries WHERE tenant_id = ?').bind(admin.tenantId),
    env.DB.prepare('DELETE FROM machines WHERE tenant_id = ?').bind(admin.tenantId),
    env.DB.prepare('DELETE FROM employees WHERE tenant_id = ?').bind(admin.tenantId),
    env.DB.prepare('DELETE FROM company_access WHERE tenant_id = ?').bind(admin.tenantId),
    env.DB.prepare('DELETE FROM company_settings WHERE tenant_id = ?').bind(admin.tenantId),
    env.DB.prepare('DELETE FROM sessions_v2 WHERE tenant_id = ?').bind(admin.tenantId),
    env.DB.prepare('DELETE FROM users WHERE tenant_id = ?').bind(admin.tenantId),
    env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(admin.tenantId)
  ]);

  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

async function sendResetMail(env, to, resetUrl) {
  if (!env.RESEND_API_KEY || !env.RESET_FROM_EMAIL) return false;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'user-agent': 'QRPass/0.9'
    },
    body: JSON.stringify({
      from: env.RESET_FROM_EMAIL,
      to: [to],
      subject: 'QRPass Passwort zurücksetzen',
      html: `<p>Für Ihr QRPass-Konto wurde eine Passwort-Zurücksetzung angefordert.</p><p><a href="${resetUrl}">Passwort jetzt zurücksetzen</a></p><p>Der Link ist ${RESET_MINUTES} Minuten gültig.</p><p>Falls Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.</p>`
    })
  });

  if (!response.ok) {
    console.error('QRPass reset mail failed', response.status, await response.text().catch(() => ''));
    return false;
  }
  return true;
}

async function requestPasswordReset(request, env) {
  await ensureAccountSchema(env);
  const body = await readJson(request);
  const email = normalizeEmail(body?.email);
  const mailConfigured = Boolean(env.RESEND_API_KEY && env.RESET_FROM_EMAIL);

  if (!validEmail(email)) {
    return json({ ok: true, mailConfigured });
  }

  const user = await env.DB.prepare(`
    SELECT id, tenant_id, email FROM users WHERE email = ? AND role = 'admin'
  `).bind(email).first();

  if (!user) return json({ ok: true, mailConfigured });

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + RESET_MINUTES * 60000);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').bind(user.id),
    env.DB.prepare(`
      INSERT INTO password_resets (token_hash, user_id, tenant_id, created_at, expires_at, used_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `).bind(tokenHash, user.id, user.tenant_id, createdAt.toISOString(), expiresAt.toISOString())
  ]);

  if (mailConfigured) {
    const url = new URL(request.url);
    const resetUrl = `${url.origin}${url.pathname.startsWith('/api/') ? '/' : url.pathname}?reset=${encodeURIComponent(token)}`;
    await sendResetMail(env, user.email, resetUrl);
  }

  return json({ ok: true, mailConfigured });
}

async function validateResetToken(request, env, url) {
  await ensureAccountSchema(env);
  const token = cleanText(url.searchParams.get('token'), 200);
  if (!token) return json({ valid: false }, 400);
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT token_hash FROM password_resets
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  return row ? json({ valid: true }) : json({ valid: false }, 410);
}

async function completePasswordReset(request, env) {
  await ensureAccountSchema(env);
  const body = await readJson(request);
  const token = cleanText(body?.token, 200);
  const newSalt = validSecret(body?.newSalt, 20, 120);
  const newVerifier = validSecret(body?.newVerifier, 30, 200);
  if (!token || !newSalt || !newVerifier) return json({ error: 'Ungültige Reset-Daten.' }, 400);

  const tokenHash = await sha256(token);
  const reset = await env.DB.prepare(`
    SELECT token_hash, user_id, tenant_id
    FROM password_resets
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!reset) return json({ error: 'Der Reset-Link ist ungültig oder abgelaufen.' }, 410);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(newVerifier, newSalt, reset.user_id, reset.tenant_id),
    env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').bind(now, tokenHash),
    env.DB.prepare("DELETE FROM sessions_v2 WHERE tenant_id = ? AND role = 'admin'").bind(reset.tenant_id)
  ]);

  return json({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'POST' && url.pathname === '/api/auth/password-reset/request') {
        return requestPasswordReset(request, env);
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/password-reset/validate') {
        return validateResetToken(request, env, url);
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/password-reset/complete') {
        return completePasswordReset(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/account') return accountInfo(request, env);
      if (request.method === 'GET' && url.pathname === '/api/account/password-salt') return passwordSalt(request, env);
      if (request.method === 'POST' && url.pathname === '/api/account/password') return changePassword(request, env);
      if (request.method === 'POST' && url.pathname === '/api/account/company-code') return rotateCompanyCode(request, env);
      if (request.method === 'GET' && url.pathname === '/api/account/export.csv') return exportCsv(request, env);
      if (request.method === 'POST' && url.pathname === '/api/account/delete') return deleteAccount(request, env);
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
