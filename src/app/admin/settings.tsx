import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, IconButton, TextField } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
} from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useAdminMe, useSettingSet, useSettings } from '@/features/admin/hooks/use-admin';
import type { AppSetting } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

const GROUP_LABELS: Record<string, string> = {
  app: 'Uygulama',
  auth: 'Kimlik ve oturum',
  stories: 'Hikâyeler',
  reels: 'Reels',
  market: 'Marketplace',
  marketplace: 'Marketplace',
  messaging: 'Mesajlaşma',
  notifications: 'Bildirimler',
  safety: 'Güvenlik',
  support: 'Destek',
  premium: 'Premium',
  feature: 'Özellikler',
  legal: 'Hukuki',
};

export default function AdminSettingsScreen() {
  const { theme } = useTheme();
  const me = useAdminMe();
  const canManage = (me.data?.permissions ?? []).includes('settings.manage');
  const settings = useSettings();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [editing, setEditing] = useState<AppSetting | null>(null);

  const groups = useMemo(() => {
    const keys = new Set((settings.data ?? []).map((item) => item.key.split('.')[0] ?? 'app'));
    return Array.from(keys).sort();
  }, [settings.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr-TR');
    return (settings.data ?? []).filter((item) => {
      const matchesGroup = group === 'all' || item.key.startsWith(`${group}.`);
      if (!matchesGroup) return false;
      if (!term) return true;
      return (
        item.key.toLocaleLowerCase('tr-TR').includes(term) ||
        (item.description ?? '').toLocaleLowerCase('tr-TR').includes(term)
      );
    });
  }, [settings.data, search, group]);

  const byGroup = useMemo(() => {
    const map = new Map<string, AppSetting[]>();
    filtered.forEach((item) => {
      const prefix = item.key.split('.')[0] ?? 'app';
      map.set(prefix, [...(map.get(prefix) ?? []), item]);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <AdminPage
      title="Uygulama Ayarları"
      subtitle="Merkezi yapılandırma: içerik kuralları, saklama süreleri, özellik eşikleri ve güvenlik parametreleri."
      refreshing={settings.isRefetching}
      onRefresh={() => void settings.refetch()}
      actions={
        <Badge
          label={canManage ? 'Düzenlenebilir' : 'Salt okunur'}
          tone={canManage ? 'success' : 'neutral'}
        />
      }
    >
      <AdminSection title="Ayarları ara" subtitle="Anahtar veya açıklama ile filtreleyin.">
        <AdminToolbar>
          <View style={{ flexGrow: 1, flexBasis: 260, minWidth: 220 }}>
            <TextField
              placeholder="Ayar anahtarı ara…"
              value={search}
              onChangeText={setSearch}
              leftIcon="search-outline"
              autoCapitalize="none"
            />
          </View>
        </AdminToolbar>
        <FilterChips
          options={[
            { key: 'all', label: 'Tüm gruplar' },
            ...groups.map((key) => ({ key, label: GROUP_LABELS[key] ?? key })),
          ]}
          value={group}
          onChange={setGroup}
        />
      </AdminSection>

      {settings.isError ? (
        <View style={[styles.errorCard, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={{ flex: 1 }}>
            Ayarlar yüklenemedi. `settings.view` yetkinizi kontrol edin.
          </AppText>
          <Button
            label="Yenile"
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => void settings.refetch()}
          />
        </View>
      ) : null}

      {byGroup.map(([prefix, items]) => (
        <AdminSection
          key={prefix}
          title={GROUP_LABELS[prefix] ?? prefix}
          subtitle={`${items.length} ayar`}
        >
          {items.map((item) => (
            <SettingRow
              key={item.key}
              setting={item}
              canManage={canManage}
              onEdit={() => setEditing(item)}
            />
          ))}
        </AdminSection>
      ))}

      {filtered.length === 0 && !settings.isLoading ? (
        <AppText
          variant="body"
          color="textSecondary"
          style={{ textAlign: 'center', paddingVertical: 26 }}
        >
          Eşleşen ayar bulunamadı.
        </AppText>
      ) : null}

      <SettingEditor
        setting={editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          void settings.refetch();
        }}
      />
    </AdminPage>
  );
}

function SettingRow({
  setting,
  canManage,
  onEdit,
}: {
  setting: AppSetting;
  canManage: boolean;
  onEdit: () => void;
}) {
  const { theme } = useTheme();
  const value = formatValue(setting.value);
  return (
    <View style={[styles.settingRow, { borderColor: theme.colors.divider }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <AppText variant="caption" style={{ fontWeight: '700', fontFamily: 'monospace' }}>
            {setting.key}
          </AppText>
          {setting.is_public ? (
            <Badge label="genel" tone="neutral" />
          ) : (
            <Badge label="sunucu" tone="accent" />
          )}
        </View>
        <AppText variant="caption" color="textTertiary" numberOfLines={2}>
          {setting.description ?? 'Açıklama yok.'}
        </AppText>
        <AppText variant="caption" color="textTertiary">
          {formatDateTimeTr(setting.updated_at)} · {setting.updated_by_name ?? 'Sistem'}
        </AppText>
      </View>
      <View style={{ maxWidth: 220, alignItems: 'flex-end' }}>
        <AppText
          variant="caption"
          color="textSecondary"
          numberOfLines={3}
          style={{ textAlign: 'right' }}
        >
          {value}
        </AppText>
      </View>
      {canManage ? (
        <Button label="Düzenle" size="sm" variant="ghost" fullWidth={false} onPress={onEdit} />
      ) : null}
    </View>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'açık' : 'kapalı';
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  } catch {
    return String(value);
  }
}

function SettingEditor({
  setting,
  onClose,
  onSaved,
}: {
  setting: AppSetting | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const mutation = useSettingSet();
  const [text, setText] = useState('');
  const [type, setType] = useState<'boolean' | 'number' | 'string' | 'json'>('string');
  const [boolValue, setBoolValue] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!setting) return;
    setReason('');
    setError(null);
    if (typeof setting.value === 'boolean') {
      setType('boolean');
      setBoolValue(setting.value);
      setText('');
    } else if (typeof setting.value === 'number') {
      setType('number');
      setText(String(setting.value));
    } else if (typeof setting.value === 'string') {
      setType('string');
      setText(setting.value);
    } else {
      setType('json');
      setText(JSON.stringify(setting.value, null, 2));
    }
  }, [setting]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = async () => {
    if (!setting) return;
    if (reason.trim().length < 3) {
      setError('Gerekçe en az 3 karakter olmalı.');
      return;
    }
    let value: unknown = text;
    if (type === 'boolean') {
      value = boolValue;
    } else if (type === 'number') {
      const parsed = Number(text.replace(',', '.'));
      if (!Number.isFinite(parsed)) {
        setError('Geçerli bir sayı girin.');
        return;
      }
      value = parsed;
    } else if (type === 'json') {
      try {
        value = JSON.parse(text);
      } catch {
        setError('Geçerli JSON girin.');
        return;
      }
    }
    try {
      await mutation.mutateAsync({ key: setting.key, value, reason: reason.trim() });
      onSaved('Ayar güncellendi.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ayar güncellenemedi.');
    }
  };

  return (
    <Modal visible={Boolean(setting)} transparent animationType="fade" onRequestClose={onClose}>
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
              <AppText variant="h3">Ayarı düzenle</AppText>
              <AppText variant="caption" color="textTertiary" style={{ fontFamily: 'monospace' }}>
                {setting?.key}
              </AppText>
            </View>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 14, gap: 10 }}
          >
            <AppText variant="caption" color="textSecondary">
              {setting?.description ?? 'Bu ayar uygulama davranışını etkiler.'}
            </AppText>
            {type === 'boolean' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setBoolValue((value) => !value)}
                style={[styles.toggleRow, { borderColor: theme.colors.border }]}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: boolValue ? theme.colors.primary : theme.colors.borderStrong,
                      backgroundColor: boolValue ? theme.colors.primary : 'transparent',
                    },
                  ]}
                >
                  {boolValue ? (
                    <Ionicons name="checkmark" size={12} color={theme.colors.onPrimary} />
                  ) : null}
                </View>
                <AppText variant="body">{boolValue ? 'Açık' : 'Kapalı'}</AppText>
              </Pressable>
            ) : (
              <TextField
                label={
                  type === 'json'
                    ? 'JSON değeri'
                    : type === 'number'
                      ? 'Sayısal değer'
                      : 'Metin değeri'
                }
                value={text}
                onChangeText={setText}
                multiline={type === 'json' || type === 'string'}
                style={
                  type === 'json' || type === 'string'
                    ? { minHeight: 110, textAlignVertical: 'top' }
                    : undefined
                }
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            <TextField
              label="İşlem gerekçesi"
              value={reason}
              onChangeText={setReason}
              placeholder="Neden değiştiriliyor?"
              maxLength={400}
              hint="Denetim kaydına yazılır; kişisel veri girmeyin."
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
                loading={mutation.isPending}
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
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 10 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  panel: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '88%',
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
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
