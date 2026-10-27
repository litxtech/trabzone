import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { useChildSafetyQueue, useStaffInfo } from '@/features/safety/hooks/use-safety';
import { useTheme } from '@/theme/ThemeProvider';

type Tile = {
  key: string;
  title: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  href: string;
  permission?: string;
  count?: number;
  tone?: 'default' | 'danger';
};

export default function AdminHomeScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: staff, isLoading } = useStaffInfo();
  const { data: childQueue } = useChildSafetyQueue();

  const permissions = staff?.permissions ?? [];
  const has = (permission: string) => permissions.includes(permission);

  const tiles: Tile[] = [
    {
      key: 'support',
      title: 'Destek talepleri',
      description: 'SLA takibi, atama ve yanıtlama',
      icon: 'headset-outline',
      href: '/admin/support',
      permission: 'support.view',
    },
    {
      key: 'reports',
      title: 'Bildirim moderasyonu',
      description: '24 saat inceleme hedefi ve işlem geçmişi',
      icon: 'flag-outline',
      href: '/admin/reports',
      permission: 'safety.report.view',
    },
    {
      key: 'child',
      title: 'Çocuk güvenliği kuyruğu',
      description: 'Kritik bildirimler ve olay kayıtları',
      icon: 'shield-half-outline',
      href: '/admin/child-safety',
      permission: 'safety.child.view',
      count: childQueue?.critical_count ?? 0,
      tone: 'danger',
    },
    {
      key: 'age',
      title: 'Yaş ve veli onayı',
      description: 'Yaş doğrulama, veli onayları ve kapsam',
      icon: 'people-outline',
      href: '/admin/age',
      permission: 'safety.age.view',
    },
    {
      key: 'audit',
      title: 'Denetim kaydı',
      description: 'Değiştirilemez işlem geçmişi',
      icon: 'document-text-outline',
      href: '/admin/audit',
      permission: 'audit.view',
    },
  ];

  const visibleTiles = tiles.filter((tile) => !tile.permission || has(tile.permission));

  if (!isLoading && !staff?.is_staff) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <SafetyHeader title="Yönetim paneli" subtitle="Yetki kontrolü" />
        <Card style={styles.denied}>
          <View style={[styles.deniedIcon, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="lock-closed-outline" size={26} color={theme.colors.danger} />
          </View>
          <AppText variant="h3" align="center">
            Bu alana erişimin yok
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Yönetim paneli yalnızca destek ve güvenlik ekibine açıktır. Erişim gerekiyorsa yöneticiden
            yetki talep et.
          </AppText>
          <Button label="Geri dön" variant="secondary" onPress={() => router.replace('/feed')} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Yönetim paneli"
        subtitle="Destek, bildirim ve çocuk güvenliği operasyonları"
        onBack={() => router.replace('/feed')}
        right={<Badge label={`${permissions.length} yetki`} tone="neutral" />}
      />

      {(childQueue?.critical_count ?? 0) > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kritik çocuk güvenliği bildirimlerini aç"
          onPress={() => router.push('/admin/child-safety')}
          style={({ pressed }) => [
            styles.alertBanner,
            {
              backgroundColor: theme.colors.danger,
              borderRadius: theme.radius.lg,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="alert-circle" size={22} color="#FFFFFF" />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" color="#FFFFFF">
              {childQueue?.critical_count} kritik çocuk güvenliği bildirimi
            </AppText>
            <AppText variant="caption" color="rgba(255,255,255,0.85)">
              30 dakika inceleme hedefi · şimdi ilgilen
            </AppText>
          </View>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <View style={styles.tiles}>
        {visibleTiles.map((tile) => (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={tile.title}
            onPress={() => router.push(tile.href as never)}
            style={({ pressed }) => [
              styles.tile,
              {
                backgroundColor: tile.tone === 'danger' ? theme.colors.dangerSoft : theme.colors.surface,
                borderColor: tile.tone === 'danger' ? theme.colors.danger : theme.colors.border,
                borderRadius: theme.radius.lg,
                opacity: pressed ? 0.8 : 1,
              },
              theme.shadows.card,
            ]}
          >
            <View style={styles.tileHead}>
              <View
                style={[
                  styles.tileIcon,
                  {
                    backgroundColor:
                      tile.tone === 'danger' ? theme.colors.surface : theme.colors.primarySoft,
                  },
                ]}
              >
                <Ionicons
                  name={tile.icon}
                  size={20}
                  color={tile.tone === 'danger' ? theme.colors.danger : theme.colors.primaryDeep}
                />
              </View>
              {tile.count && tile.count > 0 ? (
                <View style={[styles.count, { backgroundColor: theme.colors.danger }]}>
                  <AppText variant="caption" color="#FFFFFF">
                    {tile.count > 99 ? '99+' : tile.count}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="bodyStrong" color={tile.tone === 'danger' ? 'danger' : 'text'}>
              {tile.title}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {tile.description}
            </AppText>
          </Pressable>
        ))}
      </View>

      <View style={styles.section}>
        <AppText variant="h3">Yetkilerin</AppText>
        <Card tone="muted" elevated={false} style={styles.permissionCard}>
          {permissions.length === 0 ? (
            <AppText variant="caption" color="textSecondary">
              Yetki listelenemedi.
            </AppText>
          ) : (
            <View style={styles.permissionWrap}>
              {permissions.map((permission) => (
                <View
                  key={permission}
                  style={[
                    styles.permissionChip,
                    { backgroundColor: theme.colors.surface, borderRadius: theme.radius.pill },
                  ]}
                >
                  <AppText variant="caption" color="textSecondary">
                    {permission}
                  </AppText>
                </View>
              ))}
            </View>
          )}
        </Card>
        <AppText variant="caption" color="textTertiary">
          Tüm moderasyon işlemleri denetim kaydına yazılır ve geri alınamaz şekilde saklanır.
          Çocuk güvenliği bildirimlerini yalnızca `safety.child.view` yetkisi olan ekip görebilir.
        </AppText>
      </View>

      <Button
        label="Destek merkezine git"
        variant="secondary"
        onPress={() => router.push('/support')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  denied: { alignItems: 'center', gap: 10, marginTop: 20 },
  deniedIcon: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    marginBottom: 14,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, padding: 14, gap: 4, borderWidth: StyleSheet.hairlineWidth },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  tileIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  section: { gap: 9, marginTop: 20 },
  permissionCard: { padding: 12 },
  permissionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  permissionChip: { paddingHorizontal: 9, paddingVertical: 4 },
});
