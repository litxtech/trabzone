import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, IconButton, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  adFold,
  describeTarget,
  districtsForCity,
  formatPopulation,
  formatTargetLabel,
  searchCities,
} from '../locations';

export type LocationValue = { cities: string[]; districts: string[] };

type Props = {
  cities: string[];
  districts: string[];
  onChange: (value: LocationValue) => void;
  disabled?: boolean;
  /** Hedefleme kartı yerine daha kompakt bir alan (detay sayfası, yönlendirme). */
  title?: string;
  description?: string;
};

/**
 * Şehir + ilçe seçimi. Enlem/boylam yerine yalnızca yönetici dostu coğrafi
 * seçimler kullanılır; ilçe seçilmezse şehir geneli hedeflenir.
 */
export function LocationPicker({
  cities,
  districts,
  onChange,
  disabled,
  title = 'Yayın bölgesi',
  description = 'Reklamın hangi şehir ve ilçelerde gösterileceğini seç. İlçe seçmezsen seçili şehirdeki herkes görür.',
}: Props) {
  const { theme } = useTheme();
  const [cityOpen, setCityOpen] = useState(false);
  const [districtQuery, setDistrictQuery] = useState('');

  const catalogCities = useMemo(
    () => cities.filter((city) => districtsForCity(city).length > 0),
    [cities],
  );
  const availableDistricts = useMemo(() => {
    const seen = new Map<string, ReturnType<typeof districtsForCity>[number]>();
    for (const city of catalogCities) {
      for (const district of districtsForCity(city)) {
        if (!seen.has(adFold(district.name))) {
          seen.set(adFold(district.name), district);
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [catalogCities]);

  const filteredDistricts = useMemo(() => {
    const needle = districtQuery.trim().toLocaleLowerCase('tr-TR');
    if (!needle) {
      return availableDistricts;
    }
    return availableDistricts.filter((item) => item.name.toLocaleLowerCase('tr-TR').includes(needle));
  }, [availableDistricts, districtQuery]);

  const setCities = (nextCities: string[]) => {
    const allowed = new Set<string>();
    for (const city of nextCities) {
      for (const district of districtsForCity(city)) {
        allowed.add(adFold(district.name));
      }
    }
    onChange({
      cities: nextCities,
      districts: districts.filter((name) => allowed.has(adFold(name))),
    });
  };

  const toggleCity = (city: string) => {
    const exists = cities.some((item) => adFold(item) === adFold(city));
    setCities(exists ? cities.filter((item) => adFold(item) !== adFold(city)) : [...cities, city]);
  };

  const toggleDistrict = (district: string) => {
    const exists = districts.some((item) => adFold(item) === adFold(district));
    onChange({
      cities,
      districts: exists ? districts.filter((item) => adFold(item) !== adFold(district)) : [...districts, district],
    });
  };

  const summary = formatTargetLabel(cities, districts);
  const helper = describeTarget(cities, districts);
  const districtSummary =
    districts.length === 0
      ? 'Tüm ilçeler'
      : `${districts.length} ilçe · ${districts.join(', ')}`;

  return (
    <View style={[styles.wrap, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="location-outline" size={17} color={theme.colors.primaryDeep} />
        </View>
        <View style={styles.flex}>
          <AppText variant="label">{title}</AppText>
          <AppText variant="caption" color="textTertiary">
            {description}
          </AppText>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Şehir seç"
        disabled={disabled}
        onPress={() => setCityOpen(true)}
        style={({ pressed }) => [
          styles.selectRow,
          {
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.inputBackground,
            opacity: disabled ? 0.55 : pressed ? 0.75 : 1,
          },
        ]}
      >
        <Ionicons name="business-outline" size={16} color={theme.colors.textTertiary} />
        <View style={styles.flex}>
          <AppText variant="caption" color="textSecondary">
            Şehir
          </AppText>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {cities.length === 0 ? 'Tüm şehirler' : cities.join(', ')}
          </AppText>
        </View>
        <AppText variant="caption" color="primaryDeep">
          {cities.length === 0 ? 'Şehir seç' : 'Değiştir'}
        </AppText>
        <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
      </Pressable>

      {cities.length === 0 ? (
        <Hint
          icon="globe-outline"
          text="Şehir seçilmediği için reklam Türkiye genelinde gösterilir. Yerel kampanyalar için şehir seçmen önerilir."
        />
      ) : availableDistricts.length === 0 ? (
        <Hint
          icon="information-circle-outline"
          text={`${cities.join(', ')} için ilçe listesi henüz hazır değil. Kampanya şehir genelinde yayınlanır; ilçe kısıtı uygulanmaz.`}
        />
      ) : (
        <View style={styles.districtBlock}>
          <View style={styles.districtHead}>
            <View style={styles.flex}>
              <AppText variant="caption" color="textSecondary">
                İlçeler
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {catalogCities.join(', ')} içinde geçerli
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tüm ilçeleri seç"
              disabled={disabled}
              onPress={() => onChange({ cities, districts: [] })}
              style={[
                styles.allChip,
                {
                  borderColor: districts.length === 0 ? theme.colors.primary : theme.colors.border,
                  backgroundColor: districts.length === 0 ? theme.colors.primarySoft : 'transparent',
                },
              ]}
            >
              <Ionicons
                name={districts.length === 0 ? 'checkmark-circle' : 'ellipse-outline'}
                size={14}
                color={districts.length === 0 ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
              <AppText variant="caption" color={districts.length === 0 ? 'primaryDeep' : 'textSecondary'}>
                Tüm ilçeler
              </AppText>
            </Pressable>
          </View>

          {availableDistricts.length > 8 ? (
            <TextField
              value={districtQuery}
              onChangeText={setDistrictQuery}
              placeholder="İlçe ara"
              leftIcon="search-outline"
              editable={!disabled}
              autoCorrect={false}
            />
          ) : null}

          <View style={styles.districts}>
            {filteredDistricts.map((district) => {
              const active = districts.some((item) => adFold(item) === adFold(district.name));
              return (
                <Pressable
                  key={district.name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${district.name} ilçesi`}
                  disabled={disabled}
                  onPress={() => toggleDistrict(district.name)}
                  style={[
                    styles.district,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.inputBackground,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'primaryDeep' : 'text'}>
                    {district.name}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatPopulation(district.population)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {filteredDistricts.length === 0 ? (
            <AppText variant="caption" color="textTertiary">
              Bu aramaya uygun ilçe bulunamadı.
            </AppText>
          ) : null}
          <AppText variant="caption" color="textTertiary">
            {districtSummary}. Nüfus bilgisi yalnızca seçim kolaylığı içindir.
          </AppText>
        </View>
      )}

      <View style={[styles.summary, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name="navigate-outline" size={14} color={theme.colors.textSecondary} />
        <View style={styles.flex}>
          <AppText variant="caption" color="textSecondary">
            {summary}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {helper}
          </AppText>
        </View>
      </View>

      {cityOpen ? (
        <CityPickerModal
          value={cities}
          onToggle={toggleCity}
          onClear={() => setCities([])}
          onClose={() => setCityOpen(false)}
        />
      ) : null}
    </View>
  );
}

function Hint({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.hint, { backgroundColor: theme.colors.warningSoft }]}>
      <Ionicons name={icon} size={15} color={theme.colors.warning} />
      <AppText variant="caption" color="warning" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

function CityPickerModal({
  value,
  onToggle,
  onClear,
  onClose,
}: {
  value: string[];
  onToggle: (city: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const options = useMemo(() => searchCities(query), [query]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="h3">Şehir seç</AppText>
              <AppText variant="caption" color="textTertiary">
                Birden fazla şehir seçebilirsin. Hiç şehir seçmezsen reklam Türkiye genelinde yayınlanır.
              </AppText>
            </View>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>
          <View style={styles.panelBody}>
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder="Şehir ara"
              leftIcon="search-outline"
              autoCorrect={false}
            />
            <View style={styles.quickRow}>
              <Button
                label="Tüm şehirler"
                size="sm"
                variant={value.length === 0 ? 'primary' : 'secondary'}
                fullWidth={false}
                onPress={onClear}
              />
              <Button label="Kapat" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
            </View>
            <ScrollView style={styles.cityList} keyboardShouldPersistTaps="handled">
              {options.map((city) => {
                const active = value.some((item) => adFold(item) === adFold(city));
                const supported = districtsForCity(city).length > 0;
                return (
                  <Pressable
                    key={city}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${city} şehri${supported ? '' : ', ilçe listesi yakında'}`}
                    onPress={() => onToggle(city)}
                    style={({ pressed }) => [
                      styles.cityRow,
                      {
                        backgroundColor: pressed
                          ? theme.colors.surfaceMuted
                          : active
                            ? theme.colors.primarySoft
                            : 'transparent',
                      },
                    ]}
                  >
                    <Ionicons
                      name={active ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
                    />
                    <AppText variant="body" color={active ? 'primaryDeep' : 'text'} style={styles.flex}>
                      {city}
                    </AppText>
                    {supported ? (
                      <AppText variant="caption" color="textTertiary">
                        ilçe hedeflemesi açık
                      </AppText>
                    ) : null}
                  </Pressable>
                );
              })}
              {options.length === 0 ? (
                <AppText variant="caption" color="textTertiary" style={styles.empty}>
                  Bu isimde bir şehir bulunamadı.
                </AppText>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  selectRow: {
    minHeight: 54,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  districtBlock: { gap: 8 },
  districtHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  allChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  districts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  district: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    gap: 1,
    minWidth: 104,
  },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 9, borderRadius: 9 },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 9, borderRadius: 9 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  panel: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '88%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelHead: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelBody: { padding: 12, gap: 10, flexShrink: 1 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cityList: { maxHeight: 430 },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 9,
    paddingVertical: 11,
    borderRadius: 8,
  },
  empty: { paddingVertical: 18, textAlign: 'center' },
});
