-- ---------------------------------------------------------------------------
-- 0100 — news_connection_row_json: jsonb_build_object argüman sınırı düzeltmesi
--
-- PostgreSQL jsonb_build_object() en fazla 100 argüman (50 anahtar/değer çifti)
-- kabul eder. Kaynak satırı 60'tan fazla alan döndürdüğü için fonksiyon
-- "cannot pass more than 100 arguments to a function" (54023) hatası veriyordu.
-- Aynı çıktı şeması korunarak nesne üç parçada kurulup birleştirilir.
-- ---------------------------------------------------------------------------

create or replace function public.news_connection_row_json(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.news_api_connections%rowtype;
  v_cred public.news_api_credentials%rowtype;
  v_profile public.news_source_profiles%rowtype;
begin
  select * into v_c from public.news_api_connections where id = p_id;
  if not found then
    return null;
  end if;
  select * into v_cred from public.news_api_credentials where connection_id = p_id;
  select * into v_profile from public.news_source_profiles where connection_id = p_id;

  return jsonb_build_object(
    'id', v_c.id,
    'code', v_c.code,
    'name', v_c.name,
    'description', v_c.description,
    'homepage_url', v_c.homepage_url,
    'feed_url', v_c.feed_url,
    'connector_kind', v_c.connector_kind,
    'http_method', v_c.http_method,
    'auth_kind', v_c.auth_kind,
    'auth_header_name', v_c.auth_header_name,
    'auth_query_param', v_c.auth_query_param,
    'auth_username', v_c.auth_username,
    'has_credentials', v_cred.vault_secret_id is not null,
    'secret_hint', v_cred.secret_hint,
    'default_params', v_c.default_params,
    'items_path', v_c.items_path,
    'pagination_kind', v_c.pagination_kind,
    'pagination_param', v_c.pagination_param,
    'next_path', v_c.next_path,
    'since_param', v_c.since_param,
    'field_hints', v_c.field_hints,
    'timezone', v_c.timezone,
    'poll_interval_minutes', v_c.poll_interval_minutes,
    'status', v_c.status,
    'health_status', v_c.health_status,
    'auto_publish_enabled', v_c.auto_publish_enabled,
    'publish_mode', v_c.publish_mode,
    'publisher_profile_id', v_c.publisher_profile_id,
    'license_status', v_c.license_status,
    'license_note', v_c.license_note
  ) || jsonb_build_object(
    'max_items_per_run', v_c.max_items_per_run,
    'page_limit', v_c.page_limit,
    'request_timeout_ms', v_c.request_timeout_ms,
    'max_response_bytes', v_c.max_response_bytes,
    'retry_count', v_c.retry_count,
    'backoff_seconds', v_c.backoff_seconds,
    'daily_request_budget', v_c.daily_request_budget,
    'requests_today', v_c.requests_today,
    'rate_limited_until', v_c.rate_limited_until,
    'min_publish_interval_seconds', v_c.min_publish_interval_seconds,
    'ai_classification', v_c.ai_classification,
    'regions', v_c.regions,
    'notes', v_c.notes,
    'archived_at', v_c.archived_at,
    'purge_profile', v_c.purge_profile,
    'last_item_at', v_c.last_item_at,
    'last_checked_at', v_c.last_checked_at,
    'last_success_at', v_c.last_success_at,
    'last_error', v_c.last_error,
    'last_error_at', v_c.last_error_at,
    'last_http_status', v_c.last_http_status,
    'last_response_ms', v_c.last_response_ms,
    'last_test_at', v_c.last_test_at,
    'last_test_ok', v_c.last_test_ok,
    'last_test_detail', v_c.last_test_detail,
    'auto_disabled_reason', v_c.auto_disabled_reason,
    'created_at', v_c.created_at,
    'updated_at', v_c.updated_at
  ) || jsonb_build_object(
    'profile', case when v_profile.id is null then null else jsonb_build_object(
      'id', v_profile.id,
      'profile_id', v_profile.profile_id,
      'display_name', v_profile.display_name,
      'username', v_profile.username,
      'avatar_url', v_profile.avatar_url,
      'cover_url', v_profile.cover_url,
      'description', v_profile.description,
      'website', v_profile.website,
      'verified', v_profile.verified,
      'verification_note', v_profile.verification_note,
      'status', v_profile.status
    ) end,
    'stats', public.news_connection_stats(p_id)
  );
end;
$$;

revoke all on function public.news_connection_row_json(uuid) from public;
grant execute on function public.news_connection_row_json(uuid) to authenticated, service_role;
