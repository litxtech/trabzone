import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Skeleton } from '@/components/ui';
import { AdminPage, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { AnalyticsTab, AuditTab } from '@/features/earthquake/admin/AnalyticsTab';
import { useAdminEarthquakeOverview } from '@/features/earthquake/admin/api';
import { EventsTab } from '@/features/earthquake/admin/EventsTab';
import { NotificationsTab } from '@/features/earthquake/admin/NotificationsTab';
import { OverviewTab } from '@/features/earthquake/admin/OverviewTab';
import { SettingsTab } from '@/features/earthquake/admin/SettingsTab';
import { SourcesTab } from '@/features/earthquake/admin/SourcesTab';
import { AdminAccessDenied, AdminQueryState } from '@/features/explore/admin/AdminExploreShared';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

type TabKey = 'overview' | 'sources' | 'settings' | 'notifications' | 'events' | 'analytics' | 'audit';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Genel durum' },
  { key: 'sources', label: 'Kaynaklar' },
  { key: 'settings', label: 'Bölge ve kurallar' },
  { key: 'notifications', label: 'Bildirimler' },
  { key: 'events', label: 'Olay inceleme' },
  { key: 'analytics', label: 'Analitik' },
  { key: 'audit', label: 'Denetim kaydı' },
];

export default function AdminEarthquakeScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const canView = permissions.includes('earthquake.view');
  const canManage = permissions.includes('earthquake.manage');
  const canNotify = permissions.includes('earthquake.notify');
  const canReview = permissions.includes('earthquake.review');
  const [tab, setTab] = useState<TabKey>('overview');
  const overview = useAdminEarthquakeOverview(canView);

  return (
    <AdminPage
      title="Deprem Yönetim Merkezi"
      subtitle="AFAD/USGS veri kaynakları, senkron sağlığı, bölge ayarları, bildirim kuralları ve olay incelemesi. Kaynak ölçüm değerleri elle değiştirilemez."
      refreshing={overview.isRefetching}
      onRefresh={() => void overview.refetch()}
      actions={
        <Button
          label="Deprem Merkezi’ni aç"
          size="sm"
          variant="outline"
          fullWidth={false}
          leftIcon={<Ionicons name="pulse-outline" size={14} color={theme.colors.text} />}
          onPress={() => router.push('/deprem' as never)}
        />
      }
    >
      {me.isLoading ? (
        <View style={{ gap: 10 }}>
          <Skeleton height={120} radius={14} />
          <Skeleton height={220} radius={14} />
        </View>
      ) : !canView ? (
        <AdminAccessDenied message="Deprem yönetim merkezi için earthquake.view izni gerekir." />
      ) : (
        <View style={{ gap: 14 }}>
          <FilterChips options={TABS} value={tab} onChange={setTab} />
          {tab === 'overview' || tab === 'settings' ? (
            <AdminQueryState
              loading={overview.isLoading}
              error={overview.isError ? overview.error.message : null}
              onRetry={() => void overview.refetch()}
            >
              {overview.data ? (
                tab === 'overview' ? (
                  <OverviewTab data={overview.data} canManage={canManage} canNotify={canNotify} onRefresh={() => void overview.refetch()} />
                ) : (
                  <SettingsTab settings={overview.data.settings} canManage={canManage} canNotify={canNotify} />
                )
              ) : null}
            </AdminQueryState>
          ) : null}
          {tab === 'sources' ? <SourcesTab canManage={canManage} /> : null}
          {tab === 'notifications' ? <NotificationsTab canNotify={canNotify} /> : null}
          {tab === 'events' ? <EventsTab canReview={canReview} /> : null}
          {tab === 'analytics' ? <AnalyticsTab /> : null}
          {tab === 'audit' ? <AuditTab /> : null}
        </View>
      )}
    </AdminPage>
  );
}
