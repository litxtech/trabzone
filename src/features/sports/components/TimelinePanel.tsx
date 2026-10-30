import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useFixtureTimeline } from '../hooks/use-sports';
import type { EventKind, Fixture, MatchEvent } from '../types';
import { eventLabel, minuteLabel, phaseLabel, relativeAge } from '../utils/format';
import { EmptyState, PanelError, PanelLoading, SectionCard } from './ui';

const ICONS: Record<EventKind, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  goal: { name: 'football', color: '#16A34A' },
  own_goal: { name: 'football', color: '#E5484D' },
  penalty_goal: { name: 'football', color: '#16A34A' },
  missed_penalty: { name: 'close-circle', color: '#E5484D' },
  shootout_goal: { name: 'football-outline', color: '#16A34A' },
  shootout_miss: { name: 'close-circle-outline', color: '#E5484D' },
  yellow: { name: 'square', color: '#F5C400' },
  red: { name: 'square', color: '#E5484D' },
  second_yellow: { name: 'albums', color: '#E5484D' },
  substitution: { name: 'swap-horizontal', color: '#4FA3E0' },
  var: { name: 'tv-outline', color: '#8057F4' },
  other: { name: 'ellipse-outline', color: '#8A94A6' },
};

function EventRow({ event, side }: { event: MatchEvent; side: 'left' | 'right' }) {
  const icon = ICONS[event.kind] ?? ICONS.other;
  const isSub = event.kind === 'substitution';
  const content = (
    <View style={[styles.eventBody, side === 'right' && styles.alignRight]}>
      <AppText variant="bodyStrong" numberOfLines={1}>
        {isSub ? `${event.assist_name ?? '?'} girdi` : (event.player_name ?? eventLabel(event))}
      </AppText>
      <AppText variant="caption" color="textSecondary" numberOfLines={2}>
        {isSub
          ? `${event.player_name ?? '?'} çıktı`
          : [eventLabel(event), event.assist_name && event.kind !== 'var' ? `Asist: ${event.assist_name}` : null]
              .filter(Boolean)
              .join(' · ')}
        {event.revision > 1 ? ' · düzeltildi' : ''}
      </AppText>
    </View>
  );
  return (
    <View style={styles.eventRow}>
      <View style={styles.side}>{side === 'left' ? content : null}</View>
      <View style={styles.axis}>
        <AppText variant="caption" color="textSecondary">
          {minuteLabel(event.minute, event.extra)}
        </AppText>
        <Ionicons name={icon.name} size={16} color={icon.color} />
      </View>
      <View style={styles.side}>{side === 'right' ? content : null}</View>
    </View>
  );
}

/**
 * Maç akışı: sağlayıcıdan gelen olaylar dakikaya göre sıralanır. Geri çekilen
 * olaylar (ör. VAR ile iptal) sunucuda "retracted" durumuna alınır ve burada
 * görünmez; revize edilen olaylar "düzeltildi" etiketi taşır.
 */
export function TimelinePanel({ fixture }: { fixture: Fixture }) {
  const { theme } = useTheme();
  const query = useFixtureTimeline(fixture.id, fixture.status.is_live);

  if (query.isLoading) return <PanelLoading />;
  if (query.isError) return <PanelError onRetry={() => void query.refetch()} />;

  const events = query.data?.events ?? [];
  const phases = query.data?.phases ?? [];
  if (events.length === 0) {
    return (
      <EmptyState
        icon="time-outline"
        title="Henüz olay yok"
        body={fixture.status.phase === 'scheduled' ? 'Maç başladığında gol, kart ve değişiklikler burada görünecek.' : 'Veri sağlayıcı bu maç için olay bildirmedi.'}
      />
    );
  }

  const homeId = fixture.home.id;
  const htIndex = events.findIndex((event) => (event.minute ?? 0) > 45);
  const reversed = [...events].reverse();
  const showHt = phases.some((phase) => phase.phase === 'half_time');

  return (
    <SectionCard>
      <View style={styles.teams}>
        <AppText variant="label" numberOfLines={1} style={styles.flex}>
          {fixture.home.name}
        </AppText>
        <AppText variant="label" numberOfLines={1} align="right" style={styles.flex}>
          {fixture.away.name}
        </AppText>
      </View>
      {fixture.status.is_finished ? (
        <View style={[styles.divider, { borderColor: theme.colors.border }]}>
          <AppText variant="caption" color="textSecondary">
            {phaseLabel(fixture.status.phase)}
          </AppText>
        </View>
      ) : null}
      {reversed.map((event, index) => {
        const originalIndex = events.length - 1 - index;
        const showDivider = showHt && htIndex > 0 && originalIndex === htIndex - 1;
        return (
          <View key={event.id}>
            {showDivider ? (
              <View style={[styles.divider, { borderColor: theme.colors.border }]}>
                <AppText variant="caption" color="textSecondary">
                  Devre arası{fixture.score.halftime.home != null ? ` · ${fixture.score.halftime.home}-${fixture.score.halftime.away}` : ''}
                </AppText>
              </View>
            ) : null}
            <EventRow event={event} side={event.team_id === homeId ? 'left' : 'right'} />
          </View>
        );
      })}
      <AppText variant="caption" color="textTertiary" align="center" style={styles.footer}>
        Son güncelleme: {relativeAge(query.data?.updated_at ?? null)} · Veri: API-Football
      </AppText>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  teams: { flexDirection: 'row', marginBottom: 4 },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  side: { flex: 1 },
  axis: { width: 58, alignItems: 'center', gap: 2 },
  eventBody: { gap: 1 },
  alignRight: { alignItems: 'flex-end' },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center', paddingTop: 6, marginTop: 4 },
  footer: { marginTop: 10 },
});
