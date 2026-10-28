import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Avatar } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { SafetySheet } from '@/features/safety/components/SafetySheet';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

import { useAddReelComment, useDeleteReelComment, useReelComments } from '../hooks/use-reels';

export function ReelCommentsSheet({
  visible,
  reelId,
  commentCount,
  onClose,
}: {
  visible: boolean;
  reelId: string;
  commentCount: number;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const { openReport } = useReportSheet();
  const { data: comments, isLoading, isError, refetch } = useReelComments(reelId, visible);
  const addComment = useAddReelComment(reelId);
  const removeComment = useDeleteReelComment(reelId);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const body = draft.trim();
    if (!body || addComment.isPending) {
      return;
    }
    haptics.tap();
    addComment.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: (error) => Alert.alert('Yorum gönderilemedi', error.message),
    });
  };

  return (
    <SafetySheet
      visible={visible}
      onClose={onClose}
      title="Yorumlar"
      subtitle={commentCount > 0 ? `${commentCount} yorum` : 'İlk yorumu sen yaz'}
      maxHeightRatio={0.88}
      footer={
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
            disabled={!draft.trim() || addComment.isPending}
            onPress={submit}
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
      }
    >
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : isError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yorumları yeniden yükle"
          onPress={() => void refetch()}
          style={[
            styles.state,
            { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Yorumlar yüklenemedi. Tekrar denemek için dokun.
          </AppText>
        </Pressable>
      ) : comments && comments.length > 0 ? (
        <View style={styles.list}>
          {comments.map((comment) => {
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
                  <AppText variant="body" style={styles.commentText}>
                    {comment.body}
                  </AppText>
                  <View style={styles.commentActions}>
                    {comment.can_delete ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Yorumu sil"
                        onPress={() =>
                          Alert.alert('Yorumu sil', 'Bu yorum silinsin mi?', [
                            { text: 'Vazgeç', style: 'cancel' },
                            {
                              text: 'Sil',
                              style: 'destructive',
                              onPress: () =>
                                removeComment.mutate(comment.id, {
                                  onError: (error) => Alert.alert('Silinemedi', error.message),
                                }),
                            },
                          ])
                        }
                      >
                        <AppText variant="caption" color="danger">
                          Sil
                        </AppText>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Yorumu şikâyet et"
                        onPress={() => {
                          onClose();
                          setTimeout(
                            () =>
                              openReport({
                                targetType: 'comment',
                                targetId: comment.id,
                                targetLabel: comment.body.slice(0, 60),
                              }),
                            280,
                          );
                        }}
                      >
                        <AppText variant="caption" color="textTertiary">
                          Şikâyet et
                        </AppText>
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View
          style={[
            styles.state,
            { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Henüz yorum yok. İlk yorumu sen yaz.
          </AppText>
        </View>
      )}
    </SafetySheet>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 28, alignItems: 'center' },
  state: { paddingVertical: 26, paddingHorizontal: 16, alignItems: 'center', gap: 8 },
  list: { gap: 16, paddingBottom: 6 },
  comment: { flexDirection: 'row', gap: 10 },
  commentBody: { flex: 1, gap: 3 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentName: { flexShrink: 1 },
  commentText: { lineHeight: 21 },
  commentActions: { flexDirection: 'row', gap: 14, marginTop: 2 },
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
