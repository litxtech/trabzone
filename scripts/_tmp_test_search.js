const fs = require('node:fs');
const env = fs.readFileSync('.env', 'utf8');
const token = env.split(/\r?\n/).find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN=')).split('=').slice(1).join('=').trim().replace(/^"|"$/g, '');
const uid = '45640e53-dee5-44d4-a5e4-5ce8cd1140c9';
const queries = [
  ['kafe', 5],
  ['Akcaabat', 5],
  ['ortahisar', 5],
  ['balik', 5],
  ['migros', 5],
  ['uzungol', 5],
  ['kahvalti', 5],
];
const sql = `
begin;
set local request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}';
${queries
  .map(
    ([q, lim], i) =>
      `select ${i} as idx, '${q}' as q, jsonb_array_length(public.explore_search('${q}', ${lim}) -> 'items') as n;`,
  )
  .join('\n')}
select public.explore_search('kafe', 3) as sample;
rollback;
`;
(async () => {
  const res = await fetch('https://api.supabase.com/v1/projects/nzvoufcywppavaioirac/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  console.log(res.status, text.slice(0, 4000));
})();
