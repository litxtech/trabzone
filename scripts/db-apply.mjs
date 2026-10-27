// Applies supabase/migrations/*.sql through the Supabase Management API.
// Used because `supabase db push` needs the database password, which we do not
// store yet. Every file is applied inside a single transaction by the API.
import { readFileSync, readdirSync } from 'node:fs';
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

const token = process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.');
  process.exit(1);
}

const runQuery = async (query) => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text}`);
  }
  return text;
};

const only = process.argv[2];
const files = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .filter((file) => !only || file.startsWith(only));

for (const file of files) {
  const sql = readFileSync(join(root, 'supabase', 'migrations', file), 'utf8');
  process.stdout.write(`applying ${file}... `);
  try {
    await runQuery(sql);
    console.log('ok');
  } catch (error) {
    console.log('FAILED');
    console.error(error.message);
    process.exit(1);
  }
}
