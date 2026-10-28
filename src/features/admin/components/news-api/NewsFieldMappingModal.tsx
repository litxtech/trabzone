import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { useNewsApiSaveMappings } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import type { NewsFieldMapping } from '@/features/news-api/types';

import { NewsModalShell } from './NewsModalShell';
import { ChipSelect, EmptyHint, InfoRow, newsApiStyles } from './shared';

const FIELD_LABELS: { key: string; label: string; required?: boolean; hint?: string }[] = [
  { key: 'external_id', label: 'Benzersiz haber ID', hint: 'Kaynak haber kimliği; tekrar kontrolünde kullanılır.' },
  { key: 'title', label: 'Başlık', required: true },
  { key: 'summary', label: 'Özet / spot' },
  { key: 'body', label: 'Haber metni' },
  { key: 'url', label: 'Orijinal URL', required: true },
  { key: 'published_at', label: 'Yayın tarihi' },
  { key: 'updated_at', label: 'Güncelleme tarihi' },
  { key: 'image_url', label: 'Görsel URL' },
  { key: 'video_url', label: 'Video URL' },
  { key: 'author', label: 'Yazar' },
  { key: 'source_name', label: 'Kaynak kuruluş' },
  { key: 'category', label: 'Kaynak kategorisi' },
  { key: 'district', label: 'İlçe' },
  { key: 'neighborhood', label: 'Mahalle' },
  { key: 'tags', label: 'Etiketler' },
  { key: 'language', label: 'Dil' },
];

const TRANSFORMS = [
  { value: 'none', label: 'Dönüşüm yok' },
  { value: 'trim', label: 'Kırp' },
  { value: 'html_to_text', label: 'HTML → metin' },
  { value: 'iso_date', label: 'ISO tarih' },
  { value: 'unix_seconds', label: 'Unix (sn)' },
  { value: 'unix_ms', label: 'Unix (ms)' },
  { value: 'absolute_url', label: 'Mutlak URL' },
];

const FIELD_ALIASES: Record<string, string[]> = {
  external_id: ['id', 'guid', 'external_id', 'externalid', 'haber_id', 'news_id', 'uuid'],
  title: ['title', 'headline', 'baslik', 'başlık', 'name', 'subject'],
  summary: ['summary', 'description', 'spot', 'ozet', 'özet', 'excerpt', 'abstract'],
  body: ['body', 'content', 'text', 'icerik', 'içerik', 'content_html', 'full_text', 'article'],
  url: ['url', 'link', 'permalink', 'canonical_url', 'web_url', 'href', 'news_url'],
  published_at: ['published_at', 'pubdate', 'published', 'date', 'date_published', 'yayin_tarihi', 'created_at', 'createdat'],
  updated_at: ['updated_at', 'updated', 'modified', 'last_modified', 'guncelleme_tarihi'],
  image_url: ['image', 'image_url', 'imageurl', 'thumbnail', 'media', 'gorsel', 'görsel', 'resim', 'photo'],
  video_url: ['video', 'video_url', 'videourl'],
  author: ['author', 'creator', 'byline', 'yazar', 'authors'],
  source_name: ['source', 'source_name', 'agency', 'kaynak', 'organization'],
  category: ['category', 'categories', 'section', 'kategori', 'sectors'],
  district: ['district', 'ilce', 'ilçe', 'town'],
  neighborhood: ['neighborhood', 'mahalle'],
  tags: ['tags', 'keywords', 'etiketler'],
  language: ['language', 'lang', 'dil'],
};

function lastSegment(path: string): string {
  return path.split('.').pop()?.replace(/\[\d+\]/g, '').replace(/[_-]/g, '').toLowerCase() ?? '';
}

function autoGuess(fields: string[]): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = {};
  for (const field of FIELD_LABELS) {
    const aliases = FIELD_ALIASES[field.key] ?? [];
    const scored = fields
      .map((path) => {
        const segment = lastSegment(path);
        const index = aliases.findIndex((alias) => segment === alias.replace(/[_-]/g, '').toLowerCase());
        return { path, score: index === -1 ? 99 : index };
      })
      .filter((row) => row.score < 99)
      .sort((a, b) => a.score - b.score || a.path.split('.').length - b.path.split('.').length);
    const candidate = scored.find((row) => !used.has(row.path));
    if (candidate) {
      result[field.key] = candidate.path;
      used.add(candidate.path);
    }
  }
  return result;
}

export function NewsFieldMappingModal({
  visible,
  connectionId,
  connectionName,
  mappings,
  detectedFields = [],
  onClose,
}: {
  visible: boolean;
  connectionId: string;
  connectionName: string;
  mappings: NewsFieldMapping[];
  detectedFields?: string[];
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useNewsApiSaveMappings();

  const initial = useMemo(() => {
    const map: Record<string, { path: string; transform: string }> = {};
    for (const row of mappings) map[row.field_key] = { path: row.source_path, transform: row.transform };
    return map;
  }, [mappings]);

  const [rows, setRows] = useState<Record<string, { path: string; transform: string }>>(initial);
  const [error, setError] = useState<string | null>(null);

  const update = (key: string, patch: Partial<{ path: string; transform: string }>) => {
    setRows((current) => ({
      ...current,
      [key]: { path: patch.path ?? current[key]?.path ?? '', transform: patch.transform ?? current[key]?.transform ?? 'none' },
    }));
  };

  const applyGuess = () => {
    if (detectedFields.length === 0) {
      setError('Önce "Bağlantıyı Test Et" çalıştır; dönen alanlar olmadan otomatik eşleştirme yapılamaz.');
      return;
    }
    const guess = autoGuess(detectedFields);
    setRows((current) => {
      const next = { ...current };
      for (const [key, path] of Object.entries(guess)) {
        next[key] = { path, transform: key.endsWith('_at') ? 'none' : next[key]?.transform ?? 'none' };
      }
      return next;
    });
    setError(null);
  };

  const submit = async () => {
    const payload: NewsFieldMapping[] = FIELD_LABELS.flatMap((field) => {
      const row = rows[field.key];
      const sourcePath = row?.path?.trim();
      if (!sourcePath) {
        return [];
      }
      return [
        {
          field_key: field.key,
          source_path: sourcePath,
          transform: field.key.endsWith('_at') ? row?.transform || 'none' : 'none',
          is_auto: false,
        },
      ];
    });
    if (!payload.some((row) => row.field_key === 'title') || !payload.some((row) => row.field_key === 'url')) {
      setError('Başlık ve orijinal URL eşleştirmesi zorunludur; kaynak bu iki alan olmadan etkinleştirilemez.');
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({ id: connectionId, rows: payload });
      toast.success('Alan eşleştirmesi kaydedildi.');
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Alan eşleştirmesi kaydedilemedi.'));
    }
  };

  return (
    <NewsModalShell
      visible={visible}
      title="Veri Alanı Eşleştirme"
      subtitle={`${connectionName} · API yanıtındaki gerçek alan yollarını seç`}
      onClose={onClose}
      footer={
        <>
          <Button label="Vazgeç" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
          <Button
            label="Eşleştirmeyi kaydet"
            size="sm"
            fullWidth={false}
            loading={save.isPending}
            onPress={() => void submit()}
          />
        </>
      }
    >
      <View style={[styles.note, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}>
        <AppText variant="caption" color="textSecondary">
          Başlık ve URL zorunludur. API yanıtı güvenilmeyen veri olarak işlenir; HTML temizlenir, alan içeriği sistem
          talimatı olarak çalıştırılmaz.
        </AppText>
      </View>

      <View style={newsApiStyles.row}>
        <Button label="Otomatik eşleştir" size="sm" variant="outline" fullWidth={false} onPress={applyGuess} />
        <Button
          label="Temizle"
          size="sm"
          variant="ghost"
          fullWidth={false}
          onPress={() => setRows({})}
        />
        <AppText variant="caption" color="textTertiary">
          {detectedFields.length > 0
            ? `${detectedFields.length} alan algılandı`
            : 'Test çalıştırılmadı — alanları elle girebilirsin'}
        </AppText>
      </View>

      {detectedFields.length > 0 ? (
        <View style={[styles.fieldBox, { borderColor: theme.colors.border }]}>
          <AppText variant="label" color="textSecondary">
            API yanıtında bulunan alanlar
          </AppText>
          <View style={newsApiStyles.chips}>
            {detectedFields.slice(0, 80).map((field) => (
              <View
                key={field}
                style={[newsApiStyles.chip, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
              >
                <AppText variant="caption" color="textTertiary" style={newsApiStyles.mono}>
                  {field}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <EmptyHint text="Test sonucu alanları burada listelenir. Alanları elle de yazabilirsin: örn. data.items[].title" />
      )}

      {FIELD_LABELS.map((field) => (
        <View key={field.key} style={[styles.row, { borderColor: theme.colors.divider }]}>
          <View style={styles.rowHead}>
            <AppText variant="label">
              {field.label}
              {field.required ? ' *' : ''}
            </AppText>
            {field.hint ? (
              <AppText variant="caption" color="textTertiary">
                {field.hint}
              </AppText>
            ) : null}
          </View>
          <View style={styles.rowBody}>
            <TextField
              value={rows[field.key]?.path ?? ''}
              onChangeText={(value) => update(field.key, { path: value })}
              placeholder={FIELD_ALIASES[field.key]?.[0] ?? 'alan.yolu'}
              autoCapitalize="none"
              containerStyle={styles.pathInput}
            />
            {field.key.endsWith('_at') || field.key.endsWith('_url') ? (
              <View style={styles.transform}>
                <ChipSelect
                  options={field.key === 'published_at' || field.key === 'updated_at'
                    ? TRANSFORMS.filter((row) => ['none', 'iso_date', 'unix_seconds', 'unix_ms'].includes(row.value))
                    : TRANSFORMS.filter((row) => ['none', 'trim', 'absolute_url'].includes(row.value))}
                  value={rows[field.key]?.transform ?? 'none'}
                  onChange={(value) => update(field.key, { transform: value })}
                />
              </View>
            ) : null}
          </View>
        </View>
      ))}

      <InfoRow label="Kayıtlı alan sayısı" value={String(mappings.length)} />

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </NewsModalShell>
  );
}

const styles = StyleSheet.create({
  note: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11 },
  fieldBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11, gap: 8 },
  row: { gap: 8, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  rowHead: { gap: 2 },
  rowBody: { gap: 8 },
  pathInput: { width: '100%' },
  transform: { gap: 4 },
});
