-- 0021_storage_owner_select.sql
--
-- Storage API, silme isleminden once nesneyi okuyabilmelidir. Herkese acik
-- kovalarda (avatars, covers, posts, stories, listing-images) yalnizca INSERT
-- ve DELETE politikasi vardi; SELECT politikasi olmadigi icin kullanicinin
-- kendi dosyasini silme cagrisi sessizce 0 nesne siliyordu (hesap silme akisi
-- bu yuzden "media_cleanup_required" ile duruyordu).
--
-- Bu politika yalnizca kullanicinin KENDI klasorunu okumasina izin verir;
-- dosyalar zaten public bucket oldugu icin yeni bir ifsa riski olusturmaz.
-- Yalnizca ekleme yapar.

drop policy if exists storage_owner_select_own on storage.objects;

create policy storage_owner_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = any (array['avatars', 'covers', 'posts', 'stories', 'listing-images'])
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
