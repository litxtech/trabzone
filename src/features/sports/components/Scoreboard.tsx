import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';

import type { Fixture, MatchEvent } from '../types';
import { useCountdown } from '../hooks/use-countdown';
import { eventLabel, kickoffLabel, liveClock, minuteLabel, phaseLabel, scoreText } from '../utils/format';
import { LiveDot } from './MatchCenterFeedCard';
import { TeamBadge } from './TeamBadge';

const WHITE = '#FFFFFF';
const MUTED = 'rgba(255,255,255,0.72)';

function TeamColumn({ fixture, side, compact }: { fixture: Fixture; side: 'home' | 'away'; compact: boolean }) {
  const team = fixture[side];
  return (
    <View style={styles.team}>
      <TeamBadge name={team.name} logo={team.logo} size={compact ? 34 : 52} primary={fixture.primary_side === side} />
      <AppText variant="label" numberOfLines={2} align="center" style={{ color: WHITE }}>
        {team.name ?? (side === 'home' ? 'Ev sahibi' : 'Deplasman')}
      </AppText>
    </View>
  );
}

/**
 * Arena skor alanı. Dakika yalnızca sağlayıcının bildirdiği değerdir; istemci
 * tarafında sahte saat ilerletilmez.
 */
export const Scoreboard = memo(function Scoreboard({
  fixture,
  lastEvent,
  compact = false,
}: {
  fixture: Fixture;
  lastEvent?: MatchEvent | null;
  compact?: boolean;
}) {
  const { status } = fixture;
  const scheduled = status.phase === 'scheduled';
  const countdown = useCountdown(fixture.kickoff_at, scheduled);
  const ht = fixture.score.halftime;
  const pen = fixture.score.penalty;

  return (
    <LinearGradient
      colors={['#4A0F24', '#7A1F3D', '#1B4E7A']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.root, compact ? styles.rootCompact : null]}
    >
      {!compact ? (
        <View style={styles.leagueRow}>
          <AppText variant="caption" numberOfLines={1} style={{ color: MUTED, flex: 1 }}>
            {[fixture.league.name, fixture.league.round].filter(Boolean).join(' · ')}
          </AppText>
          {fixture.is_test ? (
            <View style={styles.testPill}>
              <AppText variant="caption" style={styles.testText}>
                TEST
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.row}>
        <TeamColumn fixture={fixture} side="home" compact={compact} />
        <View style={styles.center}>
          {scheduled ? (
            <>
              <AppText
                variant={compact ? 'h3' : 'h2'}
                style={[styles.countdown, { color: WHITE }]}
                accessibilityLabel={`Maçın başlamasına ${countdown ?? 'az'} kaldı`}
              >
                {countdown ?? '—'}
              </AppText>
              <AppText variant="caption" style={{ color: MUTED }}>
                başlamaya kaldı · {kickoffLabel(fixture.kickoff_at)}
              </AppText>
            </>
          ) : (
            <>
              <AppText
                accessibilityLabel={`Skor ${scoreText(fixture.goals.home)} - ${scoreText(fixture.goals.away)}`}
                style={[styles.score, compact ? styles.scoreCompact : null]}
              >
                {scoreText(fixture.goals.home)} – {scoreText(fixture.goals.away)}
              </AppText>
              <View style={styles.statusRow}>
                {status.is_live ? <LiveDot /> : null}
                <AppText variant="label" style={{ color: status.is_live ? '#FFB3BD' : MUTED }}>
                  {status.is_live ? liveClock(fixture) : phaseLabel(status.phase)}
                </AppText>
              </View>
              {!compact && ht?.home != null && ht?.away != null && status.phase !== 'first_half' ? (
                <AppText variant="caption" style={{ color: MUTED }}>
                  İY {ht.home}–{ht.away}
                  {pen?.home != null && pen?.away != null ? ` · Pen. ${pen.home}–${pen.away}` : ''}
                </AppText>
              ) : null}
              {status.is_finished && !fixture.final_verified ? (
                <AppText variant="caption" style={{ color: MUTED }}>
                  Sonuç doğrulanıyor
                </AppText>
              ) : null}
            </>
          )}
        </View>
        <TeamColumn fixture={fixture} side="away" compact={compact} />
      </View>

      {!compact && lastEvent ? (
        <View style={styles.lastEvent}>
          <AppText variant="caption" numberOfLines={1} style={{ color: WHITE }}>
            {minuteLabel(lastEvent.minute, lastEvent.extra)} {eventLabel(lastEvent)}
            {lastEvent.player_name ? ` · ${lastEvent.player_name}` : ''}
          </AppText>
        </View>
      ) : null}
    </LinearGradient>
  );
});

const styles = StyleSheet.create({
  root: { borderRadius: 20, padding: 16, gap: 12, marginHorizontal: 12 },
  rootCompact: { paddingVertical: 10, gap: 6 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  team: { flex: 1, alignItems: 'center', gap: 6 },
  center: { minWidth: 110, alignItems: 'center', gap: 3 },
  countdown: { fontVariant: ['tabular-nums'] },
  score: { color: WHITE, fontSize: 36, lineHeight: 42, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreCompact: { fontSize: 26, lineHeight: 30 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  testPill: { backgroundColor: '#F5B700', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  testText: { color: '#1A1A1A', fontWeight: '800' },
  lastEvent: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    maxWidth: '100%',
  },
});
