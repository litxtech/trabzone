import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AppText, Wordmark } from '@/components/ui';
import { useWebsiteContent } from '@/features/web-content/hooks/use-web-content';
import type { WebsiteSection } from '@/features/web-content/types';
import { useReduceMotion } from '@/perf/use-reduce-motion';
import { useTheme } from '@/theme/ThemeProvider';

import { useWebMeta } from '../use-web-meta';
import { webPhotos } from '../assets';
import { WebFooter } from './WebFooter';
import { WebHeader } from './WebHeader';
import {
  ChatPhone,
  FeedPhone,
  HeroShowcase,
  MapPreview,
  MarketplaceTile,
  ReelsPhone,
} from './LandingVisuals';

const FALLBACK_ITEMS: Record<string, string[]> = {
  social: ['Gönderi ve hikâye paylaşımı', 'Yorum, beğeni ve kaydetme', 'Profil ve takip sistemi', 'Keşfet akışı'],
  reels: ['Dikey tam ekran oynatma', 'Beğeni, yorum ve paylaşım', 'Keşfet ve öneri akışı', 'Sessiz başlangıç'],
  marketplace: ['Alışveriş ve ikinci el', 'Emlak ilanları', 'Araç ilanları', 'İşletme ve hizmetler', 'Haritada keşfet'],
  map: ['Restoran ve kafeler', 'Otel ve konaklama', 'Kiralık ve satılık', 'Gezilecek yerler'],
  messaging: ['Birebir mesajlaşma', 'Medya paylaşımı', 'Gerçek zamanlı iletim', 'Engelleme ve gizlilik'],
  security: [
    'Kullanıcı ve içerik şikâyeti',
    'Engelleme ve sessize alma',
    'Moderasyon ve itiraz',
    'Çocuk güvenliği',
    'Gizlilik tercihleri',
    'Hesap yönetimi',
  ],
};

const MARKET_TILES: { icon: keyof typeof Ionicons.glyphMap; label: string; accent: string }[] = [
  { icon: 'bag-handle-outline', label: 'Alışveriş', accent: '#6284FF' },
  { icon: 'home-outline', label: 'Emlak', accent: '#A78BFA' },
  { icon: 'car-outline', label: 'Araçlar', accent: '#4AD295' },
  { icon: 'storefront-outline', label: 'İşletmeler', accent: '#F0B45A' },
  { icon: 'construct-outline', label: 'Hizmetler', accent: '#38BDF8' },
  { icon: 'compass-outline', label: 'Haritada Keşfet', accent: '#FF8FA3' },
];

function scrollToId(id: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return;
  }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function AnimatedGlow() {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0.55;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.32 + progress.value * 0.34,
    transform: [{ translateY: -18 * progress.value }, { scale: 1 + progress.value * 0.08 }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.heroGlow, style]}>
      <LinearGradient
        colors={['rgba(65,105,245,0.5)', 'rgba(128,87,244,0.18)', 'rgba(5,8,15,0)']}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function HeroButton({
  label,
  icon,
  variant,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  variant: 'primary' | 'glass' | 'ghost';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.heroButton,
        variant === 'primary' ? styles.heroButtonPrimary : null,
        variant === 'glass' ? styles.heroButtonGlass : null,
        variant === 'ghost' ? styles.heroButtonGhost : null,
        { opacity: pressed ? 0.82 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] },
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={['#6284FF', '#8057F4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
        />
      ) : null}
      <Ionicons name={icon} size={17} color="#FFFFFF" />
      <AppText variant="bodyStrong" color="#FFFFFF" style={styles.heroButtonLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
}: {
  eyebrow: string;
  title: string;
  description: string;
  align?: 'left' | 'center';
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.sectionHeading, align === 'center' ? styles.headingCenter : null]}>
      <View style={[styles.eyebrowPill, { backgroundColor: theme.colors.primarySoft }]}>
        <AppText variant="overline" color="primaryDeep" style={styles.eyebrowText}>
          {eyebrow}
        </AppText>
      </View>
      <AppText variant="display" style={[styles.sectionTitle, align === 'center' ? styles.textCenter : null]}>
        {title}
      </AppText>
      <AppText
        variant="body"
        color="textSecondary"
        style={[styles.sectionDescription, align === 'center' ? styles.textCenter : null]}
      >
        {description}
      </AppText>
    </View>
  );
}

function BulletList({ items, dark = false }: { items: string[]; dark?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={styles.bullets}>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <View
            style={[
              styles.bulletIcon,
              { backgroundColor: dark ? 'rgba(120,150,235,0.18)' : theme.colors.primarySoft },
            ]}
          >
            <Ionicons name="checkmark" size={12} color={dark ? '#9DB6FF' : theme.colors.primaryDeep} />
          </View>
          <AppText variant="body" color={dark ? '#C7D4EE' : 'textSecondary'} style={styles.flex}>
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function useSection(key: string): WebsiteSection | undefined {
  const { data } = useWebsiteContent();
  return data?.sections?.find((section) => section.key === key);
}

function sectionItems(section: WebsiteSection | undefined, key: string): string[] {
  const raw = section?.payload?.items;
  if (Array.isArray(raw)) {
    const items = raw.filter((item): item is string => typeof item === 'string');
    if (items.length > 0) {
      return items;
    }
  }
  return FALLBACK_ITEMS[key] ?? [];
}

export function LandingPage() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { data } = useWebsiteContent();

  useWebMeta({
    title: "Trabzone · Trabzon'un Dijital Merkezi",
    description:
      "Trabzon'un sosyal keşif, marketplace, emlak, araç ve harita platformu. Paylaş, keşfet, alışveriş yap ve şehrin topluluğuna katıl.",
    path: '/',
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }
    const scrollToHash = () => {
      const id = window.location.hash.replace(/^#/, '');
      if (id) {
        window.setTimeout(() => scrollToId(id), 120);
      }
    };
    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
  }, []);

  const desktop = width >= 1024;
  const tablet = width >= 720;
  const heroSize = desktop ? 66 : tablet ? 48 : width < 380 ? 38 : 44;

  const hero = data?.settings?.hero;
  const brandName = data?.settings?.brand?.name ?? 'Trabzone';

  const social = useSection('social');
  const reels = useSection('reels');
  const marketplace = useSection('marketplace');
  const map = useSection('map');
  const messaging = useSection('messaging');
  const security = useSection('security');
  const cta = useSection('cta');

  const socialItems = useMemo(() => sectionItems(social, 'social'), [social]);
  const reelsItems = useMemo(() => sectionItems(reels, 'reels'), [reels]);
  const marketItems = useMemo(() => sectionItems(marketplace, 'marketplace'), [marketplace]);
  const mapItems = useMemo(() => sectionItems(map, 'map'), [map]);
  const messagingItems = useMemo(() => sectionItems(messaging, 'messaging'), [messaging]);
  const securityItems = useMemo(() => sectionItems(security, 'security'), [security]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <WebHeader />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* HERO */}
        <View nativeID="top" style={styles.hero}>
          <Image
            source={webPhotos.hero}
            style={styles.heroImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            accessibilityLabel="Trabzon şehir manzarası"
          />
          <LinearGradient
            colors={['rgba(4,7,14,0.94)', 'rgba(8,18,40,0.88)', 'rgba(12,23,48,0.8)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['transparent', 'rgba(4,7,14,0.55)', 'rgba(4,7,14,0.9)']}
            style={StyleSheet.absoluteFill}
          />
          <AnimatedGlow />
          <View pointerEvents="none" style={styles.heroGrid}>
            {[16, 34, 52, 70, 88].map((top) => (
              <View key={`hg-${top}`} style={[styles.gridLine, { top: `${top}%` }]} />
            ))}
            {[12, 30, 48, 66, 84].map((left) => (
              <View key={`vg-${left}`} style={[styles.gridLineV, { left: `${left}%` }]} />
            ))}
          </View>

          <View style={[styles.heroInner, desktop ? styles.heroRow : styles.heroColumn]}>
            <View style={[styles.heroCopy, desktop ? styles.heroCopyDesktop : null]}>
              <View style={styles.heroChip}>
                <View style={styles.liveDot} />
                <AppText
                  variant="overline"
                  color="#9DB6FF"
                  style={styles.heroChipText}
                  accessibilityRole="header"
                >
                  {typeof hero?.eyebrow === 'string' ? hero.eyebrow : "TRABZON'UN DİJİTAL MERKEZİ"}
                </AppText>
              </View>

              <View style={styles.wordmarkWrap}>
                <Wordmark
                  size={heroSize}
                  gradient
                  gradientColors={['#FFFFFF', '#9DB6FF', '#A78BFA']}
                  tracking={0.06}
                />
              </View>

              <AppText
                variant="display"
                color="#FFFFFF"
                style={[styles.heroSlogan, { fontSize: desktop ? 31 : 23, lineHeight: desktop ? 42 : 32 }]}
              >
                {typeof hero?.slogan === 'string'
                  ? hero.slogan
                  : 'Bir Şehirden Daha Fazlası. Birlikte Daha Güçlüyüz.'}
              </AppText>

              <AppText variant="body" color="#A7B4CF" style={styles.heroDescription}>
                {typeof hero?.description === 'string'
                  ? hero.description
                  : "Paylaş, keşfet, yeni insanlarla tanış ve Trabzon'un dijital dünyasına katıl."}
              </AppText>

              <View style={styles.heroActions}>
                <HeroButton
                  label={typeof hero?.primary_cta === 'string' ? hero.primary_cta : 'Hemen Katıl'}
                  icon="sparkles"
                  variant="primary"
                  onPress={() => router.push('/register' as Href)}
                />
                <HeroButton
                  label={typeof hero?.secondary_cta === 'string' ? hero.secondary_cta : 'Giriş Yap'}
                  icon="log-in-outline"
                  variant="glass"
                  onPress={() => router.push('/login' as Href)}
                />
                <HeroButton
                  label={
                    typeof hero?.tertiary_cta === 'string' ? hero.tertiary_cta : 'Uygulamayı Keşfet'
                  }
                  icon="compass-outline"
                  variant="ghost"
                  onPress={() => scrollToId('kesfet')}
                />
              </View>

              <View style={styles.heroMeta}>
                <View style={styles.heroMetaItem}>
                  <Ionicons name="phone-portrait-outline" size={14} color="#8494B4" />
                  <AppText variant="caption" color="#8494B4">
                    iOS · Android · Web
                  </AppText>
                </View>
                <View style={styles.heroMetaItem}>
                  <Ionicons name="shield-checkmark-outline" size={14} color="#8494B4" />
                  <AppText variant="caption" color="#8494B4">
                    13+ güvenli topluluk
                  </AppText>
                </View>
                <View style={styles.heroMetaItem}>
                  <Ionicons name="people-outline" size={14} color="#8494B4" />
                  <AppText variant="caption" color="#8494B4">
                    Tek hesap, tek topluluk
                  </AppText>
                </View>
              </View>
            </View>

            {desktop ? (
              <View style={styles.heroVisual}>
                <HeroShowcase />
              </View>
            ) : (
              <View style={styles.heroVisualMobile}>
                <HeroShowcase />
              </View>
            )}
          </View>
        </View>

        {/* SOSYAL */}
        <View nativeID="kesfet" style={[styles.section, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.sectionInner, desktop ? styles.twoColumn : null]}>
            <View style={styles.columnCopy}>
              <SectionHeading
                eyebrow="SOSYAL DÜNYA"
                title={social?.title ?? 'Sosyal Dünyanı Keşfet'}
                description={
                  social?.body ??
                  "Trabzon'un nabzı tek akışta. Fotoğraf ve video paylaş, hikâyelerini anlat, yorumlarla sohbete katıl."
                }
              />
              <BulletList items={socialItems} />
              <Pressable
                onPress={() => router.push('/explore' as Href)}
                style={({ pressed }) => [styles.textLink, { opacity: pressed ? 0.6 : 1 }]}
              >
                <AppText variant="bodyStrong" color="primaryDeep">
                  Keşfet akışını gör
                </AppText>
                <Ionicons name="arrow-forward" size={16} color={theme.colors.primaryDeep} />
              </Pressable>
            </View>
            <View style={styles.columnVisual}>
              <View style={styles.visualHalo}>
                <LinearGradient
                  colors={['rgba(65,105,245,0.2)', 'rgba(128,87,244,0.06)', 'transparent']}
                  style={StyleSheet.absoluteFill}
                />
              </View>
              <FeedPhone />
            </View>
          </View>
        </View>

        {/* REELS */}
        <View nativeID="reels" style={styles.darkSection}>
          <LinearGradient
            colors={['#070C18', '#0B1530', '#0A0F1F']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.sectionInner, desktop ? [styles.twoColumn, styles.rowReverse] : null]}>
            <View style={[styles.columnVisual, styles.visualCenter]}>
              <ReelsPhone />
            </View>
            <View style={styles.columnCopy}>
              <SectionHeading
                eyebrow="REELS"
                title={reels?.title ?? 'Her An Bir Hikâye.'}
                description={
                  reels?.body ??
                  'Kısa videoları kaydırarak keşfet; beğen, yorumla ve paylaş. Videolar sessiz başlar, ses kontrolü sende.'
                }
              />
              <BulletList items={reelsItems} dark />
              <View style={styles.noteRow}>
                <Ionicons name="volume-mute-outline" size={15} color="#9DB6FF" />
                <AppText variant="caption" color="#9DB6FF" style={styles.flex}>
                  Otomatik oynatılan videolar sessiz başlar; sesi sen açarsın.
                </AppText>
              </View>
            </View>
          </View>
        </View>

        {/* MARKETPLACE */}
        <View nativeID="marketplace" style={[styles.section, { backgroundColor: theme.colors.surfaceMuted }]}>
          <View style={styles.sectionInner}>
            <SectionHeading
              eyebrow="MARKETPLACE"
              title={marketplace?.title ?? "Trabzon'da Aradığın Her Şey."}
              description={
                marketplace?.body ??
                "İkinci el ürünlerden araçlara, emlakten yerel hizmetlere kadar şehrin pazar yeri. İlan ver, favorine ekle ve satıcıyla güvenle iletişime geç."
              }
              align="center"
            />
            <View style={styles.marketGrid}>
              {MARKET_TILES.map((tile) => (
                <MarketplaceTile key={tile.label} icon={tile.icon} label={tile.label} accent={tile.accent} />
              ))}
            </View>
            <View style={styles.photoRow}>
              {[
                { photo: webPhotos.market, label: 'Yerel ürünler' },
                { photo: webPhotos.feed3, label: 'Şehirden kareler' },
                { photo: webPhotos.estate, label: 'Emlak ve konut' },
              ].map((item) => (
                <View key={item.label} style={styles.photoCard}>
                  <Image
                    source={item.photo}
                    style={styles.photo}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={item.label}
                  />
                  <View style={styles.photoCaption}>
                    <AppText variant="caption" color="#FFFFFF" style={styles.photoCaptionText}>
                      {item.label}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.marketFooter}>
              <BulletList items={marketItems} />
              <Pressable
                onPress={() => router.push('/marketplace' as Href)}
                style={({ pressed }) => [
                  styles.marketButton,
                  { backgroundColor: theme.colors.primaryDeep, opacity: pressed ? 0.82 : 1 },
                ]}
              >
                <AppText variant="bodyStrong" color="onPrimary">
                  Marketplace&apos;e Git
                </AppText>
                <Ionicons name="arrow-forward" size={16} color={theme.colors.onPrimary} />
              </Pressable>
            </View>
            <AppText variant="caption" color="textTertiary" align="center" style={styles.marketNote}>
              Platform içi ödeme altyapısı etkin değildir; sipariş talepleri satıcıyla iletişim
              kurulmasını sağlar.
            </AppText>
          </View>
        </View>

        {/* MAP */}
        <View nativeID="harita" style={[styles.section, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.sectionInner, desktop ? styles.twoColumn : null]}>
            <View style={styles.columnCopy}>
              <SectionHeading
                eyebrow="HARİTA"
                title={map?.title ?? "Trabzon'u Yeniden Keşfet."}
                description={
                  map?.body ??
                  "Restoranlar, oteller, kafeler, işletmeler, kiralık evler ve gezilecek yerler. Yakınındaki fırsatları gör ve yerini kaydet."
                }
              />
              <BulletList items={mapItems} />
              <View style={styles.noteRowLight}>
                <Ionicons name="information-circle-outline" size={15} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textTertiary" style={styles.flex}>
                  Harita görünümü önizlemedir. Kesin konum yalnızca izin verdiğinde kullanılır.
                </AppText>
              </View>
            </View>
            <View style={[styles.columnVisual, styles.mapVisual]}>
              <MapPreview />
            </View>
          </View>
        </View>

        {/* MESSAGING */}
        <View style={[styles.section, { backgroundColor: theme.colors.surfaceMuted }]}>
          <View style={[styles.sectionInner, desktop ? [styles.twoColumn, styles.rowReverse] : null]}>
            <View style={[styles.columnVisual, styles.visualCenter]}>
              <ChatPhone />
            </View>
            <View style={styles.columnCopy}>
              <SectionHeading
                eyebrow="MESAJLAŞMA"
                title={messaging?.title ?? 'Bağlantıda Kal.'}
                description={
                  messaging?.body ??
                  'Birebir mesajlaş, fotoğraf ve video paylaş. İstemediğin kişileri engelle, bildirimlerini yönet ve sohbetlerini kontrol altında tut.'
                }
              />
              <BulletList items={messagingItems} />
              <View style={styles.privacyRow}>
                <Ionicons name="lock-closed-outline" size={15} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textTertiary" style={styles.flex}>
                  Mesajlar yalnızca sohbet katılımcıları tarafından okunabilir.
                </AppText>
              </View>
            </View>
          </View>
        </View>

        {/* SECURITY */}
        <View style={styles.securitySection}>
          <LinearGradient
            colors={['#081228', '#0B1730', '#070C18']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.sectionInner}>
            <View style={styles.securityHead}>
              <View style={styles.securityCopy}>
                <SectionHeading
                  eyebrow="GÜVENLİK"
                  title={security?.title ?? 'Güvenli Bir Topluluk.'}
                  description={
                    security?.body ??
                    'Şikâyet et, engelle, içerik moderasyonunu gör. Çocuk güvenliği ve gizlilik tercihleri senin kontrolünde.'
                  }
                />
              </View>
              <Pressable
                onPress={() => router.push('/child-safety' as Href)}
                style={({ pressed }) => [styles.securityLink, { opacity: pressed ? 0.72 : 1 }]}
              >
                <Ionicons name="shield-checkmark" size={16} color="#9DB6FF" />
                <AppText variant="caption" color="#DCE6FF">
                  Çocuk Koruma Politikası
                </AppText>
                <Ionicons name="arrow-forward" size={14} color="#9DB6FF" />
              </Pressable>
            </View>

            <View style={styles.securityGrid}>
              {securityItems.map((item, index) => {
                const icons: (keyof typeof Ionicons.glyphMap)[] = [
                  'flag-outline',
                  'ban-outline',
                  'eye-off-outline',
                  'shield-checkmark-outline',
                  'lock-closed-outline',
                  'settings-outline',
                ];
                return (
                  <View key={item} style={styles.securityCard}>
                    <View style={styles.securityIcon}>
                      <Ionicons name={icons[index % icons.length] ?? 'shield-outline'} size={18} color="#9DB6FF" />
                    </View>
                    <AppText variant="bodyStrong" color="#EAF0FF">
                      {item}
                    </AppText>
                  </View>
                );
              })}
            </View>

            <AppText variant="caption" color="#8494B4" style={styles.securityNote}>
              Güvenlik araçları platformda gerçekten bulunan özelliklerdir. Acil durumlarda 112 veya
              yetkili kolluk birimlerine başvurun.
            </AppText>
          </View>
        </View>

        {/* CTA */}
        <View style={[styles.section, { backgroundColor: theme.colors.background }]}>
          <View style={styles.sectionInner}>
            <View style={styles.ctaCard}>
              <LinearGradient
                colors={['#1A2F63', '#241B4D', '#0E1A36']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.ctaGlow} />
              <AppText variant="overline" color="#9DB6FF" align="center" style={styles.ctaEyebrow}>
                {brandName.toUpperCase()} · TEK HESAP
              </AppText>
              <AppText variant="display" color="#FFFFFF" align="center" style={styles.ctaTitle}>
                {cta?.title ?? "Şehrin dijital dünyasına katıl."}
              </AppText>
              <AppText variant="body" color="#B7C4DD" align="center" style={styles.ctaDescription}>
                {cta?.body ?? "Web'de keşfet, uygulamada paylaş. Tek hesap, tek topluluk."}
              </AppText>
              <View style={styles.ctaActions}>
                <HeroButton
                  label={
                    typeof cta?.payload?.primary_label === 'string'
                      ? cta.payload.primary_label
                      : 'Hemen Katıl'
                  }
                  icon="sparkles"
                  variant="primary"
                  onPress={() => router.push('/register' as Href)}
                />
                <HeroButton
                  label={
                    typeof cta?.payload?.secondary_label === 'string'
                      ? cta.payload.secondary_label
                      : 'Giriş Yap'
                  }
                  icon="log-in-outline"
                  variant="glass"
                  onPress={() => router.push('/login' as Href)}
                />
              </View>
              <View style={styles.ctaLinks}>
                <Pressable onPress={() => router.push('/support' as Href)}>
                  <AppText variant="caption" color="#9DB6FF">
                    Destek Merkezi
                  </AppText>
                </Pressable>
                <View style={styles.ctaDot} />
                <Pressable onPress={() => router.push('/contact' as Href)}>
                  <AppText variant="caption" color="#9DB6FF">
                    İletişim
                  </AppText>
                </Pressable>
                <View style={styles.ctaDot} />
                <Pressable onPress={() => router.push('/delete-account' as Href)}>
                  <AppText variant="caption" color="#9DB6FF">
                    Hesap Silme
                  </AppText>
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        <WebFooter />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  flex: { flex: 1 },

  hero: { overflow: 'hidden' },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // RN Web, stil içinde ölçü verilmezse görselin doğal boyutunu kullanır;
    // bu yüzden genişlik/yükseklik açıkça yüzde olarak verilir.
    width: '100%',
    height: '100%',
  },
  heroInner: {
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 54,
    paddingBottom: 48,
    gap: 22,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', minHeight: 640 },
  heroColumn: { flexDirection: 'column' },
  heroCopy: { gap: 14, zIndex: 2 },
  heroCopyDesktop: { flex: 1, maxWidth: 620 },
  heroVisual: { flex: 1, minWidth: 440, height: 600 },
  heroVisualMobile: { height: 520, marginTop: 8 },
  heroGlow: {
    position: 'absolute',
    width: 620,
    height: 620,
    borderRadius: 310,
    top: -140,
    right: -110,
  },
  heroGrid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.5 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(120,150,220,0.05)' },
  gridLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(120,150,220,0.045)' },
  heroChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(65,105,245,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(100,140,240,0.28)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4AD295' },
  heroChipText: { fontSize: 10, letterSpacing: 1.1 },
  wordmarkWrap: { marginTop: 2 },
  heroSlogan: { fontFamily: undefined, letterSpacing: -0.4, maxWidth: 560 },
  heroDescription: { maxWidth: 510, lineHeight: 24, fontSize: 15.5 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 18,
    height: 50,
    overflow: 'hidden',
  },
  heroButtonPrimary: { minWidth: 150 },
  heroButtonGlass: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(170,195,245,0.26)',
  },
  heroButtonGhost: { backgroundColor: 'transparent' },
  heroButtonLabel: { fontSize: 14 },
  heroMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 10 },
  heroMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  section: { paddingVertical: 76 },
  darkSection: { paddingVertical: 76, overflow: 'hidden' },
  sectionInner: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    paddingHorizontal: 24,
    gap: 30,
  },
  twoColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 54,
  },
  rowReverse: { flexDirection: 'row-reverse' },
  columnCopy: { flex: 1, minWidth: 280, gap: 18 },
  columnVisual: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: 280 },
  visualCenter: { alignItems: 'center' },
  visualHalo: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    overflow: 'hidden',
  },
  sectionHeading: { gap: 11, maxWidth: 560 },
  headingCenter: { alignSelf: 'center', alignItems: 'center' },
  eyebrowPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  eyebrowText: { fontSize: 10, letterSpacing: 1.1 },
  sectionTitle: { fontSize: 36, lineHeight: 44, letterSpacing: -0.7 },
  sectionDescription: { fontSize: 15.5, lineHeight: 25 },
  textCenter: { textAlign: 'center' },
  bullets: { gap: 10, marginTop: 4 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  bulletIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  textLink: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  noteRowLight: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },

  marketGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginTop: 4 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  photoCard: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 180,
    height: 168,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(12,20,38,0.6)',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(6,10,20,0.62)',
  },
  photoCaptionText: { fontSize: 11.5, letterSpacing: 0.2 },
  marketFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20 },
  marketButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  marketNote: { lineHeight: 18 },

  mapVisual: { minHeight: 340 },
  securitySection: { paddingVertical: 76, overflow: 'hidden' },
  securityHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18 },
  securityCopy: { flex: 1, minWidth: 280 },
  securityLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(130,160,225,0.28)',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  securityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  securityCard: {
    flexGrow: 1,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(13,23,44,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(120,150,220,0.18)',
    borderRadius: 14,
    padding: 14,
  },
  securityIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(65,105,245,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  securityNote: { lineHeight: 18 },

  ctaCard: {
    overflow: 'hidden',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(140,170,235,0.2)',
    paddingHorizontal: 26,
    paddingVertical: 44,
    gap: 12,
    alignItems: 'center',
  },
  ctaGlow: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(128,87,244,0.18)',
    top: -190,
    right: -80,
  },
  ctaEyebrow: { fontSize: 10, letterSpacing: 1.4 },
  ctaTitle: { fontSize: 32, lineHeight: 40, letterSpacing: -0.6, maxWidth: 620 },
  ctaDescription: { maxWidth: 520, lineHeight: 24 },
  ctaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  ctaLinks: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  ctaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(157,182,255,0.5)' },
});
