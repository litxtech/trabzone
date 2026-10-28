import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppText,
  Avatar,
  Badge,
  Button,
  Card,
  IconButton,
  Skeleton,
  TextField,
} from '@/components/ui';
import { MediaViewer, type ViewerMedia } from '@/features/feed/components/MediaViewer';
import { MapSheet } from '@/features/map/components/MapSheet';
import { publicMediaUrl } from '@/features/media/media-service';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import type { MapPoint } from '@/features/map/types';
import { useStartDirectConversation } from '@/features/messaging/hooks/use-chat';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { estateShareLink } from '@/features/share/links';
import { shareContent } from '@/features/share/share-action';
import {
  useRealEstateDetail,
  useReportContent,
  useToggleListingFavorite,
} from '@/features/explore/hooks/use-explore';
import type { RealEstateDetail } from '@/features/explore/types';
import {
  formatDate,
  formatPrice,
  listingKindLabel,
  metersLabel,
  pricePeriodLabel,
  roomLabel,
} from '@/features/explore/utils/format';
import {
  eidsLabel,
  heatingLabel,
  listingStatusLabel,
  ownerTypeLabel,
} from '@/features/real-estate/labels';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

const REPORT_REASONS = [
  { key: 'fake', label: 'Sahte veya yanıltıcı ilan' },
  { key: 'fraud', label: 'Dolandırıcılık şüphesi' },
  { key: 'wrong_location', label: 'Yanlış konum' },
  { key: 'inappropriate', label: 'Uygunsuz içerik' },
  { key: 'spam', label: 'Spam / tekrarlanan ilan' },
  { key: 'other', label: 'Diğer' },
] as const;

export default function RealEstateDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const listingId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { theme, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const listing = useRealEstateDetail(listingId || null);
  const favorite = useToggleListingFavorite();
  const report = useReportContent();
  const startChat = useStartDirectConversation();

  const [viewer, setViewer] = useState<{ index: number } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<(typeof REPORT_REASONS)[number]['key']>('fake');
  const [reportDetails, setReportDetails] = useState('');

  const data = listing.data;

  const viewerMedia = useMemo<ViewerMedia[]>(
    () =>
      (data?.media ?? [])
        .map((item) => {
          const uri = publicMediaUrl('real-estate-media', item.storage_path);
          if (!uri) return null;
          return { id: item.id, uri, media_type: item.kind } satisfies ViewerMedia;
        })
        .filter((item): item is ViewerMedia => item != null),
    [data?.media],
  );

  const mapPoint = useMemo<MapPoint | null>(() => {
    if (!data) return null;
    return {
      id: `re:${data.id}`,
      kind: 'real_estate',
      lat: data.lat,
      lng: data.lng,
      title: data.title,
      subtitle: [data.district, data.neighborhood].filter(Boolean).join(' · '),
      label: formatPrice(data.price_cents, data.currency, data.price_period),
      tone: 'primary',
      icon: 'home',
    };
  }, [data]);

  const share = async () => {
    if (!data) return;
    const link = estateShareLink(data.id);
    const place = [data.district, data.neighborhood].filter(Boolean).join(', ') || 'Trabzon';
    await shareContent({
      title: data.title,
      message: `${data.title} · ${formatPrice(
        data.price_cents,
        data.currency,
        data.price_period,
      )} · ${place} — Trabzone Emlak\n${link}`,
      url: link,
    });
  };

  const openChat = () => {
    if (!data) return;
    if (data.is_mine) {
      Alert.alert('Kendi ilanın', 'Kendi ilanına mesaj gönderemezsin. İlanı düzenleyebilirsin.');
      return;
    }
    startChat.mutate(data.owner.id, {
      onSuccess: ({ id }) => router.push(`/chat/${id}` as never),
      onError: (error) => Alert.alert('Sohbet açılamadı', error.message),
    });
  };

  const toggleFavorite = () => {
    if (!data) return;
    favorite.mutate(data.id, {
      onSuccess: (result) => {
        haptics.tap();
        if (result.favorite) haptics.success();
      },
      onError: (error) => Alert.alert('Favori kaydedilemedi', error.message),
    });
  };

  const submitReport = () => {
    if (!data) return;
    report.mutate(
      {
        targetType: 'real_estate_listing',
        targetId: data.id,
        reason: reportReason,
        details: reportDetails.trim() || null,
      },
      {
        onSuccess: () => {
          setReportOpen(false);
          setReportDetails('');
          haptics.success();
          Alert.alert('Bildirimin alındı', 'Moderasyon ekibi ilanı inceleyecek.');
        },
        onError: (error) => Alert.alert('Bildirim gönderilemedi', error.message),
      },
    );
  };

  if (listing.isLoading) {
    return <DetailSkeleton onBack={() => router.back()} />;
  }

  if (listing.isError || !data) {
    return (
      <View
        style={[
          styles.stateRoot,
          { backgroundColor: theme.colors.background, paddingTop: insets.top + 12 },
        ]}
      >
        <View style={styles.stateHeader}>
          <IconButton name="chevron-back" accessibilityLabel="Geri" onPress={() => router.back()} />
        </View>
        <View style={styles.stateBody}>
          <Ionicons name="document-text-outline" size={32} color={theme.colors.textTertiary} />
          <AppText variant="h3" align="center">
            İlan bulunamadı
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            İlan kaldırılmış, süresi dolmuş veya erişim yetkin yok. Yalnızca yayındaki ilanlar
            herkese açıktır.
          </AppText>
          <Button
            label="Geri dön"
            variant="secondary"
            onPress={() => router.back()}
            style={styles.stateButton}
          />
        </View>
      </View>
    );
  }

  const status = listingStatusLabel(data.status);
  const eids = eidsLabel(data.eids_status);
  const images = data.media.filter((item) => item.kind === 'image');
  const videos = data.media.filter((item) => item.kind === 'video');
  const attributes = attributeRows(data);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 28 }]}
      >
        <View style={styles.gallery}>
          {data.media.length > 0 ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={{ width }}
            >
              {data.media.map((item, index) => {
                const uri = publicMediaUrl('real-estate-media', item.storage_path);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={item.kind === 'video' ? 'Videoyu aç' : 'Fotoğrafı büyüt'}
                    onPress={() => {
                      if (item.kind === 'video') {
                        const videoUrl = publicMediaUrl('real-estate-media', item.storage_path);
                        if (videoUrl) {
                          setViewer({ index });
                        }
                      } else {
                        setViewer({ index });
                      }
                    }}
                    style={{ width, height: 300, backgroundColor: '#0B1220' }}
                  >
                    {uri ? (
                      item.kind === 'video' ? (
                        <View style={styles.videoTile}>
                          <LinearGradient
                            colors={['#101B3B', '#1B2B57']}
                            style={StyleSheet.absoluteFill}
                          />
                          <Ionicons name="play-circle" size={54} color="rgba(255,255,255,0.9)" />
                          <AppText variant="caption" color="#FFFFFF">
                            Videoyu oynat
                          </AppText>
                        </View>
                      ) : (
                        <View style={StyleSheet.absoluteFill}>
                          <MapImage uri={uri} />
                        </View>
                      )
                    ) : (
                      <View style={styles.videoTile}>
                        <Ionicons name="image-outline" size={30} color="rgba(255,255,255,0.6)" />
                        <AppText variant="caption" color="rgba(255,255,255,0.7)">
                          Medya hazırlanıyor
                        </AppText>
                      </View>
                    )}
                    <View style={styles.counter}>
                      <AppText variant="caption" color="#FFFFFF">
                        {index + 1} / {data.media.length}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={[styles.emptyMedia, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="images-outline" size={34} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary">
                Bu ilanda onaylı fotoğraf bulunmuyor
              </AppText>
            </View>
          )}

          <LinearGradient
            colors={['rgba(4,8,18,0.5)', 'transparent', 'rgba(4,8,18,0.4)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
            <IconButton
              name="chevron-back"
              accessibilityLabel="Geri"
              variant="glass"
              color="#FFFFFF"
              onPress={() => router.back()}
            />
            <View style={styles.flex} />
            <IconButton
              name="share-outline"
              accessibilityLabel="Paylaş"
              variant="glass"
              color="#FFFFFF"
              onPress={() => void share()}
            />
            <IconButton
              name={data.is_favorite ? 'heart' : 'heart-outline'}
              accessibilityLabel={data.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
              variant="glass"
              color={data.is_favorite ? '#FF8BA7' : '#FFFFFF'}
              onPress={toggleFavorite}
            />
          </View>

          <View style={styles.mediaActions}>
            <MediaChip icon="images-outline" label={`${images.length} fotoğraf`} />
            {videos.length > 0 ? (
              <MediaChip icon="videocam-outline" label={`${videos.length} video`} />
            ) : null}
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.badges}>
            <Badge label={listingKindLabel(data.listing_kind)} tone="primary" />
            <Badge label={status.label} tone={status.tone} />
            <Badge label={eids.label} tone={eids.tone} />
          </View>

          <AppText variant="h2">{data.title}</AppText>

          <View style={styles.priceRow}>
            <AppText variant="h1" color="primaryDeep">
              {formatPrice(data.price_cents, data.currency, data.price_period)}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {pricePeriodLabel(data.price_period, data.listing_kind)}
            </AppText>
          </View>

          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={16} color={theme.colors.textSecondary} />
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              {[data.district, data.neighborhood].filter(Boolean).join(', ') || 'Trabzon'}
              {data.address_text ? ` · ${data.address_text}` : ''}
            </AppText>
            {data.hide_exact_location ? <Badge label="Yaklaşık konum" tone="neutral" /> : null}
          </View>

          <View style={styles.stats}>
            {(data.net_m2 ?? data.gross_m2) ? (
              <Stat
                icon="resize-outline"
                label="Metrekare"
                value={metersLabel(data.net_m2 ?? data.gross_m2)}
              />
            ) : null}
            {data.room_count != null ? (
              <Stat
                icon="bed-outline"
                label="Oda"
                value={roomLabel(data.room_count, data.living_room_count ?? 0)}
              />
            ) : null}
            {data.building_age != null ? (
              <Stat icon="time-outline" label="Bina yaşı" value={`${data.building_age}`} />
            ) : null}
            {data.floor_no != null ? (
              <Stat
                icon="business-outline"
                label="Kat"
                value={`${data.floor_no}${data.total_floors ? ` / ${data.total_floors}` : ''}`}
              />
            ) : null}
          </View>

          {data.is_mine ? (
            <View style={[styles.ownerNotice, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons
                name="shield-checkmark-outline"
                size={17}
                color={theme.colors.primaryDeep}
              />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Bu ilan size ait</AppText>
                <AppText variant="caption" color="textSecondary">
                  {data.status === 'draft' || data.status === 'rejected'
                    ? 'Taslağı düzenleyip EİDS doğrulamasına gönderebilirsin.'
                    : 'Yayın ve doğrulama durumu admin moderasyonuyla yönetilir.'}
                </AppText>
              </View>
              {data.status === 'draft' || data.status === 'rejected' ? (
                <Button
                  label="Düzenle"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() =>
                    router.push(`/marketplace/real-estate/create?id=${data.id}` as never)
                  }
                />
              ) : null}
            </View>
          ) : null}

          {data.rejection_reason ? (
            <View style={[styles.notice, { backgroundColor: theme.colors.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {data.rejection_reason}
              </AppText>
            </View>
          ) : null}

          <SectionTitle title="Açıklama" />
          <AppText variant="body" color="textSecondary">
            {data.description?.trim() || 'İlan sahibi açıklama eklemedi.'}
          </AppText>

          <SectionTitle title="Özellikler" />
          <View style={styles.featureGrid}>
            {attributeRows(data).map((row) => (
              <View
                key={row.label}
                style={[
                  styles.featureCell,
                  { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                ]}
              >
                <AppText variant="caption" color="textTertiary">
                  {row.label}
                </AppText>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {row.value}
                </AppText>
              </View>
            ))}
          </View>
          {attributes.length === 0 ? (
            <AppText variant="caption" color="textTertiary">
              İlan sahibi ek özellik belirtmedi.
            </AppText>
          ) : null}

          <SectionTitle title="Konum" />
          <View style={[styles.mapCard, theme.shadows.card, { borderColor: theme.colors.border }]}>
            <View style={styles.mapWrap}>
              <MapCanvas
                initialCamera={{ lat: data.lat, lng: data.lng, zoom: 15.6 }}
                markers={mapPoint ? [mapPoint] : []}
                dark={scheme === 'dark'}
                interactive={false}
                onMarkerPress={() => undefined}
                onCameraChange={() => undefined}
              />
            </View>
            <View style={styles.mapFooter}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">
                  {[data.neighborhood, data.district].filter(Boolean).join(', ') || 'Trabzon'}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {data.hide_exact_location
                    ? 'Konut gizliliği nedeniyle yaklaşık konum gösteriliyor.'
                    : 'İlan sahibinin paylaştığı konum.'}
                </AppText>
              </View>
              <Button
                label="Haritada gör"
                size="sm"
                variant="secondary"
                fullWidth={false}
                onPress={() => router.push(`/explore?mode=re&listingId=${data.id}` as never)}
              />
            </View>
          </View>

          <SectionTitle title="İlan bilgileri" />
          <Card style={styles.infoCard}>
            <InfoLine label="İlan no" value={`#${data.id.slice(0, 8).toUpperCase()}`} />
            <InfoLine label="İlan türü" value={listingKindLabel(data.listing_kind)} />
            <InfoLine label="Kategori" value={data.category?.name ?? 'Belirtilmedi'} />
            <InfoLine label="İlan sahibi" value={ownerTypeLabel(data.owner_type)} />
            <InfoLine
              label="Yayın tarihi"
              value={formatDate(data.published_at ?? data.created_at)}
            />
            <InfoLine label="Güncelleme" value={formatDate(data.updated_at)} />
            <InfoLine label="Görüntülenme" value={String(data.view_count)} />
            {data.expires_at ? (
              <InfoLine label="Yayın bitişi" value={formatDate(data.expires_at)} />
            ) : null}
          </Card>

          <View style={[styles.safety, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              Kapora veya ödeme göndermeden önce taşınmazı yerinde gör ve tapu/Yetki belgesi
              doğrulamasını iste. Trabzone, doğrulanmamış ilanı yayınlamaz; yine de iletişimde
              dikkatli ol.
            </AppText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="İlanı şikâyet et"
            onPress={() => setReportOpen(true)}
            style={styles.reportLink}
          >
            <Ionicons name="flag-outline" size={15} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary">
              İlanı şikâyet et
            </AppText>
          </Pressable>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          theme.shadows.sheet,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={data.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
          onPress={toggleFavorite}
          style={[styles.footerIcon, { borderColor: theme.colors.border }]}
        >
          <Ionicons
            name={data.is_favorite ? 'heart' : 'heart-outline'}
            size={20}
            color={data.is_favorite ? theme.colors.danger : theme.colors.textSecondary}
          />
          <AppText variant="caption" color="textTertiary">
            {data.favorite_count}
          </AppText>
        </Pressable>

        <View style={styles.ownerMini}>
          {data.owner.avatar_path ? (
            <Avatar
              uri={mediaPublicUrl('avatar', data.owner.avatar_path) ?? undefined}
              name={ownerName(data)}
              size={36}
            />
          ) : (
            <View style={[styles.ownerAvatar, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="person-outline" size={17} color={theme.colors.primaryDeep} />
            </View>
          )}
          <View style={styles.flex}>
            <AppText variant="caption" numberOfLines={1}>
              {ownerName(data)}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {ownerTypeLabel(data.owner_type)}
            </AppText>
          </View>
        </View>

        <Button
          label={data.is_mine ? 'İlanı düzenle' : 'Mesaj gönder'}
          onPress={
            data.is_mine
              ? () => router.push(`/marketplace/real-estate/create?id=${data.id}` as never)
              : openChat
          }
          loading={startChat.isPending}
          style={styles.footerButton}
        />
      </View>

      <MediaViewer
        visible={viewer != null}
        media={viewerMedia}
        startIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />

      <MapSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        title="İlanı şikâyet et"
        subtitle="Bildirimin moderasyon ekibine iletilir. Aynı ilan için tekrar bildirim oluşmaz."
        maxHeightRatio={0.72}
        footer={
          <Button label="Bildirimi gönder" onPress={submitReport} loading={report.isPending} />
        }
      >
        <View style={styles.reasonList}>
          {REPORT_REASONS.map((reason) => {
            const active = reportReason === reason.key;
            return (
              <Pressable
                key={reason.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setReportReason(reason.key)}
                style={[
                  styles.reason,
                  {
                    borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                  },
                ]}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={17}
                  color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
                />
                <AppText variant="body" color={active ? 'primaryDeep' : 'text'}>
                  {reason.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <TextField
          label="Ek açıklama (isteğe bağlı)"
          value={reportDetails}
          onChangeText={setReportDetails}
          placeholder="Durumu kısaca açıkla…"
          multiline
          maxLength={1000}
        />
      </MapSheet>
    </View>
  );
}

function MapImage({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <View style={[StyleSheet.absoluteFill, styles.videoTile]}>
      <Ionicons name="image-outline" size={30} color="rgba(255,255,255,0.5)" />
    </View>
  ) : (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={160}
      cachePolicy="memory-disk"
      onError={() => setFailed(true)}
    />
  );
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.stateRoot, { backgroundColor: theme.colors.background }]}>
      <Skeleton height={300} radius={0} />
      <View style={styles.skeletonBody}>
        <Skeleton height={20} width="45%" radius={6} />
        <Skeleton height={26} width="80%" radius={6} />
        <Skeleton height={22} width="35%" radius={6} />
        <Skeleton height={82} radius={16} />
        <Skeleton height={130} radius={16} />
      </View>
      <View style={styles.skeletonBack}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="glass"
          onPress={onBack}
        />
      </View>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="h3">{title}</AppText>
    </View>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.statCell, { borderColor: theme.colors.border }]}>
      <Ionicons name={icon} size={17} color={theme.colors.primaryDeep} />
      <View style={styles.flex}>
        <AppText variant="caption" color="textTertiary">
          {label}
        </AppText>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

function MediaChip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.mediaChip}>
      <Ionicons name={icon} size={13} color="#FFFFFF" />
      <AppText variant="caption" color="#FFFFFF">
        {label}
      </AppText>
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.infoLine, { borderBottomColor: theme.colors.divider }]}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      <AppText variant="body" numberOfLines={2} style={styles.infoValue}>
        {value}
      </AppText>
    </View>
  );
}

function attributeRows(data: RealEstateDetail): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value) rows.push({ label, value });
  };
  push('Brüt m²', data.gross_m2 ? `${data.gross_m2} m²` : null);
  push('Net m²', data.net_m2 ? `${data.net_m2} m²` : null);
  push(
    'Oda',
    data.room_count != null ? roomLabel(data.room_count, data.living_room_count ?? 0) : null,
  );
  push('Bina yaşı', data.building_age != null ? `${data.building_age}` : null);
  push(
    'Kat',
    data.floor_no != null
      ? `${data.floor_no}${data.total_floors ? ` / ${data.total_floors}` : ''}`
      : null,
  );
  push('Isıtma', heatingLabel(data.heating));
  push('Eşya', data.furnished == null ? null : data.furnished ? 'Eşyalı' : 'Eşyasız');
  push('Balkon', data.balcony == null ? null : data.balcony ? 'Var' : 'Yok');
  push('Otopark', data.parking == null ? null : data.parking ? 'Var' : 'Yok');
  push('Asansör', data.elevator == null ? null : data.elevator ? 'Var' : 'Yok');
  push('Depozito', data.deposit_cents ? formatPrice(data.deposit_cents, data.currency) : null);
  push('Aidat', data.dues_cents ? formatPrice(data.dues_cents, data.currency) : null);
  for (const [key, value] of Object.entries(data.attributes ?? {})) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      rows.push({ label: prettyKey(key), value: String(value) });
    }
  }
  return rows;
}

function prettyKey(key: string): string {
  const labels: Record<string, string> = {
    cephe: 'Cephe',
    cephe_durumu: 'Cephe durumu',
    kullanim_turu: 'Kullanım türü',
    depo_alani: 'Depo alanı',
    giris_durumu: 'Giriş durumu',
    kiralama_kosullari: 'Kiralama koşulları',
    satis_kosullari: 'Satış koşulları',
    devir_bedeli: 'Devir bedeli',
    musteri_potansiyeli: 'Müşteri potansiyeli',
    calisan_sayisi: 'Çalışan sayısı',
  };
  return labels[key] ?? key.replace(/[_-]+/g, ' ');
}

function ownerName(data: RealEstateDetail): string {
  return data.owner.display_name?.trim() || data.owner.username;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 28 },
  stateRoot: { flex: 1 },
  stateHeader: { paddingHorizontal: 16, paddingBottom: 8 },
  stateBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  stateButton: { maxWidth: 220 },
  skeletonBody: { padding: 20, gap: 12 },
  skeletonBack: { position: 'absolute', top: 52, left: 16 },
  gallery: { height: 300, backgroundColor: '#0B1220' },
  videoTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#101B3B',
  },
  emptyMedia: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  counter: {
    position: 'absolute',
    right: 14,
    bottom: 18,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(9,14,28,0.55)',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mediaActions: {
    position: 'absolute',
    left: 14,
    bottom: 16,
    flexDirection: 'row',
    gap: 6,
  },
  mediaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(9,14,28,0.58)',
  },
  body: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: '47%',
    flexGrow: 1,
  },
  ownerNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderRadius: 14,
  },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 11, borderRadius: 12 },
  sectionTitle: { paddingTop: 8 },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  featureCell: {
    width: '48%',
    padding: 10,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  mapCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    backgroundColor: '#0B1220',
  },
  mapWrap: { height: 190 },
  mapFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  infoCard: { gap: 0, padding: 4 },
  infoLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoValue: { flex: 1, textAlign: 'right' },
  safety: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 13, alignItems: 'flex-start' },
  reportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerIcon: {
    width: 44,
    height: 46,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  ownerMini: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 },
  ownerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButton: { flex: 1.25 },
  reasonList: { gap: 7 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
