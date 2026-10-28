// Applies a UTF-8 SQL migration file to the hosted Supabase project.
// PowerShell pipelines can corrupt Turkish characters, so the SQL is sent
// directly from disk as UTF-8 through the Supabase Management API.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/db-apply.mjs <path-to.sql>');
  process.exit(1);
}

const query = readFileSync(resolve(root, file), 'utf8');
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ query }),
});
const text = await response.text();
if (!response.ok) {
  console.error(`${response.status} ${text}`);
  process.exit(1);
}
console.log(text);
