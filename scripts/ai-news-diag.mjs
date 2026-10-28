// AI Haber Merkezi tanılama: DeepSeek erişimini ve worker sağlığını kontrol eder.
// Gizli değerleri yazdırmaz; yalnızca sonuç özetini gösterir.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const token = env.SUPABASE_ACCESS_TOKEN;
const ref = env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error('missing credentials');
  process.exit(1);
}

const runQuery = async (query) => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return JSON.parse(text);
};

const rows = await runQuery(
  "select decrypted_secret as secret from vault.decrypted_secrets where name = 'ai_news_cron_secret'",
);
const secret = rows[0]?.secret;
if (!secret) {
  console.error('ai_news_cron_secret bulunamadı');
  process.exit(1);
}

const response = await fetch(`https://${ref}.supabase.co/functions/v1/ai-news-worker`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-ai-news-token': secret,
  },
  body: JSON.stringify({ action: 'diagnostics' }),
});
const text = await response.text();
console.log(`${response.status} ${text.slice(0, 4000)}`);
