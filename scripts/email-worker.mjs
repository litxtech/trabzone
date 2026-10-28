// Transactional e-posta kuyruğunu işleyen sunucu tarafı worker.
// Supabase service role anahtarı ve Resend API anahtarı yalnızca sunucuda kalır.
//
// Kullanım:
//   npm run email:worker          -> sürekli çalışır (varsayılan 30 sn)
//   npm run email:worker -- --once
//   npm run email:worker -- --interval=60
//
// Cron / container / Vercel Cron gibi bir zamanlayıcıdan çalıştırılmalıdır.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  try {
    const content = readFileSync(join(root, '.env'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
        continue;
      }
      const index = trimmed.indexOf('=');
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env yoksa ortam değişkenleri doğrudan kullanılır (container/cron).
  }
}

loadEnv();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? 'Trabzone <destek@trabzoneapp.com>';
const intervalSeconds = Number(
  process.argv.find((arg) => arg.startsWith('--interval='))?.split('=')[1] ?? 30,
);
const once = process.argv.includes('--once');

if (!supabaseUrl || !serviceRoleKey) {
  console.error('EXPO_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY zorunludur.');
  process.exit(1);
}
if (!resendKey) {
  console.error('RESEND_API_KEY zorunludur. E-postalar sağlayıcı yapılandırılmadan gönderilemez.');
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

async function rpc(name, body = {}) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${name}: ${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function render(template, payload, html) {
  return String(template ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
    const raw = payload?.[key];
    const value = raw === null || raw === undefined ? '' : String(raw);
    return html ? escapeHtml(value).replaceAll('\n', '<br />') : value;
  });
}

async function sendWithResend(item) {
  if (!item.subject || (!item.body_html && !item.body_text)) {
    return { skipped: true, error: 'missing_template' };
  }
  const payload = item.payload ?? {};
  const subject = render(item.subject, payload, false);
  const html = item.body_html ? render(item.body_html, payload, true) : undefined;
  const text = item.body_text ? render(item.body_text, payload, false) : undefined;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [item.to_email],
      subject,
      html,
      text,
      headers: { 'X-Entity-Ref-ID': `trabzone-${item.id}` },
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`resend ${response.status}: ${body.slice(0, 300)}`);
  }
  let id = null;
  try {
    id = JSON.parse(body)?.id ?? null;
  } catch {
    // Sağlayıcı yanıtı JSON değilse yalnızca durum kaydedilir.
  }
  return { id };
}

async function processBatch(limit = 20) {
  const items = (await rpc('email_worker_claim', { p_limit: limit })) ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  for (const item of items) {
    try {
      const result = await sendWithResend(item);
      if (result?.skipped) {
        await rpc('email_worker_mark', {
          p_id: item.id,
          p_status: 'skipped',
          p_error: result.error,
          p_provider: 'resend',
        });
      } else {
        await rpc('email_worker_mark', {
          p_id: item.id,
          p_status: 'sent',
          p_provider: 'resend',
          p_provider_message_id: result?.id ?? null,
        });
      }
      console.log(`sent ${item.template_key} -> ${item.to_email}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await rpc('email_worker_mark', {
        p_id: item.id,
        p_status: 'failed',
        p_error: message,
        p_provider: 'resend',
      }).catch((markError) => {
        console.error('mark failed:', markError instanceof Error ? markError.message : markError);
      });
      console.error(`failed ${item.template_key}: ${message}`);
    }
  }

  return items.length;
}

async function run() {
  console.log(`email worker başladı (${once ? 'tek sefer' : `her ${intervalSeconds} sn`}).`);
  do {
    let processed = 0;
    try {
      processed = await processBatch();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    if (once) {
      break;
    }
    if (processed === 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(5, intervalSeconds) * 1000));
    }
  } while (true);
}

void run();
