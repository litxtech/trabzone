import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminDeleteLegalDocument,
  useAdminDeleteLegalVersion,
  useAdminLegalVersions,
  useAdminPublishLegalDocument,
  useAdminSaveLegalDocument,
  useAdminUnpublishLegalDocument,
} from '@/features/legal/hooks/use-legal';
import { PUBLIC_LEGAL_PAGES, legalPath } from '@/features/legal/catalog';
import type { LegalAdminVersion, LegalDocType } from '@/features/legal/types';
import { PolicyBody } from '@/features/safety/components/PolicyBody';
import { parsePolicyMarkdown } from '@/features/safety/utils/policy-markdown';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatDateTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

const DOC_TYPES: { key: LegalDocType; label: string }[] = [
  { key: 'contract', label: 'Sözleşme' },
  { key: 'policy', label: 'Politika' },
  { key: 'notice', label: 'Aydınlatma' },
  { key: 'rules', label: 'Kurallar' },
  { key: 'disclosure', label: 'Bildirim' },
];

const DOC_LABEL: Record<string, string> = Object.fromEntries(
  PUBLIC_LEGAL_PAGES.map((item) => [item.slug, item.title]),
);

/** Panelde gösterilecek genel site adresi (yayın sonrası kontrol için). */
const SITE_URL = 'https://www.trabzoneapp.com';

function publicHref(slug: string) {
  return `${SITE_URL}${legalPath(slug)}`;
}

function openPublicPage(slug: string) {
  const url = publicHref(slug);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(url).catch(() => undefined);
}

type Group = {
  slug: string;
  title: string;
  versions: LegalAdminVersion[];
  latest: LegalAdminVersion;
  published: LegalAdminVersion | null;
  draft: LegalAdminVersion | null;
};

type EditorState = {
  slug: string;
  title: string;
  summary: string;
  bodyMd: string;
  docType: LegalDocType;
  requiresAcceptance: boolean;
  requiresReacceptance: boolean;
  effectiveAt: string;
  changeSummary: string;
};

const emptyEditor = (): EditorState => ({
  slug: 'terms',
  title: '',
  summary: '',
  bodyMd: '',
  docType: 'policy',
  requiresAcceptance: true,
  requiresReacceptance: false,
  effectiveAt: '',
  changeSummary: '',
});

const editorFrom = (version: LegalAdminVersion): EditorState => ({
  slug: version.slug,
  title: version.title,
  summary: version.summary ?? '',
  bodyMd: version.body_md,
  docType: version.doc_type,
  requiresAcceptance: version.requires_acceptance,
  requiresReacceptance: version.requires_reacceptance,
  effectiveAt: version.effective_at ? version.effective_at.slice(0, 10) : '',
  changeSummary: version.change_summary ?? '',
});

function StatusPill({ version }: { version: LegalAdminVersion }) {
  if (version.archived_at) {
    return <Badge label="Arşiv" tone="neutral" />;
  }
  if (version.is_published) {
    return <Badge label="Yayında" tone="success" />;
  }
  return <Badge label="Taslak" tone="warning" />;
}

function diffLines(previous: string, next: string) {
  const before = previous.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const after = next.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const beforeCount = new Map<string, number>();
  const afterCount = new Map<string, number>();
  for (const line of before) {
    beforeCount.set(line, (beforeCount.get(line) ?? 0) + 1);
  }
  for (const line of after) {
    afterCount.set(line, (afterCount.get(line) ?? 0) + 1);
  }
  const rows: { type: 'same' | 'add' | 'remove'; text: string }[] = [];
  for (const line of before) {
    if ((afterCount.get(line) ?? 0) > 0) {
      afterCount.set(line, (afterCount.get(line) ?? 1) - 1);
    } else {
      rows.push({ type: 'remove', text: line });
    }
  }
  for (const line of after) {
    if ((beforeCount.get(line) ?? 0) > 0) {
      beforeCount.set(line, (beforeCount.get(line) ?? 1) - 1);
    } else {
      rows.push({ type: 'add', text: line });
    }
  }
  return rows;
}

export default function AdminLegalScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const { width } = useWindowDimensions();
  const compact = width < 860;

  const versionsQuery = useAdminLegalVersions(null);
  const save = useAdminSaveLegalDocument();
  const publish = useAdminPublishLegalDocument();
  const unpublish = useAdminUnpublishLegalDocument();
  const deleteVersion = useAdminDeleteLegalVersion();
  const deleteDocument = useAdminDeleteLegalDocument();

  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorTab, setEditorTab] = useState<'write' | 'preview'>('write');
  const [publishTarget, setPublishTarget] = useState<EditorState | null>(null);
  const [versionsFor, setVersionsFor] = useState<Group | null>(null);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [compareNext, setCompareNext] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'document'; slug: string; title: string; versions: number }
    | { kind: 'version'; id: string; label: string }
    | null
  >(null);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, LegalAdminVersion[]>();
    for (const version of versionsQuery.data ?? []) {
      const list = map.get(version.slug) ?? [];
      list.push(version);
      map.set(version.slug, list);
    }
    return Array.from(map.entries())
      .map(([slug, list]) => {
        const sorted = [...list].sort((a, b) => b.version - a.version);
        return {
          slug,
          title: sharedTitle(sorted),
          versions: sorted,
          latest: sorted[0]!,
          published: sorted.find((item) => item.is_published && !item.archived_at) ?? null,
          draft: sorted.find((item) => !item.is_published && !item.archived_at) ?? null,
        };
      })
      .sort((a, b) => (DOC_LABEL[a.slug] ?? a.slug).localeCompare(DOC_LABEL[b.slug] ?? b.slug, 'tr'));
  }, [versionsQuery.data]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr-TR');
    return groups.filter((group) => {
      if (filter === 'published' && !group.published) {
        return false;
      }
      if (filter === 'draft' && !group.draft) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        group.slug.includes(term) ||
        group.title.toLocaleLowerCase('tr-TR').includes(term) ||
        (DOC_LABEL[group.slug] ?? '').toLocaleLowerCase('tr-TR').includes(term)
      );
    });
  }, [filter, groups, search]);

  const publishedCount = groups.filter((group) => group.published).length;
  const draftCount = groups.filter((group) => group.draft).length;
  const acceptanceTotal = (versionsQuery.data ?? []).reduce(
    (total, version) => total + (version.is_published ? version.acceptance_count : 0),
    0,
  );

  const submit = (state: EditorState, shouldPublish: boolean) => {
    if (state.slug.trim().length < 3) {
      toast.error('Belge adresi en az 3 karakter olmalı.');
      return;
    }
    if (state.title.trim().length < 3) {
      toast.error('Başlık en az 3 karakter olmalı.');
      return;
    }
    if (state.bodyMd.trim().length < 80) {
      toast.error('Belge gövdesi en az 80 karakter olmalı.');
      return;
    }
    save.mutate(
      {
        slug: state.slug.trim(),
        title: state.title.trim(),
        summary: state.summary.trim() || null,
        bodyMd: state.bodyMd,
        docType: state.docType,
        requiresAcceptance: state.requiresAcceptance,
        requiresReacceptance: state.requiresAcceptance ? state.requiresReacceptance : false,
        effectiveAt: state.effectiveAt.trim() ? `${state.effectiveAt.trim()}T00:00:00Z` : null,
        changeSummary: state.changeSummary.trim() || null,
        publish: shouldPublish,
      },
      {
        onSuccess: () => {
          haptics.success();
          toast.success(shouldPublish ? 'Belge yayınlandı.' : 'Taslak kaydedildi.');
          setEditor(null);
          setPublishTarget(null);
        },
        onError: (error) => {
          haptics.error();
          toast.error(error.message);
        },
      },
    );
  };

  const runUnpublish = (id: string) => {
    setBusyId(id);
    unpublish.mutate(
      { id, reason: 'Yönetici tarafından yayından kaldırıldı.' },
      {
        onSuccess: (result) => {
          toast.success(
            result.previous_version
              ? `Sürüm yayından kaldırıldı. v${result.previous_version} yeniden yürürlükte.`
              : 'Sürüm yayından kaldırıldı. Belge artık sitede görünmüyor.',
          );
          setVersionsFor(null);
        },
        onError: (error) => toast.error(error.message),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const confirmDelete = () => {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    if (target.kind === 'document') {
      setBusyId(target.slug);
      deleteDocument.mutate(
        { slug: target.slug },
        {
          onSuccess: (result) => {
            haptics.success();
            toast.success(`Belge silindi (${result.deleted_versions} sürüm). Siteden kaldırıldı.`);
            setDeleteTarget(null);
            setVersionsFor(null);
          },
          onError: (error) => {
            haptics.error();
            toast.error(error.message);
          },
          onSettled: () => setBusyId(null),
        },
      );
      return;
    }

    setBusyId(target.id);
    deleteVersion.mutate(
      { id: target.id },
      {
        onSuccess: () => {
          haptics.success();
          toast.success('Sürüm silindi.');
          setDeleteTarget(null);
        },
        onError: (error) => {
          haptics.error();
          toast.error(error.message);
        },
        onSettled: () => setBusyId(null),
      },
    );
  };

  const runPublish = (id: string) => {
    setBusyId(id);
    publish.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success('Sürüm yayınlandı. Değişiklik site ve uygulamada anında yayında.');
          setVersionsFor(null);
        },
        onError: (error) => toast.error(error.message),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const compareRows = useMemo(() => {
    if (!versionsFor || !compareBase || !compareNext) {
      return [];
    }
    const base = versionsFor.versions.find((item) => item.id === compareBase);
    const next = versionsFor.versions.find((item) => item.id === compareNext);
    if (!base || !next) {
      return [];
    }
    return diffLines(base.body_md, next.body_md);
  }, [compareBase, compareNext, versionsFor]);

  return (
    <AdminPage
      title="Hukuk ve Politikalar"
      subtitle="Sürümlü belge kaynağı. Yayınlanan metinler değiştirilemez; her düzenleme yeni taslak üretir ve kabul kayıtları korunur."
      refreshing={versionsQuery.isRefetching}
      onRefresh={() => void versionsQuery.refetch()}
      actions={
        <Button
          label="Yeni belge"
          size="sm"
          fullWidth={false}
          leftIcon={<Ionicons name="add" size={16} color="#FFFFFF" />}
          onPress={() => {
            setEditor(emptyEditor());
            setEditorTab('write');
          }}
        />
      }
    >
      <View style={styles.stats}>
        <Stat icon="documents-outline" label="Belge türü" value={String(groups.length)} />
        <Stat icon="checkmark-circle-outline" label="Yayında" value={String(publishedCount)} />
        <Stat icon="create-outline" label="Taslak" value={String(draftCount)} />
        <Stat icon="shield-checkmark-outline" label="Kabul kaydı" value={String(acceptanceTotal)} />
      </View>

      <AdminSection
        title="Belge kataloğu"
        subtitle="Taslak oluştur, sürüm geçmişini incele ve yetkili onayla yayınla."
      >
        <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
          <View style={styles.chips}>
            <FilterChips
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'all', label: 'Tümü', count: groups.length },
                { key: 'published', label: 'Yayında', count: publishedCount },
                { key: 'draft', label: 'Taslak', count: draftCount },
              ]}
            />
          </View>
          <View
            style={[
              styles.search,
              { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="search-outline" size={16} color={theme.colors.textTertiary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Belge ara"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.searchInput, { color: theme.colors.text }]}
              accessibilityLabel="Belge ara"
            />
          </View>
        </View>

        {versionsQuery.isLoading ? (
          <AppText variant="body" color="textSecondary">
            Belgeler yükleniyor…
          </AppText>
        ) : versionsQuery.isError ? (
          <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="lock-closed-outline" size={18} color={theme.colors.danger} />
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              Bu alan için `safety.policy.manage` yetkisi gerekir.
            </AppText>
          </View>
        ) : visible.length === 0 ? (
          <AppText variant="body" color="textSecondary">
            Kayıt bulunamadı.
          </AppText>
        ) : (
          <View style={styles.list}>
            {visible.map((group) => {
              const active = group.published ?? group.latest;
              return (
                <View
                  key={group.slug}
                  style={[
                    styles.row,
                    {
                      backgroundColor: theme.colors.surfaceElevated,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                    },
                    compact && styles.rowCompact,
                  ]}
                >
                  <View style={styles.flex}>
                    <View style={styles.rowTitle}>
                      <AppText variant="bodyStrong" numberOfLines={1}>
                        {DOC_LABEL[group.slug] ?? group.title}
                      </AppText>
                      {group.published ? (
                        <Badge label={`v${group.published.version}`} tone="success" />
                      ) : (
                        <Badge label="Yayın yok" tone="danger" />
                      )}
                      {group.draft ? <Badge label="Taslak" tone="warning" /> : null}
                    </View>
                    <AppText variant="caption" color="textTertiary">
                      {legalPath(group.slug)} · {group.versions.length} sürüm ·{' '}
                      {active.effective_at
                        ? `Yürürlük ${formatDateTr(active.effective_at)}`
                        : 'Yürürlük tarihi yok'}
                      {group.published ? ` · ${group.published.acceptance_count} kabul` : ''}
                    </AppText>
                    <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                      {active.title}
                    </AppText>
                  </View>
                  <View style={[styles.rowActions, compact && styles.rowActionsCompact]}>
                    <Button
                      label={group.draft ? 'Taslağı düzenle' : 'Yeni sürüm'}
                      size="sm"
                      variant="secondary"
                      fullWidth={false}
                      onPress={() => {
                        setEditor(editorFrom(group.draft ?? active));
                        setEditorTab('write');
                      }}
                    />
                    <Button
                      label="Sürümler"
                      size="sm"
                      variant="outline"
                      fullWidth={false}
                      onPress={() => {
                        setVersionsFor(group);
                        setCompareBase(null);
                        setCompareNext(null);
                      }}
                    />
                    <Button
                      label="Sitede gör"
                      size="sm"
                      variant="outline"
                      fullWidth={false}
                      disabled={!group.published}
                      leftIcon={
                        <Ionicons
                          name="open-outline"
                          size={14}
                          color={group.published ? theme.colors.primaryDeep : theme.colors.textTertiary}
                        />
                      }
                      onPress={() => openPublicPage(group.slug)}
                    />
                    <Button
                      label="Sil"
                      size="sm"
                      variant="danger"
                      fullWidth={false}
                      disabled={
                        busyId === group.slug ||
                        group.versions.some((version) => version.acceptance_count > 0)
                      }
                      onPress={() =>
                        setDeleteTarget({
                          kind: 'document',
                          slug: group.slug,
                          title: DOC_LABEL[group.slug] ?? group.title,
                          versions: group.versions.length,
                        })
                      }
                    />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </AdminSection>

      <AdminSection title="Yayın kuralları" subtitle="Hukuki kontrol olmadan yayın yapılmaz.">
        <Rule text="Yayınlanan değişiklik site ve uygulamada anında yayına girer; sayfa yenilemek gerekmez." />
        <Rule text="Yayınlanmış bir sürüm düzenlenemez; düzenleme her zaman yeni taslak oluşturur." />
        <Rule text="Kabul kayıtları silinmez; kabul almış bir belge silinemez, yalnızca yayından kaldırılır." />
        <Rule text="Yayından kaldırılan sürümün yerine varsa önceki yayınlanmış sürüm yürürlüğe döner." />
        <Rule text="Yeni metin yayınlanmadan önce hukuk danışmanı tarafından kontrol edilmelidir." />
        <Rule text="Onay gerektiren değişikliklerde kullanıcıya yeniden kabul ekranı gösterilir." />
      </AdminSection>

      {/* Editör */}
      <Modal
        visible={Boolean(editor)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditor(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setEditor(null)} accessibilityLabel="Kapat" />
          {editor ? (
            <View
              style={[
                styles.modalCard,
                compact && styles.modalCardCompact,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.modalHead}>
                <View style={styles.flex}>
                  <AppText variant="h3">Belge düzenle</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Markdown · sürüm ve hash sunucuda üretilir
                  </AppText>
                </View>
                <Pressable onPress={() => setEditor(null)} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>

              <View style={styles.tabs}>
                <Tab label="Yaz" active={editorTab === 'write'} onPress={() => setEditorTab('write')} />
                <Tab
                  label="Önizleme"
                  active={editorTab === 'preview'}
                  onPress={() => setEditorTab('preview')}
                />
              </View>

              {editorTab === 'write' ? (
                <ScrollView style={styles.editorScroll} contentContainerStyle={styles.form}>
                  <View style={[styles.formRow, compact && styles.formRowCompact]}>
                    <Field label="Belge adresi (slug)">
                      <TextInput
                        value={editor.slug}
                        onChangeText={(slug) => setEditor({ ...editor, slug: slug.toLowerCase() })}
                        placeholder="orn. terms"
                        autoCapitalize="none"
                        placeholderTextColor={theme.colors.textTertiary}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.inputBackground,
                            borderColor: theme.colors.border,
                          },
                        ]}
                      />
                    </Field>
                    <Field label="Belge türü">
                      <View style={styles.chips}>
                        {DOC_TYPES.map((type) => (
                          <Pressable
                            key={type.key}
                            onPress={() => setEditor({ ...editor, docType: type.key })}
                            style={[
                              styles.typeChip,
                              {
                                backgroundColor:
                                  editor.docType === type.key
                                    ? theme.colors.primarySoft
                                    : theme.colors.surfaceMuted,
                                borderColor:
                                  editor.docType === type.key
                                    ? theme.colors.primary
                                    : theme.colors.border,
                              },
                            ]}
                          >
                            <AppText
                              variant="caption"
                              color={editor.docType === type.key ? 'primaryDeep' : 'textSecondary'}
                            >
                              {type.label}
                            </AppText>
                          </Pressable>
                        ))}
                      </View>
                    </Field>
                  </View>

                  <Field label="Başlık">
                    <TextInput
                      value={editor.title}
                      onChangeText={(title) => setEditor({ ...editor, title })}
                      placeholder="Belge başlığı"
                      placeholderTextColor={theme.colors.textTertiary}
                      style={[
                        styles.input,
                        {
                          color: theme.colors.text,
                          backgroundColor: theme.colors.inputBackground,
                          borderColor: theme.colors.border,
                        },
                      ]}
                    />
                  </Field>

                  <Field label="Kısa özet">
                    <TextInput
                      value={editor.summary}
                      onChangeText={(summary) => setEditor({ ...editor, summary })}
                      placeholder="Kullanıcıya gösterilecek kısa açıklama"
                      placeholderTextColor={theme.colors.textTertiary}
                      style={[
                        styles.input,
                        {
                          color: theme.colors.text,
                          backgroundColor: theme.colors.inputBackground,
                          borderColor: theme.colors.border,
                        },
                      ]}
                    />
                  </Field>

                  <View style={[styles.formRow, compact && styles.formRowCompact]}>
                    <Field label="Yürürlük tarihi (YYYY-AA-GG)">
                      <TextInput
                        value={editor.effectiveAt}
                        onChangeText={(effectiveAt) => setEditor({ ...editor, effectiveAt })}
                        placeholder="2026-11-01"
                        autoCapitalize="none"
                        placeholderTextColor={theme.colors.textTertiary}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.inputBackground,
                            borderColor: theme.colors.border,
                          },
                        ]}
                      />
                    </Field>
                    <Field label="Değişiklik özeti">
                      <TextInput
                        value={editor.changeSummary}
                        onChangeText={(changeSummary) => setEditor({ ...editor, changeSummary })}
                        placeholder="Bu sürümde ne değişti?"
                        placeholderTextColor={theme.colors.textTertiary}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.inputBackground,
                            borderColor: theme.colors.border,
                          },
                        ]}
                      />
                    </Field>
                  </View>

                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: editor.requiresAcceptance }}
                    onPress={() =>
                      setEditor({
                        ...editor,
                        requiresAcceptance: !editor.requiresAcceptance,
                        requiresReacceptance: editor.requiresAcceptance
                          ? false
                          : editor.requiresReacceptance,
                      })
                    }
                    style={[
                      styles.acceptanceRow,
                      {
                        backgroundColor: editor.requiresAcceptance
                          ? theme.colors.primarySoft
                          : theme.colors.surfaceMuted,
                        borderColor: editor.requiresAcceptance
                          ? theme.colors.primary
                          : theme.colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={editor.requiresAcceptance ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={
                        editor.requiresAcceptance
                          ? theme.colors.primaryDeep
                          : theme.colors.textTertiary
                      }
                    />
                    <View style={styles.flex}>
                      <AppText variant="bodyStrong">Onay zorunlu</AppText>
                      <AppText variant="caption" color="textSecondary">
                        Kullanıcı bu belgeyi kabul etmeden uygulamaya giremez.
                      </AppText>
                    </View>
                  </Pressable>

                  {editor.requiresAcceptance ? (
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: editor.requiresReacceptance }}
                      onPress={() =>
                        setEditor({
                          ...editor,
                          requiresReacceptance: !editor.requiresReacceptance,
                        })
                      }
                      style={[
                        styles.acceptanceRow,
                        {
                          backgroundColor: editor.requiresReacceptance
                            ? theme.colors.primarySoft
                            : theme.colors.surfaceMuted,
                          borderColor: editor.requiresReacceptance
                            ? theme.colors.primary
                            : theme.colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={editor.requiresReacceptance ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={
                          editor.requiresReacceptance
                            ? theme.colors.primaryDeep
                            : theme.colors.textTertiary
                        }
                      />
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong">Yeni sürüm için yeniden onay</AppText>
                        <AppText variant="caption" color="textSecondary">
                          Önceki sürümü kabul etmiş kullanıcılar da bu sürümü yeniden onaylar.
                        </AppText>
                      </View>
                    </Pressable>
                  ) : null}

                  <Field label="Belge içeriği (Markdown)">
                    <TextInput
                      value={editor.bodyMd}
                      onChangeText={(bodyMd) => setEditor({ ...editor, bodyMd })}
                      placeholder={'## 1. Genel hükümler\n\nMetin…'}
                      placeholderTextColor={theme.colors.textTertiary}
                      multiline
                      textAlignVertical="top"
                      style={[
                        styles.textarea,
                        {
                          color: theme.colors.text,
                          backgroundColor: theme.colors.inputBackground,
                          borderColor: theme.colors.border,
                        },
                      ]}
                    />
                  </Field>

                  <AppText variant="caption" color="textTertiary">
                    {editor.bodyMd.trim().length} karakter · XSS riski oluşturan HTML çalıştırılmaz,
                    içerik düz metin olarak saklanır.
                  </AppText>
                </ScrollView>
              ) : (
                <ScrollView style={styles.editorScroll} contentContainerStyle={styles.preview}>
                  <AppText variant="h2">{editor.title || 'Başlıksız belge'}</AppText>
                  {editor.summary ? (
                    <AppText variant="body" color="textSecondary">
                      {editor.summary}
                    </AppText>
                  ) : null}
                  <PolicyBody sections={parsePolicyMarkdown(editor.bodyMd)} />
                </ScrollView>
              )}

              <View style={[styles.modalFooter, compact && styles.modalFooterCompact]}>
                <Button
                  label="Vazgeç"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setEditor(null)}
                />
                <View style={styles.footerRight}>
                  <Button
                    label="Taslak kaydet"
                    variant="secondary"
                    fullWidth={false}
                    loading={save.isPending && !publishTarget}
                    onPress={() => submit(editor, false)}
                  />
                  <Button
                    label="Yayınla"
                    fullWidth={false}
                    leftIcon={<Ionicons name="cloud-upload-outline" size={15} color="#FFFFFF" />}
                    onPress={() => setPublishTarget(editor)}
                  />
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Yayın onayı */}
      <Modal
        visible={Boolean(publishTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setPublishTarget(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setPublishTarget(null)} />
          {publishTarget ? (
            <View
              style={[
                styles.confirmCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={[styles.confirmIcon, { backgroundColor: theme.colors.warningSoft }]}>
                <Ionicons name="shield-checkmark-outline" size={24} color={theme.colors.warning} />
              </View>
              <AppText variant="h3">Yayın onayı</AppText>
              <AppText variant="body" color="textSecondary">
                <AppText variant="bodyStrong">{publishTarget.title}</AppText> yayınlanacak. Bu işlem
                eski sürümü değiştirmez; kullanıcı kabul kayıtları korunur.
              </AppText>
              <AppText variant="caption" color="textTertiary">
                Yayın öncesi hukuk kontrolü tamamlandı mı? Yürürlük:{' '}
                {publishTarget.effectiveAt || 'hemen'}
              </AppText>
              <View style={styles.confirmActions}>
                <Button
                  label="Vazgeç"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setPublishTarget(null)}
                />
                <Button
                  label="Onayla ve yayınla"
                  fullWidth={false}
                  loading={save.isPending}
                  onPress={() => submit(publishTarget, true)}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Sürüm geçmişi */}
      <Modal
        visible={Boolean(versionsFor)}
        transparent
        animationType="fade"
        onRequestClose={() => setVersionsFor(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setVersionsFor(null)} />
          {versionsFor ? (
            <View
              style={[
                styles.modalCard,
                compact && styles.modalCardCompact,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.modalHead}>
                <View style={styles.flex}>
                  <AppText variant="h3">{DOC_LABEL[versionsFor.slug] ?? versionsFor.title}</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Sürüm geçmişi · hiçbir sürüm silinmez
                  </AppText>
                </View>
                <Pressable onPress={() => setVersionsFor(null)} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>

              <ScrollView style={styles.editorScroll} contentContainerStyle={styles.versionList}>
                {versionsFor.versions.map((version) => (
                  <View
                    key={version.id}
                    style={[
                      styles.versionRow,
                      {
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surfaceElevated,
                      },
                    ]}
                  >
                    <View style={styles.versionHead}>
                      <View style={styles.rowTitle}>
                        <AppText variant="bodyStrong">v{version.version}</AppText>
                        <StatusPill version={version} />
                        {version.requires_acceptance ? (
                          <Badge label="Kabul gerekli" tone="primary" />
                        ) : null}
                        {version.requires_reacceptance ? (
                          <Badge label="Yeniden onay" tone="warning" />
                        ) : null}
                      </View>
                      <AppText variant="caption" color="textTertiary">
                        {formatDateTimeTr(version.published_at ?? version.created_at)} ·{' '}
                        {version.acceptance_count} kabul
                      </AppText>
                    </View>
                    {version.summary ? (
                      <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                        {version.summary}
                      </AppText>
                    ) : null}
                    <AppText variant="caption" color="textTertiary">
                      Hash: {version.content_hash.slice(0, 16)}…
                    </AppText>
                    <View style={styles.versionActions}>
                      <Button
                        label="İncele"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        onPress={() => {
                          setEditor(editorFrom(version));
                          setEditorTab('preview');
                          setVersionsFor(null);
                        }}
                      />
                      {!version.is_published && !version.archived_at ? (
                        <Button
                          label="Yayınla"
                          size="sm"
                          variant="secondary"
                          fullWidth={false}
                          loading={busyId === version.id}
                          onPress={() => runPublish(version.id)}
                        />
                      ) : null}
                      {version.is_published ? (
                        <Button
                          label="Yayından kaldır"
                          size="sm"
                          variant="danger"
                          fullWidth={false}
                          loading={busyId === version.id}
                          onPress={() => runUnpublish(version.id)}
                        />
                      ) : null}
                      {!version.is_published ? (
                        <Button
                          label="Sil"
                          size="sm"
                          variant="danger"
                          fullWidth={false}
                          disabled={version.acceptance_count > 0 || busyId === version.id}
                          onPress={() =>
                            setDeleteTarget({
                              kind: 'version',
                              id: version.id,
                              label: `v${version.version}`,
                            })
                          }
                        />
                      ) : null}
                    </View>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.compareControls}>
                <AppText variant="bodyStrong">Sürüm karşılaştır</AppText>
                <View style={styles.compareRow}>
                  <VersionSelect
                    label="Eski"
                    value={compareBase}
                    versions={versionsFor.versions}
                    onChange={setCompareBase}
                  />
                  <VersionSelect
                    label="Yeni"
                    value={compareNext}
                    versions={versionsFor.versions}
                    onChange={setCompareNext}
                  />
                </View>
              </View>

              {compareBase && compareNext ? (
                <ScrollView style={styles.diffScroll} contentContainerStyle={styles.diffList}>
                  <AppText variant="caption" color="textTertiary">
                    {compareRows.filter((row) => row.type === 'add').length} eklenen satır ·{' '}
                    {compareRows.filter((row) => row.type === 'remove').length} kaldırılan satır
                  </AppText>
                  {compareRows.slice(0, 400).map((row, index) => (
                    <View
                      key={`${index}-${row.type}`}
                      style={[
                        styles.diffLine,
                        {
                          backgroundColor:
                            row.type === 'add'
                              ? theme.colors.successSoft
                              : row.type === 'remove'
                                ? theme.colors.dangerSoft
                                : theme.colors.surfaceMuted,
                        },
                      ]}
                    >
                      <AppText
                        variant="caption"
                        color={row.type === 'add' ? 'success' : row.type === 'remove' ? 'danger' : 'textTertiary'}
                        style={styles.diffPrefix}
                      >
                        {row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}
                      </AppText>
                      <AppText variant="caption" color="textSecondary" style={styles.flex}>
                        {row.text}
                      </AppText>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <View style={styles.modalFooter}>
                <Button
                  label="Kapat"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setVersionsFor(null)}
                />
                <Button
                  label={versionsFor.draft ? 'Taslağı düzenle' : 'Yeni sürüm oluştur'}
                  fullWidth={false}
                  onPress={() => {
                    setEditor(editorFrom(versionsFor.draft ?? versionsFor.published ?? versionsFor.latest));
                    setEditorTab('write');
                    setVersionsFor(null);
                  }}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Silme onayı */}
      <Modal
        visible={Boolean(deleteTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setDeleteTarget(null)}
            accessibilityLabel="Kapat"
          />
          {deleteTarget ? (
            <View
              style={[
                styles.modalCard,
                styles.confirmCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.modalHead}>
                <View style={styles.flex}>
                  <AppText variant="h3">Kalıcı olarak silinsin mi?</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Bu işlem geri alınamaz.
                  </AppText>
                </View>
                <Pressable onPress={() => setDeleteTarget(null)} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>

              <View style={styles.form}>
                <View style={[styles.notice, { backgroundColor: theme.colors.dangerSoft }]}>
                  <Ionicons name="warning-outline" size={18} color={theme.colors.danger} />
                  <AppText variant="caption" color="textSecondary" style={styles.flex}>
                    {deleteTarget.kind === 'document'
                      ? `“${deleteTarget.title}” belgesi ${deleteTarget.versions} sürümüyle birlikte veritabanından silinecek ve siteden kaldırılacak.`
                      : `${deleteTarget.label} sürümü veritabanından silinecek.`}
                  </AppText>
                </View>
                <AppText variant="caption" color="textTertiary">
                  Kullanıcı kabul kaydı bulunan belgeler silinemez; bu durumda “Yayından kaldır”
                  kullanılır ve kabul kayıtları korunur.
                </AppText>
              </View>

              <View style={styles.modalFooter}>
                <Button
                  label="Vazgeç"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setDeleteTarget(null)}
                />
                <Button
                  label="Kalıcı olarak sil"
                  variant="danger"
                  fullWidth={false}
                  loading={busyId !== null}
                  onPress={confirmDelete}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </AdminPage>
  );
}

function sharedTitle(versions: LegalAdminVersion[]) {
  return versions.find((version) => version.is_published)?.title ?? versions[0]?.title ?? '';
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.stat,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <View style={[styles.statIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={17} color={theme.colors.primaryDeep} />
      </View>
      <View>
        <AppText variant="h3">{value}</AppText>
        <AppText variant="caption" color="textTertiary">
          {label}
        </AppText>
      </View>
    </View>
  );
}

function Rule({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.rule}>
      <Ionicons name="checkmark-circle-outline" size={16} color={theme.colors.primaryDeep} />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.tab,
        {
          backgroundColor: active ? theme.colors.primarySoft : 'transparent',
          borderColor: active ? theme.colors.primary : theme.colors.border,
        },
      ]}
    >
      <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      {children}
    </View>
  );
}

function VersionSelect({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: string | null;
  versions: LegalAdminVersion[];
  onChange: (value: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.flex}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <View style={styles.chips}>
        {versions.slice(0, 8).map((version) => {
          const active = value === version.id;
          return (
            <Pressable
              key={version.id}
              onPress={() => onChange(version.id)}
              style={[
                styles.versionChip,
                {
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                v{version.version}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    flexGrow: 1,
    minWidth: 150,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 11,
    height: 40,
    maxWidth: 300,
    flexGrow: 1,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}) },
  list: { gap: 10 },
  row: {
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowCompact: { flexDirection: 'column', alignItems: 'stretch' },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  rowActions: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  rowActionsCompact: { justifyContent: 'flex-start' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 10 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 10 },
  rule: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,12,24,0.62)' },
  modalCard: {
    width: '100%',
    maxWidth: 1040,
    maxHeight: '94%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
    ...(Platform.OS === 'web' ? { boxShadow: '0 24px 70px rgba(0,0,0,0.35)' as never } : {}),
  },
  modalCardCompact: { maxHeight: '96%', padding: 12 },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tabs: { flexDirection: 'row', gap: 7 },
  tab: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  editorScroll: { minHeight: 200, maxHeight: 520 },
  form: { gap: 12, paddingBottom: 8 },
  formRow: { flexDirection: 'row', gap: 10 },
  formRowCompact: { flexDirection: 'column' },
  field: { flex: 1, gap: 5 },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  textarea: {
    minHeight: 260,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    lineHeight: 20,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  typeChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  acceptanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  preview: { gap: 8, paddingBottom: 16 },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  modalFooterCompact: { flexDirection: 'column', alignItems: 'stretch' },
  footerRight: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  confirmCard: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 10,
  },
  confirmIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
  versionList: { gap: 10, paddingBottom: 6 },
  versionRow: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, gap: 6 },
  versionHead: { gap: 3 },
  versionActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  compareControls: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#8883', paddingTop: 10 },
  compareRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  versionChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  diffScroll: { maxHeight: 240, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, borderColor: '#8883' },
  diffList: { gap: 2, padding: 8 },
  diffLine: { flexDirection: 'row', gap: 6, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  diffPrefix: { width: 10 },
});
