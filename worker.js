const TENANT_ID = 'default';
let schemaPromise;

const DEFAULT_COMPANY = {
  companyName: '',
  logoDataUrl: '',
  headerColor: '#181916',
  accentColor: '#f0c400',
  backgroundColor: '#e9e7df',
  setupCompleted: false
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
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

async function getState(env) {
  const [machinesResult, entriesResult, companyResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT id, name, asset_id, area, manufacturer, model, serial,
             interval_days, last_maintenance, notes, created_at, updated_at
      FROM machines
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).bind(TENANT_ID),
    env.DB.prepare(`
      SELECT id, machine_id, type, title, text, created_at, resolved, resolved_at
      FROM entries
      WHERE tenant_id = ?
      ORDER BY created_at ASC
    `).bind(TENANT_ID),
    env.DB.prepare(`
      SELECT company_name, logo_data_url, header_color, accent_color,
             background_color, setup_completed
      FROM company_settings
      WHERE tenant_id = ?
    `).bind(TENANT_ID)
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

async function saveCompany(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Firmendaten.' }, 400);

  const companyName = cleanText(body.companyName, 180);
  if (!companyName) return json({ error: 'Firmenname fehlt.' }, 400);

  const logoDataUrl = cleanLogo(body.logoDataUrl);
  if (logoDataUrl === null) return json({ error: 'Das Logo muss eine PNG-Datei sein.' }, 400);

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
    TENANT_ID,
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

async function upsertMachine(request, env, id) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);

  const machineId = cleanText(id || body.id, 100);
  const name = cleanText(body.name, 180);
  if (!machineId || !name) return json({ error: 'Name der Maschine fehlt.' }, 400);

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
    TENANT_ID,
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

async function addEntry(request, env, machineId) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Ungültige Daten.' }, 400);

  const id = cleanText(body.id, 100);
  const type = cleanText(body.type, 30);
  const allowedTypes = new Set(['fault', 'maintenance', 'note']);
  if (!id || !allowedTypes.has(type)) return json({ error: 'Ungültiger Eintrag.' }, 400);

  const machine = await env.DB.prepare(
    'SELECT id FROM machines WHERE id = ? AND tenant_id = ?'
  ).bind(machineId, TENANT_ID).first();
  if (!machine) return json({ error: 'Maschine nicht gefunden.' }, 404);

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
      TENANT_ID,
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
      `).bind(maintenanceDate, new Date().toISOString(), machineId, TENANT_ID)
    );
  }

  await env.DB.batch(statements);
  return json({ ok: true, id });
}

async function resolveEntry(env, machineId, entryId) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE entries
    SET resolved = 1, resolved_at = ?
    WHERE id = ? AND machine_id = ? AND tenant_id = ? AND type = 'fault'
  `).bind(now, entryId, machineId, TENANT_ID).run();

  if (!result.meta?.changes) return json({ error: 'Störung nicht gefunden.' }, 404);
  return json({ ok: true, resolvedAt: now });
}

async function handleApi(request, env, url) {
  await ensureSchema(env);

  if (request.method === 'GET' && url.pathname === '/api/state') {
    return json(await getState(env));
  }

  if (request.method === 'PUT' && url.pathname === '/api/company') {
    return saveCompany(request, env);
  }

  const machineMatch = url.pathname.match(/^\/api\/machines\/([^/]+)$/);
  if (machineMatch && request.method === 'PUT') {
    return upsertMachine(request, env, decodeURIComponent(machineMatch[1]));
  }

  const entriesMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/entries$/);
  if (entriesMatch && request.method === 'POST') {
    return addEntry(request, env, decodeURIComponent(entriesMatch[1]));
  }

  const resolveMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/entries\/([^/]+)\/resolve$/);
  if (resolveMatch && request.method === 'PATCH') {
    return resolveEntry(
      env,
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
        return json({ error: 'Datenbankfehler. Bitte erneut versuchen.' }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};