import baseWorker from './worker.js';

let auditSchemaPromise;

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
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT actor_id, tenant_id, role, label
    FROM sessions_v2
    WHERE token_hash = ? AND expires_at > ?
  `).bind(tokenHash, now).first();
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

async function ensureAuditSchema(env) {
  if (!auditSchemaPromise) {
    auditSchemaPromise = (async () => {
      const info = await env.DB.prepare('PRAGMA table_info(entries)').all();
      const names = new Set((info.results || []).map(row => row.name));
      const columns = [
        ['actor_id', 'TEXT'],
        ['actor_label', 'TEXT'],
        ['actor_role', 'TEXT'],
        ['resolved_by_id', 'TEXT'],
        ['resolved_by_label', 'TEXT'],
        ['resolved_by_role', 'TEXT']
      ];

      for (const [name, type] of columns) {
        if (names.has(name)) continue;
        try {
          await env.DB.prepare(`ALTER TABLE entries ADD COLUMN ${name} ${type}`).run();
        } catch (error) {
          const message = String(error?.message || '').toLowerCase();
          if (!message.includes('duplicate column')) throw error;
        }
      }
    })().catch(error => {
      auditSchemaPromise = null;
      throw error;
    });
  }
  return auditSchemaPromise;
}

async function attachEntryActor(env, actor, entryId) {
  if (!actor || !entryId) return;
  await ensureAuditSchema(env);
  await env.DB.prepare(`
    UPDATE entries
    SET actor_id = ?, actor_label = ?, actor_role = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(actor.id, actor.label, actor.role, entryId, actor.tenantId).run();
}

async function attachResolver(env, actor, entryId) {
  if (!actor || !entryId) return;
  await ensureAuditSchema(env);
  await env.DB.prepare(`
    UPDATE entries
    SET resolved_by_id = ?, resolved_by_label = ?, resolved_by_role = ?
    WHERE id = ? AND tenant_id = ? AND type = 'fault'
  `).bind(actor.id, actor.label, actor.role, entryId, actor.tenantId).run();
}

async function mergeAuditIntoState(env, actor, baseResponse) {
  if (!actor || !baseResponse.ok) return baseResponse;
  await ensureAuditSchema(env);

  const state = await baseResponse.json();
  const result = await env.DB.prepare(`
    SELECT id, actor_id, actor_label, actor_role,
           resolved_by_id, resolved_by_label, resolved_by_role
    FROM entries
    WHERE tenant_id = ?
  `).bind(actor.tenantId).all();
  const auditById = new Map((result.results || []).map(row => [row.id, row]));

  for (const machine of state.machines || []) {
    for (const entry of machine.history || []) {
      const audit = auditById.get(entry.id);
      if (!audit) continue;
      entry.actorId = audit.actor_id || '';
      entry.actorLabel = audit.actor_label || '';
      entry.actorRole = audit.actor_role || '';
      entry.resolvedById = audit.resolved_by_id || '';
      entry.resolvedByLabel = audit.resolved_by_label || '';
      entry.resolvedByRole = audit.resolved_by_role || '';
    }
  }

  return json(state, baseResponse.status);
}

function entryPostMatch(pathname) {
  return pathname.match(/^\/api\/machines\/([^/]+)\/entries$/);
}

function resolveMatch(pathname) {
  return pathname.match(/^\/api\/machines\/([^/]+)\/entries\/([^/]+)\/resolve$/);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith('/api/');
    if (!isApi) return baseWorker.fetch(request, env, ctx);

    const actorPromise = currentActor(request, env).catch(() => null);

    if (request.method === 'POST' && entryPostMatch(url.pathname)) {
      const bodyRequest = request.clone();
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;

      const actor = await actorPromise;
      const body = await bodyRequest.json().catch(() => null);
      await attachEntryActor(env, actor, body?.id);
      return response;
    }

    const resolved = resolveMatch(url.pathname);
    if (request.method === 'PATCH' && resolved) {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;

      const actor = await actorPromise;
      await attachResolver(env, actor, decodeURIComponent(resolved[2]));
      return response;
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      const response = await baseWorker.fetch(request, env, ctx);
      const actor = await actorPromise;
      return mergeAuditIntoState(env, actor, response);
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
