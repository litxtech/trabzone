import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Avatar, Screen, ScreenHeader } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { PostCard } from '@/features/feed/components/PostCard';
import { useAddComment, useComments, useDeleteComment, usePost } from '@/features/feed/hooks/use-feed';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

export default function PostDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const postId = typeof params.id === 'string' ? params.id : '';

  const post = usePost(postId);
  const comments = useComments(postId);
  const addComment = useAddComment(postId);
  const removeComment = useDeleteComment(postId);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const body = draft.trim();
    if (!body || addComment.isPending) {
      return;
    }
    haptics.tap();
    addComment.mutate(
      { body },
      {
        onSuccess: () => setDraft(''),
        onError: (error) => Alert.alert('Yorum gönderilemedi', error.message),
      },
    );
  };

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      scroll
      keyboardAware
      footer={
        post.data ? (
          <View
            style={[
              styles.composerWrap,
              { backgroundColor: theme.colors.background, borderTopColor: theme.colors.divider },
            ]}
          >
            <View
              style={[
                styles.composer,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.pill,
                },
              ]}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Yorum yaz..."
                placeholderTextColor={theme.colors.textTertiary}
                style={[styles.input, { color: theme.colors.text }]}
                maxLength={1000}
                multiline
                accessibilityLabel="Yorum metni"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Yorumu gönder"
                onPress={submit}
                disabled={!draft.trim() || addComment.isPending}
                style={({ pressed }) => [
                  styles.send,
                  {
                    backgroundColor: theme.colors.primary,
                    opacity: !draft.trim() || addComment.isPending ? 0.4 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                {addComment.isPending ? (
                  <ActivityIndicator size="small" color={theme.colors.onPrimary} />
                ) : (
                  <Ionicons name="arrow-up" size={18} color={theme.colors.onPrimary} />
                )}
              </Pressable>
            </View>
          </View>
        ) : null
      }
    >
      <ScreenHeader title="Gönderi" onBack={() => router.back()} />

      {post.isLoading ? (
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
          <PostCard post={post.data} />

          <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

          <View style={styles.commentsHead}>
            <AppText variant="h3">Yorumlar</AppText>
            <AppText variant="caption" color="textTertiary">
              {post.data.comment_count}
            </AppText>
          </View>

          {comments.isLoading ? (
            <ActivityIndicator color={theme.colors.primary} style={styles.commentsLoading} />
          ) : comments.data && comments.data.length > 0 ? (
            <View style={styles.commentList}>
              {comments.data.map((comment) => {
                const name =
                  `${comment.author_first_name ?? ''} ${comment.author_last_name ?? ''}`.trim() ||
                  comment.author_username;
                return (
                  <View key={comment.id} style={styles.comment}>
                    <Avatar
                      uri={mediaPublicUrl('avatar', comment.author_avatar_path)}
                      name={name}
                      size={34}
                    />
                    <View style={styles.commentBody}>
                      <View style={styles.commentHead}>
                        <AppText variant="label" numberOfLines={1} style={styles.commentName}>
                          {name}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {formatRelativeTr(comment.created_at)}
                        </AppText>
                      </View>
                      <AppText variant="body">{comment.body}</AppText>
                      {comment.can_delete ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Yorumu sil"
                          hitSlop={8}
                          onPress={() => {
                            Alert.alert('Yorumu sil', 'Bu yorum silinsin mi?', [
                              { text: 'Vazgeç', style: 'cancel' },
                              {
                                text: 'Sil',
                                style: 'destructive',
                                onPress: () => removeComment.mutate(comment.id),
                              },
                            ]);
                          }}
                        >
                          <AppText variant="caption" color="danger">
                            Sil
                          </AppText>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.noComments}>
              <AppText variant="body" color="textSecondary" align="center">
                Henüz yorum yok. İlk yorumu sen yaz.
              </AppText>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 40, alignItems: 'center' },
  empty: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  commentsHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  commentsLoading: { paddingVertical: 24 },
  commentList: { gap: 16, paddingBottom: 12 },
  comment: { flexDirection: 'row', gap: 10 },
  commentBody: { flex: 1, gap: 4 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentName: { flexShrink: 1 },
  noComments: { paddingVertical: 26 },
  composerWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
  },
  input: { flex: 1, maxHeight: 110, minHeight: 40, paddingTop: 10, paddingBottom: 10, fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
