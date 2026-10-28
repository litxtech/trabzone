-- 0074_contact_admin_hardening.sql
--
-- İletişim formu yönetimi ve hesap silme taleplerinde kimlik doğrulama
-- zorunluluğu. Mevcut kullanıcıları, talepleri veya sürümleri silmez.

alter table public.contact_submissions
  add column if not exists response_text text,
  add column if not exists responded_at timestamptz,
  add column if not exists responded_by uuid references public.profiles (id) on delete set null;

create index if not exists contact_submissions_status_created_idx
  on public.contact_submissions (status, created_at desc);

-- Çocuk güvenliği konulu form mesajları normal kuyrukta kaybolmasın diye
-- yönetici listesinde öncelik bilgisiyle döner.
create or replace function public.admin_contact_submissions(
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  perform public.require_permission('website.manage');

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(item order by
        case when item ->> 'priority' = 'critical' then 0 else 1 end,
        item ->> 'created_at' desc)
      from (
        select jsonb_build_object(
          'id', c.id, 'reference_code', c.reference_code,
          'name', c.name, 'email', c.email, 'topic', c.topic,
          'message', c.message, 'status', c.status, 'created_at', c.created_at,
          'response_text', c.response_text,
          'responded_at', c.responded_at,
          'priority', case when c.topic = 'child_safety' then 'critical' else 'normal' end
        ) as item
        from public.contact_submissions c
        where p_status is null or c.status = p_status
        order by c.created_at desc
        limit v_limit offset v_offset
      ) s
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.admin_contact_submissions(text, integer, integer) from public, anon;
grant execute on function public.admin_contact_submissions(text, integer, integer) to authenticated;

create or replace function public.admin_contact_submission_update(
  p_id uuid,
  p_status text,
  p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.contact_submissions%rowtype;
  v_response text := nullif(btrim(coalesce(p_response, '')), '');
begin
  perform public.require_permission('website.manage');

  if p_status not in ('received', 'in_review', 'answered', 'closed', 'spam') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.contact_submissions where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;

  update public.contact_submissions
     set status = p_status,
         response_text = coalesce(v_response, response_text),
         responded_at = case when v_response is not null then now() else responded_at end,
         responded_by = case when v_response is not null then v_uid else responded_by end,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  if v_response is not null and p_status in ('answered', 'closed') then
    perform public.tz_enqueue_email(
      'support_reply',
      v_row.email,
      jsonb_build_object(
        'name', split_part(v_row.name, ' ', 1),
        'reply', v_response,
        'reference', v_row.reference_code
      ),
      v_row.user_id,
      'tr',
      'contact-reply:' || v_row.id::text || ':' || extract(epoch from now())::text
    );
  end if;

  perform public.safety_audit(
    'website.contact.update',
    'İletişim formu mesajı güncellendi',
    'contact_submission',
    v_row.reference_code,
    jsonb_build_object('status', p_status, 'answered', v_response is not null)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'responded_at', v_row.responded_at
  );
end
$$;

revoke all on function public.admin_contact_submission_update(uuid, text, text) from public, anon;
grant execute on function public.admin_contact_submission_update(uuid, text, text) to authenticated;

-- Giriş yapamayan kullanıcıların web silme talepleri, kimlik doğrulanmadan
-- "tamamlandı" olarak işaretlenemez. Self-servis (requested_via='app')
-- akışı bu kontrolden muaftır; orada kimlik zaten oturumla doğrulanır.
create or replace function public.tz_deletion_require_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed'
     and new.requested_via = 'web'
     and coalesce(new.identity_verified, false) is not true then
    raise exception 'identity_not_verified' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists tz_deletion_require_identity on public.account_deletion_requests;
create trigger tz_deletion_require_identity
  before insert or update of status, identity_verified, requested_via
  on public.account_deletion_requests
  for each row
  execute function public.tz_deletion_require_identity();

comment on function public.admin_contact_submission_update(uuid, text, text) is
  'İletişim formu mesajını yanıtlar; yanıt e-posta kuyruğuna eklenir.';
