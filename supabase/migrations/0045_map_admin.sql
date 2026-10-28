-- =====================================================================
-- 0043 — Etkileşim Haritası Yönetim Merkezi (admin)
--
-- Tasarım ilkesi: yönetici paneli bir gözetim ekranı DEĞİLDİR.
--   * Bu migration hiçbir koordinat, oturum sahibinin kimliği veya
--     izleyici kimliği döndürmez.
--   * Yalnızca toplulaştırılmış sayımlar ve yapılandırma durumu döner.
--   * Tek yazma işlemi, güvenlik gerekçesiyle bir paylaşım oturumunu
--     sonlandırmaktır; bu işlem denetim kaydı üretir.
--   * Konum verisine erişim için ayrı, gerekçeli ve denetlenen bir akış
--     gerekir; bu sürümde istemciye açılmamıştır.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. İzin kataloğu ve rol ataması
-- ---------------------------------------------------------------------
insert into public.admin_permissions (code, description_tr) values
  ('map.view',     'Harita dashboard metrikleri ve modül durumunu görüntüleme'),
  ('map.moderate', 'Güvenlik gerekçesiyle harita konum paylaşımını sonlandırma'),
  ('map.manage',   'Harita katman, mod ve bölge bildirim kurallarını yönetme')
on conflict (code) do update set description_tr = excluded.description_tr;

insert into public.roles (key, name, description, rank) values
  ('map_manager', 'Harita Yöneticisi', 'Etkileşim haritası moderasyonu ve gizlilik operasyonları', 26)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, rank = excluded.rank;

insert into public.admin_role_permissions (role_key, permission_code)
select v.role_key, v.permission_code
from (values
  ('admin', 'map.view'), ('admin', 'map.moderate'), ('admin', 'map.manage'),

  ('map_manager', 'map.view'), ('map_manager', 'map.moderate'), ('map_manager', 'map.manage'),

  ('moderator', 'map.view'), ('moderator', 'map.moderate'),
  ('support_agent', 'map.view'),
  ('security_officer', 'map.view'), ('security_officer', 'map.moderate'),
  ('analyst', 'map.view')
) as v(role_key, permission_code)
where exists (select 1 from public.roles r where r.key = v.role_key)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Dashboard — yalnızca toplulaştırılmış veri
-- ---------------------------------------------------------------------
create or replace function public.map_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('map.view', false);
  v_active int;
  v_prefs int;
begin
  select count(*) into v_active
  from public.map_location_sessions
  where stopped_at is null and expires_at > now();

  select count(*) into v_prefs from public.map_user_preferences;

  return jsonb_build_object(
    'preferences', jsonb_build_object(
      'total', v_prefs,
      'ghost', (select count(*) from public.map_user_preferences where visibility = 'ghost'),
      'friends', (select count(*) from public.map_user_preferences where visibility = 'friends'),
      'selected', (select count(*) from public.map_user_preferences where visibility = 'selected'),
      'exact_precision', (select count(*) from public.map_user_preferences where precision = 'exact'),
      'onboarded', (select count(*) from public.map_user_preferences where onboarding_done)
    ),
    'sharing', jsonb_build_object(
      'active', v_active,
      'expired_24h', (select count(*) from public.map_location_sessions
        where expires_at <= now() and started_at > now() - interval '24 hours'),
      'stopped_24h', (select count(*) from public.map_location_sessions
        where stopped_at is not null and stopped_at > now() - interval '24 hours'),
      'selected_audience', (select count(*) from public.map_location_sessions
        where stopped_at is null and expires_at > now() and audience = 'selected'),
      'precise_active', (select count(*) from public.map_location_sessions
        where stopped_at is null and expires_at > now() and precise),
      'viewer_grants', (select count(*) from public.map_location_viewers v
        join public.map_location_sessions s on s.id = v.session_id
        where s.stopped_at is null and s.expires_at > now()),
      'owners_24h', (select count(distinct owner_id) from public.map_location_sessions
        where updated_at > now() - interval '24 hours')
    ),
    'library', jsonb_build_object(
      'saved_places', (select count(*) from public.map_saved_places),
      'public_places', (select count(*) from public.map_saved_places where visibility = 'public'),
      'link_places', (select count(*) from public.map_saved_places where visibility = 'link'),
      'collections', (select count(distinct collection) from public.map_saved_places),
      'regions', (select count(*) from public.map_region_follows),
      'instant_regions', (select count(*) from public.map_region_follows where notify_mode = 'instant')
    ),
    'rides', jsonb_build_object(
      'active_offers', (select count(*) from public.ride_offers where status in ('published', 'started')),
      'with_coordinates', (select count(*) from public.ride_offers
        where status in ('published', 'started')
          and origin_lat is not null and origin_lng is not null
          and dest_lat is not null and dest_lng is not null),
      'open_requests', (select count(*) from public.ride_requests where status = 'open')
    ),
    'privacy', jsonb_build_object(
      'ghost_default', true,
      'exact_requires_explicit_consent', true,
      'approximate_fuzz_meters', 1100,
      'admin_coordinate_access', false,
      'admin_identity_access', false,
      'raw_gps_in_public_results', false,
      'retention_note', 'Paylaşım oturumu süresi dolunca keşiften çıkar; durdurulan oturum yeniden açılmaz.'
    ),
    'modules', jsonb_build_array(
      jsonb_build_object('key', 'friends',         'label', 'Arkadaş konumları ve gizlilik', 'state', 'ready'),
      jsonb_build_object('key', 'rides',           'label', 'Yolculuk harita entegrasyonu',   'state', 'ready'),
      jsonb_build_object('key', 'places',          'label', 'Kaydedilen yerler ve koleksiyonlar', 'state', 'ready'),
      jsonb_build_object('key', 'regions',         'label', 'Bölge takibi ve bildirimler',    'state', 'partial'),
      jsonb_build_object('key', 'shares',          'label', 'Süreli konum paylaşımı',         'state', 'ready'),
      jsonb_build_object('key', 'heatmap',         'label', 'Sosyal ısı haritası',            'state', 'not_configured'),
      jsonb_build_object('key', 'events',          'label', 'Etkinlik haritası',              'state', 'not_configured'),
      jsonb_build_object('key', 'business',        'label', 'Mekân ve işletme merkezi',        'state', 'not_configured'),
      jsonb_build_object('key', 'live',            'label', 'Canlı yayın haritası',           'state', 'not_configured'),
      jsonb_build_object('key', 'reels_locations', 'label', 'Reels ve medya konumları',       'state', 'not_configured'),
      jsonb_build_object('key', 'help',            'label', 'Yardım ve kayıp eşya katmanı',   'state', 'not_configured'),
      jsonb_build_object('key', 'weather_traffic', 'label', 'Hava ve trafik katmanları',      'state', 'not_configured'),
      jsonb_build_object('key', 'offline',         'label', 'Çevrimdışı harita indirmeleri',  'state', 'not_configured'),
      jsonb_build_object('key', 'navigation',      'label', 'Sesli navigasyon',               'state', 'not_configured')
    )
  );
end;
$$;

grant execute on function public.map_admin_overview() to authenticated;
revoke execute on function public.map_admin_overview() from public, anon;

-- ---------------------------------------------------------------------
-- 3. Paylaşım sonlandırma (denetim kaydı üretir)
--
-- Kimlik/koordinat döndürmez. Yalnızca güvenlik veya kullanıcı talebiyle
-- aktif bir paylaşımı kapatır. Süreli paylaşım zaten kendiliğinden kapanır.
-- ---------------------------------------------------------------------
create or replace function public.map_admin_stop_share(
  p_session_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('map.moderate', true);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_owner uuid;
begin
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select owner_id into v_owner
  from public.map_location_sessions
  where id = p_session_id and stopped_at is null
  for update;

  if v_owner is null then
    raise exception 'session_not_active' using errcode = 'P0002';
  end if;

  update public.map_location_sessions
  set stopped_at = now()
  where id = p_session_id and stopped_at is null;

  perform public.tz_admin_audit(
    'map.share.stop',
    'Harita konum paylaşımı sonlandırıldı',
    'map_location_session',
    p_session_id::text,
    jsonb_build_object('reason', v_reason),
    'success'
  );

  return jsonb_build_object('stopped', true, 'note', 'Paylaşım sonlandırıldı ve denetim kaydı oluşturuldu.');
end;
$$;

grant execute on function public.map_admin_stop_share(uuid, text) to authenticated;
revoke execute on function public.map_admin_stop_share(uuid, text) from public, anon;

-- ---------------------------------------------------------------------
-- 4. Anonim aktif paylaşım sayacı (kimlik/koordinat yok)
-- ---------------------------------------------------------------------
create or replace function public.map_admin_active_shares()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('map.view', false);
begin
  return coalesce((
    select jsonb_agg(row order by row->>'expires_in_minutes')
    from (
      select jsonb_build_object(
        'session_id', id,
        'audience', audience,
        'precise', precise,
        'started_at', started_at,
        'expires_at', expires_at,
        'expires_in_minutes', greatest(0, floor(extract(epoch from (expires_at - now())) / 60)::int),
        'viewer_count', (select count(*) from public.map_location_viewers v where v.session_id = s.id)
      ) as row
      from public.map_location_sessions s
      where s.stopped_at is null and s.expires_at > now()
      limit 100
    ) t
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.map_admin_active_shares() to authenticated;
revoke execute on function public.map_admin_active_shares() from public, anon;
