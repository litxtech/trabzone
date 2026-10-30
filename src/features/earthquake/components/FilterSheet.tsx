import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';

import { useEarthquakeFilterStore } from '../store';
import type { EarthquakeBootstrap, EarthquakeRegion, EarthquakeSourceFilter } from '../types';
import { REGION_DESCRIPTIONS, REGION_LABELS } from '../utils/format';
import { MAGNITUDE_BUCKETS, RANGE_PRESETS, type MagnitudeBucket, type RangePreset } from '../utils/scale';
import { BottomSheet, ChipRow } from './parts';

const SOURCE_OPTIONS: { key: EarthquakeSourceFilter; label: string }[] = [
  { key: 'all', label: 'Tüm kaynaklar' },
  { key: 'afad', label: 'AFAD kaydı olan' },
  { key: 'usgs', label: 'USGS kaydı olan' },
];

export function regionOptions(bootstrap: EarthquakeBootstrap | undefined): { key: EarthquakeRegion; label: string }[] {
  const radii = new Set(bootstrap?.settings.radius_options ?? [50, 100, 150, 250]);
  const options: { key: EarthquakeRegion; label: string }[] = [{ key: 'province', label: REGION_LABELS.province }];
  (['r50', 'r100', 'r150', 'r250'] as const).forEach((key) => {
    if (radii.has(Number(key.slice(1)))) options.push({ key, label: REGION_LABELS[key] });
  });
  if (bootstrap?.settings.turkey_enabled ?? true) options.push({ key: 'turkey', label: REGION_LABELS.turkey });
  return options;
}

export function filterSummary(
  region: EarthquakeRegion,
  districtName: string | null,
  range: RangePreset,
  bucket: MagnitudeBucket,
): string {
  const parts = [districtName ? `${districtName} ilçesi` : REGION_LABELS[region]];
  parts.push(range === 'custom' ? 'Özel aralık' : RANGE_PRESETS.find((p) => p.key === range)?.label ?? '');
  if (bucket !== 'all') parts.push(`Büyüklük ${MAGNITUDE_BUCKETS.find((b) => b.key === bucket)?.label}`);
  return parts.join(' · ');
}

export function FilterSheet({
  visible,
  onClose,
  bootstrap,
  region,
  showSource = true,
  showRange = true,
}: {
  visible: boolean;
  onClose: () => void;
  bootstrap: EarthquakeBootstrap | undefined;
  region: EarthquakeRegion;
  showSource?: boolean;
  showRange?: boolean;
}) {
  const store = useEarthquakeFilterStore();
  const districts = bootstrap?.settings.district_filter_enabled ? bootstrap.districts : [];

  return (
    <BottomSheet visible={visible} title="Filtreler" onClose={onClose}>
      <View style={styles.group}>
        <AppText variant="label">Bölge</AppText>
        <ChipRow
          label="Bölge seçimi"
          options={regionOptions(bootstrap)}
          value={store.district ? 'province' : region}
          onChange={(key) => store.setRegion(key)}
        />
        <AppText variant="caption" color="textTertiary">
          {REGION_DESCRIPTIONS[region]}
        </AppText>
      </View>

      {districts.length > 0 ? (
        <View style={styles.group}>
          <AppText variant="label">İlçe</AppText>
          <ChipRow
            label="İlçe seçimi"
            options={[{ key: '', label: 'Tüm il' }, ...districts.map((d) => ({ key: d.key, label: d.name }))]}
            value={store.district ?? ''}
            onChange={(key) => store.setDistrict(key || null)}
          />
          <AppText variant="caption" color="textTertiary">
            İlçe yalnızca merkez üssü ilçe sınırı içindeyse atanır; deniz açığındaki depremler ilçeye atanmaz.
          </AppText>
        </View>
      ) : null}

      {showRange ? (
        <View style={styles.group}>
          <AppText variant="label">Zaman aralığı</AppText>
          <ChipRow
            label="Zaman aralığı"
            options={RANGE_PRESETS.map((p) => ({ key: p.key, label: p.label }))}
            value={store.range === 'custom' ? '7d' : store.range}
            onChange={(key) => store.setRange(key)}
          />
        </View>
      ) : null}

      <View style={styles.group}>
        <AppText variant="label">Büyüklük</AppText>
        <ChipRow
          label="Büyüklük aralığı"
          options={MAGNITUDE_BUCKETS.map((b) => ({ key: b.key, label: b.label }))}
          value={store.bucket}
          onChange={(key) => store.setBucket(key)}
        />
      </View>

      {showSource ? (
        <View style={styles.group}>
          <AppText variant="label">Kaynak</AppText>
          <ChipRow label="Veri kaynağı" options={SOURCE_OPTIONS} value={store.source} onChange={(key) => store.setSource(key)} />
          <AppText variant="caption" color="textTertiary">
            Seçilen kaynakta kaydı bulunan depremler gösterilir. AFAD birincil kaynaktır; değerler AFAD kaydından gelir.
          </AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button label="Sıfırla" variant="outline" onPress={() => store.reset()} style={styles.flex} />
        <Button label="Uygula" onPress={onClose} style={styles.flex} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
});
