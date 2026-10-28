import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { AdminSection } from '@/features/admin/components/AdminPage';
import * as api from '@/features/explore/services/explore-service';
import {
  useAdminExploreMutation,
  useAdminPlaceCategories,
} from '@/features/explore/hooks/use-explore';
import type { AdminPlaceCategory } from '@/features/explore/types';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminDetailModal, AdminEmptyState, AdminQueryState } from './AdminExploreShared';
import { formatNumber } from './labels';

const TONES = ['primary', 'accent', 'success', 'warning', 'danger', 'info'] as const;

export function CategoriesPanel({ canManage }: { canManage: boolean }) {
  const { theme } = useTheme();
  const query = useAdminPlaceCategories();
  const [editing, setEditing] = useState<AdminPlaceCategory | null>(null);
  const [creating, setCreating] = useState(false);

  const categories = query.data?.items ?? [];
  const roots = categories.filter((item) => !item.parent_id);

  return (
    <>
      <AdminSection
        title="İşletme kategorileri"
        subtitle="Kategoriler sabit koda gömülü değildir. Pasif kategori yeni işletmelerde seçilemez."
        action={
          <View style={styles.headActions}>
            <Badge label={`${formatNumber(categories.length)} kategori`} tone="primary" />
            {canManage ? (
              <Button
                label="Kategori ekle"
                size="sm"
                fullWidth={false}
                leftIcon={<Ionicons name="add" size={15} color={theme.colors.onPrimary} />}
                onPress={() => setCreating(true)}
              />
            ) : null}
          </View>
        }
      >
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {categories.length === 0 ? (
            <AdminEmptyState
              icon="pricetags-outline"
              title="Kategori yok"
              text="Harita işaretçileri için en az bir kategori oluştur."
              tone="neutral"
            />
          ) : (
            <View style={styles.list}>
              {categories.map((item) => {
                const parent = categories.find((root) => root.id === item.parent_id) ?? null;
                return (
                  <View
                    key={item.id}
                    style={[styles.row, { borderColor: theme.colors.divider }]}
                  >
                    <View
                      style={[
                        styles.icon,
                        {
                          backgroundColor:
                            item.tone === 'success'
                              ? theme.colors.successSoft
                              : item.tone === 'warning'
                                ? theme.colors.warningSoft
                                : item.tone === 'danger'
                                  ? theme.colors.dangerSoft
                                  : item.tone === 'accent'
                                    ? theme.colors.accentSoft
                                    : theme.colors.primarySoft,
                        },
                      ]}
                    >
                      <Ionicons
                        name={(item.icon || 'storefront-outline') as React.ComponentProps<typeof Ionicons>['name']}
                        size={16}
                        color={theme.colors.primaryDeep}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={styles.nameRow}>
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {item.name}
                        </AppText>
                        {!item.is_active ? <Badge label="Pasif" tone="neutral" /> : null}
                      </View>
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        {parent ? `${parent.name} altında · ` : ''}
                        {item.slug} · {formatNumber(item.place_count)} işletme
                        {item.children_count > 0 ? ` · ${item.children_count} alt kategori` : ''}
                      </AppText>
                    </View>
                    {canManage ? (
                      <Button
                        label="Düzenle"
                        size="sm"
                        variant="secondary"
                        fullWidth={false}
                        onPress={() => setEditing(item)}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </AdminQueryState>
      </AdminSection>

      <CategoryEditorModal
        visible={creating || editing !== null}
        initial={editing}
        roots={roots}
        canManage={canManage}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(message) => {
          Alert.alert('Kaydedildi', message);
          void query.refetch();
        }}
      />
    </>
  );
}

function CategoryEditorModal({
  visible,
  initial,
  roots,
  canManage,
  onClose,
  onSaved,
}: {
  visible: boolean;
  initial: AdminPlaceCategory | null;
  roots: AdminPlaceCategory[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { theme } = useTheme();
  const mutation = useAdminExploreMutation((payload: Record<string, unknown>) =>
    api.adminUpsertPlaceCategory(payload),
  );
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [icon, setIcon] = useState('storefront-outline');
  const [tone, setTone] = useState<string>('primary');
  const [parentId, setParentId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [parentOpen, setParentOpen] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parent = roots.find((item) => item.id === parentId) ?? null;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible) return;
    setName(initial?.name ?? '');
    setSlug(initial?.slug ?? '');
    setIcon(initial?.icon ?? 'storefront-outline');
    setTone(initial?.tone ?? 'primary');
    setParentId(initial?.parent_id ?? null);
    setSortOrder(String(initial?.sort_order ?? 0));
    setActive(initial?.is_active ?? true);
    setError(null);
  }, [visible, initial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = () => {
    if (!canManage) {
      setError('Kategori kaydetmek için map.manage izni gerekir.');
      return;
    }
    if (name.trim().length < 2) {
      setError('Kategori adı en az 2 karakter olmalı.');
      return;
    }
    const normalizedSlug = slug
      .trim()
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!/^[a-z0-9-]{2,48}$/.test(normalizedSlug)) {
      setError('Slug 2-48 karakter olmalı; yalnızca küçük harf, rakam ve tire içerebilir.');
      return;
    }
    if (initial && parentId === initial.id) {
      setError('Kategori kendi alt kategorisi olamaz.');
      return;
    }
    const sort = Number(sortOrder.replace(/[^\d-]/g, ''));
    setError(null);
    mutation.mutate(
      {
        id: initial?.id,
        name: name.trim(),
        slug: normalizedSlug,
        icon: icon.trim() || 'storefront-outline',
        tone,
        parent_id: parentId,
        sort_order: Number.isFinite(sort) ? sort : 0,
        is_active: active,
      },
      {
        onSuccess: () => {
          onSaved(initial ? 'Kategori güncellendi.' : 'Kategori oluşturuldu.');
          onClose();
        },
        onError: (cause) => setError(cause.message),
      },
    );
  };

  return (
    <>
      <AdminDetailModal
        visible={visible}
        title={initial ? 'Kategoriyi düzenle' : 'Yeni kategori'}
        subtitle="Kategori ve alt kategori yapısı haritadaki işaretçileri doğrudan etkiler."
        onClose={onClose}
        maxWidth={560}
        footer={
          <>
            <Button label="Vazgeç" size="sm" variant="secondary" fullWidth={false} onPress={onClose} />
            <Button
              label="Kaydet"
              size="sm"
              fullWidth={false}
              loading={mutation.isPending}
              disabled={!canManage}
              onPress={submit}
            />
          </>
        }
      >
        <TextField label="Kategori adı" value={name} onChangeText={setName} maxLength={60} />
        <TextField
          label="Slug"
          value={slug}
          onChangeText={setSlug}
          autoCapitalize="none"
          placeholder="orn-yemek"
          hint="Harita filtrelerinde kullanılan benzersiz anahtar."
        />
        <View style={styles.grid}>
          <View style={styles.flexField}>
            <AppText variant="label" color="textSecondary">
              Üst kategori
            </AppText>
            <Button
              label={parent?.name ?? 'Ana kategori'}
              size="sm"
              variant="outline"
              onPress={() => setParentOpen(true)}
            />
          </View>
          <View style={styles.flexField}>
            <AppText variant="label" color="textSecondary">
              Renk tonu
            </AppText>
            <Button
              label={tone}
              size="sm"
              variant="outline"
              onPress={() => setToneOpen(true)}
            />
          </View>
        </View>
        <View style={styles.grid}>
          <TextField
            label="İkon adı"
            value={icon}
            onChangeText={setIcon}
            autoCapitalize="none"
            placeholder="restaurant-outline"
            containerStyle={styles.flexField}
          />
          <TextField
            label="Sıra"
            value={sortOrder}
            onChangeText={setSortOrder}
            keyboardType="number-pad"
            containerStyle={styles.flexField}
          />
        </View>
        <View style={[styles.switchRow, { borderColor: theme.colors.border }]}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Kategori aktif</AppText>
            <AppText variant="caption" color="textTertiary">
              Pasif kategori yeni işletmelerde seçilemez; mevcut kayıtlar korunur.
            </AppText>
          </View>
          <Switch
            value={active}
            onValueChange={setActive}
            trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
            thumbColor={theme.colors.surface}
          />
        </View>
        {error ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : null}
      </AdminDetailModal>

      <SelectSheet
        visible={parentOpen}
        title="Üst kategori"
        options={['Ana kategori', ...roots.filter((root) => root.id !== initial?.id).map((root) => root.name)]}
        value={parent?.name ?? 'Ana kategori'}
        onClose={() => setParentOpen(false)}
        onSelect={(label) => {
          const selected = roots.find((root) => root.name === label) ?? null;
          setParentId(selected?.id ?? null);
          setParentOpen(false);
        }}
      />
      <SelectSheet
        visible={toneOpen}
        title="Renk tonu"
        options={[...TONES]}
        value={tone}
        onClose={() => setToneOpen(false)}
        onSelect={(value) => {
          setTone(value);
          setToneOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  flexField: { flexGrow: 1, flexBasis: 190, gap: 6 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
