-- =====================================================================
-- 0058 — Yeni kategori gruplarına otomatik "Diğer" alt kategorisi
--
-- Admin panelinden yeni bir ana kategori veya alt kategori grubu
-- oluşturulduğunda, kullanıcıların kategorisiz kalmaması için "Diğer"
-- seçeneği otomatik eklenir. "Diğer" kaydının kendisi tekrar tetiklemez.
-- =====================================================================

set search_path = public, pg_temp;

create or replace function public.market_category_ensure_other()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_depth integer := 0;
  v_slug text;
begin
  if new.name = 'Diğer' then
    return new;
  end if;

  if new.parent_id is not null then
    with recursive up as (
      select c.id, c.parent_id, 1 as depth
      from public.marketplace_categories c
      where c.id = new.parent_id
      union all
      select p.id, p.parent_id, up.depth + 1
      from public.marketplace_categories p
      join up on p.id = up.parent_id
    )
    select coalesce(max(depth), 0) into v_parent_depth from up;
  end if;

  -- Yalnızca ana kategori (0) ve alt kategori grubu (1) seviyesinde
  -- otomatik "Diğer" eklenir; en alt yaprakta gereksiz derinlik açılmaz.
  if v_parent_depth > 1 then
    return new;
  end if;

  v_slug := left(new.slug || '-diger', 80);

  insert into public.marketplace_categories (
    parent_id, slug, name, icon, kind, tone, description, aliases, form_schema,
    is_featured, sort_order, is_active
  )
  values (
    new.id, v_slug, 'Diğer', coalesce(new.icon, 'ellipsis-horizontal-outline'),
    coalesce(new.kind, 'product'), coalesce(new.tone, 'primary'),
    'Bu grupta yer alan diğer seçenekler', '{}'::text[],
    coalesce(new.form_schema, '{}'::jsonb), false, 9999, new.is_active
  )
  on conflict (slug) do nothing;

  return new;
end;
$$;

revoke all on function public.market_category_ensure_other() from public;

drop trigger if exists market_category_ensure_other_trg on public.marketplace_categories;
create trigger market_category_ensure_other_trg
  after insert on public.marketplace_categories
  for each row execute function public.market_category_ensure_other();

notify pgrst, 'reload schema';
