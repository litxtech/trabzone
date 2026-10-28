-- 0078_legal_consent_fix.sql
-- Sözleşme onayı ("Kabul et ve devam et") hiç ilerlemiyordu.
--
-- Kök neden: `legal_my_pending()` belge sürümünü `requires_acceptance = true`
-- olan EN YENİ satırdan seçiyordu, `legal_record_acceptance()` ise sürümden
-- bağımsız olarak EN YENİ yayınlanmış satırı seçiyordu. `privacy` ve
-- `child-safety` için v2 yayınlandığında `requires_acceptance` false olduğu
-- için:
--   * onay ekranı eski v1'i gösteriyordu,
--   * kayıt fonksiyonu v2'yi bekliyordu,
--   * p_version (1) <> v_doc.version (2) → `stale_document_version`.
-- İstemci ilk belgede hata alınca döngü kırılıyor, ekranda kalıyordu.
--
-- Düzeltmeler:
--   1. Onay bekleyen belge, o slug'ın YÜRÜRLÜKTEKİ (son yayınlanmış) sürümü
--      üzerinden hesaplanır. Eski sürümlerin bayrağı artık kimseyi kilitlemez.
--   2. Kayıt fonksiyonu istemcinin gönderdiği sürümü (kullanıcının gerçekten
--      incelediği metin) kabul eder; yalnızca o sürüm yayında değilse en yeni
--      sürüme düşer. `stale_document_version` artık fırlatılmaz.

-- ---------------------------------------------------------------------------
-- 1. Onay kaydı: istemcinin gösterdiği sürümü esas al
-- ---------------------------------------------------------------------------
create or replace function public.legal_record_acceptance(
  p_slug text,
  p_action text,
  p_source text,
  p_version integer default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.safety_policy_versions%rowtype;
  v_action text := coalesce(p_action, 'accepted');
  v_found boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if v_action not in ('accepted', 'acknowledged', 'presented') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if p_source not in (
    'web_register', 'web_consent_gate', 'web_settings', 'web_support',
    'mobile_register', 'mobile_settings', 'oauth_register'
  ) then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  -- Kullanıcının ekranda gördüğü sürüm kaydedilir: onay hukuken o metne
  -- verilmiştir. Sürüm yayından kaldırılmışsa en yeni sürüme düşülür.
  if p_version is not null then
    select * into v_doc
    from public.safety_policy_versions
    where slug = p_slug
      and locale = 'tr'
      and version = p_version
      and is_published
      and archived_at is null
    limit 1;
    v_found := found;
  end if;

  if not v_found then
    select * into v_doc
    from public.safety_policy_versions
    where slug = p_slug
      and locale = 'tr'
      and is_published
      and archived_at is null
    order by version desc
    limit 1;
    v_found := found;
  end if;

  if not v_found then
    raise exception 'document_not_found' using errcode = '22023';
  end if;

  insert into public.legal_acceptances (
    user_id, document_slug, document_version, document_locale,
    content_hash, action, source, user_agent
  )
  values (
    v_uid, v_doc.slug, v_doc.version, v_doc.locale,
    v_doc.content_hash, v_action, p_source, left(p_user_agent, 400)
  )
  on conflict (user_id, document_slug, document_version, document_locale, action) do nothing;

  return jsonb_build_object(
    'slug', v_doc.slug,
    'version', v_doc.version,
    'action', v_action,
    'content_hash', v_doc.content_hash
  );
end
$$;

revoke all on function public.legal_record_acceptance(text, text, text, integer, text)
  from public, anon;
grant execute on function public.legal_record_acceptance(text, text, text, integer, text)
  to authenticated;

comment on function public.legal_record_acceptance(text, text, text, integer, text) is
  'Sözleşme kabulü. İstemcinin gösterdiği sürüm yayındaysa o sürüm, değilse en yeni yayın sürümü kaydedilir.';

-- ---------------------------------------------------------------------------
-- 2. Onay bekleyenler: yürürlükteki sürüm üzerinden hesapla
-- ---------------------------------------------------------------------------
create or replace function public.legal_my_pending()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slug', d.slug,
      'version', d.version,
      'title', d.title,
      'doc_type', d.doc_type,
      'effective_at', d.effective_at
    ) order by d.slug)
    from (
      -- Her belgenin yürürlükteki sürümü (eski sürümlerin bayrağı sayılmaz).
      select distinct on (v.slug) v.*
      from public.safety_policy_versions v
      where v.locale = 'tr'
        and v.is_published
        and v.archived_at is null
        and v.effective_at <= now()
      order by v.slug, v.version desc
    ) d
    where d.requires_acceptance
      and not exists (
        select 1 from public.legal_acceptances a
        where a.user_id = v_uid
          and a.document_slug = d.slug
          and a.document_locale = d.locale
          and a.action = 'accepted'
          -- Yeniden kabul zorunluysa tam sürüm eşleşmesi aranır.
          and (not d.requires_reacceptance or a.document_version = d.version)
      )
  ), '[]'::jsonb);
end
$$;

revoke all on function public.legal_my_pending() from public, anon;
grant execute on function public.legal_my_pending() to authenticated;

comment on function public.legal_my_pending() is
  'Kullanıcının kabul etmesi gereken güncel belgeler. Yürürlükteki sürüm requires_acceptance taşımıyorsa belge istenmez.';
