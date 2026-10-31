import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  usePropertyStaff,
  useRemoveStaff,
  useSaveStaff,
} from '../hooks/use-accommodation';
import type { StaffMember, StaffRole } from '../types';
import { STAFF_ROLE_LABELS, formatDate } from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  StatusPill,
} from './AccommodationUI';

const ASSIGNABLE_ROLES: Exclude<StaffRole, 'owner'>[] = [
  'manager',
  'front_desk',
  'housekeeping',
  'accountant',
  'viewer',
];

const PERMISSIONS: { key: string; label: string; group: string }[] = [
  { key: 'reservations', label: 'Rezervasyonlar', group: 'Operasyon' },
  { key: 'frontdesk', label: 'Ön büro ve giriş/çıkış', group: 'Operasyon' },
  { key: 'guests', label: 'Misafir kayıtları', group: 'Operasyon' },
  { key: 'housekeeping', label: 'Kat hizmetleri', group: 'Operasyon' },
  { key: 'messages', label: 'Mesajlar', group: 'Operasyon' },
  { key: 'complaints', label: 'Şikayet ve destek', group: 'Operasyon' },
  { key: 'calendar.view', label: 'Takvimi görüntüle', group: 'Takvim' },
  { key: 'rooms', label: 'Oda yönetimi', group: 'Tanım' },
  { key: 'rooms.view', label: 'Odaları görüntüle', group: 'Tanım' },
  { key: 'rates', label: 'Fiyat ve müsaitlik', group: 'Tanım' },
  { key: 'campaigns', label: 'Kampanyalar', group: 'Tanım' },
  { key: 'media', label: 'Fotoğraf ve medya', group: 'Tanım' },
  { key: 'cash.collect', label: 'Kasa tahsilatı', group: 'Finans' },
  { key: 'cash', label: 'Kasa yönetimi', group: 'Finans' },
  { key: 'finance', label: 'Finans ve giderler', group: 'Finans' },
  { key: 'commission', label: 'Komisyon', group: 'Finans' },
  { key: 'documents', label: 'Belgeler', group: 'Finans' },
  { key: 'reports.view', label: 'Raporları görüntüle', group: 'Finans' },
  { key: 'reports', label: 'PDF / Excel raporları', group: 'Finans' },
  { key: 'staff', label: 'Personel yönetimi', group: 'Yönetim' },
  { key: 'settings', label: 'Tesis ayarları', group: 'Yönetim' },
  { key: 'reviews', label: 'Yorumlar', group: 'Yönetim' },
];

const ROLE_DEFAULTS: Record<Exclude<StaffRole, 'owner'>, string> = {
  manager: 'Tesis ayarları ve personel hariç tüm operasyon',
  front_desk: 'Rezervasyon, ön büro, misafir ve mesajlar',
  housekeeping: 'Kat hizmetleri ve oda görüntüleme',
  accountant: 'Finans, kasa, belgeler ve raporlar',
  viewer: 'Yalnızca görüntüleme (takvim)',
};

const STATUS_LABELS: Record<StaffMember['status'], string> = {
  active: 'Aktif',
  invited: 'Davetli',
  revoked: 'Yetkisiz',
};

export function StaffManager({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const staff = usePropertyStaff(propertyId);
  const save = useSaveStaff(propertyId);
  const remove = useRemoveStaff(propertyId);

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Exclude<StaffRole, 'owner'>>('front_desk');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);

  const items = staff.data?.items ?? [];
  const canManage = staff.data?.can_manage ?? false;

  const togglePermission = (key: string) =>
    setPermissions((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );

  const openInvite = () => {
    setUsername('');
    setRole('front_desk');
    setPermissions([]);
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    if (username.trim().length < 3) {
      setError('Trabzone kullanıcı adını gir.');
      return;
    }
    try {
      await save.mutateAsync({
        username: username.trim().replace(/^@/, ''),
        role,
        permissions,
      });
      setOpen(false);
      void staff.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Personel kaydedilemedi.');
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Personel ve yetkiler</AppText>
          <AppText variant="caption" color="textTertiary">
            {items.length} kayıtlı kullanıcı · rol bazlı erişim
          </AppText>
        </View>
        {canManage ? (
          <Button
            label="Personel ekle"
            size="sm"
            fullWidth={false}
            leftIcon={<Ionicons name="person-add-outline" size={15} color={theme.colors.onPrimary} />}
            onPress={openInvite}
          />
        ) : null}
      </View>

      {!canManage ? <InfoBanner text="Personel yönetimi için sahip veya yönetici yetkisi gerekir." tone="warning" /> : null}

      {error ? <InlineError message={error} /> : null}

      {staff.isLoading ? (
        <LoadingBlock height={200} />
      ) : staff.isError ? (
        <InlineError
          message={staff.error instanceof Error ? staff.error.message : 'Personel listesi yüklenemedi.'}
          onRetry={() => void staff.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="Personel yok"
          message="Ekibini Trabzone kullanıcı adıyla ekleyerek görev ve yetki ver."
          compact
        />
      ) : (
        <View style={styles.grid}>
          {items.map((member) => {
            const roleTone = member.role === 'owner' ? theme.colors.primary : theme.colors.textSecondary;
            return (
              <AccCard key={member.id} padding={12} style={styles.card}>
                <View style={styles.memberRow}>
                  <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}>
                    <AppText variant="bodyStrong" color="primary">
                      {(member.display_name ?? member.username).slice(0, 1).toUpperCase()}
                    </AppText>
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {member.display_name ?? member.username}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      @{member.username}
                    </AppText>
                  </View>
                  <StatusPill
                    label={STATUS_LABELS[member.status]}
                    color={member.status === 'active' ? theme.colors.success : member.status === 'invited' ? theme.colors.warning : theme.colors.danger}
                    background={member.status === 'active' ? theme.colors.successSoft : member.status === 'invited' ? theme.colors.warningSoft : theme.colors.dangerSoft}
                  />
                </View>

                <View style={styles.roleRow}>
                  <View style={[styles.rolePill, { backgroundColor: theme.colors.surfaceMuted }]}>
                    <Ionicons name="shield-outline" size={11} color={roleTone} />
                    <AppText variant="caption" style={{ color: roleTone, fontSize: 10 }}>
                      {STAFF_ROLE_LABELS[member.role]}
                    </AppText>
                  </View>
                  <AppText variant="caption" color="textTertiary" style={styles.small}>
                    {member.created_at ? formatDate(member.created_at.slice(0, 10)) : ''}
                  </AppText>
                </View>

                <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                  {member.permissions.includes('*') || member.permissions.length === 0
                    ? member.role === 'owner'
                      ? 'Tüm yetkiler'
                      : ROLE_DEFAULTS[member.role as Exclude<StaffRole, 'owner'>] ?? 'Rol varsayılanları'
                    : member.permissions
                        .map((key) => PERMISSIONS.find((entry) => entry.key === key)?.label ?? key)
                        .join(', ')}
                </AppText>

                {canManage && member.role !== 'owner' ? (
                  <View style={[styles.cardFooter, { borderTopColor: theme.colors.divider }]}>
                    <Button
                      label="Yetki ver"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() => {
                        setUsername(member.username);
                        setRole(member.role as Exclude<StaffRole, 'owner'>);
                        setPermissions(member.permissions.filter((entry) => entry !== '*'));
                        setError(null);
                        setOpen(true);
                      }}
                    />
                    <Button
                      label="Kaldır"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() => setRemoving(member)}
                    />
                  </View>
                ) : null}
              </AccCard>
            );
          })}
        </View>
      )}

      <InfoBanner text="Personel yalnızca kendi tesisinin verilerine erişir. Hassas misafir bilgileri ve finans kayıtları yalnızca yetkilendirilmiş personel tarafından görüntülenir. Tüm işlemler denetim kaydına yazılır." />

      <ModalSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={username && items.some((item) => item.username === username) ? 'Yetkileri güncelle' : 'Personel ekle'}
        subtitle="Trabzone kullanıcı hesabı ile eşleştirilir"
        maxWidth={560}
        footer={<Button label="Kaydet" loading={save.isPending} onPress={() => void submit()} />}
      >
        <View style={{ gap: 12 }}>
          <TextField
            label="Trabzone kullanıcı adı"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="kullaniciadi"
            editable={!items.some((item) => item.username === username)}
            error={error}
          />

          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Rol</AppText>
            <View style={styles.chips}>
              {ASSIGNABLE_ROLES.map((value) => (
                <Chip
                  key={value}
                  label={STAFF_ROLE_LABELS[value]}
                  active={role === value}
                  onPress={() => {
                    setRole(value);
                    setPermissions([]);
                  }}
                />
              ))}
            </View>
            <AppText variant="caption" color="textTertiary" style={styles.roleHint}>
              {ROLE_DEFAULTS[role]}
            </AppText>
          </View>

          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Özel yetkiler</AppText>
            <AppText variant="caption" color="textTertiary" style={styles.roleHint}>
              Boş bırakılırsa rolün varsayılan yetkileri uygulanır.
            </AppText>
            <View style={styles.chips}>
              {PERMISSIONS.map((permission) => (
                <Chip
                  key={permission.key}
                  label={permission.label}
                  active={permissions.includes(permission.key)}
                  onPress={() => togglePermission(permission.key)}
                />
              ))}
              <Chip
                label="Tüm yetkiler"
                active={permissions.includes('*')}
                onPress={() =>
                  setPermissions((current) => (current.includes('*') ? [] : ['*']))
                }
              />
            </View>
          </View>

          <View style={[styles.summary, { borderColor: theme.colors.border }]}>
            <KeyValueRow label="Rol" value={STAFF_ROLE_LABELS[role]} />
            <KeyValueRow
              label="Yetki modu"
              value={
                permissions.length === 0
                  ? 'Rol varsayılanı'
                  : permissions.includes('*')
                    ? 'Tüm yetkiler'
                    : `${permissions.length} özel yetki`
              }
            />
          </View>
        </View>
      </ModalSheet>

      <ModalSheet
        visible={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Personeli kaldır"
        subtitle={removing ? `@${removing.username}` : undefined}
        maxWidth={420}
        footer={
          <View style={styles.modalFooter}>
            <Button label="Vazgeç" variant="ghost" fullWidth={false} onPress={() => setRemoving(null)} />
            <Button
              label="Kaldır"
              variant="danger"
              fullWidth={false}
              loading={remove.isPending}
              onPress={async () => {
                if (!removing) return;
                try {
                  await remove.mutateAsync(removing.user_id);
                  setRemoving(null);
                  void staff.refetch();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Personel kaldırılamadı.');
                }
              }}
            />
          </View>
        }
      >
        <AppText variant="body" color="textSecondary">
          Bu kullanıcının tesise erişimi kaldırılacak. Geçmiş işlem kayıtları denetim amacıyla korunur.
        </AppText>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '32%', minWidth: 265, flexGrow: 1, gap: 6 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  small: { fontSize: 9 },
  cardFooter: { flexDirection: 'row', gap: 2, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  fieldLabel: { marginBottom: 6 },
  roleHint: { marginBottom: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  summary: { gap: 3, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
