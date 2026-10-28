import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { flatStyle } from '@/features/web/link-style';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

import type { BlogListItem, BlogRelatedPost } from '../types';

type Props = {
  post: BlogListItem | BlogRelatedPost;
  width?: number | string;
  compact?: boolean;
};

export function BlogCard({ post, width = '100%', compact = false }: Props) {
  const { theme } = useTheme();
  const [hovered, setHovered] = useState(false);
  const href = `/blog/${post.slug}` as Href;

  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={post.title}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={flatStyle([
          styles.card,
          {
            width: width as never,
            backgroundColor: theme.colors.surface,
            borderColor: hovered ? theme.colors.primary : theme.colors.border,
            borderRadius: theme.radius.lg,
          },
        ])}
      >
        {post.cover_image_url ? (
          <Image
            source={{ uri: post.cover_image_url }}
            style={[styles.cover, compact && styles.coverCompact]}
            contentFit="cover"
            transition={180}
            accessibilityLabel={post.title}
          />
        ) : (
          <View
            style={[
              styles.cover,
              styles.placeholder,
              compact && styles.coverCompact,
              { backgroundColor: theme.colors.primarySoft },
            ]}
          >
            <Ionicons name="newspaper-outline" size={26} color={theme.colors.primaryDeep} />
          </View>
        )}
        <View style={styles.body}>
          <AppText variant="overline" color="primary" numberOfLines={1}>
            {post.category}
          </AppText>
          <AppText variant={compact ? 'title' : 'h3'} numberOfLines={compact ? 2 : 3}>
            {post.title}
          </AppText>
          {compact ? null : (
            <AppText variant="body" color="textSecondary" numberOfLines={3}>
              {post.excerpt}
            </AppText>
          )}
          <View style={styles.meta}>
            <AppText variant="caption" color="textTertiary">
              {post.reading_minutes} dk okuma
            </AppText>
            {post.published_at ? (
              <>
                <AppText variant="caption" color="textTertiary">
                  ·
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {formatDateTr(post.published_at)}
                </AppText>
              </>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  cover: { width: '100%', height: 176 },
  coverCompact: { height: 132 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: 14, gap: 7, flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 'auto', flexWrap: 'wrap' },
});
