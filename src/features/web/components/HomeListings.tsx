import { Ionicons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { authLinkHref } from '@/features/auth/use-require-auth';
import { publicMediaUrl } from '@/features/media/media-service';
import { fetchHubPage } from '@/features/seo-hubs/service';
import type { HubItem, HubPage } from '@/features/seo-hubs/types';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import { flatStyle } from '../link-style';

const WEB_POINTER =
  Platform.OS === 'web' ? ({ cursor: 'pointer' } as unknown as object) : null;

type Entry = { page: HubPage; item: HubItem };

const PRICE_SUFFIX: Record<string, string> = {
  total: '',
  month: ' / ay',
  hour: ' / saat',
  service: '',
};

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

function cardMeta(page: HubPage, item: HubItem) {
  const bits: string[] = [];
  if (page.mode === 'real_estate') {
    const kind =
      item.listing_kind === 'rent' ? 'Kiralık' : item.listing_kind === 'sale' ? 'Satılık' : null;
    if (kind) {
      bits.push(kind);
    }
    if (item.room_count != null) {
      bits.push(`${item.room_count} oda`);
    }
  }
  const price = formatPrice(item);
  if (price) {
    bits.push(price);
  }
  if (item.district) {
    bits.push(item.district);
  }
  return bits.join(' · ');
}

function itemImage(page: HubPage, item: HubItem) {
  const bucket = page.mode === 'real_estate' ? 'real-estate-media' : 'listing-images';
  return publicMediaUrl(bucket, item.cover_path);
}

/**
 * Ana sayfadaki "Güncel ilanlar" şeridi.
 *
 * İlanlar yalnızca gerçekten yayında kayıt varsa gösterilir. Karta tıklandığında
 * oturum varsa ilan açılır; yoksa giriş formuna `next` ile gidilir ve giriş
 * sonrası ilan açılır.
 */
export function HomeListings() {
  const status = useAuthStatus();
  const { theme } = useTheme();
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    let active = true;

    Promise.all([
      fetchHubPage([], 4).catch(() => null),
      fetchHubPage(['emlak'], 4).catch(() => null),
    ]).then(([latest, realEstate]) => {
      if (!active) {
        return;
      }
      const merged: Entry[] = [];
      for (const page of [realEstate, latest]) {
        if (!page) {
          continue;
        }
        for (const item of page.items) {
          if (!merged.some((entry) => entry.item.id === item.id)) {
            merged.push({ page, item });
          }
        }
      }
      setEntries(merged.slice(0, 8));
    });

    return () => {
      active = false;
    };
  }, []);

  const header = useMemo(
    () => (
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <AppText variant="h2" color={theme.colors.text}>
            Güncel ilanlar
          </AppText>
          <AppText variant="caption" color="textSecondary">
            Yayındaki ilanlar ve işletmeler · Trabzon
          </AppText>
        </View>
        <Link href={'/trabzon' as Href} asChild style={flatStyle(styles.allLink)}>
          <Pressable accessibilityRole="link" style={styles.allLink}>
            <AppText variant="caption" color="primaryDeep">
              Tümünü gör
            </AppText>
            <Ionicons name="arrow-forward" size={14} color={theme.colors.primaryDeep} />
          </Pressable>
        </Link>
      </View>
    ),
    [theme.colors.primaryDeep, theme.colors.text],
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <View style={styles.root}>
      {header}
      <View style={styles.grid}>
        {entries.map(({ page, item }) => {
          const image = itemImage(page, item);
          const meta = cardMeta(page, item);
          return (
            <Link
              key={`${page.mode}-${item.id}`}
              href={authLinkHref(item.url, status)}
              asChild
              style={flatStyle(styles.card)}
            >
              <Pressable accessibilityRole="link" style={styles.card}>
                {image ? (
                  <Image
                    source={{ uri: image }}
                    style={styles.media}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[styles.media, styles.mediaPlaceholder]}>
                    <Ionicons name="image-outline" size={22} color="rgba(200,215,255,0.45)" />
                  </View>
                )}
                <View style={styles.body}>
                  <AppText variant="bodyStrong" color="#F4F7FF" numberOfLines={2}>
                    {item.title}
                  </AppText>
                  {meta ? (
                    <AppText variant="caption" color="#93A4C7" numberOfLines={1}>
                      {meta}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14, marginTop: 6 },
  head: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  headCopy: { gap: 3 },
  allLink: { flexDirection: 'row', alignItems: 'center', gap: 5, ...(WEB_POINTER ?? {}) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    flexGrow: 1,
    flexBasis: 208,
    minWidth: 168,
    maxWidth: 290,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0B1222',
    borderWidth: 1,
    borderColor: 'rgba(120,150,220,0.18)',
    ...(WEB_POINTER ?? {}),
  },
  media: { width: '100%', height: 132, backgroundColor: '#111A2E' },
  mediaPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: 11, gap: 4 },
});
