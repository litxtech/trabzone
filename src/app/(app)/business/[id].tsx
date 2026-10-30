import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, Screen, Skeleton, TextField } from '@/components/ui';
import { AddPlaceMediaModal } from '@/features/explore/components/AddPlaceMediaModal';
import { PlaceClaimModal } from '@/features/explore/components/PlaceClaimModal';
import { StorageImage } from '@/features/explore/components/StorageImage';
import {
  useDeletePlaceMedia,
  usePlaceDetail,
  usePlaceReviewReplies,
  usePlaceReviews,
  useUpdateManagedPlace,
  useUpsertPlaceReviewReply,
} from '@/features/explore/hooks/use-explore';
import type { PlaceMedia, PlaceReview } from '@/features/explore/types';
import { formatViewCount } from '@/features/views/format';
import { useContentViewCount } from '@/features/views/use-content-views';
import { ContentStatsSheet } from '@/features/views/components/ContentStatsSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

const DAYS = [
  { key: 'mon', label: 'Pazartesi' },
  { key: 'tue', label: 'Salı' },
  { key: 'wed', label: 'Çarşamba' },
  { key: 'thu', label: 'Perşembe' },
  { key: 'fri', label: 'Cuma' },
  { key: 'sat', label: 'Cumartesi' },
  { key: 'sun', label: 'Pazar' },
] as const;

type DayKey = (typeof DAYS)[number]['key'];

type ProfileDraft = {
  id: string;
  description: string;
  phone: string;
  website: string;
  hours: Record<DayKey, string>;
};

function draftFromPlace(place: {
  id: string;
  description: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: Record<string, unknown> | null;
}): ProfileDraft {
  return {
    id: place.id,
    description: place.description ?? '',
    phone: place.phone ?? '',
    website: place.website ?? '',
    hours: hoursToDraft(place.opening_hours),
  };
}

function hoursToDraft(hours: Record<string, unknown> | null): Record<DayKey, string> {
  const draft = {} as Record<DayKey, string>;
  for (const day of DAYS) {
    const value = hours?.[day.key];
    if (typeof value === 'string') {
      draft[day.key] = value;
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const open = record.open ?? record.opens;
      const close = record.close ?? record.closes;
      draft[day.key] = open || close ? `${String(open ?? '')} - ${String(close ?? '')}`.trim() : '';
    } else {
      draft[day.key] = '';
    }
  }
  return draft;
}

function draftToHours(draft: Record<DayKey, string>): Record<string, string> {
  const hours: Record<string, string> = {};
  for (const day of DAYS) {
    const value = draft[day.key].trim();
    if (value) {
      hours[day.key] = value;
    }
  }
  return hours;
}

export default function BusinessPanelScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const detail = usePlaceDetail(id);
  const place = detail.data;
  // İşletme sahibi kendi profilini açtığında sayaç artmaz; sayı yine okunur.
  const viewCount = useContentViewCount({ type: 'place', id: id ?? null });
  const [statsOpen, setStatsOpen] = useState(false);

  const update = useUpdateManagedPlace(id ?? '');
  const removeMedia = useDeletePlaceMedia(id ?? '');
  const reviews = usePlaceReviews(id, 'new');
  const replies = usePlaceReviewReplies(id, Boolean(place?.is_manager));
  const reply = useUpsertPlaceReviewReply(id ?? '');

  // Form taslağı yalnızca kullanıcı düzenlediğinde state'e yazılır; böylece
  // ilk render'da effect ile setState çağrılmaz ve sunucu verisi kaynak olur.
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  const images = useMemo(
    () => (place?.media ?? []).filter((item) => item.kind === 'image' && item.status !== 'rejected'),
    [place?.media],
  );

  const profile: ProfileDraft | null =
    draft && place && draft.id === place.id
      ? draft
      : place
        ? draftFromPlace(place)
        : null;

  const patchProfile = (patch: Partial<Omit<ProfileDraft, 'id'>>) => {
    if (!place || !profile) {
      return;
    }
    setDraft({ ...profile, ...patch });
  };

  const save = () => {
    if (!place || !profile) {
      return;
    }
    const { website, phone, description, hours } = profile;
    if (website.trim() && !/^https?:\/\/[^\s]+$/.test(website.trim())) {
      Alert.alert('Web sitesi geçersiz', 'Adres http:// veya https:// ile başlamalı.');
      return;
    }
    if (phone.trim() && phone.replace(/\D/g, '').length < 7) {
      Alert.alert('Telefon geçersiz', 'En az 7 haneli bir iletişim numarası gir.');
      return;
    }
    update.mutate(
      {
        description: description.trim() || null,
        phone: phone.trim() || null,
        website: website.trim() || null,
        opening_hours: draftToHours(hours),
      },
      {
        onSuccess: () => {
          haptics.success();
          Alert.alert('Kaydedildi', 'İşletme bilgileri güncellendi.');
        },
        onError: (cause) => Alert.alert('Kaydedilemedi', cause.message),
      },
    );
  };

  const setCover = (media: PlaceMedia) => {
    update.mutate(
      { cover_path: media.storage_path },
      {
        onSuccess: () => {
          haptics.success();
          Alert.alert('Kapak güncellendi', 'Kapak fotoğrafı işletme kartında görünecek.');
        },
        onError: (cause) => Alert.alert('Kapak güncellenemedi', cause.message),
      },
    );
  };

  const confirmDelete = (media: PlaceMedia) => {
    Alert.alert('Medyayı kaldır', 'Bu fotoğraf/video işletme galerisinden kaldırılacak.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kaldır',
        style: 'destructive',
        onPress: () =>
          removeMedia.mutate(media.id, {
            onError: (cause) => Alert.alert('Kaldırılamadı', cause.message),
          }),
      },
    ]);
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Geri"
        onPress={() => router.back()}
        hitSlop={10}
        style={[styles.back, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      >
        <Ionicons name="arrow-back" size={18} color={theme.colors.text} />
      </Pressable>
      <View style={styles.headerText}>
        <AppText variant="h2" numberOfLines={1}>
          İşletme paneli
        </AppText>
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {place?.name ?? 'Yükleniyor…'}
        </AppText>
      </View>
      {place?.is_verified ? <Badge label="Doğrulanmış" tone="success" /> : null}
    </View>
  );

  if (detail.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right']} scroll>
        {header}
        <Skeleton height={120} style={styles.block} />
        <Skeleton height={220} style={styles.block} />
      </Screen>
    );
  }

  if (!place || !profile) {
    return (
      <Screen edges={['top', 'left', 'right']} scroll>
        {header}
        <Card style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={30} color={theme.colors.danger} />
          <AppText variant="bodyStrong">İşletme bulunamadı</AppText>
          <AppText variant="caption" color="textSecondary" style={styles.center}>
            {detail.isError ? detail.error.message : 'Kayıt kaldırılmış veya erişim yetkin yok.'}
          </AppText>
          <Button label="Keşfete dön" size="sm" onPress={() => router.push('/explore' as never)} />
        </Card>
      </Screen>
    );
  }

  if (!place.is_manager) {
    return (
      <Screen edges={['top', 'left', 'right']} scroll>
        {header}
        <Card style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={30} color={theme.colors.primaryDeep} />
          <AppText variant="bodyStrong">Yönetici erişimi gerekli</AppText>
          <AppText variant="caption" color="textSecondary" style={styles.center}>
            İşletme panelini yalnızca sahiplenme başvurusu onaylanmış yöneticiler kullanabilir.
            Profil, medya ve yorum yanıtları bu hesapla yönetilir.
          </AppText>
          {place.can_claim ? (
            <Button label="İşletmemi sahiplen" size="sm" onPress={() => setClaimOpen(true)} />
          ) : (
            <Button
              label="İşletmeyi görüntüle"
              size="sm"
              variant="outline"
              onPress={() => router.push(`/marketplace/place/${place.id}` as never)}
            />
          )}
        </Card>
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
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      {header}

      <View style={[styles.stats, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
        <Stat label="Tekil görüntüleme" value={formatViewCount(viewCount)} />
        <Stat label="Favori" value={place.favorite_count} />
        <Stat label="Yorum" value={place.review_count} />
        <Stat label="Fotoğraf" value={place.photo_count} />
        <Stat label="Video" value={place.video_count} />
        <Stat
          label="Puan"
          value={place.rating_avg == null ? '—' : place.rating_avg.toFixed(1)}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="İşletme görüntüleme istatistiklerini aç"
        onPress={() => setStatsOpen(true)}
        style={({ pressed }) => [
          styles.statsLink,
          {
            borderColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          },
        ]}
      >
        <Ionicons name="eye-outline" size={16} color={theme.colors.primaryDeep} />
        <AppText variant="caption" color="primaryDeep" style={styles.flex}>
          Tekil görüntüleme ve etkileşim istatistikleri
        </AppText>
        <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
      </Pressable>

      <ContentStatsSheet
        visible={statsOpen}
        onClose={() => setStatsOpen(false)}
        type="place"
        id={place.id}
        title={place.name}
      />

      <Card style={styles.section}>
        <SectionTitle icon="create-outline" title="Profil bilgileri" />
        <TextField
          label="Açıklama"
          value={profile.description}
          onChangeText={(value) => patchProfile({ description: value })}
          placeholder="İşletmeni kısaca tanıt…"
          multiline
          maxLength={4000}
        />
        <TextField
          label="Telefon"
          value={profile.phone}
          onChangeText={(value) => patchProfile({ phone: value })}
          placeholder="+90 462 …"
          keyboardType="phone-pad"
        />
        <TextField
          label="Web sitesi"
          value={profile.website}
          onChangeText={(value) => patchProfile({ website: value })}
          placeholder="https://…"
          autoCapitalize="none"
          keyboardType="url"
        />
        <View style={styles.hoursHead}>
          <AppText variant="label">Çalışma saatleri</AppText>
          <AppText variant="caption" color="textTertiary">
            Örn. 09:00 - 18:00
          </AppText>
        </View>
        {DAYS.map((day) => (
          <View key={day.key} style={styles.hoursRow}>
            <AppText variant="body" color="textSecondary" style={styles.dayLabel}>
              {day.label}
            </AppText>
            <TextField
              value={profile.hours[day.key]}
              onChangeText={(value) =>
                patchProfile({ hours: { ...profile.hours, [day.key]: value } })
              }
              placeholder="Kapalı"
              style={styles.hoursInput}
              containerStyle={styles.hoursInputWrap}
            />
          </View>
        ))}
        <Button
          label="Bilgileri kaydet"
          onPress={save}
          loading={update.isPending}
          leftIcon={<Ionicons name="save-outline" size={16} color={theme.colors.onPrimary} />}
        />
      </Card>

      <Card style={styles.section}>
        <View style={styles.sectionHead}>
          <SectionTitle icon="images-outline" title="Fotoğraflar ve videolar" />
          <Button
            label="Medya ekle"
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => setMediaOpen(true)}
          />
        </View>
        {place.media.length === 0 ? (
          <AppText variant="caption" color="textSecondary">
            Henüz medya yok. Galeriden fotoğraf veya video ekleyerek işletmeni tanıt.
          </AppText>
        ) : (
          <View style={styles.grid}>
            {place.media.map((media) => {
              const isCover = media.storage_path === place.cover_path;
              return (
                <View key={media.id} style={styles.mediaTile}>
                  <StorageImage
                    path={media.thumb_path ?? media.storage_path}
                    bucket="place-media"
                    style={styles.mediaImage}
                  />
                  {isCover ? (
                    <View style={[styles.coverBadge, { backgroundColor: theme.colors.primaryDeep }]}>
                      <AppText variant="caption" color="onPrimary">
                        Kapak
                      </AppText>
                    </View>
                  ) : null}
                  {media.kind === 'video' ? (
                    <View style={styles.videoBadge}>
                      <Ionicons name="videocam" size={12} color="#FFFFFF" />
                    </View>
                  ) : null}
                  <View style={styles.mediaActions}>
                    {media.kind === 'image' && media.storage_path && !isCover ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Kapak yap"
                        onPress={() => setCover(media)}
                        style={styles.mediaAction}
                      >
                        <Ionicons name="star-outline" size={14} color="#FFFFFF" />
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Medyayı kaldır"
                      onPress={() => confirmDelete(media)}
                      style={styles.mediaAction}
                    >
                      <Ionicons name="trash-outline" size={14} color="#FFFFFF" />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {images.length === 0 ? (
          <AppText variant="caption" color="textTertiary">
            Kapak fotoğrafı için önce bir görsel yükle.
          </AppText>
        ) : null}
      </Card>

      <Card style={styles.section}>
        <SectionTitle icon="chatbubbles-outline" title="Yorumlar" />
        {reviews.isLoading ? <Skeleton height={90} /> : null}
        {(reviews.data?.items ?? []).length === 0 && !reviews.isLoading ? (
          <AppText variant="caption" color="textSecondary">
            Bu işletmeye henüz yorum yazılmadı.
          </AppText>
        ) : null}
        {(reviews.data?.items ?? []).map((item) => (
          <ReviewReply
            key={item.id}
            review={item}
            replyBody={replies.data?.[item.id]?.body ?? item.reply?.body ?? ''}
            saving={reply.isPending}
            onSave={(body) => {
              reply.mutate(
                { reviewId: item.id, body },
                {
                  onSuccess: () => {
                    haptics.success();
                    Alert.alert('Yanıt kaydedildi', 'Yorumun altında işletme yanıtı olarak görünecek.');
                  },
                  onError: (cause) => Alert.alert('Yanıt kaydedilemedi', cause.message),
                },
              );
            }}
          />
        ))}
      </Card>

      <View style={styles.footerNote}>
        <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          İşletme sahipleri kullanıcı yorumlarını silemez veya değiştiremez; yalnızca resmî yanıt
          yazabilir. Uygunsuz içerik moderasyona bildirilir.
        </AppText>
      </View>

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
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.stat}>
      <AppText variant="bodyStrong">{value}</AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <View style={[styles.statDot, { backgroundColor: theme.colors.primarySoft }]} />
    </View>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.titleRow}>
      <View style={[styles.titleIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={15} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="h3">{title}</AppText>
    </View>
  );
}

function ReviewReply({
  review,
  replyBody,
  saving,
  onSave,
}: {
  review: PlaceReview;
  replyBody: string;
  saving: boolean;
  onSave: (body: string) => void;
}) {
  const { theme } = useTheme();
  const [body, setBody] = useState(replyBody);
  const [editing, setEditing] = useState(false);

  return (
    <View style={[styles.review, { borderColor: theme.colors.border }]}>
      <View style={styles.reviewHead}>
        <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
          {review.author.display_name ?? `@${review.author.username}`}
        </AppText>
        <View style={styles.stars}>
          <Ionicons name="star" size={12} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary">
            {review.rating}
          </AppText>
        </View>
      </View>
      {review.body ? (
        <AppText variant="caption" color="textSecondary">
          {review.body}
        </AppText>
      ) : null}

      {editing || !replyBody ? (
        <>
          <TextField
            value={body}
            onChangeText={setBody}
            placeholder="İşletme olarak yanıt yaz…"
            multiline
            maxLength={1200}
          />
          <View style={styles.replyActions}>
            {editing ? (
              <Button
                label="Vazgeç"
                size="sm"
                variant="ghost"
                fullWidth={false}
                onPress={() => {
                  setBody(replyBody);
                  setEditing(false);
                }}
              />
            ) : null}
            <Button
              label={replyBody ? 'Yanıtı güncelle' : 'Yanıtla'}
              size="sm"
              fullWidth={false}
              loading={saving}
              disabled={body.trim().length < 2 || saving}
              onPress={() => {
                onSave(body.trim());
                setEditing(false);
              }}
            />
          </View>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setBody(replyBody);
            setEditing(true);
          }}
          style={[styles.existingReply, { backgroundColor: theme.colors.surfaceMuted }]}
        >
          <Ionicons name="return-down-forward" size={14} color={theme.colors.primaryDeep} />
          <View style={styles.flex}>
            <AppText variant="caption" color="textSecondary">
              {replyBody}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              Düzenlemek için dokun
            </AppText>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 1 },
  block: { marginTop: 12 },
  empty: { alignItems: 'center', gap: 8, padding: 22, marginTop: 12 },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 6,
    marginTop: 8,
  },
  stat: { width: '33.33%', alignItems: 'center', paddingVertical: 8, gap: 1 },
  statDot: { width: 18, height: 3, borderRadius: 2, marginTop: 2 },
  statsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 8,
  },
  section: { gap: 10, marginTop: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  hoursHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayLabel: { width: 82 },
  hoursInputWrap: { flex: 1 },
  hoursInput: { marginBottom: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaTile: {
    width: 104,
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0B1220',
  },
  mediaImage: { width: '100%', height: '100%' },
  coverBadge: { position: 'absolute', top: 5, left: 5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  videoBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaActions: { position: 'absolute', bottom: 4, right: 4, flexDirection: 'row', gap: 4 },
  mediaAction: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(7,17,34,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  review: { gap: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  replyActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  existingReply: { flexDirection: 'row', gap: 6, padding: 8, borderRadius: 10 },
  footerNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 14 },
});
