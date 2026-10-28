import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Link, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, Button } from '@/components/ui';
import { BlogCard } from '@/features/blog/components/BlogCard';
import { extractHeadings, MarkdownView } from '@/features/blog/components/MarkdownView';
import { useBlogPost } from '@/features/blog/hooks/use-blog';
import { trackBlogView } from '@/features/blog/services/blog-service';
import type { BlogFaq } from '@/features/blog/types';
import { WebFooter } from '@/features/web/components/WebFooter';
import { WebHeader } from '@/features/web/components/WebHeader';
import { flatStyle } from '@/features/web/link-style';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

export default function BlogPostScreen() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const query = useBlogPost(slug);
  const post = query.data;
  const wide = width >= 980;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (slug && post) trackBlogView(slug);
  }, [post, slug]);

  const headings = useMemo(() => (post ? extractHeadings(post.body_markdown) : []), [post]);

  useWebMeta({
    title: post
      ? post.seo_title
        ? post.seo_title.length <= 52
          ? `${post.seo_title} | Trabzone Blog`
          : post.seo_title
        : `${post.title} | Trabzone Blog`
      : 'Trabzon Blog | Trabzone',
    description: post?.seo_description ?? post?.excerpt ?? 'Trabzon üzerine yerel rehberler.',
    path: slug ? `/blog/${slug}` : '/blog',
    type: 'article',
    noIndex: !post && !query.isLoading,
  });

  if (query.isLoading) {
    return (
      <View style={StyleSheet.flatten([styles.root, { backgroundColor: theme.colors.background }])}>
        <WebHeader />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">
            Yazı yükleniyor…
          </AppText>
        </View>
        <WebFooter />
      </View>
    );
  }

  if (query.isError || !post) {
    return (
      <View style={StyleSheet.flatten([styles.root, { backgroundColor: theme.colors.background }])}>
        <WebHeader />
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={38} color={theme.colors.textTertiary} />
          <AppText variant="h2">Yazı bulunamadı</AppText>
          <AppText variant="body" color="textSecondary" style={styles.centerText}>
            Bu adres yayından kaldırılmış veya hiç var olmamış olabilir.
          </AppText>
          <Link href={'/blog' as Href} asChild>
            <Pressable style={flatStyle([styles.ctaSmall, { backgroundColor: theme.colors.primaryDeep }])}>
              <AppText variant="bodyStrong" color="onPrimary">
                Tüm blog yazıları
              </AppText>
            </Pressable>
          </Link>
        </View>
        <WebFooter />
      </View>
    );
  }

  const date = formatDateTr(post.published_at);
  const updated = formatDateTr(post.updated_at);
  const hasInlineFaq = /sık sorulan sorular/i.test(post.body_markdown);

  const share = async () => {
    const url =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.href
        : `https://www.trabzoneapp.com/blog/${post.slug}`;
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <View style={StyleSheet.flatten([styles.root, { backgroundColor: theme.colors.background }])}>
      <WebHeader />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.articleHead}>
          <View style={styles.crumbs}>
            <Link href={'/' as Href} asChild>
              <Pressable>
                <AppText variant="caption" color="primary">
                  Trabzone
                </AppText>
              </Pressable>
            </Link>
            <AppText variant="caption" color="textTertiary">
              ›
            </AppText>
            <Link href={'/blog' as Href} asChild>
              <Pressable>
                <AppText variant="caption" color="primary">
                  Blog
                </AppText>
              </Pressable>
            </Link>
            <AppText variant="caption" color="textTertiary">
              ›
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {post.category}
            </AppText>
          </View>

          <AppText variant="overline" color="primary">
            {post.category.toLocaleUpperCase('tr-TR')}
          </AppText>
          <AppText variant={wide ? 'display' : 'h1'} style={styles.title}>
            {post.title}
          </AppText>
          {post.excerpt ? (
            <AppText variant="body" color="textSecondary" style={styles.lede}>
              {post.excerpt}
            </AppText>
          ) : null}

          <View style={styles.metaRow}>
            <AppText variant="caption" color="textSecondary">
              {post.author_name}
            </AppText>
            {date !== '—' ? (
              <AppText variant="caption" color="textTertiary">
                · {date}
              </AppText>
            ) : null}
            <AppText variant="caption" color="textTertiary">
              · {post.reading_minutes} dk okuma
            </AppText>
            <AppText variant="caption" color="textTertiary">
              · {post.word_count} kelime
            </AppText>
            {updated !== date && updated !== '—' ? (
              <AppText variant="caption" color="textTertiary">
                · Güncelleme: {updated}
              </AppText>
            ) : null}
          </View>

          {post.cover_image_url ? (
            <Image
              source={{ uri: post.cover_image_url }}
              style={styles.cover}
              contentFit="cover"
              transition={200}
              accessibilityLabel={post.cover_image_alt ?? post.title}
            />
          ) : null}
        </View>

        <View style={[styles.layout, !wide && styles.layoutStack]}>
          <View style={styles.body}>
            <MarkdownView markdown={post.body_markdown} />

            {!hasInlineFaq && post.faq.length > 0 ? (
              <View style={styles.faqSection}>
                <AppText variant="h2" style={styles.sectionTitle}>
                  Sık sorulan sorular
                </AppText>
                {post.faq.map((item, index) => (
                  <FaqRow key={`${item.question}-${index}`} item={item} />
                ))}
              </View>
            ) : null}

            {post.tags.length > 0 ? (
              <View style={styles.tags}>
                {post.tags.map((tag) => (
                  <View
                    key={tag}
                    style={[styles.tag, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
                  >
                    <AppText variant="caption" color="textSecondary">
                      #{tag}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}

            <View
              style={[
                styles.cta,
                { borderColor: theme.colors.border, backgroundColor: theme.colors.primarySoft },
              ]}
            >
              <AppText variant="h3">Trabzon'da bir sonraki adım</AppText>
              <AppText variant="body" color="textSecondary">
                Güncel ilanları, yerel işletmeleri ve topluluk paylaşımlarını Trabzone'da keşfedin.
              </AppText>
              <View style={styles.ctaRow}>
                <Link href={'/trabzon' as Href} asChild>
                  <Pressable style={flatStyle([styles.ctaSmall, { backgroundColor: theme.colors.primaryDeep }])}>
                    <AppText variant="bodyStrong" color="onPrimary">
                      Trabzon rehberi
                    </AppText>
                  </Pressable>
                </Link>
                <Button
                  label={copied ? 'Bağlantı kopyalandı' : 'Bağlantıyı paylaş'}
                  variant="outline"
                  size="sm"
                  fullWidth={false}
                  leftIcon={
                    <Ionicons
                      name={copied ? 'checkmark' : 'share-outline'}
                      size={15}
                      color={theme.colors.text}
                    />
                  }
                  onPress={() => void share()}
                />
              </View>
            </View>

            {post.related.length > 0 ? (
              <View style={styles.related}>
                <AppText variant="h2" style={styles.sectionTitle}>
                  İlgili yazılar
                </AppText>
                <View style={styles.relatedGrid}>
                  {post.related.map((related) => (
                    <BlogCard
                      key={related.slug}
                      post={related}
                      compact
                      width={wide ? '31.8%' : width >= 620 ? '48.6%' : '100%'}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </View>

          {headings.length >= 3 ? (
            <View style={styles.sidebar}>
              <View
                style={[
                  styles.toc,
                  { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                ]}
              >
                <AppText variant="overline" color="textTertiary">
                  İÇİNDEKİLER
                </AppText>
                {headings
                  .filter((heading) => !/sık sorulan sorular/i.test(heading.text))
                  .slice(0, 12)
                  .map((heading, index) => (
                    <Pressable
                      key={heading.id}
                      style={styles.tocRow}
                      onPress={() => {
                        if (Platform.OS === 'web' && typeof document !== 'undefined') {
                          document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                    >
                      <AppText variant="caption" color="textTertiary" style={styles.tocIndex}>
                        {String(index + 1).padStart(2, '0')}
                      </AppText>
                      <AppText variant="caption" color="textSecondary" style={styles.flex}>
                        {heading.text}
                      </AppText>
                    </Pressable>
                  ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <WebFooter />
    </View>
  );
}

function FaqRow({ item }: { item: BlogFaq }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View
      style={[
        styles.faqRow,
        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.faqHead}
      >
        <AppText variant="bodyStrong" style={styles.flex}>
          {item.question}
        </AppText>
        <Ionicons
          name={open ? 'remove' : 'add'}
          size={18}
          color={theme.colors.textSecondary}
        />
      </Pressable>
      {open ? (
        <AppText variant="body" color="textSecondary" style={styles.faqAnswer}>
          {item.answer}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 50 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 10 },
  centerText: { textAlign: 'center', maxWidth: 400 },
  articleHead: { maxWidth: 1120, width: '100%', alignSelf: 'center', gap: 10 },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 },
  title: { letterSpacing: -0.8, maxWidth: 900 },
  lede: { maxWidth: 820, lineHeight: 25 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 4 },
  cover: { width: '100%', height: 360, borderRadius: 18, marginTop: 8 },
  layout: { maxWidth: 1120, width: '100%', alignSelf: 'center', flexDirection: 'row', gap: 36, marginTop: 28 },
  layoutStack: { flexDirection: 'column' },
  body: { flex: 1, minWidth: 0 },
  sidebar: { width: 260 },
  toc: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16, gap: 8 },
  tocRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tocIndex: { width: 20 },
  flex: { flex: 1 },
  sectionTitle: { marginBottom: 12 },
  faqSection: { marginTop: 34, gap: 9 },
  faqRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  faqAnswer: { marginTop: 9 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24 },
  tag: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  cta: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 20, gap: 8, marginTop: 30 },
  ctaRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  ctaSmall: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start' },
  related: { marginTop: 36, paddingTop: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(128,128,128,0.25)' },
  relatedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
});
