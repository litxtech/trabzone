import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppImage, AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAccommodationLayout } from '../hooks/use-accommodation-layout';
import { accommodationMediaUrl } from '../services/accommodation-media-service';
import type { PropertySummary } from '../types';
import { formatMoneyCents, PROPERTY_TYPE_LABELS } from '../utils/format';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Konaklama yüzeylerinde kullanılan sabit aurora paleti (tema bağımsız). */
export const AURORA = {
  night: '#070B14',
  deep: '#0C1426',
  indigo: '#141C30',
  violet: '#2B2568',
  iris: '#4169F5',
  orchid: '#8057F4',
  glow: '#6284FF',
  gold: '#F5B301',
} as const;

/** 5 üzerinden puanı misafir diline çevirir. */
export function ratingLabel(rating: number, count = 1): string {
  if (count === 0 || rating <= 0) return 'Yeni';
  if (rating >= 4.7) return 'Olağanüstü';
  if (rating >= 4.4) return 'Mükemmel';
  if (rating >= 4.0) return 'Çok iyi';
  if (rating >= 3.5) return 'İyi';
  return 'Memnun edici';
}

/**
 * Olanak adlarını (tesis tarafından serbest metin girilir) ikona eşler.
 * Eşleşme bulunamazsa nötr bir onay ikonu kullanılır.
 */
export function amenityIcon(name: string): IconName {
  const value = name.toLocaleLowerCase('tr-TR');
  const rules: { keys: string[]; icon: IconName }[] = [
    { keys: ['wi-fi', 'wifi', 'internet', 'kablosuz'], icon: 'wifi' },
    { keys: ['kahvaltı'], icon: 'cafe-outline' },
    { keys: ['restoran', 'restaurant', 'yemek'], icon: 'restaurant-outline' },
    { keys: ['bar', 'içki'], icon: 'wine-outline' },
    { keys: ['havuz'], icon: 'water-outline' },
    { keys: ['plaj', 'sahil', 'deniz', 'manzara'], icon: 'sunny-outline' },
    { keys: ['otopark', 'park', 'garaj', 'vale'], icon: 'car-outline' },
    { keys: ['klima'], icon: 'snow-outline' },
    { keys: ['spa', 'hamam', 'sauna', 'masaj'], icon: 'flower-outline' },
    { keys: ['spor', 'fitness', 'gym'], icon: 'barbell-outline' },
    { keys: ['evcil', 'hayvan'], icon: 'paw-outline' },
    { keys: ['asansör', 'engelli'], icon: 'accessibility-outline' },
    { keys: ['mutfak', 'buzdolabı'], icon: 'fast-food-outline' },
    { keys: ['çamaşır', 'ütü'], icon: 'shirt-outline' },
    { keys: ['transfer', 'servis', 'otobüs', 'havaalanı'], icon: 'bus-outline' },
    { keys: ['toplantı', 'konferans', 'etkinlik'], icon: 'people-outline' },
    { keys: ['resepsiyon', '24 saat'], icon: 'time-outline' },
    { keys: ['bahçe', 'teras', 'balkon'], icon: 'leaf-outline' },
    { keys: ['güvenlik', 'kamera', 'kasa'], icon: 'shield-checkmark-outline' },
    { keys: ['çocuk', 'oyun'], icon: 'happy-outline' },
  ];
  const match = rules.find((rule) => rule.keys.some((key) => value.includes(key)));
  return match?.icon ?? 'checkmark-circle-outline';
}

// ---------------------------------------------------------------------------
// Yüzeyler
// ---------------------------------------------------------------------------

/** Koyu aurora arka planı; hero ve panel başlıklarında kullanılır. */
export function AuroraBackdrop({
  children,
  style,
  colors = [AURORA.night, AURORA.indigo, AURORA.violet],
  rounded = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  colors?: readonly [string, string, ...string[]];
  rounded?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[rounded ? { borderRadius: theme.radius.xl, overflow: 'hidden' } : null, style]}
    >
      <View pointerEvents="none" style={styles.auroraWrap}>
        <View style={[styles.auroraBlob, styles.auroraBlobA]} />
        <View style={[styles.auroraBlob, styles.auroraBlobB]} />
        <View style={[styles.auroraBlob, styles.auroraBlobC]} />
      </View>
      {children}
    </LinearGradient>
  );
}

/** Cam (yarı saydam) pill; koyu zemin üzerinde okunaklı etiket. */
export function GlassPill({
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon?: IconName;
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={12} color="rgba(255,255,255,0.92)" /> : null}
      <AppText variant="caption" numberOfLines={1} style={styles.glassPillText}>
        {label}
      </AppText>
    </>
  );
  if (!onPress) {
    return <View style={styles.glassPill}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [styles.glassPill, { opacity: pressed ? 0.75 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

/** Kare ikon butonu (fotoğraf galerisi, geri, paylaş gibi üst kontroller). */
export function IconSquare({
  icon,
  onPress,
  accessibilityLabel,
  tone = 'glass',
  size = 40,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  tone?: 'glass' | 'light' | 'solid';
  size?: number;
}) {
  const { theme } = useTheme();
  const palette = {
    glass: { backgroundColor: 'rgba(8,13,26,0.55)', borderColor: 'rgba(255,255,255,0.22)', color: '#FFFFFF' },
    light: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, color: theme.colors.text },
    solid: { backgroundColor: theme.colors.primaryDeep, borderColor: theme.colors.primaryDeep, color: '#FFFFFF' },
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconSquare,
        {
          width: size,
          height: size,
          borderRadius: size >= 38 ? 13 : 11,
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={size >= 38 ? 20 : 17} color={palette.color} />
    </Pressable>
  );
}

/** Bölüm başlığı: üst etiket, başlık ve sağdaki aksiyon bağlantısı. */
export function SectionTitle({
  overline,
  title,
  subtitle,
  actionLabel,
  onAction,
  icon,
  compact = false,
}: {
  overline?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
  compact?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.sectionTitle, compact ? styles.sectionTitleCompact : null]}>
      {icon ? (
        <LinearGradient
          colors={[theme.colors.primary, theme.colors.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.sectionIcon}
        >
          <Ionicons name={icon} size={16} color="#FFFFFF" />
        </LinearGradient>
      ) : null}
      <View style={styles.flex}>
        {overline ? (
          <AppText variant="overline" color="textTertiary" style={styles.sectionOverline}>
            {overline}
          </AppText>
        ) : null}
        <AppText variant={compact ? 'title' : 'h3'}>{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color="textSecondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles.sectionAction, { opacity: pressed ? 0.65 : 1 }]}
        >
          <AppText variant="caption" color="primaryDeep" style={styles.sectionActionText}>
            {actionLabel}
          </AppText>
          <Ionicons name="arrow-forward" size={13} color={theme.colors.primaryDeep} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Puan
// ---------------------------------------------------------------------------

export function ScoreBadge({
  rating,
  count,
  size = 'md',
}: {
  rating: number;
  count: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { theme } = useTheme();
  const label = ratingLabel(rating, count);
  if (size === 'sm') {
    return (
      <View style={[styles.scoreSm, { backgroundColor: 'rgba(8,13,26,0.62)', borderColor: 'rgba(255,255,255,0.2)' }]}>
        <Ionicons name="star" size={11} color={AURORA.gold} />
        <AppText variant="caption" style={styles.scoreSmText}>
          {count > 0 ? rating.toFixed(1) : 'Yeni'}
        </AppText>
      </View>
    );
  }
  const big = size === 'lg';
  return (
    <View style={styles.scoreBlock}>
      <View
        style={[
          styles.scoreValue,
          {
            backgroundColor: theme.colors.primaryDeep,
            paddingHorizontal: big ? 12 : 9,
            paddingVertical: big ? 8 : 6,
            borderRadius: big ? 12 : 10,
          },
        ]}
      >
        <AppText
          variant={big ? 'h3' : 'bodyStrong'}
          style={[styles.scoreNumber, big ? { fontSize: 20 } : null]}
        >
          {count > 0 ? rating.toFixed(1) : '—'}
        </AppText>
      </View>
      <View style={styles.scoreCopy}>
        <AppText variant={big ? 'title' : 'caption'} numberOfLines={1}>
          {label}
        </AppText>
        <AppText variant="caption" color="textTertiary">
          {count > 0 ? `${count} değerlendirme` : 'İlk yorumu sen yaz'}
        </AppText>
      </View>
    </View>
  );
}

/** Tesis detayındaki geniş puan paneli (kırılımlı). */
export function ScorePanel({
  rating,
  count,
  breakdown,
}: {
  rating: number;
  count: number;
  breakdown: { key: string; label: string; value: number }[];
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.scorePanel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={styles.scorePanelHead}>
        <View>
          <AppText variant="display" color="primaryDeep" style={styles.scorePanelNumber}>
            {count > 0 ? rating.toFixed(1) : '—'}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            / 5 · {count} yorum
          </AppText>
        </View>
        <View style={styles.flex}>
          <AppText variant="h3">{ratingLabel(rating, count)}</AppText>
          <AppText variant="caption" color="textSecondary">
            Misafirlerin gerçek konaklama puanları
          </AppText>
        </View>
      </View>
      <View style={styles.scorePanelBars}>
        {breakdown.map((row) => (
          <View key={row.key} style={styles.barRow}>
            <AppText variant="caption" color="textSecondary" style={styles.barLabel} numberOfLines={1}>
              {row.label}
            </AppText>
            <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
              <LinearGradient
                colors={[theme.colors.primary, theme.colors.accent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.barFill, { width: `${Math.max(4, Math.min(100, (row.value / 5) * 100))}%` }]}
              />
            </View>
            <AppText variant="caption" style={styles.barValue}>
              {row.value.toFixed(1)}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Olanaklar
// ---------------------------------------------------------------------------

export function AmenityChips({
  items,
  max = 3,
  onDark = false,
}: {
  items: string[];
  max?: number;
  onDark?: boolean;
}) {
  const { theme } = useTheme();
  const visible = items.slice(0, max);
  if (visible.length === 0) return null;
  return (
    <View style={styles.amenityChips}>
      {visible.map((item) => (
        <View
          key={item}
          style={[
            styles.amenityChip,
            {
              backgroundColor: onDark ? 'rgba(255,255,255,0.1)' : theme.colors.surfaceMuted,
              borderColor: onDark ? 'rgba(255,255,255,0.14)' : theme.colors.border,
            },
          ]}
        >
          <Ionicons
            name={amenityIcon(item)}
            size={11}
            color={onDark ? 'rgba(255,255,255,0.85)' : theme.colors.primaryDeep}
          />
          <AppText
            variant="caption"
            numberOfLines={1}
            style={{ color: onDark ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary, fontSize: 11 }}
          >
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export function AmenityGrid({ items }: { items: string[] }) {
  const { theme } = useTheme();
  return (
    <View style={styles.amenityGrid}>
      {items.map((item) => (
        <View
          key={item}
          style={[
            styles.amenityTile,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.amenityTileIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name={amenityIcon(item)} size={15} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="caption" color="textSecondary" numberOfLines={2} style={styles.flex}>
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Kartlar
// ---------------------------------------------------------------------------

/**
 * Yatay kaydırılan vitrin kartı ("öne çıkanlar", "fırsatlar").
 * Görsel oranı korunur, alt kısımda ad / konum / puan / fiyat bulunur.
 */
export function ShowcaseCard({
  property,
  onPress,
  width = 268,
}: {
  property: PropertySummary;
  onPress: () => void;
  width?: number;
}) {
  const { theme } = useTheme();
  const cover = accommodationMediaUrl(property.cover_path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${property.name}, ${PROPERTY_TYPE_LABELS[property.property_type]}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.showcase,
        {
          width,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={styles.showcaseMedia}>
        {cover ? (
          <AppImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" recycleKey={property.id} />
        ) : (
          <LinearGradient
            colors={[theme.colors.primarySoft, theme.colors.surfaceMuted]}
            style={[StyleSheet.absoluteFill, styles.showcaseFallback]}
          >
            <Ionicons name="bed-outline" size={30} color={theme.colors.primaryDeep} />
          </LinearGradient>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(6,10,20,0.72)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.showcaseTop}>
          <GlassPill label={PROPERTY_TYPE_LABELS[property.property_type]} />
          {property.has_deal ? (
            <View style={[styles.dealRibbon, { backgroundColor: theme.colors.accent }]}>
              <Ionicons name="pricetag" size={10} color="#FFFFFF" />
              <AppText variant="caption" style={styles.dealRibbonText}>
                Fırsat
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.showcaseBottom}>
          <GlassPill
            icon="location-outline"
            label={[property.neighborhood, property.district].filter(Boolean).join(', ') || 'Trabzon'}
          />
          {property.rating_count > 0 ? <ScoreBadge rating={property.rating_avg} count={property.rating_count} size="sm" /> : null}
        </View>
      </View>

      <View style={styles.showcaseBody}>
        <AppText variant="title" numberOfLines={1}>
          {property.name}
        </AppText>
        <AmenityChips items={property.amenities} max={2} />
        <View style={styles.showcaseFoot}>
          <View style={styles.flex}>
            {property.price_from_cents ? (
              <>
                <AppText variant="caption" color="textTertiary">
                  gecelik başlangıç
                </AppText>
                <AppText variant="h3" color="primaryDeep">
                  {formatMoneyCents(property.price_from_cents, property.currency, { decimals: false })}
                </AppText>
              </>
            ) : (
              <AppText variant="caption" color="textTertiary">
                Fiyat için iletişime geç
              </AppText>
            )}
          </View>
          <View style={[styles.showcaseArrow, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="arrow-forward" size={14} color={theme.colors.primaryDeep} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Yatay vitrin şeridi. */
export function ShowcaseRail({
  children,
  paddingHorizontal = 0,
}: {
  children: ReactNode;
  paddingHorizontal?: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      contentContainerStyle={[styles.rail, { paddingHorizontal }]}
    >
      {children}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Sekmeler
// ---------------------------------------------------------------------------

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string; icon?: IconName; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segments}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                opacity: pressed ? 0.82 : 1,
              },
            ]}
          >
            {item.icon ? (
              <Ionicons name={item.icon} size={14} color={active ? '#FFFFFF' : theme.colors.textSecondary} />
            ) : null}
            <AppText
              variant="caption"
              style={{ color: active ? '#FFFFFF' : theme.colors.textSecondary, fontSize: 12 }}
            >
              {item.label}
            </AppText>
            {typeof item.count === 'number' ? (
              <View
                style={[
                  styles.segmentCount,
                  { backgroundColor: active ? 'rgba(255,255,255,0.22)' : theme.colors.surfaceMuted },
                ]}
              >
                <AppText
                  variant="caption"
                  style={{ fontSize: 9, color: active ? '#FFFFFF' : theme.colors.textTertiary }}
                >
                  {item.count}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

export function PriceTag({
  cents,
  currency = 'TRY',
  caption = 'gecelik',
  tone = 'default',
  size = 'md',
}: {
  cents: number | null | undefined;
  currency?: string;
  caption?: string;
  tone?: 'default' | 'primary' | 'inverse';
  size?: 'sm' | 'md' | 'lg';
}) {
  const { theme } = useTheme();
  const color =
    tone === 'inverse' ? '#FFFFFF' : tone === 'primary' ? theme.colors.primaryDeep : theme.colors.text;
  return (
    <View style={styles.priceTag}>
      <AppText
        variant="caption"
        style={{ color: tone === 'inverse' ? 'rgba(255,255,255,0.7)' : theme.colors.textTertiary, fontSize: 10 }}
      >
        {caption}
      </AppText>
      <AppText
        variant={size === 'lg' ? 'h2' : size === 'sm' ? 'bodyStrong' : 'h3'}
        style={[styles.priceTagValue, { color }]}
      >
        {formatMoneyCents(cents, currency, { decimals: false })}
      </AppText>
    </View>
  );
}

export function AccDivider({ spacing = 0 }: { spacing?: number }) {
  const { theme } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.divider, marginVertical: spacing }} />;
}

/** Tesis tipi için ikon. */
export function propertyTypeIcon(type: PropertySummary['property_type']): IconName {
  switch (type) {
    case 'bungalow':
      return 'home-outline';
    case 'apartment':
      return 'business-outline';
    case 'pension':
      return 'bed-outline';
    case 'villa':
      return 'leaf-outline';
    default:
      return 'business';
  }
}

/**
 * Tesis detayındaki galeri mozaiği.
 * Masaüstünde 1 büyük + 4 küçük görsel, mobilde tek kapak.
 * Video varsa küçük karolar oynatma rozetiyle gösterilir; sayaç hem fotoğraf
 * hem video sayısını bildirir.
 */
export type MosaicMedia = {
  id: string;
  uri: string;
  /** Video için kapak/önizleme görseli. */
  thumbUri?: string | null;
  kind: 'image' | 'video';
  caption: string | null;
};

export function PhotoMosaic({
  media,
  onPress,
  onBack,
  onShare,
  badge,
}: {
  media: MosaicMedia[];
  onPress: (index: number) => void;
  onBack: () => void;
  onShare: () => void;
  badge?: ReactNode;
}) {
  const { theme } = useTheme();
  const layout = useAccommodationLayout();
  const insets = useSafeAreaInsets();
  const desktop = layout.isDesktop;
  const cover = media[0];
  const photoCount = media.filter((item) => item.kind === 'image').length;
  const videoCount = media.length - photoCount;
  const coverUri = cover ? (cover.kind === 'video' ? cover.thumbUri ?? null : cover.uri) : null;

  return (
    <View style={[styles.mosaic, desktop ? styles.mosaicDesktop : styles.mosaicMobile]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cover ? 'Kapak medyasını aç' : 'Medya yok'}
        onPress={() => onPress(0)}
        style={styles.mosaicCover}
      >
        {coverUri ? (
          <AppImage source={{ uri: coverUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <LinearGradient colors={[AURORA.indigo, AURORA.violet]} style={StyleSheet.absoluteFill} />
        )}
        <LinearGradient
          colors={['rgba(5,9,18,0.55)', 'transparent', 'rgba(5,9,18,0.45)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {cover?.kind === 'video' ? (
          <View style={styles.mosaicPlay} pointerEvents="none">
            <Ionicons name="play" size={26} color="#FFFFFF" />
          </View>
        ) : null}
        {!cover ? (
          <View style={styles.mosaicEmpty}>
            <Ionicons name="images-outline" size={30} color="rgba(255,255,255,0.7)" />
            <AppText variant="caption" style={styles.mosaicEmptyText}>
              Medya eklenmemiş
            </AppText>
          </View>
        ) : null}
      </Pressable>

      {desktop ? (
        <View style={styles.mosaicSide}>
          {media.slice(1, 5).map((item, index) => {
            const thumb = item.kind === 'video' ? item.thumbUri ?? null : item.uri;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.caption ?? `${index + 2}. medya`}
                onPress={() => onPress(index + 1)}
                style={styles.mosaicSideItem}
              >
                {thumb ? (
                  <AppImage source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.mosaicSideFallback]}>
                    <Ionicons name="play" size={18} color="rgba(255,255,255,0.85)" />
                  </View>
                )}
                {item.kind === 'video' ? (
                  <View style={styles.mosaicSidePlay} pointerEvents="none">
                    <Ionicons name="play" size={12} color="#FFFFFF" />
                  </View>
                ) : null}
                {index === 3 && media.length > 5 ? (
                  <View style={styles.mosaicMore}>
                    <AppText variant="title" style={styles.mosaicMoreText}>
                      +{media.length - 5}
                    </AppText>
                    <AppText variant="caption" style={styles.mosaicMoreText}>
                      medya
                    </AppText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {Array.from({ length: Math.max(0, 4 - Math.max(0, media.length - 1)) }).map((_, index) => (
            <View
              key={`empty-${index}`}
              style={[styles.mosaicSideItem, { backgroundColor: theme.colors.surfaceMuted }]}
            />
          ))}
        </View>
      ) : null}

      <View
        style={[styles.mosaicTop, { top: insets.top + 12 }]}
        pointerEvents="box-none"
      >
        <IconSquare icon="chevron-back" onPress={onBack} accessibilityLabel="Geri" />
        <View style={styles.mosaicTopRight}>
          {badge}
          <IconSquare icon="share-outline" onPress={onShare} accessibilityLabel="Paylaş" />
        </View>
      </View>

      {media.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Tüm medyayı gör, ${media.length} öğe`}
          onPress={() => onPress(0)}
          style={styles.mosaicCounter}
        >
          <Ionicons name="images-outline" size={13} color="#FFFFFF" />
          <AppText variant="caption" style={styles.mosaicCounterText}>
            {photoCount} fotoğraf
            {videoCount > 0 ? ` · ${videoCount} video` : ''}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  auroraWrap: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  auroraBlob: { position: 'absolute', borderRadius: 999 },
  auroraBlobA: { width: 260, height: 260, top: -120, right: -60, backgroundColor: 'rgba(98,132,255,0.30)' },
  auroraBlobB: { width: 220, height: 220, bottom: -110, left: -70, backgroundColor: 'rgba(128,87,244,0.28)' },
  auroraBlobC: { width: 120, height: 120, top: 20, left: '38%', backgroundColor: 'rgba(53,208,192,0.12)' },

  glassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(8,13,26,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  glassPillText: { color: '#FFFFFF', fontSize: 10 },

  iconSquare: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },

  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 44 },
  sectionTitleCompact: { minHeight: 36 },
  sectionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sectionOverline: { fontSize: 9, marginBottom: 1 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 6 },
  sectionActionText: { fontSize: 11 },

  scoreSm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scoreSmText: { color: '#FFFFFF', fontSize: 11 },
  scoreBlock: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  scoreValue: { alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  scoreNumber: { color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  scoreCopy: { gap: 1 },

  scorePanel: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 14 },
  scorePanelHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  scorePanelNumber: { fontSize: 38, lineHeight: 42 },
  scorePanelBars: { gap: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  barLabel: { width: 104 },
  barTrack: { flex: 1, height: 6, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barValue: { width: 24, textAlign: 'right', fontVariant: ['tabular-nums'] },

  amenityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  amenityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenityTile: {
    width: '48.8%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  amenityTileIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },

  showcase: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  showcaseMedia: { height: 158, position: 'relative' },
  showcaseFallback: { alignItems: 'center', justifyContent: 'center' },
  showcaseTop: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  showcaseBottom: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  dealRibbon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: 'auto',
  },
  dealRibbonText: { color: '#FFFFFF', fontSize: 9 },
  showcaseBody: { padding: 12, gap: 6 },
  showcaseFoot: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  showcaseArrow: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rail: { gap: 11, paddingVertical: 2 },

  segments: { gap: 7 },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    height: 36,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentCount: { minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },

  priceTag: { gap: 1 },
  priceTagValue: { fontVariant: ['tabular-nums'] },

  mosaic: { position: 'relative', backgroundColor: AURORA.night, overflow: 'hidden' },
  mosaicMobile: { height: 300 },
  mosaicDesktop: { height: 430, flexDirection: 'row', gap: 3 },
  mosaicCover: { flex: 1, position: 'relative' },
  mosaicEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  mosaicEmptyText: { color: 'rgba(255,255,255,0.7)' },
  mosaicSide: { width: '36%', flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  mosaicSideItem: { width: '48.4%', height: '48.4%', position: 'relative', overflow: 'hidden' },
  mosaicMore: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5,9,18,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mosaicMoreText: { color: '#FFFFFF' },
  mosaicPlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,9,18,0.24)',
  },
  mosaicSideFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AURORA.indigo,
  },
  mosaicSidePlay: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,9,18,0.68)',
  },
  mosaicTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mosaicTopRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mosaicCounter: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(8,13,26,0.68)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  mosaicCounterText: { color: '#FFFFFF', fontSize: 10 },
});
