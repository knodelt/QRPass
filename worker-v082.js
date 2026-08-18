import baseWorker from './worker-v08.js';

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
  return {
    id: row.actor_id,
    tenantId: row.tenant_id,
    role: row.role,
    label: row.label || ''
  };
}

function historyDeleteMatch(pathname) {
  return pathname.match(/^\/api\/machines\/([^/]+)\/entries\/([^/]+)$/);
}

async function deleteHistoryEntry(env, actor, machineId, entryId) {
  if (!actor) return json({ error: 'Nicht angemeldet.' }, 401);
  if (actor.role !== 'admin') return json({ error: 'Keine Berechtigung.' }, 403);

  const entry = await env.DB.prepare(`
    SELECT id, type
    FROM entries
    WHERE id = ? AND machine_id = ? AND tenant_id = ?
  `).bind(entryId, machineId, actor.tenantId).first();

  if (!entry) return json({ error: 'Verlaufseintrag nicht gefunden.' }, 404);
  if (!['fault', 'maintenance', 'note'].includes(entry.type)) {
    return json({ error: 'Dieser Verlaufseintrag kann hier nicht gelöscht werden.' }, 409);
  }

  if (entry.type === 'maintenance') {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        DELETE FROM entries
        WHERE id = ? AND machine_id = ? AND tenant_id = ? AND type = 'maintenance'
      `).bind(entryId, machineId, actor.tenantId),
      env.DB.prepare(`
        UPDATE machines
        SET last_maintenance = (
          SELECT MAX(substr(created_at, 1, 10))
          FROM entries
          WHERE machine_id = ? AND tenant_id = ? AND type = 'maintenance'
        ), updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(machineId, actor.tenantId, now, machineId, actor.tenantId)
    ]);
  } else {
    await env.DB.prepare(`
      DELETE FROM entries
      WHERE id = ? AND machine_id = ? AND tenant_id = ? AND type = ?
    `).bind(entryId, machineId, actor.tenantId, entry.type).run();
  }

  return json({ ok: true, deletedType: entry.type });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const match = historyDeleteMatch(url.pathname);
      if (match && request.method === 'DELETE') {
        const actor = await currentActor(request, env).catch(() => null);
        return deleteHistoryEntry(
          env,
          actor,
          decodeURIComponent(match[1]),
          decodeURIComponent(match[2])
        );
      }
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
