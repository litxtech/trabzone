import { supabase } from '@/services/supabase/client';

import type { HubPage } from './types';

/**
 * `/trabzon[/ilçe][/bölüm][/kategori]` sayfasının verisini okur.
 *
 * Sunucu tarafı aynı RPC'yi (`seo_hub_page`) kullanır; burada dönen `null`
 * "bu kombinasyonda yayınlanmış ilan yok" anlamına gelir ve ekran noindex
 * bir boş durum gösterir.
 */
export async function fetchHubPage(segments: string[], limit = 24): Promise<HubPage | null> {
  const { data, error } = await supabase.rpc('seo_hub_page', {
    p_path: segments,
    p_limit: limit,
  });

  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.ok !== true || Number(data.total ?? 0) <= 0) {
    return null;
  }
  return data as HubPage;
}
