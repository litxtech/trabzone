-- =====================================================================
-- 0040 — Kimlik/araç belgesi erişimini yalnızca doğrulama yetkisine indir.
--
-- Önceki politika `ride.view` izni olan her personele özel belgeleri
-- okuyabiliyordu. Bu, finans ve analitik rollerinin kimlik belgesi
-- görmesine yol açıyordu. Politika artık `ride.verify` ister.
-- =====================================================================

set search_path = public, extensions;

drop policy if exists ride_documents_select on storage.objects;
create policy ride_documents_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ride-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_permission('ride.verify')
    )
  );
