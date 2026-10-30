-- 0141_live_news_share_fix.sql
--
-- Anlık gelişme paylaşım kartında Open Graph görselinin her zaman bir
-- görsel olmasını sağlar. Önceden medya sıralamasındaki ilk öğe video ise
-- `og:image` doğrudan mp4 adresine işaret ediyordu; WhatsApp/Telegram gibi
-- istemciler kartı görselsiz gösteriyordu.
--
-- Ayrıca doğrulanmış ve doğrulanmamış içerik için kart etiketi ayrıştırılır;
-- böylece paylaşım önizlemesi yanlışlıkla "doğrulandı" izlenimi vermez.

create or replace function public.live_news_share_card(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.live_news%rowtype;
  v_profile public.profiles%rowtype;
  v_media public.post_media%rowtype;
  v_views bigint;
  v_image_path text;
  v_label text;
begin
  select * into v_row
  from public.live_news
  where post_id = p_post_id and moderation_status = 'visible';

  if not found then
    return null;
  end if;

  select * into v_profile from public.profiles where id = v_row.author_id;

  -- Önce gerçek fotoğraf, yoksa video kapağı. Video dosyası asla og:image
  -- olarak verilmez.
  select * into v_media
  from public.post_media
  where post_id = p_post_id
  order by (media_type = 'image') desc, sort_order
  limit 1;

  if found then
    v_image_path := case
      when v_media.media_type = 'image' then v_media.storage_path
      else v_media.thumbnail_path
    end;
  end if;

  select coalesce(c.unique_views, 0) into v_views
  from public.content_view_counters c
  where c.content_type = 'post' and c.content_id = p_post_id;

  v_label := case
    when v_row.verification_status = 'verified' then 'Doğrulanmış Anlık Gelişme'
    when v_row.verification_status = 'corrected' then 'Düzeltilmiş Anlık Gelişme'
    else 'Vatandaş Paylaşımı'
  end;

  return jsonb_build_object(
    'type', 'live',
    'label', v_label,
    'title', left(v_row.title, 120),
    'description', left(
      coalesce(nullif(v_row.summary, ''), v_row.title) ||
      case when v_row.district is not null then ' · ' || v_row.district end,
      220
    ),
    'path', '/anlik-haber/' || p_post_id::text,
    'deep_link', 'trabzone://live-news/' || p_post_id::text,
    'bucket', 'posts',
    'image_path', v_image_path,
    'author_name', trim(coalesce(v_profile.first_name, '') || ' ' || coalesce(v_profile.last_name, '')),
    'author_username', v_profile.username,
    'published_at', v_row.published_at,
    'location', v_row.district,
    'metrics', concat(coalesce(v_views, 0), ' görüntülenme'),
    'verification_status', v_row.verification_status,
    'live_news', true
  );
end;
$$;

revoke all on function public.live_news_share_card(uuid) from public, anon, authenticated;
grant execute on function public.live_news_share_card(uuid) to anon, authenticated, service_role;

comment on function public.live_news_share_card(uuid) is
  'Anlık gelişme için /p/gelisme/{id} paylaşım kartı; kapak her zaman görseldir.';
