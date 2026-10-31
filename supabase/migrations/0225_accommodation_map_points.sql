-- ---------------------------------------------------------------------------
-- Konaklama haritası verisi
--
-- Harita ekranı, listeleme aramasını (acc_search) kullanıyordu. O fonksiyon
-- sayfalama için 50 kayıtla sınırlıdır ve tarih/misafir filtrelerine göre
-- daraltılmış sonuç döner; haritada ise konumu olan tüm yayınlanmış tesisler
-- gerekiyor. Bu fonksiyon yalnızca haritanın ihtiyaç duyduğu alanları döner.
--
-- Görünürlük kuralları herkese açık listeyle aynıdır: yayında + doğrulanmış.
-- ---------------------------------------------------------------------------

create or replace function public.acc_map_points(p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_items jsonb;
begin
  with visible as (
    select
      p.id,
      p.name,
      p.slug,
      p.property_type,
      p.district,
      p.neighborhood,
      p.lat,
      p.lng,
      p.rating_avg,
      p.rating_count,
      p.cover_path,
      p.verification_status,
      (
        select min(rt.base_price_cents)
        from public.acc_room_types rt
        where rt.property_id = p.id and rt.active
      ) as price_from_cents,
      (
        select array_agg(distinct rp.booking_mode)
        from public.acc_rate_plans rp
        where rp.property_id = p.id and rp.active
      ) as booking_modes,
      exists (
        select 1 from public.acc_campaigns c
        where c.property_id = p.id
          and c.status = 'active'
          and current_date between c.start_date and c.end_date
      ) as has_deal
    from public.acc_properties p
    where p.status = 'published'
      and p.verification_status = 'verified'
      and p.lat is not null
      and p.lng is not null
      and p.lat between -90 and 90
      and p.lng between -180 and 180
  )
  select coalesce(jsonb_agg(item order by rating_sort desc nulls last, name), '[]'::jsonb)
  into v_items
  from (
    select
      jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'slug', v.slug,
        'property_type', v.property_type,
        'district', v.district,
        'neighborhood', v.neighborhood,
        'lat', v.lat,
        'lng', v.lng,
        'rating_avg', v.rating_avg,
        'rating_count', v.rating_count,
        'price_from_cents', v.price_from_cents,
        'currency', 'TRY',
        'cover_path', coalesce(
          v.cover_path,
          (select m.storage_path from public.acc_property_media m
            where m.property_id = v.id and m.kind = 'image' and m.status = 'approved'
            order by m.cover desc, m.sort_order limit 1)
        ),
        'booking_modes', coalesce(to_jsonb(v.booking_modes), '[]'::jsonb),
        'has_deal', v.has_deal,
        'verified', v.verification_status = 'verified'
      ) as item,
      v.rating_avg as rating_sort,
      v.name
    from visible v
    order by v.rating_avg desc nulls last, v.name
    limit v_limit
  ) t;

  return v_items;
end;
$$;

grant execute on function public.acc_map_points(int) to anon, authenticated, service_role;
