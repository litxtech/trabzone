-- ---------------------------------------------------------------------------
-- Konaklama medyasını oda tipine bağlama
--
-- Fotoğraf/video yükleme ekranı medyayı tesise ekliyordu; oda tipi için ayrı
-- bir görsel seçilemiyordu. Oda tipi kartlarında görsel önizleme oluşabilmesi
-- için mevcut bir medya kaydının oda tipi ataması sonradan değiştirilebilir.
-- ---------------------------------------------------------------------------

create or replace function public.acc_media_update(
  p_media_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.acc_property_media%rowtype;
  v_uid uuid;
  v_cover boolean;
  v_room_type_id uuid;
begin
  select * into m from public.acc_property_media where id = p_media_id;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;

  v_uid := public.acc_require(m.property_id, 'media');
  v_cover := coalesce(nullif(p_payload->>'cover', '')::boolean, m.cover);

  -- `room_type_id` anahtarı gönderildiyse atama değişir; boş değer tesise taşır.
  v_room_type_id := case
    when p_payload ? 'room_type_id'
      then nullif(btrim(coalesce(p_payload->>'room_type_id', '')), '')::uuid
    else m.room_type_id
  end;

  if v_room_type_id is not null and not exists (
    select 1 from public.acc_room_types
    where id = v_room_type_id and property_id = m.property_id
  ) then
    raise exception 'room_type_not_found' using errcode = 'P0002';
  end if;

  if v_cover and not m.cover then
    update public.acc_property_media
       set cover = false
     where property_id = m.property_id
       and room_type_id is not distinct from v_room_type_id
       and kind = 'image';
  end if;

  -- Kapak medyası başka bir oda tipine/tesise taşınırsa eski kapak yolu
  -- güncelliğini yitirir; herkese açık detayda eski görsel görünmesin.
  if m.room_type_id is distinct from v_room_type_id and m.cover then
    if m.room_type_id is null then
      update public.acc_properties
         set cover_path = null
       where id = m.property_id and cover_path = m.storage_path;
    else
      update public.acc_room_types
         set cover_path = null
       where id = m.room_type_id and cover_path = m.storage_path;
    end if;
  end if;

  update public.acc_property_media
     set category = coalesce(nullif(p_payload->>'category', ''), category),
         caption = case when p_payload ? 'caption'
           then nullif(btrim(coalesce(p_payload->>'caption', '')), '') else caption end,
         cover = v_cover,
         sort_order = coalesce(nullif(p_payload->>'sort_order', '')::int, sort_order),
         room_type_id = v_room_type_id
   where id = p_media_id
  returning * into m;

  if v_cover and m.kind = 'image' then
    if m.room_type_id is null then
      update public.acc_properties set cover_path = m.storage_path where id = m.property_id;
    else
      update public.acc_room_types set cover_path = m.storage_path where id = m.room_type_id;
    end if;
  end if;

  return to_jsonb(m);
end;
$$;

grant execute on function public.acc_media_update(uuid, jsonb) to authenticated, service_role;
