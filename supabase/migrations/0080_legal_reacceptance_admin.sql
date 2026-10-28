-- 0079_legal_reacceptance_admin.sql
-- Sözleşme güncellendiğinde "herkes yeni sürümü yeniden onaylasın" bayrağı
-- yönetim panelinden hiç ayarlanamıyordu: `legal_admin_save` yalnızca
-- `p_requires_acceptance` alıyor, paneldeki tek onay kutusu da yanlışlıkla
-- "Yeniden kabul gerektirir" diye etiketlenmişti. Bu yüzden yeni sürüm
-- yayınlarken kutu kapatılınca belge tamamen onay kapsamından çıkıyordu
-- (privacy/child-safety v2'de olan tam olarak buydu).
--
-- Bu migration:
--   1. `legal_admin_save`'e `p_requires_reacceptance` ekler (verilmezse önceki
--      sürümün değeri devralınır).
--   2. `legal_admin_versions` çıktısına `requires_reacceptance` ekler.
--   3. Güncellenen kullanım koşulları (terms v2) için yeniden onayı zorunlu
--      kılar; böylece eski sürümü kabul etmiş kullanıcılar da yeni metni
--      onaylamadan uygulamaya giremez.

-- ---------------------------------------------------------------------------
-- 1. Yönetici kaydetme: yeniden onay bayrağı
-- ---------------------------------------------------------------------------
drop function if exists public.legal_admin_save(
  text, text, text, text, text, text, boolean, timestamptz, text, boolean
);

create or replace function public.legal_admin_save(
  p_slug text,
  p_title text,
  p_summary text,
  p_body_md text,
  p_locale text default 'tr',
  p_doc_type text default 'policy',
  p_requires_acceptance boolean default true,
  p_effective_at timestamptz default null,
  p_change_summary text default null,
  p_publish boolean default false,
  p_requires_reacceptance boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_locale text := coalesce(nullif(p_locale, ''), 'tr');
  v_version integer;
  v_id uuid;
  v_existing public.safety_policy_versions%rowtype;
  v_reaccept boolean;
begin
  perform public.require_permission('safety.policy.manage');

  if p_slug !~ '^[a-z0-9-]{3,64}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if p_title is null or char_length(trim(p_title)) < 3 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;
  if p_body_md is null or char_length(trim(p_body_md)) < 80 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if p_doc_type not in ('contract', 'policy', 'notice', 'rules', 'disclosure') then
    raise exception 'invalid_doc_type' using errcode = '22023';
  end if;

  -- Aynı slug + dil için son sürümü bul.
  select * into v_existing
  from public.safety_policy_versions
  where slug = p_slug and locale = v_locale
  order by version desc
  limit 1;

  if found and not v_existing.is_published then
    -- Taslak varsa onu güncelle (yayınlanmış sürümler değiştirilemez).
    -- Bayrak verilmediyse taslağın mevcut değeri korunur.
    v_reaccept := coalesce(p_requires_reacceptance, v_existing.requires_reacceptance);

    update public.safety_policy_versions
       set title = trim(p_title),
           summary = nullif(trim(coalesce(p_summary, '')), ''),
           body_md = p_body_md,
           doc_type = p_doc_type,
           requires_acceptance = p_requires_acceptance,
           requires_reacceptance = v_reaccept,
           change_summary = nullif(trim(coalesce(p_change_summary, '')), ''),
           updated_by = v_uid
     where id = v_existing.id
     returning id, version into v_id, v_version;

    if p_publish then
      update public.safety_policy_versions
         set is_published = true,
             published_at = now(),
             effective_at = coalesce(p_effective_at, now()),
             updated_by = v_uid
       where id = v_id;
    end if;
  else
    select coalesce(max(version), 0) + 1 into v_version
    from public.safety_policy_versions
    where slug = p_slug and locale = v_locale;

    -- Yeni sürümde bayrak verilmediyse önceki sürümün değeri devralınır.
    v_reaccept := coalesce(
      p_requires_reacceptance,
      v_existing.requires_reacceptance,
      false
    );

    insert into public.safety_policy_versions (
      slug, version, locale, doc_type, title, summary, body_md,
      is_published, requires_acceptance, requires_reacceptance, change_summary,
      published_at, effective_at, created_by, updated_by
    )
    values (
      p_slug, v_version, v_locale, p_doc_type, trim(p_title),
      nullif(trim(coalesce(p_summary, '')), ''), p_body_md,
      p_publish, p_requires_acceptance, v_reaccept,
      nullif(trim(coalesce(p_change_summary, '')), ''),
      case when p_publish then now() else null end,
      case when p_publish then coalesce(p_effective_at, now()) else null end,
      v_uid, v_uid
    )
    returning id into v_id;
  end if;

  perform public.safety_audit(
    case when p_publish then 'legal.publish' else 'legal.draft.save' end,
    case when p_publish then 'Hukuki belge yayınlandı' else 'Hukuki belge taslağı kaydedildi' end,
    'legal_document', p_slug,
    jsonb_build_object(
      'version', v_version,
      'locale', v_locale,
      'publish', p_publish,
      'requires_reacceptance', v_reaccept
    )
  );

  return (select to_jsonb(v) from public.safety_policy_versions v where v.id = v_id);
end
$$;

revoke all on function public.legal_admin_save(
  text, text, text, text, text, text, boolean, timestamptz, text, boolean, boolean
) from public, anon;
grant execute on function public.legal_admin_save(
  text, text, text, text, text, text, boolean, timestamptz, text, boolean, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Yönetici listesi: yeniden onay bayrağını da döndür
-- ---------------------------------------------------------------------------
create or replace function public.legal_admin_versions(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_permission('safety.policy.manage');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id,
      'slug', v.slug,
      'locale', v.locale,
      'version', v.version,
      'doc_type', v.doc_type,
      'title', v.title,
      'summary', v.summary,
      'body_md', v.body_md,
      'content_hash', v.content_hash,
      'is_published', v.is_published,
      'requires_acceptance', v.requires_acceptance,
      'requires_reacceptance', v.requires_reacceptance,
      'change_summary', v.change_summary,
      'effective_at', v.effective_at,
      'published_at', v.published_at,
      'archived_at', v.archived_at,
      'created_at', v.created_at,
      'updated_at', v.updated_at,
      'acceptance_count', (
        select count(*) from public.legal_acceptances a
        where a.document_slug = v.slug
          and a.document_version = v.version
          and a.action = 'accepted'
      )
    ) order by v.slug, v.locale, v.version desc)
    from public.safety_policy_versions v
    where p_slug is null or v.slug = p_slug
  ), '[]'::jsonb);
end
$$;

revoke all on function public.legal_admin_versions(text) from public, anon;
grant execute on function public.legal_admin_versions(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Güncellenen kullanım koşulları için yeniden onayı zorunlu kıl
-- ---------------------------------------------------------------------------
update public.safety_policy_versions
   set requires_reacceptance = true
 where slug = 'terms'
   and locale = 'tr'
   and version = 2
   and is_published
   and archived_at is null;

comment on column public.safety_policy_versions.requires_acceptance is
  'Belge onay gerektiriyor mu? Yürürlükteki sürümde false ise onay ekranı belgeyi hiç istemez.';
comment on column public.safety_policy_versions.requires_reacceptance is
  'true ise kullanıcının tam bu sürümü kabul etmiş olması gerekir; false ise belgeye ait herhangi bir kabul yeterlidir.';
