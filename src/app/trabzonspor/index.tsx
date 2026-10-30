import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, IconButton } from '@/components/ui';
import { FixtureRow } from '@/features/sports/components/FixtureRow';
import { groupByMatchDay, MatchDayStrip } from '@/features/sports/components/MatchDayStrip';
import { Scoreboard } from '@/features/sports/components/Scoreboard';
import { Chip, EmptyState, PanelError, PanelLoading, SectionCard } from '@/features/sports/components/ui';
import { useFixtureList, useSportsCenter, useSportsLiveInvalidation, useStandings } from '@/features/sports/hooks/use-sports';
import type { FixtureScope, Standings } from '@/features/sports/types';
import { matchDayHeading, relativeAge } from '@/features/sports/utils/format';
import { PublicShell } from '@/features/web/components/PublicShell';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

type Section = 'fixtures' | 'standings';

export default function TrabzonsporHubScreen() {
  const router = useRouter();
  const session = useSession();
  const [section, setSection] = useState<Section>('fixtures');
  const [scope, setScope] = useState<FixtureScope>('upcoming');
  useSportsLiveInvalidation(true);
  const center = useSportsCenter();

  useWebMeta({
    title: 'Trabzonspor Maç Merkezi | Trabzone',
    description:
      'Trabzonspor canlı skor, maç akışı, istatistikler, kadrolar, fikstür ve puan durumu. Taraftar sohbeti ve yorumlar Trabzone Maç Arenası’nda.',
    path: '/trabzonspor',
  });

  const open = (id: number) => router.push(`/trabzonspor/mac/${id}` as never);
  const data = center.data;
  const hero = data?.live ?? data?.next ?? data?.last ?? null;

  return (
    <PublicShell
      title="Trabzonspor"
      subtitle="Maç Merkezi"
      fallbackHref="/"
      webScroll
      right={
        session?.user ? (
          <IconButton
            name="notifications-outline"
            size={21}
            accessibilityLabel="Trabzonspor bildirim tercihleri"
            onPress={() => router.push('/trabzonspor/bildirimler' as never)}
          />
        ) : undefined
      }
    >
      <View style={styles.body}>
        {center.isLoading ? (
          <PanelLoading />
        ) : center.isError ? (
          <PanelError onRetry={() => void center.refetch()} />
        ) : !data?.configured ? (
          <EmptyState
            icon="football-outline"
            title="Maç merkezi hazırlanıyor"
            body="Trabzonspor verileri resmi veri sağlayıcısından ilk kez senkronize ediliyor. Kısa süre sonra burada olacak."
          />
        ) : (
          <>
            {hero ? (
              <Pressable onPress={() => open(hero.id)} accessibilityRole="button" accessibilityLabel="Maç arenasını aç">
                <Scoreboard fixture={hero} />
                <View style={styles.heroCta}>
                  <AppText variant="label" color="primary">
                    {hero.status.is_live ? 'Canlı arenaya gir' : hero.status.phase === 'scheduled' ? 'Maç arenasını aç' : 'Maç özetine git'}
                  </AppText>
                  <Ionicons name="chevron-forward" size={14} color="#7A1F3D" />
                </View>
              </Pressable>
            ) : null}

            {data.standing ? (
              <SectionCard title={data.standing.league_name}>
                <View style={styles.standingRow}>
                  <Stat label="Sıra" value={`${data.standing.rank}.`} />
                  <Stat label="Puan" value={data.standing.points} />
                  <Stat label="Oynanan" value={data.standing.played} />
                  <Stat label="Averaj" value={data.standing.goals_diff} />
                </View>
                {data.standing.form ? <FormStrip form={data.standing.form} /> : null}
              </SectionCard>
            ) : null}

            <View style={styles.chips}>
              <Chip label="Fikstür" active={section === 'fixtures'} onPress={() => setSection('fixtures')} />
              <Chip label="Puan durumu" active={section === 'standings'} onPress={() => setSection('standings')} />
            </View>

            {section === 'fixtures' ? (
              <>
                <View style={styles.chips}>
                  <Chip label="Gelecek" active={scope === 'upcoming'} onPress={() => setScope('upcoming')} />
                  <Chip label="Sonuçlar" active={scope === 'results'} onPress={() => setScope('results')} />
                  <Chip label="Canlı" active={scope === 'live'} onPress={() => setScope('live')} />
                </View>
                <FixtureList key={scope} scope={scope} onOpen={open} />
              </>
            ) : (
              <StandingsSection competitions={data.competitions.filter((item) => item.has_standings)} />
            )}

            <AppText variant="caption" color="textTertiary" align="center">
              {data.attribution}
            </AppText>
          </>
        )}
      </View>
    </PublicShell>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <View style={styles.stat}>
      <AppText variant="h3">{value ?? '—'}</AppText>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

function FormStrip({ form }: { form: string }) {
  const map: Record<string, { label: string; color: string }> = {
    W: { label: 'G', color: '#1E9E5A' },
    D: { label: 'B', color: '#8A8F98' },
    L: { label: 'M', color: '#D23A4B' },
  };
  return (
    <View style={styles.form} accessibilityLabel={`Son maçlar: ${form}`}>
      <AppText variant="caption" color="textSecondary">
        Form
      </AppText>
      {form
        .split('')
        .slice(-5)
        .map((char, index) => {
          const item = map[char];
          if (!item) return null;
          return (
            <View key={`${char}-${index}`} style={[styles.formPill, { backgroundColor: item.color }]}>
              <AppText variant="caption" style={styles.formText}>
                {item.label}
              </AppText>
            </View>
          );
        })}
    </View>
  );
}

function FixtureList({ scope, onOpen }: { scope: FixtureScope; onOpen: (id: number) => void }) {
  const { theme } = useTheme();
  const list = useFixtureList(scope);
  const items = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const days = useMemo(() => groupByMatchDay(items), [items]);
  const [day, setDay] = useState<string | null>(null);
  const shown = day ? days.filter((item) => item.key === day) : days;
  if (list.isLoading) return <PanelLoading />;
  if (list.isError) return <PanelError onRetry={() => void list.refetch()} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon="calendar-outline"
        title={scope === 'live' ? 'Şu an canlı maç yok' : 'Maç bulunamadı'}
        body={scope === 'upcoming' ? 'Fikstür sağlayıcı tarafından açıklandığında burada görünür.' : undefined}
      />
    );
  }
  return (
    <View style={styles.list}>
      <MatchDayStrip days={days} selected={day} onSelect={setDay} />
      {shown.map((group) => {
        const first = group.fixtures[0];
        return (
          <View key={group.key} style={styles.dayGroup}>
            {first ? (
              <AppText variant="label" color="textSecondary" accessibilityRole="header">
                {matchDayHeading(first.kickoff_at)}
              </AppText>
            ) : null}
            {group.fixtures.map((fixture) => (
              <FixtureRow key={fixture.id} fixture={fixture} onPress={() => onOpen(fixture.id)} />
            ))}
          </View>
        );
      })}
      {day ? (
        <Pressable onPress={() => setDay(null)} style={styles.more} accessibilityRole="button">
          <AppText variant="label" color="primary">
            Tüm maç günlerini göster
          </AppText>
        </Pressable>
      ) : list.hasNextPage ? (
        <Pressable onPress={() => void list.fetchNextPage()} style={styles.more}>
          {list.isFetchingNextPage ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <AppText variant="label" color="primary">
              Daha fazla maç
            </AppText>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function StandingsSection({
  competitions,
}: {
  competitions: { id: number; season: number; name: string; type: string; has_standings: boolean }[];
}) {
  const [selected, setSelected] = useState(0);
  const comp = competitions[selected] ?? competitions[0] ?? null;
  const standings = useStandings(comp?.id ?? null, comp?.season ?? null, Boolean(comp));
  if (!comp) {
    return <EmptyState icon="podium-outline" title="Puan durumu yok" body="Bu sezon için sağlayıcıda puan tablosu bulunmuyor." />;
  }
  return (
    <View style={styles.list}>
      {competitions.length > 1 ? (
        <View style={styles.chips}>
          {competitions.map((item, index) => (
            <Chip key={`${item.id}-${item.season}`} label={item.name} active={index === selected} onPress={() => setSelected(index)} />
          ))}
        </View>
      ) : null}
      {standings.isLoading ? (
        <PanelLoading />
      ) : standings.isError || !standings.data ? (
        <PanelError onRetry={() => void standings.refetch()} />
      ) : (
        <StandingsTable data={standings.data} />
      )}
    </View>
  );
}

function StandingsTable({ data }: { data: Standings }) {
  const { theme } = useTheme();
  if (data.rows.length === 0) {
    return <EmptyState icon="podium-outline" title="Puan durumu henüz yok" />;
  }
  const groups = new Map<string, typeof data.rows>();
  for (const row of data.rows) {
    const key = row.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    <View style={styles.list}>
      {[...groups.entries()].map(([group, rows]) => (
        <SectionCard key={group || 'main'} title={groups.size > 1 ? group : undefined}>
          <View style={[styles.tableRow, styles.tableHead]}>
            <AppText variant="caption" color="textSecondary" style={styles.cRank}>
              #
            </AppText>
            <AppText variant="caption" color="textSecondary" style={styles.cTeam}>
              Takım
            </AppText>
            {['O', 'G', 'B', 'M', 'Av', 'P'].map((h) => (
              <AppText key={h} variant="caption" color="textSecondary" style={styles.cNum}>
                {h}
              </AppText>
            ))}
          </View>
          {rows.map((row) => {
            const mine = data.primary_team_id != null && row.team_id === data.primary_team_id;
            return (
              <View
                key={`${row.team_id}-${row.rank}`}
                style={[
                  styles.tableRow,
                  { borderTopColor: theme.colors.divider },
                  mine ? { backgroundColor: 'rgba(122,31,61,0.10)' } : null,
                ]}
              >
                <AppText variant="label" style={styles.cRank}>
                  {row.rank}
                </AppText>
                <AppText variant="label" numberOfLines={1} style={[styles.cTeam, mine ? styles.bold : null]}>
                  {row.team_name}
                </AppText>
                {[row.played, row.win, row.draw, row.lose, row.goals_diff, row.points].map((value, index) => (
                  <AppText key={index} variant="label" style={[styles.cNum, index === 5 ? styles.bold : null]}>
                    {value ?? '—'}
                  </AppText>
                ))}
              </View>
            );
          })}
        </SectionCard>
      ))}
      {data.synced_at ? (
        <AppText variant="caption" color="textTertiary" align="center">
          Güncellendi: {relativeAge(data.synced_at)} · Veri: API-Football
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 12, paddingTop: 6, gap: 14, width: '100%', maxWidth: 860, alignSelf: 'center' },
  heroCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 8 },
  standingRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1, gap: 2 },
  form: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  formPill: { minWidth: 22, borderRadius: 6, alignItems: 'center', paddingVertical: 2 },
  formText: { color: '#FFFFFF', fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { gap: 10 },
  dayGroup: { gap: 8, marginTop: 4 },
  more: { alignItems: 'center', paddingVertical: 14 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  tableHead: { borderTopWidth: 0, paddingTop: 0 },
  cRank: { width: 26 },
  cTeam: { flex: 1 },
  cNum: { width: 30, textAlign: 'right', fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '800' },
});
