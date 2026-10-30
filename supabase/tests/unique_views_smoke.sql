-- ---------------------------------------------------------------------------
-- Tekil görüntüleme sistemi — tekrar çalıştırılabilir duman testi
--
-- Tüm senaryolar TEK bir transaction içinde çalışır ve sonunda ROLLBACK edilir;
-- üretim verisi değişmez. Supabase SQL Editor veya Management API ile çalıştırın.
--
-- Kapsam:
--   1) İlk görüntüleme +1
--   2) Aynı hesabın tekrar görüntülemesi +0
--   3) Farklı hesap +1
--   4) İçerik sahibi +0
--   5) Gizli içerik +0 (not_available)
--   6) Sayaç ile tekil kayıt tablosu tutarlılığı
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_post    uuid;
  v_hidden  uuid;
  v_owner   uuid;
  v_a       uuid;
  v_b       uuid;
  r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb;
  c0 bigint := 0;
  c2 bigint := 0;
  v_raw bigint := 0;
begin
  select p.id, p.author_id
    into v_post, v_owner
  from public.posts p
    join public.profiles pr on pr.id = p.author_id
  where p.moderation_status = 'visible'
    and p.visibility = 'public'
    and pr.account_status = 'active'
    and not exists (
      select 1 from public.content_unique_views v
      where v.content_type = 'post' and v.content_id = p.id
    )
  limit 1;

  if v_post is null then
    raise notice 'Test atlandı: görüntülenmemiş herkese açık gönderi bulunamadı.';
    return;
  end if;

  select id into v_a
  from public.profiles
  where account_status = 'active' and id <> v_owner
  order by created_at
  limit 1;

  select id into v_b
  from public.profiles
  where account_status = 'active' and id not in (v_owner, v_a)
  order by created_at
  limit 1;

  select p.id into v_hidden
  from public.posts p
  where p.moderation_status <> 'visible'
  limit 1;

  if v_a is null or v_b is null then
    raise notice 'Test atlandı: en az iki aktif görüntüleyici hesap gerekli.';
    return;
  end if;

  select coalesce(unique_views, 0) into c0
  from public.content_view_counters
  where content_type = 'post' and content_id = v_post;

  -- A hesabı: ilk görüntüleme
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text,
    true
  );
  r1 := public.content_register_view('post', v_post, 'smoke_test');

  if coalesce((r1 ->> 'counted')::boolean, false) is not true then
    raise exception 'ASSERT 1: ilk görüntüleme sayılmadı → %', r1;
  end if;

  -- A hesabı: tekrar görüntüleme
  r2 := public.content_register_view('post', v_post, 'smoke_test');
  if coalesce((r2 ->> 'counted')::boolean, false) is true then
    raise exception 'ASSERT 2: tekrar görüntüleme sayıldı → %', r2;
  end if;
  if (r2 ->> 'unique_views')::bigint <> (r1 ->> 'unique_views')::bigint then
    raise exception 'ASSERT 3: tekrar görüntüleme sayacı değiştirdi';
  end if;

  -- B hesabı: farklı hesap
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text,
    true
  );
  r3 := public.content_register_view('post', v_post, 'smoke_test');
  if coalesce((r3 ->> 'counted')::boolean, false) is not true then
    raise exception 'ASSERT 4: farklı hesap sayılmadı → %', r3;
  end if;
  if (r3 ->> 'unique_views')::bigint <> c0 + 2 then
    raise exception 'ASSERT 5: beklenen %, gelen %', c0 + 2, r3 ->> 'unique_views';
  end if;

  -- İçerik sahibi: +0
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  r4 := public.content_register_view('post', v_post, 'smoke_test');
  if r4 ->> 'reason' is distinct from 'owner' then
    raise exception 'ASSERT 6: sahip görüntülemesi reddedilmedi → %', r4;
  end if;

  -- Gizli içerik: +0
  if v_hidden is not null then
    perform set_config('request.jwt.claim.sub', v_a::text, true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated')::text,
      true
    );
    r5 := public.content_register_view('post', v_hidden, 'smoke_test');
    if r5 ->> 'reason' is distinct from 'not_available' then
      raise exception 'ASSERT 7: gizli içerik sayıldı → %', r5;
    end if;
  end if;

  -- Tutarlılık: sayaç == tekil kayıt sayısı
  select coalesce(unique_views, 0) into c2
  from public.content_view_counters
  where content_type = 'post' and content_id = v_post;

  select count(*) into v_raw
  from public.content_unique_views
  where content_type = 'post' and content_id = v_post;

  if c2 <> c0 + 2 then
    raise exception 'ASSERT 8: sayaç % beklenen %', c2, c0 + 2;
  end if;
  if v_raw <> 2 then
    raise exception 'ASSERT 9: tekil kayıt % beklenen 2', v_raw;
  end if;

  raise notice 'TÜM ASSERTIONLAR GEÇTİ (taban=%, son=%, kayıt=%)', c0, c2, v_raw;
end $$;

select 'PASS' as result;

rollback;
