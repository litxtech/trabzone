import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { Fixture } from '../types';
import { kickoffLabel, liveClock, phaseLabel, resultFor, scoreText } from '../utils/format';
import { LiveDot } from './MatchCenterFeedCard';

const RESULT_COLORS = { W: '#1E9E5A', D: '#8A8F98', L: '#D23A4B' } as const;

export const FixtureRow = memo(function FixtureRow({ fixture, onPress }: { fixture: Fixture; onPress: () => void }) {
  const { theme } = useTheme();
  const { status } = fixture;
  const scheduled = status.phase === 'scheduled';
  const result = status.is_finished ? resultFor(fixture) : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.root,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.meta}>
        <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
          {[fixture.league.name, fixture.league.round].filter(Boolean).join(' · ')}
        </AppText>
        {fixture.is_test ? (
          <AppText variant="caption" style={styles.test}>
            TEST
          </AppText>
        ) : null}
      </View>
      <View style={styles.row}>
        <View style={styles.teams}>
          <AppText variant="label" numberOfLines={1} style={fixture.primary_side === 'home' ? styles.primary : null}>
            {fixture.home.name ?? 'Ev sahibi'}
          </AppText>
          <AppText variant="label" numberOfLines={1} style={fixture.primary_side === 'away' ? styles.primary : null}>
            {fixture.away.name ?? 'Deplasman'}
          </AppText>
        </View>
        {scheduled ? null : (
          <View style={styles.scores}>
            <AppText variant="label" style={styles.score}>
              {scoreText(fixture.goals.home)}
            </AppText>
            <AppText variant="label" style={styles.score}>
              {scoreText(fixture.goals.away)}
            </AppText>
          </View>
        )}
        <View style={styles.status}>
          {status.is_live ? (
            <View style={styles.liveRow}>
              <LiveDot />
              <AppText variant="caption" style={{ color: '#D23A4B', fontWeight: '700' }}>
                {liveClock(fixture)}
              </AppText>
            </View>
          ) : scheduled ? (
            <AppText variant="caption" color="textSecondary" align="right">
              {kickoffLabel(fixture.kickoff_at)}
            </AppText>
          ) : (
            <>
              <AppText variant="caption" color="textSecondary" align="right">
                {phaseLabel(status.phase)}
              </AppText>
              {result ? (
                <View style={[styles.result, { backgroundColor: RESULT_COLORS[result] }]}>
                  <AppText variant="caption" style={styles.resultText}>
                    {result === 'W' ? 'G' : result === 'D' ? 'B' : 'M'}
                  </AppText>
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  test: { color: '#B07F00', fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teams: { flex: 1, gap: 4 },
  primary: { fontWeight: '800' },
  scores: { gap: 4, alignItems: 'flex-end' },
  score: { fontVariant: ['tabular-nums'], fontWeight: '800' },
  status: { width: 96, alignItems: 'flex-end', gap: 4 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  result: { borderRadius: 6, minWidth: 20, alignItems: 'center', paddingHorizontal: 4 },
  resultText: { color: '#FFFFFF', fontWeight: '800' },
});
