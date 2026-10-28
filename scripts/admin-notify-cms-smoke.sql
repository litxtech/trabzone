begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e7dc7277-5c24-4af6-81ea-d62abf157433","role":"authenticated","session_id":"test-session-1","aal":"aal2"}',
  true
);

select public.admin_campaign_audience_preview('{"type":"all"}'::jsonb) as all_audience;
select public.admin_campaign_audience_preview('{"type":"user","value":"e7dc7277-5c24-4af6-81ea-d62abf157433"}'::jsonb) as self_audience;
select public.admin_campaign_audience_preview('{"type":"language","value":"tr"}'::jsonb) as tr_audience;

select public.admin_campaign_save(
  null,
  'SMOKE Test Bildirimi',
  'Bu bir test bildirimidir, yayınlanmayacaktır.',
  null,
  '/notifications',
  '{"type":"user","value":"e7dc7277-5c24-4af6-81ea-d62abf157433"}'::jsonb,
  null,
  true,
  'smoke testi'
) as sent_campaign;

select public.admin_campaigns_list(null, 'SMOKE', 10, 0) as campaign_list;

select public.admin_cms_page_save(
  'smoke-test-page',
  'Smoke Test Sayfası',
  'Bu sayfa yalnızca smoke testi sırasında vardır.',
  'tr',
  true,
  'smoke testi'
) as saved_page;

select public.admin_cms_pages_list('smoke', null, 10, 0) as cms_list;
select public.content_page_get('smoke-test-page') as public_page;
select public.admin_cms_page_archive('smoke-test-page', 'smoke testi') as archived_page;
select public.content_page_get('smoke-test-page') as public_page_after_archive;

select public.admin_announcement_save(
  null, 'Smoke Duyurusu', 'Test duyurusu', 'info', now(), null, true, 'smoke testi'
) as announcement;

select public.admin_announcements_list() as announcements;
select public.app_active_announcements() as active_announcements;

rollback;
