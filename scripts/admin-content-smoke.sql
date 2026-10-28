begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e7dc7277-5c24-4af6-81ea-d62abf157433","role":"authenticated","session_id":"test-session-1","aal":"aal2"}',
  true
);

select jsonb_build_object(
  'posts', public.admin_posts_list(null, null, null, null, 2, 0),
  'reels', public.admin_reels_list(null, null, null, null, 2, 0),
  'stories', public.admin_stories_list(null, null, false, 2, 0),
  'comments', public.admin_comments_list(null, null, 2, 0),
  'messaging', public.admin_messaging_overview(now() - interval '30 days', now()),
  'message_reports', public.admin_message_reports('all', 2, 0)
) as result;

rollback;
