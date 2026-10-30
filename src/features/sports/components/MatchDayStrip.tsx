import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { Fixture } from '../types';
import { liveClock, matchDayKey, matchDayParts, opponentName, resultFor, scoreText } from '../utils/format';
import { LiveDot } from './MatchCenterFeedCard';

const RESULT_COLORS = { W: '#1E9E5A', D: '#8A8F98', L: '#D23A4B' } as const;

export type MatchDay = { key: string; fixtures: Fixture[] };

/** Maçları İstanbul saatine göre günlere ayırır; liste sırası korunur. */
export function groupByMatchDay(fixtures: Fixture[]): MatchDay[] {
  const days: MatchDay[] = [];
  for (const fixture of fixtures) {
    const key = matchDayKey(fixture.kickoff_at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.fixtures.push(fixture);
    else days.push({ key, fixtures: [fixture] });
  }
  return days;
}

/**
 * Filtre düğmelerinin altındaki yatay maç günü şeridi. Bir güne dokunmak
 * listeyi o güne süzer; seçili güne tekrar dokunmak süzmeyi kaldırır.
 */
export function MatchDayStrip({
  days,
  selected,
  onSelect,
}: {
  days: MatchDay[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const { theme } = useTheme();
  if (days.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {days.map((day) => {
        const fixture = day.fixtures[0];
        if (!fixture) return null;
        const active = selected === day.key;
        const parts = matchDayParts(fixture.kickoff_at);
        const result = fixture.status.is_finished ? resultFor(fixture) : null;
        const home = fixture.primary_side === 'home';
        const fg = active ? theme.colors.onPrimary : theme.colors.text;
        const muted = active ? theme.colors.onPrimary : theme.colors.textSecondary;

        return (
          <Pressable
            key={day.key}
            onPress={() => onSelect(active ? null : day.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${parts.weekday} ${parts.day} ${parts.month}, ${opponentName(fixture)} ${home ? 'iç saha' : 'deplasman'}`}
            style={({ pressed }) => [
              styles.day,
              {
                backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                borderColor: active ? theme.colors.primary : theme.colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <AppText variant="caption" style={{ color: muted }}>
              {parts.weekday}
            </AppText>
            <AppText variant="h3" style={[styles.dayNumber, { color: fg }]}>
              {parts.day}
            </AppText>
            <AppText variant="caption" style={{ color: muted }}>
              {parts.month}
            </AppText>

            <View style={[styles.divider, { backgroundColor: active ? 'rgba(255,255,255,0.35)' : theme.colors.divider }]} />

            <AppText variant="caption" numberOfLines={1} style={[styles.opponent, { color: fg }]}>
              {opponentName(fixture)}
            </AppText>
            <View style={styles.statusRow}>
              {fixture.status.is_live ? (
                <>
                  <LiveDot />
                  <AppText variant="caption" style={[styles.live, active ? { color: theme.colors.onPrimary } : null]}>
                    {liveClock(fixture)}
                  </AppText>
                </>
              ) : result ? (
                <>
                  <View style={[styles.result, { backgroundColor: RESULT_COLORS[result] }]}>
                    <AppText variant="caption" style={styles.resultText}>
                      {result === 'W' ? 'G' : result === 'D' ? 'B' : 'M'}
                    </AppText>
                  </View>
                  <AppText variant="caption" style={[styles.score, { color: fg }]}>
                    {scoreText(fixture.goals.home)}-{scoreText(fixture.goals.away)}
                  </AppText>
                </>
              ) : (
                <AppText variant="caption" style={{ color: muted }}>
                  {parts.time} · {home ? 'İç' : 'Dış'}
                </AppText>
              )}
            </View>
            {day.fixtures.length > 1 ? (
              <AppText variant="caption" style={{ color: muted }}>
                +{day.fixtures.length - 1} maç
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingVertical: 2 },
  day: {
    width: 92,
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 1,
  },
  dayNumber: { fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 6 },
  opponent: { fontWeight: '700', maxWidth: '100%' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  live: { color: '#D23A4B', fontWeight: '700' },
  result: { borderRadius: 5, minWidth: 16, alignItems: 'center', paddingHorizontal: 3 },
  resultText: { color: '#FFFFFF', fontWeight: '800' },
  score: { fontWeight: '800', fontVariant: ['tabular-nums'] },
});
