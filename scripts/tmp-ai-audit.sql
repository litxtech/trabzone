select set_config('request.jwt.claims', '{"sub":"e7dc7277-5c24-4af6-81ea-d62abf157433","role":"authenticated"}', false);
set local role authenticated;
select public.get_profile_view('trabzonehaber') as profile;
select public.feed_profile_posts('trabzonehaber', 'posts', 18, 0) as posts;
