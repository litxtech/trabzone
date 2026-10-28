-- AI Haber Merkezi: cp1252 olarak yanlış çözülmüş Türkçe metinlerin onarımı.
-- 0094 seed verisi ve ilk çalıştırmalarda oluşan mojibake kayıtlarını düzeltir.
-- Not: Yalnızca bozuk dizileri hedefler; doğru metinlere dokunmaz.

create or replace function public.ai_news_fix_text(t text)
returns text
language plpgsql
immutable
as $$
begin
  if t is null or t = '' then
    return t;
  end if;
  if t !~ '[ÃÂÄÅ]' then
    return t;
  end if;
  begin
    return convert_from(convert_to(t, 'WIN1252'), 'UTF8');
  exception when others then
    return t;
  end;
end;
$$;

revoke all on function public.ai_news_fix_text(text) from public;
grant execute on function public.ai_news_fix_text(text) to service_role;

-- Referans tablolar
update public.ai_news_categories
set name_tr = public.ai_news_fix_text(name_tr)
where public.ai_news_fix_text(name_tr) is distinct from name_tr;

update public.ai_news_media_licenses
set name_tr = public.ai_news_fix_text(name_tr),
    notes_tr = public.ai_news_fix_text(notes_tr)
where public.ai_news_fix_text(name_tr) is distinct from name_tr
   or public.ai_news_fix_text(notes_tr) is distinct from notes_tr;

update public.ai_news_search_topics
set query = public.ai_news_fix_text(query)
where public.ai_news_fix_text(query) is distinct from query;

update public.ai_news_sources
set name = public.ai_news_fix_text(name),
    notes_tr = public.ai_news_fix_text(notes_tr),
    license_reference = public.ai_news_fix_text(license_reference),
    attribution_text = public.ai_news_fix_text(attribution_text),
    last_error = public.ai_news_fix_text(last_error)
where public.ai_news_fix_text(name) is distinct from name
   or public.ai_news_fix_text(notes_tr) is distinct from notes_tr
   or public.ai_news_fix_text(license_reference) is distinct from license_reference
   or public.ai_news_fix_text(attribution_text) is distinct from attribution_text
   or public.ai_news_fix_text(last_error) is distinct from last_error;

update public.admin_permissions
set description_tr = public.ai_news_fix_text(description_tr)
where code in ('news.view', 'news.manage')
  and public.ai_news_fix_text(description_tr) is distinct from description_tr;

-- Çalışma kayıtları (olay, taslak, medya, hata, denetim) içindeki bozuk metinler
do $$
declare
  rec record;
begin
  for rec in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'ai_news_events', 'ai_news_drafts', 'ai_news_verification_results',
        'ai_news_media_assets', 'ai_news_review_queue', 'ai_news_errors',
        'ai_news_audit_logs', 'ai_news_publications', 'ai_news_publication_history',
        'ai_news_runs', 'ai_news_search_results', 'ai_news_evidence'
      )
      and data_type in ('text', 'character varying')
  loop
    execute format(
      'update public.%I set %I = public.ai_news_fix_text(%I) where public.ai_news_fix_text(%I) is distinct from %I',
      rec.table_name, rec.column_name, rec.column_name, rec.column_name, rec.column_name
    );
  end loop;
end $$;
