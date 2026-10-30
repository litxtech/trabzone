import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { useNewsApiSaveFilters } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import type { NewsCategoryOption, NewsFilters } from '@/features/news-api/types';

import { NewsModalShell } from './NewsModalShell';
import { ChipSelect, ToggleRow, newsApiStyles } from './shared';

const LOCATION_MODES = [
  { value: 'trabzon_all', label: 'Trabzon geneli' },
  { value: 'selected_districts', label: 'Seçili ilçeler' },
  { value: 'trabzonspor', label: 'Sadece Trabzonspor' },
  { value: 'national_trabzon', label: 'Trabzon bağlantılı ulusal' },
];

const NEWS_TYPES = [
  { value: 'all', label: 'Tüm izinli kategoriler' },
  { value: 'breaking', label: 'Yalnız son dakika' },
  { value: 'trabzon', label: 'Yalnız Trabzon gündemi' },
  { value: 'trabzonspor', label: 'Yalnız Trabzonspor' },
  { value: 'economy', label: 'Yalnız ekonomi' },
  { value: 'public_notice', label: 'Yalnız kamu duyuruları' },
];

const DATE_WINDOWS = [
  { value: '1', label: 'Son 1 saat' },
  { value: '6', label: 'Son 6 saat' },
  { value: '24', label: 'Son 24 saat' },
  { value: '168', label: 'Son 7 gün' },
  { value: '720', label: 'Son 30 gün' },
];

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function keywordsToText(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item)).join(', ') : '';
}

function textToKeywords(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function NewsFiltersModal({
  visible,
  connectionId,
  connectionName,
  filters,
  categories,
  districts,
  onClose,
}: {
  visible: boolean;
  connectionId: string;
  connectionName: string;
  filters: NewsFilters | null;
  categories: NewsCategoryOption[];
  districts: { name: string; slug: string }[];
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useNewsApiSaveFilters();

  const content = (filters?.content ?? {}) as Record<string, unknown>;
  const [selectedCategories, setSelectedCategories] = useState<string[]>(filters?.categories ?? []);
  const [newsTypes, setNewsTypes] = useState<string[]>(filters?.news_types ?? []);
  const [locationMode, setLocationMode] = useState<string>(filters?.location?.mode ?? 'trabzon_all');
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>(filters?.location?.districts ?? []);
  const [dateWindow, setDateWindow] = useState(String(filters?.date_window_hours ?? 72));
  const [hasImage, setHasImage] = useState(content.has_image === true);
  const [hasVideo, setHasVideo] = useState(content.has_video === true);
  const [includeKeywords, setIncludeKeywords] = useState(keywordsToText(content.include_keywords));
  const [excludeKeywords, setExcludeKeywords] = useState(keywordsToText(content.exclude_keywords));
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (locationMode === 'selected_districts' && selectedDistricts.length === 0) {
      setError('Seçili ilçeler modu için en az bir ilçe seç.');
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        id: connectionId,
        categories: selectedCategories,
        newsTypes,
        location: { mode: locationMode, districts: locationMode === 'selected_districts' ? selectedDistricts : [] },
        content: {
          has_image: hasImage,
          has_video: hasVideo,
          include_keywords: textToKeywords(includeKeywords),
          exclude_keywords: textToKeywords(excludeKeywords),
        },
        dateWindowHours: Number(dateWindow) || 72,
      });
      toast.success('Filtreler kaydedildi. Sonraki çekim görevlerine uygulanacak.');
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Filtreler kaydedilemedi.'));
    }
  };

  return (
    <NewsModalShell
      visible={visible}
      title="Haber Filtreleri"
      subtitle={`${connectionName} · hangi haberler çekilsin?`}
      onClose={onClose}
      footer={
        <>
          <Button label="Vazgeç" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
          <Button label="Filtreleri kaydet" size="sm" fullWidth={false} loading={save.isPending} onPress={() => void submit()} />
        </>
      }
    >
      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">Haber türü</AppText>
        <ChipSelect
          options={NEWS_TYPES}
          multiple
          values={newsTypes}
          onToggle={(value) => setNewsTypes((current) => (value === 'all' ? [] : toggle(current, value)))}
        />
        <AppText variant="caption" color="textTertiary">
          Boş bırakılırsa kategori filtresi esas alınır. “Tüm izinli kategoriler” tür filtresini kaldırır.
        </AppText>
      </View>

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">Kategoriler</AppText>
        <ChipSelect
          options={categories.map((category) => ({ value: category.slug, label: category.name }))}
          multiple
          values={selectedCategories}
          onToggle={(value) => setSelectedCategories((current) => toggle(current, value))}
        />
        <AppText variant="caption" color="textTertiary">
          {selectedCategories.length === 0
            ? 'Kategori seçilmezse Trabzon bağlantılı tüm kategoriler değerlendirilir.'
            : `${selectedCategories.length} kategori seçili`}
        </AppText>
      </View>

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">Konum</AppText>
        <ChipSelect options={LOCATION_MODES} value={locationMode} onChange={setLocationMode} />
        {locationMode === 'selected_districts' ? (
          <View style={[styles.districtBox, { borderColor: theme.colors.border }]}>
            <AppText variant="caption" color="textTertiary">
              Trabzon ilçeleri
            </AppText>
            <ChipSelect
              options={districts.map((district) => ({ value: district.slug, label: district.name }))}
              multiple
              values={selectedDistricts}
              onToggle={(value) => setSelectedDistricts((current) => toggle(current, value))}
            />
          </View>
        ) : null}
      </View>

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">Tarih aralığı</AppText>
        <ChipSelect options={DATE_WINDOWS} value={dateWindow} onChange={setDateWindow} />
        <TextField
          label="Özel aralık (saat)"
          value={dateWindow}
          onChangeText={setDateWindow}
          keyboardType="number-pad"
          hint="1–720 saat arası"
        />
      </View>

      <ToggleRow title="Yalnız görselli haberler" value={hasImage} onValueChange={setHasImage} />
      <ToggleRow title="Yalnız videolu haberler" value={hasVideo} onValueChange={setHasVideo} />

      <TextField
        label="Dahil edilecek anahtar kelimeler"
        value={includeKeywords}
        onChangeText={setIncludeKeywords}
        placeholder="trabzon, fındık, ulaşım"
        hint="Virgülle ayır. En az biri geçen haberler alınır."
      />
      <TextField
        label="Hariç tutulacak anahtar kelimeler"
        value={excludeKeywords}
        onChangeText={setExcludeKeywords}
        placeholder="reklam, bahis"
        hint="Virgülle ayır. Geçen haberler alınmaz."
      />

      <AppText variant="caption" color="textTertiary">
        Filtre değişiklikleri sonraki çekim görevlerine otomatik uygulanır. Eski haberlerin silinmesi ayrı onay
        gerektirir.
      </AppText>

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </NewsModalShell>
  );
}

const styles = StyleSheet.create({
  districtBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11, gap: 7 },
});
