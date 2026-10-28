-- 0081 — Remove the legacy 7-argument chat_send_message overload.
--
-- 0078 added client-side idempotency by creating an 8-argument version
-- (p_client_id uuid default null) without dropping the original. PostgREST
-- then reported PGRST203 "could not choose the best candidate function" for
-- every call that omitted p_client_id (older clients and the smoke suite).
-- The 8-argument function fully replaces the old one and keeps a default, so
-- dropping the legacy overload is safe for existing callers.

drop function if exists public.chat_send_message(
  uuid, text, text, text, jsonb, uuid, jsonb
);
