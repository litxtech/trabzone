-- ---------------------------------------------------------------------------
-- 0079 — Mesaj teslim/okundu makbuzlarının gönderene canlı yansıması
--
-- `message_receipts_select` yalnızca makbuzun sahibine (alıcıya) izin veriyordu.
-- Supabase Realtime, satırı gönderene iletirken SELECT politikasını uyguladığı
-- için "İletildi / Okundu" tikleri canlı güncellenemiyordu.
--
-- Gönderen yalnızca kendi mesajlarının makbuzlarını görebilir. Bu kayıtlar
-- zaten `tz_message_json` içinde teslim durumunu hesaplamak için kullanılıyor;
-- başka bir sohbetin makbuzu hiçbir koşulda açığa çıkmaz.
-- ---------------------------------------------------------------------------

drop policy if exists message_receipts_sender_select on public.message_receipts;
create policy message_receipts_sender_select on public.message_receipts
  for select to authenticated
  using (
    exists (
      select 1
      from public.messages m
      where m.id = message_receipts.message_id
        and m.sender_id = auth.uid()
    )
  );

-- Realtime yayını idempotent biçimde garanti edilir (daha önce eklenmişse atlanır).
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach v_table in array array['messages', 'message_receipts', 'message_media']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;
