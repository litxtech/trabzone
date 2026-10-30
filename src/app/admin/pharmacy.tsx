import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { AdminAccessDenied, AdminQueryState } from '@/features/explore/admin/AdminExploreShared';
import { useTheme } from '@/theme/ThemeProvider';

import { PharmacyDutyTab } from '@/features/pharmacy/admin/PharmacyDutyTab';
import { PharmacyInventoryTab } from '@/features/pharmacy/admin/PharmacyInventoryTab';
import { PharmacyNotificationsTab } from '@/features/pharmacy/admin/PharmacyNotificationsTab';
import { PharmacyReviewsTab } from '@/features/pharmacy/admin/PharmacyReviewsTab';
import { PharmacySourcesTab } from '@/features/pharmacy/admin/PharmacySourcesTab';
import { formatDateTime, Pill } from '@/features/pharmacy/admin/shared';
import {
  useAdminPharmacyOverview,
  useAdminPharmacyQuality,
  usePharmacyBootstrap,
} from '@/features/pharmacy/hooks/use-pharmacy';

type TabKey = 'inventory' | 'duty' | 'sources' | 'reviews' | 'notifications';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'inventory', label: 'Eczane envanteri' },
  { key: 'duty', label: 'Nöbet yönetimi' },
  { key: 'sources', label: 'API ve kaynaklar' },
  { key: 'reviews', label: 'Yorumlar' },
  { key: 'notifications', label: 'Bildirimler' },
];

export default function AdminPharmacyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const canView = permissions.includes('pharmacy.view');
  const [tab, setTab] = useState<TabKey>('inventory');

  const overview = useAdminPharmacyOverview(canView);
  const quality = useAdminPharmacyQuality(canView);
  const bootstrap = usePharmacyBootstrap();

  const districts = useMemo(
    () => (bootstrap.data?.districts ?? []).map((item) => item.name).sort((a, b) => a.localeCompare(b, 'tr')),
    [bootstrap.data],
  );

  const flags = overview.data?.permissions;
  const canManage = Boolean(flags?.manage);
  const canModerate = Boolean(flags?.moderate);
  const canNotify = Boolean(flags?.notify);

  const inventory = overview.data?.inventory;
  const duty = overview.data?.duty;
  const queue = overview.data?.queue;

  return (
    <AdminPage
      title="Eczane yönetim merkezi"
      subtitle="Trabzon geneli eczane envanteri, nöbet çizelgesi, veri kaynakları, yorum moderasyonu ve nöbet bildirimleri."
      refreshing={overview.isRefetching || quality.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void quality.refetch();
        void bootstrap.refetch();
      }}
      actions={
        <>
          <Button
            label="Eczane rehberini aç"
            size="sm"
            variant="outline"
            fullWidth={false}
            leftIcon={<Ionicons name="medkit-outline" size={14} color={theme.colors.text} />}
            onPress={() => router.push('/eczaneler' as never)}
          />
          <Button
            label="Nöbetçi haritası"
            size="sm"
            variant="secondary"
            fullWidth={false}
            leftIcon={<Ionicons name="map-outline" size={14} color={theme.colors.primaryDeep} />}
            onPress={() => router.push('/eczaneler/harita' as never)}
          />
        </>
      }
    >
      {me.isLoading ? (
        <View style={{ gap: 10 }}>
          <Skeleton height={120} radius={14} />
          <Skeleton height={220} radius={14} />
        </View>
      ) : !canView ? (
        <AdminAccessDenied message="Eczane yönetim merkezi için pharmacy.view izni gerekir." />
      ) : (
        <>
          <AdminQueryState
            loading={overview.isLoading}
            error={overview.isError ? overview.error.message : null}
            onRetry={() => void overview.refetch()}
          >
            {overview.data ? (
              <>
                <StatGrid>
                  <StatCard
                    label="Toplam eczane"
                    value={String(inventory?.total ?? 0)}
                    icon="medkit-outline"
                    hint={`${inventory?.with_coordinates ?? 0} kayıtta koordinat var`}
                  />
                  <StatCard
                    label="Bugün nöbetçi"
                    value={String(duty?.today_pharmacies ?? 0)}
                    icon="moon-outline"
                    tone={(duty?.today_pharmacies ?? 0) > 0 ? 'success' : 'warning'}
                    hint={
                      duty?.no_data
                        ? 'Kaynak verisi yok'
                        : `${duty?.confirmed_today ?? 0} doğrulanmış · ${duty?.unverified_today ?? 0} doğrulanmamış`
                    }
                  />
                  <StatCard
                    label="Eksik veri"
                    value={String(
                      (inventory?.missing_address ?? 0) +
                        (inventory?.missing_phone ?? 0) +
                        (inventory?.missing_neighborhood ?? 0) +
                        (inventory?.missing_hours ?? 0),
                    )}
                    icon="alert-circle-outline"
                    tone={
                      (inventory?.missing_address ?? 0) +
                        (inventory?.missing_phone ?? 0) +
                        (inventory?.missing_neighborhood ?? 0) +
                        (inventory?.missing_hours ?? 0) >
                      0
                        ? 'warning'
                        : 'success'
                    }
                    hint="Adres, telefon, mahalle veya çalışma saati"
                  />
                  <StatCard
                    label="Doğrulanan kayıt"
                    value={String(inventory?.verified ?? 0)}
                    icon="shield-checkmark-outline"
                    tone="success"
                    hint={`${inventory?.tracked ?? 0} eczane nöbet takibinde`}
                  />
                  <StatCard
                    label="Bekleyen kuyruk"
                    value={String(
                      (queue?.unmatched ?? 0) + (queue?.reviews_flagged ?? 0) + (queue?.claims ?? 0),
                    )}
                    icon="layers-outline"
                    tone={
                      (queue?.unmatched ?? 0) + (queue?.reviews_flagged ?? 0) + (queue?.claims ?? 0) > 0
                        ? 'warning'
                        : 'success'
                    }
                    hint={`${queue?.unmatched ?? 0} eşleşmeyen · ${queue?.reviews_flagged ?? 0} şikâyet`}
                  />
                  <StatCard
                    label="Bildirim abonesi"
                    value={String(overview.data.notifications.subscribers)}
                    icon="notifications-outline"
                    hint={`Bugün ${overview.data.notifications.sent_today} gönderim`}
                  />
                </StatGrid>

                <AdminSection
                  title="Veri tazeliği"
                  subtitle="Eski liste bugünün kesin listesi olarak gösterilmez"
                >
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Pill
                      icon={duty?.no_data ? 'alert-circle-outline' : 'time-outline'}
                      label={`Bugünkü kayıt: ${formatDateTime(duty?.last_fetch ?? null)}`}
                      tone={duty?.no_data ? 'warning' : 'success'}
                    />
                    <Pill
                      icon="git-compare-outline"
                      label={`${duty?.conflicts ?? 0} kaynak çelişkisi`}
                      tone={(duty?.conflicts ?? 0) > 0 ? 'danger' : 'neutral'}
                    />
                    <Pill
                      icon="git-network-outline"
                      label={`${overview.data.sources.enabled}/${overview.data.sources.total} kaynak etkin`}
                      tone={overview.data.sources.enabled > 0 ? 'success' : 'warning'}
                    />
                    <Pill
                      icon="close-circle-outline"
                      label={
                        overview.data.sources.last_failed > 0
                          ? `${overview.data.sources.last_failed} hatalı çalışma`
                          : `Son çalışma: ${formatDateTime(overview.data.sources.last_run)}`
                      }
                      tone={overview.data.sources.last_failed > 0 ? 'danger' : 'neutral'}
                    />
                    <Pill
                      icon="hourglass-outline"
                      label={`Tazelik eşiği: ${overview.data.settings.stale_after_hours} saat`}
                    />
                    <Pill
                      icon="shield-checkmark-outline"
                      label={
                        overview.data.settings.require_verified_duty
                          ? 'Yalnızca doğrulanmış nöbet gösterilir'
                          : 'Doğrulanmamış nöbet de gösterilir'
                      }
                      tone={overview.data.settings.require_verified_duty ? 'success' : 'warning'}
                    />
                  </View>
                  {quality.data ? (
                    <View style={{ gap: 6 }}>
                      <AppText variant="caption" color="textTertiary">
                        Kalite kontrolü
                      </AppText>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        <Pill
                          icon="copy-outline"
                          label={`${quality.data.duplicates.length} olası mükerrer`}
                          tone={quality.data.duplicates.length > 0 ? 'warning' : 'success'}
                        />
                        <Pill
                          icon="link-outline"
                          label={`${quality.data.unmatched_pending} eşleşmeyen kayıt`}
                          tone={quality.data.unmatched_pending > 0 ? 'warning' : 'success'}
                        />
                        <Pill
                          icon="calendar-outline"
                          label={`${quality.data.stale_duty_days.length} eski nöbet günü`}
                          tone={quality.data.stale_duty_days.length > 0 ? 'warning' : 'success'}
                        />
                        <Pill
                          icon="location-outline"
                          label={`${quality.data.missing.address} eksik adres`}
                          tone={quality.data.missing.address > 0 ? 'warning' : 'success'}
                        />
                      </View>
                      {quality.data.duplicates.slice(0, 3).map((group) => (
                        <AppText
                          key={`${group.district}-${group.core_name}`}
                          variant="caption"
                          color="textSecondary"
                        >
                          Mükerrer adayı: {group.core_name} · {group.count} kayıt
                          {group.district ? ` · ${group.district}` : ''}
                        </AppText>
                      ))}
                      {quality.data.duplicates.length > 3 ? (
                        <AppText variant="caption" color="textTertiary">
                          Envanter sekmesinden mahalle/adres karşılaştırarak birleştirin; ad benzerliği
                          tek başına birleştirme gerekçesi değildir.
                        </AppText>
                      ) : null}
                    </View>
                  ) : null}
                </AdminSection>
              </>
            ) : null}
          </AdminQueryState>

          <FilterChips
            options={TABS.map((item) => ({ key: item.key, label: item.label }))}
            value={tab}
            onChange={(next) => setTab(next as TabKey)}
          />

          {tab === 'inventory' ? (
            <PharmacyInventoryTab canManage={canManage} districts={districts} />
          ) : null}
          {tab === 'duty' ? <PharmacyDutyTab canManage={canManage} /> : null}
          {tab === 'sources' ? <PharmacySourcesTab canManage={canManage} /> : null}
          {tab === 'reviews' ? <PharmacyReviewsTab canModerate={canModerate} /> : null}
          {tab === 'notifications' ? <PharmacyNotificationsTab canNotify={canNotify} /> : null}

          {!canManage && tab !== 'inventory' && tab !== 'reviews' ? (
            <Badge label="Salt okunur: pharmacy.manage izni yok" tone="warning" />
          ) : null}
        </>
      )}
    </AdminPage>
  );
}
