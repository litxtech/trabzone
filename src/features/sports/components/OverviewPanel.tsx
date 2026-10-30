import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import { useFixturePulse, usePolls, useVotePoll } from '../hooks/use-sports';
import type { FixtureDetail, Poll } from '../types';
import { eventLabel, isGoalKind, kickoffLabel, minuteLabel, phaseLabel, relativeAge } from '../utils/format';
import { SectionCard } from './ui';

function pollPolicy(poll: Poll): string {
  const change = poll.allow_change ? 'Oyunu en fazla 3 kez değiştirebilirsin' : 'Oy verdikten sonra değiştirilemez';
  const visibility =
    poll.results_visibility === 'always'
      ? 'sonuçlar herkese açık'
      : poll.results_visibility === 'after_close'
        ? 'sonuçlar anket kapanınca görünür'
        : 'sonuçlar oy verince görünür';
  return `${change} · ${visibility}`;
}

function PollCard({ poll, fixtureId }: { poll: Poll; fixtureId: number }) {
  const { theme } = useTheme();
  const session = useSession();
  const vote = useVotePoll(fixtureId);
  const [error, setError] = useState<string | null>(null);
  const canVote = poll.state === 'active' && Boolean(session?.user) && (poll.my_vote == null || poll.allow_change);

  return (
    <SectionCard
      title={poll.question}
      right={
        <AppText variant="caption" color={poll.state === 'active' ? 'success' : 'textTertiary'}>
          {poll.state === 'active' ? 'Açık' : poll.state === 'scheduled' ? 'Yakında' : 'Kapandı'}
        </AppText>
      }
    >
      {poll.options.map((option) => {
        const mine = poll.my_vote === option.id;
        const pct = poll.results_visible ? (option.pct ?? 0) : null;
        return (
          <Pressable
            key={option.id}
            disabled={!canVote || vote.isPending || mine}
            onPress={() => {
              setError(null);
              vote.mutate({ pollId: poll.id, optionId: option.id }, { onError: (failure) => setError(failure.message) });
            }}
            style={[
              styles.option,
              { borderColor: mine ? theme.colors.primary : theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: mine }}
          >
            {pct != null ? (
              <View style={[styles.optionFill, { width: `${pct}%`, backgroundColor: mine ? theme.colors.primarySoft : theme.colors.border }]} />
            ) : null}
            <AppText variant="bodyStrong" style={styles.flex}>
              {option.label}
            </AppText>
            {mine ? <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} /> : null}
            {pct != null ? <AppText variant="label">%{pct}</AppText> : null}
          </Pressable>
        );
      })}
      <AppText variant="caption" color="textTertiary">
        {poll.results_visible && poll.total_votes != null ? `${poll.total_votes} oy · ` : ''}
        {pollPolicy(poll)}
        {!session?.user ? ' · Oy vermek için giriş yap' : ''}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        Eğlence amaçlıdır; ödül, bahis veya para içermez.
      </AppText>
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </SectionCard>
  );
}

function Pulse({ fixtureId, live }: { fixtureId: number; live: boolean }) {
  const { theme } = useTheme();
  const pulse = useFixturePulse(fixtureId, live);
  const buckets = pulse.data?.community?.buckets;
  const max = useMemo(
    () => Math.max(1, ...(buckets ?? []).map((bucket) => bucket.chat + bucket.comments)),
    [buckets],
  );
  const keyEvents = pulse.data?.official?.events ?? [];
  if (!pulse.data?.window) return null;

  return (
    <SectionCard title="Maçın Nabzı">
      <AppText variant="label" style={styles.subTitle}>
        Resmî maç verisi
      </AppText>
      {keyEvents.length === 0 ? (
        <AppText variant="caption" color="textTertiary">
          Henüz gol, kırmızı kart veya VAR olayı yok.
        </AppText>
      ) : (
        <View style={styles.eventChips}>
          {keyEvents.map((event, index) => (
            <View
              key={`${event.minute}-${index}`}
              style={[styles.eventChip, { backgroundColor: isGoalKind(event.kind) ? theme.colors.successSoft : theme.colors.surfaceMuted }]}
            >
              <AppText variant="caption">
                {minuteLabel(event.minute, event.extra)} {eventLabel({ kind: event.kind, detail: null })}
                {event.player_name ? ` · ${event.player_name}` : ''}
              </AppText>
            </View>
          ))}
        </View>
      )}
      <AppText variant="caption" color="textTertiary">
        Kaynak: {pulse.data.official?.source ?? 'API-Football'}
      </AppText>

      <AppText variant="label" style={styles.subTitle}>
        Trabzone topluluğu (5 dk’lık aralıklar)
      </AppText>
      {!buckets || buckets.length === 0 ? (
        <AppText variant="caption" color="textTertiary">
          Topluluk etkinliği henüz yok.
        </AppText>
      ) : (
        <View style={styles.chart}>
          {buckets.map((bucket) => {
            const value = bucket.chat + bucket.comments;
            return (
              <View key={bucket.at} style={styles.barSlot}>
                <View
                  style={{
                    height: `${Math.max(2, (value / max) * 100)}%`,
                    backgroundColor: value > 0 ? '#4FA3E0' : theme.colors.border,
                    borderRadius: 2,
                  }}
                />
              </View>
            );
          })}
        </View>
      )}
      <AppText variant="caption" color="textTertiary">
        Sohbet mesajı ve yorum sayısıdır; resmî maç verisiyle karıştırılmaz.
      </AppText>
    </SectionCard>
  );
}

export function OverviewPanel({ detail }: { detail: FixtureDetail }) {
  const fixture = detail.fixture;
  const polls = usePolls(fixture.id, true);
  const list = polls.data ?? [];

  return (
    <View style={styles.col}>
      <SectionCard title="Maç bilgisi">
        <InfoRow icon="calendar-outline" label={kickoffLabel(fixture.kickoff_at)} />
        {fixture.league.name ? (
          <InfoRow icon="trophy-outline" label={[fixture.league.name, fixture.league.round].filter(Boolean).join(' · ')} />
        ) : null}
        {fixture.venue.name ? (
          <InfoRow icon="location-outline" label={[fixture.venue.name, fixture.venue.city].filter(Boolean).join(', ')} />
        ) : null}
        {fixture.referee ? <InfoRow icon="person-outline" label={`Hakem: ${fixture.referee}`} /> : null}
        <InfoRow icon="pulse-outline" label={`Durum: ${phaseLabel(fixture.status.phase)}${fixture.status.is_finished && !fixture.final_verified ? ' (doğrulanıyor)' : ''}`} />
        <AppText variant="caption" color="textTertiary">
          Son veri güncellemesi: {relativeAge(fixture.synced.fixture)} · {detail.attribution}
        </AppText>
      </SectionCard>

      {list.map((poll) => (
        <PollCard key={poll.id} poll={poll} fixtureId={fixture.id} />
      ))}

      <Pulse fixtureId={fixture.id} live={fixture.status.is_live} />
    </View>
  );
}

function InfoRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={theme.colors.textSecondary} />
      <AppText variant="body" style={styles.flex}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  col: { gap: 12 },
  subTitle: { marginTop: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    overflow: 'hidden',
  },
  optionFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  eventChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  eventChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 70, gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
});
