-- ---------------------------------------------------------------------------
-- 0138 — Tekil görüntüleme tablolarında yetki sıkılaştırması
--
-- Supabase varsayılan yetkileri `anon` / `authenticated` rollerine tablo
-- bazında TRUNCATE, TRIGGER ve REFERENCES de verebiliyor. RLS bu üç yetkiyi
-- engellemez. Görüntüleme ayarları ve içerik türü sözlüğü yalnızca okunabilir
-- olmalı; yazma yalnızca SECURITY DEFINER fonksiyonlarla yapılmalıdır.
-- ---------------------------------------------------------------------------

revoke truncate, trigger, references
  on public.view_content_types
  from public, anon, authenticated;

revoke truncate, trigger, references
  on public.view_count_settings
  from public, anon, authenticated;

revoke insert, update, delete, truncate, trigger, references
  on public.view_content_types
  from public, anon, authenticated;

revoke insert, update, delete, truncate, trigger, references
  on public.view_count_settings
  from public, anon, authenticated;

grant select on public.view_content_types to anon, authenticated;
grant select on public.view_count_settings to authenticated;

-- Sayaç ve tekil kayıt tablolarına istemciden doğrudan erişim yoktur.
-- Tüm okuma/yazma işlemleri doğrulama yapan RPC'lerden geçer.
revoke all
  on public.content_unique_views
  from public, anon, authenticated;
revoke all
  on public.content_view_counters
  from public, anon, authenticated;
revoke all
  on public.content_view_daily
  from public, anon, authenticated;
revoke all
  on public.content_view_active_accounts
  from public, anon, authenticated;
revoke all
  on public.content_view_errors
  from public, anon, authenticated;

-- Yönetici yardımcıları yalnızca oturum açmış istemciden çağrılabilir;
-- fonksiyon gövdeleri ayrıca tz_admin_require ile yetki doğrular.
revoke all on function public.admin_view_analytics() from public, anon;
revoke all on function public.admin_view_settings() from public, anon;
revoke all on function public.admin_view_settings_update(jsonb) from public, anon;
grant execute on function public.admin_view_analytics() to authenticated;
grant execute on function public.admin_view_settings() to authenticated;
grant execute on function public.admin_view_settings_update(jsonb) to authenticated;

revoke all on function public.content_view_prune() from public, anon, authenticated;
