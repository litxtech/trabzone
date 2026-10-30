import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Skeleton } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { PharmacyDutyNotice, PharmacyDutyStatus, PharmacySummary } from '../types';
import { formatDayMonth, formatHourMinute, staleNotice, todayLabelIstanbul } from '../utils/status';
import { PharmacyCard } from './PharmacyCard';

function minutesSince(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - ms) / 60_000));
}

/** "az önce", "12 dk önce", "2 sa 5 dk önce" */
function freshnessLabel(value: string | null | undefined) {
  const minutes = minutesSince(value);
  if (minutes == null) {
    return null;
  }
  if (minutes < 2) {
    return 'az önce güncellendi';
  }
  if (minutes < 60) {
    return `${minutes} dk önce güncellendi`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours} sa ${rest} dk önce güncellendi` : `${hours} sa önce güncellendi`;
  }
  return `${formatDayMonth(value)} tarihinde güncellendi`;
}

/**
 * "Bugün Nöbetçi Eczaneler" — ekranın tek bakışta okunan bölümü.
 *
 * Sayı ve cümle yalnızca doğrulanmış nöbet kaydından üretilir; kayıt yoksa
 * "0 nöbetçi" gibi yanlış bir ifade kurulmaz, listenin yayımlanmadığı söylenir.
 */
export function PharmacyDutyHighlight({
  notice,
  status,
  items,
  loading,
  onPressItem,
  onMapItem,
}: {
  notice: PharmacyDutyNotice | undefined;
  status?: PharmacyDutyStatus | undefined;
  items: PharmacySummary[];
  loading: boolean;
  onPressItem: (item: PharmacySummary) => void;
  onMapItem: (item: PharmacySummary) => void;
}) {
  const { theme } = useTheme();
  const count = notice?.count ?? 0;
  const liveCount = notice?.on_duty_now ?? 0;
  const window = notice?.items[0];
  const uniformWindow =
    notice?.items?.length
      ? notice.items.every(
          (item) => item.starts_at === window?.starts_at && item.ends_at === window?.ends_at,
        )
      : false;
  const fetchedAt = status?.last_fetched_at ?? notice?.last_fetched_at ?? null;
  const warning = staleNotice(Boolean(notice?.stale), notice?.stale_after_hours);
  const sourceName = status?.source.attribution ?? status?.source.name ?? 'Trabzon Eczacı Odası';

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.hero,
          theme.shadows.xs,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <View style={styles.heroTop}>
          <AppText variant="overline" color="textTertiary">
            BUGÜN NÖBETÇİ
          </AppText>
          {count > 0 ? (
            <View
              style={[
                styles.livePill,
                {
                  backgroundColor: theme.colors.successSoft,
                  borderColor: `${theme.colors.success}33`,
                },
              ]}
            >
              <View style={[styles.liveDot, { backgroundColor: theme.colors.success }]} />
              <AppText variant="caption" style={{ color: theme.colors.success, fontWeight: '700' }}>
                {liveCount > 0 ? 'ŞU AN AÇIK' : 'LİSTE HAZIR'}
              </AppText>
            </View>
          ) : null}
        </View>

        {count > 0 ? (
          <>
            <View style={styles.heroMain}>
              <AppText variant="display" style={styles.countText}>
                {count}
              </AppText>
              <View style={styles.heroMainText}>
                <AppText variant="title">eczane nöbetçi</AppText>
                <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                  {todayLabelIstanbul()}
                  {status?.districts ? ` · ${status.districts} ilçe` : ''}
                </AppText>
              </View>
            </View>

            {window ? (
              <View style={styles.windowRow}>
                <Ionicons name="moon-outline" size={13} color={theme.colors.primaryDeep} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  {uniformWindow
                    ? `Nöbet saatleri ${formatHourMinute(window.starts_at)} – ${formatHourMinute(window.ends_at)}`
                    : 'Nöbet saatleri ilçeye göre değişir'}
                  {liveCount > 0 ? ` · ${liveCount} eczane şu an nöbette` : ''}
                </AppText>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.emptyHero}>
            <AppText variant="h3" numberOfLines={2}>
              Nöbet listesi henüz yayımlanmadı
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {notice?.stale
                ? 'Kaynak güncellenmediği için bugünün listesi kesinleşmedi. Aşağıda tüm eczaneleri görebilirsin.'
                : 'Kaynak yayımlandığında bugünün nöbetçi eczaneleri burada, en üstte görünecek.'}
            </AppText>
          </View>
        )}

        <View style={[styles.heroFooter, { borderColor: theme.colors.divider }]}>
          <Ionicons name="shield-checkmark-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex} numberOfLines={1}>
            {sourceName}
            {freshnessLabel(fetchedAt) ? ` · ${freshnessLabel(fetchedAt)}` : ''}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Nöbetçi eczaneleri haritada gör"
            hitSlop={8}
            onPress={() => {
              const first = items.find((item) => item.lat != null && item.lng != null);
              if (first) {
                onMapItem(first);
              }
            }}
            style={styles.mapLink}
          >
            <Ionicons name="map-outline" size={13} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep" style={{ fontWeight: '700' }}>
              Harita
            </AppText>
          </Pressable>
        </View>
      </View>

      {warning ? (
        <View
          style={[
            styles.warning,
            { backgroundColor: theme.colors.warningSoft, borderColor: `${theme.colors.warning}33` },
          ]}
        >
          <Ionicons name="warning-outline" size={14} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            {warning}
          </AppText>
        </View>
      ) : null}

      {loading && !count
        ? [0, 1, 2].map((key) => <Skeleton key={key} height={150} radius={20} />)
        : items.map((item) => (
            <PharmacyCard
              key={item.id}
              item={item}
              variant="hero"
              onPress={() => onPressItem(item)}
              onMap={() => onMapItem(item)}
            />
          ))}

      {!loading && !count ? (
        <View style={[styles.empty, { borderColor: theme.colors.border }]}>
          <Ionicons name="information-circle-outline" size={16} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Bugün için yayımlanmış nöbet kaydı yok. &quot;Tüm eczaneler&quot; sekmesinden Trabzon
            genelindeki eczanelere bakabilirsin.
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** "Tüm eczaneler" görünümünde görünen, sakin ve kısa duyuru şeridi. */
export function PharmacyDutyNoticeBanner({
  notice,
  onPress,
}: {
  notice: PharmacyDutyNotice | undefined;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const hasData = Boolean(notice?.count) && !notice?.stale;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        hasData
          ? `Bugün nöbetçi ${notice?.count} eczane var. Nöbet listesini aç`
          : 'Nöbetçi eczane listesini aç'
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.banner,
        theme.shadows.xs,
        {
          backgroundColor: theme.colors.surface,
          borderColor: hasData ? `${theme.colors.success}33` : theme.colors.border,
          opacity: pressed ? 0.94 : 1,
          borderRadius: theme.radius.lg,
        },
      ]}
    >
      <View
        style={[
          styles.bannerIcon,
          { backgroundColor: hasData ? theme.colors.successSoft : theme.colors.primarySoft },
        ]}
      >
        <Ionicons
          name={hasData ? 'moon' : 'medkit-outline'}
          size={17}
          color={hasData ? theme.colors.success : theme.colors.primaryDeep}
        />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {hasData ? `Bugün ${notice?.count} eczane nöbetçi` : 'Nöbetçi eczane listesi'}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {hasData
            ? 'Nöbet saatleri, adres ve tek dokunuşla arama'
            : 'Kaynak yayımlandığında burada görünecek'}
        </AppText>
      </View>
      <Ionicons name="arrow-forward" size={16} color={theme.colors.primaryDeep} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  hero: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    padding: 16,
    gap: 10,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  countText: { lineHeight: 40 },
  heroMainText: { flex: 1, gap: 1 },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emptyHero: { gap: 4, paddingVertical: 4 },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
