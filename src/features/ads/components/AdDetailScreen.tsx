import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppImage, AppText, Badge, Button, IconButton, Screen, Skeleton } from '@/components/ui';
import { openSafeLink } from '@/features/comments/links';
import {
  MarketMediaViewer,
  type MarketMediaViewerItem,
} from '@/features/marketplace/components/MarketMediaViewer';
import { siteBase } from '@/features/share/links';
import { shareContent } from '@/features/share/share-action';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { openAdDestination, resolveAdDestination, safeExternalUrl } from '../destination';
import { adKeys, fetchAdDetail } from '../services/ads-service';
import type { AdDetail } from '../types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function cleanPhone(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 7 ? digits : null;
}

/** Doğrudan kampanyaların "Sponsorlu" detay sayfası. Boş alanlar gösterilmez. */
export function AdDetailScreen({ id }: { id: string }) {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width > 800;
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const validId = UUID.test(id);

  const query = useQuery({
    queryKey: adKeys.detail(id),
    enabled: validId,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await fetchAdDetail(id);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
  });

  const data: AdDetail | undefined = query.data;
  const detail = data?.detail ?? null;
  const creative = data?.creative ?? null;

  const media = useMemo<MarketMediaViewerItem[]>(() => {
    const items: MarketMediaViewerItem[] = [];
    const seen = new Set<string>();
    const push = (uri: string | null | undefined, kind: 'image' | 'video') => {
      const safe = safeExternalUrl(uri);
      if (safe && !seen.has(safe)) {
        seen.add(safe);
        items.push({ id: `${kind}-${items.length}`, kind, uri: safe });
      }
    };
    push(detail?.cover_url ?? creative?.mobile_image_url ?? creative?.image_url, 'image');
    (detail?.gallery ?? []).forEach((uri) => push(uri, 'image'));
    push(detail?.video_url ?? creative?.video_url, 'video');
    return items;
  }, [creative, detail]);

  const header = (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <IconButton
        name="chevron-back"
        accessibilityLabel="Geri"
        variant="surface"
        size={20}
        onPress={() => router.back()}
      />
      {data?.available ? (
        <IconButton
          name="share-outline"
          accessibilityLabel="Paylaş"
          variant="surface"
          size={19}
          onPress={() => {
            const title = detail?.headline ?? creative?.title ?? 'Trabzone';
            const url = `${siteBase()}/ad/${id}`;
            void shareContent({ title, message: `${title}\n${url}`, url });
          }}
        />
      ) : null}
    </View>
  );

  if (!validId || query.isError || (data && !data.available)) {
    return (
      <Screen edges={['left', 'right']} padded={false}>
        {header}
        <View style={styles.state}>
          <View style={[styles.stateIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons
              name={query.isError ? 'cloud-offline-outline' : 'megaphone-outline'}
              size={26}
              color={theme.colors.textSecondary}
            />
          </View>
          <AppText variant="h3" align="center">
            {query.isError ? 'Kampanya yüklenemedi' : 'Bu kampanya artık yayında değil'}
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {query.isError
              ? 'Bağlantını kontrol edip tekrar dene.'
              : 'Kampanyanın süresi dolmuş veya yayından kaldırılmış olabilir.'}
          </AppText>
          {query.isError ? (
            <Button label="Tekrar dene" variant="secondary" onPress={() => void query.refetch()} />
          ) : null}
        </View>
      </Screen>
    );
  }

  if (!data || query.isLoading) {
    return (
      <Screen edges={['left', 'right']} padded={false}>
        {header}
        <View style={styles.loading}>
          <Skeleton height={240} radius={22} />
          <Skeleton height={28} width="70%" radius={8} />
          <Skeleton height={16} width="90%" radius={8} />
          <Skeleton height={16} width="60%" radius={8} />
        </View>
      </Screen>
    );
  }

  const title = detail?.headline ?? creative?.title ?? data.campaign?.name ?? '';
  const advertiserName = creative?.business_name ?? data.advertiser?.name ?? null;
  const cover = media[0]?.kind === 'image' ? media[0] : null;
  const phone = cleanPhone(detail?.phone);
  const website = safeExternalUrl(detail?.website ?? data.advertiser?.website);
  const validUntil = formatDate(detail?.valid_until);
  const hasLocation = detail?.lat != null && detail?.lng != null;
  const destination =
    data.destination && data.destination_valid && data.destination.type !== 'detail_page'
      ? resolveAdDestination(id, data.destination)
      : null;

  return (
    <Screen edges={['left', 'right']} padded={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        <View style={[styles.hero, wide && styles.heroWide]}>
          {cover ? (
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel="Görseli tam ekran aç"
              onPress={() => setViewerIndex(0)}
              style={StyleSheet.absoluteFill}
            >
              <AppImage source={{ uri: cover.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </Pressable>
          ) : (
            <LinearGradient
              colors={theme.gradients.primary as unknown as [string, string, ...string[]]}
              style={StyleSheet.absoluteFill}
            />
          )}
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(6,10,20,0.45)', 'rgba(6,10,20,0)', 'rgba(6,10,20,0.55)']}
            locations={[0, 0.35, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroBar} pointerEvents="box-none">
            {header}
          </View>
          <View style={styles.sponsored} pointerEvents="none">
            <Ionicons name="megaphone" size={12} color="#0B1220" />
            <AppText variant="caption" style={styles.sponsoredText}>
              Sponsorlu
            </AppText>
          </View>
        </View>

        <View style={styles.body}>
          {data.preview ? (
            <View style={[styles.preview, { backgroundColor: theme.colors.warningSoft }]}>
              <Ionicons name="eye-outline" size={16} color={theme.colors.warning} />
              <AppText variant="caption" color="warning" style={styles.flex}>
                Yönetici önizlemesi — bu kampanya şu an kullanıcılara gösterilmiyor ({data.campaign?.status}).
              </AppText>
            </View>
          ) : null}

          {advertiserName ? (
            <AppText variant="label" color="textSecondary">
              {advertiserName}
            </AppText>
          ) : null}
          <AppText variant="h1">{title}</AppText>

          {detail?.price_text || detail?.offer_text || validUntil ? (
            <View style={styles.chips}>
              {detail?.price_text ? <Badge label={detail.price_text} tone="primary" /> : null}
              {detail?.offer_text ? <Badge label={detail.offer_text} tone="success" /> : null}
              {validUntil ? <Badge label={`Son geçerlilik: ${validUntil}`} tone="neutral" /> : null}
            </View>
          ) : null}

          {detail?.body || creative?.description ? (
            <AppText variant="body" color="textSecondary" style={styles.paragraph}>
              {detail?.body ?? creative?.description}
            </AppText>
          ) : null}

          {detail?.features?.length ? (
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <AppText variant="title">Öne çıkanlar</AppText>
              {detail.features.map((feature, index) => (
                <View key={`${index}-${feature}`} style={styles.feature}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.colors.primary} />
                  <AppText variant="body" style={styles.flex}>
                    {feature}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          {media.length > 1 ? (
            <View style={styles.galleryBlock}>
              <AppText variant="title">Galeri</AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
                {media.map((item, index) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={item.kind === 'video' ? 'Videoyu oynat' : `Görsel ${index + 1}`}
                    onPress={() => setViewerIndex(index)}
                    style={[styles.thumb, { backgroundColor: theme.colors.surfaceMuted }]}
                  >
                    {item.kind === 'image' ? (
                      <AppImage source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, styles.videoThumb]}>
                        <Ionicons name="play-circle" size={34} color="#FFFFFF" />
                      </View>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {detail?.address || hasLocation || phone || detail?.email || website ? (
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <AppText variant="title">İletişim</AppText>
              {detail?.address ? <InfoRow icon="location-outline" label={detail.address} /> : null}
              {hasLocation ? (
                <InfoRow
                  icon="map-outline"
                  label="Haritada göster"
                  action
                  onPress={() =>
                    router.push({
                      pathname: '/map',
                      params: {
                        lat: String(detail?.lat),
                        lng: String(detail?.lng),
                        label: advertiserName ?? title,
                        zoom: '15',
                      },
                    } as never)
                  }
                />
              ) : null}
              {phone ? (
                <InfoRow
                  icon="call-outline"
                  label={detail?.phone ?? phone}
                  action
                  onPress={() => void Linking.openURL(`tel:${phone}`).catch(() => undefined)}
                />
              ) : null}
              {detail?.email ? (
                <InfoRow
                  icon="mail-outline"
                  label={detail.email}
                  action
                  onPress={() => void Linking.openURL(`mailto:${detail.email}`).catch(() => undefined)}
                />
              ) : null}
              {website ? (
                <InfoRow
                  icon="globe-outline"
                  label={new URL(website).hostname}
                  action
                  onPress={() => void openSafeLink(website)}
                />
              ) : null}
            </View>
          ) : null}

          {data.place || data.listing ? (
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              {data.place ? (
                <InfoRow
                  icon="storefront-outline"
                  label={`İşletme profili: ${data.place.name}`}
                  action
                  onPress={() => router.push(`/marketplace/place/${data.place?.id}` as never)}
                />
              ) : null}
              {data.listing ? (
                <InfoRow
                  icon="pricetag-outline"
                  label={`İlan: ${data.listing.title}`}
                  action
                  onPress={() =>
                    router.push(
                      (data.listing?.type === 'real_estate'
                        ? `/marketplace/real-estate/${data.listing.id}`
                        : `/marketplace/${data.listing?.id}`) as never,
                    )
                  }
                />
              ) : null}
            </View>
          ) : null}

          {destination && destination.kind !== 'none' ? (
            <Button
              label={creative?.cta_label || 'İncele'}
              size="lg"
              fullWidth
              rightIcon={<Ionicons name="arrow-forward" size={18} color="#FFFFFF" />}
              onPress={() => void openAdDestination(destination)}
            />
          ) : null}

          <AppText variant="caption" color="textTertiary" align="center" style={styles.disclaimer}>
            Bu içerik {data.advertiser?.name ?? 'reklamveren'} tarafından sponsorludur. Trabzone reklam
            politikalarına uygunluğu yayın öncesinde incelenmiştir.
          </AppText>
        </View>
      </ScrollView>

      <MarketMediaViewer
        visible={viewerIndex != null}
        items={media}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
      />
    </Screen>
  );
}

function InfoRow({
  icon,
  label,
  action = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  action?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const content = (
    <>
      <View style={[styles.infoIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={16} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant={action ? 'bodyStrong' : 'body'} style={styles.flex} numberOfLines={2}>
        {label}
      </AppText>
      {action ? <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} /> : null}
    </>
  );
  if (!onPress) {
    return <View style={styles.infoRow}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.infoRow, { opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  hero: { height: 300, overflow: 'hidden', width: '100%', maxWidth: 760, alignSelf: 'center' },
  heroWide: { marginTop: 16, borderRadius: 20 },
  heroBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  sponsored: {
    position: 'absolute',
    left: 20,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  sponsoredText: { color: '#0B1220', fontWeight: '700' },
  body: { padding: 20, gap: 14, maxWidth: 760, width: '100%', alignSelf: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paragraph: { lineHeight: 23 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  galleryBlock: { gap: 10 },
  gallery: { gap: 10 },
  thumb: { width: 120, height: 90, borderRadius: 14, overflow: 'hidden' },
  videoThumb: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,10,20,0.6)' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 },
  infoIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  disclaimer: { marginTop: 8 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  stateIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 20, gap: 14 },
});
