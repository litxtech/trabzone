import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar } from '@/components/ui';
import { CommentsSheet } from '@/features/comments/components/CommentsSheet';
import { useComments } from '@/features/comments/hooks/use-comments';
import { PostCard } from '@/features/feed/components/PostCard';
import type { FeedPost } from '@/features/feed/services/feed-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { useFanMedia, useFixtureNews } from '../hooks/use-sports';
import type { FanCategory, Fixture } from '../types';
import { Chip, EmptyState, PanelError, PanelLoading, SectionCard } from './ui';

// ---------------------------------------------------------------------------
// Yorumlar: Trabzone'un premium yorum sistemi (`match` içerik türü).
// ---------------------------------------------------------------------------
export function CommentsPanel({ fixture, initialOpen = false }: { fixture: Fixture; initialOpen?: boolean }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(initialOpen);
  const comments = useComments('match', fixture.uid, true);
  const items = useMemo(() => comments.data?.pages.flatMap((page) => page.items) ?? [], [comments.data]);

  return (
    <View style={styles.col}>
      <SectionCard
        title="Maç yorumları"
        right={
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" hitSlop={8}>
            <AppText variant="label" color="primary">
              Tümünü aç
            </AppText>
          </Pressable>
        }
      >
        {fixture.comments_locked ? (
          <View style={[styles.notice, { backgroundColor: theme.colors.warningSoft }]}>
            <Ionicons name="lock-closed-outline" size={14} color={theme.colors.warning} />
            <AppText variant="caption" style={{ color: theme.colors.warning, flex: 1 }}>
              Yorumlar moderasyon nedeniyle yeni yorumlara kapatıldı. Mevcut yorumlar okunabilir.
            </AppText>
          </View>
        ) : null}
        {comments.isLoading ? (
          <PanelLoading />
        ) : items.length === 0 ? (
          <AppText variant="body" color="textSecondary">
            Henüz yorum yok. Maç hakkındaki düşünceni ilk sen yaz; yorumlar maçtan sonra da kalıcıdır.
          </AppText>
        ) : (
          items.slice(0, 5).map((comment) => (
            <Pressable key={comment.id} onPress={() => setOpen(true)} style={styles.commentRow}>
              <Avatar uri={mediaPublicUrl('avatar', comment.author_avatar_path)} name={comment.author_username} size={30} />
              <View style={styles.flex}>
                <AppText variant="label">@{comment.author_username}</AppText>
                <AppText variant="body" numberOfLines={3}>
                  {comment.body}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {comment.like_count > 0 ? `${comment.like_count} beğeni · ` : ''}
                  {comment.reply_count > 0 ? `${comment.reply_count} yanıt` : 'Yanıtla'}
                </AppText>
              </View>
            </Pressable>
          ))
        )}
        {!fixture.comments_locked ? (
          <Pressable
            onPress={() => setOpen(true)}
            style={[styles.cta, { backgroundColor: theme.colors.primary }]}
            accessibilityRole="button"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.colors.onPrimary} />
            <AppText variant="label" color="onPrimary">
              Yorum yaz
            </AppText>
          </Pressable>
        ) : null}
      </SectionCard>

      <CommentsSheet
        visible={open}
        contentType="match"
        contentId={fixture.uid}
        deepLinkKey={String(fixture.id)}
        commentCount={items.length}
        title="Maç yorumları"
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Taraftarlar: kullanıcıların herkese açık gönderileri (canlı yayın görüntüsü yok).
// ---------------------------------------------------------------------------
const FAN_CATEGORIES: { key: FanCategory | null; label: string }[] = [
  { key: null, label: 'Tümü' },
  { key: 'prematch', label: 'Maç öncesi' },
  { key: 'stadium', label: 'Stattan' },
  { key: 'watch_party', label: 'Maç izleme' },
  { key: 'celebration', label: 'Kutlama' },
  { key: 'opinion', label: 'Yorum' },
  { key: 'video', label: 'Video' },
];

export function FansPanel({ fixture }: { fixture: Fixture }) {
  const { theme } = useTheme();
  const router = useRouter();
  const session = useSession();
  const [category, setCategory] = useState<FanCategory | null>(null);
  const media = useFanMedia(fixture.id, category, Boolean(session?.user));
  const items = useMemo(
    () => media.data?.pages.flatMap((page) => page.items).filter((item) => item.post) ?? [],
    [media.data],
  );

  const share = () => {
    const cat = category ?? 'prematch';
    router.push(`/compose/post?fixture=${fixture.id}&fanCategory=${cat}` as never);
  };

  if (!session?.user) {
    return <EmptyState icon="people-outline" title="Taraftar paylaşımları üyelere açık" body="Paylaşımları görmek için giriş yap." />;
  }

  return (
    <View style={styles.col}>
      <View style={styles.chips}>
        {FAN_CATEGORIES.map((item) => (
          <Chip key={item.label} label={item.label} active={category === item.key} onPress={() => setCategory(item.key)} />
        ))}
      </View>
      <Pressable onPress={share} style={[styles.cta, { backgroundColor: theme.colors.primary }]} accessibilityRole="button">
        <Ionicons name="camera-outline" size={16} color={theme.colors.onPrimary} />
        <AppText variant="label" color="onPrimary">
          Maç paylaşımı yap
        </AppText>
      </Pressable>
      <AppText variant="caption" color="textTertiary" align="center">
        Yalnızca kendi çektiğin fotoğraf/videoları paylaş. Televizyon yayını veya maç yayın görüntüsü paylaşmak yasaktır.
      </AppText>
      {media.isLoading ? (
        <PanelLoading />
      ) : media.isError ? (
        <PanelError onRetry={() => void media.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="images-outline" title="Henüz paylaşım yok" body="Maç günü atmosferini ilk sen paylaş." />
      ) : (
        items.map((item) => (
          <View key={item.id} style={[styles.postWrap, { borderBottomColor: theme.colors.divider }]}>
            <PostCard post={item.post as unknown as FeedPost} />
          </View>
        ))
      )}
      {media.hasNextPage ? (
        <Pressable onPress={() => void media.fetchNextPage()} style={styles.more}>
          {media.isFetchingNextPage ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <AppText variant="label" color="primary">
              Daha fazla
            </AppText>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Haberler: Trabzone Haber / sabitlenmiş haberler (maç ±3 gün).
// ---------------------------------------------------------------------------
export function NewsPanel({ fixture }: { fixture: Fixture }) {
  const { theme } = useTheme();
  const news = useFixtureNews(fixture.id, true);
  if (news.isLoading) return <PanelLoading />;
  if (news.isError) return <PanelError onRetry={() => void news.refetch()} />;
  const items = (news.data ?? []).filter(Boolean);
  if (items.length === 0) {
    return <EmptyState icon="newspaper-outline" title="Bu maçla ilgili haber yok" body="Trabzone Haber’de maç haberleri yayımlandıkça burada görünür." />;
  }
  return (
    <View style={styles.col}>
      {items.map((post) => (
        <View key={String(post.id)} style={[styles.postWrap, { borderBottomColor: theme.colors.divider }]}>
          <PostCard post={post as unknown as FeedPost} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  col: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, padding: 8 },
  commentRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  postWrap: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8 },
  more: { alignItems: 'center', paddingVertical: 14 },
});
