-- ---------------------------------------------------------------------------
-- Admin oturum yaşam döngüsü
--
-- Yönetici paneli açıldığında oturum kaydı oluşturulur ve düzenli olarak
-- güncellenir. Çıkış yapıldığında ilgili oturum sunucuda iptal edilir; böylece
-- access token süresi dolmadan önce de yönetici RPC'leri reddedilir.
-- ---------------------------------------------------------------------------

create or replace function public.admin_logout_session()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if v_sid is null then
    return jsonb_build_object('revoked', false, 'reason', 'no_session_claim');
  end if;

  update public.admin_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoked_by = v_uid
   where session_id = v_sid
     and user_id = v_uid
     and revoked_at is null;

  get diagnostics v_count = row_count;

  return jsonb_build_object('revoked', v_count > 0, 'session_id', v_sid);
end;
$$;

revoke all on function public.admin_logout_session() from public, anon;
grant execute on function public.admin_logout_session() to authenticated;

-- İptal edilmiş bir oturum yeniden canlandırılamaz.
create or replace function public.admin_touch_session(p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.admin_permissions p where public.has_permission(p.code)
  ) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if v_sid is null then
    return jsonb_build_object('tracked', false, 'reason', 'no_session_claim');
  end if;

  if exists (
    select 1 from public.admin_sessions s
    where s.session_id = v_sid and s.revoked_at is not null
  ) then
    return jsonb_build_object('tracked', false, 'reason', 'session_revoked');
  end if;

  insert into public.admin_sessions (session_id, user_id, user_agent)
  values (v_sid, v_uid, left(coalesce(p_user_agent, ''), 240))
  on conflict (session_id) do update
    set last_seen_at = now(),
        user_agent = coalesce(nullif(left(excluded.user_agent, 240), ''), public.admin_sessions.user_agent);

  return jsonb_build_object('tracked', true, 'session_id', v_sid);
end;
$$;

revoke all on function public.admin_touch_session(text) from public, anon;
grant execute on function public.admin_touch_session(text) to authenticated;
