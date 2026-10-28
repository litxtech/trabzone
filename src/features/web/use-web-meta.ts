import { useEffect } from 'react';
import { Platform } from 'react-native';

import { env } from '@/config/env';

type MetaInput = {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article';
  noIndex?: boolean;
};

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => element?.setAttribute(key, value));
}

/**
 * SPA yapılandırmasında (web.output = single) sayfa başlığı ve sosyal meta
 * etiketleri istemci tarafında güncellenir. Sunucu tarafı render'a geçilirse
 * aynı değerler statik HTML'e taşınmalıdır.
 */
export function useWebMeta({ title, description, path, type = 'website', noIndex }: MetaInput) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }
    const url = new URL(path, env.appUrl).toString();
    document.title = title;

    upsertMeta('meta[name="description"]', { name: 'description', content: description });
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: description,
    });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type });
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url });
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'Trabzone' });
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
    upsertMeta('meta[name="twitter:description"]', {
      name: 'twitter:description',
      content: description,
    });
    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: noIndex ? 'noindex,nofollow' : 'index,follow',
    });

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [description, noIndex, path, title, type]);
}
