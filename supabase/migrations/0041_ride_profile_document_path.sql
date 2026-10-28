-- 0041 · Kullanıcı kendi doğrulama belgelerini önizleyebilsin.
--
-- `ride_my_profile` yalnızca çağıran kullanıcının kayıtlarını döndürür ve
-- belge yolu istemcide 120 saniyelik imzalı bağlantıya çevrilir. Storage
-- politikası (0040) aynı klasör kuralını uyguladığı için kullanıcı yalnızca
-- kendi belgesini görebilir.

create or replace function public.ride_my_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_m public.ride_member_profiles%rowtype;
  v_vehicle_count int;
begin
  perform public.ride_member_ensure(v_uid);
  select * into v_m from public.ride_member_profiles where user_id = v_uid;

  select count(*) into v_vehicle_count
  from public.ride_vehicles where owner_id = v_uid and is_active;

  return jsonb_build_object(
    'user_id', v_uid,
    'identity_status', v_m.identity_status,
    'driver_status', v_m.driver_status,
    'driver_bio', v_m.driver_bio,
    'level', v_m.level,
    'completed_trips', v_m.completed_trips,
    'cancelled_trips', v_m.cancelled_trips,
    'rating_avg', v_m.rating_avg,
    'review_count', v_m.review_count,
    'preferences', v_m.preferences,
    'vehicle_count', v_vehicle_count,
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'kind', v.kind, 'status', v.status,
        'expires_at', v.expires_at, 'reject_reason', v.reject_reason,
        'created_at', v.created_at,
        'reviewed_at', v.reviewed_at,
        'document_path', v.document_path,
        'meta', v.meta
      ) order by v.created_at desc)
      from public.ride_verifications v where v.user_id = v_uid
    ), '[]'::jsonb),
    'policy', public.ride_policy()
  );
end;
$$;

grant execute on function public.ride_my_profile() to authenticated;
