-- 0058: Medyada süre ve dosya boyutu sınırının kaldırılması
--
-- Ürün kuralı: kullanıcı hangi uzunlukta ve boyutta video paylaşırsa paylaşsın
-- içerik kabul edilir. İstemci artık videoyu sabit bir megabayta sığdırmıyor;
-- yalnızca 1080p üzeri kaynakları çözünürlük için yeniden kodluyor.
--
-- 1) Kova başına dosya sınırı pratik üst sınır olan 5 GB'a çıkarılır. Gerçek
--    tavan proje planının "global file size limit" ayarıdır; bu değer onun
--    üzerine çıkmaz, yalnızca kova tarafındaki 50 MB engelini kaldırır.
-- 2) Reels süre kontrolündeki 24 saatlik üst sınır kaldırılır.
-- 3) reel_create içindeki 24 saatlik doğrulama kaldırılır.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Storage: tek dosya sınırı
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 5368709120
 where id in (
   'posts',
   'stories',
   'reels',
   'message-media',
   'listing-images',
   'place-media',
   'real-estate-media'
 );

-- ---------------------------------------------------------------------------
-- 2. Reels süre kontrolü: yalnızca negatif değer reddedilir
-- ---------------------------------------------------------------------------
alter table public.reels drop constraint if exists reels_duration_check;
alter table public.reels add constraint reels_duration_check
  check (duration_ms is null or duration_ms >= 0);

-- ---------------------------------------------------------------------------
-- 3. reel_create: süre üst sınırı kaldırıldı
-- ---------------------------------------------------------------------------
create or replace function public.reel_create(
  p_video_path  text,
  p_cover_path  text default null,
  p_caption     text default null,
  p_audio_title text default null,
  p_duration_ms integer default null,
  p_width       integer default null,
  p_height      integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.tz_require_uid();
  v_caption text := nullif(trim(coalesce(p_caption, '')), '');
  v_audio   text := nullif(trim(coalesce(p_audio_title, '')), '');
  v_cover   text := nullif(trim(coalesce(p_cover_path, '')), '');
  v_reel_id uuid;
begin
  perform public.tz_validate_media_path(p_video_path, v_uid);
  if v_cover is not null then
    perform public.tz_validate_media_path(v_cover, v_uid);
  end if;

  if v_caption is not null and char_length(v_caption) > 2200 then
    raise exception 'caption_too_long' using errcode = '22023';
  end if;

  if v_audio is not null and char_length(v_audio) > 120 then
    raise exception 'invalid_audio' using errcode = '22023';
  end if;

  -- Süre sınırı yok: yalnızca anlamsız negatif değerler reddedilir.
  if p_duration_ms is not null and p_duration_ms < 0 then
    raise exception 'invalid_media_meta' using errcode = '22023';
  end if;

  perform public.safety_check_rate('reel_create', 20, interval '1 day');

  insert into public.reels (
    author_id, video_path, cover_path, caption, audio_title,
    duration_ms, width, height, status
  )
  values (
    v_uid, p_video_path, v_cover, v_caption, v_audio,
    p_duration_ms, p_width, p_height, 'ready'
  )
  returning id into v_reel_id;

  return public.tz_reel_json(v_reel_id, v_uid);
end;
$$;

revoke all on function public.reel_create(text, text, text, text, integer, integer, integer) from public, anon;
grant execute on function public.reel_create(text, text, text, text, integer, integer, integer) to authenticated;
