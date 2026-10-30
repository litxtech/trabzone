import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';

import type { PublicFilters } from '../types';
import { todayIso } from '../utils/format';
import {
  Chip,
  ChipsRow,
  DateField,
  InfoBanner,
  ModalSheet,
  ToggleRow,
} from './AccommodationUI';

export type PublicSearchState = {
  propertyType: string | null;
  districtId: number | null;
  guests: number;
  checkIn: string | null;
  checkOut: string | null;
  minPrice: string;
  maxPrice: string;
  sort: 'recommended' | 'price_asc' | 'price_desc' | 'rating' | 'new';
  deals: boolean;
};

export const DEFAULT_SEARCH_STATE: PublicSearchState = {
  propertyType: null,
  districtId: null,
  guests: 2,
  checkIn: null,
  checkOut: null,
  minPrice: '',
  maxPrice: '',
  sort: 'recommended',
  deals: false,
};

const SORTS: { value: PublicSearchState['sort']; label: string }[] = [
  { value: 'recommended', label: 'Önerilen' },
  { value: 'price_asc', label: 'En düşük fiyat' },
  { value: 'price_desc', label: 'En yüksek fiyat' },
  { value: 'rating', label: 'En yüksek puan' },
  { value: 'new', label: 'Yeni eklenen' },
];

export function PublicFilterSheet({
  visible,
  onClose,
  filters,
  value,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  filters?: PublicFilters;
  value: PublicSearchState;
  onApply: (next: PublicSearchState) => void;
}) {
  const [draft, setDraft] = useState<PublicSearchState>(value);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) setDraft(value);
  }, [visible, value]);

  const patch = (next: Partial<PublicSearchState>) => setDraft((current) => ({ ...current, ...next }));

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Konaklama filtreleri"
      subtitle="Tesis türü, tarih, kişi ve fiyat aralığı"
      footer={
        <View style={styles.footer}>
          <Button
            label="Temizle"
            variant="outline"
            onPress={() => setDraft({ ...DEFAULT_SEARCH_STATE })}
            style={styles.flex}
          />
          <Button
            label="Sonuçları göster"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
            style={styles.flex}
          />
        </View>
      }
    >
      <AppText variant="bodyStrong">Tesis türü</AppText>
      <ChipsRow>
        <Chip label="Tümü" active={!draft.propertyType} onPress={() => patch({ propertyType: null })} />
        {(filters?.types ?? []).map((type) => (
          <Chip
            key={type.key}
            label={type.label}
            active={draft.propertyType === type.key}
            onPress={() => patch({ propertyType: type.key })}
          />
        ))}
      </ChipsRow>

      <DateField
        label="Giriş – çıkış"
        mode="range"
        value={draft.checkIn}
        endValue={draft.checkOut}
        minDate={todayIso()}
        onChange={(checkIn) => patch({ checkIn, checkOut: null })}
        onEndChange={(checkOut) => patch({ checkOut })}
        hint="Tarih seçmezsen tüm müsait tesisler listelenir."
      />

      <View style={styles.row}>
        <TextField
          label="Misafir sayısı"
          value={String(draft.guests)}
          onChangeText={(text) => patch({ guests: Math.max(1, Math.min(20, Number(text.replace(/\D/g, '')) || 1)) })}
          keyboardType="number-pad"
          leftIcon="people-outline"
          containerStyle={styles.flex}
        />
        <TextField
          label="İlçe"
          value={filters?.districts.find((district) => district.id === draft.districtId)?.name ?? ''}
          editable={false}
          placeholder="Tüm ilçeler"
          leftIcon="location-outline"
          containerStyle={styles.flex}
          rightSlot={
            draft.districtId ? (
              <AppText variant="caption" color="primaryDeep" onPress={() => patch({ districtId: null })}>
                Kaldır
              </AppText>
            ) : null
          }
        />
      </View>

      <ChipsRow>
        <Chip label="Tüm ilçeler" active={!draft.districtId} onPress={() => patch({ districtId: null })} />
        {(filters?.districts ?? []).map((district) => (
          <Chip
            key={district.id}
            label={district.name}
            active={draft.districtId === district.id}
            onPress={() => patch({ districtId: district.id })}
          />
        ))}
      </ChipsRow>

      <View style={styles.row}>
        <TextField
          label="En düşük fiyat (₺)"
          value={draft.minPrice}
          onChangeText={(minPrice) => patch({ minPrice: minPrice.replace(/[^\d]/g, '') })}
          keyboardType="number-pad"
          placeholder="0"
          containerStyle={styles.flex}
        />
        <TextField
          label="En yüksek fiyat (₺)"
          value={draft.maxPrice}
          onChangeText={(maxPrice) => patch({ maxPrice: maxPrice.replace(/[^\d]/g, '') })}
          keyboardType="number-pad"
          placeholder="Sınırsız"
          containerStyle={styles.flex}
        />
      </View>

      <ToggleRow
        label="Yalnızca fırsatlar"
        description="Aktif indirim kampanyası olan tesisler"
        value={draft.deals}
        onChange={(deals) => patch({ deals })}
      />

      <AppText variant="bodyStrong">Sıralama</AppText>
      <ChipsRow>
        {SORTS.map((sort) => (
          <Chip
            key={sort.value}
            label={sort.label}
            active={draft.sort === sort.value}
            onPress={() => patch({ sort: sort.value })}
          />
        ))}
      </ChipsRow>

      <InfoBanner text="Fiyatlar gecelik ve kişi başı değildir; seçilen tarih ve kişi sayısına göre kesin toplam rezervasyon adımında gösterilir." />
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  footer: { flexDirection: 'row', gap: 8 },
});
