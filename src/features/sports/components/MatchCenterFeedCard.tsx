import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/ui';
import { useRouter } from '@/utils/router';

import { useCountdown } from '../hooks/use-countdown';
import { useFeedCard, useSportsLiveInvalidation } from '../hooks/use-sports';
import { useSportsCardStore } from '../store';
import type { FeedCard, Fixture } from '../types';
import {
  eventLabel,
  kickoffLabel,
  liveClock,
  minuteLabel,
  phaseLabel,
  scoreText,
} from '../utils/format';
import { TeamBadge } from './TeamBadge';

export function LiveDot({ color = '#FF4D5E' }: { color?: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.liveDot, { backgroundColor: color }, style]} />;
}

function useMinuteTick(enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(id);
  }, [enabled]);
}

function TeamColumn({ name, logo, primary }: { name: string | null; logo: string | null; primary: boolean }) {
  return (
    <View style={styles.teamCol}>
      <TeamBadge name={name} logo={logo} size={46} primary={primary} />
      <AppText variant="label" numberOfLines={2} align="center" style={styles.teamName}>
        {name ?? '—'}
      </AppText>
    </View>
  );
}

function CenterBlock({
  card,
  fixture,
  countdown,
}: {
  card: FeedCard;
  fixture: Fixture;
  countdown: string | null;
}) {
  if (card.mode === 'preview') {
    return (
      <View style={styles.center}>
        <AppText
          variant="h3"
          style={[styles.white, styles.countdown]}
          accessibilityLabel={countdown ? `Maçın başlamasına ${countdown} kaldı` : undefined}
        >
          {countdown ?? '—'}
        </AppText>
        <AppText variant="caption" style={styles.muted}>
          {countdown ? 'başlamaya kaldı' : 'Başlama bekleniyor'}
        </AppText>
        <AppText variant="caption" style={styles.muted} numberOfLines={1}>
          {kickoffLabel(fixture.kickoff_at)}
        </AppText>
      </View>
    );
  }
  if (card.mode === 'status') {
    return (
      <View style={styles.center}>
        <View style={[styles.statusPill, { backgroundColor: 'rgba(245,158,11,0.18)' }]}>
          <AppText variant="label" style={{ color: '#FBBF24' }}>
            {phaseLabel(fixture.status.phase)}
          </AppText>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <View style={styles.scoreRow}>
        <AppText variant="display" style={styles.white}>
          {scoreText(fixture.goals.home)}
        </AppText>
        <AppText variant="h2" style={styles.muted}>
          :
        </AppText>
        <AppText variant="display" style={styles.white}>
          {scoreText(fixture.goals.away)}
        </AppText>
      </View>
      {card.mode === 'live' ? (
        <View style={styles.clockRow}>
          <LiveDot />
          <AppText variant="label" style={{ color: '#FF8A95' }}>
            {liveClock(fixture)}
          </AppText>
        </View>
      ) : (
        <AppText variant="caption" style={styles.muted}>
          {phaseLabel(fixture.status.phase)}
          {fixture.score.halftime.home != null
            ? ` · İY ${fixture.score.halftime.home}-${fixture.score.halftime.away}`
            : ''}
        </AppText>
      )}
    </View>
  );
}

function headerLabel(card: FeedCard, fixture: Fixture): string {
  const league = [fixture.league.name, fixture.league.round].filter(Boolean).join(' · ');
  if (card.mode === 'live') return `CANLI · ${league}`;
  if (card.mode === 'result') return `MAÇ SONU · ${league}`;
  if (card.mode === 'status') return league;
  return `MAÇ ÖNÜ · ${league}`;
}

/**
 * Feed'de Hikâyeler ile gönderiler arasında yer alan Trabzonspor maç kartı.
 * Tek kayıt yerinde güncellenir (aynı maç için ikinci kart oluşmaz); canlı
 * durumuna yalnızca sağlayıcı maçın başladığını bildirince geçer.
 */
export const MatchCenterFeedCard = memo(function MatchCenterFeedCard() {
  const router = useRouter();
  const showTest = useSportsCardStore((state) => state.showTest);
  const card = useFeedCard(showTest);
  useSportsLiveInvalidation(true);
  const fixture = card.data?.fixture ?? null;
  const pref = useSportsCardStore((state) => (fixture ? state.cards[fixture.id] : undefined));
  const setHidden = useSportsCardStore((state) => state.setHidden);
  const setMinimized = useSportsCardStore((state) => state.setMinimized);
  useMinuteTick(card.data?.mode === 'preview');
  // Başlama saatine geri sayım: kart maçtan 30 dk önce açıldığı için burada hep
  // son bir saatin içinde başlar ve saniye saniye işler.
  const countdown = useCountdown(fixture?.kickoff_at ?? null, card.data?.mode === 'preview');

  if (!card.data?.enabled || !fixture || !card.data.mode) return null;
  const data = card.data;
  const settings = data.settings;
  if (pref?.hidden && settings?.allow_hide !== false) return null;

  const open = () => router.push(`/trabzonspor/mac/${fixture.id}` as never);
  const minimized = pref?.minimized ?? settings?.default_view === 'compact';
  const live = data.mode === 'live';

  if (minimized) {
    return (
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${fixture.home.name} ${fixture.away.name} maçını aç`}
        style={styles.wrap}
      >
        <LinearGradient colors={['#2A0C1C', '#0C2342']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.mini}>
          {live ? <LiveDot /> : <Ionicons name="football-outline" size={15} color="#9FC2FF" />}
          <AppText variant="label" numberOfLines={1} style={[styles.white, styles.flex]}>
            {fixture.home.name}{' '}
            {data.mode === 'preview' || data.mode === 'status'
              ? '–'
              : `${scoreText(fixture.goals.home)}-${scoreText(fixture.goals.away)}`}{' '}
            {fixture.away.name}
          </AppText>
          <AppText variant="caption" style={styles.muted}>
            {live
              ? liveClock(fixture)
              : data.mode === 'preview'
                ? countdown
                  ? `${countdown} kaldı`
                  : kickoffLabel(fixture.kickoff_at)
                : phaseLabel(fixture.status.phase)}
          </AppText>
          <Pressable
            onPress={() => setMinimized(fixture.id, false)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Maç kartını genişlet"
          >
            <Ionicons name="chevron-down" size={18} color="#C9D6F2" />
          </Pressable>
        </LinearGradient>
      </Pressable>
    );
  }

  const last = data.last_event;
  const possessionHome = data.stats?.home?.ball_possession;
  const possessionAway = data.stats?.away?.ball_possession;
  const shotsHome = data.stats?.home?.total_shots;
  const shotsAway = data.stats?.away?.total_shots;

  return (
    <View style={styles.wrap}>
      <LinearGradient colors={['#3A0F24', '#121A33', '#0B2A4F']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.topRow}>
          <View style={styles.topLeft}>
            {live ? <LiveDot /> : null}
            <AppText variant="overline" numberOfLines={1} style={[styles.muted, styles.flex]}>
              {headerLabel(data, fixture)}
            </AppText>
          </View>
          {fixture.is_test ? (
            <View style={styles.testPill}>
              <AppText variant="overline" style={{ color: '#111' }}>
                TEST
              </AppText>
            </View>
          ) : null}
          <Pressable
            onPress={() => setMinimized(fixture.id, true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Maç kartını küçült"
          >
            <Ionicons name="remove" size={18} color="#C9D6F2" />
          </Pressable>
          {settings?.allow_hide !== false ? (
            <Pressable
              onPress={() => setHidden(fixture.id, true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Bu maçın kartını gizle"
            >
              <Ionicons name="close" size={18} color="#C9D6F2" />
            </Pressable>
          ) : null}
        </View>

        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel="Maç Arenasını aç">
          <View style={styles.teamsRow}>
            <TeamColumn name={fixture.home.name} logo={fixture.home.logo} primary={fixture.primary_side === 'home'} />
            <CenterBlock card={data} fixture={fixture} countdown={countdown} />
            <TeamColumn name={fixture.away.name} logo={fixture.away.logo} primary={fixture.primary_side === 'away'} />
          </View>

          {last && (live || data.mode === 'result') ? (
            <View style={styles.eventRow}>
              <AppText variant="caption" style={styles.muted}>
                {minuteLabel(last.minute, last.extra)}
              </AppText>
              <AppText variant="caption" numberOfLines={1} style={[styles.white, styles.flex]}>
                {eventLabel(last)}
                {last.player_name ? ` · ${last.player_name}` : ''}
                {last.team_name ? ` (${last.team_name})` : ''}
              </AppText>
            </View>
          ) : null}

          {settings?.show_stats && (possessionHome != null || shotsHome != null) ? (
            <View style={styles.statsRow}>
              {possessionHome != null && possessionAway != null ? (
                <AppText variant="caption" style={styles.muted}>
                  Topla oynama %{possessionHome} – %{possessionAway}
                </AppText>
              ) : null}
              {shotsHome != null && shotsAway != null ? (
                <AppText variant="caption" style={styles.muted}>
                  Şut {shotsHome} – {shotsAway}
                </AppText>
              ) : null}
            </View>
          ) : null}

          <View style={styles.footer}>
            <AppText variant="caption" numberOfLines={1} style={[styles.muted, styles.flex]}>
              {data.mode === 'preview'
                ? [kickoffLabel(fixture.kickoff_at), fixture.venue.name].filter(Boolean).join(' · ')
                : data.mode === 'result' && !fixture.final_verified
                  ? 'Sonuç sağlayıcıdan doğrulanıyor'
                  : data.chat && settings?.show_chat_count && data.chat.active_users > 0
                    ? `${data.chat.active_users} taraftar sohbette`
                    : fixture.venue.name ?? ''}
              {data.mode === 'preview' && fixture.lineups_available ? ' · Kadrolar açıklandı' : ''}
            </AppText>
            <View style={styles.cta}>
              <AppText variant="label" style={styles.white}>
                {live ? 'Canlı Arena' : data.mode === 'preview' ? 'Yorum yap' : 'Arenaya gir'}
              </AppText>
              <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
            </View>
          </View>
        </Pressable>
      </LinearGradient>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingBottom: 12 },
  card: { borderRadius: 22, padding: 14, gap: 10, overflow: 'hidden' },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  flex: { flex: 1 },
  white: { color: '#FFFFFF' },
  muted: { color: '#B9C4DC' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  topLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  testPill: { backgroundColor: '#FBBF24', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  teamsRow: { flexDirection: 'row', alignItems: 'center', minHeight: 96 },
  teamCol: { flex: 1, alignItems: 'center', gap: 6 },
  teamName: { color: '#FFFFFF', maxWidth: 120 },
  center: { minWidth: 112, alignItems: 'center', gap: 2 },
  countdown: { fontVariant: ['tabular-nums'] },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 6,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(79,163,224,0.28)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
