begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e7dc7277-5c24-4af6-81ea-d62abf157433","role":"authenticated","session_id":"test-session-1","aal":"aal2"}',
  true
);

select public.admin_shell_counts() as shell;
select jsonb_array_length(public.admin_report_catalog()->'items') as report_count;
select public.admin_audit_center(null, null, null, now() - interval '30 days', now(), 3, 0) as audit;
select public.admin_orders_table(null, null, null, 3, 0) as orders;
select public.admin_support_templates_list() as templates;
select public.admin_support_template_save(null, 'Smoke şablonu', 'technical', 'Merhaba, talebiniz inceleniyor.', true, 'smoke testi') as template;
rollback;
