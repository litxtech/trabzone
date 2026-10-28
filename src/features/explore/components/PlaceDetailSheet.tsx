import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar, Button, Card, IconButton, Skeleton } from '@/components/ui';
import type { ViewerMedia } from '@/features/feed/components/MediaViewer';
import { MarketMediaViewer } from '@/features/marketplace/components/MarketMediaViewer';
import { publicMediaUrl } from '@/features/media/media-service';
import { useStartDirectConversation } from '@/features/messaging/hooks/use-chat';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

import {
  useDeletePlaceReview,
  useHelpfulReview,
  usePlaceDetail,
  usePlaceOwnerContact,
  usePlaceReviewReplies,
  usePlaceReviews,
  useReportContent,
  useTogglePlaceFavorite,
  useUpsertPlaceReviewReply,
} from '../hooks/use-explore';
import type { PlaceDetail, PlaceMedia, PlaceReview } from '../types';
import { formatDecimal, openingHoursEntries, openNow, priceLevelLabel } from '../utils/format';
import { AddPlaceMediaModal } from './AddPlaceMediaModal';
import { AddReviewModal } from './AddReviewModal';
import { PlaceClaimModal } from './PlaceClaimModal';
import { StorageImage } from './StorageImage';

type TabKey = 'overview' | 'photos' | 'videos' | 'reviews' | 'location';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Genel Bakış' },
  { key: 'photos', label: 'Fotoğraflar' },
  { key: 'videos', label: 'Videolar' },
  { key: 'reviews', label: 'Yorumlar' },
  { key: 'location', label: 'Konum' },
];

const REVIEW_SORTS = [
  { key: 'new' as const, label: 'En yeni' },
  { key: 'helpful' as const, label: 'En faydalı' },
  { key: 'highest' as const, label: 'En yüksek' },
  { key: 'lowest' as const, label: 'En düşük' },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PHOTO_SIZE = (SCREEN_WIDTH - 48 - 12) / 3;

type Props = {
  visible: boolean;
  placeId: string | null;
  onClose: () => void;
  onManage?: (placeId: string) => void;
};

export function PlaceDetailSheet({ visible, placeId, onClose, onManage }: Props) {
  const { theme, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const detail = usePlaceDetail(placeId);
  const place = detail.data ?? null;
  const [tab, setTab] = useState<TabKey>('overview');
  const [reviewSort, setReviewSort] = useState<'new' | 'highest' | 'lowest' | 'helpful'>('new');
  const reviews = usePlaceReviews(placeId, reviewSort);
  const replies = usePlaceReviewReplies(placeId, tab === 'reviews');
  const reply = useUpsertPlaceReviewReply(placeId ?? '');
  const ownerContact = usePlaceOwnerContact(placeId, Boolean(place?.owner));
  const favorite = useTogglePlaceFavorite();
  const helpful = useHelpfulReview(placeId ?? '');
  const removeReview = useDeletePlaceReview(placeId ?? '');
  const report = useReportContent();
  const startChat = useStartDirectConversation();

  const [reviewOpen, setReviewOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<PlaceReview | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [viewer, setViewer] = useState<{ media: ViewerMedia[]; index: number } | null>(null);
  const [replyTarget, setReplyTarget] = useState<PlaceReview | null>(null);
  const [replyBody, setReplyBody] = useState('');

  const mediaImages = useMemo(
    () => (place?.media ?? []).filter((item) => item.kind === 'image'),
    [place?.media],
  );
  const gallery: ViewerMedia[] = useMemo(() => {
    if (!place) {
      return [];
    }
    const fromMedia: ViewerMedia[] = place.media.map((item) => ({
      id: item.id,
      uri: publicMediaUrl('place-media', item.storage_path) ?? '',
      media_type: item.kind,
    }));
    const fromReels: ViewerMedia[] = place.reels.map((reel) => ({
      id: `reel-${reel.id}`,
      uri: publicMediaUrl('reels', reel.video_path) ?? '',
      media_type: 'video',
    }));
    return [...fromMedia, ...fromReels].filter((item) => item.uri);
  }, [place]);

  const close = () => {
    setTab('overview');
    setReviewOpen(false);
    setMediaOpen(false);
    setClaimOpen(false);
    setViewer(null);
    onClose();
  };

  const myReview = useMemo(
    () => reviews.data?.items.find((review) => review.is_mine) ?? null,
    [reviews.data?.items],
  );

  /** İşletme yanıtları ayrı RPC'den gelir; yorum listesiyle birleştirilir. */
  const enrichedReviews = useMemo(() => {
    const items = reviews.data?.items ?? [];
    const map = replies.data ?? {};
    return items.map((item) => ({ ...item, reply: map[item.id] ?? null }));
  }, [replies.data, reviews.data?.items]);

  const reportContent = (
    targetType: 'place' | 'place_review' | 'place_media',
    targetId: string,
    label: string,
  ) => {
    Alert.alert(`${label} şikâyet et`, 'Nedenini seç. Şikâyetin moderasyon ekibine iletilir.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Spam / reklam',
        onPress: () =>
          report.mutate(
            { targetType, targetId, reason: 'spam' },
            { onSuccess: () => Alert.alert('Şikâyetin alındı', 'Moderasyon ekibi inceleyecek.') },
          ),
      },
      {
        text: 'Yanlış konum',
        onPress: () =>
          report.mutate(
            { targetType, targetId, reason: 'wrong_location' },
            { onSuccess: () => Alert.alert('Şikâyetin alındı', 'Konum bilgisi incelenecek.') },
          ),
      },
      {
        text: 'Uygunsuz içerik',
        style: 'destructive',
        onPress: () =>
          report.mutate(
            { targetType, targetId, reason: 'inappropriate' },
            { onSuccess: () => Alert.alert('Şikâyetin alındı', 'Moderasyon ekibi inceleyecek.') },
          ),
      },
    ]);
  };

  const share = async () => {
    if (!place) {
      return;
    }
    try {
      await Share.share({
        message: `${place.name} — ${[place.district, place.neighborhood].filter(Boolean).join(', ')} · Trabzone Keşfet`,
      });
    } catch {
      // Paylaşım iptal edildi.
    }
  };

  const directions = async () => {
    if (!place) {
      return;
    }
    const label = encodeURIComponent(place.name);
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${place.lat},${place.lng}&q=${label}`
        : `geo:${place.lat},${place.lng}?q=${place.lat},${place.lng}(${label})`;
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('Harita açılamadı', 'Cihazda yüklü bir harita uygulaması bulunamadı.');
      return;
    }
    await Linking.openURL(url);
  };

  const openMessages = () => {
    const ownerId = ownerContact.data?.id;
    if (!place?.owner || !ownerId) {
      Alert.alert(
        'Mesaj gönderilemiyor',
        ownerContact.isFetching
          ? 'İşletme sahibi bilgisi yükleniyor, birkaç saniye sonra tekrar dene.'
          : 'Bu işletmenin sahiplenilmiş ve mesajlaşmaya açık bir hesabı bulunmuyor.',
      );
      return;
    }
    startChat.mutate(ownerId, {
      onSuccess: ({ id }) => router.push(`/chat/${id}` as never),
      onError: (error) => Alert.alert('Sohbet açılamadı', error.message),
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {detail.isLoading || !place ? (
          <View style={[styles.loading, { paddingTop: insets.top + 10 }]}>
            <Skeleton height={230} radius={0} />
            <View style={styles.loadingBody}>
              <Skeleton height={26} width="68%" radius={8} />
              <Skeleton height={16} width="40%" radius={6} />
              <Skeleton height={110} radius={18} />
              <Skeleton height={110} radius={18} />
            </View>
          </View>
        ) : detail.isError ? (
          <View style={[styles.errorState, { paddingTop: insets.top + 40 }]}>
            <IconButton name="close" accessibilityLabel="Kapat" variant="surface" onPress={close} />
            <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.textTertiary} />
            <AppText variant="h3">İşletme yüklenemedi</AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Kayıt kaldırılmış veya bağlantı sorunlu olabilir.
            </AppText>
            <Button label="Tekrar dene" variant="secondary" onPress={() => void detail.refetch()} />
          </View>
        ) : (
          <>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 150 + insets.bottom }}
            >
              <View style={styles.coverWrap}>
                <StorageImage
                  path={place.cover_path ?? mediaImages[0]?.storage_path ?? null}
                  bucket="place-media"
                  style={styles.cover}
                  contentFit="cover"
                />
                <View style={styles.coverShade} />
                <View style={[styles.coverTop, { paddingTop: insets.top + 6 }]}>
                  <IconButton
                    name="arrow-back"
                    accessibilityLabel="Geri"
                    variant="glass"
                    color="#FFFFFF"
                    onPress={close}
                  />
                  <View style={styles.coverActions}>
                    <IconButton
                      name={place.is_favorite ? 'heart' : 'heart-outline'}
                      accessibilityLabel={
                        place.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'
                      }
                      variant="glass"
                      color={place.is_favorite ? '#FF6B70' : '#FFFFFF'}
                      onPress={() => favorite.mutate(place.id)}
                    />
                    <IconButton
                      name="share-social-outline"
                      accessibilityLabel="Paylaş"
                      variant="glass"
                      color="#FFFFFF"
                      onPress={() => void share()}
                    />
                  </View>
                </View>
                {place.is_verified ? (
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" />
                    <AppText variant="caption" style={{ color: '#FFFFFF' }}>
                      Doğrulanmış işletme
                    </AppText>
                  </View>
                ) : null}
              </View>

              <View style={styles.headBlock}>
                <View style={styles.titleRow}>
                  <View style={styles.flex}>
                    <AppText variant="h2">{place.name}</AppText>
                    <AppText variant="caption" color="textSecondary">
                      {[place.category?.name, place.district, place.neighborhood]
                        .filter(Boolean)
                        .join(' · ')}
                    </AppText>
                  </View>
                  <View style={[styles.ratingPill, { backgroundColor: theme.colors.warningSoft }]}>
                    <Ionicons name="star" size={13} color={theme.colors.warning} />
                    <AppText variant="bodyStrong" color="text">
                      {place.rating_avg != null ? formatDecimal(place.rating_avg, 1) : 'Yeni'}
                    </AppText>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Yorumları aç"
                    onPress={() => setTab('reviews')}
                  >
                    <AppText variant="caption" color="primaryDeep">
                      {place.review_count} yorum
                    </AppText>
                  </Pressable>
                  <AppText variant="caption" color="textTertiary">
                    · {place.photo_count} fotoğraf · {place.video_count} video
                  </AppText>
                  {openNow(place.opening_hours) != null ? (
                    <View
                      style={[
                        styles.openPill,
                        {
                          backgroundColor: openNow(place.opening_hours)
                            ? theme.colors.successSoft
                            : theme.colors.dangerSoft,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.openDot,
                          {
                            backgroundColor: openNow(place.opening_hours)
                              ? theme.colors.success
                              : theme.colors.danger,
                          },
                        ]}
                      />
                      <AppText variant="caption" color="textSecondary">
                        {openNow(place.opening_hours) ? 'Açık' : 'Kapalı'}
                      </AppText>
                    </View>
                  ) : null}
                </View>

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabs}
                >
                  {TABS.map((item) => {
                    const selected = tab === item.key;
                    const count =
                      item.key === 'photos'
                        ? place.photo_count
                        : item.key === 'videos'
                          ? place.video_count
                          : item.key === 'reviews'
                            ? place.review_count
                            : null;
                    return (
                      <Pressable
                        key={item.key}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          haptics.selection();
                          setTab(item.key);
                        }}
                        style={[
                          styles.tab,
                          {
                            borderBottomColor: selected ? theme.colors.primary : 'transparent',
                          },
                        ]}
                      >
                        <AppText
                          variant="label"
                          color={selected ? 'text' : 'textTertiary'}
                          style={selected ? styles.tabSelected : undefined}
                        >
                          {item.label}
                          {count != null && count > 0 ? ` ${count}` : ''}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.body}>
                {tab === 'overview' ? (
                  <OverviewTab
                    place={place}
                    onAddPhoto={() => setMediaOpen(true)}
                    onOpenVideo={(index) => setViewer({ media: gallery, index })}
                    onReportMedia={(media) => reportContent('place_media', media.id, 'Medya')}
                    onOpenReel={(reelId) => router.push(`/reel/${reelId}` as never)}
                    onOpenPost={(postId) => router.push(`/post/${postId}` as never)}
                  />
                ) : tab === 'photos' ? (
                  <PhotosTab
                    place={place}
                    images={mediaImages}
                    onAdd={() => setMediaOpen(true)}
                    onOpen={(index) => setViewer({ media: gallery, index })}
                  />
                ) : tab === 'videos' ? (
                  <VideosTab
                    place={place}
                    onOpen={(index) => setViewer({ media: gallery, index })}
                    onAdd={() => setMediaOpen(true)}
                    onOpenReel={(reelId) => router.push(`/reel/${reelId}` as never)}
                  />
                ) : tab === 'reviews' ? (
                  <ReviewsTab
                    place={place}
                    reviews={enrichedReviews}
                    loading={reviews.isLoading}
                    sort={reviewSort}
                    onSort={setReviewSort}
                    onWrite={() => {
                      setEditingReview(null);
                      setReviewOpen(true);
                    }}
                    onEdit={(review) => {
                      setEditingReview(review);
                      setReviewOpen(true);
                    }}
                    onDelete={(review) =>
                      Alert.alert('Yorumu sil', 'Yorumun kalıcı olarak kaldırılacak. Emin misin?', [
                        { text: 'Vazgeç', style: 'cancel' },
                        {
                          text: 'Sil',
                          style: 'destructive',
                          onPress: () =>
                            removeReview.mutate(review.id, {
                              onSuccess: () => {
                                haptics.success();
                                void reviews.refetch();
                              },
                              onError: (error) => Alert.alert('Silinemedi', error.message),
                            }),
                        },
                      ])
                    }
                    onHelpful={(review) => helpful.mutate(review.id)}
                    onReport={(review) => reportContent('place_review', review.id, 'Yorumu')}
                    onReply={(review) => {
                      setReplyTarget(review);
                      setReplyBody(review.reply?.body ?? '');
                    }}
                  />
                ) : (
                  <LocationTab
                    place={place}
                    dark={scheme === 'dark'}
                    onDirections={() => void directions()}
                  />
                )}
              </View>
            </ScrollView>

            <View
              style={[
                styles.actionBar,
                {
                  backgroundColor: theme.colors.surface,
                  borderTopColor: theme.colors.divider,
                  paddingBottom: insets.bottom + 10,
                },
              ]}
            >
              <View style={styles.quickActions}>
                <QuickAction
                  icon="navigate-outline"
                  label="Yol Tarifi"
                  onPress={() => void directions()}
                />
                <QuickAction
                  icon="call-outline"
                  label="Ara"
                  disabled={!place.phone}
                  onPress={() => place.phone && void Linking.openURL(`tel:${place.phone}`)}
                />
                <QuickAction
                  icon="chatbubble-outline"
                  label="Mesaj"
                  disabled={!place.owner}
                  onPress={openMessages}
                />
                <QuickAction
                  icon="image-outline"
                  label="Fotoğraf"
                  onPress={() => setMediaOpen(true)}
                />
              </View>
              <View style={styles.mainButtons}>
                {place.is_manager && onManage ? (
                  <Button
                    label="İşletme paneli"
                    variant="outline"
                    onPress={() => onManage(place.id)}
                    style={styles.flex}
                  />
                ) : null}
                {place.can_claim ? (
                  <Button
                    label="İşletmemi sahiplen"
                    variant={place.is_manager ? 'outline' : 'secondary'}
                    onPress={() => setClaimOpen(true)}
                    style={styles.flex}
                  />
                ) : null}
                {!place.is_manager ? (
                  <Button
                    label={myReview ? 'Yorumunu düzenle' : 'Yorum yaz'}
                    onPress={() => {
                      setEditingReview(myReview);
                      setReviewOpen(true);
                    }}
                    style={styles.flex}
                  />
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="İşletmeyi şikâyet et"
                onPress={() => reportContent('place', place.id, 'İşletmeyi')}
                style={styles.reportRow}
              >
                <Ionicons name="flag-outline" size={12} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textTertiary">
                  Bilgi hatası veya uygunsuz içerik bildir
                </AppText>
              </Pressable>
            </View>

            <AddReviewModal
              visible={reviewOpen}
              placeId={place.id}
              placeName={place.name}
              existing={editingReview}
              onClose={() => {
                setReviewOpen(false);
                setEditingReview(null);
              }}
              onSaved={() => {
                setReviewOpen(false);
                setEditingReview(null);
                void reviews.refetch();
                void detail.refetch();
              }}
            />

            <AddPlaceMediaModal
              visible={mediaOpen}
              placeId={place.id}
              placeName={place.name}
              onClose={() => setMediaOpen(false)}
              onUploaded={() => {
                setMediaOpen(false);
                void detail.refetch();
              }}
            />

            <PlaceClaimModal
              visible={claimOpen}
              placeId={place.id}
              placeName={place.name}
              onClose={() => setClaimOpen(false)}
              onSubmitted={() => {
                setClaimOpen(false);
                void detail.refetch();
              }}
            />

            <ReviewReplyModal
              visible={Boolean(replyTarget)}
              review={replyTarget}
              value={replyBody}
              onChange={setReplyBody}
              onClose={() => setReplyTarget(null)}
              onSubmit={() => {
                if (!replyTarget) {
                  return;
                }
                if (replyBody.trim().length < 2) {
                  Alert.alert('Yanıt çok kısa', 'Lütfen en az 2 karakterlik bir yanıt yaz.');
                  return;
                }
                reply.mutate(
                  { reviewId: replyTarget.id, body: replyBody },
                  {
                    onSuccess: () => {
                      haptics.success();
                      setReplyTarget(null);
                      void replies.refetch();
                    },
                    onError: (error) => Alert.alert('Yanıt kaydedilemedi', error.message),
                  },
                );
              }}
            />

            {viewer ? (
              <MarketMediaViewer
                visible
                items={viewer.media.map((item) => ({
                  id: item.id,
                  kind: item.media_type,
                  uri: item.uri,
                }))}
                initialIndex={viewer.index}
                onClose={() => setViewer(null)}
              />
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}

function OverviewTab({
  place,
  onAddPhoto,
  onOpenVideo,
  onReportMedia,
  onOpenReel,
  onOpenPost,
}: {
  place: PlaceDetail;
  onAddPhoto: () => void;
  onOpenVideo: (index: number) => void;
  onReportMedia: (media: PlaceMedia) => void;
  onOpenReel: (reelId: string) => void;
  onOpenPost: (postId: string) => void;
}) {
  const { theme } = useTheme();
  const hours = openingHoursEntries(place.opening_hours);
  const breakdown = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: Number(place.rating_breakdown?.[String(star)] ?? 0),
  }));
  const maxCount = Math.max(1, ...breakdown.map((row) => row.count));

  return (
    <View style={styles.tabContent}>
      <Card style={styles.ratingCard}>
        <View style={styles.ratingHead}>
          <View>
            <AppText variant="display">
              {place.rating_avg != null ? formatDecimal(place.rating_avg, 1) : '—'}
            </AppText>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Ionicons
                  key={star}
                  name={star <= Math.round(place.rating_avg ?? 0) ? 'star' : 'star-outline'}
                  size={14}
                  color={theme.colors.warning}
                />
              ))}
            </View>
            <AppText variant="caption" color="textTertiary">
              {place.review_count} değerlendirme
            </AppText>
          </View>
          <View style={styles.breakdown}>
            {breakdown.map((row) => (
              <View key={row.star} style={styles.breakdownRow}>
                <AppText variant="caption" color="textTertiary" style={styles.breakdownStar}>
                  {row.star}
                </AppText>
                <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.round((row.count / maxCount) * 100)}%`,
                        backgroundColor: theme.colors.warning,
                      },
                    ]}
                  />
                </View>
                <AppText variant="caption" color="textTertiary" style={styles.breakdownCount}>
                  {row.count}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      </Card>

      <View style={styles.infoList}>
        {place.address ? <InfoRow icon="location-outline" text={place.address} /> : null}
        {place.phone ? (
          <InfoRow
            icon="call-outline"
            text={place.phone}
            onPress={() => void Linking.openURL(`tel:${place.phone}`)}
          />
        ) : null}
        {place.website ? (
          <InfoRow
            icon="globe-outline"
            text={place.website.replace(/^https?:\/\//, '')}
            onPress={() => void Linking.openURL(place.website ?? '')}
          />
        ) : null}
        <InfoRow
          icon="pricetag-outline"
          text={priceLevelLabel(place.price_level) ?? 'Fiyat aralığı bilgisi yok'}
        />
        <InfoRow
          icon="eye-outline"
          text={`${place.view_count} görüntülenme · ${place.favorite_count} kaydetme`}
        />
        {place.external_provider ? (
          <InfoRow
            icon="information-circle-outline"
            text={`Kaynak: ${place.attribution_text ?? place.external_provider}${
              place.license_note ? ` (${place.license_note})` : ''
            }`}
            onPress={
              place.external_provider === 'openstreetmap'
                ? () => void Linking.openURL('https://www.openstreetmap.org/copyright')
                : undefined
            }
          />
        ) : null}
      </View>

      {place.description ? (
        <View style={styles.section}>
          <AppText variant="h3">Hakkında</AppText>
          <AppText variant="body" color="textSecondary" style={styles.description}>
            {place.description}
          </AppText>
        </View>
      ) : null}

      {hours.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AppText variant="h3">Çalışma saatleri</AppText>
            {openNow(place.opening_hours) != null ? (
              <AppText
                variant="caption"
                color={openNow(place.opening_hours) ? 'success' : 'danger'}
              >
                {openNow(place.opening_hours) ? 'Şu anda açık' : 'Şu anda kapalı'}
              </AppText>
            ) : null}
          </View>
          <Card style={styles.hoursCard}>
            {hours.map((entry) => (
              <View key={entry.day} style={styles.hoursRow}>
                <AppText variant="body" color="textSecondary" style={styles.flex}>
                  {entry.day}
                </AppText>
                <AppText variant="bodyStrong">{entry.value}</AppText>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {place.media.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AppText variant="h3">Fotoğraflar</AppText>
            <Pressable accessibilityRole="button" onPress={onAddPhoto}>
              <AppText variant="caption" color="primaryDeep">
                Fotoğraf ekle
              </AppText>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {place.media.slice(0, 8).map((media) => (
              <Pressable
                key={media.id}
                accessibilityRole="button"
                accessibilityLabel={media.caption ?? 'İşletme medyası'}
                onLongPress={() => onReportMedia(media)}
                onPress={() => {
                  const index = place.media.findIndex((item) => item.id === media.id);
                  if (index >= 0) {
                    onOpenVideo(index);
                  }
                }}
                style={styles.stripTile}
              >
                <StorageImage
                  path={media.thumb_path ?? media.storage_path}
                  bucket="place-media"
                  style={StyleSheet.absoluteFill}
                />
                {media.kind === 'video' ? (
                  <View style={styles.videoBadge}>
                    <Ionicons name="play" size={13} color="#FFFFFF" />
                  </View>
                ) : null}
                {media.status === 'pending' ? (
                  <View style={[styles.statusBadge, { backgroundColor: theme.colors.warning }]}>
                    <AppText variant="caption" style={{ color: '#FFFFFF', fontSize: 10 }}>
                      Onay bekliyor
                    </AppText>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {place.reels.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="h3">Reels</AppText>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {place.reels.map((reel) => (
              <Pressable
                key={reel.id}
                accessibilityRole="button"
                accessibilityLabel={reel.caption ?? 'Reels videosu'}
                onPress={() => onOpenReel(reel.id)}
                style={[styles.reelTile, { backgroundColor: theme.colors.surfaceMuted }]}
              >
                <StorageImage
                  path={reel.cover_path}
                  bucket="reels"
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.reelShade} />
                <Ionicons name="play-circle" size={26} color="#FFFFFF" style={styles.reelPlay} />
                <AppText variant="caption" style={styles.reelMeta} numberOfLines={1}>
                  @{reel.author.username} · {reel.view_count} izlenme
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {place.posts.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="h3">Gönderiler</AppText>
          {place.posts.map((post) => (
            <Pressable
              key={post.id}
              accessibilityRole="button"
              onPress={() => onOpenPost(post.id)}
              style={[styles.postRow, { borderColor: theme.colors.border }]}
            >
              <Avatar
                uri={mediaPublicUrl('avatar', post.author.avatar_path)}
                name={post.author.display_name ?? post.author.username}
                size={36}
              />
              <View style={styles.flex}>
                <AppText variant="caption" color="textSecondary">
                  @{post.author.username} · {formatDateTr(post.created_at)}
                </AppText>
                <AppText variant="body" numberOfLines={2}>
                  {post.body ?? 'Gönderiyi görüntüle'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.note, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name="information-circle-outline" size={16} color={theme.colors.textSecondary} />
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          İşletme bilgileri{' '}
          {place.is_verified
            ? 'doğrulanmış işletme tarafından'
            : 'Trabzone kullanıcıları ve yönetim ekibi tarafından'}{' '}
          sağlanır. Yorumlar Trabzone kullanıcılarına aittir; harita sağlayıcısı yorumlarıyla
          karıştırılmaz.
        </AppText>
      </View>
    </View>
  );
}

function PhotosTab({
  place,
  images,
  onAdd,
  onOpen,
}: {
  place: PlaceDetail;
  images: PlaceMedia[];
  onAdd: () => void;
  onOpen: (index: number) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.tabContent}>
      <View style={styles.sectionHead}>
        <View>
          <AppText variant="h3">Fotoğraf galerisi</AppText>
          <AppText variant="caption" color="textTertiary">
            {images.length} fotoğraf · kullanıcı ve işletme katkıları
          </AppText>
        </View>
        <Button label="Ekle" variant="secondary" onPress={onAdd} />
      </View>
      {images.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="images-outline" size={28} color={theme.colors.textTertiary} />
          <AppText variant="bodyStrong">Henüz fotoğraf yok</AppText>
          <AppText variant="caption" color="textTertiary" align="center">
            İlk fotoğrafı sen ekle. Yüklediğin fotoğraflar moderasyon onayından sonra yayınlanır.
          </AppText>
          <Button label="Fotoğraf ekle" onPress={onAdd} />
        </Card>
      ) : (
        <View style={styles.grid}>
          {images.map((media, index) => (
            <Pressable
              key={media.id}
              accessibilityRole="button"
              accessibilityLabel={media.caption ?? `${place.name} fotoğrafı`}
              onPress={() => onOpen(index)}
              style={[styles.gridTile, { backgroundColor: theme.colors.surfaceMuted }]}
            >
              <StorageImage
                path={media.thumb_path ?? media.storage_path}
                bucket="place-media"
                style={StyleSheet.absoluteFill}
              />
              {media.status === 'pending' ? (
                <View style={[styles.statusBadge, { backgroundColor: theme.colors.warning }]}>
                  <AppText variant="caption" style={{ color: '#FFFFFF', fontSize: 10 }}>
                    Onay bekliyor
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function VideosTab({
  place,
  onOpen,
  onAdd,
  onOpenReel,
}: {
  place: PlaceDetail;
  onOpen: (index: number) => void;
  onAdd: () => void;
  onOpenReel: (reelId: string) => void;
}) {
  const { theme } = useTheme();
  const videos = place.media.filter((item) => item.kind === 'video');
  return (
    <View style={styles.tabContent}>
      <View style={styles.sectionHead}>
        <View>
          <AppText variant="h3">Videolar</AppText>
          <AppText variant="caption" color="textTertiary">
            İşletme videoları ve etiketli Reels içerikleri
          </AppText>
        </View>
        <Button label="Video ekle" variant="secondary" onPress={onAdd} />
      </View>

      {videos.length === 0 && place.reels.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="videocam-outline" size={28} color={theme.colors.textTertiary} />
          <AppText variant="bodyStrong">Henüz video yok</AppText>
          <AppText variant="caption" color="textTertiary" align="center">
            İşletmenin iç mekânını, ürünlerini veya atmosferini video olarak paylaşabilirsin.
          </AppText>
          <Button label="Video ekle" onPress={onAdd} />
        </Card>
      ) : null}

      {videos.map((video) => {
        const index = place.media.findIndex((item) => item.id === video.id);
        return (
          <Pressable
            key={video.id}
            accessibilityRole="button"
            accessibilityLabel={video.caption ?? 'İşletme videosu'}
            onPress={() => onOpen(index)}
            style={[
              styles.videoRow,
              { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
            ]}
          >
            <View style={[styles.videoThumb, { backgroundColor: theme.colors.surfaceMuted }]}>
              <StorageImage
                path={video.thumb_path ?? video.storage_path}
                bucket="place-media"
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.videoPlay}>
                <Ionicons name="play" size={18} color="#FFFFFF" />
              </View>
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong" numberOfLines={2}>
                {video.caption ?? 'İşletme videosu'}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {video.uploader.display_name ?? video.uploader.username} ·{' '}
                {formatDateTr(video.created_at)}
                {video.duration_ms ? ` · ${Math.round(video.duration_ms / 1000)} sn` : ''}
              </AppText>
              {video.status === 'pending' ? (
                <AppText variant="caption" color="warning">
                  Moderasyon onayı bekliyor
                </AppText>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
          </Pressable>
        );
      })}

      {place.reels.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="h3">Etiketli Reels</AppText>
          {place.reels.map((reel) => (
            <Pressable
              key={reel.id}
              accessibilityRole="button"
              accessibilityLabel={reel.caption ?? 'Reels videosu'}
              onPress={() => onOpenReel(reel.id)}
              style={[
                styles.videoRow,
                { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
              ]}
            >
              <View style={[styles.videoThumb, { backgroundColor: theme.colors.surfaceMuted }]}>
                <StorageImage
                  path={reel.cover_path}
                  bucket="reels"
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.videoPlay}>
                  <Ionicons name="play" size={18} color="#FFFFFF" />
                </View>
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {reel.caption ?? 'Reels'}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  @{reel.author.username} · {reel.view_count} izlenme · {reel.like_count} beğeni
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ReviewsTab({
  place,
  reviews,
  loading,
  sort,
  onSort,
  onWrite,
  onEdit,
  onDelete,
  onHelpful,
  onReport,
  onReply,
}: {
  place: PlaceDetail;
  reviews: PlaceReview[];
  loading: boolean;
  sort: 'new' | 'highest' | 'lowest' | 'helpful';
  onSort: (value: 'new' | 'highest' | 'lowest' | 'helpful') => void;
  onWrite: () => void;
  onEdit: (review: PlaceReview) => void;
  onDelete: (review: PlaceReview) => void;
  onHelpful: (review: PlaceReview) => void;
  onReport: (review: PlaceReview) => void;
  onReply: (review: PlaceReview) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.tabContent}>
      <View style={styles.sectionHead}>
        <View>
          <AppText variant="h3">Yorumlar</AppText>
          <AppText variant="caption" color="textTertiary">
            {place.rating_avg != null
              ? `${formatDecimal(place.rating_avg, 1)} ortalama`
              : 'Henüz puan yok'}{' '}
            · {place.review_count} yorum
          </AppText>
        </View>
        {!place.is_manager ? <Button label="Yorum yaz" onPress={onWrite} /> : null}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sortRow}
      >
        {REVIEW_SORTS.map((item) => {
          const selected = sort === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSort(item.key)}
              style={[
                styles.sortChip,
                {
                  backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceMuted,
                },
              ]}
            >
              <AppText
                variant="caption"
                style={{ color: selected ? theme.colors.onPrimary : theme.colors.textSecondary }}
              >
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? <Skeleton height={90} radius={16} /> : null}

      {!loading && reviews.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="star-outline" size={28} color={theme.colors.textTertiary} />
          <AppText variant="bodyStrong">İlk yorumu sen yaz</AppText>
          <AppText variant="caption" color="textTertiary" align="center">
            Deneyimini paylaşarak diğer kullanıcılara yardımcı ol.
          </AppText>
        </Card>
      ) : null}

      {reviews.map((review) => (
        <Card key={review.id} style={styles.reviewCard}>
          <View style={styles.reviewHead}>
            <Avatar
              uri={mediaPublicUrl('avatar', review.author.avatar_path)}
              name={review.author.display_name ?? review.author.username}
              size={38}
            />
            <View style={styles.flex}>
              <View style={styles.reviewNameRow}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {review.author.display_name ?? review.author.username}
                </AppText>
                {review.author.is_verified ? (
                  <Ionicons name="checkmark-circle" size={13} color={theme.colors.primary} />
                ) : null}
              </View>
              <AppText variant="caption" color="textTertiary">
                @{review.author.username} · {formatDateTr(review.created_at)}
              </AppText>
            </View>
            <View style={styles.reviewStars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Ionicons
                  key={star}
                  name={star <= review.rating ? 'star' : 'star-outline'}
                  size={12}
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

          {review.media.length > 0 ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.reviewMediaRow}
            >
              {review.media.map((media) => (
                <StorageImage
                  key={media.id}
                  path={media.storage_path}
                  bucket="place-media"
                  style={styles.reviewMedia}
                />
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.reviewActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yorumu faydalı bul"
              accessibilityState={{ selected: review.helpful_by_me }}
              onPress={() => onHelpful(review)}
              style={styles.reviewAction}
            >
              <Ionicons
                name={review.helpful_by_me ? 'thumbs-up' : 'thumbs-up-outline'}
                size={14}
                color={review.helpful_by_me ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
              <AppText variant="caption" color="textTertiary">
                Faydalı ({review.helpful_count})
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onReport(review)}
              style={styles.reviewAction}
            >
              <Ionicons name="flag-outline" size={13} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary">
                Şikâyet
              </AppText>
            </Pressable>
            {review.is_mine ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onEdit(review)}
                  style={styles.reviewAction}
                >
                  <Ionicons name="create-outline" size={13} color={theme.colors.textTertiary} />
                  <AppText variant="caption" color="textTertiary">
                    Düzenle
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onDelete(review)}
                  style={styles.reviewAction}
                >
                  <Ionicons name="trash-outline" size={13} color={theme.colors.danger} />
                  <AppText variant="caption" color="danger">
                    Sil
                  </AppText>
                </Pressable>
              </>
            ) : null}
            {place.is_manager && !review.is_mine ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onReply(review)}
                style={styles.reviewAction}
              >
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={13}
                  color={theme.colors.primaryDeep}
                />
                <AppText variant="caption" color="primaryDeep">
                  {review.reply ? 'Yanıtı düzenle' : 'Yanıtla'}
                </AppText>
              </Pressable>
            ) : null}
          </View>

          {review.reply ? (
            <View style={[styles.replyBox, { backgroundColor: theme.colors.surfaceMuted }]}>
              <AppText variant="caption" color="textSecondary">
                İşletme yanıtı · {formatDateTr(review.reply.created_at)}
              </AppText>
              <AppText variant="body" color="textSecondary">
                {review.reply.body}
              </AppText>
            </View>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

function LocationTab({
  place,
  dark,
  onDirections,
}: {
  place: PlaceDetail;
  dark: boolean;
  onDirections: () => void;
}) {
  const { theme } = useTheme();
  const [camera] = useState({ lat: place.lat, lng: place.lng, zoom: 16.5 });
  return (
    <View style={styles.tabContent}>
      <View style={[styles.mapBox, { borderColor: theme.colors.border }]}>
        <MapCanvas
          initialCamera={camera}
          markers={[
            {
              id: place.id,
              kind: 'place',
              lat: place.lat,
              lng: place.lng,
              title: place.name,
              icon: place.category?.icon ?? null,
            },
          ]}
          dark={dark}
          interactive={false}
          onMarkerPress={() => undefined}
          onCameraChange={() => undefined}
        />
      </View>
      <Card style={styles.addressCard}>
        <InfoRow
          icon="location-outline"
          text={place.address ?? [place.district, place.neighborhood].filter(Boolean).join(', ')}
        />
        <InfoRow icon="map-outline" text={`${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`} />
        <Button label="Yol tarifi al" onPress={onDirections} />
        <AppText variant="caption" color="textTertiary" align="center">
          Yol tarifi cihazın harita uygulamasında açılır. Mesafe ve süre bilgisi Trabzone tarafından
          hesaplanmış gibi gösterilmez.
        </AppText>
      </Card>
    </View>
  );
}

function ReviewReplyModal({
  visible,
  review,
  value,
  onChange,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  review: PlaceReview | null;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.replyRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yanıt penceresini kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View style={[styles.replySheet, { backgroundColor: theme.colors.surface }]}>
          <AppText variant="h3">Yoruma yanıt ver</AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={3}>
            {review?.body ?? 'Yorum'}
          </AppText>
          <TextInput
            value={value}
            onChangeText={onChange}
            multiline
            maxLength={1000}
            placeholder="İşletme olarak nazik bir yanıt yaz…"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.replyInput,
              { color: theme.colors.text, backgroundColor: theme.colors.inputBackground },
            ]}
          />
          <View style={styles.replyFooter}>
            <Button label="Vazgeç" variant="outline" onPress={onClose} style={styles.flex} />
            <Button label="Yanıtı gönder" onPress={onSubmit} style={styles.flex} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function InfoRow({
  icon,
  text,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={styles.infoRow}
    >
      <Ionicons name={icon} size={16} color={theme.colors.textTertiary} />
      <AppText variant="body" color="textSecondary" style={styles.flex}>
        {text}
      </AppText>
      {onPress ? (
        <Ionicons name="open-outline" size={13} color={theme.colors.textTertiary} />
      ) : null}
    </Pressable>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={onPress}
      disabled={disabled}
      style={styles.quickAction}
    >
      <View
        style={[
          styles.quickIcon,
          { backgroundColor: theme.colors.primarySoft, opacity: disabled ? 0.4 : 1 },
        ]}
      >
        <Ionicons name={icon} size={18} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1 },
  loadingBody: { padding: 20, gap: 12 },
  errorState: { flex: 1, alignItems: 'center', gap: 12, paddingHorizontal: 28 },
  coverWrap: { height: 260, backgroundColor: '#0B1220' },
  cover: { width: '100%', height: '100%' },
  coverShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,11,22,0.25)' },
  coverTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  coverActions: { flexDirection: 'row', gap: 8 },
  verifiedBadge: {
    position: 'absolute',
    left: 16,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(16,31,58,0.72)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  headBlock: { paddingTop: 16, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 18 },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    paddingHorizontal: 18,
  },
  openPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  openDot: { width: 6, height: 6, borderRadius: 3 },
  tabs: { paddingHorizontal: 12, gap: 4, marginTop: 4 },
  tab: { paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 2 },
  tabSelected: { fontWeight: '700' },
  body: { paddingHorizontal: 18, paddingTop: 8 },
  tabContent: { gap: 16 },
  ratingCard: { gap: 10 },
  ratingHead: { flexDirection: 'row', gap: 20, alignItems: 'center' },
  starsRow: { flexDirection: 'row', gap: 2, marginVertical: 3 },
  breakdown: { flex: 1, gap: 4 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  breakdownStar: { width: 10, textAlign: 'center' },
  barTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  breakdownCount: { width: 22, textAlign: 'right' },
  infoList: { gap: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8 },
  section: { gap: 8 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  description: { lineHeight: 22 },
  hoursCard: { gap: 8 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  strip: { gap: 8 },
  stripTile: {
    width: 120,
    height: 92,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0B1220',
  },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  statusBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  reelTile: { width: 128, height: 178, borderRadius: 16, overflow: 'hidden' },
  reelShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.2)' },
  reelPlay: { position: 'absolute', alignSelf: 'center', top: '42%' },
  reelMeta: { position: 'absolute', left: 6, right: 6, bottom: 6, color: '#FFFFFF' },
  postRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  note: { flexDirection: 'row', gap: 8, padding: 11, borderRadius: 14 },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gridTile: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 12, overflow: 'hidden' },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 9,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  videoThumb: { width: 74, height: 74, borderRadius: 12, overflow: 'hidden' },
  videoPlay: {
    position: 'absolute',
    alignSelf: 'center',
    top: '35%',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sortRow: { gap: 6 },
  sortChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  reviewCard: { gap: 9 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  reviewNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reviewStars: { flexDirection: 'row', gap: 1 },
  reviewBody: { lineHeight: 21 },
  reviewMediaRow: { gap: 6 },
  reviewMedia: { width: 76, height: 76, borderRadius: 10 },
  reviewActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  reviewAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyBox: { gap: 3, padding: 10, borderRadius: 12 },
  mapBox: {
    height: 240,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  addressCard: { gap: 8 },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  quickActions: { flexDirection: 'row', justifyContent: 'space-between' },
  quickAction: { alignItems: 'center', gap: 4, flex: 1 },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainButtons: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  replyRoot: { flex: 1, justifyContent: 'flex-end' },
  replySheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 30,
    gap: 10,
  },
  replyInput: {
    minHeight: 100,
    borderRadius: 14,
    padding: 12,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  replyFooter: { flexDirection: 'row', gap: 10 },
});
