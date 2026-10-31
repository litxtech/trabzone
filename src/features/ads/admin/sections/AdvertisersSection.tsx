import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Badge, Button, IconButton, TextField } from '@/components/ui';
import { AdminSection, AdminToolbar, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ChipSelect } from '@/features/admin/components/news-api/shared';
import { useTheme } from '@/theme/ThemeProvider';

import { useAdAdvertiserMember, useAdAdvertiserSave, useAdAdvertisers } from '../hooks';
import { formatCount, formatMoneyCents } from '../labels';
import type { AdAdvertiser } from '../types';

const STATUS = {
  active: { label: 'Aktif', tone: 'success' },
  suspended: { label: 'Askıda', tone: 'warning' },
  archived: { label: 'Arşiv', tone: 'neutral' },
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return `${parts[0][0] ?? ''}${parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''}`.toLocaleUpperCase('tr-TR');
}

export function AdvertisersSection({ canManage }: { canManage: boolean }) {
  const { theme } = useTheme();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AdAdvertiser['status']>('all');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<AdAdvertiser | 'new' | null>(null);
  const advertisers = useAdAdvertisers(search, offset);
  const rows = (advertisers.data?.items ?? []).filter(
    (item) => statusFilter === 'all' || item.status === statusFilter,
  );

  const columns: Column<AdAdvertiser>[] = [
    {
      key: 'name',
      label: 'Reklamveren',
      width: 2,
      render: (row) => (
        <View style={styles.nameCell}>
          <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}>
            <AppText variant="caption" color="primaryDeep" style={styles.bold}>
              {initials(row.name)}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="caption" style={styles.bold} numberOfLines={1}>
              {row.name}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {[row.contact_name, row.contact_email, row.place_name].filter(Boolean).join(' · ') || 'İletişim bilgisi yok'}
            </AppText>
            {row.members?.length ? (
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {row.members.length} panel kullanıcısı
              </AppText>
            ) : null}
          </View>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 0.8,
      render: (row) => <Badge label={STATUS[row.status].label} tone={STATUS[row.status].tone} />,
    },
    {
      key: 'stats',
      label: 'Kampanyalar',
      width: 1.6,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {row.campaign_count ?? 0} kampanya ({row.active_campaigns ?? 0} aktif) · {formatCount(row.impressions)} gösterim ·{' '}
          {formatMoneyCents(row.spend_cents)}
        </AppText>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: 0.7,
      render: (row) =>
        canManage ? (
          <Button label="Düzenle" size="sm" variant="ghost" fullWidth={false} onPress={() => setEditing(row)} />
        ) : null,
    },
  ];

  return (
    <AdminSection
      title="Reklamverenler"
      subtitle="Reklamveren üyesi kullanıcılar yalnızca kendi kampanyalarının performansını görebilir."
      action={
        canManage ? (
          <Button
            label="Reklamveren ekle"
            size="sm"
            fullWidth={false}
            leftIcon={<Ionicons name="add" size={15} color={theme.colors.onPrimary} />}
            onPress={() => setEditing('new')}
          />
        ) : undefined
      }
    >
      <AdminToolbar>
        <View style={[styles.searchWrap, { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground }]}>
          <Ionicons name="search" size={15} color={theme.colors.textTertiary} />
          <TextInput
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            placeholder="Ad veya e-posta ara…"
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.searchInput, { color: theme.colors.text }]}
          />
        </View>
      </AdminToolbar>
      <DataTable
        columns={columns}
        rows={advertisers.data?.items ?? []}
        keyExtractor={(row) => row.id}
        loading={advertisers.isLoading}
        empty={
          <AppText variant="body" color="textSecondary">
            Henüz reklamveren yok.
          </AppText>
        }
      />
      {advertisers.data ? (
        <Pager total={advertisers.data.total} limit={advertisers.data.limit} offset={advertisers.data.offset} onChange={setOffset} />
      ) : null}
      <AdvertiserEditor
        advertiser={
          editing === 'new' || editing == null
            ? null
            : (advertisers.data?.items.find((item) => item.id === editing.id) ?? editing)
        }
        visible={editing != null}
        onClose={() => setEditing(null)}
      />
    </AdminSection>
  );
}

function AdvertiserEditor({
  advertiser,
  visible,
  onClose,
}: {
  advertiser: AdAdvertiser | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useAdAdvertiserSave();
  const member = useAdAdvertiserMember();
  const [form, setForm] = useState<Partial<AdAdvertiser>>({});
  const [username, setUsername] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const currentKey = visible ? (advertiser?.id ?? 'new') : null;
  if (currentKey !== key) {
    setKey(currentKey);
    setForm(advertiser ?? { status: 'active' });
    setUsername('');
  }
  const set = <K extends keyof AdAdvertiser>(field: K, value: AdAdvertiser[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Kapat" style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]} onPress={onClose} />
        <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
            <AppText variant="h3" style={styles.flex}>
              {advertiser ? 'Reklamvereni düzenle' : 'Yeni reklamveren'}
            </AppText>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <TextField label="Görünen ad" value={form.name ?? ''} onChangeText={(v) => set('name', v)} maxLength={120} />
            <View style={styles.row}>
              <View style={styles.cell}>
                <TextField label="Ticari unvan" value={form.legal_name ?? ''} onChangeText={(v) => set('legal_name', v)} />
              </View>
              <View style={styles.cell}>
                <TextField label="Vergi no" value={form.tax_number ?? ''} onChangeText={(v) => set('tax_number', v)} />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.cell}>
                <TextField label="Yetkili" value={form.contact_name ?? ''} onChangeText={(v) => set('contact_name', v)} />
              </View>
              <View style={styles.cell}>
                <TextField label="E-posta" value={form.contact_email ?? ''} onChangeText={(v) => set('contact_email', v)} autoCapitalize="none" />
              </View>
              <View style={styles.cell}>
                <TextField label="Telefon" value={form.contact_phone ?? ''} onChangeText={(v) => set('contact_phone', v)} keyboardType="phone-pad" />
              </View>
            </View>
            <TextField label="Web sitesi (https)" value={form.website ?? ''} onChangeText={(v) => set('website', v)} autoCapitalize="none" />
            <TextField label="Bağlı işletme kimliği (UUID, opsiyonel)" value={form.place_id ?? ''} onChangeText={(v) => set('place_id', v)} autoCapitalize="none" />
            <AppText variant="caption" color="textTertiary">
              Durum
            </AppText>
            <ChipSelect
              options={[
                { value: 'active', label: 'Aktif' },
                { value: 'suspended', label: 'Askıda' },
                { value: 'archived', label: 'Arşiv' },
              ]}
              value={form.status ?? 'active'}
              onChange={(v) => set('status', v)}
            />
            <TextField label="İç notlar" value={form.notes ?? ''} onChangeText={(v) => set('notes', v)} multiline />
            <Button
              label="Kaydet"
              size="sm"
              fullWidth={false}
              loading={save.isPending}
              onPress={async () => {
                try {
                  await save.mutateAsync({ id: advertiser?.id ?? null, payload: form });
                  toast.success('Reklamveren kaydedildi.');
                  onClose();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'Reklamveren kaydedilemedi.');
                }
              }}
            />

            {advertiser ? (
              <View style={[styles.members, { borderColor: theme.colors.border }]}>
                <AppText variant="title">Reklamveren paneli erişimi</AppText>
                <AppText variant="caption" color="textTertiary">
                  Eklenen kullanıcılar yalnızca bu reklamverenin kampanya özetlerini görür.
                </AppText>
                {(advertiser.members ?? []).map((item) => (
                  <View key={item.user_id} style={styles.memberRow}>
                    <AppText variant="body" style={styles.flex}>
                      @{item.username ?? item.user_id.slice(0, 8)}
                    </AppText>
                    <Button
                      label="Kaldır"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() =>
                        item.username &&
                        void member
                          .mutateAsync({ advertiserId: advertiser.id, username: item.username, add: false })
                          .then(() => toast.success('Erişim kaldırıldı.'))
                          .catch((error: Error) => toast.error(error.message))
                      }
                    />
                  </View>
                ))}
                <View style={styles.memberRow}>
                  <View style={styles.flex}>
                    <TextField label="Kullanıcı adı" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="kullaniciadi" />
                  </View>
                  <Button
                    label="Ekle"
                    size="sm"
                    fullWidth={false}
                    loading={member.isPending}
                    onPress={async () => {
                      try {
                        await member.mutateAsync({ advertiserId: advertiser.id, username: username.replace(/^@/, ''), add: true });
                        setUsername('');
                        toast.success('Kullanıcı eklendi.');
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : 'Kullanıcı eklenemedi.');
                      }
                    }}
                  />
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '700' },
  searchWrap: {
    flexGrow: 1,
    flexBasis: 260,
    height: 38,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    minWidth: 220,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 6, outlineStyle: 'none' } as never,
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  panel: { width: '100%', maxWidth: 720, maxHeight: '92%', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  panelHead: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  form: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexGrow: 1, flexBasis: 180 },
  members: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8, marginTop: 6 },
  memberRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
});
