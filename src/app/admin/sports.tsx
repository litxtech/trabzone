import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Skeleton } from '@/components/ui';
import { AdminPage, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { AdminAccessDenied, AdminQueryState } from '@/features/explore/admin/AdminExploreShared';
import { useSportsAdminOverview, useSportsAdminSettings } from '@/features/sports/admin/api';
import { FixturesTab } from '@/features/sports/admin/FixturesTab';
import { ModerationTab } from '@/features/sports/admin/ModerationTab';
import { LogsTab, NotificationsTab } from '@/features/sports/admin/NotificationsTab';
import { OverviewTab } from '@/features/sports/admin/OverviewTab';
import { SettingsTab } from '@/features/sports/admin/SettingsTab';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

type TabKey = 'overview' | 'settings' | 'fixtures' | 'moderation' | 'notifications' | 'logs';

export default function AdminSportsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const canView = permissions.includes('sports.view');
  const canManage = permissions.includes('sports.manage');
  const canData = permissions.includes('sports.data');
  const canModerate = permissions.includes('sports.moderate');
  const canNotify = permissions.includes('sports.notify');
  const [tab, setTab] = useState<TabKey>('overview');
  const overview = useSportsAdminOverview(canView && tab === 'overview');
  const settings = useSportsAdminSettings(canView && tab === 'settings');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Genel durum ve API' },
    { key: 'settings', label: 'Ayarlar' },
    { key: 'fixtures', label: 'Maçlar ve veri sağlığı' },
    ...(canModerate ? [{ key: 'moderation' as const, label: 'Moderasyon' }] : []),
    { key: 'notifications', label: 'Bildirimler' },
    { key: 'logs', label: 'Kayıtlar' },
  ];

  return (
    <AdminPage
      title="Trabzonspor Maç Merkezi"
      subtitle="API-Football veri senkronu, Feed maç kartı, canlı sohbet moderasyonu, anketler, bildirimler ve TEST simülatörü. Skor ve olay kayıtları elle değiştirilemez."
      refreshing={overview.isRefetching}
      onRefresh={() => void (tab === 'settings' ? settings.refetch() : overview.refetch())}
      actions={
        <Button
          label="Maç merkezini aç"
          size="sm"
          variant="outline"
          fullWidth={false}
          leftIcon={<Ionicons name="football-outline" size={14} color={theme.colors.text} />}
          onPress={() => router.push('/trabzonspor' as never)}
        />
      }
    >
      {me.isLoading ? (
        <View style={{ gap: 10 }}>
          <Skeleton height={120} radius={14} />
          <Skeleton height={220} radius={14} />
        </View>
      ) : !canView ? (
        <AdminAccessDenied message="Trabzonspor maç merkezi için sports.view izni gerekir." />
      ) : (
        <View style={{ gap: 14 }}>
          <FilterChips options={tabs} value={tab} onChange={setTab} />
          {tab === 'overview' ? (
            <AdminQueryState
              loading={overview.isLoading}
              error={overview.isError ? overview.error.message : null}
              onRetry={() => void overview.refetch()}
            >
              {overview.data ? <OverviewTab data={overview.data} canManage={canManage} canNotify={canNotify} /> : null}
            </AdminQueryState>
          ) : null}
          {tab === 'settings' ? (
            <AdminQueryState
              loading={settings.isLoading}
              error={settings.isError ? settings.error.message : null}
              onRetry={() => void settings.refetch()}
            >
              {settings.data ? <SettingsTab settings={settings.data} canManage={canManage} /> : null}
            </AdminQueryState>
          ) : null}
          {tab === 'fixtures' ? <FixturesTab canData={canData} canModerate={canModerate} /> : null}
          {tab === 'moderation' && canModerate ? <ModerationTab /> : null}
          {tab === 'notifications' ? <NotificationsTab canNotify={canNotify} /> : null}
          {tab === 'logs' ? <LogsTab /> : null}
        </View>
      )}
    </AdminPage>
  );
}
