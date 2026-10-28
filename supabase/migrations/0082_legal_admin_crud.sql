-- 0082_legal_admin_crud.sql
-- Hukuki belgelerin yönetim panelinden tam yönetimi (ekle / düzenle / yayınla /
-- yayından kaldır / sil) ve yayınlanan değişikliğin siteye anında yansıması.
--
-- Eksikler:
--   * Yürürlükteki sürüm arşivlenemiyordu (`cannot_archive_current_version`),
--     yani yanlışlıkla yayınlanan bir sözleşme geri alınamıyordu.
--   * Hiçbir sürüm silinemiyordu; hatalı açılan belge katalogda kalıyordu.
--   * `safety_policy_versions` realtime yayınında değildi, açık oturumlar
--     yayını görmek için sayfayı yenilemek zorundaydı.
--
-- Eklenenler:
--   legal_admin_unpublish(p_id)          → yayından kaldır (önceki sürüm yürürlüğe döner)
--   legal_admin_delete(p_id)             → tek sürümü kalıcı sil (kabul kaydı yoksa)
--   legal_admin_delete_document(p_slug)  → belgeyi tüm sürümleriyle sil (kabul kaydı yoksa)
--   realtime + anon okuma politikası     → site açık oturumda da anında güncellenir

-- ---------------------------------------------------------------------------
-- 1. Yayından kaldır / geri al
-- ---------------------------------------------------------------------------
create or replace function public.legal_admin_unpublish(
  p_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.safety_policy_versions%rowtype;
  v_previous integer;
begin
  perform public.require_permission('safety.policy.manage');

  select * into v_row from public.safety_policy_versions where id = p_id for update;
  if not found then
    raise exception 'document_not_found' using errcode = '22023';
  end if;
  if not v_row.is_published then
    raise exception 'not_published' using errcode = '22023';
  end if;

  update public.safety_policy_versions
     set is_published = false,
         archived_at = now()
   where id = p_id
   returning * into v_row;

  -- Yürürlüğe dönen sürüm (varsa) panelde bilgi olarak gösterilir.
  select max(version) into v_previous
  from public.safety_policy_versions
  where slug = v_row.slug
    and locale = v_row.locale
    and is_published
    and archived_at is null;

  perform public.safety_audit(
    'legal.unpublish',
    'Hukuki belge yayından kaldırıldı',
    'legal_document',
    v_row.slug || ' v' || v_row.version,
    jsonb_build_object(
      'reason', left(coalesce(p_reason, ''), 500),
      'previous_version', v_previous
    )
  );

  return to_jsonb(v_row) || jsonb_build_object('previous_version', v_previous);
end
$$;

revoke all on function public.legal_admin_unpublish(uuid, text) from public, anon;
grant execute on function public.legal_admin_unpublish(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tek sürümü kalıcı sil (yalnızca kabul kaydı yoksa ve yayında değilse)
-- ---------------------------------------------------------------------------
create or replace function public.legal_admin_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.safety_policy_versions%rowtype;
  v_acceptances integer;
begin
  perform public.require_permission('safety.policy.manage');

  select * into v_row from public.safety_policy_versions where id = p_id for update;
  if not found then
    raise exception 'document_not_found' using errcode = '22023';
  end if;

  if v_row.is_published then
    raise exception 'cannot_delete_published' using errcode = '22023';
  end if;

  select count(*) into v_acceptances
  from public.legal_acceptances
  where document_slug = v_row.slug
    and document_version = v_row.version
    and document_locale = v_row.locale;

  if v_acceptances > 0 then
    raise exception 'has_acceptances' using errcode = '22023';
  end if;

  delete from public.safety_policy_versions where id = p_id;

  perform public.safety_audit(
    'legal.delete',
    'Hukuki belge sürümü silindi',
    'legal_document',
    v_row.slug || ' v' || v_row.version,
    jsonb_build_object('version', v_row.version, 'locale', v_row.locale)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'slug', v_row.slug,
    'version', v_row.version,
    'deleted', true
  );
end
$$;

revoke all on function public.legal_admin_delete(uuid) from public, anon;
grant execute on function public.legal_admin_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Belgeyi tüm sürümleriyle sil (kabul kaydı yoksa)
-- ---------------------------------------------------------------------------
create or replace function public.legal_admin_delete_document(
  p_slug text,
  p_locale text default 'tr'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locale text := coalesce(nullif(p_locale, ''), 'tr');
  v_versions integer;
  v_acceptances integer;
begin
  perform public.require_permission('safety.policy.manage');

  select count(*) into v_versions
  from public.safety_policy_versions
  where slug = p_slug and locale = v_locale;

  if v_versions = 0 then
    raise exception 'document_not_found' using errcode = '22023';
  end if;

  select count(*) into v_acceptances
  from public.legal_acceptances
  where document_slug = p_slug and document_locale = v_locale;

  if v_acceptances > 0 then
    raise exception 'has_acceptances' using errcode = '22023';
  end if;

  delete from public.safety_policy_versions
  where slug = p_slug and locale = v_locale;

  perform public.safety_audit(
    'legal.delete',
    'Hukuki belge silindi',
    'legal_document',
    p_slug,
    jsonb_build_object('locale', v_locale, 'versions', v_versions)
  );

  return jsonb_build_object('slug', p_slug, 'deleted_versions', v_versions, 'deleted', true);
end
$$;

revoke all on function public.legal_admin_delete_document(text, text) from public, anon;
grant execute on function public.legal_admin_delete_document(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Katalog: yeni belgeler de listelensin (doc_type + kabul bilgisi ile)
-- ---------------------------------------------------------------------------
create or replace function public.legal_documents(p_locale text default 'tr')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row order by row ->> 'slug')
    from (
      select distinct on (v.slug)
        jsonb_build_object(
          'slug', v.slug,
          'version', v.version,
          'locale', v.locale,
          'doc_type', v.doc_type,
          'title', v.title,
          'summary', v.summary,
          'requires_acceptance', v.requires_acceptance,
          'requires_reacceptance', v.requires_reacceptance,
          'effective_at', v.effective_at,
          'published_at', v.published_at
        ) as row
      from public.safety_policy_versions v
      where v.locale = coalesce(nullif(p_locale, ''), 'tr')
        and v.is_published
        and v.archived_at is null
      order by v.slug, v.version desc
    ) s
  ), '[]'::jsonb);
end
$$;

revoke all on function public.legal_documents(text) from public;
grant execute on function public.legal_documents(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime: yayınlanan sözleşme değişikliği açık oturumlara anında gitsin
-- ---------------------------------------------------------------------------
drop policy if exists safety_policies_select_published_public on public.safety_policy_versions;
create policy safety_policies_select_published_public
  on public.safety_policy_versions
  for select
  to anon, authenticated
  using (is_published and archived_at is null);

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'safety_policy_versions'
  ) then
    alter publication supabase_realtime add table public.safety_policy_versions;
  end if;
end
$$;

-- Realtime delta'ları için kimlik ve filtre sütunları yeterli olsun.
alter table public.safety_policy_versions replica identity full;
