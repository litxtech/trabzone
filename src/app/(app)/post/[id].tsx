import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Screen, ScreenHeader } from '@/components/ui';
import { CommentsSheet } from '@/features/comments/components/CommentsSheet';
import { PostCard } from '@/features/feed/components/PostCard';
import { usePost } from '@/features/feed/hooks/use-feed';
import { NewsReaderScreen } from '@/features/news/components/NewsReaderScreen';
import { useNewsDetail } from '@/features/news/hooks/use-news-reader';
import { useContentViewRegistration } from '@/features/views/use-content-views';
import { useTheme } from '@/theme/ThemeProvider';

export default function PostDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; comment?: string }>();
  const postId = typeof params.id === 'string' ? params.id : '';
  const initialCommentId = typeof params.comment === 'string' ? params.comment : undefined;

  const post = usePost(postId);
  // Yalnızca haber gönderilerinde ağır `news_post_detail` çağrısı yapılır;
  // normal gönderiler detay ekranını ikinci bir tur beklemeden açar. Gönderi
  // henüz önbellekte yoksa (derin bağlantı) çağrı gönderiyle paralel başlar,
  // aksi hâlde haber detayı için iki tur üst üste beklenirdi.
  const isNewsPost = Boolean(post.data?.news || post.data?.source);
  const news = useNewsDetail(postId, isNewsPost || post.isPending);
  // Detay ekranı gerçekten yüklendiğinde tekil görüntüleme kaydedilir.
  useContentViewRegistration({
    type: 'post',
    id: postId || null,
    surface: news.data ? 'news_detail' : 'post_detail',
    enabled: Boolean(post.data || news.data),
  });
  // Paylaşılan yorum bağlantısı doğrudan aynı premium yorum kartını açar.
  const [commentsOpen, setCommentsOpen] = useState(Boolean(initialCommentId));

  // Haber gönderileri sosyal kart yerine ayrı editoryal okuma ekranında açılır.
  if (news.data) {
    return <NewsReaderScreen detail={news.data} initialCommentsOpen={Boolean(initialCommentId)} />;
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll keyboardAware>
      <ScreenHeader title="Gönderi" onBack={() => router.back()} />

      {post.isLoading || (post.data && news.isLoading) ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : !post.data ? (
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={28} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Bu gönderi bulunamadı veya kaldırıldı.
          </AppText>
        </View>
      ) : (
        <>
          {/* Detayda kart önizleme değil içeriğin kendisidir: "Devamını Oku"
              çağrısı gizlenir, aksi hâlde aynı gönderi üst üste açılıyordu. */}
          <PostCard post={post.data} detail />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Yorumları aç, ${post.data.comment_count} yorum`}
            onPress={() => setCommentsOpen(true)}
            style={({ pressed }) => [
              styles.commentCta,
              {
                borderColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
              },
            ]}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={18}
              color={theme.colors.primaryDeep}
            />
            <View style={styles.commentCtaText}>
              <AppText variant="bodyStrong">Yorumlar</AppText>
              <AppText variant="caption" color="textTertiary">
                {post.data.comment_count > 0
                  ? `${post.data.comment_count} yorum · yanıtla, beğen, medya ekle`
                  : 'İlk yorumu sen yaz'}
              </AppText>
            </View>
            <Ionicons name="chevron-up" size={17} color={theme.colors.textTertiary} />
          </Pressable>
        </>
      )}

      {post.data ? (
        <CommentsSheet
          visible={commentsOpen}
          contentType="post"
          contentId={post.data.id}
          commentCount={post.data.comment_count}
          onClose={() => setCommentsOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 40, alignItems: 'center' },
  empty: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  commentCta: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  commentCtaText: { flex: 1, gap: 1 },
});
