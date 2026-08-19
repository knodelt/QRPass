import baseWorker from './worker-v07.js';

let archiveSchemaPromise;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
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

function requireAdmin(actor) {
  return actor?.role === 'admin' ? null : json({ error: 'Keine Berechtigung.' }, 403);
}

async function ensureArchiveSchema(env) {
  if (!archiveSchemaPromise) {
    archiveSchemaPromise = (async () => {
      const info = await env.DB.prepare('PRAGMA table_info(machines)').all();
      const names = new Set((info.results || []).map(row => row.name));
      const columns = [
        ['archived', 'INTEGER NOT NULL DEFAULT 0'],
        ['archived_at', 'TEXT'],
        ['archived_by_id', 'TEXT'],
        ['archived_by_label', 'TEXT'],
        ['archived_by_role', 'TEXT']
      ];

      for (const [name, type] of columns) {
        if (names.has(name)) continue;
        try {
          await env.DB.prepare(`ALTER TABLE machines ADD COLUMN ${name} ${type}`).run();
        } catch (error) {
          const message = String(error?.message || '').toLowerCase();
          if (!message.includes('duplicate column')) throw error;
        }
      }

      await env.DB.prepare(
        'CREATE INDEX IF NOT EXISTS idx_machines_archive ON machines(tenant_id, archived, updated_at)'
      ).run();
    })().catch(error => {
      archiveSchemaPromise = null;
      throw error;
    });
  }
  return archiveSchemaPromise;
}

async function filterArchivedFromState(env, actor, baseResponse) {
  if (!baseResponse.ok || !actor) return baseResponse;
  await ensureArchiveSchema(env);

  const state = await baseResponse.json();
  const result = await env.DB.prepare(`
    SELECT id
    FROM machines
    WHERE tenant_id = ? AND archived = 1
  `).bind(actor.tenantId).all();

  const archivedIds = new Set((result.results || []).map(row => row.id));
  state.machines = (state.machines || []).filter(machine => !archivedIds.has(machine.id));
  state.archiveCount = archivedIds.size;
  return json(state, baseResponse.status);
}

async function listArchived(env, actor) {
  const denied = requireAdmin(actor);
  if (denied) return denied;
  await ensureArchiveSchema(env);

  const result = await env.DB.prepare(`
    SELECT id, name, asset_id, area, archived_at, archived_by_label, archived_by_role
    FROM machines
    WHERE tenant_id = ? AND archived = 1
    ORDER BY archived_at DESC, name COLLATE NOCASE ASC
  `).bind(actor.tenantId).all();

  return json({
    machines: (result.results || []).map(row => ({
      id: row.id,
      name: row.name,
      assetId: row.asset_id || '',
      area: row.area || '',
      archivedAt: row.archived_at || '',
      archivedByLabel: row.archived_by_label || '',
      archivedByRole: row.archived_by_role || ''
    }))
  });
}

async function setArchived(request, env, actor, machineId) {
  const denied = requireAdmin(actor);
  if (denied) return denied;
  await ensureArchiveSchema(env);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.archived !== 'boolean') {
    return json({ error: 'Ungültige Archiv-Aktion.' }, 400);
  }

  const now = new Date().toISOString();
  let result;

  if (body.archived) {
    result = await env.DB.prepare(`
      UPDATE machines
      SET archived = 1,
          archived_at = ?,
          archived_by_id = ?,
          archived_by_label = ?,
          archived_by_role = ?,
          updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(
      now,
      actor.id,
      actor.label,
      actor.role,
      now,
      machineId,
      actor.tenantId
    ).run();
  } else {
    result = await env.DB.prepare(`
      UPDATE machines
      SET archived = 0,
          archived_at = NULL,
          archived_by_id = NULL,
          archived_by_label = NULL,
          archived_by_role = NULL,
          updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(now, machineId, actor.tenantId).run();
  }

  if (!result.meta?.changes) return json({ error: 'Maschine nicht gefunden.' }, 404);
  return json({ ok: true, archived: body.archived });
}

async function deleteMachinePermanently(env, actor, machineId) {
  const denied = requireAdmin(actor);
  if (denied) return denied;
  await ensureArchiveSchema(env);

  const machine = await env.DB.prepare(`
    SELECT id, archived
    FROM machines
    WHERE id = ? AND tenant_id = ?
  `).bind(machineId, actor.tenantId).first();

  if (!machine) return json({ error: 'Maschine nicht gefunden.' }, 404);
  if (!machine.archived) {
    return json({ error: 'Maschine muss zuerst archiviert werden.' }, 409);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM entries WHERE machine_id = ? AND tenant_id = ?')
      .bind(machineId, actor.tenantId),
    env.DB.prepare('DELETE FROM machines WHERE id = ? AND tenant_id = ?')
      .bind(machineId, actor.tenantId)
  ]);

  return json({ ok: true });
}

function archiveMatch(pathname) {
  return pathname.match(/^\/api\/machines\/([^/]+)\/archive$/);
}

function machineMatch(pathname) {
  return pathname.match(/^\/api\/machines\/([^/]+)$/);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return baseWorker.fetch(request, env, ctx);
    }

    const actorPromise = currentActor(request, env).catch(() => null);

    if (request.method === 'GET' && url.pathname === '/api/archive') {
      const actor = await actorPromise;
      return listArchived(env, actor);
    }

    const archived = archiveMatch(url.pathname);
    if (archived && request.method === 'PATCH') {
      const actor = await actorPromise;
      return setArchived(request, env, actor, decodeURIComponent(archived[1]));
    }

    const machine = machineMatch(url.pathname);
    if (machine && request.method === 'DELETE') {
      const actor = await actorPromise;
      return deleteMachinePermanently(env, actor, decodeURIComponent(machine[1]));
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const actor = await actorPromise;
      return filterArchivedFromState(env, actor, response);
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
