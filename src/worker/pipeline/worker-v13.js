import baseWorker from './worker-v12.js';

const VERSION = '1.3.0';
const DEFAULT_DAYS_BEFORE = 14;
let reminderSchemaPromise;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer'
    }
  });
}

function cleanText(value, max = 5000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function validEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
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

async function currentAdmin(request, env) {
  const token = parseCookies(request).qrpass_session;
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
    email: row.label || ''
  };
}

async function ensureReminderSchema(env) {
  if (!reminderSchemaPromise) {
    reminderSchemaPromise = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS email_reminder_settings (
        tenant_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        recipient_email TEXT NOT NULL DEFAULT '',
        days_before INTEGER NOT NULL DEFAULT 14,
        include_inspections INTEGER NOT NULL DEFAULT 1,
        include_maintenance INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        last_checked_at TEXT,
        last_sent_at TEXT,
        last_sent_count INTEGER NOT NULL DEFAULT 0
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS email_reminder_log (
        tenant_id TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        reminder_type TEXT NOT NULL,
        due_date TEXT NOT NULL,
        stage TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, machine_id, reminder_type, due_date, stage)
      )`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_email_reminder_log_tenant ON email_reminder_log(tenant_id, sent_at)')
    ]).catch(error => {
      reminderSchemaPromise = null;
      throw error;
    });
  }
  return reminderSchemaPromise;
}

function mailReady(env) {
  return Boolean(env.RESEND_API_KEY && (env.REMINDER_FROM_EMAIL || env.RESET_FROM_EMAIL));
}

function senderAddress(env) {
  return cleanText(env.REMINDER_FROM_EMAIL || env.RESET_FROM_EMAIL, 320);
}

function htmlEscape(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

async function sendMail(env, { to, subject, html }) {
  if (!mailReady(env)) throw new Error('E-Mail-Versand ist noch nicht eingerichtet.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'user-agent': 'QRPass/1.3'
    },
    body: JSON.stringify({
      from: senderAddress(env),
      to: [to],
      subject,
      html
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('QRPass reminder email failed', response.status, detail);
    throw new Error('E-Mail konnte nicht gesendet werden.');
  }
  return response.json().catch(() => ({}));
}

async function getReminderSettings(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);
  await ensureReminderSchema(env);

  const [row, user] = await Promise.all([
    env.DB.prepare('SELECT * FROM email_reminder_settings WHERE tenant_id = ?').bind(admin.tenantId).first(),
    env.DB.prepare('SELECT email FROM users WHERE id = ? AND tenant_id = ?').bind(admin.id, admin.tenantId).first()
  ]);

  return json({
    enabled: Boolean(row?.enabled),
    recipientEmail: row?.recipient_email || user?.email || admin.email || '',
    daysBefore: Number(row?.days_before || DEFAULT_DAYS_BEFORE),
    includeInspections: row ? Boolean(row.include_inspections) : true,
    includeMaintenance: row ? Boolean(row.include_maintenance) : true,
    lastCheckedAt: row?.last_checked_at || '',
    lastSentAt: row?.last_sent_at || '',
    lastSentCount: Number(row?.last_sent_count || 0),
    mailReady: mailReady(env)
  });
}

async function saveReminderSettings(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);
  await ensureReminderSchema(env);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Ungültige Einstellungen.' }, 400);

  const recipientEmail = validEmail(body.recipientEmail);
  if (!recipientEmail) return json({ error: 'Bitte eine gültige E-Mail-Adresse eintragen.' }, 400);

  const daysBefore = Math.max(1, Math.min(90, Math.round(Number(body.daysBefore || DEFAULT_DAYS_BEFORE))));
  const enabled = body.enabled === true;
  const includeInspections = body.includeInspections !== false;
  const includeMaintenance = body.includeMaintenance !== false;

  if (enabled && !mailReady(env)) {
    return json({ error: 'Der E-Mail-Versand ist noch nicht eingerichtet.' }, 503);
  }
  if (!includeInspections && !includeMaintenance) {
    return json({ error: 'Mindestens Prüfungen oder Wartungen auswählen.' }, 400);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO email_reminder_settings (
      tenant_id, enabled, recipient_email, days_before,
      include_inspections, include_maintenance, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      enabled = excluded.enabled,
      recipient_email = excluded.recipient_email,
      days_before = excluded.days_before,
      include_inspections = excluded.include_inspections,
      include_maintenance = excluded.include_maintenance,
      updated_at = excluded.updated_at
  `).bind(
    admin.tenantId,
    enabled ? 1 : 0,
    recipientEmail,
    daysBefore,
    includeInspections ? 1 : 0,
    includeMaintenance ? 1 : 0,
    now
  ).run();

  return json({ ok: true });
}

async function sendTestReminder(request, env) {
  const admin = await currentAdmin(request, env);
  if (!admin) return json({ error: 'Keine Berechtigung.' }, 403);
  await ensureReminderSchema(env);

  const body = await request.json().catch(() => null);
  const recipientEmail = validEmail(body?.recipientEmail);
  if (!recipientEmail) return json({ error: 'Bitte eine gültige E-Mail-Adresse eintragen.' }, 400);
  if (!mailReady(env)) return json({ error: 'Der E-Mail-Versand ist noch nicht eingerichtet.' }, 503);

  await sendMail(env, {
    to: recipientEmail,
    subject: 'QRPass Test – E-Mail-Erinnerungen',
    html: `
      <div style="font-family:Arial,sans-serif;color:#171816;max-width:620px;margin:auto">
        <h2>QRPass E-Mail-Erinnerungen funktionieren</h2>
        <p>Diese Testmail bestätigt, dass QRPass Erinnerungen an fällige Prüfungen und Wartungen senden kann.</p>
        <p style="color:#666">Sie erhalten nur Erinnerungen, wenn tatsächlich ein Termin in den eingestellten Vorwarnzeitraum fällt oder fällig wird.</p>
      </div>`
  });

  return json({ ok: true });
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return isoDate(date);
}

function dayDiff(fromDate, toDate) {
  const from = new Date(`${fromDate}T12:00:00Z`);
  const to = new Date(`${toDate}T12:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function dueText(today, dueDate) {
  const days = dayDiff(today, dueDate);
  if (days < 0) return `${Math.abs(days)} Tag${Math.abs(days) === 1 ? '' : 'e'} überfällig`;
  if (days === 0) return 'heute fällig';
  return `in ${days} Tag${days === 1 ? '' : 'en'} fällig`;
}

function formatGermanDate(dateText) {
  try {
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${dateText}T12:00:00Z`));
  } catch {
    return dateText;
  }
}

async function loadReminderItems(env, setting, today) {
  const cutoff = addDays(today, setting.days_before);
  const items = [];

  if (setting.include_inspections) {
    const result = await env.DB.prepare(`
      SELECT id, name, asset_id, next_inspection AS due_date
      FROM machines
      WHERE tenant_id = ?
        AND COALESCE(archived, 0) = 0
        AND COALESCE(inspection_enabled, 0) = 1
        AND next_inspection IS NOT NULL
        AND TRIM(next_inspection) <> ''
        AND next_inspection <= ?
      ORDER BY next_inspection ASC
    `).bind(setting.tenant_id, cutoff).all();
    for (const row of result.results || []) {
      items.push({
        machineId: row.id,
        name: row.name,
        assetId: row.asset_id || '',
        type: 'inspection',
        typeLabel: 'Prüfung',
        dueDate: row.due_date
      });
    }
  }

  if (setting.include_maintenance) {
    const result = await env.DB.prepare(`
      SELECT id, name, asset_id,
             date(last_maintenance, '+' || interval_days || ' days') AS due_date
      FROM machines
      WHERE tenant_id = ?
        AND COALESCE(archived, 0) = 0
        AND last_maintenance IS NOT NULL
        AND TRIM(last_maintenance) <> ''
        AND interval_days IS NOT NULL
        AND interval_days > 0
        AND date(last_maintenance, '+' || interval_days || ' days') <= ?
      ORDER BY due_date ASC
    `).bind(setting.tenant_id, cutoff).all();
    for (const row of result.results || []) {
      if (!row.due_date) continue;
      items.push({
        machineId: row.id,
        name: row.name,
        assetId: row.asset_id || '',
        type: 'maintenance',
        typeLabel: 'Wartung',
        dueDate: row.due_date
      });
    }
  }

  return items;
}

async function processTenantReminder(env, setting, today) {
  const items = await loadReminderItems(env, setting, today);
  const log = await env.DB.prepare(`
    SELECT machine_id, reminder_type, due_date, stage
    FROM email_reminder_log
    WHERE tenant_id = ?
  `).bind(setting.tenant_id).all();
  const sent = new Set((log.results || []).map(row => `${row.machine_id}|${row.reminder_type}|${row.due_date}|${row.stage}`));

  const pending = [];
  for (const item of items) {
    const stage = item.dueDate <= today ? 'due' : 'advance';
    const key = `${item.machineId}|${item.type}|${item.dueDate}|${stage}`;
    if (sent.has(key)) continue;
    pending.push({ ...item, stage });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE email_reminder_settings SET last_checked_at = ? WHERE tenant_id = ?
  `).bind(now, setting.tenant_id).run();

  if (!pending.length) return 0;

  const overdue = pending.filter(item => item.dueDate <= today).length;
  const upcoming = pending.length - overdue;
  const company = cleanText(setting.company_name || 'Ihr Betrieb', 180);
  const appUrl = cleanText(env.APP_URL || 'https://qrpass.knodelthomas.workers.dev', 500).replace(/\/+$/, '');

  const rows = pending.map(item => {
    const link = `${appUrl}/#machine/${encodeURIComponent(item.machineId)}`;
    return `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #ddd"><strong>${htmlEscape(item.name)}</strong>${item.assetId ? `<br><span style="color:#666">${htmlEscape(item.assetId)}</span>` : ''}</td>
        <td style="padding:10px;border-bottom:1px solid #ddd">${htmlEscape(item.typeLabel)}</td>
        <td style="padding:10px;border-bottom:1px solid #ddd">${htmlEscape(formatGermanDate(item.dueDate))}<br><strong>${htmlEscape(dueText(today, item.dueDate))}</strong></td>
        <td style="padding:10px;border-bottom:1px solid #ddd"><a href="${htmlEscape(link)}">Öffnen</a></td>
      </tr>`;
  }).join('');

  const subjectParts = [];
  if (overdue) subjectParts.push(`${overdue} fällig/überfällig`);
  if (upcoming) subjectParts.push(`${upcoming} bald fällig`);

  await sendMail(env, {
    to: setting.recipient_email,
    subject: `QRPass: ${subjectParts.join(' · ')}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#171816;max-width:760px;margin:auto">
        <h2>QRPass Erinnerungen</h2>
        <p>Für <strong>${htmlEscape(company)}</strong> gibt es neue fällige oder bald fällige Termine.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <thead><tr><th align="left" style="padding:10px;border-bottom:2px solid #111">Betriebsmittel</th><th align="left" style="padding:10px;border-bottom:2px solid #111">Art</th><th align="left" style="padding:10px;border-bottom:2px solid #111">Termin</th><th align="left" style="padding:10px;border-bottom:2px solid #111"></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:20px;color:#666;font-size:12px">QRPass sendet pro Termin maximal eine Vorwarnung und eine weitere Erinnerung bei Fälligkeit. Einstellungen: Firma → Konto & Daten → E-Mail-Erinnerungen.</p>
      </div>`
  });

  const statements = pending.map(item => env.DB.prepare(`
    INSERT OR IGNORE INTO email_reminder_log
      (tenant_id, machine_id, reminder_type, due_date, stage, sent_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(setting.tenant_id, item.machineId, item.type, item.dueDate, item.stage, now));
  statements.push(env.DB.prepare(`
    UPDATE email_reminder_settings
    SET last_sent_at = ?, last_sent_count = ?
    WHERE tenant_id = ?
  `).bind(now, pending.length, setting.tenant_id));
  await env.DB.batch(statements);
  return pending.length;
}

async function runReminderJob(env) {
  await ensureReminderSchema(env);
  if (!mailReady(env)) {
    console.log('QRPass reminders skipped: mail service not configured');
    return;
  }

  const settings = await env.DB.prepare(`
    SELECT s.*, c.company_name
    FROM email_reminder_settings s
    LEFT JOIN company_settings c ON c.tenant_id = s.tenant_id
    WHERE s.enabled = 1
  `).all();

  const today = isoDate(new Date());
  let sentCount = 0;
  for (const setting of settings.results || []) {
    try {
      sentCount += await processTenantReminder(env, setting, today);
    } catch (error) {
      console.error('QRPass reminder job tenant failed', setting.tenant_id, error?.message || error);
    }
  }
  console.log('QRPass reminder job completed', { tenants: (settings.results || []).length, sentCount });
}

async function cleanupReminderData(env, tenantId) {
  await ensureReminderSchema(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_reminder_log WHERE tenant_id = ?').bind(tenantId),
    env.DB.prepare('DELETE FROM email_reminder_settings WHERE tenant_id = ?').bind(tenantId)
  ]);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ ok: true, app: 'QRPass', version: VERSION, reminders: true, time: new Date().toISOString() });
    }

    if (url.pathname === '/api/reminders/settings') {
      if (request.method === 'GET') return getReminderSettings(request, env);
      if (request.method === 'PUT') return saveReminderSettings(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/reminders/test') {
      return sendTestReminder(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/account/delete') {
      const admin = await currentAdmin(request, env).catch(() => null);
      const response = await baseWorker.fetch(request, env, ctx);
      if (response.ok && admin?.tenantId) {
        await cleanupReminderData(env, admin.tenantId).catch(error => console.error('QRPass reminder cleanup failed', error));
      }
      return response;
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    await runReminderJob(env);
  }
};
