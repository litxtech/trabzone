select jsonb_build_object(
  'profile_bio', (select bio from public.profiles where username='trabzonehaber'),
  'publications', coalesce((
    select jsonb_agg(jsonb_build_object(
      'title', d.title,
      'body', po.body,
      'media_path', pm.storage_path,
      'media_credit', ma.credit,
      'license', ma.license_code,
      'alt', ma.alt_text,
      'public_post', public.ai_news_public_post(pub.post_id)
    ) order by pub.published_at desc)
    from public.ai_news_publications pub
    join public.ai_news_drafts d on d.id=pub.draft_id
    join public.posts po on po.id=pub.post_id
    left join public.post_media pm on pm.post_id=po.id
    left join public.ai_news_media_assets ma on ma.event_id=pub.event_id and ma.status='published'
    where pub.status='published'
  ), '[]'::jsonb)
) as result;
