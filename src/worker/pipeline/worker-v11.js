import baseWorker from './worker-v10.js';

const VERSION = '1.1.0';
let inspectionSchemaPromise;

const ASSET_TYPES = new Set([
  'machine', 'inspection_system', 'ladder', 'forklift', 'crane',
  'lifting_equipment', 'lifting_accessory', 'other'
]);
const INSPECTION_RESULTS = new Set(['passed', 'defect', 'failed']);
const INSPECTION_KINDS = new Set(['recurring', 'initial', 'extraordinary', 'other']);

function securityHeaders(headers = new Headers()) {
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set(
    'content-security-policy',
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
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

function replaceJson(response, data) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers: securityHeaders(headers)
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
      SELECT display_name, active
      FROM employees
      WHERE id = ? AND tenant_id = ?
    `).bind(row.actor_id, row.tenant_id).first();
    if (!employee || !employee.active) return null;
    row.label = employee.display_name;
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
      const message = String(error?.message || '').toLowerCase();
      if (!message.includes('duplicate column')) throw error;
    }
  }
}

async function ensureInspectionSchema(env) {
  if (!inspectionSchemaPromise) {
    inspectionSchemaPromise = (async () => {
      await ensureColumns(env, 'machines', [
        ['asset_type', "TEXT NOT NULL DEFAULT 'machine'"],
        ['inspection_enabled', 'INTEGER NOT NULL DEFAULT 0'],
        ['inspection_interval_days', 'INTEGER'],
        ['last_inspection', 'TEXT'],
        ['next_inspection', 'TEXT']
      ]);
      await ensureColumns(env, 'entries', [
        ['actor_id', 'TEXT'],
        ['actor_label', 'TEXT'],
        ['actor_role', 'TEXT'],
        ['inspection_kind', 'TEXT'],
        ['inspection_result', 'TEXT'],
        ['inspection_date', 'TEXT'],
        ['next_inspection', 'TEXT'],
        ['inspector_name', 'TEXT']
      ]);
      await env.DB.prepare(
        'CREATE INDEX IF NOT EXISTS idx_machines_inspection_due ON machines(tenant_id, inspection_enabled, next_inspection)'
      ).run();
      await env.DB.prepare(
        "CREATE INDEX IF NOT EXISTS idx_entries_inspection ON entries(tenant_id, machine_id, type, inspection_date)"
      ).run();
    })().catch(error => {
      inspectionSchemaPromise = null;
      throw error;
    });
  }
  return inspectionSchemaPromise;
}

function machineMatch(pathname) {
  return pathname.match(/^\/api\/machines\/([^/]+)$/);
}

function entryCollectionMatch(pathname) {
  return pathname.match(/^\/api\/machines\/([^/]+)\/entries$/);
}

function entryMatch(pathname) {
  return pathname.match(/^\/api\/machines\/([^/]+)\/entries\/([^/]+)$/);
}

function resultLabel(result) {
  if (result === 'passed') return 'Ohne Mangel';
  if (result === 'defect') return 'Mangel festgestellt';
  return 'Außer Betrieb';
}

async function attachMachineFields(requestCopy, env, actor, machineId, response) {
  if (!response.ok || !actor || actor.role !== 'admin') return response;
  const body = await requestCopy.json().catch(() => null);
  if (!body) return response;
  await ensureInspectionSchema(env);

  const assetType = ASSET_TYPES.has(cleanText(body.assetType, 40))
    ? cleanText(body.assetType, 40)
    : 'machine';
  const inspectionEnabled = body.inspectionEnabled === true || String(body.inspectionEnabled) === '1';
  const intervalRaw = Number(body.inspectionInterval);
  const interval = Number.isFinite(intervalRaw) && intervalRaw > 0
    ? Math.max(1, Math.min(36500, Math.round(intervalRaw)))
    : null;
  const lastInspection = inspectionEnabled ? (cleanDate(body.lastInspection) || null) : null;
  let nextInspection = inspectionEnabled ? (cleanDate(body.nextInspection) || null) : null;

  if (inspectionEnabled && !nextInspection && lastInspection && interval) {
    const d = new Date(`${lastInspection}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + interval);
    nextInspection = d.toISOString().slice(0, 10);
  }

  await env.DB.prepare(`
    UPDATE machines
    SET asset_type = ?, inspection_enabled = ?, inspection_interval_days = ?,
        last_inspection = ?, next_inspection = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    assetType,
    inspectionEnabled ? 1 : 0,
    inspectionEnabled ? interval : null,
    lastInspection,
    nextInspection,
    machineId,
    actor.tenantId
  ).run();

  return response;
}

async function addInspection(request, env, actor, machineId) {
  if (!actor) return json({ error: 'Nicht angemeldet.' }, 401);
  await ensureInspectionSchema(env);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Ungültige Prüfdaten.' }, 400);

  const id = cleanText(body.id, 100);
  const date = cleanDate(body.date);
  const nextInspection = cleanDate(body.nextInspection);
  const inspector = cleanText(body.inspector, 160);
  const result = cleanText(body.result, 30);
  const kind = cleanText(body.inspectionKind, 30);
  const text = cleanText(body.text, 10000);

  if (!id || !date || !nextInspection || !inspector || !INSPECTION_RESULTS.has(result) || !INSPECTION_KINDS.has(kind)) {
    return json({ error: 'Bitte Prüfart, Datum, Prüfer, Ergebnis und nächsten Prüftermin vollständig eintragen.' }, 400);
  }

  const machine = await env.DB.prepare(`
    SELECT id FROM machines
    WHERE id = ? AND tenant_id = ? AND COALESCE(archived, 0) = 0
  `).bind(machineId, actor.tenantId).first();
  if (!machine) return json({ error: 'Betriebsmittel nicht gefunden.' }, 404);

  const createdAt = cleanText(body.createdAt, 40) || new Date(`${date}T12:00:00Z`).toISOString();
  const title = `Prüfung · ${resultLabel(result)}`;

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO entries
          (id, tenant_id, machine_id, type, title, text, created_at, resolved, resolved_at,
           actor_id, actor_label, actor_role, inspection_kind, inspection_result,
           inspection_date, next_inspection, inspector_name)
        VALUES (?, ?, ?, 'inspection', ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, actor.tenantId, machineId, title, text, createdAt,
        actor.id, actor.label, actor.role, kind, result, date, nextInspection, inspector
      ),
      env.DB.prepare(`
        UPDATE machines
        SET inspection_enabled = 1, last_inspection = ?, next_inspection = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(date, nextInspection, new Date().toISOString(), machineId, actor.tenantId)
    ]);
  } catch (error) {
    const duplicate = String(error?.message || '').toLowerCase().includes('unique');
    return json({ error: duplicate ? 'Diese Prüfung wurde bereits gespeichert.' : 'Prüfung konnte nicht gespeichert werden.' }, duplicate ? 409 : 500);
  }

  return json({ ok: true, id }, 201);
}

async function deleteInspection(env, actor, machineId, entryId) {
  if (!actor) return json({ error: 'Nicht angemeldet.' }, 401);
  if (actor.role !== 'admin') return json({ error: 'Keine Berechtigung.' }, 403);
  await ensureInspectionSchema(env);

  const entry = await env.DB.prepare(`
    SELECT id, type FROM entries
    WHERE id = ? AND machine_id = ? AND tenant_id = ?
  `).bind(entryId, machineId, actor.tenantId).first();
  if (!entry) return null;
  if (entry.type !== 'inspection') return null;

  await env.DB.prepare(`
    DELETE FROM entries
    WHERE id = ? AND machine_id = ? AND tenant_id = ? AND type = 'inspection'
  `).bind(entryId, machineId, actor.tenantId).run();

  const latest = await env.DB.prepare(`
    SELECT inspection_date, next_inspection
    FROM entries
    WHERE machine_id = ? AND tenant_id = ? AND type = 'inspection'
    ORDER BY inspection_date DESC, created_at DESC
    LIMIT 1
  `).bind(machineId, actor.tenantId).first();

  await env.DB.prepare(`
    UPDATE machines
    SET last_inspection = ?, next_inspection = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    latest?.inspection_date || null,
    latest?.next_inspection || null,
    new Date().toISOString(),
    machineId,
    actor.tenantId
  ).run();

  return json({ ok: true, deletedType: 'inspection' });
}

async function mergeInspectionState(env, actor, baseResponse) {
  if (!baseResponse.ok || !actor) return baseResponse;
  await ensureInspectionSchema(env);

  const state = await baseResponse.json();
  const [machinesResult, entriesResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, asset_type, inspection_enabled, inspection_interval_days,
             last_inspection, next_inspection
      FROM machines WHERE tenant_id = ?
    `).bind(actor.tenantId),
    env.DB.prepare(`
      SELECT id, inspection_kind, inspection_result, inspection_date,
             next_inspection, inspector_name
      FROM entries WHERE tenant_id = ? AND type = 'inspection'
    `).bind(actor.tenantId)
  ]);

  const machineMeta = new Map((machinesResult.results || []).map(row => [row.id, row]));
  const entryMeta = new Map((entriesResult.results || []).map(row => [row.id, row]));

  for (const machine of state.machines || []) {
    const meta = machineMeta.get(machine.id);
    machine.assetType = meta?.asset_type || 'machine';
    machine.inspectionEnabled = Boolean(meta?.inspection_enabled);
    machine.inspectionInterval = meta?.inspection_interval_days ? Number(meta.inspection_interval_days) : null;
    machine.lastInspection = meta?.last_inspection || '';
    machine.nextInspection = meta?.next_inspection || '';

    for (const entry of machine.history || []) {
      if (entry.type !== 'inspection') continue;
      const inspection = entryMeta.get(entry.id);
      entry.inspectionKind = inspection?.inspection_kind || '';
      entry.inspectionResult = inspection?.inspection_result || '';
      entry.inspectionDate = inspection?.inspection_date || '';
      entry.nextInspection = inspection?.next_inspection || '';
      entry.inspectorName = inspection?.inspector_name || '';
    }
  }

  return replaceJson(baseResponse, state);
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

async function exportCsv(env, actor) {
  if (!actor || actor.role !== 'admin') return json({ error: 'Keine Berechtigung.' }, 403);
  await ensureInspectionSchema(env);

  const company = await env.DB.prepare(
    'SELECT company_name FROM company_settings WHERE tenant_id = ?'
  ).bind(actor.tenantId).first();

  const result = await env.DB.prepare(`
    SELECT
      m.name AS machine_name, m.asset_id, m.area, m.manufacturer, m.model, m.serial,
      m.asset_type, m.interval_days, m.last_maintenance,
      m.inspection_enabled, m.inspection_interval_days, m.last_inspection, m.next_inspection AS machine_next_inspection,
      COALESCE(m.archived, 0) AS archived, m.archived_at,
      e.id AS entry_id, e.type AS entry_type, e.title AS entry_title, e.text AS entry_text,
      e.created_at AS entry_created_at, e.actor_label, e.actor_role,
      e.resolved, e.resolved_at, e.resolved_by_label, e.resolved_by_role,
      e.inspection_kind, e.inspection_result, e.inspection_date,
      e.next_inspection AS entry_next_inspection, e.inspector_name
    FROM machines m
    LEFT JOIN entries e ON e.machine_id = m.id AND e.tenant_id = m.tenant_id
    WHERE m.tenant_id = ?
    ORDER BY m.name COLLATE NOCASE ASC, e.created_at ASC
  `).bind(actor.tenantId).all();

  const headers = [
    'Firma','Betriebsmittel','Betriebsmittelart','Anlagennummer','Bereich','Hersteller','Modell','Seriennummer',
    'Archiviert','Archiviert am','Wartungsintervall Tage','Letzte Wartung',
    'Prüfungen aktiv','Prüfintervall Tage','Letzte Prüfung','Nächste Prüfung',
    'Eintragstyp','Titel','Beschreibung','Erstellt am','Erstellt von','Rolle',
    'Prüfart','Prüfer','Prüfergebnis','Prüfdatum','Nächster Prüftermin',
    'Erledigt','Erledigt am','Erledigt von','Erledigt Rolle'
  ];

  const rows = [headers.map(csvCell).join(';')];
  for (const row of result.results || []) {
    rows.push([
      company?.company_name || '', row.machine_name || '', row.asset_type || 'machine', row.asset_id || '',
      row.area || '', row.manufacturer || '', row.model || '', row.serial || '',
      row.archived ? 'Ja' : 'Nein', row.archived_at || '', row.interval_days ?? '', row.last_maintenance || '',
      row.inspection_enabled ? 'Ja' : 'Nein', row.inspection_interval_days ?? '', row.last_inspection || '', row.machine_next_inspection || '',
      row.entry_type || '', row.entry_title || '', row.entry_text || '', row.entry_created_at || '',
      row.actor_label || '', row.actor_role || '', row.inspection_kind || '', row.inspector_name || '',
      row.inspection_result || '', row.inspection_date || '', row.entry_next_inspection || '',
      row.entry_id ? (row.resolved ? 'Ja' : 'Nein') : '', row.resolved_at || '',
      row.resolved_by_label || '', row.resolved_by_role || ''
    ].map(csvCell).join(';'));
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${rows.join('\r\n')}`, {
    status: 200,
    headers: securityHeaders(new Headers({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="qrpass-export-${date}.csv"`,
      'cache-control': 'no-store'
    }))
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, app: 'QRPass', version: VERSION, time: new Date().toISOString() });
    }

    if (!url.pathname.startsWith('/api/')) {
      return baseWorker.fetch(request, env, ctx);
    }

    const actorPromise = currentActor(request, env).catch(() => null);

    if (request.method === 'GET' && url.pathname === '/api/account/export.csv') {
      const actor = await actorPromise;
      return exportCsv(env, actor);
    }

    const collection = entryCollectionMatch(url.pathname);
    if (collection && request.method === 'POST') {
      const copy = request.clone();
      const body = await copy.json().catch(() => null);
      if (body?.type === 'inspection') {
        const actor = await actorPromise;
        return addInspection(request, env, actor, decodeURIComponent(collection[1]));
      }
    }

    const entry = entryMatch(url.pathname);
    if (entry && request.method === 'DELETE') {
      const actor = await actorPromise;
      const handled = await deleteInspection(
        env,
        actor,
        decodeURIComponent(entry[1]),
        decodeURIComponent(entry[2])
      );
      if (handled) return handled;
    }

    const machine = machineMatch(url.pathname);
    if (machine && request.method === 'PUT') {
      const copy = request.clone();
      const response = await baseWorker.fetch(request, env, ctx);
      const actor = await actorPromise;
      return attachMachineFields(copy, env, actor, decodeURIComponent(machine[1]), response);
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      const response = await baseWorker.fetch(request, env, ctx);
      const actor = await actorPromise;
      return mergeInspectionState(env, actor, response);
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
