import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState, type ComponentProps } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminMe,
  useAdminSessions,
  useEnrollMfa,
  useMfaStatus,
  useRevokeSession,
  useSecurityOverview,
  useSettingSet,
  useVerifyMfa,
} from '@/features/admin/hooks/use-admin';
import { cancelEnrollment } from '@/features/admin/services/mfa-service';
import type { AdminSession } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr } from '@/utils/date';

export default function AdminSecurityScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const overview = useSecurityOverview();
  const sessions = useAdminSessions();
  const revoke = useRevokeSession();
  const [tab, setTab] = useState<'sessions' | 'signals' | 'events'>('sessions');
  const [target, setTarget] = useState<AdminSession | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<{ factorId: string; secret: string; uri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);

  const mfaStatus = useMfaStatus();
  const enrollMfa = useEnrollMfa();
  const verifyMfa = useVerifyMfa();
  const setSetting = useSettingSet();

  const canManage = (me.data?.permissions ?? []).includes('security.manage');
  const stats = overview.data?.stats;
  const rows = (sessions.data ?? []).filter((session) => showAll || !session.revoked_at);

  const columns: Column<AdminSession>[] = [
    {
      key: 'user',
      label: 'Personel',
      width: 1.5,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <AppText variant="caption" style={{ fontWeight: '700' }}>
              {row.display_name ?? 'Bilinmeyen'}
            </AppText>
            {row.is_current ? <Badge label="Bu oturum" tone="success" /> : null}
          </View>
          <AppText variant="caption" color="textTertiary">
            @{row.username ?? '—'}
          </AppText>
        </View>
      ),
    },
    {
      key: 'agent',
      label: 'Cihaz',
      width: 1.6,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary" numberOfLines={2}>
          {row.user_agent ?? 'Bilinmeyen cihaz'}
        </AppText>
      ),
    },
    {
      key: 'ip',
      label: 'IP (maskeli)',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textTertiary" style={{ fontFamily: 'monospace' }}>
          {row.ip_masked ?? '—'}
        </AppText>
      ),
    },
    {
      key: 'lastSeen',
      label: 'Son görülme',
      width: 0.9,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <AppText variant="caption" color="textSecondary">
            {formatRelativeTr(row.last_seen_at)}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {formatDateTimeTr(row.created_at)}
          </AppText>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 0.7,
      render: (row) =>
        row.revoked_at ? (
          <Badge label="Sonlandırıldı" tone="neutral" />
        ) : (
          <Badge label="Aktif" tone="success" />
        ),
    },
    {
      key: 'action',
      label: '',
      width: 0.8,
      render: (row) =>
        canManage && !row.revoked_at ? (
          <Button
            label={row.is_current ? 'Bu oturumu kapat' : 'Sonlandır'}
            size="sm"
            variant="danger"
            fullWidth={false}
            onPress={() => setTarget(row)}
          />
        ) : null,
    },
  ];

  const startMfa = async () => {
    setMfaError(null);
    setMfaCode('');
    setMfaOpen(true);
    try {
      const result = await enrollMfa.mutateAsync();
      setEnrollment(result);
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : 'MFA kaydı başlatılamadı.');
    }
  };

  const confirmMfa = async () => {
    if (!enrollment) return;
    if (!/^\d{6}$/.test(mfaCode.replace(/\s+/g, ''))) {
      setMfaError('Doğrulama kodu 6 haneli olmalı.');
      return;
    }
    setMfaError(null);
    try {
      await verifyMfa.mutateAsync({ factorId: enrollment.factorId, code: mfaCode });
      toast.success('İki faktörlü doğrulama etkinleştirildi.');
      setMfaOpen(false);
      setEnrollment(null);
      setMfaCode('');
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : 'Kod doğrulanamadı.');
    }
  };

  const closeMfa = () => {
    setMfaOpen(false);
    setMfaError(null);
    setMfaCode('');
    if (enrollment) {
      void cancelEnrollment(enrollment.factorId);
      setEnrollment(null);
    }
  };

  return (
    <AdminPage
      title="Güvenlik Merkezi"
      subtitle="Yönetici oturumları, şüpheli sinyaller ve güvenlik olayları."
      refreshing={overview.isRefetching || sessions.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void sessions.refetch();
      }}
      actions={
        <Badge
          label={overview.data?.mfa_required ? 'MFA zorunlu' : 'MFA önerilir'}
          tone={overview.data?.mfa_required ? 'success' : 'warning'}
        />
      }
    >
      <StatGrid>
        <StatCard label="Aktif oturum" value={String(stats?.active_sessions ?? 0)} icon="key-outline" hint="Son 30 gün içinde aktif" />
        <StatCard label="Sonlandırılan (7 gün)" value={String(stats?.revoked_sessions_7d ?? 0)} icon="log-out-outline" tone="warning" hint="Manuel veya otomatik" />
        <StatCard label="Başarısız giriş (24 sa)" value={String(stats?.failed_logins_24h ?? 0)} icon="alert-circle-outline" tone={stats?.failed_logins_24h ? 'danger' : 'success'} hint="Şüpheli denemeler" />
        <StatCard label="Rate limit ihlali" value={String(stats?.rate_limit_hits_24h ?? 0)} icon="speedometer-outline" tone={stats?.rate_limit_hits_24h ? 'warning' : 'primary'} hint="Kötüye kullanım sinyali" />
        <StatCard label="Kritik açık şikâyet" value={String(stats?.open_critical_reports ?? 0)} icon="shield-half-outline" tone={stats?.open_critical_reports ? 'danger' : 'success'} hint="Çocuk güvenliği dahil" />
        <StatCard label="Askıdaki hesap" value={String(stats?.suspended_accounts ?? 0)} icon="pause-circle-outline" hint="Aktif olmayan hesaplar" />
        <StatCard label="Doğrulanmamış personel oturumu" value={String(stats?.unverified_staff_sessions ?? 0)} icon="warning-outline" tone={stats?.unverified_staff_sessions ? 'warning' : 'success'} hint="MFA bekleyen" />
        <StatCard label="Oturum süresi" value={`${overview.data?.session_hours ?? 0} sa`} icon="time-outline" hint="Zorunlu yeniden kimlik doğrulama" />
      </StatGrid>

      <AdminSection title="Oturum ve sinyal merkezi" subtitle="IP adresleri maskelenir; erişim denetim kaydına yazılır.">
        <FilterChips
          options={[
            { key: 'sessions' as const, label: 'Oturumlar' },
            { key: 'signals' as const, label: 'Kötüye kullanım sinyalleri' },
            { key: 'events' as const, label: 'Güvenlik olayları' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'sessions' ? (
          <>
            <FilterChips
              options={[
                { key: 'active' as const, label: 'Aktif oturumlar' },
                { key: 'all' as const, label: 'Tümü' },
              ]}
              value={showAll ? 'all' : 'active'}
              onChange={(value) => setShowAll(value === 'all')}
            />
            <DataTable
              columns={columns}
              rows={rows}
              keyExtractor={(row) => row.session_id}
              loading={sessions.isLoading}
              empty={
                <View style={styles.empty}>
                  <Ionicons name="key-outline" size={22} color={theme.colors.textTertiary} />
                  <AppText variant="caption" color="textSecondary">
                    Oturum bulunamadı.
                  </AppText>
                </View>
              }
            />
          </>
        ) : null}

        {tab === 'signals' ? (
          <View style={{ gap: 5 }}>
            {(overview.data?.signals ?? []).length === 0 ? (
              <AppText variant="caption" color="textTertiary" style={{ paddingVertical: 16 }}>
                Olağan dışı sinyal yok.
              </AppText>
            ) : (
              overview.data?.signals.map((signal) => (
                <View key={signal.user_id} style={[styles.signalRow, { borderColor: theme.colors.divider }]}>
                  <View style={[styles.signalIcon, { backgroundColor: theme.colors.warningSoft }]}>
                    <Ionicons name="warning-outline" size={16} color={theme.colors.warning} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText variant="caption" style={{ fontWeight: '700' }}>
                      {signal.display_name} (@{signal.username})
                    </AppText>
                    <AppText variant="caption" color="textSecondary">
                      {signal.signal}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {signal.message_count} mesaj · {signal.report_count} şikâyet
                    </AppText>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        {tab === 'events' ? (
          <View style={{ gap: 4 }}>
            {(overview.data?.events ?? []).length === 0 ? (
              <AppText variant="caption" color="textTertiary" style={{ paddingVertical: 16 }}>
                Güvenlik olayı yok.
              </AppText>
            ) : (
              overview.data?.events.map((event) => (
                <View key={String(event.id)} style={[styles.eventRow, { borderColor: theme.colors.divider }]}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="caption" style={{ fontWeight: '600' }}>
                      {event.action_label}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {event.actor_name ?? 'Sistem'} · {event.target_type ?? '—'} · {formatDateTimeTr(event.created_at)}
                    </AppText>
                  </View>
                  <AppText variant="caption" color="textTertiary" style={{ fontFamily: 'monospace' }}>
                    {event.action_code}
                  </AppText>
                </View>
              ))
            )}
          </View>
        ) : null}
      </AdminSection>

      <AdminSection
        title="İki faktörlü doğrulama (TOTP)"
        subtitle="Yönetici hesabınızı authenticator uygulamasıyla koruyun. Kritik işlemler için AAL2 oturumu gerekir."
        action={
          <Badge
            label={mfaStatus.data?.currentLevel === 'aal2' ? 'AAL2 doğrulandı' : 'Tek faktör'}
            tone={mfaStatus.data?.currentLevel === 'aal2' ? 'success' : 'warning'}
          />
        }
      >
        {(mfaStatus.data?.verified.length ?? 0) === 0 ? (
          <View style={[styles.mfaEmpty, { borderColor: theme.colors.border }]}>
            <View style={[styles.mfaIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="keypad-outline" size={20} color={theme.colors.primaryDeep} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong">Henüz doğrulanmış faktör yok</AppText>
              <AppText variant="caption" color="textTertiary">
                Authenticator uygulamasıyla QR kodu okutun ve 6 haneli kodu girin.
              </AppText>
            </View>
            <Button
              label="MFA kur"
              size="sm"
              fullWidth={false}
              loading={enrollMfa.isPending}
              onPress={() => void startMfa()}
            />
          </View>
        ) : (
          <View style={{ gap: 7 }}>
            {mfaStatus.data?.verified.map((factor) => (
              <View key={factor.id} style={[styles.mfaFactor, { borderColor: theme.colors.divider }]}>
                <Ionicons name="checkmark-circle" size={17} color={theme.colors.success} />
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" style={{ fontWeight: '600' }}>
                    {factor.friendlyName ?? 'Authenticator'}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    Doğrulandı · {formatDateTimeTr(factor.createdAt)}
                  </AppText>
                </View>
                <Badge label="Etkin" tone="success" />
              </View>
            ))}
            <View>
              <Button
                label="Ek cihaz ekle"
                size="sm"
                variant="secondary"
                fullWidth={false}
                loading={enrollMfa.isPending}
                onPress={() => void startMfa()}
              />
            </View>
          </View>
        )}

        <View style={[styles.policyRow, { borderColor: theme.colors.divider }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="caption" style={{ fontWeight: '600' }}>
              Kritik işlemlerde MFA zorunluluğu
            </AppText>
            <AppText variant="caption" color="textTertiary">
              Açıkken özellik değiştirme, rol atama ve oturum sonlandırma gibi işlemler AAL2 oturumu ister.
            </AppText>
          </View>
          {canManage ? (
            <Button
              label={overview.data?.mfa_required ? 'Zorunluluğu kaldır' : 'Zorunlu kıl'}
              size="sm"
              variant={overview.data?.mfa_required ? 'outline' : 'primary'}
              fullWidth={false}
              loading={setSetting.isPending}
              onPress={() => setPolicyOpen(true)}
            />
          ) : (
            <Badge label={overview.data?.mfa_required ? 'Açık' : 'Kapalı'} tone={overview.data?.mfa_required ? 'success' : 'neutral'} />
          )}
        </View>
      </AdminSection>

      <AdminSection title="Yönetici güvenliği" subtitle="Kurumsal politika özeti">
        <SecurityLine
          icon="phone-portrait-outline"
          label="Çok faktörlü kimlik doğrulama"
          value={overview.data?.mfa_required ? 'Zorunlu' : 'Önerilir'}
        />
        <SecurityLine
          icon="time-outline"
          label="Oturum süresi"
          value={`${overview.data?.session_hours ?? 0} saat`}
        />
        <SecurityLine
          icon="shield-checkmark-outline"
          label="Kritik işlemlerde yeniden kimlik doğrulama"
          value="Aktif"
        />
        <SecurityLine
          icon="eye-off-outline"
          label="IP adresi gösterimi"
          value="Maskeli"
        />
        <AppText variant="caption" color="textTertiary">
          Oturum sonlandırma ve güvenlik ayarları yalnızca `security.manage` yetkisiyle yapılır.
          Tüm kararlar gerekçe ve denetim kaydı gerektirir.
        </AppText>
      </AdminSection>

      <Modal visible={mfaOpen} transparent animationType="fade" onRequestClose={closeMfa}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="MFA kurulumunu kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={closeMfa}
          />
          <View
            style={[
              styles.mfaSheet,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <View style={styles.mfaSheetHead}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="h3">Authenticator kur</AppText>
                <AppText variant="caption" color="textTertiary">
                  Google Authenticator, 1Password veya Microsoft Authenticator kullanabilirsin.
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={closeMfa}
                style={[styles.mfaClose, { backgroundColor: theme.colors.surfaceMuted }]}
              >
                <Ionicons name="close" size={17} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            {enrollMfa.isPending && !enrollment ? (
              <View style={styles.mfaLoading}>
                <AppText variant="caption" color="textSecondary">
                  Kayıt hazırlanıyor…
                </AppText>
              </View>
            ) : enrollment ? (
              <>
                <View style={styles.qrWrap}>
                  <QRCode value={enrollment.uri} size={176} backgroundColor="#FFFFFF" color="#0B2A6B" />
                </View>
                <View style={{ gap: 4 }}>
                  <AppText variant="caption" color="textSecondary">
                    QR kodu okutamıyorsan bu anahtarı elle gir:
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Gizli anahtarı kopyala"
                    onPress={() => {
                      void Clipboard.setStringAsync(enrollment.secret);
                      toast.info('Kurulum anahtarı kopyalandı.');
                    }}
                    style={[styles.secretBox, { backgroundColor: theme.colors.surfaceMuted }]}
                  >
                    <AppText variant="caption" style={{ fontFamily: 'monospace', letterSpacing: 1 }}>
                      {enrollment.secret}
                    </AppText>
                    <Ionicons name="copy-outline" size={14} color={theme.colors.textTertiary} />
                  </Pressable>
                </View>
                <TextField
                  label="6 haneli doğrulama kodu"
                  value={mfaCode}
                  onChangeText={setMfaCode}
                  placeholder="000000"
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
              </>
            ) : null}

            {mfaError ? (
              <View style={[styles.mfaError, { backgroundColor: theme.colors.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={14} color={theme.colors.danger} />
                <AppText variant="caption" color="danger" style={{ flex: 1 }}>
                  {mfaError}
                </AppText>
              </View>
            ) : null}

            <View style={styles.mfaActions}>
              <Button label="Vazgeç" variant="secondary" fullWidth={false} onPress={closeMfa} />
              <Button
                label="Doğrula ve etkinleştir"
                fullWidth={false}
                loading={verifyMfa.isPending}
                disabled={!enrollment}
                onPress={() => void confirmMfa()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <ReasonDialog
        visible={Boolean(target)}
        title="Oturumu sonlandır"
        description={
          target?.is_current
            ? 'Kendi oturumunuzu sonlandırıyorsunuz. İşlem sonrası yeniden giriş yapmanız gerekir.'
            : 'Seçili personel oturumu anında geçersiz hale gelir.'
        }
        confirmLabel="Oturumu sonlandır"
        destructive
        loading={revoke.isPending}
        onCancel={() => setTarget(null)}
        onConfirm={async ({ reason }) => {
          if (!target) return;
          try {
            await revoke.mutateAsync({ sessionId: target.session_id, reason });
            setTarget(null);
            toast.success('Oturum sonlandırıldı.');
            void sessions.refetch();
            void overview.refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Oturum sonlandırılamadı.');
          }
        }}
      />

      <ReasonDialog
        visible={policyOpen}
        title={overview.data?.mfa_required ? 'MFA zorunluluğunu kaldır' : 'MFA zorunluluğunu aç'}
        description={
          overview.data?.mfa_required
            ? 'Kritik yönetici işlemleri yeniden tek faktörle yapılabilir hale gelir. Bu değişiklik denetim kaydına yazılır.'
            : 'Kritik yönetici işlemleri için AAL2 oturumu zorunlu olur. Önce kendi authenticator cihazınızı kurduğunuzdan emin olun.'
        }
        confirmLabel={overview.data?.mfa_required ? 'Zorunluluğu kaldır' : 'Zorunlu kıl'}
        destructive={overview.data?.mfa_required}
        loading={setSetting.isPending}
        onCancel={() => setPolicyOpen(false)}
        onConfirm={async ({ reason }) => {
          try {
            await setSetting.mutateAsync({
              key: 'security.require_admin_mfa',
              value: !overview.data?.mfa_required,
              reason,
            });
            setPolicyOpen(false);
            toast.success('Güvenlik politikası güncellendi.');
            void overview.refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Politika güncellenemedi.');
          }
        }}
      />
    </AdminPage>
  );
}

function SecurityLine({
  icon,
  label,
  value,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.securityLine, { borderColor: theme.colors.divider }]}>
      <Ionicons name={icon} size={16} color={theme.colors.primary} />
      <AppText variant="caption" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Badge label={value} tone="neutral" />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 30 },
  signalRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  signalIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  eventRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  securityLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  mfaEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  mfaIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mfaFactor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  mfaSheet: {
    width: '100%',
    maxWidth: 480,
    padding: 18,
    gap: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mfaSheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  mfaClose: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  mfaLoading: { alignItems: 'center', paddingVertical: 24 },
  qrWrap: { alignSelf: 'center', padding: 12, backgroundColor: '#FFFFFF', borderRadius: 12 },
  secretBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 9,
  },
  mfaError: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 9 },
  mfaActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  policyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
});
