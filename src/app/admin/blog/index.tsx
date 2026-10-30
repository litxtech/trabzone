import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { BlogAiSettingsModal } from '@/features/admin/components/blog/BlogAiSettingsModal';
import { BlogEditorModal } from '@/features/admin/components/blog/BlogEditorModal';
import {
  useAdminBlogDelete,
  useAdminBlogDuplicate,
  useAdminBlogPosts,
  useAdminBlogStats,
  useAdminBlogStatus,
} from '@/features/admin/hooks/use-admin-blog';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import type { AdminBlogListItem } from '@/features/blog/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

type StatusFilter = 'all' | 'published' | 'draft' | 'archived';

const number = new Intl.NumberFormat('tr-TR');

export default function AdminBlogScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const canManage = (me.data?.permissions ?? []).includes('cms.manage');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminBlogListItem | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 280);
    return () => clearTimeout(timer);
  }, [search]);

  const stats = useAdminBlogStats();
  const posts = useAdminBlogPosts({
    search: debounced,
    status: status === 'all' ? null : status,
    limit: 60,
    offset: 0,
  });
  const setStatusMutation = useAdminBlogStatus();
  const duplicate = useAdminBlogDuplicate();
  const remove = useAdminBlogDelete();

  const openNew = () => {
    setEditingId(null);
    setEditorOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setEditorOpen(true);
  };

  const togglePublish = async (row: AdminBlogListItem) => {
    const next = row.status === 'published' ? 'draft' : 'published';
    try {
      await setStatusMutation.mutateAsync({ id: row.id, status: next });
      toast.success(next === 'published' ? 'Yazı yayınlandı.' : 'Yazı taslağa alındı.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Durum değiştirilemedi.');
    }
  };

  const copy = async (row: AdminBlogListItem) => {
    try {
      await duplicate.mutateAsync(row.id);
      toast.success('Yazı taslak olarak kopyalandı.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Yazı kopyalanamadı.');
    }
  };

  const confirmDelete = async ({ reason }: { reason: string }) => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync({ id: deleteTarget.id, reason });
      toast.success('Yazı silindi.');
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Yazı silinemedi.');
    }
  };

  const columns: Column<AdminBlogListItem>[] = [
      {
        key: 'title',
        label: 'Yazı',
        width: 2.6,
        render: (row) => (
          <View style={{ gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {row.is_featured ? (
                <Ionicons name="star" size={12} color={theme.colors.warning} />
              ) : null}
              <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={2}>
                {row.title}
              </AppText>
            </View>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              /blog/{row.slug}
            </AppText>
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
              <Badge label={row.category} tone="neutral" />
              {row.ai_generated ? <Badge label="AI" tone="accent" /> : null}
              {row.scheduled ? <Badge label="Zamanlandı" tone="warning" /> : null}
            </View>
          </View>
        ),
      },
      {
        key: 'status',
        label: 'Durum',
        width: 0.8,
        render: (row) => (
          <Badge
            label={
              row.status === 'published' ? 'Yayında' : row.status === 'draft' ? 'Taslak' : 'Arşiv'
            }
            tone={
              row.status === 'published' ? 'success' : row.status === 'draft' ? 'warning' : 'neutral'
            }
          />
        ),
      },
      {
        key: 'words',
        label: 'Uzunluk',
        width: 0.8,
        hideOnMobile: true,
        render: (row) => (
          <View style={{ gap: 1 }}>
            <AppText variant="caption" color="textSecondary">
              {number.format(row.word_count)} kelime
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {row.reading_minutes} dk · v{row.version}
            </AppText>
          </View>
        ),
      },
      {
        key: 'views',
        label: 'Eski toplam',
        width: 0.7,
        hideOnMobile: true,
        render: (row) => (
          <AppText variant="caption" color="textSecondary">
            {number.format(row.view_count)}
          </AppText>
        ),
      },
      {
        key: 'updated',
        label: 'Güncelleme',
        width: 1,
        hideOnMobile: true,
        render: (row) => (
          <View style={{ gap: 1 }}>
            <AppText variant="caption" color="textTertiary">
              {formatDateTimeTr(row.updated_at)}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {row.updated_by_name ?? '—'}
            </AppText>
          </View>
        ),
      },
      {
        key: 'actions',
        label: '',
        width: 1.35,
        render: (row) => (
          <View style={styles.actions}>
            <Button
              label="Düzenle"
              size="sm"
              variant="secondary"
              fullWidth={false}
              onPress={() => openEdit(row.id)}
            />
            {canManage ? (
              <>
                <Button
                  label={row.status === 'published' ? 'Taslak' : 'Yayınla'}
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  loading={setStatusMutation.isPending}
                  onPress={() => void togglePublish(row)}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Kopyala"
                  onPress={() => void copy(row)}
                  style={styles.iconButton}
                >
                  <Ionicons name="copy-outline" size={16} color={theme.colors.textSecondary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sil"
                  onPress={() => setDeleteTarget(row)}
                  style={styles.iconButton}
                >
                  <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
                </Pressable>
              </>
            ) : null}
          </View>
        ),
      },
    ];

  const rows = posts.data?.items ?? [];
  const data = stats.data;

  return (
    <AdminPage
      title="Blog Yönetimi"
      subtitle="Trabzon rehberlerini yazın, AI ile üretin, SEO meta verilerini yönetin ve yayınlayın. Yayınlanan yazılar anında web sitesinde görünür."
      actions={
        <View style={styles.headerActions}>
          <Badge
            label={canManage ? 'Yazma yetkisi' : 'Salt okunur'}
            tone={canManage ? 'success' : 'neutral'}
          />
          <Button
            label="AI ayarları"
            variant="outline"
            size="sm"
            fullWidth={false}
            leftIcon={<Ionicons name="sparkles-outline" size={15} color={theme.colors.text} />}
            onPress={() => setAiSettingsOpen(true)}
          />
          <Button
            label="Yeni yazı"
            size="sm"
            fullWidth={false}
            disabled={!canManage}
            leftIcon={<Ionicons name="add" size={15} color={theme.colors.onPrimary} />}
            onPress={openNew}
          />
        </View>
      }
    >
      <StatGrid>
        <StatCard label="Toplam yazı" value={number.format(data?.total ?? 0)} icon="document-text-outline" />
        <StatCard
          label="Yayında"
          value={number.format(data?.published ?? 0)}
          icon="checkmark-circle-outline"
          tone="success"
          hint={data?.scheduled ? `${data.scheduled} zamanlanmış` : undefined}
        />
        <StatCard
          label="Taslak"
          value={number.format(data?.draft ?? 0)}
          icon="create-outline"
          tone="warning"
        />
        <StatCard
          label="Görüntüleme"
          value={number.format(data?.views ?? 0)}
          icon="eye-outline"
          tone="accent"
        />
        <StatCard
          label="Toplam kelime"
          value={number.format(data?.words ?? 0)}
          icon="text-outline"
          hint={`${number.format(data?.ai_generated ?? 0)} AI destekli`}
        />
      </StatGrid>

      <AdminSection
        title="Yazılar"
        subtitle="Başlık, slug, kategori veya etikette arayın. Yayında olan yazılar /blog adresinde listelenir."
        action={
          <Badge
            label={`${number.format(posts.data?.total ?? 0)} kayıt`}
            tone="neutral"
          />
        }
      >
        <View style={styles.toolbar}>
          <TextField
            value={search}
            onChangeText={setSearch}
            placeholder="Başlık, slug, kategori veya etiket ara…"
            leftIcon="search-outline"
            containerStyle={styles.search}
          />
          <FilterChips
            options={[
              { key: 'all' as const, label: 'Tümü' },
              { key: 'published' as const, label: 'Yayında', count: data?.published },
              { key: 'draft' as const, label: 'Taslak', count: data?.draft },
              { key: 'archived' as const, label: 'Arşiv', count: data?.archived },
            ]}
            value={status}
            onChange={setStatus}
          />
        </View>

        <DataTable
          columns={columns}
          rows={rows}
          keyExtractor={(row) => row.id}
          loading={posts.isLoading}
          empty={
            <View style={[styles.empty, { borderColor: theme.colors.border }]}>
              <Ionicons name="document-text-outline" size={28} color={theme.colors.textTertiary} />
              <AppText variant="title">Yazı bulunamadı</AppText>
              <AppText variant="caption" color="textTertiary" style={styles.emptyText}>
                Arama veya durum filtresini değiştirin; ya da AI ile ilk yazıyı üretin.
              </AppText>
              {canManage ? (
                <Button
                  label="Yeni yazı oluştur"
                  size="sm"
                  fullWidth={false}
                  onPress={openNew}
                />
              ) : null}
            </View>
          }
        />
      </AdminSection>

      <AppText variant="caption" color="textTertiary">
        Yayınlanan yazılar sunucu tarafında SEO etiketleri, JSON-LD (BlogPosting, BreadcrumbList,
        FAQPage) ve sitemap kaydıyla birlikte sunulur. Slug değişikliği eski bağlantıyı kırar;
        yayındaki bir yazının adresini değiştirirken dikkatli olun.
      </AppText>

      <BlogEditorModal
        visible={editorOpen}
        postId={editingId}
        canManage={canManage}
        onClose={() => setEditorOpen(false)}
        onSaved={() => undefined}
      />
      <BlogAiSettingsModal visible={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
      <ReasonDialog
        visible={Boolean(deleteTarget)}
        title="Blog yazısını sil"
        description={
          deleteTarget
            ? `"${deleteTarget.title}" kalıcı olarak silinecek. Bu işlem geri alınamaz.`
            : undefined
        }
        confirmLabel="Kalıcı olarak sil"
        destructive
        loading={remove.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(input) => void confirmDelete(input)}
      />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  toolbar: { gap: 12, marginBottom: 12 },
  search: { maxWidth: 520 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  iconButton: { padding: 7 },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 26,
    alignItems: 'center',
    gap: 7,
  },
  emptyText: { textAlign: 'center', maxWidth: 420 },
});

