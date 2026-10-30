import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAccommodationReviews,
  useReplyToReview,
  useSetReviewStatus,
} from '../hooks/use-accommodation';
import type { Review } from '../types';
import { formatDate } from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
  StarRating,
  StatTile,
} from './AccommodationUI';

type StatusFilter = 'published' | 'hidden' | 'all';

const SUB_SCORES: { key: keyof Pick<Review, 'cleanliness' | 'staff_score' | 'location_score' | 'value_score'>; label: string }[] = [
  { key: 'cleanliness', label: 'Temizlik' },
  { key: 'staff_score', label: 'Personel' },
  { key: 'location_score', label: 'Konum' },
  { key: 'value_score', label: 'Fiyat/performans' },
];

export function ReviewsManager({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const reviews = useAccommodationReviews(propertyId, filter);
  const reply = useReplyToReview();
  const setStatus = useSetReviewStatus();

  const [replying, setReplying] = useState<Review | null>(null);
  const [replyText, setReplyText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const items = reviews.data?.items ?? [];
  const average = reviews.data?.average ?? 0;
  const count = reviews.data?.count ?? 0;
  const hiddenCount = items.filter((item) => item.status === 'hidden').length;
  const repliedCount = items.filter((item) => item.replied_at).length;

  const openReply = (review: Review) => {
    setReplying(review);
    setReplyText(review.owner_reply ?? '');
    setError(null);
  };

  const submitReply = async () => {
    if (!replying) return;
    if (replyText.trim().length < 2) {
      setError('Yanıt en az 2 karakter olmalı.');
      return;
    }
    try {
      await reply.mutateAsync({ reviewId: replying.id, reply: replyText.trim() });
      setReplying(null);
      void reviews.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Yanıt gönderilemedi.');
    }
  };

  const toggleStatus = async (review: Review) => {
    setError(null);
    try {
      await setStatus.mutateAsync({
        reviewId: review.id,
        status: review.status === 'published' ? 'hidden' : 'published',
      });
      void reviews.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Yorum durumu değiştirilemedi.');
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Yorum ve değerlendirmeler</AppText>
          <AppText variant="caption" color="textTertiary">
            Misafir geri bildirimleri ve otel yanıtları
          </AppText>
        </View>
        <StarRating rating={average} count={count} size={16} />
      </View>

      <View style={styles.stats}>
        <View style={styles.statTile}>
          <StatTile label="Ortalama puan" value={average.toFixed(1)} icon="star-outline" tone="warning" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Yayınlanan yorum" value={String(count)} icon="chatbubbles-outline" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Yanıtlanan" value={String(repliedCount)} icon="return-up-back-outline" tone="success" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Gizlenen" value={String(hiddenCount)} icon="eye-off-outline" tone="danger" />
        </View>
      </View>

      <View style={styles.filters}>
        {(
          [
            { value: 'all', label: 'Tümü' },
            { value: 'published', label: 'Yayında' },
            { value: 'hidden', label: 'Gizli' },
          ] as { value: StatusFilter; label: string }[]
        ).map((entry) => (
          <Chip
            key={entry.value}
            label={entry.label}
            active={filter === entry.value}
            onPress={() => setFilter(entry.value)}
          />
        ))}
      </View>

      {error ? <InlineError message={error} /> : null}

      {reviews.isLoading ? (
        <LoadingBlock height={220} />
      ) : reviews.isError ? (
        <InlineError
          message={reviews.error instanceof Error ? reviews.error.message : 'Yorumlar yüklenemedi.'}
          onRetry={() => void reviews.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="Yorum yok"
          message="Konaklama tamamlandığında misafirler deneyimlerini puanlayabilir. Yorumlar burada listelenir."
          compact
        />
      ) : (
        <View style={styles.list}>
          {items.map((review) => (
            <AccCard key={review.id} padding={13} style={styles.card}>
              <View style={styles.reviewHead}>
                <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}>
                  <AppText variant="bodyStrong" color="primary">
                    {review.guest_name.slice(0, 1).toUpperCase()}
                  </AppText>
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>{review.guest_name}</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatDate(review.created_at.slice(0, 10))}
                    {review.status === 'hidden' ? ' · Gizli' : ''}
                  </AppText>
                </View>
                <View style={styles.ratingBox}>
                  <AppText variant="bodyStrong">{review.rating.toFixed(1)}</AppText>
                  <Ionicons name="star" size={12} color={theme.colors.warning} />
                </View>
              </View>

              {review.comment ? (
                <AppText variant="body" color="textSecondary">
                  {review.comment}
                </AppText>
              ) : null}

              <View style={styles.subScores}>
                {SUB_SCORES.map((score) => {
                  const value = review[score.key];
                  if (value === null || value === undefined) return null;
                  return (
                    <View key={score.key} style={[styles.subScore, { backgroundColor: theme.colors.surfaceMuted }]}>
                      <AppText variant="caption" color="textTertiary" style={styles.tiny}>{score.label}</AppText>
                      <AppText variant="caption" color="text">{value}/5</AppText>
                    </View>
                  );
                })}
              </View>

              {review.owner_reply ? (
                <View style={[styles.replyBox, { backgroundColor: theme.colors.primarySoft, borderLeftColor: theme.colors.primary }]}>
                  <AppText variant="caption" color="primary" style={styles.replyLabel}>
                    Otel yanıtı
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    {review.owner_reply}
                  </AppText>
                </View>
              ) : null}

              <View style={[styles.cardActions, { borderTopColor: theme.colors.divider }]}>
                <Button
                  label={review.owner_reply ? 'Yanıtı düzenle' : 'Yanıtla'}
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => openReply(review)}
                />
                <Button
                  label={review.status === 'published' ? 'Gizle' : 'Yayınla'}
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => void toggleStatus(review)}
                />
              </View>
            </AccCard>
          ))}
        </View>
      )}

      <InfoBanner text="Yorumlar yalnızca konaklamasını tamamlamış misafirler tarafından oluşturulur. Gizlenen yorumlar silinmez; denetim kaydı ve ortalama puan geçmişi korunur. Yanıtlar misafire bildirim olarak gönderilir." />

      <ModalSheet
        visible={Boolean(replying)}
        onClose={() => setReplying(null)}
        title={replying?.owner_reply ? 'Yanıtı düzenle' : 'Yoruma yanıt ver'}
        subtitle={replying?.guest_name}
        maxWidth={520}
        footer={<Button label="Yanıtı gönder" loading={reply.isPending} onPress={() => void submitReply()} />}
      >
        <View style={{ gap: 10 }}>
          {replying?.comment ? (
            <View style={[styles.quote, { backgroundColor: theme.colors.surfaceMuted }]}>
              <AppText variant="caption" color="textSecondary">
                “{replying.comment}”
              </AppText>
            </View>
          ) : null}
          <TextField
            label="Otel yanıtı"
            value={replyText}
            onChangeText={setReplyText}
            multiline
            numberOfLines={5}
            placeholder="Misafire profesyonel ve çözüm odaklı yanıt yaz"
            error={error}
          />
        </View>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { width: '23.4%', minWidth: 140, flexGrow: 1 },
  filters: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  list: { gap: 8 },
  card: { gap: 7 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  ratingBox: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  subScores: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  subScore: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tiny: { fontSize: 9 },
  replyBox: { gap: 2, padding: 9, borderRadius: 7, borderLeftWidth: 2 },
  replyLabel: { fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: 2, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  quote: { padding: 9, borderRadius: 8 },
});
