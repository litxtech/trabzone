import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { AdminPage } from '@/features/admin/components/AdminPage';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { AdminAccessDenied } from '@/features/explore/admin/AdminExploreShared';
import { CategoriesPanel } from '@/features/explore/admin/CategoriesPanel';
import { ExploreOverviewPanel } from '@/features/explore/admin/ExploreOverviewPanel';
import {
  ClaimsPanel,
  ExploreReportsPanel,
  PlaceMediaPanel,
  PlaceReviewsPanel,
  SuggestionsPanel,
} from '@/features/explore/admin/ModerationPanels';
import { PlacesPanel } from '@/features/explore/admin/PlacesPanel';
import { useTheme } from '@/theme/ThemeProvider';

type TabKey =
  'overview' | 'places' | 'suggestions' | 'claims' | 'media' | 'reviews' | 'reports' | 'categories';

const TABS: {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  permission: string;
}[] = [
  { key: 'overview', label: 'Genel bakış', icon: 'grid-outline', permission: 'map.view' },
  { key: 'places', label: 'İşletmeler', icon: 'storefront-outline', permission: 'map.view' },
  { key: 'suggestions', label: 'Yer önerileri', icon: 'location-outline', permission: 'map.view' },
  { key: 'claims', label: 'Sahiplik', icon: 'shield-checkmark-outline', permission: 'map.view' },
  { key: 'media', label: 'Medya', icon: 'images-outline', permission: 'map.view' },
  { key: 'reviews', label: 'Yorumlar', icon: 'chatbubbles-outline', permission: 'map.view' },
  { key: 'reports', label: 'Şikâyetler', icon: 'flag-outline', permission: 'map.view' },
  { key: 'categories', label: 'Kategoriler', icon: 'pricetags-outline', permission: 'map.manage' },
];

/** Baloncuk rotasındaki `?tab=` değerini güvenli biçimde sekmeye çevirir. */
function tabFromParam(value: string | string[] | undefined): TabKey | null {
  const key = Array.isArray(value) ? value[0] : value;
  return TABS.some((item) => item.key === key) ? (key as TabKey) : null;
}

export default function AdminExploreScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<TabKey>(() => tabFromParam(params.tab) ?? 'overview');

  // Yeni içerik bildirimi baloncuğu doğrudan "Şikâyetler" sekmesini açar. URL
  // parametresi dış kaynak olduğu için sekmeyi efekt içinde eşitliyoruz.
  useEffect(() => {
    const next = tabFromParam(params.tab);
    if (next) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(next);
    }
  }, [params.tab]);

  const can = (permission: string) => permissions.includes(permission);
  const canView = can('map.view');
  const canManage = can('map.manage');
  const canModerate = can('map.moderate');
  const allowed = TABS.filter((item) => can(item.permission));
  const active = allowed.find((item) => item.key === tab) ?? allowed[0] ?? null;

  return (
    <AdminPage
      title="Harita ve işletme yönetimi"
      subtitle="Trabzon işletme kayıtları, kullanıcı önerileri, sahiplenme, medya ve yorum moderasyonu. Kararlar denetim kaydına yazılır."
      actions={
        <>
          <Button
            label="Veri sağlığı"
            size="sm"
            variant="outline"
            fullWidth={false}
            leftIcon={<Ionicons name="pulse-outline" size={14} color={theme.colors.text} />}
            onPress={() => router.push('/admin/explore-health' as never)}
          />
          {can('realestate.view') ? (
            <Button
              label="Emlak yönetimi"
              size="sm"
              variant="secondary"
              fullWidth={false}
              leftIcon={<Ionicons name="home-outline" size={14} color={theme.colors.primaryDeep} />}
              onPress={() => router.push('/admin/real-estate' as never)}
            />
          ) : null}
          <Badge
            label={me.isLoading ? 'Yetki kontrolü…' : `${permissions.length} izin`}
            tone="primary"
          />
        </>
      }
    >
      {me.isLoading ? (
        <View style={styles.stack}>
          <Skeleton height={48} radius={12} />
          <Skeleton height={240} radius={14} />
        </View>
      ) : !canView ? (
        <AdminAccessDenied message="Harita ve işletme yönetimi için map.view izni gerekir. Sistem yöneticisinden yetki talep edin." />
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

          {!canManage && active?.key === 'categories' ? (
            <AdminAccessDenied message="Kategori yönetimi için map.manage izni gerekir." />
          ) : null}

          {active?.key === 'overview' ? <ExploreOverviewPanel /> : null}
          {active?.key === 'places' ? (
            <PlacesPanel canManage={canManage} canModerate={canModerate} />
          ) : null}
          {active?.key === 'suggestions' ? <SuggestionsPanel canModerate={canModerate} /> : null}
          {active?.key === 'claims' ? <ClaimsPanel canModerate={canModerate} /> : null}
          {active?.key === 'media' ? <PlaceMediaPanel canModerate={canModerate} /> : null}
          {active?.key === 'reviews' ? <PlaceReviewsPanel canModerate={canModerate} /> : null}
          {active?.key === 'reports' ? <ExploreReportsPanel canModerate={canModerate} /> : null}
          {active?.key === 'categories' && canManage ? (
            <CategoriesPanel canManage={canManage} />
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
