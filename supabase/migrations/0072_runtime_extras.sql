-- =============================================================================
-- 0072: Canlı destek durumu + eksik e-posta şablonları
-- =============================================================================

set search_path = public, extensions;

create or replace function public.support_live_presence()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_online integer;
begin
  select count(*) into v_online
  from public.support_agent_presence
  where status = 'online'
    and last_seen_at > now() - interval '2 minutes';

  return jsonb_build_object(
    'online', v_online > 0,
    'agents_online', v_online,
    'checked_at', now()
  );
end
$$;

revoke all on function public.support_live_presence() from public;
grant execute on function public.support_live_presence() to anon, authenticated;

insert into public.email_templates (key, locale, subject, body_html, body_text) values
  ('privacy_request_received', 'tr',
   'Trabzone veri talebin alındı — {{request_no}}',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Kişisel veri talebin alındı.</p><p>Referans: <strong>{{request_no}}</strong></p><p>Konu: {{subject}}</p><p>Talebin yetkili ekip tarafından mevzuatta öngörülen süre içinde yanıtlanacak.</p></div></div>',
   'Veri talebin alındı. Referans: {{request_no}}'),
  ('contact_received', 'tr',
   'Trabzone iletişim formun alındı — {{reference_code}}',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Mesajın bize ulaştı.</p><p>Referans: <strong>{{reference_code}}</strong></p><p>Konu: {{topic}}</p><p>Ekibimiz mesajını inceleyip dönüş yapacak.</p></div></div>',
   'Mesajın alındı. Referans: {{reference_code}}')
on conflict (key, locale) do nothing;
