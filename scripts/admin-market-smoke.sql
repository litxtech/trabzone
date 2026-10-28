begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e7dc7277-5c24-4af6-81ea-d62abf157433","role":"authenticated","session_id":"test-session-1","aal":"aal2"}',
  true
);

select jsonb_build_object(
  'market_overview', public.admin_marketplace_overview(),
  'commission_settings', public.admin_commission_settings_list(),
  'finance', public.admin_finance_overview(now() - interval '30 days', now()),
  'transactions', public.admin_finance_transactions('all', null, now() - interval '30 days', now(), 5, 0)
) as result;

rollback;
