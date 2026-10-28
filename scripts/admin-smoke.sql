begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e7dc7277-5c24-4af6-81ea-d62abf157433","role":"authenticated","session_id":"test-session-1","aal":"aal2"}',
  true
);

select jsonb_build_object(
  'me', public.admin_me(),
  'overview_stats', public.admin_overview(now() - interval '30 days', now()) -> 'stats',
  'overview_deltas', public.admin_overview(now() - interval '30 days', now()) -> 'deltas',
  'overview_growth_tail', (
    select jsonb_agg(x) from (
      select value from jsonb_array_elements(public.admin_overview(now() - interval '30 days', now()) -> 'growth')
      with ordinality as t(value, ord)
      order by ord desc limit 3
    ) x
  ),
  'users', public.admin_users_list(null, null, null, null, null, false, 3, 0),
  'user_detail_counts', public.admin_user_detail('e7dc7277-5c24-4af6-81ea-d62abf157433') -> 'counts',
  'settings_count', jsonb_array_length(public.admin_settings_get() -> 'items'),
  'feature_count', jsonb_array_length(public.admin_feature_flags_list() -> 'items'),
  'roles', (select jsonb_agg(jsonb_build_object('key', value ->> 'key', 'permissions', jsonb_array_length(value -> 'permissions')))
            from jsonb_array_elements(public.admin_roles_overview() -> 'roles')),
  'security_stats', public.admin_security_overview() -> 'stats',
  'mfa_required', public.admin_security_overview() -> 'mfa_required'
) as result;

rollback;
