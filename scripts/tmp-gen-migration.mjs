// 0106 migration'ını üretir: yayınlama fonksiyonunda "record IS NOT NULL"
// tuzağını giderir ve kayıt varlığını `FOUND` ile izler.
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('supabase/migrations/0097_ai_news_publishing_web.sql', 'utf8');
const start = source.indexOf('create or replace function public.ai_news_publish_event(');
if (start < 0) throw new Error('function not found');
const endMarker = '\n$$;';
const end = source.indexOf(endMarker, start);
if (end < 0) throw new Error('function end not found');
let block = source.slice(start, end + endMarker.length);

const replacements = [
  ['  v_publisher uuid;', '  v_publisher public.profiles%rowtype;\n  v_draft_found boolean := false;\n  v_publisher_found boolean := false;\n  v_media_found boolean := false;\n  v_license_found boolean := false;'],
  [
    '  select * into v_draft from public.ai_news_drafts\n  where event_id = p_event_id and is_current\n  order by version desc limit 1;\n\n  if v_draft.id is null then',
    '  select * into v_draft from public.ai_news_drafts\n  where event_id = p_event_id and is_current\n  order by version desc limit 1;\n  v_draft_found := found;\n\n  if not v_draft_found then',
  ],
  [
    '  select * into v_publisher from public.profiles\n  where id = coalesce(\n    v_settings.publisher_user_id,\n    (select p.id from public.profiles p where p.username = v_settings.publisher_username)\n  );\n\n  if v_publisher.id is null then',
    '  select * into v_publisher from public.profiles\n  where id = coalesce(\n    v_settings.publisher_user_id,\n    (select p.id from public.profiles p where p.username = v_settings.publisher_username)\n  );\n  v_publisher_found := found;\n\n  if not v_publisher_found then',
  ],
  [
    '  limit 1;\n\n  if v_media.id is not null then\n    select * into v_license from public.ai_news_media_licenses where code = v_media.license_code;\n\n    if not v_media.is_placeholder then\n      if v_license.id is null or not v_license.is_usable or not v_license.commercial_use then',
    '  limit 1;\n  v_media_found := found;\n\n  if v_media_found then\n    select * into v_license from public.ai_news_media_licenses where code = v_media.license_code;\n    v_license_found := found;\n\n    if not v_media.is_placeholder then\n      if not v_license_found or not v_license.is_usable or not v_license.commercial_use then',
  ],
  ['    v_category.name_tr, v_sources, v_placeholder', "    coalesce(v_category.name_tr, 'Haber'), v_sources, v_placeholder"],
  [
    '  if v_media.id is not null then\n    insert into public.post_media (',
    '  if v_media_found then\n    insert into public.post_media (',
  ],
  [
    "      'media_license', v_media.license_code",
    "      'media_license', case when v_media_found then v_media.license_code else null end",
  ],
];

for (const [from, to] of replacements) {
  if (!block.includes(from)) throw new Error(`pattern not found: ${from.slice(0, 60)}`);
  block = block.replace(from, to);
}

const header = `-- 0106 — AI Haber Merkezi yayınlama: kayıt varlığı düzeltmesi
--
-- PostgreSQL'de bileşik (record) bir değer üzerinde \`IS NOT NULL\` tüm
-- alanların dolu olmasını gerektirir. Medya kaydında \`credit\` gibi alanlar
-- boş olduğu için \`v_media IS NOT NULL\` yanlış sonuç veriyor; placeholder
-- görsel gerçek fotoğraf gibi işaretleniyordu.
--
-- Kayıt varlığı artık her SELECT'ten hemen sonra \`FOUND\` ile izlenir.
-- Böylece taslak, yayıncı, medya ve lisans kontrolleri güvenilir çalışır.

begin;

set search_path = public, extensions;

`;

writeFileSync(
  'supabase/migrations/0106_ai_news_publish_found_fix.sql',
  `${header}${block}\n\nrevoke all on function public.ai_news_publish_event(uuid, text, uuid) from public, anon, authenticated;\ngrant execute on function public.ai_news_publish_event(uuid, text, uuid) to service_role;\n\ncommit;\n`,
  'utf8',
);

console.log('written');
