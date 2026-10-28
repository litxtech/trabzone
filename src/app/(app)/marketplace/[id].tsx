import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, AppText, Avatar, Button, IconButton, Skeleton } from '@/components/ui';
import { publicMediaUrl } from '@/features/media/media-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { MarketListingCard } from '@/features/marketplace/components/MarketListingCard';
import {
  MarketMediaViewer,
  type MarketMediaViewerItem,
} from '@/features/marketplace/components/MarketMediaViewer';
import {
  useDeleteListingV2,
  useMarketListing,
  useMessageSellerAboutListing,
  useSellerListings,
  useSetListingStatusV2,
  useToggleFavoriteV2,
} from '@/features/marketplace/hooks/use-marketplace-catalog';
import {
  CONDITION_LABELS,
  formatMarketPrice,
  formatRelativeDate,
  locationLabel,
  type MarketMediaItem,
} from '@/features/marketplace/services/marketplace-catalog-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

const ATTRIBUTE_LABELS: Record<string, string> = {
  listing_kind: 'İlan türü',
  brand: 'Marka',
  model: 'Model',
  storage: 'Depolama',
  color: 'Renk',
  warranty: 'Garanti',
  cosmetic: 'Kozmetik durum',
  m2: 'Metrekare',
  brut_m2: 'Brüt m²',
  net_m2: 'Net m²',
  rooms: 'Oda sayısı',
  oda_sayisi: 'Oda sayısı',
  floor: 'Kat',
  building_age: 'Bina yaşı',
  heating: 'Isıtma',
  bathrooms: 'Banyo',
  balcony: 'Balkon',
  parking: 'Otopark',
  furnished: 'Eşyalı',
  deposit: 'Depozito',
  dues: 'Aidat',
  year: 'Yıl',
  yil: 'Yıl',
  model_yili: 'Model yılı',
  km: 'Kilometre',
  fuel: 'Yakıt',
  transmission: 'Vites',
  body_type: 'Kasa tipi',
  engine_power: 'Motor gücü',
  engine_size: 'Motor hacmi',
  damage: 'Hasar durumu',
  plate_city: 'Plaka',
  vehicle_kind: 'Araç türü',
  service_area: 'Hizmet bölgesi',
  price_type: 'Fiyat türü',
  experience: 'Deneyim',
  employees: 'Çalışan sayısı',
  square_meters: 'Metrekare',
};

const HIDDEN_ATTRIBUTES = new Set(['phone', 'cover', 'sort', 'is_cover']);
const LISTING_KIND_LABELS: Record<string, string> = {
  rent: 'Kiralık',
  sale: 'Satılık',
  transfer: 'Devren',
};

function attributeLabel(key: string) {
  return (
    ATTRIBUTE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (char) => char.toUpperCase())
  );
}

function attributeValue(key: string, value: unknown): string | null {
  if (value == null || value === '') {
    return null;
  }
  if (key === 'listing_kind' && typeof value === 'string') {
    return LISTING_KIND_LABELS[value] ?? value;
  }
  if (typeof value === 'boolean') {
    return value ? 'Evet' : 'Hayır';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(', ');
  }
  if (typeof value === 'object') {
    return null;
  }
  return String(value);
}

function mediaViewerItems(media: MarketMediaItem[]): MarketMediaViewerItem[] {
  return media.map((item) => ({
    id: item.id,
    kind: item.kind,
    uri: publicMediaUrl('listing-images', item.storage_path) ?? '',
    thumbUri: publicMediaUrl('listing-images', item.thumb_path ?? item.storage_path),
    width: item.width,
    height: item.height,
  }));
}

export default function MarketListingDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const listingId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { openReport } = useReportSheet();
  const query = useMarketListing(listingId || null);
  const favorite = useToggleFavoriteV2();
  const message = useMessageSellerAboutListing();
  const setStatus = useSetListingStatusV2();
  const remove = useDeleteListingV2();

  const [galleryIndex, setGalleryIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const galleryRef = useRef<FlatList<MarketMediaItem>>(null);

  const detail = query.data;
  const listing = detail?.listing;
  const seller = detail?.seller;
  const sellerListings = useSellerListings(listing?.seller_id ?? null);
  const media = useMemo(() => listing?.media ?? [], [listing?.media]);
  const viewerItems = useMemo(() => mediaViewerItems(media), [media]);
  const { width } = useWindowDimensions();
  const galleryHeight = Math.round(width * 0.92);
  const phone = useMemo(() => {
    const fromPrefs = listing?.contact_prefs?.phone;
    const fromAttributes = listing?.attributes?.phone;
    const raw =
      typeof fromPrefs === 'string'
        ? fromPrefs
        : typeof fromAttributes === 'string'
          ? fromAttributes
          : null;
    return raw ? raw.replace(/[^0-9+]/g, '') : null;
  }, [listing?.attributes, listing?.contact_prefs]);

  const attributes = useMemo(() => {
    if (!listing) {
      return [];
    }
    return Object.entries(listing.attributes)
      .filter(([key]) => !HIDDEN_ATTRIBUTES.has(key))
      .map(([key, value]) => ({
        key,
        label: attributeLabel(key),
        value: attributeValue(key, value),
      }))
      .filter(
        (entry): entry is { key: string; label: string; value: string } => entry.value != null,
      )
      .slice(0, 22);
  }, [listing]);

  if (!listingId) {
    return (
      <CenteredState
        icon="alert-circle-outline"
        title="İlan bulunamadı"
        body="Bağlantı geçersiz."
        onBack={() => router.back()}
      />
    );
  }

  if (query.isLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <Skeleton height={galleryHeight} radius={0} />
        <View style={styles.loadingBody}>
          <Skeleton height={22} width="78%" />
          <Skeleton height={30} width="48%" />
          <Skeleton height={14} width="60%" />
          <Skeleton height={110} radius={16} />
        </View>
      </View>
    );
  }

  if (query.isError || !listing || !seller) {
    return (
      <CenteredState
        icon="cloud-offline-outline"
        title="İlan yüklenemedi"
        body="İlan kaldırılmış olabilir. Bağlantını kontrol edip tekrar dene."
        actionLabel="Tekrar dene"
        onAction={() => void query.refetch()}
        onBack={() => router.back()}
      />
    );
  }

  const messages = listing.message_count > 0 ? `${listing.message_count} mesaj` : 'Yeni ilan';
  const views = `${listing.view_count} görüntülenme`;
  const phoneAllowed = Boolean(phone) && !listing.is_mine;

  const share = async () => {
    try {
      await Share.share({
        message: `${listing.title} — ${formatMarketPrice(listing.price_cents, listing.currency, listing.price_period)}\nTrabzone'da görüntüle: trabzone://marketplace/${listing.id}`,
      });
    } catch {
      // Kullanıcı paylaşımı iptal edebilir; sessiz geç.
    }
  };

  const sendMessage = () => {
    if (listing.is_mine) {
      return;
    }
    message.mutate(
      {
        listingId: listing.id,
        sellerId: listing.seller_id,
        title: listing.title,
        priceCents: listing.price_cents,
        currency: listing.currency,
        coverPath: listing.cover_path,
      },
      {
        onSuccess: ({ conversationId }) => {
          haptics.success();
          router.push(`/chat/${conversationId}` as never);
        },
        onError: (error) => Alert.alert('Mesaj gönderilemedi', error.message || 'Tekrar dene.'),
      },
    );
  };

  const call = async () => {
    if (!phone) {
      return;
    }
    const url = `tel:${phone}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Arama başlatılamadı', 'Bu cihaz arama başlatmayı desteklemiyor.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Arama başlatılamadı', 'Telefon uygulaması açılamadı.');
    }
  };

  const openViewer = (index: number) => {
    if (!media.length) {
      return;
    }
    haptics.tap();
    setViewerIndex(index);
    setViewerOpen(true);
  };

  const onGalleryScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setGalleryIndex(Math.min(Math.max(index, 0), Math.max(media.length - 1, 0)));
  };

  const updateStatus = (status: 'sold' | 'archived' | 'active') => {
    setStatus.mutate(
      { id: listing.id, status },
      {
        onSuccess: () => {
          haptics.success();
          void query.refetch();
        },
        onError: (error) => Alert.alert('Güncellenemedi', error.message || 'Tekrar dene.'),
      },
    );
  };

  const deleteListing = () => {
    Alert.alert('İlanı sil', 'Bu ilan kalıcı olarak kaldırılacak. Emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () =>
          remove.mutate(listing.id, {
            onSuccess: () => {
              haptics.success();
              router.back();
            },
            onError: (error) => Alert.alert('Silinemedi', error.message || 'Tekrar dene.'),
          }),
      },
    ]);
  };

  const menuItems = listing.is_mine
    ? [
        { key: 'edit', label: 'İlanı düzenle', icon: 'create-outline' as const },
        { key: 'sold', label: 'Satıldı olarak işaretle', icon: 'checkmark-done-outline' as const },
        { key: 'archive', label: 'Yayından kaldır', icon: 'eye-off-outline' as const },
        { key: 'delete', label: 'İlanı sil', icon: 'trash-outline' as const, destructive: true },
      ]
    : [
        { key: 'share', label: 'Paylaş', icon: 'share-social-outline' as const },
        {
          key: 'report',
          label: 'İlanı bildir',
          icon: 'flag-outline' as const,
          destructive: true,
        },
      ];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 108 + insets.bottom }}
      >
        <View
          style={[
            styles.gallery,
            { height: galleryHeight, backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          {media.length ? (
            <FlatList
              keyboardShouldPersistTaps="handled"
              ref={galleryRef}
              data={media}
              horizontal
              pagingEnabled
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onGalleryScroll}
              initialNumToRender={2}
              windowSize={3}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              renderItem={({ item, index }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${index + 1}. fotoğrafı tam ekran aç`}
                  onPress={() => openViewer(index)}
                  style={{ width, height: galleryHeight }}
                >
                  <Image
                    source={{
                      uri:
                        publicMediaUrl('listing-images', item.thumb_path ?? item.storage_path) ??
                        '',
                    }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={160}
                    cachePolicy="memory-disk"
                    recyclingKey={item.id}
                  />
                  {item.kind === 'video' ? (
                    <View style={styles.videoOverlay}>
                      <View style={styles.playCircle}>
                        <Ionicons name="play" size={24} color="#FFFFFF" />
                      </View>
                      <AppText variant="caption" color="#FFFFFF">
                        Videoyu oynat
                      </AppText>
                    </View>
                  ) : null}
                </Pressable>
              )}
            />
          ) : (
            <View style={styles.emptyGallery}>
              <Ionicons name="image-outline" size={40} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary">
                Bu ilanda fotoğraf yok
              </AppText>
            </View>
          )}

          <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
            <View style={styles.topBarRow}>
              <IconButton
                name="chevron-back"
                accessibilityLabel="Geri"
                variant="glass"
                color="#FFFFFF"
                size={21}
                onPress={() => router.back()}
              />
              <View style={styles.flex} />
              <IconButton
                name={listing.is_favorite ? 'heart' : 'heart-outline'}
                accessibilityLabel={listing.is_favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                variant="glass"
                color={listing.is_favorite ? theme.colors.danger : '#FFFFFF'}
                size={20}
                onPress={() => favorite.mutate(listing.id)}
              />
              <IconButton
                name="share-social-outline"
                accessibilityLabel="Paylaş"
                variant="glass"
                color="#FFFFFF"
                size={20}
                onPress={share}
              />
              <IconButton
                name="ellipsis-horizontal"
                accessibilityLabel="Diğer işlemler"
                variant="glass"
                color="#FFFFFF"
                size={20}
                onPress={() => setMenuOpen(true)}
              />
            </View>
          </View>

          {media.length > 1 ? (
            <View style={styles.counter}>
              <AppText variant="caption" color="#FFFFFF">
                {galleryIndex + 1} / {media.length}
              </AppText>
            </View>
          ) : null}
        </View>

        {media.length > 1 ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.thumbs}
          >
            {media.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${index + 1}. medyaya geç`}
                onPress={() => {
                  haptics.selection();
                  setGalleryIndex(index);
                  galleryRef.current?.scrollToOffset({ offset: index * width, animated: true });
                }}
                style={[
                  styles.thumb,
                  {
                    borderColor: galleryIndex === index ? theme.colors.primary : 'transparent',
                    backgroundColor: theme.colors.surfaceMuted,
                  },
                ]}
              >
                <Image
                  source={{
                    uri:
                      publicMediaUrl('listing-images', item.thumb_path ?? item.storage_path) ?? '',
                  }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
                {item.kind === 'video' ? (
                  <View style={styles.thumbPlay}>
                    <Ionicons name="play" size={11} color="#FFFFFF" />
                  </View>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.body}>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: theme.colors.primarySoft }]}>
              <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
                {listing.category_name ?? 'Kategori'}
              </AppText>
            </View>
            {listing.category_kind === 'real_estate' && listing.attributes.listing_kind ? (
              <View style={[styles.badge, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="caption" color="textSecondary">
                  {LISTING_KIND_LABELS[String(listing.attributes.listing_kind)] ?? ''}
                </AppText>
              </View>
            ) : null}
            {listing.verification_status === 'verified' ? (
              <View style={[styles.badge, { backgroundColor: 'rgba(47,158,99,0.14)' }]}>
                <Ionicons name="shield-checkmark" size={12} color={theme.colors.success} />
                <AppText variant="caption" style={{ color: theme.colors.success }}>
                  Doğrulanmış
                </AppText>
              </View>
            ) : null}
          </View>

          <View style={styles.titleBlock}>
            <AppText variant="h2">{listing.title}</AppText>
            <AppText variant="h1" color="primaryDeep">
              {formatMarketPrice(listing.price_cents, listing.currency, listing.price_period)}
            </AppText>
          </View>

          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={14} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {locationLabel(listing)}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {formatRelativeDate(listing.published_at ?? listing.created_at)}
            </AppText>
          </View>

          <View style={styles.statRow}>
            <Stat icon="eye-outline" label={views} />
            <Stat icon="heart-outline" label={`${listing.favorite_count} favori`} />
            <Stat icon="chatbubble-outline" label={messages} />
          </View>

          {listing.status !== 'active' ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={theme.colors.textSecondary}
              />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Bu ilan artık yayında değil. Benzer ilanlara göz atabilirsin.
              </AppText>
            </View>
          ) : null}

          {listing.description ? (
            <Section title="Açıklama">
              <AppText variant="body" color="textSecondary" style={styles.description}>
                {listing.description}
              </AppText>
            </Section>
          ) : null}

          {attributes.length ? (
            <Section title="İlan özellikleri">
              <View style={styles.attrGrid}>
                {attributes.map((attribute) => (
                  <View
                    key={attribute.key}
                    style={[
                      styles.attrCell,
                      { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                    ]}
                  >
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {attribute.label}
                    </AppText>
                    <AppText variant="bodyStrong" numberOfLines={2}>
                      {attribute.value}
                    </AppText>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          <Section title="Konum">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Konumu haritada gör"
              onPress={() => {
                if (listing.lat == null || listing.lng == null) {
                  return;
                }
                router.push({
                  pathname: '/map',
                  params: {
                    lat: String(listing.lat),
                    lng: String(listing.lng),
                    label: listing.title,
                    zoom: '14',
                  },
                } as never);
              }}
              style={[
                styles.locationCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={[styles.locationIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="map-outline" size={19} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.flex}>
                <AppText variant="label">{locationLabel(listing)}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {listing.hide_exact_location
                    ? 'Gizlilik için yaklaşık konum gösteriliyor.'
                    : 'Haritada aç ve yol tarifi al.'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
            </Pressable>
          </Section>

          <Section title="İlan bilgileri">
            <View
              style={[
                styles.infoCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <InfoRow label="İlan numarası" value={listing.id.slice(0, 8).toUpperCase()} />
              <InfoRow label="Yayın tarihi" value={formatDateTr(listing.published_at)} />
              <InfoRow label="Güncelleme" value={formatDateTr(listing.updated_at)} />
              <InfoRow
                label="Kategori"
                value={listing.category_path.join(' › ') || listing.category_name || '—'}
              />
              <InfoRow
                label="Durum"
                value={CONDITION_LABELS[listing.condition] ?? listing.condition}
                last
              />
            </View>
          </Section>

          <Section title="Satıcı">
            <View
              style={[
                styles.sellerCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.sellerHead}>
                <Avatar
                  uri={mediaPublicUrl('avatar', seller.avatar_path)}
                  name={seller.display_name || seller.username}
                  size={50}
                  ring={seller.is_verified}
                />
                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {seller.display_name || seller.username}
                    </AppText>
                    {seller.is_verified ? (
                      <Ionicons
                        name="shield-checkmark"
                        size={15}
                        color={theme.colors.primaryDeep}
                      />
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textTertiary">
                    @{seller.username} · {formatDateTr(seller.created_at)} üyesi
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {seller.active_listings} yayındaki ilan
                    {seller.rating != null ? ` · ${seller.rating.toFixed(1)} puan` : ''}
                  </AppText>
                </View>
              </View>

              <View style={styles.sellerActions}>
                <Button
                  label="Profili görüntüle"
                  variant="outline"
                  size="sm"
                  fullWidth={false}
                  style={styles.flex}
                  onPress={() => router.push(`/profile/${seller.username}` as never)}
                />
                {!listing.is_mine ? (
                  <Button
                    label="Mesaj gönder"
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    style={styles.flex}
                    loading={message.isPending}
                    onPress={sendMessage}
                  />
                ) : null}
              </View>
            </View>

            {(sellerListings.data?.items.length ?? 0) > 1 ? (
              <View style={styles.sellerListings}>
                <View style={styles.sectionHead}>
                  <AppText variant="label" color="textSecondary">
                    Satıcının diğer ilanları
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {sellerListings.data?.total ?? 0}
                  </AppText>
                </View>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.horizontal}
                >
                  {sellerListings.data?.items
                    .filter((entry) => entry.id !== listing.id)
                    .map((entry) => (
                      <MarketListingCard
                        key={entry.id}
                        listing={entry}
                        width={172}
                        onPress={() => router.push(`/marketplace/${entry.id}` as never)}
                        onToggleFavorite={() => favorite.mutate(entry.id)}
                        favoritePending={favorite.isPending && favorite.variables === entry.id}
                      />
                    ))}
                </ScrollView>
              </View>
            ) : null}
          </Section>

          {detail.similar.length ? (
            <Section title="Benzer ilanlar">
              <ScrollView
                keyboardShouldPersistTaps="handled"
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontal}
              >
                {detail.similar.map((entry) => (
                  <MarketListingCard
                    key={entry.id}
                    listing={entry}
                    width={172}
                    onPress={() => router.push(`/marketplace/${entry.id}` as never)}
                    onToggleFavorite={() => favorite.mutate(entry.id)}
                    favoritePending={favorite.isPending && favorite.variables === entry.id}
                  />
                ))}
              </ScrollView>
            </Section>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            paddingBottom: insets.bottom + 10,
          },
        ]}
      >
        {listing.is_mine ? (
          <>
            <Button
              label="İlanı yönet"
              size="md"
              variant="outline"
              style={styles.flex}
              onPress={() => setMenuOpen(true)}
            />
            <Button
              label="Düzenle"
              size="md"
              style={styles.flex}
              leftIcon={<Ionicons name="create-outline" size={16} color={theme.colors.onPrimary} />}
              onPress={() =>
                router.push({
                  pathname: '/marketplace/create',
                  params: { id: listing.id },
                } as never)
              }
            />
          </>
        ) : (
          <>
            {phoneAllowed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Satıcıyı ara"
                onPress={call}
                style={[
                  styles.callButton,
                  { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
                ]}
              >
                <Ionicons name="call" size={20} color={theme.colors.primaryDeep} />
              </Pressable>
            ) : null}
            <Button
              label="Mesaj Gönder"
              size="md"
              style={styles.flex}
              loading={message.isPending}
              disabled={listing.status !== 'active'}
              leftIcon={
                <Ionicons name="chatbubble-ellipses" size={17} color={theme.colors.onPrimary} />
              }
              onPress={sendMessage}
            />
          </>
        )}
      </View>

      <MarketMediaViewer
        visible={viewerOpen}
        items={viewerItems}
        initialIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />

      <ActionSheet
        visible={menuOpen}
        title={listing.title}
        items={menuItems}
        onClose={() => setMenuOpen(false)}
        onSelect={(key) => {
          setMenuOpen(false);
          if (key === 'edit') {
            router.push({ pathname: '/marketplace/create', params: { id: listing.id } } as never);
          } else if (key === 'sold') {
            Alert.alert('Satıldı olarak işaretle', 'İlan yayından kaldırılacak. Emin misin?', [
              { text: 'Vazgeç', style: 'cancel' },
              { text: 'İşaretle', onPress: () => updateStatus('sold') },
            ]);
          } else if (key === 'archive') {
            updateStatus('archived');
          } else if (key === 'delete') {
            deleteListing();
          } else if (key === 'share') {
            void share();
          } else if (key === 'report') {
            openReport({
              targetType: 'listing',
              targetId: listing.id,
              targetUserId: listing.seller_id,
              targetLabel: listing.title,
            });
          }
        }}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="h3">{title}</AppText>
      {children}
    </View>
  );
}

function Stat({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={13} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.infoRow,
        !last
          ? { borderBottomColor: theme.colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }
          : null,
      ]}
    >
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="caption" color="textSecondary" style={styles.infoValue} numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

function CenteredState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  onBack,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  onBack: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.stateRoot,
        { backgroundColor: theme.colors.background, paddingTop: insets.top + 10 },
      ]}
    >
      <View style={styles.stateHeader}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={onBack}
        />
      </View>
      <View style={styles.stateBody}>
        <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name={icon} size={28} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="h3" align="center">
          {title}
        </AppText>
        <AppText variant="body" color="textSecondary" align="center">
          {body}
        </AppText>
        {actionLabel && onAction ? (
          <Button
            label={actionLabel}
            size="sm"
            fullWidth={false}
            style={styles.stateButton}
            onPress={onAction}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1 },
  loadingBody: { padding: 18, gap: 10 },
  gallery: { overflow: 'hidden' },
  emptyGallery: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 },
  topBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  counter: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(6,12,24,0.62)',
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(3,7,14,0.22)',
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(3,7,14,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  thumbs: { gap: 7, paddingHorizontal: 14, paddingVertical: 9 },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: 10,
    borderWidth: 2,
    overflow: 'hidden',
  },
  thumbPlay: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(3,7,14,0.64)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: 18, gap: 14, paddingTop: 8 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    maxWidth: '100%',
  },
  titleBlock: { gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  section: { gap: 8, marginTop: 2 },
  description: { lineHeight: 22 },
  attrGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  attrCell: {
    width: '48.7%',
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  locationIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: { borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  infoValue: { flex: 1, textAlign: 'right' },
  sellerCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  sellerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sellerActions: { flexDirection: 'row', gap: 8 },
  sellerListings: { gap: 8, marginTop: 4 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  horizontal: { gap: 9, paddingVertical: 2, paddingRight: 18 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  callButton: {
    width: 50,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateRoot: { flex: 1 },
  stateHeader: { paddingHorizontal: 14 },
  stateBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 8,
    paddingBottom: 80,
  },
  stateIcon: {
    width: 60,
    height: 60,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateButton: { marginTop: 8 },
});
