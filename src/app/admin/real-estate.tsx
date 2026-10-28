import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { AdminPage } from '@/features/admin/components/AdminPage';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { AdminAccessDenied } from '@/features/explore/admin/AdminExploreShared';
import { ExploreReportsPanel } from '@/features/explore/admin/ModerationPanels';
import {
  RealEstateListingsPanel,
  RealEstateMediaPanel,
  RealEstateOverviewPanel,
  VerificationPanel,
} from '@/features/explore/admin/RealEstatePanels';
import { useTheme } from '@/theme/ThemeProvider';

type TabKey = 'overview' | 'listings' | 'verifications' | 'media' | 'reports';

const TABS: {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  permission: string;
}[] = [
  { key: 'overview', label: 'Genel bakış', icon: 'grid-outline', permission: 'realestate.view' },
  { key: 'listings', label: 'İlanlar', icon: 'home-outline', permission: 'realestate.view' },
  { key: 'verifications', label: 'EİDS doğrulama', icon: 'shield-checkmark-outline', permission: 'realestate.view' },
  { key: 'media', label: 'Medya', icon: 'images-outline', permission: 'realestate.view' },
  { key: 'reports', label: 'Şikâyetler', icon: 'flag-outline', permission: 'realestate.view' },
];

export default function AdminRealEstateScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const [tab, setTab] = useState<TabKey>('overview');

  const can = (permission: string) => permissions.includes(permission);
  const canView = can('realestate.view');
  const canModerate = can('realestate.moderate');
  const canVerify = can('realestate.verify');
  const canPublish = can('realestate.publish');
  const allowed = TABS.filter((item) => can(item.permission));
  const active = allowed.find((item) => item.key === tab) ?? allowed[0] ?? null;

  return (
    <AdminPage
      title="Emlak yönetimi"
      subtitle="Trabzon emlak ilanları, EİDS doğrulama kuyruğu ve medya moderasyonu. Doğrulanmamış ilan hiçbir koşulda yayınlanmaz."
      actions={
        <>
          {can('map.view') ? (
            <Button
              label="Harita yönetimi"
              size="sm"
              variant="outline"
              fullWidth={false}
              leftIcon={<Ionicons name="map-outline" size={14} color={theme.colors.text} />}
              onPress={() => router.push('/admin/explore' as never)}
            />
          ) : null}
          <Badge label={me.isLoading ? 'Yetki kontrolü…' : `${permissions.length} izin`} tone="primary" />
        </>
      }
    >
      {me.isLoading ? (
        <View style={styles.stack}>
          <Skeleton height={48} radius={12} />
          <Skeleton height={240} radius={14} />
        </View>
      ) : !canView ? (
        <AdminAccessDenied message="Emlak yönetimi için realestate.view izni gerekir. Sistem yöneticisinden yetki talep edin." />
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

          {active?.key === 'overview' ? <RealEstateOverviewPanel /> : null}
          {active?.key === 'listings' ? (
            <RealEstateListingsPanel canModerate={canModerate} canPublish={canPublish} />
          ) : null}
          {active?.key === 'verifications' ? <VerificationPanel canVerify={canVerify} /> : null}
          {active?.key === 'media' ? <RealEstateMediaPanel canModerate={canModerate} /> : null}
          {active?.key === 'reports' ? (
            <ExploreReportsPanel canModerate={canModerate} scope="real_estate" />
          ) : null}
        </>
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
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
});
