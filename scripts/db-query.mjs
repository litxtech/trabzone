// Runs a single ad-hoc SQL query through the Supabase Management API.
// Usage: node scripts/db-query.mjs "select 1"
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

const token = process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF;
const sql = process.argv.slice(2).join(' ');

if (!token || !ref || !sql) {
  console.error('SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF and a SQL argument are required.');
  process.exit(1);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});

const text = await response.text();
if (!response.ok) {
  console.error(`${response.status} ${text}`);
  process.exit(1);
}
console.log(text);
