import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { AdminPage } from '@/features/admin/components/AdminPage';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { DemoDataPanel } from '@/features/demo/components/DemoDataPanel';
import { useTheme } from '@/theme/ThemeProvider';

export default function AdminDemoScreen() {
  const { theme } = useTheme();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const canView = permissions.includes('demo.view');
  const canManage = permissions.includes('demo.manage');

  return (
    <AdminPage
      title="Örnek veri yönetimi"
      subtitle="Emlak, marketplace ve yolculuk modülleri için gerçekçi Trabzon örnekleri. İstediğin an yükle, yenile veya kaldır; örnek kullanıcılar uygulamadan tek tek ya da toplu silinebilir."
      actions={
        <Badge
          label={me.isLoading ? 'Yetki kontrolü…' : canManage ? 'Yükleme yetkisi var' : 'Salt okunur'}
          tone={canManage ? 'success' : 'neutral'}
        />
      }
    >
      {me.isLoading ? (
        <View style={styles.stack}>
          <Skeleton height={104} radius={16} />
          <Skeleton height={240} radius={18} />
        </View>
      ) : !canView ? (
        <View
          style={[
            styles.denied,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="lock-closed-outline" size={22} color={theme.colors.warning} />
          <AppText variant="bodyStrong">Yetki gerekli</AppText>
          <AppText variant="caption" color="textSecondary" style={styles.center}>
            Örnek veri yönetimi için demo.view izni gerekir. Sistem yöneticisinden yetki talep et.
          </AppText>
          <Button
            label="Yenile"
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => void me.refetch()}
          />
        </View>
      ) : (
        <DemoDataPanel canManage={canManage} />
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  denied: {
    alignItems: 'center',
    gap: 8,
    padding: 26,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  center: { textAlign: 'center', maxWidth: 420 },
});
