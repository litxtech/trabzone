const fs = require('node:fs');
const env = fs.readFileSync('.env', 'utf8');
const token = env.split(/\r?\n/).find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN=')).split('=').slice(1).join('=').trim().replace(/^"|"$/g, '');
const uid = '45640e53-dee5-44d4-a5e4-5ce8cd1140c9';
const terms = ['kafe', 'Akcaabat', 'ortahisar', 'balik', 'migros', 'uzungol', 'kahvalti', 'eczane', 'otel', 'hastane', 'camii'];
const cols = terms.map((t, i) => `'${t}' as t${i}, jsonb_array_length(public.explore_search('${t}', 60) -> 'items') as n${i}`).join(',\n  ');
const sql = `
begin;
set local request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}';
select
  ${cols};
rollback;
`;
(async () => {
  const res = await fetch('https://api.supabase.com/v1/projects/nzvoufcywppavaioirac/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  console.log(res.status, (await res.text()).slice(0, 2000));
})();
