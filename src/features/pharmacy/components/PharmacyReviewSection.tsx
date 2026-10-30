import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button, Card, Skeleton } from '@/components/ui';
import {
  useDeletePlaceReview,
  useHelpfulReview,
  usePlaceReviews,
  useReportContent,
} from '@/features/explore/hooks/use-explore';
import type { PlaceReview } from '@/features/explore/types';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

import { PharmacyReviewModal } from './PharmacyReviewModal';

const BREAKDOWN_ORDER = [5, 4, 3, 2, 1];

/**
 * Eczane değerlendirmeleri. Puan yalnızca yayınlanmış (moderasyondan geçmiş)
 * yorumlardan hesaplanır; yorum yoksa yıldız/puan gösterilmez.
 */
export function PharmacyReviewSection({
  placeId,
  pharmacyName,
  rating,
  reviewCount,
  ratingBreakdown,
}: {
  placeId: string;
  pharmacyName: string;
  rating: number | null;
  reviewCount: number;
  ratingBreakdown: Record<string, number>;
}) {
  const { theme } = useTheme();
  const [sort] = useState<'new'>('new');
  const reviews = usePlaceReviews(placeId, sort);
  const helpful = useHelpfulReview(placeId);
  const report = useReportContent();
  const remove = useDeletePlaceReview(placeId);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<PlaceReview | null>(null);

  const items = reviews.data?.items ?? [];
  const mine = items.find((review) => review.is_mine) ?? null;
  const maxCount = Math.max(1, ...BREAKDOWN_ORDER.map((star) => ratingBreakdown[String(star)] ?? 0));

  const openComposer = (review?: PlaceReview) => {
    haptics.tap();
    setEditing(review ?? null);
    setComposerOpen(true);
  };

  const onReport = (review: PlaceReview) => {
    Alert.alert(
      'Değerlendirmeyi bildir',
      'Bu değerlendirme sahte, spam veya kişisel sağlık bilgisi içeriyor mu?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sahte / spam',
          onPress: () =>
            report.mutate(
              { targetType: 'place_review', targetId: review.id, reason: 'spam' },
              {
                onSuccess: () => Alert.alert('Bildirimin alındı', 'Moderatör ekibi inceleyecek.'),
                onError: (error) => Alert.alert('Bildirilemedi', error.message),
              },
            ),
        },
        {
          text: 'Kişisel sağlık bilgisi',
          onPress: () =>
            report.mutate(
              {
                targetType: 'place_review',
                targetId: review.id,
                reason: 'sensitive',
                details: 'Kişisel sağlık verisi / reçete bilgisi içeriyor.',
              },
              {
                onSuccess: () =>
                  Alert.alert('Bildirimin alındı', 'Moderatör ekibi hassas veri için inceleyecek.'),
                onError: (error) => Alert.alert('Bildirilemedi', error.message),
              },
            ),
        },
      ],
    );
  };

  const onDelete = (review: PlaceReview) => {
    Alert.alert('Değerlendirmeyi sil', 'Değerlendirmen kaldırılacak. Emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          remove.mutate(review.id, {
            onError: (error) => Alert.alert('Silinemedi', error.message),
          }),
      },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText variant="h3">Değerlendirmeler</AppText>
        {reviewCount > 0 ? (
          <AppText variant="caption" color="textTertiary">
            {reviewCount} değerlendirme
          </AppText>
        ) : null}
      </View>

      {rating != null && reviewCount > 0 ? (
        <Card padding={14}>
          <View style={styles.summary}>
            <View style={styles.summaryLeft}>
              <AppText variant="display" style={styles.average}>
                {rating.toFixed(1)}
              </AppText>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Ionicons
                    key={star}
                    name={star <= Math.round(rating) ? 'star' : 'star-outline'}
                    size={13}
                    color={theme.colors.warning}
                  />
                ))}
              </View>
              <AppText variant="caption" color="textTertiary">
                {reviewCount} yorum
              </AppText>
            </View>
            <View style={styles.flex}>
              {BREAKDOWN_ORDER.map((star) => {
                const count = ratingBreakdown[String(star)] ?? 0;
                return (
                  <View key={star} style={styles.breakdownRow}>
                    <AppText variant="caption" color="textTertiary" style={styles.starLabel}>
                      {star}
                    </AppText>
                    <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.round((count / maxCount) * 100)}%`,
                            backgroundColor: theme.colors.warning,
                          },
                        ]}
                      />
                    </View>
                    <AppText variant="caption" color="textTertiary" style={styles.barCount}>
                      {count}
                    </AppText>
                  </View>
                );
              })}
            </View>
          </View>
        </Card>
      ) : null}

      <Button
        label={mine ? 'Değerlendirmeni düzenle' : 'Eczaneyi değerlendir'}
        variant="secondary"
        size="sm"
        leftIcon={<Ionicons name="star-outline" size={15} color={theme.colors.primaryDeep} />}
        onPress={() => openComposer(mine ?? undefined)}
      />

      {reviews.isLoading ? (
        <View style={styles.skeletons}>
          <Skeleton height={86} radius={16} />
          <Skeleton height={86} radius={16} />
        </View>
      ) : reviews.isError ? (
        <View style={[styles.empty, { borderColor: theme.colors.border }]}>
          <Ionicons name="cloud-offline-outline" size={18} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Değerlendirmeler yüklenemedi. Bağlantını kontrol edip tekrar dene.
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Değerlendirmeleri yenile"
            onPress={() => void reviews.refetch()}
          >
            <AppText variant="caption" color="primaryDeep">
              Yenile
            </AppText>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={[styles.empty, { borderColor: theme.colors.border }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Bu eczane için henüz değerlendirme yapılmadı. Puan ortalaması yalnızca gerçek
            değerlendirmelerden oluşur.
          </AppText>
        </View>
      ) : (
        items.map((review) => (
          <Card key={review.id} padding={13}>
            <View style={styles.reviewHead}>
              <Avatar
                uri={mediaPublicUrl('avatar', review.author.avatar_path)}
                name={review.author.display_name ?? review.author.username}
                size={36}
              />
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {review.author.display_name ?? review.author.username}
                  </AppText>
                  {review.author.is_verified ? (
                    <Ionicons name="checkmark-circle" size={12} color={theme.colors.primary} />
                  ) : null}
                </View>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  @{review.author.username} · {formatDateTr(review.created_at)}
                </AppText>
              </View>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Ionicons
                    key={star}
                    name={star <= review.rating ? 'star' : 'star-outline'}
                    size={11}
                    color={theme.colors.warning}
                  />
                ))}
              </View>
            </View>

            {review.body ? (
              <AppText variant="body" color="textSecondary" style={styles.reviewBody}>
                {review.body}
              </AppText>
            ) : null}

            {review.reply ? (
              <View
                style={[
                  styles.reply,
                  { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
                ]}
              >
                <AppText variant="caption" color="primaryDeep">
                  Eczane yanıtı
                </AppText>
                <AppText variant="caption" color="textSecondary">
                  {review.reply.body}
                </AppText>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Değerlendirmeyi faydalı bul"
                accessibilityState={{ selected: review.helpful_by_me }}
                onPress={() => helpful.mutate(review.id)}
                style={styles.action}
              >
                {helpful.isPending ? (
                  <ActivityIndicator size="small" color={theme.colors.textTertiary} />
                ) : (
                  <Ionicons
                    name={review.helpful_by_me ? 'thumbs-up' : 'thumbs-up-outline'}
                    size={13}
                    color={review.helpful_by_me ? theme.colors.primaryDeep : theme.colors.textTertiary}
                  />
                )}
                <AppText variant="caption" color="textTertiary">
                  Faydalı ({review.helpful_count})
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Değerlendirmeyi bildir"
                onPress={() => onReport(review)}
                style={styles.action}
              >
                <Ionicons name="flag-outline" size={12} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textTertiary">
                  Bildir
                </AppText>
              </Pressable>
              {review.is_mine ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Değerlendirmeni düzenle"
                    onPress={() => openComposer(review)}
                    style={styles.action}
                  >
                    <Ionicons name="create-outline" size={12} color={theme.colors.textTertiary} />
                    <AppText variant="caption" color="textTertiary">
                      Düzenle
                    </AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Değerlendirmeni sil"
                    onPress={() => onDelete(review)}
                    style={styles.action}
                  >
                    <Ionicons name="trash-outline" size={12} color={theme.colors.danger} />
                    <AppText variant="caption" color="danger">
                      Sil
                    </AppText>
                  </Pressable>
                </>
              ) : null}
            </View>
          </Card>
        ))
      )}

      <View style={styles.privacyNote}>
        <Ionicons name="lock-closed-outline" size={12} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          Değerlendirmelerde kişisel sağlık bilgisi, reçete fotoğrafı veya TC kimlik numarası
          paylaşmayın. Bu tür içerikler yayınlanmaz.
        </AppText>
      </View>

      <PharmacyReviewModal
        visible={composerOpen}
        placeId={placeId}
        pharmacyName={pharmacyName}
        existing={editing}
        onClose={() => setComposerOpen(false)}
        onSaved={() => {
          setComposerOpen(false);
          setEditing(null);
          void reviews.refetch();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  flex: { flex: 1 },
  summary: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  summaryLeft: { alignItems: 'center', gap: 3, width: 78 },
  average: { lineHeight: 40 },
  starRow: { flexDirection: 'row', gap: 1 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 1.5 },
  starLabel: { width: 10, textAlign: 'center' },
  barTrack: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 5, borderRadius: 3 },
  barCount: { width: 22, textAlign: 'right' },
  skeletons: { gap: 8 },
  empty: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reviewBody: { marginTop: 7 },
  reply: {
    marginTop: 8,
    padding: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 9, flexWrap: 'wrap' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },
  privacyNote: { flexDirection: 'row', gap: 5, alignItems: 'flex-start', paddingTop: 2 },
});
