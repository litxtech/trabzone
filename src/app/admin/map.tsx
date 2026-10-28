import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { AdminPage, AdminSection } from '@/features/admin/components/AdminPage';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import {
  useMapAdminActiveShares,
  useMapAdminOverview,
  useMapAdminStopShare,
} from '@/features/map/hooks/use-map';
import type { MapAdminModuleState, MapAdminOverview } from '@/features/map/types';
import { useTheme } from '@/theme/ThemeProvider';

type TabKey = 'overview' | 'sharing' | 'modules' | 'privacy';

const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; permission: string }[] = [
  { key: 'overview', label: 'Dashboard', icon: 'grid-outline', permission: 'map.view' },
  { key: 'sharing', label: 'Aktif paylaşımlar', icon: 'radio-outline', permission: 'map.view' },
  { key: 'modules', label: 'Modül durumu', icon: 'layers-outline', permission: 'map.view' },
  { key: 'privacy', label: 'Gizlilik kontrolleri', icon: 'lock-closed-outline', permission: 'map.view' },
];

const MODULE_TONE: Record<MapAdminModuleState, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  ready: { label: 'Hazır', tone: 'success' },
  partial: { label: 'Kısmi', tone: 'warning' },
  not_configured: { label: 'Bağlı değil', tone: 'neutral' },
};

function formatMinutes(minutes: number) {
  if (minutes <= 0) return 'Bitti';
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} sa ${rest} dk` : `${hours} sa`;
}

export default function AdminMapScreen() {
  const { theme } = useTheme();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const [tab, setTab] = useState<TabKey>('overview');
  const can = (permission: string) => permissions.includes(permission);
  const allowed = TABS.filter((item) => can(item.permission));
  const active = allowed.find((item) => item.key === tab) ?? allowed[0] ?? null;

  return (
    <AdminPage
      title="Etkileşim Haritası Yönetimi"
      subtitle="Toplulaştırılmış harita metrikleri, paylaşım sonlandırma ve modül durumu. Bu ekran hiçbir koordinat, oturum sahibi veya izleyici kimliği göstermez."
      actions={<Badge label={me.isLoading ? 'Yetki kontrolü…' : `${permissions.length} izin`} tone="primary" />}
    >
      {me.isLoading ? (
        <View style={styles.stack}>
          <Skeleton height={44} />
          <Skeleton height={220} radius={14} />
        </View>
      ) : !me.data?.is_admin ? (
        <Locked message="Bu alan yönetici yetkisi gerektirir." />
      ) : allowed.length === 0 ? (
        <Locked message="Harita yönetimi için izniniz yok. Sistem yöneticisinden map.view iznini talep edin." />
      ) : (
        <>
          <View style={styles.tabs}>
            {allowed.map((item) => {
              const selected = active?.key === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setTab(item.key)}
                  style={[
                    styles.tab,
                    {
                      backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={14}
                    color={selected ? theme.colors.onPrimary : theme.colors.textSecondary}
                  />
                  <AppText variant="caption" color={selected ? 'onPrimary' : 'textSecondary'}>
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {active?.key === 'overview' ? <OverviewPanel /> : null}
          {active?.key === 'sharing' ? <SharingPanel canModerate={can('map.moderate')} /> : null}
          {active?.key === 'modules' ? <ModulesPanel /> : null}
          {active?.key === 'privacy' ? <PrivacyPanel /> : null}
        </>
      )}
    </AdminPage>
  );
}

function OverviewPanel() {
  const overview = useMapAdminOverview();

  if (overview.isLoading) return <LoadingBlock />;
  if (overview.isError) {
    return <ErrorBlock message={overview.error.message} onRetry={() => void overview.refetch()} />;
  }
  if (!overview.data) return null;
  const data = overview.data;

  return (
    <View style={styles.stack}>
      <StatGrid>
        <StatCard
          label="Harita tercihi olan kullanıcı"
          value={String(data.preferences.total)}
          icon="people-outline"
          hint={`${data.preferences.onboarded} tanıtımı tamamladı`}
        />
        <StatCard
          label="Gizli modda (hayalet)"
          value={String(data.preferences.ghost)}
          icon="eye-off-outline"
          tone="accent"
          hint="Varsayılan durum: gizli"
        />
        <StatCard
          label="Aktif konum paylaşımı"
          value={String(data.sharing.active)}
          icon="radio-outline"
          tone={data.sharing.active > 0 ? 'success' : 'primary'}
          hint={`${data.sharing.selected_audience} seçili kişilerle`}
        />
        <StatCard
          label="Hassas konum paylaşımı"
          value={String(data.sharing.precise_active)}
          icon="locate-outline"
          tone={data.sharing.precise_active > 0 ? 'warning' : 'success'}
          hint="Yalnızca açık izinle"
        />
        <StatCard
          label="Aktif izleyici izni"
          value={String(data.sharing.viewer_grants)}
          icon="eye-outline"
          hint={`${data.sharing.owners_24h} paylaşan (24 saat)`}
        />
        <StatCard
          label="Kaydedilen yer"
          value={String(data.library.saved_places)}
          icon="bookmark-outline"
          hint={`${data.library.public_places} herkese açık · ${data.library.link_places} bağlantı`}
        />
        <StatCard
          label="Takip edilen bölge"
          value={String(data.library.regions)}
          icon="notifications-outline"
          hint={`${data.library.instant_regions} anında bildirim`}
        />
        <StatCard
          label="Haritada yolculuk ilanı"
          value={String(data.rides.active_offers)}
          icon="car-outline"
          tone="success"
          hint={`${data.rides.with_coordinates} koordinatlı · ${data.rides.open_requests} açık talep`}
        />
      </StatGrid>

      <AdminSection title="Paylaşım yaşam döngüsü" subtitle="Süreli paylaşım; biten veya durdurulan oturum yeniden açılmaz.">
        <View style={styles.wrap}>
          <Badge label={`${data.sharing.expired_24h} son 24 saatte süresi doldu`} tone="neutral" />
          <Badge label={`${data.sharing.stopped_24h} kullanıcı tarafından durduruldu`} tone="neutral" />
          <Badge label={`${data.sharing.viewer_grants} aktif izleyici izni`} tone="primary" />
        </View>
        <AppText variant="caption" color="textTertiary">{data.privacy.retention_note}</AppText>
      </AdminSection>

      <AdminSection title="Hazır modüller" subtitle="Yalnızca gerçekten bağlı modüller hazır olarak işaretlenir.">
        <View style={styles.wrap}>
          {data.modules.map((module) => (
            <Badge
              key={module.key}
              label={`${module.label} · ${MODULE_TONE[module.state].label}`}
              tone={MODULE_TONE[module.state].tone}
            />
          ))}
        </View>
      </AdminSection>
    </View>
  );
}

function SharingPanel({ canModerate }: { canModerate: boolean }) {
  const shares = useMapAdminActiveShares(true);
  const stop = useMapAdminStopShare();
  const { theme } = useTheme();
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const run = (sessionId: string) => {
    if (reason.trim().length < 5) {
      setNotice('Sonlandırma için en az 5 karakterlik gerekçe girin.');
      return;
    }
    setNotice(null);
    stop.mutate(
      { sessionId, reason: reason.trim() },
      {
        onSuccess: () => setNotice('Paylaşım sonlandırıldı ve denetim kaydı oluşturuldu.'),
        onError: (cause) => setNotice(cause.message),
      },
    );
  };

  return (
    <AdminSection
      title="Aktif konum paylaşımları"
      subtitle="Koordinat ve kimlik gösterilmez; yalnızca süre, kitle ve izleyici sayısı listelenir."
      action={<Badge label={`${shares.data?.length ?? 0} aktif`} tone="neutral" />}
    >
      <View style={styles.wrap}>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Sonlandırma gerekçesi (denetim kaydına yazılır)"
          placeholderTextColor={theme.colors.textTertiary}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.inputBackground,
            },
          ]}
        />
        <Badge label="Gerekçe zorunlu" tone="warning" />
      </View>
      {notice ? <AppText variant="caption" color="primaryDeep">{notice}</AppText> : null}

      {shares.isLoading ? (
        <LoadingBlock compact />
      ) : shares.isError ? (
        <ErrorBlock message={shares.error.message} onRetry={() => void shares.refetch()} />
      ) : (shares.data?.length ?? 0) === 0 ? (
        <EmptyBlock text="Şu anda aktif konum paylaşımı yok." />
      ) : (
        <View style={styles.stack}>
          {shares.data?.map((share) => (
            <View
              key={share.session_id}
              style={[styles.row, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}
            >
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">
                    {share.audience === 'selected' ? 'Seçili kişilerle paylaşım' : 'Arkadaşlarla paylaşım'}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    Kalan süre {formatMinutes(share.expires_in_minutes)} · {share.viewer_count} izleyici
                  </AppText>
                </View>
                <Badge
                  label={share.precise ? 'Hassas konum' : 'Yaklaşık konum'}
                  tone={share.precise ? 'warning' : 'success'}
                />
              </View>
              {canModerate ? (
                <Button
                  label="Paylaşımı sonlandır"
                  size="sm"
                  variant="danger"
                  fullWidth={false}
                  loading={stop.isPending}
                  onPress={() => run(share.session_id)}
                />
              ) : (
                <AppText variant="caption" color="textTertiary">
                  Sonlandırma için map.moderate izni gerekir.
                </AppText>
              )}
            </View>
          ))}
        </View>
      )}
    </AdminSection>
  );
}

function ModulesPanel() {
  const overview = useMapAdminOverview();

  if (overview.isLoading) return <LoadingBlock />;
  if (overview.isError) {
    return <ErrorBlock message={overview.error.message} onRetry={() => void overview.refetch()} />;
  }
  if (!overview.data) return null;

  return (
    <AdminSection
      title="Harita modülleri"
      subtitle="Durum sunucudaki gerçek yapılandırmadan gelir; bağlı olmayan modül tamamlanmış sayılmaz."
    >
      {overview.data.modules.map((module) => (
        <ModuleRow key={module.key} module={module} />
      ))}
    </AdminSection>
  );
}

function ModuleRow({ module }: { module: MapAdminOverview['modules'][number] }) {
  const { theme } = useTheme();
  const tone = MODULE_TONE[module.state];
  return (
    <View style={[styles.moduleRow, { borderColor: theme.colors.border }]}>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{module.label}</AppText>
        <AppText variant="caption" color="textTertiary">
          {module.state === 'ready'
            ? 'Veritabanı, RPC ve istemci akışı bağlı.'
            : module.state === 'partial'
              ? 'Çekirdek akış var; bazı alt özellikler henüz bağlı değil.'
              : 'Veri kaynağı veya servis bağlı değil; tamamlanmış olarak işaretlenmez.'}
        </AppText>
      </View>
      <Badge label={tone.label} tone={tone.tone} />
    </View>
  );
}

function PrivacyPanel() {
  const overview = useMapAdminOverview();

  if (overview.isLoading) return <LoadingBlock />;
  if (overview.isError) {
    return <ErrorBlock message={overview.error.message} onRetry={() => void overview.refetch()} />;
  }
  if (!overview.data) return null;
  const privacy = overview.data.privacy;

  return (
    <View style={styles.stack}>
      <AdminSection title="Sunucu tarafı gizlilik kuralları" subtitle="Bu değerler veritabanı fonksiyonlarından okunur.">
        <View style={styles.wrap}>
          <Badge label={privacy.ghost_default ? 'Varsayılan: hayalet modu' : 'Varsayılan: paylaşım açık'} tone={privacy.ghost_default ? 'success' : 'danger'} />
          <Badge label={`Yaklaşık konum bulanıklığı: ~${privacy.approximate_fuzz_meters} m`} tone="neutral" />
          <Badge label={privacy.exact_requires_explicit_consent ? 'Hassas konum açık izinli' : 'Hassas konum izni eksik'} tone={privacy.exact_requires_explicit_consent ? 'success' : 'danger'} />
          <Badge label={privacy.raw_gps_in_public_results ? 'Herkese açık sonuçta GPS var' : 'Herkese açık sonuçta GPS yok'} tone={privacy.raw_gps_in_public_results ? 'danger' : 'success'} />
          <Badge label={privacy.admin_coordinate_access ? 'Admin koordinat erişimi: açık' : 'Admin koordinat erişimi: kapalı'} tone={privacy.admin_coordinate_access ? 'danger' : 'success'} />
          <Badge label={privacy.admin_identity_access ? 'Admin kimlik erişimi: açık' : 'Admin kimlik erişimi: kapalı'} tone={privacy.admin_identity_access ? 'danger' : 'success'} />
        </View>
        <AppText variant="caption" color="textTertiary">{privacy.retention_note}</AppText>
      </AdminSection>

      <AdminSection title="Yönetici erişim sınırı" subtitle="Gözetim ekranı değil">
        <AppText variant="caption" color="textSecondary">
          Bu modül hiçbir kullanıcının canlı koordinatını veya kimliğini listelemez. Tek yazma işlemi,
          güvenlik gerekçesiyle bir paylaşımı sonlandırmaktır ve her işlem değiştirilemez denetim
          kaydına yazılır. Konum verisine gerekçeli erişim ayrı bir yetkilendirme akışı gerektirir ve
          bu sürümde istemciye açılmamıştır.
        </AppText>
      </AdminSection>
    </View>
  );
}

function LoadingBlock({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.stack}>
      <Skeleton height={compact ? 40 : 20} width="40%" />
      <Skeleton height={compact ? 60 : 120} radius={12} />
      <Skeleton height={compact ? 60 : 120} radius={12} />
    </View>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
      <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
      <AppText variant="caption" color="danger" style={styles.flex}>{message}</AppText>
      <Button label="Yenile" size="sm" variant="outline" fullWidth={false} onPress={onRetry} />
    </View>
  );
}

function EmptyBlock({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.empty, { borderColor: theme.colors.border }]}>
      <Ionicons name="checkmark-done-outline" size={18} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textTertiary">{text}</AppText>
    </View>
  );
}

function Locked({ message }: { message: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.locked, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <Ionicons name="lock-closed-outline" size={22} color={theme.colors.textTertiary} />
      <AppText variant="body" color="textSecondary" align="center">{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: 10 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  row: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    height: 36,
    flex: 1,
    minWidth: 240,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12 },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  locked: {
    alignItems: 'center',
    gap: 10,
    padding: 30,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
