-- ---------------------------------------------------------------------------
-- Eczane envanteri — mükerrer kayıt temizliği
--
-- Amaç: "Eczane İnanır" / "İnanır Eczanesi", aynı OSM düğümünün iki kez
-- içe aktarılmasıyla oluşan Nur/Talip mükerrerleri ve adı yalnızca "Eczane"
-- olan anlamsız kayıtlar kullanıcıya iki kez gösterilmesin.
--
-- Kural:
--   * Aynı ilçe + aynı çekirdek ad (0149 ile düzeltildi) → tek kayıt.
--   * Korunan kayıt en doğrulanmış/eksiksiz olandır (doğrulanmış adres,
--     telefon, doğrulama zamanı, yorum sayısı sırasıyla).
--   * Mükerrer kayıt SİLİNMEZ; `status='duplicate'` olarak arşivlenir.
--     Nöbet kayıtları, favoriler, yorumlar, harici referanslar korunan
--     kayda taşınır. Kullanıcı içeriği kaybolmaz.
--   * Adı yalnızca "Eczane" olan, adresi/telefonu olmayan OSM yer
--     tutucuları `status='archived'` yapılır; hiçbir alan uydurulmaz.
-- ---------------------------------------------------------------------------

do $$
declare
  v_dup record;
  v_keeper uuid;
begin
  -- Mükerrer eşlemesi: aynı ilçe + çekirdek ad, en iyi kayıt korunur.
  create temp table _pharmacy_dedupe on commit drop as
  with base as (
    select p.id,
           p.district_id,
           public.pharmacy_core_name(p.name) as core,
           p.created_at,
           p.review_count,
           (pp.data_verified_at is not null) as verified,
           (coalesce(pp.address_text, p.address) is not null) as has_address,
           (coalesce(pp.phone_text, p.phone) is not null) as has_phone
    from public.places p
    join public.place_categories c on c.id = p.category_id
    join public.pharmacy_profiles pp on pp.place_id = p.id
    where c.slug = 'eczane'
      and p.status = 'published'
  ),
  ranked as (
    select b.*,
           row_number() over (
             partition by b.district_id, b.core
             order by b.verified desc,
                      b.has_address desc,
                      b.has_phone desc,
                      b.review_count desc,
                      b.created_at asc,
                      b.id
           ) as rn
    from base b
    where b.core <> ''
  )
  select d.id as dup_id, k.id as keeper_id
  from ranked d
  join ranked k
    on k.district_id = d.district_id
   and k.core = d.core
   and k.rn = 1
  where d.rn > 1;

  for v_dup in select dup_id, keeper_id from _pharmacy_dedupe loop
    -- Profil alanlarını korunan kayıtta birleştir (yalnızca boş alanlar dolar).
    update public.pharmacy_profiles k
       set address_text = coalesce(k.address_text, d.address_text),
           phone_text = coalesce(k.phone_text, d.phone_text),
           neighborhood = coalesce(k.neighborhood, d.neighborhood),
           neighborhood_source = coalesce(k.neighborhood_source, d.neighborhood_source),
           working_hours = case
             when k.working_hours = '{}'::jsonb then d.working_hours
             else k.working_hours
           end,
           working_hours_source = coalesce(k.working_hours_source, d.working_hours_source),
           duty_tracking = k.duty_tracking or d.duty_tracking,
           duty_verified_at = greatest(k.duty_verified_at, d.duty_verified_at),
           data_verified_at = greatest(k.data_verified_at, d.data_verified_at),
           notes = coalesce(k.notes, d.notes),
           updated_at = now()
      from public.pharmacy_profiles d
     where k.place_id = v_dup.keeper_id
       and d.place_id = v_dup.dup_id;

    update public.places k
       set address = coalesce(k.address, d.address),
           phone = coalesce(k.phone, d.phone),
           lat = coalesce(k.lat, d.lat),
           lng = coalesce(k.lng, d.lng),
           neighborhood_id = coalesce(k.neighborhood_id, d.neighborhood_id),
           updated_at = now()
      from public.places d
     where k.id = v_dup.keeper_id
       and d.id = v_dup.dup_id;

    -- Nöbet kayıtları: çakışan saat varsa korunan kayıttaki kalır.
    insert into public.pharmacy_duty_schedules (
      place_id, duty_date, starts_at, ends_at, source_id, source_ref,
      source_version, status, fetched_at, verified_at, note, created_at, updated_at
    )
    select v_dup.keeper_id, s.duty_date, s.starts_at, s.ends_at, s.source_id,
           s.source_ref, s.source_version, s.status, s.fetched_at,
           s.verified_at, s.note, s.created_at, s.updated_at
    from public.pharmacy_duty_schedules s
    where s.place_id = v_dup.dup_id
    on conflict (place_id, starts_at) do nothing;

    delete from public.pharmacy_duty_schedules where place_id = v_dup.dup_id;

    -- Favoriler / işletme yöneticileri / kategori ilişkileri.
    insert into public.place_favorites (place_id, user_id, created_at)
    select v_dup.keeper_id, f.user_id, f.created_at
    from public.place_favorites f
    where f.place_id = v_dup.dup_id
    on conflict (place_id, user_id) do nothing;
    delete from public.place_favorites where place_id = v_dup.dup_id;

    insert into public.place_business_managers (place_id, user_id)
    select v_dup.keeper_id, bm.user_id
    from public.place_business_managers bm
    where bm.place_id = v_dup.dup_id
    on conflict (place_id, user_id) do nothing;
    delete from public.place_business_managers where place_id = v_dup.dup_id;

    insert into public.place_category_relations (place_id, category_id)
    select v_dup.keeper_id, cr.category_id
    from public.place_category_relations cr
    where cr.place_id = v_dup.dup_id
    on conflict (place_id, category_id) do nothing;
    delete from public.place_category_relations where place_id = v_dup.dup_id;

    -- Harici referanslar (OSM düğümü vb.) korunan kayda bağlanır.
    insert into public.place_external_references (
      place_id, provider, external_id, license_note, attribution_text,
      raw_content_saved, metadata, fetched_at
    )
    select v_dup.keeper_id, er.provider, er.external_id, er.license_note,
           er.attribution_text, er.raw_content_saved, er.metadata, er.fetched_at
    from public.place_external_references er
    where er.place_id = v_dup.dup_id
    on conflict (place_id, provider, external_id) do nothing;
    delete from public.place_external_references where place_id = v_dup.dup_id;

    -- Kullanıcı yorumları: aynı kullanıcı iki kayda da yazdıysa korunan
    -- kayıttaki yorum kalır; diğeri arşivlenen kayıtta durur (silinmez).
    update public.place_reviews r
       set place_id = v_dup.keeper_id,
           updated_at = now()
     where r.place_id = v_dup.dup_id
       and not exists (
         select 1 from public.place_reviews r2
         where r2.place_id = v_dup.keeper_id
           and r2.author_id = r.author_id
       );

    update public.place_media set place_id = v_dup.keeper_id where place_id = v_dup.dup_id;
    update public.place_content_links set place_id = v_dup.keeper_id where place_id = v_dup.dup_id;
    update public.place_owner_claims set place_id = v_dup.keeper_id where place_id = v_dup.dup_id;
    update public.place_review_replies set place_id = v_dup.keeper_id where place_id = v_dup.dup_id;

    -- Mükerrer kaydı silme; denetim için `duplicate` olarak sakla.
    update public.places
       set status = 'duplicate',
           updated_at = now()
     where id = v_dup.dup_id;

    -- Taşınan yorumlardan sonra puan sayaçlarını gerçek veriden yenile.
    update public.places p
       set review_count = agg.cnt,
           rating_avg = agg.avg_rating,
           rating_count = agg.cnt,
           updated_at = now()
      from (
        select count(*) as cnt,
               round(avg(r.rating)::numeric, 2) as avg_rating
        from public.place_reviews r
        where r.place_id = v_dup.keeper_id
          and r.status = 'visible'
      ) agg
     where p.id = v_dup.keeper_id;
  end loop;

  -- Adı yalnızca "Eczane" olan, adresi ve telefonu bulunmayan yer tutucular.
  update public.places p
     set status = 'archived',
         updated_at = now()
    from public.place_categories c,
         public.pharmacy_profiles pp
   where p.category_id = c.id
     and pp.place_id = p.id
     and c.slug = 'eczane'
     and p.status = 'published'
     and public.pharmacy_core_name(p.name) = ''
     and coalesce(pp.address_text, p.address) is null
     and coalesce(pp.phone_text, p.phone) is null;
end;
$$;
