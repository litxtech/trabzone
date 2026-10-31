const fs = require('node:fs');
const env = fs.readFileSync('.env', 'utf8');
const token = env.split(/\r?\n/).find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN=')).split('=').slice(1).join('=').trim().replace(/^"|"$/g, '');
const uid = '45640e53-dee5-44d4-a5e4-5ce8cd1140c9';
const payloadNew = { name: 'Test Kahve Atolyesi', lat: 41.0019, lng: 39.7169, address: 'Atatürk Bulvarı No 1', phone: '+90 462 000 00 00', website: 'https://example.com', provider: 'osm', external_id: 'node/999999999', category_slug: 'kafe' };
const payloadDup = { name: 'Kafeterya', lat: 41.0018398, lng: 39.7015692, provider: 'osm', external_id: 'node/888888888' };
const sql = `
begin;
set local request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}';
select public.place_import_external('${JSON.stringify(payloadNew)}'::jsonb) as created_result;
select public.place_import_external('${JSON.stringify(payloadDup)}'::jsonb) as dup_result;
select count(*) as imported_left from public.places where external_id = 'node/999999999';
rollback;
`;
(async () => {
  const res = await fetch('https://api.supabase.com/v1/projects/nzvoufcywppavaioirac/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  console.log(res.status, (await res.text()).slice(0, 3000));
})();
