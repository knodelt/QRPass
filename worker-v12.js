import baseWorker from './worker-v11.js';

const VERSION = '1.2.0';
const MAX_ROWS = 200;
const ASSET_TYPES = new Set([
  'machine', 'inspection_system', 'ladder', 'forklift', 'crane',
  'lifting_equipment', 'lifting_accessory', 'other'
]);

let schemaPromise;

function securityHeaders(headers = new Headers()) {
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return headers;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders(new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }))
  });
}

function cleanText(value, max = 5000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function cleanDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
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

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function currentActor(request, env) {
  const token = parseCookies(request).qrpass_session;
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT actor_id, tenant_id, role, label
    FROM sessions_v2
    WHERE token_hash = ? AND expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!row) return null;
  if (row.role === 'employee') {
    const employee = await env.DB.prepare(`
      SELECT active FROM employees WHERE id = ? AND tenant_id = ?
    `).bind(row.actor_id, row.tenant_id).first();
    if (!employee?.active) return null;
  }
  return {
    id: row.actor_id,
    tenantId: row.tenant_id,
    role: row.role,
    label: row.label || (row.role === 'admin' ? 'Admin' : 'Mitarbeiter')
  };
}

async function ensureColumns(env, table, columns) {
  const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  const names = new Set((info.results || []).map(row => row.name));
  for (const [name, type] of columns) {
    if (names.has(name)) continue;
    try {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
    } catch (error) {
      if (!String(error?.message || '').toLowerCase().includes('duplicate column')) throw error;
    }
  }
}

async function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureColumns(env, 'machines', [
        ['asset_type', "TEXT NOT NULL DEFAULT 'machine'"],
        ['inspection_enabled', 'INTEGER NOT NULL DEFAULT 0'],
        ['inspection_interval_days', 'INTEGER'],
        ['last_inspection', 'TEXT'],
        ['next_inspection', 'TEXT'],
        ['archived', 'INTEGER NOT NULL DEFAULT 0'],
        ['archived_at', 'TEXT'],
        ['archived_by_id', 'TEXT'],
        ['archived_by_label', 'TEXT'],
        ['archived_by_role', 'TEXT']
      ]);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function positiveInt(value, max = 36500) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(max, Math.round(n)));
}

function truthy(value) {
  if (value === true || value === 1) return true;
  return ['1', 'ja', 'yes', 'true', 'x'].includes(cleanText(value, 12).toLowerCase());
}

function normalizeRow(raw, index) {
  const name = cleanText(raw?.name, 180);
  const assetId = cleanText(raw?.assetId, 120);
  const assetType = ASSET_TYPES.has(cleanText(raw?.assetType, 40))
    ? cleanText(raw.assetType, 40)
    : 'other';
  const interval = positiveInt(raw?.interval) || 90;
  const inspectionInterval = positiveInt(raw?.inspectionInterval);
  const lastMaintenanceRaw = cleanText(raw?.lastMaintenance, 20);
  const lastInspectionRaw = cleanText(raw?.lastInspection, 20);
  const nextInspectionRaw = cleanText(raw?.nextInspection, 20);
  const inspectionEnabled = truthy(raw?.inspectionEnabled) || Boolean(lastInspectionRaw || nextInspectionRaw || inspectionInterval);

  const errors = [];
  if (!name) errors.push('Bezeichnung fehlt');
  if (lastMaintenanceRaw && !cleanDate(lastMaintenanceRaw)) errors.push('Letzte Wartung: Datum muss JJJJ-MM-TT sein');
  if (lastInspectionRaw && !cleanDate(lastInspectionRaw)) errors.push('Letzte Prüfung: Datum muss JJJJ-MM-TT sein');
  if (nextInspectionRaw && !cleanDate(nextInspectionRaw)) errors.push('Nächste Prüfung: Datum muss JJJJ-MM-TT sein');

  return {
    index,
    errors,
    row: {
      name,
      assetId,
      assetType,
      area: cleanText(raw?.area, 160),
      manufacturer: cleanText(raw?.manufacturer, 160),
      model: cleanText(raw?.model, 160),
      serial: cleanText(raw?.serial, 160),
      interval,
      lastMaintenance: cleanDate(lastMaintenanceRaw),
      inspectionEnabled,
      inspectionInterval,
      lastInspection: cleanDate(lastInspectionRaw),
      nextInspection: cleanDate(nextInspectionRaw),
      notes: cleanText(raw?.notes, 5000)
    }
  };
}

async function validateRows(env, actor, rows) {
  await ensureSchema(env);
  const existing = await env.DB.prepare(`
    SELECT asset_id FROM machines
    WHERE tenant_id = ? AND TRIM(COALESCE(asset_id, '')) <> ''
  `).bind(actor.tenantId).all();
  const existingIds = new Set((existing.results || []).map(row => String(row.asset_id).trim().toLowerCase()));
  const seenIds = new Set();
  const accepted = [];
  const issues = [];

  rows.forEach((raw, i) => {
    const normalized = normalizeRow(raw, i);
    const assetKey = normalized.row.assetId.toLowerCase();
    if (assetKey) {
      if (existingIds.has(assetKey)) normalized.errors.push(`Anlagennummer ${normalized.row.assetId} existiert bereits`);
      if (seenIds.has(assetKey)) normalized.errors.push(`Anlagennummer ${normalized.row.assetId} kommt in der Datei mehrfach vor`);
      seenIds.add(assetKey);
    }
    if (normalized.errors.length) {
      issues.push({ row: i + 2, name: normalized.row.name || '', assetId: normalized.row.assetId || '', errors: normalized.errors });
    } else {
      accepted.push(normalized.row);
    }
  });

  return { accepted, issues };
}

async function importRows(request, env, actor) {
  if (!actor) return json({ error: 'Nicht angemeldet.' }, 401);
  if (actor.role !== 'admin') return json({ error: 'Keine Berechtigung.' }, 403);

  const body = await request.json().catch(() => null);
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  const dryRun = body?.dryRun !== false;
  if (!rows) return json({ error: 'Keine Importdaten erhalten.' }, 400);
  if (!rows.length) return json({ error: 'Die CSV-Datei enthält keine Betriebsmittel.' }, 400);
  if (rows.length > MAX_ROWS) return json({ error: `Maximal ${MAX_ROWS} Betriebsmittel pro Import.` }, 400);

  const { accepted, issues } = await validateRows(env, actor, rows);
  if (dryRun) {
    return json({ ok: true, total: rows.length, valid: accepted.length, invalid: issues.length, issues });
  }

  if (!accepted.length) return json({ error: 'Es gibt keine gültigen Zeilen zum Importieren.', issues }, 400);

  const now = new Date().toISOString();
  const statements = accepted.map(row => env.DB.prepare(`
    INSERT INTO machines (
      id, tenant_id, name, asset_id, area, manufacturer, model, serial,
      interval_days, last_maintenance, notes, created_at, updated_at,
      asset_type, inspection_enabled, inspection_interval_days, last_inspection, next_inspection,
      archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).bind(
    `machine_${crypto.randomUUID()}`,
    actor.tenantId,
    row.name,
    row.assetId || null,
    row.area,
    row.manufacturer,
    row.model,
    row.serial,
    row.interval,
    row.lastMaintenance || null,
    row.notes,
    now,
    now,
    row.assetType,
    row.inspectionEnabled ? 1 : 0,
    row.inspectionEnabled ? row.inspectionInterval : null,
    row.inspectionEnabled ? (row.lastInspection || null) : null,
    row.inspectionEnabled ? (row.nextInspection || null) : null
  ));

  await env.DB.batch(statements);
  return json({
    ok: true,
    imported: accepted.length,
    skipped: issues.length,
    issues
  }, 201);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, app: 'QRPass', version: VERSION, time: new Date().toISOString() });
    }

    if (request.method === 'POST' && url.pathname === '/api/account/import') {
      const actor = await currentActor(request, env).catch(() => null);
      return importRows(request, env, actor);
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
