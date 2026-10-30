import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, IconButton, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminMe,
  useAnnouncementSave,
  useAnnouncementToggle,
  useAnnouncements,
  useCmsPage,
  useCmsPageArchive,
  useCmsPageSave,
  useCmsPages,
} from '@/features/admin/hooks/use-admin';
import type { Announcement, CmsPageSummary } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

type Tab = 'pages' | 'announcements';

export default function AdminContentScreen() {
  const me = useAdminMe();
  const canManage = (me.data?.permissions ?? []).includes('cms.manage');
  const [tab, setTab] = useState<Tab>('pages');

  return (
    <AdminPage
      title="İçerik Yönetimi"
      subtitle="Uygulama içi sayfalar, hukuki metinler, duyurular ve sürüm geçmişi."
      actions={
        <Badge
          label={canManage ? 'Düzenleme yetkisi' : 'Salt okunur'}
          tone={canManage ? 'success' : 'neutral'}
        />
      }
    >
      <FilterChips
        options={[
          { key: 'pages' as const, label: 'Sayfalar' },
          { key: 'announcements' as const, label: 'Duyurular' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'pages' ? (
        <PagesPanel canManage={canManage} />
      ) : (
        <AnnouncementsPanel canManage={canManage} />
      )}
      <AppText variant="caption" color="textTertiary">
        Hukuki metinler yayınlandığında sürüm numarası ve yayın tarihi korunur. Eski sürümler
        denetim amacıyla saklanır; yayınlanmış metinler doğrudan silinmez.
      </AppText>
    </AdminPage>
  );
}

function PagesPanel({ canManage }: { canManage: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editorSlug, setEditorSlug] = useState<string | null | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<CmsPageSummary | null>(null);
  const pages = useCmsPages(search, status, 50, 0);
  const archive = useCmsPageArchive();

  const columns: Column<CmsPageSummary>[] = [
    {
      key: 'title',
      label: 'Sayfa',
      width: 2.2,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
            {row.title}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            /{row.slug} · {row.locale}
          </AppText>
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
      key: 'version',
      label: 'Sürüm',
      width: 0.5,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          v{row.version}
        </AppText>
      ),
    },
    {
      key: 'updated',
      label: 'Son güncelleme',
      width: 1,
      hideOnMobile: true,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <AppText variant="caption" color="textTertiary">
            {formatDateTimeTr(row.updated_at)}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {row.updated_by_name ?? '—'}
          </AppText>
        </View>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: 0.8,
      render: (row) => (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {canManage ? (
            <>
              <Button
                label="Düzenle"
                size="sm"
                variant="ghost"
                fullWidth={false}
                onPress={() => setEditorSlug(row.slug)}
              />
              {row.status !== 'archived' ? (
                <Button
                  label="Arşivle"
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => setArchiveTarget(row)}
                />
              ) : null}
            </>
          ) : null}
        </View>
      ),
    },
  ];

  return (
    <>
      <AdminSection
        title="Sayfalar"
        subtitle="Lobi metinleri, yardım merkezi, SSS, topluluk kuralları ve bilgilendirme sayfaları."
        action={
          canManage ? (
            <Button
              label="Yeni sayfa"
              size="sm"
              fullWidth={false}
              leftIcon={<Ionicons name="add" size={14} color={theme.colors.onPrimary} />}
              onPress={() => setEditorSlug(null)}
            />
          ) : null
        }
      >
        <View style={styles.toolbar}>
          <View
            style={[
              styles.searchWrap,
              { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground },
            ]}
          >
            <Ionicons name="search" size={15} color={theme.colors.textTertiary} />
            <TextField
              placeholder="Başlık, slug veya metin ara…"
              value={search}
              onChangeText={setSearch}
              style={styles.searchField}
            />
          </View>
          <FilterChips
            options={[
              { key: '' as const, label: 'Tümü' },
              { key: 'published' as const, label: 'Yayında' },
              { key: 'draft' as const, label: 'Taslak' },
              { key: 'archived' as const, label: 'Arşiv' },
            ]}
            value={status ?? ''}
            onChange={(value) => setStatus(value || null)}
          />
        </View>

        <DataTable
          columns={columns}
          rows={pages.data?.items ?? []}
          keyExtractor={(row) => row.slug}
          loading={pages.isLoading}
          empty={
            <View style={[styles.empty, { borderColor: theme.colors.border }]}>
              <Ionicons name="document-text-outline" size={22} color={theme.colors.textTertiary} />
              <AppText variant="body" color="textSecondary">
                Sayfa bulunamadı.
              </AppText>
            </View>
          }
        />
      </AdminSection>

      <CmsEditor
        slug={editorSlug}
        onClose={() => setEditorSlug(undefined)}
        onSaved={(message) => {
          toast.success(message);
          setEditorSlug(undefined);
          void pages.refetch();
        }}
      />

      <ReasonDialog
        visible={Boolean(archiveTarget)}
        title="Sayfayı arşivle"
        description="Sayfa yayından kaldırılır; sürüm geçmişi korunur."
        confirmLabel="Arşivle"
        destructive
        loading={archive.isPending}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={async ({ reason }) => {
          if (!archiveTarget) return;
          try {
            await archive.mutateAsync({ slug: archiveTarget.slug, reason });
            setArchiveTarget(null);
            toast.success('Sayfa arşivlendi.');
            void pages.refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Sayfa arşivlenemedi.');
          }
        }}
      />
    </>
  );
}

function CmsEditor({
  slug,
  onClose,
  onSaved,
}: {
  slug: string | null | undefined;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const visible = slug !== undefined;
  const isNew = slug === null;
  const page = useCmsPage(isNew ? null : slug);
  const save = useCmsPageSave();
  const [form, setForm] = useState({ slug: '', title: '', body: '', locale: 'tr', publish: false });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible) return;
    if (isNew) {
      setForm({ slug: '', title: '', body: '', locale: 'tr', publish: false });
    } else if (page.data) {
      setForm({
        slug: page.data.slug,
        title: page.data.title,
        body: page.data.body,
        locale: page.data.locale,
        publish: page.data.status === 'published',
      });
    }
    setReason('');
    setError(null);
  }, [visible, isNew, page.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = async () => {
    if (
      form.slug.trim().length < 2 ||
      form.title.trim().length < 3 ||
      form.body.trim().length < 10
    ) {
      setError('Slug, başlık ve içerik zorunludur (içerik en az 10 karakter).');
      return;
    }
    if (reason.trim().length < 3) {
      setError('İşlem gerekçesi en az 3 karakter olmalı.');
      return;
    }
    try {
      await save.mutateAsync({
        slug: form.slug.trim(),
        title: form.title.trim(),
        body: form.body,
        locale: form.locale.trim() || 'tr',
        publish: form.publish,
        reason: reason.trim(),
      });
      onSaved(
        form.publish ? 'Sayfa yayınlandı ve yeni sürüm oluşturuldu.' : 'Sayfa taslağı kaydedildi.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sayfa kaydedilemedi.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.panel,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
            <View style={{ flex: 1 }}>
              <AppText variant="h3">
                {isNew ? 'Yeni sayfa' : `Sayfayı düzenle · v${page.data?.version ?? '—'}`}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                Önizleme ve yayınlama ayrı adımlardır; yayınlanan sürüm geriye dönük korunur.
              </AppText>
            </View>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>

          {!isNew && page.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 14, gap: 10 }}
            >
              <View style={styles.twoCol}>
                <View style={styles.flex}>
                  <TextField
                    label="Slug"
                    value={form.slug}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, slug: value }))}
                    placeholder="topluluk-kurallari"
                    autoCapitalize="none"
                    editable={isNew}
                  />
                </View>
                <View style={{ width: 100 }}>
                  <TextField
                    label="Dil"
                    value={form.locale}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, locale: value }))}
                    placeholder="tr"
                    autoCapitalize="none"
                  />
                </View>
              </View>
              <TextField
                label="Başlık"
                value={form.title}
                onChangeText={(value) => setForm((prev) => ({ ...prev, title: value }))}
                placeholder="Sayfa başlığı"
              />
              <TextField
                label="İçerik"
                value={form.body}
                onChangeText={(value) => setForm((prev) => ({ ...prev, body: value }))}
                placeholder="Sayfa metni…"
                multiline
                style={{ minHeight: 160, textAlignVertical: 'top' }}
                hint={`${form.body.length} karakter`}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => setForm((prev) => ({ ...prev, publish: !prev.publish }))}
                style={[styles.toggleRow, { borderColor: theme.colors.border }]}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: form.publish ? theme.colors.primary : theme.colors.borderStrong,
                      backgroundColor: form.publish ? theme.colors.primary : 'transparent',
                    },
                  ]}
                >
                  {form.publish ? (
                    <Ionicons name="checkmark" size={12} color={theme.colors.onPrimary} />
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">Yayınla</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Kapalıysa taslak olarak kaydedilir.
                  </AppText>
                </View>
              </Pressable>
              <TextField
                label="İşlem gerekçesi"
                value={reason}
                onChangeText={setReason}
                placeholder="Neden değiştirildi?"
                maxLength={400}
                hint="Denetim kaydına yazılır."
              />
              {page.data && page.data.versions.length > 0 ? (
                <View style={{ gap: 4 }}>
                  <AppText variant="bodyStrong">Sürüm geçmişi</AppText>
                  {page.data.versions.slice(0, 8).map((version) => (
                    <View
                      key={`${version.version}-${version.created_at}`}
                      style={[styles.versionRow, { borderColor: theme.colors.divider }]}
                    >
                      <Badge label={`v${version.version}`} tone="neutral" />
                      <AppText
                        variant="caption"
                        color="textSecondary"
                        style={{ flex: 1 }}
                        numberOfLines={1}
                      >
                        {version.title}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {formatDateTimeTr(version.created_at)}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : null}
              {error ? (
                <AppText variant="caption" color="danger">
                  {error}
                </AppText>
              ) : null}
              <View style={styles.formActions}>
                <Button
                  label="Vazgeç"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={onClose}
                />
                <Button
                  label={form.publish ? 'Yayınla' : 'Taslak kaydet'}
                  size="sm"
                  fullWidth={false}
                  loading={save.isPending}
                  onPress={() => void submit()}
                />
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function AnnouncementsPanel({ canManage }: { canManage: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const list = useAnnouncements();
  const toggle = useAnnouncementToggle();
  const [editor, setEditor] = useState<Announcement | null | undefined>(undefined);
  const [pendingToggle, setPendingToggle] = useState<Announcement | null>(null);

  return (
    <>
      <AdminSection
        title="Sistem duyuruları"
        subtitle="Uygulama içi banner ve kritik bilgilendirmeler."
        action={
          canManage ? (
            <Button
              label="Yeni duyuru"
              size="sm"
              fullWidth={false}
              leftIcon={<Ionicons name="add" size={14} color={theme.colors.onPrimary} />}
              onPress={() => setEditor(null)}
            />
          ) : null
        }
      >
        <View style={styles.statRow}>
          <Badge label={`${list.data?.stats.live ?? 0} yayında`} tone="success" />
          <Badge label={`${list.data?.stats.scheduled ?? 0} zamanlanmış`} tone="warning" />
          <Badge label={`${list.data?.stats.active ?? 0} aktif`} tone="neutral" />
        </View>
        {list.isLoading ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 22 }} />
        ) : (list.data?.items.length ?? 0) === 0 ? (
          <AppText variant="caption" color="textTertiary" style={{ paddingVertical: 18 }}>
            Duyuru yok.
          </AppText>
        ) : (
          list.data?.items.map((item) => (
            <View
              key={item.id}
              style={[styles.announcementRow, { borderColor: theme.colors.divider }]}
            >
              <View
                style={[
                  styles.announcementIcon,
                  {
                    backgroundColor:
                      item.level === 'critical'
                        ? theme.colors.dangerSoft
                        : item.level === 'warning'
                          ? theme.colors.warningSoft
                          : theme.colors.primarySoft,
                  },
                ]}
              >
                <Ionicons
                  name={
                    item.level === 'critical'
                      ? 'alert-circle-outline'
                      : item.level === 'warning'
                        ? 'warning-outline'
                        : 'information-circle-outline'
                  }
                  size={17}
                  color={
                    item.level === 'critical'
                      ? theme.colors.danger
                      : item.level === 'warning'
                        ? theme.colors.warning
                        : theme.colors.primary
                  }
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View
                  style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <AppText variant="caption" style={{ fontWeight: '700' }}>
                    {item.title}
                  </AppText>
                  {item.live ? <Badge label="Yayında" tone="success" /> : null}
                  <Badge
                    label={item.level}
                    tone={
                      item.level === 'critical'
                        ? 'danger'
                        : item.level === 'warning'
                          ? 'warning'
                          : 'neutral'
                    }
                  />
                </View>
                <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                  {item.body}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {formatDateTimeTr(item.starts_at)} →{' '}
                  {item.ends_at ? formatDateTimeTr(item.ends_at) : 'süresiz'} ·{' '}
                  {item.created_by_name ?? '—'}
                </AppText>
              </View>
              {canManage ? (
                <View style={{ gap: 4 }}>
                  <Button
                    label="Düzenle"
                    size="sm"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => setEditor(item)}
                  />
                  <Button
                    label={item.is_active ? 'Pasifleştir' : 'Etkinleştir'}
                    size="sm"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => setPendingToggle(item)}
                  />
                </View>
              ) : null}
            </View>
          ))
        )}
      </AdminSection>

      <AnnouncementEditor
        visible={editor !== undefined}
        announcement={editor ?? null}
        onClose={() => setEditor(undefined)}
        onSaved={(message) => {
          toast.success(message);
          setEditor(undefined);
          void list.refetch();
        }}
      />

      <ReasonDialog
        visible={Boolean(pendingToggle)}
        title={pendingToggle?.is_active ? 'Duyuruyu pasifleştir' : 'Duyuruyu etkinleştir'}
        description="Duyuru görünürlüğü değişir; işlem denetim kaydına yazılır."
        confirmLabel="Uygula"
        requireReason
        loading={toggle.isPending}
        onCancel={() => setPendingToggle(null)}
        onConfirm={async ({ reason }) => {
          if (!pendingToggle) return;
          try {
            await toggle.mutateAsync({
              id: pendingToggle.id,
              active: !pendingToggle.is_active,
              reason,
            });
            setPendingToggle(null);
            toast.success('Duyuru durumu güncellendi.');
            void list.refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Duyuru güncellenemedi.');
          }
        }}
      />
    </>
  );
}

function AnnouncementEditor({
  visible,
  announcement,
  onClose,
  onSaved,
}: {
  visible: boolean;
  announcement: Announcement | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useAnnouncementSave();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<'info' | 'warning' | 'critical'>('info');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible) return;
    setTitle(announcement?.title ?? '');
    setBody(announcement?.body ?? '');
    setLevel(announcement?.level ?? 'info');
    setStartsAt(announcement?.starts_at ?? '');
    setEndsAt(announcement?.ends_at ?? '');
    setActive(announcement?.is_active ?? true);
    setReason('');
    setError(null);
  }, [visible, announcement]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = async () => {
    if (title.trim().length < 3 || body.trim().length < 3) {
      setError('Başlık ve içerik en az 3 karakter olmalı.');
      return;
    }
    if (!startsAt.trim()) {
      setError('Başlangıç zamanı gerekli (YYYY-MM-DD HH:MM).');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Gerekçe en az 3 karakter olmalı.');
      return;
    }
    try {
      await save.mutateAsync({
        id: announcement?.id ?? null,
        title: title.trim(),
        body: body.trim(),
        level,
        startsAt: startsAt.trim(),
        endsAt: endsAt.trim() || null,
        isActive: active,
        reason: reason.trim(),
      });
      onSaved('Duyuru kaydedildi.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Duyuru kaydedilemedi.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.panel,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
            <AppText variant="h3" style={{ flex: 1 }}>
              {announcement ? 'Duyuruyu düzenle' : 'Yeni duyuru'}
            </AppText>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 14, gap: 10 }}
          >
            <TextField
              label="Başlık"
              value={title}
              onChangeText={setTitle}
              placeholder="Duyuru başlığı"
            />
            <TextField
              label="İçerik"
              value={body}
              onChangeText={setBody}
              placeholder="Duyuru metni"
              multiline
              maxLength={800}
            />
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
              {(['info', 'warning', 'critical'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  onPress={() => setLevel(value)}
                  style={[
                    styles.chip,
                    {
                      borderColor: level === value ? theme.colors.primary : theme.colors.border,
                      backgroundColor: level === value ? theme.colors.primarySoft : 'transparent',
                    },
                  ]}
                >
                  <AppText
                    variant="caption"
                    color={level === value ? 'primaryDeep' : 'textSecondary'}
                  >
                    {value === 'info' ? 'Bilgi' : value === 'warning' ? 'Uyarı' : 'Kritik'}
                  </AppText>
                </Pressable>
              ))}
            </View>
            <View style={styles.twoCol}>
              <View style={styles.flex}>
                <TextField
                  label="Başlangıç"
                  value={startsAt}
                  onChangeText={setStartsAt}
                  placeholder="2026-10-27 20:00"
                  hint="YYYY-MM-DD HH:MM"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.flex}>
                <TextField
                  label="Bitiş (opsiyonel)"
                  value={endsAt}
                  onChangeText={setEndsAt}
                  placeholder="2026-11-03 20:00"
                  hint="Boşsa süresiz"
                  autoCapitalize="none"
                />
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setActive((value) => !value)}
              style={[styles.toggleRow, { borderColor: theme.colors.border }]}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: active ? theme.colors.primary : theme.colors.borderStrong,
                    backgroundColor: active ? theme.colors.primary : 'transparent',
                  },
                ]}
              >
                {active ? (
                  <Ionicons name="checkmark" size={12} color={theme.colors.onPrimary} />
                ) : null}
              </View>
              <AppText variant="body">Duyuru aktif</AppText>
            </Pressable>
            <TextField
              label="İşlem gerekçesi"
              value={reason}
              onChangeText={setReason}
              placeholder="Neden yayınlanıyor?"
              maxLength={400}
            />
            {error ? (
              <AppText variant="caption" color="danger">
                {error}
              </AppText>
            ) : null}
            <View style={styles.formActions}>
              <Button
                label="Vazgeç"
                size="sm"
                variant="secondary"
                fullWidth={false}
                onPress={onClose}
              />
              <Button
                label="Kaydet"
                size="sm"
                fullWidth={false}
                loading={save.isPending}
                onPress={() => void submit()}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 180 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  searchWrap: {
    flexGrow: 1,
    flexBasis: 240,
    minWidth: 220,
    height: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  searchField: { flex: 1, height: 32, borderWidth: 0, backgroundColor: 'transparent' },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  panel: {
    width: '100%',
    maxWidth: 680,
    maxHeight: '90%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelHead: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  loading: { padding: 40, alignItems: 'center' },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    padding: 9,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 5,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  statRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  announcementRow: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  announcementIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
});
