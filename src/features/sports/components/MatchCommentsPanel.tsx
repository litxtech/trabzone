import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ComponentRef, type RefObject } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui';
import { CommentComposer } from '@/features/comments/components/CommentComposer';
import { CommentRow } from '@/features/comments/components/CommentRow';
import { CommentsSheet } from '@/features/comments/components/CommentsSheet';
import {
  useAddComment,
  useComments,
  useCommentsRealtime,
  useToggleCommentLike,
} from '@/features/comments/hooks/use-comments';
import type { CommentMediaInput, CommentNode } from '@/features/comments/types';
import { loginHref } from '@/features/auth/next-path';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

import type { Fixture } from '../types';
import { opponentName } from '../utils/format';
import { LiveDot } from './MatchCenterFeedCard';

/** Şeritte doğrudan gösterilen yorum sayısı; gerisi tam yorum kartında açılır. */
const INLINE_LIMIT = 6;

/**
 * Maç arenasının ilk sekmesi: YouTube canlı yayın yorumları gibi çalışan
 * yorum akışı. Yorum yazma alanı kartın içinde değil, ekranın altında klavyeye
 * yapışık durur (`MatchCommentComposer`); kart kullanıcıyı karşılar ve akışı
 * gösterir. Yanıt zinciri ve medya için tam yorum kartı açılır.
 */
export function MatchCommentsPanel({
  fixture,
  activeUsers,
  initialOpen = false,
  onCompose,
}: {
  fixture: Fixture;
  activeUsers?: number | null;
  initialOpen?: boolean;
  /** Alt yorum alanını odaklar; boş durumdan yazmaya başlamak için. */
  onCompose?: () => void;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const session = useSession();

  const comments = useComments('match', fixture.uid, true);
  useCommentsRealtime('match', fixture.uid, true);
  const like = useToggleCommentLike('match', fixture.uid);

  const [sheetOpen, setSheetOpen] = useState(initialOpen);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(
    () => comments.data?.pages.flatMap((page) => page.items) ?? [],
    [comments.data],
  );
  const shown = items.slice(0, INLINE_LIMIT);
  const total = items.length;

  const signedIn = Boolean(session?.user);

  const requireLogin = () => {
    haptics.tap();
    router.push(loginHref(`/trabzonspor/mac/${fixture.id}`) as never);
  };

  const openSheet = () => {
    haptics.tap();
    setSheetOpen(true);
  };

  const onOpenProfile = (_userId: string, username?: string | null) => {
    if (username) router.push(`/profile/${username}` as never);
  };

  return (
    <View style={styles.col}>
      {/* Yorum kartı: kullanıcıyı karşılar; yazma alanı ekranın altında durur. */}
      <View
        style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      >
        <View style={styles.cardHead}>
          <View style={[styles.icon, { backgroundColor: theme.colors.primary }]}>
            <Ionicons name="chatbubbles" size={18} color={theme.colors.onPrimary} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Maç yorumlarına hoş geldin</AppText>
            <View style={styles.metaRow}>
              {fixture.status.is_live ? <LiveDot /> : null}
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {opponentName(fixture)} maçı · {total} yorum
                {activeUsers ? ` · ${activeUsers} kişi arenada` : ''}
              </AppText>
            </View>
          </View>
        </View>

        {fixture.comments_locked ? (
          <View style={[styles.notice, { backgroundColor: theme.colors.warningSoft }]}>
            <Ionicons name="lock-closed-outline" size={14} color={theme.colors.warning} />
            <AppText variant="caption" style={{ color: theme.colors.warning, flex: 1 }}>
              Yorumlar moderasyon nedeniyle yeni yorumlara kapatıldı. Mevcut yorumlar okunabilir.
            </AppText>
          </View>
        ) : null}

        {!signedIn && !fixture.comments_locked ? (
          <Pressable
            onPress={requireLogin}
            style={[styles.login, { backgroundColor: theme.colors.primarySoft }]}
            accessibilityRole="button"
          >
            <Ionicons name="log-in-outline" size={15} color={theme.colors.primaryDeep} />
            <AppText variant="label" color="primaryDeep">
              Giriş yap ve yorumlaşmaya katıl
            </AppText>
          </Pressable>
        ) : null}

        {error ? (
          <Pressable
            onPress={() => setError(null)}
            style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}
          >
            <AppText variant="caption" color="danger" style={styles.flex}>
              {error}
            </AppText>
            <Ionicons name="close" size={14} color={theme.colors.danger} />
          </Pressable>
        ) : null}

        <View style={styles.cardFoot}>
          <Pressable
            onPress={() => router.push('/community-guidelines' as never)}
            accessibilityRole="link"
            hitSlop={6}
          >
            <AppText variant="caption" color="primary">
              Topluluk kuralları
            </AppText>
          </Pressable>
          <Pressable onPress={openSheet} accessibilityRole="button" hitSlop={6}>
            <AppText variant="caption" color="textSecondary">
              Tüm yorumlar
            </AppText>
          </Pressable>
        </View>
      </View>

      {comments.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : comments.isError ? (
        <Pressable onPress={() => void comments.refetch()} style={styles.center} accessibilityRole="button">
          <AppText variant="body" color="textSecondary" align="center">
            Yorumlar yüklenemedi. Tekrar dene.
          </AppText>
        </Pressable>
      ) : shown.length === 0 ? (
        <Pressable
          onPress={() => (signedIn ? onCompose?.() : requireLogin())}
          style={styles.empty}
          accessibilityRole="button"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.colors.textTertiary} />
          <AppText variant="body" color="textSecondary" align="center">
            Henüz yorum yok. İlk yorumu sen yaz, arenayı sen başlat!
          </AppText>
        </Pressable>
      ) : (
        <View style={styles.list}>
          {shown.map((comment: CommentNode) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              onToggleLike={(item) => like.mutate(item.id)}
              onReply={openSheet}
              onMenu={openSheet}
              onOpenProfile={onOpenProfile}
              onOpenMedia={openSheet}
            />
          ))}
        </View>
      )}

      {total > INLINE_LIMIT ? (
        <Pressable
          onPress={openSheet}
          style={[styles.more, { borderColor: theme.colors.border }]}
          accessibilityRole="button"
        >
          <AppText variant="label" color="primary">
            Tüm yorumları gör ({total})
          </AppText>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.primary} />
        </Pressable>
      ) : null}

      <CommentsSheet
        visible={sheetOpen}
        contentType="match"
        contentId={fixture.uid}
        deepLinkKey={String(fixture.id)}
        commentCount={total}
        title="Maç yorumları"
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

/**
 * Maç arenasının altına sabitlenen yorum alanı.
 *
 * Yorum kartındaki alan (CommentComposer) burada kullanılır: klavye açılınca
 * ekranın altına yapışır, kaydırılan akışın arkasında kaybolmaz. Sohbet alanıyla
 * aynı davranışı paylaşır.
 */
export function MatchCommentComposer({
  fixture,
  inputRef,
}: {
  fixture: Fixture;
  inputRef?: RefObject<ComponentRef<typeof TextInput> | null>;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const session = useSession();
  const add = useAddComment('match', fixture.uid);

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const signedIn = Boolean(session?.user);
  const userId = session?.user?.id ?? null;

  const requireLogin = () => {
    haptics.tap();
    router.push(loginHref(`/trabzonspor/mac/${fixture.id}`) as never);
  };

  const submit = async (input: { body: string; media: CommentMediaInput[] }) => {
    if (!signedIn) {
      requireLogin();
      return false;
    }
    try {
      await add.mutateAsync({ body: input.body, media: input.media });
      haptics.success();
      setText('');
      setError(null);
      return true;
    } catch (failure) {
      haptics.error();
      setError(failure instanceof Error ? failure.message : 'Yorum gönderilemedi.');
      return false;
    }
  };

  return (
    <View
      style={[
        styles.dock,
        { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border },
      ]}
    >
      {error ? (
        <Pressable
          onPress={() => setError(null)}
          style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}
        >
          <AppText variant="caption" color="danger" style={styles.flex}>
            {error}
          </AppText>
          <Ionicons name="close" size={14} color={theme.colors.danger} />
        </Pressable>
      ) : null}

      {fixture.comments_locked ? (
        <View style={styles.lockedRow}>
          <Ionicons name="lock-closed-outline" size={15} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Yorumlar yeni yorumlara kapatıldı.
          </AppText>
        </View>
      ) : !signedIn ? (
        <Pressable
          onPress={requireLogin}
          style={[styles.login, { backgroundColor: theme.colors.primarySoft }]}
          accessibilityRole="button"
        >
          <Ionicons name="log-in-outline" size={15} color={theme.colors.primaryDeep} />
          <AppText variant="label" color="primaryDeep">
            Yorum yazmak için giriş yap
          </AppText>
        </Pressable>
      ) : (
        <CommentComposer
          value={text}
          onChangeText={setText}
          userId={userId}
          replyTo={null}
          editing={false}
          submitting={add.isPending}
          onCancelReply={() => undefined}
          onCancelEdit={() => undefined}
          onSubmit={submit}
          onError={setError}
          inputRef={inputRef}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  col: { gap: 10 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  login: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 10,
  },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, padding: 8 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, padding: 8 },
  list: { gap: 2 },
  center: { paddingVertical: 26, alignItems: 'center' },
  empty: { paddingVertical: 26, alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 11,
  },
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
  },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
});
