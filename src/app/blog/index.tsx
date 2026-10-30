import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { BlogCard } from '@/features/blog/components/BlogCard';
import { useBlogList } from '@/features/blog/hooks/use-blog';
import type { BlogListItem } from '@/features/blog/types';
import { flatStyle } from '@/features/web/link-style';
import { PublicShell } from '@/features/web/components/PublicShell';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useTheme } from '@/theme/ThemeProvider';

const PAGE_SIZE = 12;

export default function BlogIndexScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ kategori?: string; q?: string; sayfa?: string }>();
  const category = typeof params.kategori === 'string' ? params.kategori : '';
  const initialSearch = typeof params.q === 'string' ? params.q : '';
  const page = Math.max(1, Number.parseInt(String(params.sayfa ?? '1'), 10) || 1);
  const [search, setSearch] = useState(initialSearch);
  // URL'deki `q` değişince arama alanı da güncel kalmalı. Prop → state
  // senkronizasyonu effect yerine render sırasında koşullu olarak yapılır
  // (React'in "adjusting state when props change" deseni).
  const [syncedSearch, setSyncedSearch] = useState(initialSearch);
  if (syncedSearch !== initialSearch) {
    setSyncedSearch(initialSearch);
    setSearch(initialSearch);
  }
  const wide = width >= 900;
  const cardWidth = wide ? '31.8%' : width >= 620 ? '48.6%' : '100%';

  const query = useBlogList({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    category: category || null,
    search: initialSearch,
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const categories = query.data?.categories ?? [];
  const featured = page === 1 && !category && !initialSearch ? items[0] : null;
  const rest = featured ? items.slice(1) : items;

  useWebMeta({
    title: category
      ? `${category} yazıları | Trabzone Blog`
      : 'Trabzon Blog | Gezi, Yaşam ve Şehir Rehberleri',
    description:
      'Trabzon gezi rehberleri, yaylalar, yemek kültürü, ulaşım, emlak ve günlük yaşam üzerine uzun biçimli yerel rehberler.',
    path: '/blog',
    noIndex: Boolean(category || initialSearch || page > 1),
  });

  const go = (next: { kategori?: string; q?: string; sayfa?: number }) => {
    const searchParams = new URLSearchParams();
    const nextCategory = next.kategori ?? category;
    const nextQuery = next.q ?? initialSearch;
    if (nextCategory) searchParams.set('kategori', nextCategory);
    if (nextQuery) searchParams.set('q', nextQuery);
    if ((next.sayfa ?? 1) > 1) searchParams.set('sayfa', String(next.sayfa));
    const suffix = searchParams.toString();
    router.push(`/blog${suffix ? `?${suffix}` : ''}` as Href);
  };

  return (
    <PublicShell
      title="Blog"
      subtitle="Gezi · Yaşam · Yerel rehberler"
      fallbackHref="/feed"
      webScroll
      webContentStyle={styles.scroll}
      nativeContentStyle={styles.nativeScroll}
    >
      <View style={styles.hero}>
        <AppText variant="overline" color="primary">
          TRABZON YEREL REHBERİ
        </AppText>
        <AppText variant="display" style={styles.title}>
          Trabzon Blog
        </AppText>
        <AppText variant="body" color="textSecondary" style={styles.lede}>
          Trabzon’u gezmek, orada yaşamak veya yatırım yapmak isteyenler için sahadan derlenmiş uzun
          rehberler. Ulaşım, yaylalar, yemek kültürü, emlak, öğrenci hayatı ve günlük pratikler.
        </AppText>
        <View style={styles.statRow}>
          <Stat icon="document-text-outline" label={`${total} yazı`} />
          <Stat icon="albums-outline" label={`${categories.length} kategori`} />
          <Stat icon="refresh-outline" label="Düzenli güncellenir" />
        </View>
      </View>

      <View style={[styles.toolbar, !wide && styles.toolbarStack]}>
        <View style={styles.searchWrap}>
          <TextField
            value={search}
            onChangeText={setSearch}
            placeholder="Blogda ara: yayla, hamsi, kiralık daire…"
            leftIcon="search-outline"
            returnKeyType="search"
            onSubmitEditing={() => go({ q: search, sayfa: 1 })}
          />
        </View>
        <Button
          label="Ara"
          size="md"
          fullWidth={false}
          leftIcon={<Ionicons name="search" size={16} color={theme.colors.onPrimary} />}
          onPress={() => go({ q: search, sayfa: 1 })}
          style={styles.searchButton}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <CategoryChip
          label="Tümü"
          count={total}
          active={!category}
          onPress={() => go({ kategori: '', q: initialSearch, sayfa: 1 })}
        />
        {categories.map((item) => (
          <CategoryChip
            key={item.name}
            label={item.name}
            count={item.count}
            active={category === item.name}
            onPress={() => go({ kategori: item.name, q: initialSearch, sayfa: 1 })}
          />
        ))}
      </ScrollView>

      {query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">
            Yazılar yükleniyor…
          </AppText>
        </View>
      ) : query.isError ? (
        <View style={[styles.empty, { borderColor: theme.colors.border }]}>
          <AppText variant="title">Blog yüklenemedi</AppText>
          <AppText variant="body" color="textSecondary">
            Bağlantı sorunu olabilir. Sayfayı yenileyip tekrar deneyin.
          </AppText>
          <Button
            label="Tekrar dene"
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => void query.refetch()}
          />
        </View>
      ) : items.length === 0 ? (
        <View style={[styles.empty, { borderColor: theme.colors.border }]}>
          <AppText variant="title">Bu filtreye uygun yazı yok</AppText>
          <AppText variant="body" color="textSecondary">
            Arama kelimesini kısaltın veya kategori seçimini kaldırın.
          </AppText>
        </View>
      ) : (
        <>
          {featured ? <FeaturedCard post={featured} wide={wide} /> : null}
          <View style={styles.grid}>
            {rest.map((post) => (
              <BlogCard key={post.id} post={post} width={cardWidth} />
            ))}
          </View>
        </>
      )}

      {total > PAGE_SIZE ? (
        <View style={styles.pager}>
          <Button
            label="← Önceki"
            variant="outline"
            size="sm"
            fullWidth={false}
            disabled={page <= 1}
            onPress={() => go({ sayfa: page - 1 })}
          />
          <AppText variant="caption" color="textTertiary">
            Sayfa {page} / {Math.ceil(total / PAGE_SIZE)}
          </AppText>
          <Button
            label="Sonraki →"
            variant="outline"
            size="sm"
            fullWidth={false}
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            onPress={() => go({ sayfa: page + 1 })}
          />
        </View>
      ) : null}
    </PublicShell>
  );
}

function Stat({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={14} color={theme.colors.primary} />
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.colors.surfaceInverse : theme.colors.surface,
          borderColor: active ? theme.colors.surfaceInverse : theme.colors.border,
        },
      ]}
    >
      <AppText variant="caption" color={active ? 'textInverse' : 'textSecondary'}>
        {label}
      </AppText>
      <View
        style={[
          styles.chipCount,
          { backgroundColor: active ? 'rgba(255,255,255,0.18)' : theme.colors.surfaceMuted },
        ]}
      >
        <AppText variant="caption" color={active ? 'textInverse' : 'textTertiary'}>
          {count}
        </AppText>
      </View>
    </Pressable>
  );
}

function FeaturedCard({ post, wide }: { post: BlogListItem; wide: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.featured,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        !wide && styles.featuredStack,
      ]}
    >
      <View style={styles.featuredMedia}>
        {post.cover_image_url ? (
          <Image
            source={{ uri: post.cover_image_url }}
            style={styles.featuredImage}
            contentFit="cover"
            transition={180}
            accessibilityLabel={post.cover_image_alt ?? post.title}
          />
        ) : (
          <View
            style={[
              styles.featuredImage,
              styles.featuredPlaceholder,
              { backgroundColor: theme.colors.primarySoft },
            ]}
          >
            <Ionicons name="newspaper-outline" size={38} color={theme.colors.primaryDeep} />
          </View>
        )}
      </View>
      <View style={styles.featuredBody}>
        <AppText variant="overline" color="primary">
          ÖNE ÇIKAN · {post.category.toLocaleUpperCase('tr-TR')}
        </AppText>
        <AppText variant="h1" numberOfLines={3}>
          {post.title}
        </AppText>
        <AppText variant="body" color="textSecondary" numberOfLines={4}>
          {post.excerpt}
        </AppText>
        <View style={styles.featuredMeta}>
          <AppText variant="caption" color="textTertiary">
            {post.reading_minutes} dk okuma
          </AppText>
          <Link href={`/blog/${post.slug}` as Href} asChild>
            <Pressable
              style={flatStyle([styles.readMore, { backgroundColor: theme.colors.primaryDeep }])}
            >
              <AppText variant="bodyStrong" color="onPrimary">
                Yazıyı oku
              </AppText>
              <Ionicons name="arrow-forward" size={15} color={theme.colors.onPrimary} />
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 26, paddingBottom: 50, gap: 20 },
  nativeScroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 20 },
  hero: { maxWidth: 1120, width: '100%', alignSelf: 'center', gap: 9 },
  title: { letterSpacing: -1 },
  lede: { maxWidth: 760, lineHeight: 24 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolbar: { maxWidth: 1120, width: '100%', alignSelf: 'center', flexDirection: 'row', gap: 10 },
  toolbarStack: { flexDirection: 'column' },
  searchWrap: { flex: 1 },
  searchButton: { alignSelf: 'flex-start' },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipCount: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  grid: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'stretch',
  },
  center: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 26,
    gap: 8,
    maxWidth: 620,
  },
  pager: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
  },
  featured: {
    maxWidth: 1120,
    width: '100%',
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  featuredStack: { flexDirection: 'column' },
  featuredMedia: { flex: 1, minHeight: 260 },
  featuredImage: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  featuredPlaceholder: {},
  featuredBody: { flex: 1.15, padding: 24, gap: 10, justifyContent: 'center' },
  featuredMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
});
