-- =====================================================================
-- 0218 — Konaklama medya ve gizli belge deposu
--
-- Tesis fotoğrafları/videoları herkese açık R2 kovasında
-- (`accommodation-media`) tutulur. İşletme belgeleri ise yalnızca yetkili
-- personelin imzalı adresle okuyabildiği gizli Supabase Storage kovasındadır.
-- =====================================================================

set search_path = public, extensions;

insert into storage.buckets (id, name, public, file_size_limit)
values ('accommodation-documents', 'accommodation-documents', false, 15728640)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

drop policy if exists acc_documents_insert on storage.objects;
create policy acc_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'accommodation-documents'
    and public.acc_can(
      case when ((storage.foldername(name))[1]) ~ '^[0-9a-fA-F-]{36}$'
        then ((storage.foldername(name))[1])::uuid end,
      'property'
    )
  );

drop policy if exists acc_documents_select on storage.objects;
create policy acc_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'accommodation-documents'
    and (
      public.acc_can(
        case when ((storage.foldername(name))[1]) ~ '^[0-9a-fA-F-]{36}$'
          then ((storage.foldername(name))[1])::uuid end,
        'read'
      )
      or public.is_admin()
    )
  );

drop policy if exists acc_documents_update on storage.objects;
create policy acc_documents_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'accommodation-documents'
    and public.acc_can(
      case when ((storage.foldername(name))[1]) ~ '^[0-9a-fA-F-]{36}$'
        then ((storage.foldername(name))[1])::uuid end,
      'property'
    )
  )
  with check (
    bucket_id = 'accommodation-documents'
    and public.acc_can(
      case when ((storage.foldername(name))[1]) ~ '^[0-9a-fA-F-]{36}$'
        then ((storage.foldername(name))[1])::uuid end,
      'property'
    )
  );

drop policy if exists acc_documents_delete on storage.objects;
create policy acc_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'accommodation-documents'
    and (
      public.acc_can(
        case when ((storage.foldername(name))[1]) ~ '^[0-9a-fA-F-]{36}$'
          then ((storage.foldername(name))[1])::uuid end,
        'property'
      )
      or public.is_admin()
    )
  );
