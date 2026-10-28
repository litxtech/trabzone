// One-off verification: every RPC used by the client exists on the hosted DB.
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

const runQuery = async (query) => {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text}`);
  }
  return JSON.parse(text);
};

const rows = await runQuery(
  "select proname from pg_proc where pronamespace = 'public'::regnamespace",
);
const names = new Set(rows.map((row) => row.proname));

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
};
walk(join(root, 'src'));

const used = new Map();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\.rpc\(\s*'([a-zA-Z0-9_]+)'/g)) {
    if (!used.has(match[1])) {
      used.set(match[1], file);
    }
  }
}

const missing = [...used.entries()].filter(([name]) => !names.has(name));
console.log(`functions=${names.size} client_rpcs=${used.size}`);
console.log(missing.length === 0 ? 'MISSING=none' : 'MISSING=' + missing.map(([n, f]) => `${n} (${f})`).join(', '));
