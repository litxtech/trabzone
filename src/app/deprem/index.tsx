import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, IconButton } from '@/components/ui';
import { BinChart, TimeSeriesChart } from '@/features/earthquake/components/Charts';
import { EarthquakeMapPanel } from '@/features/earthquake/components/EarthquakeMapPanel';
import { EqPage } from '@/features/earthquake/components/EqPage';
import { FilterSheet, filterSummary, regionOptions } from '@/features/earthquake/components/FilterSheet';
import {
  BottomSheet,
  ChipRow,
  DataStatusBar,
  EarthquakeRow,
  EmptyState,
  InfoNote,
  MagnitudeBadge,
  ScaleLegend,
  SectionTitle,
  SummaryCard,
} from '@/features/earthquake/components/parts';
import {
  useEarthquakeAnalytics,
  useEarthquakeBootstrap,
  useEarthquakeFeed,
  useEarthquakeFilters,
  useEarthquakeMap,
  useEarthquakeOverview,
  useEarthquakeRealtime,
} from '@/features/earthquake/hooks/use-earthquake';
import { useRegionGeometry } from '@/features/earthquake/hooks/use-region-geometry';
import { useEarthquakeFilterStore } from '@/features/earthquake/store';
import type { EarthquakeBootstrap, EarthquakeEvent, EarthquakeOrder } from '@/features/earthquake/types';
import {
  formatAgo,
  formatDepth,
  formatDistance,
  formatLocalDate,
  formatLocalDateTime,
  formatMagnitude,
  placeLabel,
  sourceLine,
} from '@/features/earthquake/utils/format';
import { MAGNITUDE_BUCKETS, magnitudeColor } from '@/features/earthquake/utils/scale';
import { openUrl } from '@/features/in-app-browser';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

const ORDER_OPTIONS: { key: EarthquakeOrder; label: string }[] = [
  { key: 'newest', label: 'En yeni' },
  { key: 'largest', label: 'En büyük' },
  { key: 'nearest', label: 'Trabzon’a en yakın' },
];

const HERO_GRADIENT = ['#0B1020', '#16224A', '#24357A'] as const;
const SOS_GRADIENT = ['#F05252', '#C81E1E'] as const;

const HEALTH_LABEL = {
  unknown: 'Henüz okunmadı',
  healthy: 'Çalışıyor',
  degraded: 'Sorunlu',
  down: 'Erişilemiyor',
  disabled: 'Devre dışı',
} as const;

export default function EarthquakeCenterScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [filterOpen, setFilterOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lng: number; nonce: number } | null>(null);

  useWebMeta({
    title: 'Trabzon Deprem Merkezi | Son Depremler ve Deprem Haritası',
    description:
      'Trabzon ve çevresindeki son depremler: AFAD verileriyle canlı deprem listesi, harita, büyüklük ve derinlik grafikleri.',
    path: '/deprem',
  });

  useEarthquakeRealtime();
  const bootstrap = useEarthquakeBootstrap();
  const filters = useEarthquakeFilters();
  const store = useEarthquakeFilterStore();
  const overview = useEarthquakeOverview(filters, bootstrap.isSuccess);
  const map = useEarthquakeMap(filters, bootstrap.isSuccess);
  const feed = useEarthquakeFeed(filters, store.order, 20, bootstrap.isSuccess);
  const analytics = useEarthquakeAnalytics(filters, bootstrap.isSuccess);
  const geometry = useRegionGeometry(bootstrap.data, filters.regionResolved, filters.district);

  const items = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);
  const total = feed.data?.pages[0]?.total ?? null;
  const status = overview.data?.status ?? bootstrap.data?.status;
  const districtName = filters.district
    ? bootstrap.data?.districts.find((d) => d.key === filters.district)?.name ?? null
    : null;
  const unavailable = status?.state === 'unavailable';
  const overviewFailed = overview.isError && !overview.data;

  const open = (id: string) => router.push(`/deprem/${id}` as never);
  const latest = overview.data?.latest_event ?? null;
  const largest = overview.data?.max_event ?? null;

  const actions = (
    <View style={styles.actions}>
      <IconButton
        name="notifications-outline"
        accessibilityLabel="Deprem bildirim ayarları"
        variant="soft"
        onPress={() => router.push('/deprem/bildirimler' as never)}
      />
      <IconButton name="options-outline" accessibilityLabel="Filtreler" variant="soft" onPress={() => setFilterOpen(true)} />
      <IconButton
        name="information-circle-outline"
        accessibilityLabel="Veri kaynakları hakkında"
        variant="soft"
        onPress={() => setInfoOpen(true)}
      />
    </View>
  );

  if (bootstrap.isError && !bootstrap.data) {
    return (
      <EqPage title="Deprem Merkezi" subtitle="Trabzon ve çevresindeki deprem hareketleri" fallbackHref="/">
        <EmptyState
          icon="cloud-offline-outline"
          title="Deprem verileri yüklenemedi"
          body="Bağlantınızı kontrol edip tekrar deneyin. Bu ekranda veri alınamadığında sayı veya istatistik gösterilmez."
          action={<Button label="Tekrar dene" variant="outline" onPress={() => void bootstrap.refetch()} />}
        />
      </EqPage>
    );
  }

  return (
    <EqPage title="Deprem Merkezi" subtitle="Trabzon ve çevresindeki deprem hareketleri" right={actions} fallbackHref="/">
      {latest ? <LatestHero event={latest} live={status?.state === 'live'} onPress={() => open(latest.id)} /> : null}

      <DataStatusBar status={status} error={overview.isError && !status} />

      <View
        style={[
          styles.toolbar,
          theme.shadows.xs,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg },
        ]}
      >
        <ChipRow
          label="Bölge"
          options={regionOptions(bootstrap.data)}
          value={filters.district ? 'province' : filters.regionResolved}
          onChange={(key) => store.setRegion(key)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Filtre: ${filterSummary(filters.regionResolved, districtName, store.range, store.bucket)}. Değiştirmek için dokunun.`}
          onPress={() => setFilterOpen(true)}
          style={({ pressed }) => [
            styles.filterLine,
            { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Ionicons name="funnel-outline" size={14} color={theme.colors.primary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex} numberOfLines={1}>
            {filterSummary(filters.regionResolved, districtName, store.range, store.bucket)}
          </AppText>
          <AppText variant="label" color="primary">
            Değiştir
          </AppText>
        </Pressable>
      </View>

      <View style={styles.summary}>
        <SummaryCard
          icon="today-outline"
          label="Son 24 Saat"
          value={overviewFailed ? '—' : overview.data ? String(overview.data.count_24h) : '…'}
          hint={
            overviewFailed
              ? 'Alınamadı'
              : unavailable
                ? 'Kaynaklara ulaşılamıyor; sayı eksik olabilir'
                : overview.data
                  ? 'deprem kaydı'
                  : null
          }
          muted={overviewFailed}
        />
        <SummaryCard
          icon="trending-up-outline"
          label="En Büyük Deprem"
          value={
            overviewFailed ? '—' : largest ? formatMagnitude(largest.magnitude, largest.magnitude_type) : overview.data ? 'Kayıt yok' : '…'
          }
          hint={largest ? `${placeLabel(largest)} · ${formatLocalDate(largest.occurred_at)}` : overviewFailed ? 'Alınamadı' : 'Seçili aralıkta'}
          onPress={largest ? () => open(largest.id) : undefined}
          muted={!largest}
        />
        <SummaryCard
          icon="pulse-outline"
          label="Son Deprem"
          value={overviewFailed ? '—' : latest ? formatAgo(latest.occurred_at) : overview.data ? 'Kayıt yok' : '…'}
          hint={latest ? `${formatMagnitude(latest.magnitude, latest.magnitude_type)} · ${placeLabel(latest)}` : null}
          onPress={latest ? () => open(latest.id) : undefined}
          muted={!latest}
        />
        <SummaryCard
          icon="refresh-outline"
          label="Son Güncelleme"
          value={status ? formatAgo(status.last_success_at) : '—'}
          hint={status?.last_success_at ? formatLocalDateTime(status.last_success_at, true) : 'Henüz başarılı okuma yok'}
          muted={!status?.last_success_at}
        />
      </View>

      <SectionTitle
        title="Harita"
        action={
          map.data ? (
            <AppText variant="caption" color="textSecondary">
              {map.data.total} kayıt
            </AppText>
          ) : null
        }
      />
      <EarthquakeMapPanel
        points={map.data?.points ?? []}
        center={geometry.center}
        zoom={geometry.zoom}
        ring={geometry.ring}
        clusters={geometry.clusters}
        selectedId={store.selectedId}
        onSelect={store.select}
        onOpen={open}
        focusPoint={focusPoint}
        loading={map.isFetching && !map.data}
        truncated={map.data?.truncated}
        total={map.data?.total}
      />
      <ScaleLegend />

      <SectionTitle
        title="Son depremler"
        action={
          <Pressable accessibilityRole="link" onPress={() => router.push('/deprem/arsiv' as never)} hitSlop={8}>
            <AppText variant="label" color="primary">
              Arşiv
            </AppText>
          </Pressable>
        }
      />
      <ChipRow
        label="Büyüklük filtresi"
        options={MAGNITUDE_BUCKETS.map((b) => ({ key: b.key, label: b.label }))}
        value={store.bucket}
        onChange={store.setBucket}
      />
      <ChipRow label="Sıralama" options={ORDER_OPTIONS} value={store.order} onChange={store.setOrder} />

      {feed.isLoading ? (
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
      ) : feed.isError && items.length === 0 ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Liste alınamadı"
          body="Kayıtlar yüklenemedi. Bu bir veri yokluğu değildir; lütfen tekrar deneyin."
          action={<Button label="Tekrar dene" variant="outline" size="sm" onPress={() => void feed.refetch()} />}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="Bu filtrelerle kayıt yok"
          body={
            unavailable
              ? 'Kaynaklara şu anda ulaşılamadığı için liste eksik olabilir.'
              : 'Seçili bölge ve zaman aralığında kaynaklarda kayıtlı deprem bulunmuyor.'
          }
        />
      ) : (
        <View style={styles.list}>
          {items.map((event) => (
            <EarthquakeRow
              key={event.id}
              event={event}
              selected={store.selectedId === event.id}
              onPress={() => open(event.id)}
              onLocate={() => {
                store.select(event.id);
                setFocusPoint({ lat: event.latitude, lng: event.longitude, nonce: Date.now() });
              }}
            />
          ))}
          {feed.hasNextPage ? (
            <Button
              label={total != null ? `Daha fazla göster (${items.length}/${total})` : 'Daha fazla göster'}
              variant="outline"
              loading={feed.isFetchingNextPage}
              onPress={() => void feed.fetchNextPage()}
            />
          ) : null}
        </View>
      )}

      <SectionTitle
        title="İstatistikler"
        action={
          <Pressable accessibilityRole="link" onPress={() => router.push('/deprem/analiz' as never)} hitSlop={8}>
            <AppText variant="label" color="primary">
              Tüm grafikler
            </AppText>
          </Pressable>
        }
      />
      {analytics.data && analytics.data.total > 0 ? (
        <View
          style={[
            styles.card,
            theme.shadows.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.xl },
          ]}
        >
          <AppText variant="label">Zamana göre deprem sayısı</AppText>
          <TimeSeriesChart series={analytics.data.series} bucket={analytics.data.bucket} height={150} />
          <AppText variant="label">Büyüklük dağılımı</AppText>
          <BinChart
            bins={analytics.data.magnitude_bins}
            height={140}
            colorFor={(bin) => magnitudeColor(Number(bin.key.replace('m', '')) || 0)}
          />
        </View>
      ) : analytics.isError ? (
        <InfoNote icon="cloud-offline-outline">İstatistikler alınamadı. Veri yokken grafik üretilmez.</InfoNote>
      ) : analytics.data ? (
        <InfoNote>Seçili aralıkta grafik çizilecek kayıt yok.</InfoNote>
      ) : (
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
      )}

      <SectionTitle title="Güvenlik" />
      <View style={styles.safety}>
        <SafetyCard
          icon="shield-checkmark"
          title="Depremde Ne Yapmalıyım?"
          body="Öncesi, sırası ve sonrası için AFAD önerileri"
          colors={theme.gradients.primary}
          onPress={() => router.push('/deprem/guvenlik' as never)}
        />
        <SafetyCard
          icon="call"
          title="112 Acil Çağrı"
          body="Acil durumda doğrudan arayın"
          colors={SOS_GRADIENT}
          accessibilityLabel="112 Acil Çağrı Merkezi'ni ara"
          onPress={() => void Linking.openURL('tel:112')}
        />
      </View>

      <InfoNote icon="alert-circle-outline">
        Trabzone deprem tahmini yapmaz ve resmî erken uyarı hizmeti değildir. Kayıtlar AFAD (birincil) ve USGS
        kaynaklarından otomatik alınır; değerler kaynak tarafından güncellenebilir. Resmî açıklamalar için AFAD’ı takip
        edin.
      </InfoNote>

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        bootstrap={bootstrap.data}
        region={filters.regionResolved}
      />
      <SourcesSheet visible={infoOpen} onClose={() => setInfoOpen(false)} bootstrap={bootstrap.data} />
    </EqPage>
  );
}

function LiveDot({ active }: { active: boolean }) {
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const color = active ? '#3DD68C' : '#FBBF24';
  return (
    <View style={styles.liveDotWrap}>
      {active ? (
        <Animated.View
          style={[
            styles.liveHalo,
            {
              backgroundColor: color,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
            },
          ]}
        />
      ) : null}
      <View style={[styles.liveDot, { backgroundColor: color }]} />
    </View>
  );
}

function HeroPill({ icon, label }: { icon: ComponentProps<typeof Ionicons>['name']; label: string }) {
  return (
    <View style={styles.heroPill}>
      <Ionicons name={icon} size={13} color="rgba(255,255,255,0.85)" />
      <AppText variant="caption" color="#FFFFFF" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function LatestHero({ event, live, onPress }: { event: EarthquakeEvent; live: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  const place = placeLabel(event);
  const accent = magnitudeColor(event.magnitude);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Son deprem: ${formatMagnitude(event.magnitude, event.magnitude_type)}, ${place}, ${formatAgo(event.occurred_at)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.hero,
        theme.shadows.floating,
        {
          backgroundColor: HERO_GRADIENT[0],
          borderRadius: theme.radius.xl,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={[StyleSheet.absoluteFill, styles.heroClip, { borderRadius: theme.radius.xl }]}>
        <LinearGradient colors={HERO_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[styles.heroGlow, { backgroundColor: accent }]} />
      </View>

      <View style={styles.heroTop}>
        <LiveDot active={live} />
        <AppText variant="overline" color="rgba(255,255,255,0.75)" style={styles.flex}>
          Son deprem
        </AppText>
        <View style={styles.heroAgo}>
          <AppText variant="label" color="#FFFFFF">
            {formatAgo(event.occurred_at)}
          </AppText>
        </View>
      </View>

      <View style={styles.heroMain}>
        <MagnitudeBadge magnitude={event.magnitude} type={event.magnitude_type} size="lg" />
        <View style={styles.flex}>
          <AppText variant="h2" color="#FFFFFF" numberOfLines={2}>
            {place}
          </AppText>
          {event.location && event.location !== place ? (
            <AppText variant="caption" color="rgba(255,255,255,0.7)" numberOfLines={1}>
              {event.location}
            </AppText>
          ) : null}
        </View>
      </View>

      <View style={styles.heroPills}>
        <HeroPill icon="calendar-outline" label={formatLocalDateTime(event.occurred_at, true)} />
        <HeroPill icon="layers-outline" label={`Derinlik ${formatDepth(event.depth_km)}`} />
        <HeroPill icon="navigate-outline" label={`Trabzon’a ${formatDistance(event.distance_km)}`} />
      </View>

      <View style={styles.heroFoot}>
        <AppText variant="caption" color="rgba(255,255,255,0.6)" style={styles.flex} numberOfLines={1}>
          {sourceLine(event.source, event.sources)}
        </AppText>
        <AppText variant="label" color="#FFFFFF">
          Ayrıntılar
        </AppText>
        <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

function SafetyCard({
  icon,
  title,
  body,
  colors,
  onPress,
  accessibilityLabel,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  colors: readonly [string, string, ...string[]];
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.safetyCard,
        theme.shadows.card,
        {
          backgroundColor: colors[0],
          borderRadius: theme.radius.lg,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: theme.radius.lg }]}
      />
      <View style={styles.safetyIcon}>
        <Ionicons name={icon} size={20} color="#FFFFFF" />
      </View>
      <AppText variant="bodyStrong" color="#FFFFFF">
        {title}
      </AppText>
      <AppText variant="caption" color="rgba(255,255,255,0.82)">
        {body}
      </AppText>
    </Pressable>
  );
}

function SourcesSheet({
  visible,
  onClose,
  bootstrap,
}: {
  visible: boolean;
  onClose: () => void;
  bootstrap: EarthquakeBootstrap | undefined;
}) {
  const { theme } = useTheme();
  return (
    <BottomSheet visible={visible} title="Veri kaynakları" onClose={onClose}>
      {(bootstrap?.sources ?? []).map((source) => (
        <View
          key={source.key}
          style={[styles.sourceCard, { borderColor: theme.colors.border, borderRadius: theme.radius.md }]}
        >
          <View style={styles.sourceHead}>
            <AppText variant="bodyStrong" style={styles.flex}>
              {source.name}
            </AppText>
            <AppText variant="caption" color={source.is_primary ? 'primary' : 'textSecondary'}>
              {source.is_primary ? 'Birincil' : 'İkincil'}
            </AppText>
          </View>
          <AppText variant="caption" color="textSecondary">
            Durum: {source.is_enabled ? HEALTH_LABEL[source.health] : 'Devre dışı'} · Son başarılı okuma:{' '}
            {source.last_success_at ? formatAgo(source.last_success_at) : '—'}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {source.attribution}
          </AppText>
          <Pressable accessibilityRole="link" onPress={() => void openUrl(source.homepage_url)}>
            <AppText variant="caption" color="primary">
              {source.homepage_url}
            </AppText>
          </Pressable>
        </View>
      ))}
      <AppText variant="label">Nasıl çalışır?</AppText>
      <AppText variant="caption" color="textSecondary">
        Sunucu AFAD’ı yaklaşık dakikada bir, USGS’yi daha seyrek sorgular. Aynı depreme ait AFAD ve USGS kayıtları zaman,
        konum ve büyüklük yakınlığıyla eşleştirilir; tek kayıt olarak gösterilir ve AFAD değerleri tercih edilir. Yalnız
        USGS’de bulunan kayıtlar “Kaynak: USGS” olarak işaretlenir. Kaynaklar arasındaki büyüklük farkları ayrıntı
        sayfasında ayrı ayrı gösterilir.
      </AppText>
      {bootstrap?.coverage.archive_since ? (
        <AppText variant="caption" color="textSecondary">
          Arşiv kapsamı: {formatLocalDate(bootstrap.coverage.archive_since)} tarihinden itibaren alınan kayıtlar.
        </AppText>
      ) : null}
      {bootstrap?.boundary_attribution ? (
        <AppText variant="caption" color="textTertiary">
          {bootstrap.boundary_attribution}
        </AppText>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: 6 },
  toolbar: { padding: 10, gap: 8, borderWidth: StyleSheet.hairlineWidth },
  filterLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: 12 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  hero: { padding: 18, gap: 14 },
  heroClip: { overflow: 'hidden' },
  heroGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -90, right: -70, opacity: 0.28 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroAgo: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.14)',
  },
  liveDotWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  liveHalo: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  list: { gap: 10 },
  loader: { paddingVertical: 24 },
  card: { padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth },
  safety: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  safetyCard: { flexBasis: '47%', flexGrow: 1, minWidth: 150, padding: 16, gap: 6 },
  safetyIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 4,
  },
  sourceCard: { padding: 12, gap: 4, borderWidth: StyleSheet.hairlineWidth },
  sourceHead: { flexDirection: 'row', alignItems: 'center' },
});
