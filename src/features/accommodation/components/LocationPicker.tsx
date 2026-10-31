import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { PropertyLocationOption } from '../services/accommodation-service';
import { Chip, InlineError, ModalSheet } from './AccommodationUI';

export type LocationSelection = {
  districtId: number | null;
  district: string;
  neighborhoodId: number | null;
  neighborhood: string;
  lat: number | null;
  lng: number | null;
};

type Props = {
  districts: PropertyLocationOption[];
  districtId: number | null;
  district: string;
  neighborhoodId: number | null;
  neighborhood: string;
  loading?: boolean;
  errorMessage?: string | null;
  /** Form doğrulamasından gelen kırmızı uyarı (ilçe seçilmediğinde). */
  validationError?: string | null;
  onRetry?: () => void;
  onChange: (next: LocationSelection) => void;
};

/**
 * Tesis formunun ilçe/mahalle seçimi.
 *
 * Serbest metin yerine aranabilir bir liste sunar: 18 ilçe tek satırda
 * kaybolmasın diye arama kutusu, seçili ilçenin mahalleleri de ikinci adımda
 * çip olarak gösterilir. Liste hiç gelmezse kullanıcı ilçe adını elle yazıp
 * yine de taslağı kaydedebilir.
 */
export function LocationPicker({
  districts,
  districtId,
  district,
  neighborhoodId,
  neighborhood,
  loading = false,
  errorMessage = null,
  validationError = null,
  onRetry,
  onChange,
}: Props) {
  const { theme } = useTheme();
  const [districtOpen, setDistrictOpen] = useState(false);
  const [neighborhoodOpen, setNeighborhoodOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => districts.find((item) => item.id === districtId) ?? null,
    [districts, districtId],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    if (!needle) return districts;
    return districts.filter((item) => item.name.toLocaleLowerCase('tr-TR').includes(needle));
  }, [districts, query]);

  const manual = query.trim();
  const canUseManual =
    manual.length >= 2 &&
    !districts.some((item) => item.name.toLocaleLowerCase('tr-TR') === manual.toLocaleLowerCase('tr-TR'));

  const closeDistrict = () => {
    setDistrictOpen(false);
    setQuery('');
  };

  const pickDistrict = (next: { id: number | null; name: string; lat?: number | null; lng?: number | null }) => {
    onChange({
      districtId: next.id,
      district: next.name,
      neighborhoodId: null,
      neighborhood: '',
      lat: typeof next.lat === 'number' ? next.lat : null,
      lng: typeof next.lng === 'number' ? next.lng : null,
    });
    closeDistrict();
  };

  const pickNeighborhood = (id: number | null, name: string) => {
    onChange({
      districtId,
      district,
      neighborhoodId: id,
      neighborhood: name,
      lat: null,
      lng: null,
    });
    setNeighborhoodOpen(false);
  };

  const neighborhoods = selected?.neighborhoods ?? [];

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <AppText variant="label" color={validationError ? 'danger' : 'textSecondary'}>
          İlçe *
        </AppText>
        {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`İlçe: ${district || 'seçilmedi'}`}
        onPress={() => setDistrictOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: theme.colors.inputBackground,
            borderColor: validationError
              ? theme.colors.danger
              : errorMessage
                ? theme.colors.danger
                : theme.colors.border,
            borderWidth: validationError ? 1.5 : 1,
            borderRadius: theme.radius.md,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons
          name={district ? 'location' : 'location-outline'}
          size={18}
          color={district ? theme.colors.primary : theme.colors.textTertiary}
        />
        <AppText variant="body" color={district ? 'text' : 'textTertiary'} style={styles.flex} numberOfLines={1}>
          {district || 'İlçe seç'}
        </AppText>
        <View style={[styles.mark, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="chevron-down" size={14} color={theme.colors.primaryDeep} />
        </View>
      </Pressable>

      {validationError ? (
        <View style={styles.validationRow}>
          <Ionicons name="alert-circle" size={13} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            {validationError}
          </AppText>
        </View>
      ) : null}

      {errorMessage ? (
        <AppText variant="caption" color="danger">
          {errorMessage}
        </AppText>
      ) : null}

      {selected && neighborhoods.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mahalle: ${neighborhood || 'seçilmedi'}`}
          onPress={() => setNeighborhoodOpen(true)}
          style={({ pressed }) => [
            styles.field,
            {
              backgroundColor: theme.colors.inputBackground,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="map-outline" size={18} color={theme.colors.textTertiary} />
          <AppText variant="body" color={neighborhood ? 'text' : 'textTertiary'} style={styles.flex} numberOfLines={1}>
            {neighborhood || 'Mahalle (opsiyonel)'}
          </AppText>
          <Ionicons name="chevron-down" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      ) : null}

      {!selected && district && !loading ? (
        <AppText variant="caption" color="textTertiary">
          Kayıtlı listede olmayan ilçe adı kullanılıyor.
        </AppText>
      ) : null}

      <ModalSheet
        visible={districtOpen}
        onClose={closeDistrict}
        title="İlçe seç"
        subtitle="Trabzon"
        maxWidth={560}
        footer={
          canUseManual ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${manual} adıyla kaydet`}
              onPress={() => pickDistrict({ id: null, name: manual })}
              style={({ pressed }) => [
                styles.manual,
                {
                  borderColor: theme.colors.primary,
                  backgroundColor: theme.colors.primarySoft,
                  borderRadius: theme.radius.md,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name="create-outline" size={16} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep">
                Listede yok: “{manual}” olarak kaydet
              </AppText>
            </Pressable>
          ) : null
        }
      >
        <TextField
          placeholder="İlçe ara"
          value={query}
          onChangeText={setQuery}
          leftIcon="search-outline"
          autoCorrect={false}
          returnKeyType="search"
        />

        {errorMessage && onRetry ? <InlineError message={errorMessage} onRetry={onRetry} /> : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
            <AppText variant="caption" color="textTertiary">
              İlçeler yükleniyor…
            </AppText>
          </View>
        ) : filtered.length === 0 ? (
          <AppText variant="caption" color="textTertiary" align="center" style={styles.empty}>
            {manual
              ? 'Eşleşen ilçe yok. Aşağıdaki “listede yok” seçeneğini kullanabilirsin.'
              : 'İlçe listesi boş görünüyor. İlçe adını arayarak elle ekleyebilirsin.'}
          </AppText>
        ) : (
          <View style={styles.list}>
            {filtered.map((item) => {
              const active = item.id === districtId;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={item.name}
                  onPress={() => pickDistrict(item)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: active
                        ? theme.colors.primarySoft
                        : pressed
                          ? theme.colors.surfaceMuted
                          : 'transparent',
                      borderRadius: theme.radius.sm,
                    },
                  ]}
                >
                  <Ionicons
                    name={active ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={active ? theme.colors.primary : theme.colors.textTertiary}
                  />
                  <AppText variant="body" color={active ? 'primaryDeep' : 'text'} style={styles.flex}>
                    {item.name}
                  </AppText>
                  {item.neighborhoods.length > 0 ? (
                    <AppText variant="caption" color="textTertiary">
                      {item.neighborhoods.length} mahalle
                    </AppText>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ModalSheet>

      <ModalSheet
        visible={neighborhoodOpen}
        onClose={() => setNeighborhoodOpen(false)}
        title="Mahalle seç"
        subtitle={district || undefined}
        maxWidth={560}
        footer={
          <Chip label="Mahalle seçme" active={!neighborhoodId} onPress={() => pickNeighborhood(null, '')} />
        }
      >
        <View style={styles.amenities}>
          {neighborhoods.map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              active={item.id === neighborhoodId}
              onPress={() => pickNeighborhood(item.id, item.name)}
            />
          ))}
        </View>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  flex: { flex: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  mark: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 13 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 26 },
  empty: { paddingVertical: 22 },
  manual: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1 },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  validationRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
