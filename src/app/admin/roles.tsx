import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
} from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminMe,
  useAssignRole,
  useFindUser,
  useRevokeRole,
  useRolePermissionsSet,
  useRolesOverview,
  useStaff,
} from '@/features/admin/hooks/use-admin';
import type { FoundUser } from '@/features/admin/services/admin-service';
import type { RoleOverview, StaffMember } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr } from '@/utils/date';

type RoleRow = RoleOverview['roles'][number];
type PermissionRow = RoleOverview['permissions'][number];

const ROLE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  super_admin: 'shield-checkmark-outline',
  admin: 'briefcase-outline',
  moderator: 'eye-outline',
  support: 'headset-outline',
  marketplace_manager: 'cart-outline',
  finance: 'wallet-outline',
  analyst: 'analytics-outline',
};

export default function AdminRolesScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const overview = useRolesOverview();
  const staff = useStaff();
  const setPermissions = useRolePermissionsSet();
  const revokeRole = useRevokeRole();
  const assignRole = useAssignRole();

  const [tab, setTab] = useState<'roles' | 'staff'>('roles');
  const [selectedRole, setSelectedRole] = useState<RoleRow | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [permissionReason, setPermissionReason] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ member: StaffMember; roleKey: string } | null>(
    null,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [pickedUser, setPickedUser] = useState<FoundUser | null>(null);
  const [pickedRole, setPickedRole] = useState('moderator');

  const canManage = (me.data?.permissions ?? []).includes('admin.manage');
  const roles = overview.data?.roles ?? [];
  const staffRoles = useMemo(
    () => roles.filter((role) => role.key === 'super_admin' || role.permissions.length > 0),
    [roles],
  );
  const permissions = overview.data?.permissions ?? [];
  const staffRows = useMemo(
    () => [...(staff.data ?? [])].sort((a, b) => b.active_sessions - a.active_sessions),
    [staff.data],
  );
  const searchUsers = useFindUser(userQuery);
  const roleMap = useMemo(() => new Map(roles.map((role) => [role.key, role])), [roles]);

  const openRole = (role: RoleRow) => {
    setSelectedRole(role);
    setDraftPermissions(role.permissions);
    setPermissionReason('');
    setPermissionError(null);
  };

  const togglePermission = (code: string) => {
    setDraftPermissions((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  };

  const savePermissions = async () => {
    if (!selectedRole) return;
    if (permissionReason.trim().length < 3) {
      setPermissionError('En az 3 karakterlik bir gerekçe yaz.');
      return;
    }
    setPermissionError(null);
    try {
      await setPermissions.mutateAsync({
        roleKey: selectedRole.key,
        permissions: draftPermissions,
        reason: permissionReason.trim(),
      });
      toast.success('Rol yetkileri güncellendi.');
      setSelectedRole(null);
      void overview.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Yetkiler güncellenemedi.');
    }
  };

  const columns: Column<StaffMember>[] = [
    {
      key: 'person',
      label: 'Personel',
      width: 1.7,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
            {row.display_name || 'Bilinmeyen'}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            @{row.username || '—'} · {row.email || 'e-posta yok'}
          </AppText>
        </View>
      ),
    },
    {
      key: 'roles',
      label: 'Roller',
      width: 1.8,
      render: (row) => (
        <View style={styles.chips}>
          {row.roles.length === 0 ? (
            <Badge label="Rol yok" tone="neutral" />
          ) : (
            row.roles.map((role) => (
              <Badge key={role} label={roleMap.get(role)?.name ?? role} tone="primary" />
            ))
          )}
        </View>
      ),
    },
    {
      key: 'sessions',
      label: 'Aktif oturum',
      width: 0.7,
      hideOnMobile: true,
      render: (row) => (
        <Badge
          label={String(row.active_sessions)}
          tone={row.active_sessions > 0 ? 'success' : 'neutral'}
        />
      ),
    },
    {
      key: 'seen',
      label: 'Son görülme',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {formatRelativeTr(row.last_seen_at)}
        </AppText>
      ),
    },
    {
      key: 'action',
      label: '',
      width: 0.9,
      render: (row) =>
        canManage ? (
          <Button
            label="Rolleri yönet"
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => setSelectedStaff(row)}
          />
        ) : null,
    },
  ];

  return (
    <AdminPage
      title="Yönetici ve Yetkiler"
      subtitle="Rol bazlı erişim matrisi, personel dizini ve yetki atamaları."
      refreshing={overview.isRefetching || staff.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void staff.refetch();
      }}
      actions={
        canManage ? (
          <Button
            label="Yönetici ekle"
            size="sm"
            fullWidth={false}
            leftIcon={<Ionicons name="person-add-outline" size={15} color="#FFFFFF" />}
            onPress={() => {
              setAddOpen(true);
              setUserQuery('');
              setPickedUser(null);
              setPickedRole('moderator');
            }}
          />
        ) : (
          <Badge label="Salt okunur" tone="warning" />
        )
      }
    >
      <AdminSection
        title="Erişim modeli"
        subtitle="Her yetki sunucu tarafında tz_admin_require ile doğrulanır."
        action={<Badge label={`${staffRoles.length} rol`} tone="primary" />}
      >
        <View
          style={[
            styles.note,
            { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="information-circle-outline" size={17} color={theme.colors.primary} />
          <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
            Super Admin dâhil tüm yöneticiler işlem gerekçesi, denetim kaydı ve kritik işlemlerde
            ikinci onay kurallarına tabidir. Yetki değişiklikleri anında geçerli olur.
          </AppText>
        </View>
      </AdminSection>

      <AdminSection
        title={tab === 'roles' ? 'Rol ve yetki matrisi' : 'Personel dizini'}
        subtitle={
          tab === 'roles'
            ? 'Rollere tıklayarak granular yetkileri düzenleyin.'
            : 'Yönetici rolleri, oturum durumu ve son etkinlik.'
        }
      >
        <AdminToolbar>
          <FilterChips
            options={[
              { key: 'roles' as const, label: 'Roller', count: staffRoles.length },
              { key: 'staff' as const, label: 'Personel', count: staffRows.length },
            ]}
            value={tab}
            onChange={setTab}
          />
        </AdminToolbar>

        {tab === 'roles' ? (
          <View style={styles.roleGrid}>
            {overview.isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.colors.primary} />
              </View>
            ) : (
              staffRoles.map((role) => (
                <Pressable
                  key={role.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${role.name} yetkilerini düzenle`}
                  disabled={!canManage || role.key === 'super_admin'}
                  onPress={() => openRole(role)}
                  style={[
                    styles.roleCard,
                    {
                      backgroundColor: theme.colors.surfaceMuted,
                      borderColor: theme.colors.border,
                      opacity: role.key === 'super_admin' ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={styles.roleHead}>
                    <View style={[styles.roleIcon, { backgroundColor: theme.colors.primarySoft }]}>
                      <Ionicons
                        name={ROLE_ICONS[role.key] ?? 'ribbon-outline'}
                        size={17}
                        color={theme.colors.primary}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText variant="caption" style={{ fontWeight: '700' }}>
                        {role.name}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                        {role.description ?? 'Yetki grubu'}
                      </AppText>
                    </View>
                    <Badge label={`Sıra ${role.rank}`} tone="neutral" />
                  </View>
                  <View style={styles.roleMeta}>
                    <AppText variant="caption" color="textSecondary">
                      {role.permissions.length} yetki
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {role.user_count} personel
                    </AppText>
                  </View>
                  <View style={styles.chips}>
                    {role.key === 'super_admin' ? (
                      <Badge label="Korumalı rol" tone="warning" />
                    ) : (
                      <Badge label={canManage ? 'Düzenle' : 'Görüntüle'} tone="primary" />
                    )}
                  </View>
                </Pressable>
              ))
            )}
          </View>
        ) : (
          <DataTable
            columns={columns}
            rows={staffRows}
            keyExtractor={(row) => row.user_id}
            loading={staff.isLoading}
            empty={
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={22} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textSecondary">
                  Yönetici bulunamadı.
                </AppText>
              </View>
            }
          />
        )}
      </AdminSection>

      <AdminSection title="Yetki kataloğu" subtitle="Sunucu tarafında tanımlı granular izinler">
        <View style={styles.permCatalog}>
          {permissions.map((permission) => (
            <View
              key={permission.code}
              style={[styles.permRow, { borderColor: theme.colors.divider }]}
            >
              <AppText
                variant="caption"
                style={{ fontFamily: 'monospace', color: theme.colors.primary }}
              >
                {permission.code}
              </AppText>
              <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                {permission.description}
              </AppText>
            </View>
          ))}
        </View>
      </AdminSection>

      {/* Role permission editor */}
      <Modal
        visible={Boolean(selectedRole)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedRole(null)}
      >
        <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSelectedRole(null)}
            accessibilityLabel="Kapat"
          />
          <View
            style={[
              styles.modal,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">{selectedRole?.name}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {draftPermissions.length} yetki seçili. Kaldırılan yetki anında geçersiz olur.
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setSelectedRole(null)}
              >
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.permissionScroll}
              contentContainerStyle={{ gap: 6 }}
            >
              {permissions.map((permission) => {
                const active = draftPermissions.includes(permission.code);
                const locked = selectedRole?.key === 'super_admin';
                return (
                  <Pressable
                    key={permission.code}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active, disabled: locked }}
                    disabled={!canManage || locked}
                    onPress={() => togglePermission(permission.code)}
                    style={[
                      styles.permToggle,
                      {
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                      },
                    ]}
                  >
                    <Ionicons
                      name={active ? 'checkbox' : 'square-outline'}
                      size={17}
                      color={active ? theme.colors.primary : theme.colors.textTertiary}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText
                        variant="caption"
                        style={{ fontFamily: 'monospace', fontWeight: '600' }}
                      >
                        {permission.code}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {permission.description}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <TextField
              label="İşlem gerekçesi"
              placeholder="Yetki değişikliği gerekçesi"
              value={permissionReason}
              onChangeText={setPermissionReason}
              multiline
              maxLength={400}
            />
            {permissionError ? (
              <AppText variant="caption" color="danger">
                {permissionError}
              </AppText>
            ) : null}

            <View style={styles.actions}>
              <Button
                label="Vazgeç"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={() => setSelectedRole(null)}
                style={{ flex: 1 }}
              />
              <Button
                label="Yetkileri kaydet"
                size="sm"
                fullWidth={false}
                loading={setPermissions.isPending}
                disabled={!canManage}
                onPress={() => void savePermissions()}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Staff role management */}
      <Modal
        visible={Boolean(selectedStaff)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedStaff(null)}
      >
        <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSelectedStaff(null)}
            accessibilityLabel="Kapat"
          />
          <View
            style={[
              styles.modal,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">
                  {selectedStaff?.display_name || selectedStaff?.username}
                </AppText>
                <AppText variant="caption" color="textSecondary">
                  {selectedStaff?.email} · {selectedStaff?.active_sessions ?? 0} aktif oturum
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setSelectedStaff(null)}
              >
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <AppText variant="caption" color="textTertiary">
              Mevcut roller
            </AppText>
            <View style={{ gap: 6 }}>
              {(selectedStaff?.roles ?? []).length === 0 ? (
                <AppText variant="caption" color="textTertiary">
                  Bu personelin atanmış rolü yok.
                </AppText>
              ) : (
                selectedStaff?.roles.map((roleKey) => {
                  const role = roleMap.get(roleKey);
                  return (
                    <View
                      key={roleKey}
                      style={[styles.roleAssignment, { borderColor: theme.colors.border }]}
                    >
                      <Ionicons
                        name={ROLE_ICONS[roleKey] ?? 'ribbon-outline'}
                        size={16}
                        color={theme.colors.primary}
                      />
                      <View style={{ flex: 1 }}>
                        <AppText variant="caption" style={{ fontWeight: '600' }}>
                          {role?.name ?? roleKey}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {role?.permissions.length ?? 0} yetki
                        </AppText>
                      </View>
                      {canManage ? (
                        <Button
                          label="Kaldır"
                          size="sm"
                          variant="danger"
                          fullWidth={false}
                          onPress={() => {
                            if (selectedStaff) setRevokeTarget({ member: selectedStaff, roleKey });
                          }}
                        />
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>

            <AppText variant="caption" color="textTertiary">
              Rol ekle
            </AppText>
            <View style={styles.chips}>
              {staffRoles
                .filter((role) => !(selectedStaff?.roles ?? []).includes(role.key))
                .map((role) => (
                  <Button
                    key={role.key}
                    label={role.name}
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    loading={assignRole.isPending}
                    disabled={!canManage}
                    onPress={async () => {
                      if (!selectedStaff) return;
                      try {
                        await assignRole.mutateAsync({
                          userId: selectedStaff.user_id,
                          roleKey: role.key,
                        });
                        toast.success(`${role.name} rolü atandı.`);
                        setSelectedStaff((current) =>
                          current ? { ...current, roles: [...current.roles, role.key] } : current,
                        );
                        void overview.refetch();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : 'Rol atanamadı.');
                      }
                    }}
                  />
                ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Add admin */}
      <Modal
        visible={addOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAddOpen(false)}
      >
        <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setAddOpen(false)}
            accessibilityLabel="Kapat"
          />
          <View
            style={[
              styles.modal,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">Yönetici ekle</AppText>
                <AppText variant="caption" color="textSecondary">
                  Kullanıcı ara, seç ve uygun rolü ata. Atama audit log’a yazılır.
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setAddOpen(false)}
              >
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <TextField
              label="Kullanıcı ara"
              placeholder="Kullanıcı adı, ad soyad veya kullanıcı ID"
              value={userQuery}
              onChangeText={(value) => {
                setUserQuery(value);
                setPickedUser(null);
              }}
              autoCapitalize="none"
            />

            {userQuery.trim().length >= 2 ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 220 }}
                contentContainerStyle={{ gap: 6 }}
              >
                {searchUsers.isFetching ? (
                  <ActivityIndicator color={theme.colors.primary} style={{ padding: 12 }} />
                ) : (searchUsers.data ?? []).length === 0 ? (
                  <AppText variant="caption" color="textTertiary" style={{ paddingVertical: 8 }}>
                    Sonuç bulunamadı.
                  </AppText>
                ) : (
                  (searchUsers.data ?? []).map((user) => {
                    const active = pickedUser?.user_id === user.user_id;
                    return (
                      <Pressable
                        key={user.user_id}
                        onPress={() => setPickedUser(user)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.userRow,
                          {
                            borderColor: active ? theme.colors.primary : theme.colors.border,
                            backgroundColor: active
                              ? theme.colors.primarySoft
                              : theme.colors.surface,
                          },
                        ]}
                      >
                        <Ionicons
                          name={active ? 'radio-button-on' : 'radio-button-off'}
                          size={17}
                          color={active ? theme.colors.primary : theme.colors.textTertiary}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <AppText
                            variant="caption"
                            style={{ fontWeight: '600' }}
                            numberOfLines={1}
                          >
                            {user.display_name} · @{user.username}
                          </AppText>
                          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                            {user.email} · {user.account_status}
                          </AppText>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            ) : null}

            <AppText variant="caption" color="textTertiary">
              Atanacak rol
            </AppText>
            <View style={styles.chips}>
              {staffRoles.map((role) => (
                <Button
                  key={role.key}
                  label={role.name}
                  size="sm"
                  variant={pickedRole === role.key ? 'primary' : 'outline'}
                  fullWidth={false}
                  onPress={() => setPickedRole(role.key)}
                />
              ))}
            </View>

            <View style={styles.actions}>
              <Button
                label="Vazgeç"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={() => setAddOpen(false)}
                style={{ flex: 1 }}
              />
              <Button
                label="Rolü ata"
                size="sm"
                fullWidth={false}
                loading={assignRole.isPending}
                disabled={!pickedUser}
                onPress={async () => {
                  if (!pickedUser) return;
                  try {
                    await assignRole.mutateAsync({
                      userId: pickedUser.user_id,
                      roleKey: pickedRole,
                    });
                    toast.success('Yönetici rolü atandı.');
                    setAddOpen(false);
                    void overview.refetch();
                    void staff.refetch();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Atama başarısız.');
                  }
                }}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <ReasonDialog
        visible={Boolean(revokeTarget)}
        title="Rolü kaldır"
        description={
          revokeTarget
            ? `${revokeTarget.member.display_name || revokeTarget.member.username} kullanıcısından "${
                roleMap.get(revokeTarget.roleKey)?.name ?? revokeTarget.roleKey
              }" rolü kaldırılacak.`
            : undefined
        }
        confirmLabel="Rolü kaldır"
        destructive
        loading={revokeRole.isPending}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={async ({ reason }) => {
          if (!revokeTarget) return;
          try {
            await revokeRole.mutateAsync({
              userId: revokeTarget.member.user_id,
              roleKey: revokeTarget.roleKey,
              reason,
            });
            toast.success('Rol kaldırıldı.');
            setSelectedStaff((current) =>
              current
                ? {
                    ...current,
                    roles: current.roles.filter((role) => role !== revokeTarget.roleKey),
                  }
                : current,
            );
            setRevokeTarget(null);
            void overview.refetch();
            void staff.refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Rol kaldırılamadı.');
          }
        }}
      />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 11,
  },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  roleCard: {
    flexGrow: 1,
    flexBasis: 260,
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 9,
  },
  roleHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  roleIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  loading: { paddingVertical: 30, alignItems: 'center', width: '100%' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 30 },
  permCatalog: { gap: 0 },
  permRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  modal: { width: '100%', maxWidth: 560, padding: 18, gap: 11, borderWidth: 1, maxHeight: '90%' },
  modalHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  permissionScroll: { maxHeight: 300 },
  permToggle: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 9,
  },
  actions: { flexDirection: 'row', gap: 8 },
  roleAssignment: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 9,
  },
  userRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 9,
  },
});
