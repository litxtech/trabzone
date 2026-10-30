import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useFixtureStats } from '../hooks/use-sports';
import type { Fixture } from '../types';
import { formatStat, NO_DATA, otherSide, relativeAge, STAT_ROWS, statValue } from '../utils/format';
import { EmptyState, PanelError, PanelLoading, SectionCard } from './ui';

/** İstatistikler: Trabzonspor her zaman solda; null değer asla 0 gösterilmez. */
export function StatsPanel({ fixture }: { fixture: Fixture }) {
  const { theme } = useTheme();
  const query = useFixtureStats(fixture.id, fixture.status.is_live);

  if (query.isLoading) return <PanelLoading />;
  if (query.isError) return <PanelError onRetry={() => void query.refetch()} />;

  const data = query.data;
  const left = fixture.primary_side;
  const right = otherSide(left);
  const leftStats = data?.[left] ?? null;
  const rightStats = data?.[right] ?? null;

  if (!leftStats && !rightStats) {
    return (
      <EmptyState
        icon="stats-chart-outline"
        title="İstatistik henüz yok"
        body={
          fixture.status.phase === 'scheduled'
            ? 'İstatistikler maç başladıktan sonra veri sağlayıcıdan gelir.'
            : 'Veri sağlayıcı bu maç için istatistik yayınlamadı.'
        }
      />
    );
  }

  const rows = STAT_ROWS.filter(
    (row) => statValue(leftStats, row.key) !== undefined || statValue(rightStats, row.key) !== undefined,
  );

  return (
    <SectionCard>
      <View style={styles.header}>
        <AppText variant="label" numberOfLines={1} style={styles.flex}>
          {fixture[left].name}
        </AppText>
        <AppText variant="label" numberOfLines={1} align="right" style={styles.flex}>
          {fixture[right].name}
        </AppText>
      </View>
      {rows.map((row) => {
        const a = statValue(leftStats, row.key);
        const b = statValue(rightStats, row.key);
        const missing = a == null || b == null;
        const total = (a ?? 0) + (b ?? 0);
        const share = !missing && total > 0 ? (a as number) / total : 0.5;
        return (
          <View key={row.key} style={styles.row}>
            <View style={styles.values}>
              <AppText variant="bodyStrong" style={styles.value}>
                {formatStat(a, row)}
              </AppText>
              <AppText variant="caption" color="textSecondary" align="center" style={styles.flex}>
                {row.label}
              </AppText>
              <AppText variant="bodyStrong" align="right" style={styles.value}>
                {formatStat(b, row)}
              </AppText>
            </View>
            {missing ? (
              <AppText variant="caption" color="textTertiary" align="center">
                {NO_DATA}
              </AppText>
            ) : (
              <View style={[styles.bar, { backgroundColor: theme.colors.surfaceMuted }]}>
                <View style={[styles.barLeft, { flex: share, backgroundColor: '#7A1F3D' }]} />
                <View style={styles.gap} />
                <View style={[styles.barRight, { flex: 1 - share, backgroundColor: '#4FA3E0' }]} />
              </View>
            )}
          </View>
        );
      })}
      <AppText variant="caption" color="textTertiary" align="center" style={styles.footer}>
        Son güncelleme: {relativeAge(data?.updated_at ?? null)} · Veri: API-Football
      </AppText>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', marginBottom: 6 },
  row: { gap: 6, paddingVertical: 7 },
  values: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { minWidth: 52 },
  bar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden' },
  barLeft: { borderTopLeftRadius: 3, borderBottomLeftRadius: 3 },
  barRight: { borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  gap: { width: 3 },
  footer: { marginTop: 10 },
});
