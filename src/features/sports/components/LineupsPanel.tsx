import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useFixtureLineups } from '../hooks/use-sports';
import type { Fixture, LineupPlayer, PlayerPerformance, TeamLineup } from '../types';
import { relativeAge } from '../utils/format';
import { EmptyState, PanelError, PanelLoading, SectionCard } from './ui';

type Placed = { player: LineupPlayer; x: number; y: number };

/** "row:col" ızgarasından saha koordinatı (0–1). Ev sahibi alt, deplasman üst yarı. */
function placeTeam(lineup: TeamLineup, half: 'bottom' | 'top'): Placed[] | null {
  const parsed = lineup.start_xi.map((player) => {
    const [row = Number.NaN, col = Number.NaN] = String(player.grid ?? '').split(':').map(Number);
    return { player, row, col };
  });
  if (parsed.some((item) => !Number.isFinite(item.row) || !Number.isFinite(item.col))) return null;
  const maxRow = Math.max(...parsed.map((item) => item.row));
  const colsPerRow = new Map<number, number>();
  for (const item of parsed) colsPerRow.set(item.row, Math.max(colsPerRow.get(item.row) ?? 0, item.col));
  return parsed.map((item) => {
    const cols = colsPerRow.get(item.row) ?? 1;
    const depth = maxRow <= 1 ? 0 : (item.row - 1) / (maxRow - 1);
    const yHalf = 0.06 + depth * 0.38;
    // API sütunları soldan sağa; üst yarıda ayna simetri ile çevrilir.
    const xRaw = item.col / (cols + 1);
    return {
      player: item.player,
      x: half === 'bottom' ? xRaw : 1 - xRaw,
      y: half === 'bottom' ? 1 - yHalf : yHalf,
    };
  });
}

function PlayerDot({
  placed,
  color,
  rating,
  onPress,
}: {
  placed: Placed;
  color: string;
  rating: number | null;
  onPress: () => void;
}) {
  const lastName = (placed.player.name ?? '').split(' ').slice(-1)[0] ?? '';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${placed.player.name ?? 'Oyuncu'} oyuncu kartı`}
      style={[styles.dotWrap, { left: `${placed.x * 100}%`, top: `${placed.y * 100}%` }]}
    >
      <View style={[styles.dot, { backgroundColor: color }]}>
        <AppText variant="caption" style={styles.dotNumber}>
          {placed.player.number ?? ''}
        </AppText>
      </View>
      <AppText variant="caption" numberOfLines={1} style={styles.dotName}>
        {lastName}
      </AppText>
      {rating != null ? (
        <View style={styles.rating}>
          <AppText variant="caption" style={styles.ratingText}>
            {rating.toFixed(1)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

function PlayerCard({
  player,
  perf,
  team,
  photosAllowed,
  onClose,
}: {
  player: LineupPlayer | null;
  perf: PlayerPerformance | null;
  team: string | null;
  photosAllowed: boolean;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  if (!player) return null;
  const stats = (perf?.stats ?? {}) as Record<string, Record<string, number | null> | undefined>;
  const line = (label: string, value: number | string | null | undefined) => (
    <View style={styles.statLine} key={label}>
      <AppText variant="body" color="textSecondary">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value == null ? '—' : String(value)}</AppText>
    </View>
  );
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: theme.colors.surface }]} onPress={() => undefined}>
          <View style={styles.cardHead}>
            {photosAllowed && perf?.photo ? (
              <Image source={{ uri: perf.photo }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={[styles.photo, styles.photoFallback, { backgroundColor: theme.colors.primarySoft }]}>
                <AppText variant="h3" color="primaryDeep">
                  {player.number ?? '?'}
                </AppText>
              </View>
            )}
            <View style={styles.flex}>
              <AppText variant="h3">{player.name ?? 'Oyuncu'}</AppText>
              <AppText variant="caption" color="textSecondary">
                {[team, player.pos, player.number != null ? `#${player.number}` : null].filter(Boolean).join(' · ')}
              </AppText>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          {perf ? (
            <>
              <View style={[styles.ratingBox, { backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="caption" color="textSecondary">
                  API-Football maç puanı
                </AppText>
                <AppText variant="h2">{perf.rating != null ? perf.rating.toFixed(1) : '—'}</AppText>
                <AppText variant="caption" color="textTertiary">
                  Resmî veri sağlayıcı puanıdır; taraftar oylamasından ayrıdır.
                </AppText>
              </View>
              {line('Süre (dk)', perf.minutes)}
              {line('Gol', stats.goals?.total)}
              {line('Asist', stats.goals?.assists)}
              {line('Şut (isabetli)', stats.shots?.on)}
              {line('Pas', stats.passes?.total)}
              {line('Kilit pas', stats.passes?.key)}
              {line('Top kapma', stats.tackles?.total)}
              {line('Sarı / Kırmızı', stats.cards ? `${stats.cards.yellow ?? 0} / ${stats.cards.red ?? 0}` : null)}
            </>
          ) : (
            <AppText variant="body" color="textSecondary">
              Oyuncu performans verisi maç sırasında veya sonrasında sağlayıcıdan gelir.
            </AppText>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function LineupsPanel({ fixture, photosAllowed }: { fixture: Fixture; photosAllowed: boolean }) {
  const { theme } = useTheme();
  const query = useFixtureLineups(fixture.id);
  const [selected, setSelected] = useState<{ player: LineupPlayer; team: TeamLineup } | null>(null);

  const perfById = useMemo(() => {
    const map = new Map<number, PlayerPerformance>();
    for (const player of query.data?.players ?? []) map.set(player.player_id, player);
    return map;
  }, [query.data?.players]);

  if (query.isLoading) return <PanelLoading />;
  if (query.isError) return <PanelError onRetry={() => void query.refetch()} />;

  const teams = query.data?.teams ?? [];
  const home = teams.find((team) => team.team_id === fixture.home.id) ?? null;
  const away = teams.find((team) => team.team_id === fixture.away.id) ?? null;

  if (!home && !away) {
    return (
      <EmptyState
        icon="people-outline"
        title="Kadrolar henüz açıklanmadı"
        body="Resmî ilk 11'ler genellikle maçtan yaklaşık 1 saat önce açıklanır. Tahmini kadro yayınlanmaz."
      />
    );
  }

  const homePlaced = home ? placeTeam(home, 'bottom') : null;
  const awayPlaced = away ? placeTeam(away, 'top') : null;
  const predicted = teams.some((team) => team.is_predicted);
  const select = (player: LineupPlayer, team: TeamLineup) => setSelected({ player, team });

  return (
    <View style={styles.gapCol}>
      {predicted ? (
        <View style={[styles.predicted, { backgroundColor: theme.colors.warningSoft }]}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.warning} />
          <AppText variant="caption" style={{ color: theme.colors.warning, flex: 1 }}>
            Tahmini kadro · Kaynak: {teams.find((team) => team.is_predicted)?.source ?? 'belirtilmedi'}. Resmî değildir.
          </AppText>
        </View>
      ) : null}

      {homePlaced || awayPlaced ? (
        <View style={styles.pitch}>
          <View style={styles.midLine} />
          <View style={styles.circle} />
          <View style={[styles.box, styles.boxTop]} />
          <View style={[styles.box, styles.boxBottom]} />
          {awayPlaced && away
            ? awayPlaced.map((placed) => (
                <PlayerDot
                  key={`a-${placed.player.id ?? placed.player.name}`}
                  placed={placed}
                  color="#1F4F8A"
                  rating={placed.player.id ? (perfById.get(placed.player.id)?.rating ?? null) : null}
                  onPress={() => select(placed.player, away)}
                />
              ))
            : null}
          {homePlaced && home
            ? homePlaced.map((placed) => (
                <PlayerDot
                  key={`h-${placed.player.id ?? placed.player.name}`}
                  placed={placed}
                  color="#7A1F3D"
                  rating={placed.player.id ? (perfById.get(placed.player.id)?.rating ?? null) : null}
                  onPress={() => select(placed.player, home)}
                />
              ))
            : null}
        </View>
      ) : null}

      {[home, away].map((team) =>
        team ? (
          <SectionCard key={team.team_id} title={`${team.team_name ?? ''}${team.formation ? ` · ${team.formation}` : ''}`}>
            {team.coach?.name ? (
              <AppText variant="caption" color="textSecondary">
                Teknik direktör: {team.coach.name}
              </AppText>
            ) : null}
            {(team === home ? !homePlaced : !awayPlaced) ? (
              <>
                <AppText variant="label" style={styles.subTitle}>
                  İlk 11
                </AppText>
                {team.start_xi.map((player) => (
                  <Pressable key={`xi-${player.id ?? player.name}`} onPress={() => select(player, team)} style={styles.listRow}>
                    <AppText variant="bodyStrong" style={styles.num}>
                      {player.number ?? ''}
                    </AppText>
                    <AppText variant="body" style={styles.flex}>
                      {player.name}
                    </AppText>
                    <AppText variant="caption" color="textSecondary">
                      {player.pos ?? ''}
                    </AppText>
                  </Pressable>
                ))}
              </>
            ) : null}
            <AppText variant="label" style={styles.subTitle}>
              Yedekler
            </AppText>
            {team.substitutes.length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Veri mevcut değil
              </AppText>
            ) : (
              team.substitutes.map((player) => (
                <Pressable key={`sub-${player.id ?? player.name}`} onPress={() => select(player, team)} style={styles.listRow}>
                  <AppText variant="bodyStrong" style={styles.num}>
                    {player.number ?? ''}
                  </AppText>
                  <AppText variant="body" style={styles.flex}>
                    {player.name}
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    {player.pos ?? ''}
                  </AppText>
                </Pressable>
              ))
            )}
          </SectionCard>
        ) : null,
      )}

      <AppText variant="caption" color="textTertiary" align="center">
        Kaynak: {home?.source ?? away?.source ?? 'API-Football'} · Son güncelleme: {relativeAge(query.data?.updated_at ?? null)}
      </AppText>

      {selected ? (
        <PlayerCard
          player={selected.player}
          perf={selected.player.id ? (perfById.get(selected.player.id) ?? null) : null}
          team={selected.team.team_name}
          photosAllowed={photosAllowed}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gapCol: { gap: 12 },
  predicted: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 10 },
  pitch: {
    aspectRatio: 0.68,
    width: '100%',
    borderRadius: 18,
    backgroundColor: '#14532D',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  midLine: { position: 'absolute', left: 0, right: 0, top: '50%', height: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  circle: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    left: '50%',
    top: '50%',
    marginLeft: -45,
    marginTop: -45,
  },
  box: { position: 'absolute', left: '25%', width: '50%', height: '13%', borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  boxTop: { top: -2 },
  boxBottom: { bottom: -2 },
  dotWrap: { position: 'absolute', width: 72, marginLeft: -36, marginTop: -18, alignItems: 'center' },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  dotNumber: { color: '#FFFFFF', fontSize: 11 },
  dotName: { color: '#FFFFFF', fontSize: 10.5, marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  rating: { position: 'absolute', top: -6, right: 12, backgroundColor: '#0B1020', borderRadius: 6, paddingHorizontal: 3 },
  ratingText: { color: '#FFFFFF', fontSize: 9.5 },
  subTitle: { marginTop: 8 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  num: { width: 26 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { borderRadius: 22, padding: 18, gap: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 56, height: 56, borderRadius: 28 },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  ratingBox: { borderRadius: 14, padding: 12, alignItems: 'center', gap: 2, marginVertical: 6 },
  statLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
});
