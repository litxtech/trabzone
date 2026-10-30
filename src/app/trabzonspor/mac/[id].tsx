import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, IconButton } from '@/components/ui';
import { loginHref } from '@/features/auth/next-path';
import { matchShareLink } from '@/features/share/links';
import { shareContent } from '@/features/share/share-action';
import { ChatPanel } from '@/features/sports/components/ChatPanel';
import { LineupsPanel } from '@/features/sports/components/LineupsPanel';
import { OverviewPanel } from '@/features/sports/components/OverviewPanel';
import { Scoreboard } from '@/features/sports/components/Scoreboard';
import { MatchCommentComposer, MatchCommentsPanel } from '@/features/sports/components/MatchCommentsPanel';
import { FansPanel, NewsPanel } from '@/features/sports/components/SocialPanels';
import { StatsPanel } from '@/features/sports/components/StatsPanel';
import { TimelinePanel } from '@/features/sports/components/TimelinePanel';
import { EmptyState, PanelError, PanelLoading } from '@/features/sports/components/ui';
import { useFixtureDetail, useFixtureMute, useSportsLiveInvalidation } from '@/features/sports/hooks/use-sports';
import { matchTitle, scoreText, statusLine } from '@/features/sports/utils/format';
import { useKeyboard } from '@/providers/keyboard';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

const TABS = [
  { key: 'comments', label: 'Yorumlar' },
  { key: 'chat', label: 'Canlı Sohbet' },
  { key: 'overview', label: 'Genel Bakış' },
  { key: 'stats', label: 'İstatistikler' },
  { key: 'timeline', label: 'Maç Akışı' },
  { key: 'lineups', label: 'Kadrolar' },
  { key: 'fans', label: 'Taraftarlar' },
  { key: 'news', label: 'Haberler' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function isTab(value: unknown): value is TabKey {
  return typeof value === 'string' && TABS.some((tab) => tab.key === value);
}

function parseFixtureId(raw: unknown): number {
  const text = String(raw ?? '').trim();
  return /^-?[1-9][0-9]{0,11}$/.test(text) ? Number(text) : 0;
}

export default function MatchArenaScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const session = useSession();
  const params = useLocalSearchParams<{ id?: string; tab?: string; comment?: string }>();
  const fixtureId = parseFixtureId(params.id);
  const [chosenTab, setTab] = useState<TabKey | null>(
    isTab(params.tab) ? params.tab : typeof params.comment === 'string' ? 'comments' : null,
  );
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const commentInputRef = useRef<ComponentRef<typeof TextInput>>(null);

  // Yazarken alan klavyenin altında kalmasın: sohbet ve yorum alanı ekranın
  // altına yapışık durur, klavye açılınca birlikte yukarı kayar.
  const keyboard = useKeyboard();
  const insets = useSafeAreaInsets();
  const keyboardStyle = useAnimatedStyle(() => ({ paddingBottom: keyboard.height.value }));

  useSportsLiveInvalidation(true);
  const detail = useFixtureDetail(fixtureId);
  const fixture = detail.data?.fixture ?? null;
  // Yorumlaşma ön planda: arena yorum kartıyla karşılanır, sohbet ikinci sekmede.
  const tab: TabKey = chosenTab ?? 'comments';

  const title = fixture ? matchTitle(fixture) : 'Trabzonspor Maç Arenası';
  const description = fixture
    ? `${title} ${fixture.status.phase === 'scheduled' ? '' : `${scoreText(fixture.goals.home)}-${scoreText(fixture.goals.away)} `}· ${statusLine(fixture)} · ${fixture.league.name ?? ''}. Canlı skor, istatistik, kadrolar ve taraftar sohbeti Trabzone'da.`
    : 'Trabzonspor maçlarını Trabzone Maç Arenası’nda canlı takip et.';
  useWebMeta({
    title: `${title} | Trabzone Maç Arenası`,
    description,
    path: `/trabzonspor/mac/${fixtureId}`,
    noIndex: !fixture || fixture.is_test,
  });

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/trabzonspor' as never);
  }, [router]);

  const share = useCallback(() => {
    if (!fixture) return;
    void shareContent({
      title,
      message: `${title} · ${statusLine(fixture)}`,
      url: matchShareLink(fixture.id),
    });
  }, [fixture, title]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await detail.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [detail]);

  const focusComposer = useCallback(() => commentInputRef.current?.focus(), []);

  const body = useMemo(() => {
    if (!detail.data) return null;
    const data = detail.data;
    const f = data.fixture;
    switch (tab) {
      case 'overview':
        return <OverviewPanel detail={data} />;
      case 'stats':
        return <StatsPanel fixture={f} />;
      case 'timeline':
        return <TimelinePanel fixture={f} />;
      case 'lineups':
        return <LineupsPanel fixture={f} photosAllowed={data.rights.player_photos} />;
      case 'comments':
        return (
          <MatchCommentsPanel
            fixture={f}
            activeUsers={data.chat?.active_users ?? null}
            initialOpen={typeof params.comment === 'string'}
            onCompose={focusComposer}
          />
        );
      case 'fans':
        return <FansPanel fixture={f} />;
      case 'news':
        return <NewsPanel fixture={f} />;
      default:
        return null;
    }
  }, [detail.data, focusComposer, params.comment, tab]);

  const notFound =
    detail.error && ((detail.error as { code?: string }).code === 'not_found' || /not_found|bulunamad/i.test(String(detail.error.message)));

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <Animated.View style={[styles.frame, Platform.OS === 'web' ? styles.webFrame : null, keyboardStyle]}>
        <View style={styles.header}>
          <IconButton name="chevron-back" size={22} accessibilityLabel="Geri" onPress={goBack} />
          <View style={styles.headerText}>
            <AppText variant="label" numberOfLines={1} accessibilityRole="header">
              {fixture ? title : 'Maç Arenası'}
            </AppText>
            {fixture ? (
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {statusLine(fixture)}
              </AppText>
            ) : null}
          </View>
          {fixture ? (
            <>
              <IconButton
                name="notifications-outline"
                size={21}
                accessibilityLabel="Maç bildirim ayarları"
                onPress={() => setNotifyOpen(true)}
              />
              <IconButton name="share-outline" size={21} accessibilityLabel="Maçı paylaş" onPress={share} />
            </>
          ) : null}
        </View>

        {detail.isLoading ? (
          <PanelLoading />
        ) : notFound ? (
          <EmptyState icon="football-outline" title="Maç bulunamadı" body="Bağlantı eski olabilir veya maç kaldırılmış olabilir." />
        ) : detail.isError || !detail.data || !fixture ? (
          <PanelError onRetry={() => void detail.refetch()} />
        ) : (
          <>
            <Scoreboard fixture={fixture} lastEvent={detail.data.last_event} compact={tab === 'chat'} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tabBar}
              contentContainerStyle={styles.tabBarContent}
            >
              {TABS.map((item) => {
                const active = item.key === tab;
                const live = item.key === 'chat' && detail.data?.chat.state === 'open';
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setTab(item.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.tab,
                      { backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted },
                    ]}
                  >
                    {live ? <View style={styles.liveDot} /> : null}
                    <AppText variant="label" style={{ color: active ? theme.colors.onPrimary : theme.colors.text }}>
                      {item.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {tab === 'chat' ? (
              <View style={styles.flex}>
                <ChatPanel fixture={fixture} active />
              </View>
            ) : tab === 'comments' ? (
              <View style={styles.flex}>
                <ScrollView
                  style={styles.flex}
                  contentContainerStyle={styles.content}
                  keyboardShouldPersistTaps="handled"
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
                >
                  {body}
                </ScrollView>
                {/* Yorum alanı klavyeye yapışık: kaydırılan akışın altında sabit durur. */}
                <View style={{ paddingBottom: keyboard.isVisible ? 0 : insets.bottom }}>
                  <MatchCommentComposer fixture={fixture} inputRef={commentInputRef} />
                </View>
              </View>
            ) : (
              <ScrollView
                style={styles.flex}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
              >
                {body}
              </ScrollView>
            )}
          </>
        )}
      </Animated.View>

      {fixture ? (
        <NotificationSheet
          visible={notifyOpen}
          fixtureId={fixture.id}
          signedIn={Boolean(session?.user)}
          onClose={() => setNotifyOpen(false)}
          onOpenSettings={() => {
            setNotifyOpen(false);
            router.push(session?.user ? ('/trabzonspor/bildirimler' as never) : loginHref(`/trabzonspor/mac/${fixture.id}`));
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function NotificationSheet({
  visible,
  fixtureId,
  signedIn,
  onClose,
  onOpenSettings,
}: {
  visible: boolean;
  fixtureId: number;
  signedIn: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { theme } = useTheme();
  const { query, mutation } = useFixtureMute(fixtureId, visible && signedIn);
  const muted = mutation.isPending ? Boolean(mutation.variables) : Boolean(query.data?.muted);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Kapat">
        <Pressable style={[styles.sheet, { backgroundColor: theme.colors.surface }]} onPress={() => undefined}>
          <AppText variant="h3">Maç bildirimleri</AppText>
          {signedIn ? (
            <>
              <View style={styles.sheetRow}>
                <View style={styles.flex}>
                  <AppText variant="label">Bu maçın bildirimlerini sessize al</AppText>
                  <AppText variant="caption" color="textSecondary">
                    Gol, kart ve sonuç bildirimleri yalnızca bu maç için durdurulur.
                  </AppText>
                </View>
                <Switch
                  value={muted}
                  disabled={query.isLoading || mutation.isPending}
                  onValueChange={(value) => mutation.mutate(value)}
                  trackColor={{ true: theme.colors.primary }}
                />
              </View>
              {mutation.isError ? (
                <AppText variant="caption" color="danger">
                  Ayar kaydedilemedi. Tekrar dene.
                </AppText>
              ) : null}
            </>
          ) : (
            <AppText variant="body" color="textSecondary">
              Maç bildirimleri için giriş yapman ve bildirim iznini vermen gerekir.
            </AppText>
          )}
          <Pressable
            onPress={onOpenSettings}
            style={[styles.sheetButton, { backgroundColor: theme.colors.primary }]}
            accessibilityRole="button"
          >
            <Ionicons name={signedIn ? 'options-outline' : 'log-in-outline'} size={16} color={theme.colors.onPrimary} />
            <AppText variant="label" color="onPrimary">
              {signedIn ? 'Tüm Trabzonspor bildirim tercihleri' : 'Giriş yap'}
            </AppText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  frame: { flex: 1 },
  webFrame: { width: '100%', maxWidth: 820, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6 },
  headerText: { flex: 1, paddingHorizontal: 4 },
  tabBar: { flexGrow: 0, marginTop: 10 },
  tabBarContent: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF4D5E' },
  content: { padding: 12, paddingBottom: 48, gap: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34, gap: 14 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
  },
});
