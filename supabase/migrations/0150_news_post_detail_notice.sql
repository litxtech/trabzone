-- ---------------------------------------------------------------------------
-- 0147 — Kısa haber notu yalnızca gerçekten özet kalmış metinlerde görünsün
--
-- 0146 ile haberler AI/editoryal gövdeyle yayımlanmaya başladı. Kelime sayısı
-- eşiğin altında kalan özgün bir haber (ör. 300 kelime) 0134'ün biçim
-- kuralına göre "short" etiketi alıyor ve okuyucuya "özet olarak yayımlandı"
-- notu gösteriliyordu. O not yalnızca gövdesi kaynak özetinden ibaret
-- haberlerde gösterilmelidir.
-- ---------------------------------------------------------------------------

create or replace function public.news_post_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_kind text;
  v_words integer;
  v_format text;
  v_notice text;
  v_source_name text;
  v_item_body_source text;
  v_item_body text;
  s public.ai_news_settings%rowtype;
begin
  v := public._news_post_detail_legacy(p_post_id);
  if v is null then
    return null;
  end if;

  select * into s from public.ai_news_settings order by (id = true) desc limit 1;

  v_kind := coalesce(v ->> 'kind', 'source');
  v_words := greatest(coalesce((v ->> 'word_count')::integer, 0), 0);
  v_format := public.news_effective_format(v_words, v ->> 'body_format');
  v_source_name := coalesce(
    nullif(v -> 'source_card' ->> 'name', ''),
    nullif(v ->> 'published_by', ''),
    'haber kaynağı'
  );

  -- Gövdenin editorya tarafından yazılıp yazılmadığını bilmek için kaynak
  -- habere bakılır; özgün metin "özet" değildir.
  select i.body_source, i.body
    into v_item_body_source, v_item_body
  from public.news_publication_links l
    join public.news_source_items i on i.id = l.item_id
  where l.post_id = p_post_id
    and l.status = 'published'
  order by l.published_at
  limit 1;

  -- Okuma süresi: 200 kelime/dk, en az 1 dk.
  v := jsonb_set(v, '{reading_minutes}',
    to_jsonb(greatest(1, ceil(greatest(v_words, 1) / 200.0)::integer)), true);
  v := jsonb_set(v, '{body_format}', to_jsonb(v_format), true);

  if v_kind = 'source' then
    v := jsonb_set(v, '{disclosure}', to_jsonb(
      'Bu haber, ' || v_source_name ||
      ' tarafından kamuya açıklanan bilgilerden yararlanılarak Trabzone Haber editoryası tarafından yeniden yazılmıştır. ' ||
      'Orijinal kaynağa ve kaynak bilgisine sayfanın altından ulaşabilirsiniz.'
    ), true);

    if v_format = 'short'
       and not (
         coalesce(v_item_body_source, 'source') in ('ai', 'editor')
         and char_length(btrim(coalesce(v_item_body, ''))) >= 400
       ) then
      v_notice := 'Kısa haber: Bu metin, kaynakta yayımlanan doğrulanmış bilgilerle özetlenmiştir. Doğrulanmamış ayrıntı eklenmemiş, metin uzatılmamıştır. Tam metin için orijinal kaynağa gidebilirsiniz.';
    else
      v_notice := null;
    end if;
  else
    if v_format = 'short' then
      v_notice := case
        when s.short_min_words is not null and v_words < s.short_min_words then
          'Kısa haber: Kaynaklarda doğrulanmış bilgi sınırlı olduğu için haber kısa formatta yayımlanmıştır. Metni uzatmak için doğrulanmamış bilgi eklenmemiştir.'
        else
          'Kısa haber: Bu metin yalnızca kaynaklarla doğrulanmış bilgilerle hazırlanmıştır. Doğrulanmamış ayrıntı eklenmemiştir.'
      end;
    else
      v_notice := null;
    end if;
  end if;

  v := jsonb_set(v, '{body_notice}', to_jsonb(v_notice), true);

  return v;
end;
$$;

revoke all on function public.news_post_detail(uuid) from public, anon;
grant execute on function public.news_post_detail(uuid)
  to authenticated, service_role;
