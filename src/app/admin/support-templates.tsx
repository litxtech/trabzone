import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_MAP } from '@/features/safety/constants';
import { useSupportTemplates } from '@/features/safety/hooks/use-safety';
import { useSaveSupportTemplate } from '@/features/safety/hooks/use-safety-mutations';
import type { SupportReplyTemplate } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr } from '@/utils/date';
import { toMessage } from '@/utils/error-message';

type Draft = {
  id: string | null;
  title: string;
  category: string | null;
  body: string;
  isActive: boolean;
  reason: string;
};

const EMPTY: Draft = { id: null, title: '', category: null, body: '', isActive: true, reason: '' };

export default function AdminSupportTemplatesScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const templatesQuery = useSupportTemplates();
  const save = useSaveSupportTemplate();

  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = (me.data?.permissions ?? []).includes('support.manage');
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('tr-TR');
    return templates.filter((template) => {
      if (filter === 'active' && !template.is_active) return false;
      if (filter === 'inactive' && template.is_active) return false;
      if (!term) return true;
      return (
        template.title.toLocaleLowerCase('tr-TR').includes(term) ||
        template.body.toLocaleLowerCase('tr-TR').includes(term) ||
        (template.category ?? '').toLocaleLowerCase('tr-TR').includes(term)
      );
    });
  }, [filter, query, templates]);

  const stats = useMemo(
    () => ({
      active: templates.filter((template) => template.is_active).length,
      inactive: templates.filter((template) => !template.is_active).length,
      categories: new Set(templates.map((template) => template.category).filter(Boolean)).size,
    }),
    [templates],
  );

  const openNew = () => {
    setError(null);
    setDraft({ ...EMPTY });
  };

  const openEdit = (template: SupportReplyTemplate) => {
    setError(null);
    setDraft({
      id: template.id,
      title: template.title,
      category: template.category,
      body: template.body,
      isActive: template.is_active,
      reason: '',
    });
  };

  const submit = () => {
    if (!draft) return;
    if (draft.title.trim().length < 2) {
      setError('Şablon başlığı en az 2 karakter olmalı.');
      return;
    }
    if (draft.body.trim().length < 10) {
      setError('Şablon metni en az 10 karakter olmalı.');
      return;
    }
    setError(null);
    save.mutate(
      {
        id: draft.id,
        title: draft.title.trim(),
        category: draft.category,
        body: draft.body.trim(),
        isActive: draft.isActive,
        reason: draft.reason.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(draft.id ? 'Şablon güncellendi.' : 'Şablon oluşturuldu.');
          setDraft(null);
        },
        onError: (saveError) => setError(toMessage(saveError, 'Şablon kaydedilemedi.')),
      },
    );
  };

  const columns: Column<SupportReplyTemplate>[] = [
    {
      key: 'template',
      label: 'Şablon',
      width: 2.1,
      render: (row) => (
        <View style={{ gap: 3 }}>
          <View style={styles.rowWrap}>
            <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
              {row.title}
            </AppText>
            <Badge label={row.is_active ? 'Aktif' : 'Pasif'} tone={row.is_active ? 'success' : 'neutral'} />
          </View>
          <AppText variant="caption" color="textSecondary" numberOfLines={2}>
            {row.body}
          </AppText>
        </View>
      ),
    },
    {
      key: 'category',
      label: 'Kategori',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <Badge
          label={
            row.category
              ? SUPPORT_CATEGORY_MAP[row.category as keyof typeof SUPPORT_CATEGORY_MAP]?.label ?? row.category
              : 'Genel'
          }
          tone="neutral"
        />
      ),
    },
    {
      key: 'author',
      label: 'Güncelleyen',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {row.created_by_name ?? '—'}
        </AppText>
      ),
    },
    {
      key: 'updated',
      label: 'Güncelleme',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textTertiary">
          {formatRelativeTr(row.updated_at)}
        </AppText>
      ),
    },
    {
      key: 'action',
      label: '',
      width: 0.6,
      render: (row) =>
        canManage ? (
          <Button label="Düzenle" size="sm" variant="secondary" fullWidth={false} onPress={() => openEdit(row)} />
        ) : (
          <AppText variant="caption" color="textTertiary">
            Salt okunur
          </AppText>
        ),
    },
  ];

  return (
    <AdminPage
      title="Destek yanıt şablonları"
      subtitle="Sık kullanılan yanıtları standartlaştırın. Şablonlar yanıt kutusundan tek tıkla uygulanır."
      refreshing={templatesQuery.isRefetching}
      onRefresh={() => void templatesQuery.refetch()}
      actions={
        canManage ? (
          <Button
            label="Yeni şablon"
            size="sm"
            fullWidth={false}
            leftIcon={<Ionicons name="add" size={15} color="#FFFFFF" />}
            onPress={openNew}
          />
        ) : null
      }
    >
      <StatGrid>
        <StatCard label="Aktif şablon" value={String(stats.active)} icon="chatbox-ellipses-outline" tone="success" hint="Yanıt kutusunda görünür" />
        <StatCard label="Pasif" value={String(stats.inactive)} icon="eye-off-outline" hint="Kullanıma kapalı" />
        <StatCard label="Kategori" value={String(stats.categories)} icon="pricetags-outline" hint="Konuya göre gruplandırma" />
        <StatCard label="Toplam" value={String(templates.length)} icon="documents-outline" hint="Tüm şablonlar" />
      </StatGrid>

      <AdminSection
        title="Şablon kataloğu"
        subtitle="Değişiklikler denetim kaydına yazılır."
        action={<Badge label={`${visible.length} kayıt`} tone="primary" />}
      >
        <View style={styles.toolbar}>
          <View style={styles.searchWrap}>
            <TextField
              placeholder="Başlık, metin veya kategori ara"
              value={query}
              onChangeText={setQuery}
              leftIcon="search-outline"
              autoCorrect={false}
            />
          </View>
        </View>
        <FilterChips
          options={[
            { key: 'active', label: 'Aktif' },
            { key: 'inactive', label: 'Pasif' },
            { key: 'all', label: 'Tümü' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <DataTable
          columns={columns}
          rows={visible}
          keyExtractor={(row) => row.id}
          loading={templatesQuery.isLoading}
          empty={
            <View style={styles.empty}>
              <Ionicons
                name={templatesQuery.isError ? 'cloud-offline-outline' : 'documents-outline'}
                size={22}
                color={templatesQuery.isError ? theme.colors.danger : theme.colors.textTertiary}
              />
              <AppText variant="caption" color="textSecondary">
                {templatesQuery.isError
                  ? 'Şablonlar yüklenemedi. support.view yetkisini kontrol edin.'
                  : 'Bu filtrede şablon yok.'}
              </AppText>
            </View>
          }
        />
      </AdminSection>

      <Modal visible={draft !== null} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Pencereyi kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={() => setDraft(null)}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <View style={styles.sheetHead}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="h3">{draft?.id ? 'Şablonu düzenle' : 'Yeni şablon'}</AppText>
                <AppText variant="caption" color="textTertiary">
                  Kullanıcıya gönderilecek hazır yanıt metni.
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setDraft(null)}
                style={[styles.close, { backgroundColor: theme.colors.surfaceMuted }]}
              >
                <Ionicons name="close" size={17} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <TextField
              label="Başlık"
              value={draft?.title ?? ''}
              onChangeText={(value) => setDraft((current) => (current ? { ...current, title: value } : current))}
              placeholder="Örn. Şifre sıfırlama yönlendirmesi"
              maxLength={120}
            />

            <View style={{ gap: 6 }}>
              <AppText variant="caption" color="textSecondary" style={{ fontWeight: '600' }}>
                Kategori
              </AppText>
              <View style={styles.categoryGrid}>
                <Button
                  label="Genel"
                  size="sm"
                  variant={draft?.category === null ? 'primary' : 'outline'}
                  fullWidth={false}
                  onPress={() => setDraft((current) => (current ? { ...current, category: null } : current))}
                />
                {SUPPORT_CATEGORIES.map((item) => (
                  <Button
                    key={item.code}
                    label={item.label}
                    size="sm"
                    variant={draft?.category === item.code ? 'primary' : 'outline'}
                    fullWidth={false}
                    onPress={() => setDraft((current) => (current ? { ...current, category: item.code } : current))}
                  />
                ))}
              </View>
            </View>

            <TextField
              label="Yanıt metni"
              value={draft?.body ?? ''}
              onChangeText={(value) => setDraft((current) => (current ? { ...current, body: value } : current))}
              placeholder="Kullanıcıya gönderilecek metin…"
              multiline
              numberOfLines={5}
              maxLength={8000}
              textAlignVertical="top"
              hint="Kullanıcıya gösterilecek metin. İç notlar için şablon kullanmayın."
            />

            <View style={styles.switchRow}>
              <View style={{ flex: 1, gap: 1 }}>
                <AppText variant="caption" style={{ fontWeight: '600' }}>
                  Aktif
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  Pasif şablonlar yanıt kutusunda listelenmez.
                </AppText>
              </View>
              <Switch
                value={draft?.isActive ?? true}
                onValueChange={(value) =>
                  setDraft((current) => (current ? { ...current, isActive: value } : current))
                }
                trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
              />
            </View>

            <TextField
              label="İşlem gerekçesi (opsiyonel)"
              value={draft?.reason ?? ''}
              onChangeText={(value) => setDraft((current) => (current ? { ...current, reason: value } : current))}
              placeholder="Değişikliğin nedeni"
              maxLength={400}
            />

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={14} color={theme.colors.danger} />
                <AppText variant="caption" color="danger" style={{ flex: 1 }}>
                  {error}
                </AppText>
              </View>
            ) : null}

            <View style={styles.sheetActions}>
              <Button label="Vazgeç" variant="secondary" fullWidth={false} onPress={() => setDraft(null)} />
              <Button label="Kaydet" loading={save.isPending} fullWidth={false} onPress={submit} />
            </View>
          </View>
        </View>
      </Modal>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  searchWrap: { flex: 1, minWidth: 240, maxWidth: 440 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 30 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '92%',
    padding: 18,
    gap: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  close: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 9 },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
