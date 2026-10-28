// Blog yazılarını Supabase'e aktarır.
//
// Kullanım:
//   node scripts/seed-blog.mjs            -> yalnızca eksik slug'ları ekler
//   node scripts/seed-blog.mjs --force    -> mevcut yazıların içeriğini de günceller
//
// Servis anahtarı yalnızca bu betikte ve sunucu tarafında kullanılır; istemci
// paketine asla girmez. RLS açık olduğu için doğrudan tablo yazımı service_role
// ile yapılır.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BLOG_POSTS } from './blog-seed-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv() {
  const raw = readFileSync(join(root, '.env'), 'utf8');
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

const env = readEnv();
const url = (env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!url || !key) {
  console.error('EXPO_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  process.exit(1);
}

const force = process.argv.includes('--force');

function wordCount(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function headers(extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: headers(options.headers),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const existing = await request('blog_posts?select=id,slug');
  const existingSlugs = new Set((existing ?? []).map((row) => row.slug));

  const toInsert = BLOG_POSTS.filter((post) => force || !existingSlugs.has(post.slug)).map(
    (post, index) => {
      const words = wordCount(post.body);
      const scheduled = post.publishedAt ? new Date(post.publishedAt).getTime() : Date.now();
      // İlk kurulumda tüm yazılar yayında olmalı: geleceğe tarihlenmiş seed
      // kayıtları "zamanlanmış" bırakmak yerine geçmişe çekiyoruz.
      const publishedAt = new Date(
        Math.min(Number.isFinite(scheduled) ? scheduled : Date.now(), Date.now() - index * 60_000),
      ).toISOString();
      return {
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        body_markdown: post.body,
        cover_image_url: post.coverImageUrl ?? null,
        cover_image_alt: post.coverAlt ?? null,
        category: post.category,
        tags: post.tags ?? [],
        seo_title: post.seoTitle ?? post.title,
        seo_description: post.seoDescription ?? post.excerpt,
        keywords: post.keywords ?? [],
        faq: post.faq ?? [],
        author_name: post.author ?? 'Trabzone Editör',
        status: 'published',
        is_featured: Boolean(post.featured),
        reading_minutes: Math.max(1, Math.ceil(words / 200)),
        word_count: words,
        ai_generated: false,
        ai_model: null,
        version: 1,
        published_at: publishedAt,
      };
    },
  );

  if (toInsert.length === 0) {
    console.log(`Güncellenecek yazı yok. Mevcut: ${existingSlugs.size}`);
    return;
  }

  const saved = await request('blog_posts?on_conflict=slug&select=id,slug,version', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(toInsert),
  });

  const versions = (saved ?? []).map((row) => {
    const post = BLOG_POSTS.find((item) => item.slug === row.slug);
    return {
      post_id: row.id,
      version: row.version ?? 1,
      title: post?.title ?? row.slug,
      body_markdown: post?.body ?? '',
      seo_title: post?.seoTitle ?? post?.title ?? null,
      seo_description: post?.seoDescription ?? post?.excerpt ?? null,
      status: 'published',
    };
  });

  if (versions.length > 0) {
    await request('blog_post_versions?on_conflict=post_id,version', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(versions),
    });
  }

  console.log(
    `${saved?.length ?? 0} blog yazısı yazıldı (${force ? 'zorla güncelleme' : 'yalnızca eksikler'}).`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
