import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { useAuditLogs } from '@/features/safety/hooks/use-safety';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr } from '@/utils/date';

const ENTITY_FILTERS = [
  { key: null, label: 'Tümü' },
  { key: 'user_report', label: 'Bildirimler' },
  { key: 'support_ticket', label: 'Talepler' },
  { key: 'child_safety_case', label: 'Çocuk güvenliği' },
  { key: 'guardian_consent', label: 'Veli onayı' },
  { key: 'age_assurance', label: 'Yaş doğrulama' },
] as const;

export default function AdminAuditScreen() {
  const { theme } = useTheme();
  const [entity, setEntity] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useAuditLogs(entity);

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Denetim kaydı"
        subtitle={`${data?.length ?? 0} son işlem`}
        onBack={undefined}
      />

      <View style={styles.filters}>
        {ENTITY_FILTERS.map((item) => {
          const active = entity === item.key;
          return (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setEntity(item.key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <Card tone="muted" elevated={false} style={styles.info}>
        <Ionicons name="lock-closed-outline" size={14} color={theme.colors.textSecondary} />
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          Denetim kayıtları değiştirilemez. Her satır aktör, işlem kodu, hedef ve zaman bilgisini
          içerir; çocuk güvenliği işlemleri ayrıca olay kaydına bağlanır.
        </AppText>
      </Card>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : isError ? (
        <SafetyEmptyState
          icon="cloud-offline-outline"
          title="Kayıtlar yüklenemedi"
          body="`audit.view` yetkisi gerekiyor olabilir."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      ) : (data ?? []).length === 0 ? (
        <SafetyEmptyState
          icon="document-text-outline"
          title="Kayıt bulunamadı"
          body="Seçili filtrede denetim kaydı yok."
        />
      ) : (
        <View style={styles.list}>
          {(data ?? []).map((log) => (
            <View
              key={log.id}
              style={[
                styles.row,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <View style={styles.rowHead}>
                <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                  {log.action_code}
                </AppText>
                <Badge label={log.entity_type ?? 'sistem'} tone="neutral" />
              </View>
              <View style={styles.rowFoot}>
                <AppText variant="caption" color="textTertiary">
                  {log.actor_name ?? 'sistem'}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {formatRelativeTr(log.created_at)}
                </AppText>
              </View>
              <AppText variant="caption" color="textTertiary">
                {formatDateTimeTr(log.created_at)}
                {log.entity_id ? ` · ${log.entity_id.slice(0, 8)}` : ''}
              </AppText>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  info: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', padding: 11, marginTop: 12 },
  list: { gap: 8, marginTop: 14 },
  row: { padding: 12, gap: 5, borderWidth: 1 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  center: { alignItems: 'center', paddingVertical: 40 },
});
