import baseWorker from './worker-v09.js';

let schemaPromise;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
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
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const accountOrRecovery = url.pathname.startsWith('/api/account') || url.pathname.startsWith('/api/auth/password-reset');

    if (accountOrRecovery) await ensureSchema(env);

    if (request.method === 'GET' && url.pathname === '/api/auth/password-reset/status') {
      return json({ enabled: Boolean(env.RESEND_API_KEY && env.RESET_FROM_EMAIL) });
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
