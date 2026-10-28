import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText } from '@/components/ui';
import { authLinkHref } from '@/features/auth/use-require-auth';
import { publicMediaUrl } from '@/features/media/media-service';
import { WebFooter } from '@/features/web/components/WebFooter';
import { WebHeader } from '@/features/web/components/WebHeader';
import { flatStyle } from '@/features/web/link-style';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useAuthStatus } from '@/stores/auth-store';

import { fetchHubPage } from '../service';
import type { HubItem, HubLink, HubPage } from '../types';

const WEB_POINTER =
  Platform.OS === 'web' ? ({ cursor: 'pointer' } as unknown as object) : null;

const SECTION_LABELS: Record<string, string> = {
  'is-ilanlari': 'İş İlanları',
  emlak: 'Emlak İlanları',
  araclar: 'Araç İlanları',
  'ikinci-el': 'İkinci El Ürünler',
  isletmeler: 'İşletmeler ve Mekânlar',
  'turizm-konaklama': 'Konaklama',
  'ustalar-hizmetler': 'Ustalar ve Hizmetler',
  'telefon-tablet': 'Telefon ve Tablet',
  'bilgisayar-donanim': 'Bilgisayar ve Donanım',
  'elektronik-tv-ses-oyun': 'Elektronik ve Oyun',
  'mobilya-dekorasyon': 'Mobilya ve Dekorasyon',
  'beyaz-esya': 'Beyaz Eşya',
  'yoresel-urunler': 'Yöresel Ürünler',
  'tarim-hayvancilik': 'Tarım ve Hayvancılık',
};

const SECTION_SHORT_LABELS: Record<string, string> = {
  'is-ilanlari': 'İş İlanları',
  emlak: 'Emlak',
  araclar: 'Araçlar',
  'ikinci-el': 'İkinci El',
  isletmeler: 'İşletmeler',
  'turizm-konaklama': 'Konaklama',
  'ustalar-hizmetler': 'Ustalar',
  'telefon-tablet': 'Telefon',
  'bilgisayar-donanim': 'Bilgisayar',
  'elektronik-tv-ses-oyun': 'Elektronik',
  'mobilya-dekorasyon': 'Mobilya',
  'beyaz-esya': 'Beyaz Eşya',
  'yoresel-urunler': 'Yöresel Ürünler',
  'tarim-hayvancilik': 'Tarım',
};

const TITLE_ORDER = [
  'is-ilanlari',
  'emlak',
  'ikinci-el',
  'araclar',
  'isletmeler',
  'telefon-tablet',
  'bilgisayar-donanim',
  'mobilya-dekorasyon',
  'beyaz-esya',
  'yoresel-urunler',
  'ustalar-hizmetler',
  'turizm-konaklama',
];

const PRICE_SUFFIX: Record<string, string> = {
  total: '',
  month: ' / ay',
  hour: ' / saat',
  service: '',
};

function sectionLabel(slug: string | undefined, fallback: string | undefined) {
  if (!slug) {
    return fallback || '';
  }
  return SECTION_LABELS[slug] || fallback || slug;
}

function joinTurkish(parts: string[]) {
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts.slice(0, -1).join(', ')} ve ${parts[parts.length - 1]}`;
}

function cityLabels(page: HubPage) {
  const bySlug = new Map((page.sections || []).map((section) => [section.slug, section]));
  const labels: string[] = [];
  for (const slug of TITLE_ORDER) {
    const section = bySlug.get(slug);
    if (!section) {
      continue;
    }
    const label = SECTION_SHORT_LABELS[slug] || section.name;
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels.slice(0, 3);
}

function hubMeta(page: HubPage) {
  const area = page.district?.name || 'Trabzon';
  const label =
    page.category?.name ||
    sectionLabel(page.section?.slug, page.section?.name) ||
    'İlanlar';
  const unit = page.mode === 'places' ? 'İşletme' : 'İlan';
  const overview = page.mode === 'city' || page.mode === 'district';
  const total = Number(page.total || 0);
  const labels = overview ? cityLabels(page) : [];

  const h1 = overview
    ? `${area} ${labels.length > 0 ? joinTurkish(labels) : 'İlanları ve İşletmeleri'}`
    : `${area} ${label}`;

  let title = overview
    ? `${area} ${labels.length > 0 ? joinTurkish(labels) : 'İlanları ve İşletmeleri'} | Trabzone`
    : `${area} ${label} — ${total} ${unit} | Trabzone`;
  if (title.length > 64) {
    if (overview && labels.length > 1) {
      title = `${area} ${joinTurkish(labels.slice(0, 2))} | Trabzone`;
    } else {
      title = `${area} ${label} | Trabzone`;
    }
  }

  const topDistricts = (page.districts || []).slice(0, 3).map((district) => district.name);
  const districtSentence =
    topDistricts.length >= 2
      ? page.district
        ? ` Diğer ilçeler: ${topDistricts.join(', ')}.`
        : ` En çok ilan: ${topDistricts.join(', ')}.`
      : '';
  const description = overview
    ? `${area} genelinde ${total} güncel ilan ve işletme kaydı. İlçe ve kategoriye göre keşfedin.`
    : `${area} ${label.toLocaleLowerCase('tr-TR')} — ${total} güncel ${
        page.mode === 'places' ? 'işletme kaydı' : 'ilan'
      }.${districtSentence} Fiyat, konum ve iletişim bilgilerini inceleyin.`;

  return { area, label, h1, title, description: description.slice(0, 158) };
}

function formatPrice(item: HubItem) {
  if (item.price_cents == null) {
    return null;
  }
  const amount = Number(item.price_cents) / 100;
  try {
    return `${new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: item.currency || 'TRY',
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount)}${PRICE_SUFFIX[item.price_period || 'total'] ?? ''}`;
  } catch {
    return `${amount.toFixed(0)} ${item.currency || 'TRY'}`;
  }
}

function itemMeta(page: HubPage, item: HubItem) {
  const bits: string[] = [];
  if (page.mode === 'places') {
    if (item.category_name) bits.push(item.category_name);
    if (item.district) bits.push(item.district);
    if (Number(item.review_count || 0) > 0 && item.rating != null) {
      bits.push(`${Number(item.rating).toFixed(1)} · ${item.review_count} yorum`);
    }
    return bits.join(' · ');
  }
  const price = formatPrice(item);
  if (price) bits.push(price);
  if (page.mode === 'real_estate') {
    if (item.room_count != null) bits.push(`${item.room_count} oda`);
    if (item.gross_m2 != null) bits.push(`${item.gross_m2} m²`);
  }
  if (item.district) bits.push(item.district);
  return bits.join(' · ');
}

function itemBadge(page: HubPage, item: HubItem) {
  if (page.mode === 'places') {
    return item.is_verified ? 'Doğrulanmış' : null;
  }
  if (page.mode === 'real_estate') {
    return item.listing_kind === 'rent'
      ? 'Kiralık'
      : item.listing_kind === 'sale'
        ? 'Satılık'
        : item.listing_kind === 'transfer'
          ? 'Devren'
          : null;
  }
  if (item.condition === 'new') {
    return 'Sıfır';
  }
  return item.condition ? 'İkinci El' : null;
}

function itemImage(page: HubPage, item: HubItem) {
  const bucket =
    page.mode === 'places'
      ? 'place-media'
      : page.mode === 'real_estate'
        ? 'real-estate-media'
        : 'listing-images';
  return publicMediaUrl(bucket, item.cover_path);
}

function Chip({ link }: { link: HubLink }) {
  return (
    <Link href={link.url as Href} asChild style={flatStyle(styles.chip)}>
      <Pressable accessibilityRole="link" style={styles.chip}>
        <AppText variant="label" color="#DCE6FF">
          {link.name}
        </AppText>
        <View style={styles.chipCount}>
          <AppText variant="caption" color="#9DB6FF">
            {link.count}
          </AppText>
        </View>
      </Pressable>
    </Link>
  );
}

function Chips({ title, links }: { title: string; links: HubLink[] }) {
  if (!links || links.length === 0) {
    return null;
  }
  return (
    <View style={styles.group}>
      <AppText variant="h2" color="#FFFFFF">
        {title}
      </AppText>
      <View style={styles.chipWrap}>
        {links.map((link) => (
          <Chip key={`${title}-${link.slug}`} link={link} />
        ))}
      </View>
    </View>
  );
}

function Card({ page, item, width }: { page: HubPage; item: HubItem; width: string }) {
  const image = itemImage(page, item);
  const meta = itemMeta(page, item);
  const badge = itemBadge(page, item);
  const status = useAuthStatus();
  // Ilan detayi oturum gerektirir. Oturum yoksa giris formuna `next` ile
  // gidilir; giris sonrasi ayni ilan acilir.
  const href = authLinkHref(item.url, status);

  return (
    <Link href={href} asChild style={flatStyle([styles.card, { width }])}>
      <Pressable accessibilityRole="link" style={flatStyle([styles.card, { width }])}>
        <View style={styles.cardMedia}>
          {image ? (
            <Image source={{ uri: image }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={styles.cardPlaceholder}>
              <Ionicons name="image-outline" size={26} color="#5C6C90" />
            </View>
          )}
          {badge ? (
            <View style={styles.badge}>
              <AppText variant="caption" color="#DCE6FF">
                {badge}
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.cardBody}>
          <AppText variant="title" color="#F4F7FF" numberOfLines={2}>
            {item.title}
          </AppText>
          {meta ? (
            <AppText variant="caption" color="#93A4C7" numberOfLines={2}>
              {meta}
            </AppText>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

export function HubScreen({ segments }: { segments: string[] }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState<HubPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const segmentsKey = segments.join('/');
  const web = Platform.OS === 'web';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPage(null);

    fetchHubPage(segments, 24)
      .then((result) => {
        if (!active) return;
        setPage(result);
      })
      .catch(() => {
        if (!active) return;
        setError('Bu sayfa şu anda yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentsKey, reloadKey]);

  const meta = useMemo(
    () =>
      page
        ? hubMeta(page)
        : {
            area: 'Trabzon',
            label: '',
            h1: 'Trabzon',
            title: 'Trabzon | Trabzone',
            description: 'Trabzon ilanları ve yerel işletmeler Trabzone’da.',
          },
    [page],
  );

  useWebMeta({
    title: meta.title,
    description: meta.description,
    path: page?.path ?? '/trabzon',
    noIndex: !loading && !page,
  });

  const cardWidth =
    width >= 1100 ? '23.5%' : width >= 820 ? '31.8%' : width >= 560 ? '48.2%' : '100%';

  const sectionTitle = page?.mode === 'places' ? 'İşletmeler' : 'Son eklenen ilanlar';

  return (
    <View style={styles.root}>
      {web ? <WebHeader /> : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {!web ? (
          <View style={styles.nativeTop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Geri"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={20} color="#DCE6FF" />
            </Pressable>
            <AppText variant="title" color="#FFFFFF">
              Trabzone
            </AppText>
          </View>
        ) : null}

        <View style={styles.hero}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(98,132,255,0.32)', 'rgba(128,87,244,0.14)', 'rgba(5,8,15,0)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroInner}>
            <AppText variant="overline" color="#8FA6E8">
              {meta.area.toLocaleUpperCase('tr-TR')} · TRABZONE REHBERİ
            </AppText>
            <AppText variant="display" color="#FFFFFF" style={styles.heroTitle}>
              {loading ? 'Yükleniyor…' : meta.h1}
            </AppText>
            {page ? (
              <>
                <AppText variant="body" color="#B9C7E6" style={styles.heroLede}>
                  {page.mode === 'city' || page.mode === 'district'
                    ? `${meta.area} genelinde ${page.total} yayınlanmış ilan ve işletme kaydı. İlçe ve kategori bağlantılarıyla aradığınızı daraltın.`
                    : page.mode === 'places'
                      ? `${meta.area} genelinde ${page.total} işletme kaydı listeleniyor. Adres, puan ve yorumlarla keşfedin.`
                      : `${meta.area} genelinde ${meta.label.toLocaleLowerCase('tr-TR')} için ${page.total} güncel ilan listeleniyor. Fiyat, konum ve iletişim bilgilerini inceleyin.`}
                </AppText>
                <View style={styles.heroStats}>
                  <View style={styles.statPill}>
                    <Ionicons name="layers-outline" size={15} color="#8FA6E8" />
                    <AppText variant="caption" color="#DCE6FF">
                      {page.total} {page.mode === 'places' ? 'işletme' : 'ilan'}
                    </AppText>
                  </View>
                  {page.districts.length > 0 ? (
                    <View style={styles.statPill}>
                      <Ionicons name="location-outline" size={15} color="#8FA6E8" />
                      <AppText variant="caption" color="#DCE6FF">
                        {page.districts.length} ilçe
                      </AppText>
                    </View>
                  ) : null}
                  {page.categories.length > 0 ? (
                    <View style={styles.statPill}>
                      <Ionicons name="pricetags-outline" size={15} color="#8FA6E8" />
                      <AppText variant="caption" color="#DCE6FF">
                        {page.categories.length} kategori
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}

            <View style={styles.heroActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/marketplace' as Href)}
                style={({ pressed }) => [styles.primaryCta, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Ionicons name="storefront-outline" size={17} color="#08111F" />
                <AppText variant="button" color="#08111F">
                  Marketplace
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/marketplace/create' as Href)}
                style={({ pressed }) => [styles.ghostCta, { opacity: pressed ? 0.75 : 1 }]}
              >
                <Ionicons name="add-circle-outline" size={17} color="#DCE6FF" />
                <AppText variant="button" color="#DCE6FF">
                  İlan Ver
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {loading ? (
            <View style={styles.state}>
              <ActivityIndicator color="#8AA4FF" />
              <AppText variant="body" color="#93A4C7">
                İlanlar getiriliyor…
              </AppText>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <Ionicons name="cloud-offline-outline" size={30} color="#93A4C7" />
              <AppText variant="body" color="#DCE6FF" align="center">
                {error}
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => setReloadKey((value) => value + 1)}
                style={styles.retryButton}
              >
                <AppText variant="button" color="#08111F">
                  Yeniden dene
                </AppText>
              </Pressable>
            </View>
          ) : !page ? (
            <View style={styles.state}>
              <Ionicons name="search-outline" size={32} color="#93A4C7" />
              <AppText variant="h2" color="#FFFFFF" align="center">
                Bu sayfada henüz yayınlanmış ilan yok
              </AppText>
              <AppText variant="body" color="#93A4C7" align="center">
                {meta.area} için bu kategoride ilan bulunmuyor. Boş sonuç sayfalarını arama
                motorlarına sunmuyoruz; aşağıdaki bağlantılardan güncel ilanlara ulaşabilirsiniz.
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/trabzon' as Href)}
                style={styles.retryButton}
              >
                <AppText variant="button" color="#08111F">
                  Trabzon sayfasına dön
                </AppText>
              </Pressable>
            </View>
          ) : (
            <>
              <Chips title="Bölümler" links={page.sections} />
              <Chips title="Kategoriler" links={page.categories} />

              {page.items.length > 0 ? (
                <View style={styles.group}>
                  <View style={styles.groupHead}>
                    <AppText variant="h2" color="#FFFFFF">
                      {sectionTitle}
                    </AppText>
                    <AppText variant="caption" color="#93A4C7">
                      {page.total} kayıt
                    </AppText>
                  </View>
                  <View style={styles.grid}>
                    {page.items.map((item) => (
                      <Card key={item.id} page={page} item={item} width={cardWidth} />
                    ))}
                  </View>
                </View>
              ) : null}

              <Chips title={page.district ? 'Diğer ilçeler' : 'İlçeler'} links={page.districts} />

              <View style={styles.note}>
                <Ionicons name="information-circle-outline" size={18} color="#8FA6E8" />
                <AppText variant="caption" color="#93A4C7" style={styles.noteText}>
                  Yalnızca gerçek ilan bulunan ilçe ve kategoriler listelenir. Boş sonuç
                  sayfaları oluşturulmaz; böylece aradığınızda güncel içerik bulursunuz.
                </AppText>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {web ? <WebFooter /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05080F' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  nativeTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(160,185,240,0.22)',
  },
  hero: { overflow: 'hidden', borderBottomWidth: 1, borderBottomColor: 'rgba(120,150,220,0.14)' },
  heroInner: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 40,
    paddingBottom: 34,
    gap: 13,
  },
  heroTitle: { fontSize: 38, lineHeight: 44, letterSpacing: -0.9 },
  heroLede: { maxWidth: 760, lineHeight: 24 },
  heroStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(140,170,235,0.24)',
    backgroundColor: 'rgba(16,26,48,0.65)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 17,
    paddingVertical: 11,
    ...(WEB_POINTER ?? {}),
  },
  ghostCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(160,185,240,0.26)',
    borderRadius: 999,
    paddingHorizontal: 17,
    paddingVertical: 11,
    ...(WEB_POINTER ?? {}),
  },
  body: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 30,
    paddingBottom: 48,
    gap: 30,
  },
  group: { gap: 12 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: 'rgba(140,170,235,0.22)',
    backgroundColor: 'rgba(15,23,42,0.7)',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
    ...(WEB_POINTER ?? {}),
  },
  chipCount: {
    borderRadius: 999,
    backgroundColor: 'rgba(98,132,255,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(120,150,220,0.18)',
    backgroundColor: '#0B1222',
    ...(WEB_POINTER ?? {}),
  },
  cardMedia: { position: 'relative' },
  cardImage: { width: '100%', height: 158, backgroundColor: '#111A2E' },
  cardPlaceholder: {
    width: '100%',
    height: 158,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111A2E',
  },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: 'rgba(8,17,31,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(160,185,240,0.28)',
  },
  cardBody: { padding: 12, gap: 5 },
  state: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 56 },
  retryButton: {
    marginTop: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    ...(WEB_POINTER ?? {}),
  },
  note: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    borderTopWidth: 1,
    borderTopColor: 'rgba(120,150,220,0.14)',
    paddingTop: 18,
  },
  noteText: { flex: 1, lineHeight: 18 },
});
