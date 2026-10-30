import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { DepthProfile } from '@/features/earthquake/components/DepthProfile';
import { EarthquakeMapPanel } from '@/features/earthquake/components/EarthquakeMapPanel';
import { EqPage } from '@/features/earthquake/components/EqPage';
import { EmptyState, InfoNote, MagnitudeBadge, SectionTitle } from '@/features/earthquake/components/parts';
import {
  useEarthquakeBootstrap,
  useEarthquakeDetail,
  useEarthquakeRealtime,
  useTrackEarthquakeView,
} from '@/features/earthquake/hooks/use-earthquake';
import type { EarthquakeDetail, EarthquakeRevision, EarthquakeSourceRecord } from '@/features/earthquake/types';
import {
  formatAgo,
  formatCoordinate,
  formatDecimal,
  formatDepth,
  formatDistance,
  formatLocalDateTime,
  formatMagnitude,
  formatUtcDateTime,
  placeLabel,
  SOURCE_LABELS,
  sourceLine,
} from '@/features/earthquake/utils/format';
import { earthquakeShareLink, siteBase } from '@/features/share/links';
import { openUrl } from '@/features/in-app-browser';
import { shareContent } from '@/features/share/share-action';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

const CLASS_LABELS: Record<EarthquakeDetail['region_classification'], string> = {
  trabzon_province: 'Trabzon il sınırı içinde',
  trabzon_offshore: 'Trabzon açıkları (il deniz alanı)',
  trabzon_vicinity: 'Trabzon çevresi (250 km içinde)',
  turkey: 'Türkiye ve çevresi',
  outside: 'İzleme bölgesi dışında',
};

const CHANGE_LABELS: Record<string, string> = {
  magnitude: 'Büyüklük',
  magnitude_type: 'Büyüklük türü',
  depth_km: 'Derinlik',
  latitude: 'Enlem',
  longitude: 'Boylam',
  occurred_at: 'Oluş zamanı',
  location: 'Merkez üssü koordinatı',
  location_description: 'Yer',
  preferred_source: 'Gösterilen kaynak',
  status: 'Durum',
};

function changeValue(key: string, value: unknown): string {
  if (value == null) return '—';
  if (key === 'magnitude') return formatDecimal(Number(value), 1);
  if (key === 'depth_km') return formatDepth(Number(value));
  if (key === 'latitude' || key === 'longitude') return formatCoordinate(Number(value));
  if (key === 'location' && Array.isArray(value)) {
    return `${formatCoordinate(Number(value[0]))}, ${formatCoordinate(Number(value[1]))}`;
  }
  if (key === 'occurred_at') return formatLocalDateTime(String(value), true);
  if (key === 'preferred_source') return SOURCE_LABELS[value as 'afad' | 'usgs'] ?? String(value);
  return String(value);
}

export default function EarthquakeDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const key = String(params.id ?? '').trim().toLowerCase();
  const detail = useEarthquakeDetail(key);
  const bootstrap = useEarthquakeBootstrap();
  const [copied, setCopied] = useState<'coords' | 'link' | null>(null);
  useEarthquakeRealtime();
  useTrackEarthquakeView(detail.data ? key : undefined);

  const event = detail.data;
  const title = event
    ? `${formatMagnitude(event.magnitude, event.magnitude_type)} Deprem – ${placeLabel(event)}`
    : 'Deprem Ayrıntıları';

  useWebMeta({
    title: event ? `${title} – ${formatLocalDateTime(event.occurred_at)} | Trabzone` : 'Deprem Ayrıntıları | Trabzone',
    description: event
      ? `${formatLocalDateTime(event.occurred_at, true)} (TSİ) tarihinde ${event.location ?? placeLabel(event)} merkezli ${formatMagnitude(
          event.magnitude,
          event.magnitude_type,
        )} büyüklüğünde deprem. Derinlik ${formatDepth(event.depth_km)}. ${sourceLine(event.source, event.sources)}.`
      : 'Deprem kaydının kaynak, zaman, konum, derinlik ve büyüklük ayrıntıları.',
    path: `/deprem/${key}`,
    type: 'article',
  });

  if (detail.isLoading) {
    return (
      <EqPage title="Deprem Ayrıntıları">
        <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
      </EqPage>
    );
  }

  if (!event) {
    const error = detail.error as { code?: string; message?: string } | null;
    const notFound = error?.code === 'not_found';
    return (
      <EqPage title="Deprem Ayrıntıları">
        <EmptyState
          icon={notFound ? 'search-outline' : 'cloud-offline-outline'}
          title={notFound ? 'Kayıt bulunamadı' : 'Kayıt yüklenemedi'}
          body={error?.message ?? 'Lütfen daha sonra tekrar deneyin.'}
          action={
            notFound ? (
              <Button label="Deprem Merkezi’ne dön" variant="outline" onPress={() => router.replace('/deprem' as never)} />
            ) : (
              <Button label="Tekrar dene" variant="outline" onPress={() => void detail.refetch()} />
            )
          }
        />
      </EqPage>
    );
  }

  const preferredRecord = event.records.find((record) => record.source === event.source) ?? event.records[0] ?? null;
  const officialUrl =
    preferredRecord?.url ?? bootstrap.data?.sources.find((source) => source.key === event.source)?.homepage_url ?? null;
  const coords = `${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`;

  const copyCoords = async () => {
    await Clipboard.setStringAsync(coords);
    setCopied('coords');
    setTimeout(() => setCopied(null), 2000);
  };

  const share = async () => {
    const url = Platform.OS === 'web' ? `${siteBase()}/deprem/${event.id}` : earthquakeShareLink(event.id);
    if (Platform.OS !== 'web') {
      await shareContent({
        title,
        message: `${title} · ${formatLocalDateTime(event.occurred_at, true)} · Derinlik ${formatDepth(event.depth_km)}`,
        url,
      });
      return;
    }
    await Clipboard.setStringAsync(url);
    setCopied('link');
    setTimeout(() => setCopied(null), 2000);
  };

  const rows: [string, string][] = [
    ['Yerel saat (TSİ)', formatLocalDateTime(event.occurred_at, true)],
    ['UTC', formatUtcDateTime(event.occurred_at)],
    ['Büyüklük', formatMagnitude(event.magnitude, event.magnitude_type)],
    ['Derinlik', formatDepth(event.depth_km)],
    ['Enlem / Boylam', `${formatCoordinate(event.latitude)}° K, ${formatCoordinate(event.longitude)}° D`],
    ['Trabzon merkezine uzaklık', formatDistance(event.distance_km)],
    ['Bölge', CLASS_LABELS[event.region_classification]],
  ];
  if (event.district_name) rows.push(['İlçe', `${event.district_name} (merkez üssü ilçe sınırı içinde)`]);
  if (event.source_province || event.source_district) {
    rows.push(['Kaynağın yer bilgisi', [event.source_district, event.source_province].filter(Boolean).join(', ')]);
  }
  rows.push(['Kaynak', sourceLine(event.source, event.sources).replace('Kaynak: ', '')]);
  rows.push(['Olay kimliği', event.id]);
  event.records.forEach((record) => rows.push([`${SOURCE_LABELS[record.source]} olay no`, record.source_event_id]));
  rows.push(['Kaynak güncelleme zamanı', event.source_updated_at ? formatLocalDateTime(event.source_updated_at, true) : 'Bildirilmedi']);
  rows.push(['Trabzone’a ulaşma', formatLocalDateTime(event.first_seen_at, true)]);
  rows.push(['Son kontrol', `${formatLocalDateTime(event.updated_at, true)} (${formatAgo(event.updated_at)})`]);

  return (
    <EqPage title="Deprem Ayrıntıları">
      <View style={[styles.hero, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg }]}>
        <MagnitudeBadge magnitude={event.magnitude} type={event.magnitude_type} size="lg" />
        <View style={styles.flex}>
          <AppText variant="h3" accessibilityRole="header">
            {placeLabel(event)}
          </AppText>
          {event.location && event.location !== placeLabel(event) ? (
            <AppText variant="body" color="textSecondary">
              {event.location}
            </AppText>
          ) : null}
          <AppText variant="caption" color="textSecondary">
            {formatLocalDateTime(event.occurred_at, true)} · {formatAgo(event.occurred_at)}
          </AppText>
          <View style={styles.badges}>
            <Badge label={sourceLine(event.source, event.sources)} tone="neutral" />
            {event.revision > 1 ? <Badge label={`Kaynak güncelledi (rev. ${event.revision})`} tone="warning" /> : null}
            {event.status === 'pending_match' ? <Badge label="Kaynak eşleştirmesi inceleniyor" tone="warning" /> : null}
          </View>
        </View>
      </View>

      <View style={styles.buttons}>
        <Button
          label={copied === 'coords' ? 'Kopyalandı' : 'Koordinatları kopyala'}
          variant="outline"
          size="sm"
          leftIcon={<Ionicons name="copy-outline" size={16} color={theme.colors.primary} />}
          onPress={() => void copyCoords()}
        />
        {officialUrl ? (
          <Button
            label={`Resmî kaydı aç (${SOURCE_LABELS[event.source]})`}
            variant="outline"
            size="sm"
            leftIcon={<Ionicons name="open-outline" size={16} color={theme.colors.primary} />}
            onPress={() => void openUrl(officialUrl)}
          />
        ) : null}
        <Button
          label={copied === 'link' ? 'Bağlantı kopyalandı' : 'Paylaş'}
          variant="outline"
          size="sm"
          leftIcon={<Ionicons name="share-outline" size={16} color={theme.colors.primary} />}
          onPress={() => void share()}
        />
      </View>

      <View style={[styles.table, { borderColor: theme.colors.border, borderRadius: theme.radius.md }]}>
        {rows.map(([label, value], index) => (
          <View
            key={`${label}-${index}`}
            style={[styles.tableRow, index > 0 ? { borderTopColor: theme.colors.divider, borderTopWidth: StyleSheet.hairlineWidth } : null]}
          >
            <AppText variant="caption" color="textSecondary" style={styles.tableLabel}>
              {label}
            </AppText>
            <AppText variant="body" style={styles.flex} selectable>
              {value}
            </AppText>
          </View>
        ))}
      </View>

      <SectionTitle title="Konum" />
      <EarthquakeMapPanel
        points={[
          {
            id: event.id,
            lat: event.latitude,
            lng: event.longitude,
            magnitude: event.magnitude,
            magnitudeType: event.magnitude_type,
            occurredAt: event.occurred_at,
            depthKm: event.depth_km,
            source: event.source,
            location: event.location,
            distanceKm: event.distance_km,
          },
        ]}
        center={{ lat: event.latitude, lng: event.longitude }}
        zoom={8}
        ring={
          bootstrap.data?.province_ring && event.distance_km < 250
            ? bootstrap.data.province_ring.map(([lat, lng]) => ({ lat, lng }))
            : null
        }
        clusters={false}
        selectedId={null}
        onSelect={() => undefined}
        onOpen={() => undefined}
        height={260}
      />

      <SectionTitle title="Odak derinliği" />
      <DepthProfile depthKm={event.depth_km} magnitude={event.magnitude} />

      {event.records.length > 0 ? (
        <>
          <SectionTitle title={event.records.length > 1 ? 'Kaynaklara göre ölçümler' : 'Kaynak kaydı'} />
          {event.records.length > 1 ? (
            <InfoNote>
              Aynı deprem farklı kurumlarca farklı yöntemlerle ölçülebilir. Gösterilen değerler{' '}
              {SOURCE_LABELS[event.source]} kaydından gelir; diğer ölçümler değiştirilmeden aşağıda listelenir.
            </InfoNote>
          ) : null}
          {event.records.map((record) => (
            <RecordCard key={`${record.source}-${record.source_event_id}`} record={record} preferred={record.source === event.source} />
          ))}
        </>
      ) : null}

      {event.revisions.length > 0 ? (
        <>
          <SectionTitle title="Güncelleme geçmişi" />
          {event.revisions.map((revision, index) => (
            <RevisionRow key={`${revision.created_at}-${index}`} revision={revision} />
          ))}
        </>
      ) : null}

      <InfoNote icon="alert-circle-outline">
        {event.attribution ?? 'Veriler AFAD ve USGS kaynaklarından alınmıştır.'} Değerler kaynak tarafından sonradan
        güncellenebilir. Trabzone resmî deprem bilgilendirme veya erken uyarı hizmeti değildir.
      </InfoNote>
    </EqPage>
  );
}

function RecordCard({ record, preferred }: { record: EarthquakeSourceRecord; preferred: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.record, { borderColor: preferred ? theme.colors.primary : theme.colors.border, borderRadius: theme.radius.md }]}>
      <View style={styles.recordHead}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {SOURCE_LABELS[record.source]} · {record.source_event_id}
        </AppText>
        {preferred ? <Badge label="Gösterilen" tone="primary" /> : null}
      </View>
      <AppText variant="body">
        {formatMagnitude(record.magnitude, record.magnitude_type)} · Derinlik {formatDepth(record.depth_km)}
      </AppText>
      <AppText variant="caption" color="textSecondary">
        {formatLocalDateTime(record.occurred_at, true)} · {formatCoordinate(record.latitude)}, {formatCoordinate(record.longitude)}
      </AppText>
      {record.location ? (
        <AppText variant="caption" color="textSecondary">
          {record.location}
        </AppText>
      ) : null}
      {record.match_method !== 'origin' && (record.match_dt_seconds != null || record.match_distance_km != null) ? (
        <AppText variant="caption" color="textTertiary">
          Eşleştirme ({record.match_method === 'admin' ? 'yönetici onaylı' : 'otomatik'}): zaman farkı{' '}
          {formatDecimal(record.match_dt_seconds, 1)} sn, konum farkı {formatDecimal(record.match_distance_km, 1)} km
        </AppText>
      ) : null}
      {record.revision > 1 ? (
        <AppText variant="caption" color="textTertiary">
          Kaynak revizyonu: {record.revision}
        </AppText>
      ) : null}
      {record.url ? (
        <AppText variant="caption" color="primary" onPress={() => void openUrl(record.url)} accessibilityRole="link">
          Kaynak sayfasını aç
        </AppText>
      ) : null}
    </View>
  );
}

function RevisionRow({ revision }: { revision: EarthquakeRevision }) {
  const { theme } = useTheme();
  const entries = Object.entries(revision.changes ?? {});
  return (
    <View style={[styles.revision, { borderLeftColor: revision.significant ? theme.colors.warning : theme.colors.border }]}>
      <AppText variant="caption" color="textSecondary">
        {formatLocalDateTime(revision.created_at, true)} ·{' '}
        {revision.kind === 'preferred_source' ? 'Gösterilen kaynak değişti' : `${revision.source ? SOURCE_LABELS[revision.source] : 'Kaynak'} güncellemesi`}
      </AppText>
      {entries.length === 0 ? (
        <AppText variant="caption" color="textTertiary">
          Değer değişikliği yok
        </AppText>
      ) : (
        entries.map(([field, change]) => (
          <AppText key={field} variant="caption">
            {CHANGE_LABELS[field] ?? field}: {changeValue(field, change.old)} → {changeValue(field, change.new)}
          </AppText>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { paddingVertical: 40 },
  hero: { flexDirection: 'row', gap: 14, padding: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  table: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  tableLabel: { width: 150 },
  record: { padding: 12, gap: 3, borderWidth: 1 },
  recordHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  revision: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 4, gap: 2 },
});
