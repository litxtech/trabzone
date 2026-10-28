import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
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
import { AdminPage, AdminSection } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminSaveWebsiteSection,
  useAdminSaveWebsiteSetting,
  useAdminWebsiteContent,
} from '@/features/web-content/hooks/use-web-content';
import type { WebsiteSection } from '@/features/web-content/types';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

const SETTING_TABS = [
  { key: 'brand', label: 'Marka' },
  { key: 'hero', label: 'Hero' },
  { key: 'nav', label: 'Menü' },
  { key: 'apps', label: 'Mağaza' },
  { key: 'social', label: 'Sosyal' },
  { key: 'support', label: 'Destek' },
  { key: 'legal', label: 'Hukuki künye' },
] as const;

type SettingTab = (typeof SETTING_TABS)[number]['key'];
type SettingsMap = Record<string, Record<string, unknown>>;

const FIELD_LABELS: Record<SettingTab, { key: string; label: string; multiline?: boolean }[]> = {
  brand: [
    { key: 'name', label: 'Marka adı' },
    { key: 'tagline', label: 'Slogan' },
    { key: 'support_email', label: 'Destek e-postası' },
  ],
  hero: [
    { key: 'eyebrow', label: 'Üst etiket' },
    { key: 'title', label: 'Ana başlık' },
    { key: 'slogan', label: 'Slogan' },
    { key: 'description', label: 'Açıklama', multiline: true },
    { key: 'primary_cta', label: 'Birincil buton' },
    { key: 'secondary_cta', label: 'İkincil buton' },
    { key: 'tertiary_cta', label: 'Üçüncül buton' },
  ],
  nav: [],
  apps: [
    { key: 'ios_url', label: 'App Store bağlantısı' },
    { key: 'android_url', label: 'Google Play bağlantısı' },
    { key: 'status', label: 'Durum (coming_soon / live)' },
    { key: 'note', label: 'Not', multiline: true },
  ],
  social: [
    { key: 'instagram', label: 'Instagram' },
    { key: 'x', label: 'X / Twitter' },
    { key: 'youtube', label: 'YouTube' },
    { key: 'tiktok', label: 'TikTok' },
  ],
  support: [
    { key: 'hours_label', label: 'Destek saatleri' },
    { key: 'response_note', label: 'Yanıt notu', multiline: true },
  ],
  legal: [
    { key: 'operator_name', label: 'Veri sorumlusu / işletmeci unvanı' },
    { key: 'operator_note', label: 'Künye notu', multiline: true },
    { key: 'terms_version', label: 'Kullanım Koşulları sürümü' },
    { key: 'privacy_version', label: 'Gizlilik sürümü' },
    { key: 'last_updated', label: 'Son güncelleme (YYYY-AA-GG)' },
  ],
};

type SectionDraft = {
  key: string;
  title: string;
  subtitle: string;
  body: string;
  items: string;
  previewNote: string;
  sortOrder: string;
  isPublished: boolean;
  payload: Record<string, unknown>;
};

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sectionDraft(section: WebsiteSection): SectionDraft {
  const items = Array.isArray(section.payload?.items)
    ? (section.payload.items as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
  return {
    key: section.key,
    title: section.title,
    subtitle: section.subtitle ?? '',
    body: section.body ?? '',
    items: items.join('\n'),
    previewNote: stringValue(section.payload?.preview_note),
    sortOrder: String(section.sort_order),
    isPublished: section.is_published ?? true,
    payload: section.payload ?? {},
  };
}

export default function AdminWebsiteScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const { width } = useWindowDimensions();
  const compact = width < 820;

  const query = useAdminWebsiteContent();
  const saveSetting = useAdminSaveWebsiteSetting();
  const saveSection = useAdminSaveWebsiteSection();

  const [tab, setTab] = useState<SettingTab>('hero');
  const [edits, setEdits] = useState<Partial<Record<SettingTab, Record<string, unknown>>>>({});
  const [navDraftEdit, setNavDraftEdit] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<SectionDraft | null>(null);

  // Sunucudaki içerik tek kaynaktır; düzenlemeler yalnızca yerel taslak katmanında tutulur.
  const baseSettings = useMemo<SettingsMap>(() => {
    const next: SettingsMap = {};
    for (const [key, value] of Object.entries(query.data?.settings ?? {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        next[key] = { ...(value as Record<string, unknown>) };
      }
    }
    return next;
  }, [query.data]);

  const settings = useMemo<SettingsMap>(() => {
    const merged: SettingsMap = { ...baseSettings };
    for (const [key, value] of Object.entries(edits)) {
      merged[key] = { ...(baseSettings[key] ?? {}), ...value };
    }
    return merged;
  }, [baseSettings, edits]);

  const serverNavDraft = useMemo(() => {
    const nav = baseSettings.nav?.items;
    if (!Array.isArray(nav)) {
      return '';
    }
    return nav
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }
        const row = item as Record<string, unknown>;
        return `${stringValue(row.label)} | ${stringValue(row.href)}`;
      })
      .filter(Boolean)
      .join('\n');
  }, [baseSettings]);

  const navDraft = navDraftEdit ?? serverNavDraft;

  const sections = query.data?.sections ?? [];
  const liveChat = boolValue(settings.support?.live_chat_enabled, true);
  const heroTitle = stringValue(settings.hero?.title, 'TRABZONE');
  const heroSlogan = stringValue(settings.hero?.slogan, '');

  const updateField = (key: SettingTab, field: string, value: string) => {
    setEdits((current) => ({
      ...current,
      [key]: { ...(current[key] ?? {}), [field]: value },
    }));
  };

  const saveTab = () => {
    if (tab === 'nav') {
      const items = navDraft
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, href] = line.split('|').map((part) => part.trim());
          return { label: label ?? '', href: href ?? '' };
        })
        .filter((item) => item.label.length > 0 && item.href.length > 0);
      if (items.length === 0) {
        toast.error('En az bir menü öğesi girin. Biçim: Etiket | /adres');
        return;
      }
      saveSetting.mutate(
        { key: 'nav', value: { items } },
        {
          onSuccess: () => {
            haptics.success();
            toast.success('Menü kaydedildi.');
            setNavDraftEdit(null);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    const value = { ...(settings[tab] ?? {}) };
    if (tab === 'support') {
      value.live_chat_enabled = liveChat;
    }
    saveSetting.mutate(
      { key: tab, value },
      {
        onSuccess: () => {
          haptics.success();
          toast.success('Web sitesi ayarı kaydedildi. Değişiklik yayında.');
          setEdits((current) => ({ ...current, [tab]: {} }));
        },
        onError: (error) => {
          haptics.error();
          toast.error(error.message);
        },
      },
    );
  };

  const submitSection = () => {
    if (!editingSection) {
      return;
    }
    if (editingSection.title.trim().length < 3) {
      toast.error('Bölüm başlığı en az 3 karakter olmalı.');
      return;
    }
    const payload: Record<string, unknown> = { ...editingSection.payload };
    const items = editingSection.items
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (items.length > 0) {
      payload.items = items;
    } else {
      delete payload.items;
    }
    if (editingSection.previewNote.trim()) {
      payload.preview_note = editingSection.previewNote.trim();
    } else {
      delete payload.preview_note;
    }
    saveSection.mutate(
      {
        key: editingSection.key,
        title: editingSection.title.trim(),
        subtitle: editingSection.subtitle.trim() || null,
        body: editingSection.body.trim() || null,
        payload,
        sortOrder: Number(editingSection.sortOrder) || 100,
        isPublished: editingSection.isPublished,
      },
      {
        onSuccess: () => {
          haptics.success();
          toast.success('Bölüm kaydedildi.');
          setEditingSection(null);
        },
        onError: (error) => {
          haptics.error();
          toast.error(error.message);
        },
      },
    );
  };

  const navItems = useMemo(
    () =>
      navDraft
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length,
    [navDraft],
  );

  return (
    <AdminPage
      title="Web Sitesi Yönetimi"
      subtitle="Ana sayfa, hero, menü, mağaza bağlantıları ve tanıtım bölümleri. Değişiklikler yeni uygulama sürümü gerektirmez."
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <View
        style={[
          styles.preview,
          { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
        ]}
      >
        <View style={styles.flex}>
          <AppText variant="overline" color="primaryDeep">
            Canlı hero önizlemesi
          </AppText>
          <AppText variant="h2" color="primaryDeep">
            {heroTitle || 'TRABZONE'}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {heroSlogan || 'Slogan eklenmedi'}
          </AppText>
        </View>
        <Badge
          label={liveChat ? 'Canlı destek etkin' : 'Canlı destek kapalı'}
          tone={liveChat ? 'success' : 'warning'}
        />
      </View>

      <AdminSection
        title="Site ayarları"
        subtitle="Alanları düzenleyip kaydedin. Boş sosyal medya bağlantıları sitede gösterilmez."
      >
        <View style={styles.tabs}>
          {SETTING_TABS.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(item.key)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {query.isLoading ? (
          <AppText variant="body" color="textSecondary">
            İçerik yükleniyor…
          </AppText>
        ) : query.isError ? (
          <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="lock-closed-outline" size={18} color={theme.colors.danger} />
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              `website.manage` yetkisi gerekir.
            </AppText>
          </View>
        ) : tab === 'nav' ? (
          <View style={styles.form}>
            <View style={styles.hintRow}>
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Her satıra bir menü öğesi yazın: `Ana Sayfa | /` biçiminde. Sıra korunur; {navItems} öğe.
              </AppText>
            </View>
            <TextInput
              value={navDraft}
              onChangeText={setNavDraftEdit}
              multiline
              placeholder={'Ana Sayfa | /\nKeşfet | /explore'}
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.textarea,
                {
                  color: theme.colors.text,
                  backgroundColor: theme.colors.inputBackground,
                  borderColor: theme.colors.border,
                },
              ]}
            />
          </View>
        ) : (
          <View style={[styles.formGrid, compact && styles.formGridCompact]}>
            {FIELD_LABELS[tab].map((field) => (
              <View key={field.key} style={styles.field}>
                <AppText variant="label" color="textSecondary">
                  {field.label}
                </AppText>
                <TextInput
                  value={stringValue(settings[tab]?.[field.key])}
                  onChangeText={(value) => updateField(tab, field.key, value)}
                  multiline={field.multiline}
                  placeholder={field.label}
                  placeholderTextColor={theme.colors.textTertiary}
                  style={[
                    field.multiline ? styles.textareaSmall : styles.input,
                    {
                      color: theme.colors.text,
                      backgroundColor: theme.colors.inputBackground,
                      borderColor: theme.colors.border,
                    },
                  ]}
                />
              </View>
            ))}

            {tab === 'support' ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: liveChat }}
                onPress={() =>
                  setEdits((current) => ({
                    ...current,
                    support: { ...(current.support ?? {}), live_chat_enabled: !liveChat },
                  }))
                }
                style={[
                  styles.toggleRow,
                  {
                    backgroundColor: liveChat ? theme.colors.successSoft : theme.colors.surfaceMuted,
                    borderColor: liveChat ? theme.colors.success : theme.colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={liveChat ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={liveChat ? theme.colors.success : theme.colors.textTertiary}
                />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">Canlı destek girişi gösterilsin</AppText>
                  <AppText variant="caption" color="textSecondary">
                    Temsilci çevrimiçi değilse kullanıcıya mesaj bırakma seçeneği gösterilir.
                  </AppText>
                </View>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={styles.actions}>
          <Button
            label="Değişiklikleri kaydet"
            size="sm"
            fullWidth={false}
            loading={saveSetting.isPending}
            onPress={saveTab}
          />
        </View>
      </AdminSection>

      <AdminSection
        title="Ana sayfa bölümleri"
        subtitle="Sıralama, başlık, metin ve madde listeleri. Yayından kaldırılan bölüm sitede görünmez."
      >
        <View style={styles.list}>
          {sections.map((section) => (
            <View
              key={section.key}
              style={[
                styles.sectionRow,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                },
                compact && styles.sectionRowCompact,
              ]}
            >
              <View style={styles.flex}>
                <View style={styles.rowTitle}>
                  <AppText variant="bodyStrong">{section.title}</AppText>
                  <Badge label={section.key} tone="neutral" />
                  <Badge
                    label={section.is_published === false ? 'Yayında değil' : 'Yayında'}
                    tone={section.is_published === false ? 'warning' : 'success'}
                  />
                  <Badge label={`Sıra ${section.sort_order}`} tone="primary" />
                </View>
                {section.subtitle ? (
                  <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                    {section.subtitle}
                  </AppText>
                ) : null}
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {section.body ?? 'Gövde metni yok'}
                </AppText>
              </View>
              <Button
                label="Düzenle"
                size="sm"
                variant="secondary"
                fullWidth={false}
                onPress={() => setEditingSection(sectionDraft(section))}
              />
            </View>
          ))}
        </View>
      </AdminSection>

      <Modal
        visible={Boolean(editingSection)}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingSection(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setEditingSection(null)} />
          {editingSection ? (
            <View
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.modalHead}>
                <View style={styles.flex}>
                  <AppText variant="h3">Bölümü düzenle</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {editingSection.key}
                  </AppText>
                </View>
                <Pressable onPress={() => setEditingSection(null)} accessibilityLabel="Kapat">
                  <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.form}>
                <SimpleField
                  label="Başlık"
                  value={editingSection.title}
                  onChange={(title) => setEditingSection({ ...editingSection, title })}
                />
                <SimpleField
                  label="Alt başlık"
                  value={editingSection.subtitle}
                  onChange={(subtitle) => setEditingSection({ ...editingSection, subtitle })}
                />
                <SimpleField
                  label="Gövde metni"
                  value={editingSection.body}
                  onChange={(body) => setEditingSection({ ...editingSection, body })}
                  multiline
                />
                <SimpleField
                  label="Maddeler (her satır bir madde)"
                  value={editingSection.items}
                  onChange={(items) => setEditingSection({ ...editingSection, items })}
                  multiline
                />
                <SimpleField
                  label="Önizleme notu (ör. harita önizlemesi)"
                  value={editingSection.previewNote}
                  onChange={(previewNote) => setEditingSection({ ...editingSection, previewNote })}
                />
                <View style={[styles.formGrid, compact && styles.formGridCompact]}>
                  <SimpleField
                    label="Sıra"
                    value={editingSection.sortOrder}
                    onChange={(sortOrder) =>
                      setEditingSection({
                        ...editingSection,
                        sortOrder: sortOrder.replace(/[^0-9]/g, ''),
                      })
                    }
                  />
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: editingSection.isPublished }}
                    onPress={() =>
                      setEditingSection({
                        ...editingSection,
                        isPublished: !editingSection.isPublished,
                      })
                    }
                    style={[
                      styles.toggleRow,
                      {
                        backgroundColor: editingSection.isPublished
                          ? theme.colors.successSoft
                          : theme.colors.surfaceMuted,
                        borderColor: editingSection.isPublished
                          ? theme.colors.success
                          : theme.colors.border,
                        marginTop: 22,
                      },
                    ]}
                  >
                    <Ionicons
                      name={editingSection.isPublished ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={
                        editingSection.isPublished ? theme.colors.success : theme.colors.textTertiary
                      }
                    />
                    <AppText variant="caption" color="textSecondary">
                      Yayında
                    </AppText>
                  </Pressable>
                </View>
              </ScrollView>
              <View style={styles.modalFooter}>
                <Button
                  label="Vazgeç"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setEditingSection(null)}
                />
                <Button
                  label="Kaydet"
                  fullWidth={false}
                  loading={saveSection.isPending}
                  onPress={submitSection}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </AdminPage>
  );
}

function SimpleField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.field}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholderTextColor={theme.colors.textTertiary}
        style={[
          multiline ? styles.textareaSmall : styles.input,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.inputBackground,
            borderColor: theme.colors.border,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tab: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  form: { gap: 11 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  formGridCompact: { flexDirection: 'column' },
  field: { flex: 1, minWidth: 220, gap: 5 },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    fontSize: 13,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  textarea: {
    minHeight: 150,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    fontSize: 13,
    lineHeight: 20,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  textareaSmall: {
    minHeight: 78,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    fontSize: 13,
    lineHeight: 19,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  hintRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 11,
    minWidth: 230,
    flex: 1,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  list: { gap: 9 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionRowCompact: { flexDirection: 'column', alignItems: 'stretch' },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,12,24,0.62)' },
  modalCard: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '94%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 11,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalScroll: { maxHeight: 520 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
});
