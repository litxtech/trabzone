-- =====================================================================
-- 0036 — Araç fotoğrafları için herkese açık, yazma korumalı kova
--
-- Yalnızca görsel dosyalar; yol kullanıcı kimliğiyle başlar. Okuma herkese
-- açıktır çünkü araç fotoğrafı ilan kartında gösterilir. Belge kovası gizli
-- kalır (0033); buraya asla ruhsat/ehliyet yüklenmez.
-- =====================================================================

set search_path = public, extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ride-vehicle-photos', 'ride-vehicle-photos', true, 8388608,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ride_vehicle_photos_insert on storage.objects;
create policy ride_vehicle_photos_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ride-vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists ride_vehicle_photos_select on storage.objects;
create policy ride_vehicle_photos_select
  on storage.objects for select to public
  using (bucket_id = 'ride-vehicle-photos');

drop policy if exists ride_vehicle_photos_delete on storage.objects;
create policy ride_vehicle_photos_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ride-vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
