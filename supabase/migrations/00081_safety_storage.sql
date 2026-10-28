-- -----------------------------------------------------------------------------
-- 0008 — Guvenlik ekleri icin depolama politikalari
--
-- `safety-support` ve `safety-reports` kovalari gizlidir. Kullanici yalnizca
-- kendi klasorune yukler; personel yetkisi olanlar ekleri gorebilir.
-- -----------------------------------------------------------------------------

drop policy if exists safety_support_attachments_insert on storage.objects;
create policy safety_support_attachments_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'safety-support'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists safety_support_attachments_select on storage.objects;
create policy safety_support_attachments_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'safety-support'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_permission('support.view')
    )
  );

drop policy if exists safety_support_attachments_delete on storage.objects;
create policy safety_support_attachments_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'safety-support'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists safety_report_attachments_insert on storage.objects;
create policy safety_report_attachments_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'safety-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists safety_report_attachments_select on storage.objects;
create policy safety_report_attachments_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'safety-reports'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_permission('safety.report.view')
    )
  );

drop policy if exists safety_report_attachments_delete on storage.objects;
create policy safety_report_attachments_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'safety-reports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
