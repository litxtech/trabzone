import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppText, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { useNewsApiSaveCategoryMappings } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import type { NewsCategoryMapping, NewsCategoryOption } from '@/features/news-api/types';

import { NewsModalShell } from './NewsModalShell';
import { ChipSelect, EmptyHint, newsApiStyles } from './shared';

type Draft = { source_category: string; target_slug: string };

export function NewsCategoryMappingModal({
  visible,
  connectionId,
  connectionName,
  mappings,
  categories,
  onClose,
}: {
  visible: boolean;
  connectionId: string;
  connectionName: string;
  mappings: NewsCategoryMapping[];
  categories: NewsCategoryOption[];
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useNewsApiSaveCategoryMappings();
  const [rows, setRows] = useState<Draft[]>(
    mappings.map((row) => ({ source_category: row.source_category, target_slug: row.target_slug })),
  );
  const [source, setSource] = useState('');
  const [target, setTarget] = useState(categories[0]?.slug ?? '');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const value = source.trim();
    if (value.length < 2) {
      setError('Kaynak kategori adı en az 2 karakter olmalı.');
      return;
    }
    if (!target) {
      setError('Hedef Trabzone kategorisi seç.');
      return;
    }
    if (rows.some((row) => row.source_category.toLowerCase() === value.toLowerCase())) {
      setError('Bu kaynak kategorisi zaten eşleştirilmiş.');
      return;
    }
    setRows((current) => [...current, { source_category: value, target_slug: target }]);
    setSource('');
    setError(null);
  };

  const submit = async () => {
    try {
      await save.mutateAsync({
        id: connectionId,
        rows: rows
          .filter((row) => row.source_category.trim() && row.target_slug)
          .map((row) => ({ ...row, is_auto: false })),
      });
      toast.success('Kategori eşleştirmesi kaydedildi.');
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Kategori eşleştirmesi kaydedilemedi.'));
    }
  };

  return (
    <NewsModalShell
      visible={visible}
      title="Kategori Eşleştirme"
      subtitle={`${connectionName} · kaynak kategorilerini Trabzone kategorilerine bağla`}
      onClose={onClose}
      footer={
        <>
          <Button label="Vazgeç" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
          <Button label="Kaydet" size="sm" fullWidth={false} loading={save.isPending} onPress={() => void submit()} />
        </>
      }
    >
      <AppText variant="caption" color="textSecondary">
        Eşleştirme bulunamazsa kaynak kategorisi AI sınıflandırmasıyla çözülür. Kaynakta olmayan bir kategori
        varmış gibi gösterilmez.
      </AppText>

      <View style={[styles.addBox, { borderColor: theme.colors.border }]}>
        <AppText variant="label">Yeni eşleştirme</AppText>
        <View style={styles.addRow}>
          <TextField
            label="Kaynak kategori adı"
            value={source}
            onChangeText={setSource}
            placeholder="örn. Spor"
            containerStyle={styles.grow}
          />
          <Button label="Ekle" size="sm" fullWidth={false} onPress={add} style={styles.addButton} />
        </View>
        <View style={newsApiStyles.gapSm}>
          <AppText variant="caption" color="textTertiary">
            Hedef Trabzone kategorisi
          </AppText>
          <ChipSelect
            options={categories.map((category) => ({ value: category.slug, label: category.name }))}
            value={target}
            onChange={setTarget}
          />
        </View>
      </View>

      {rows.length === 0 ? (
        <EmptyHint text="Henüz eşleştirme yok. Kaynak kategorileri AI ile sınıflandırılır." />
      ) : (
        <View style={[styles.table, { borderColor: theme.colors.border }]}>
          <View style={[styles.tableHead, { borderBottomColor: theme.colors.divider }]}>
            <AppText variant="caption" color="textTertiary" style={styles.colSource}>
              Kaynak kategorisi
            </AppText>
            <AppText variant="caption" color="textTertiary" style={styles.colTarget}>
              Trabzone kategorisi
            </AppText>
            <View style={styles.colAction} />
          </View>
          {rows.map((row, index) => (
            <View key={`${row.source_category}-${index}`} style={[styles.tableRow, { borderBottomColor: theme.colors.divider }]}>
              <AppText variant="caption" style={styles.colSource} numberOfLines={2}>
                {row.source_category}
              </AppText>
              <View style={styles.colTarget}>
                <ChipSelect
                  options={categories.map((category) => ({ value: category.slug, label: category.name }))}
                  value={row.target_slug}
                  onChange={(value) =>
                    setRows((current) => current.map((item, i) => (i === index ? { ...item, target_slug: value } : item)))
                  }
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Eşleştirmeyi kaldır"
                onPress={() => setRows((current) => current.filter((_, i) => i !== index))}
                style={styles.colAction}
              >
                <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </NewsModalShell>
  );
}

const styles = StyleSheet.create({
  addBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 9 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 200 },
  addButton: { minHeight: 42 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 11 },
  tableHead: { flexDirection: 'row', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  tableRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  colSource: { width: 190 },
  colTarget: { flex: 1, minWidth: 220 },
  colAction: { width: 32, alignItems: 'center' },
});
