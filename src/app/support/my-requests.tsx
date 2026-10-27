import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { ReportCard } from '@/features/safety/components/ReportCard';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { TicketCard } from '@/features/safety/components/TicketCard';
import {
  useCloseTicket,
  useMarkNotificationsRead,
} from '@/features/safety/hooks/use-safety-mutations';
import {
  useMyReports,
  useMyTickets,
  useSafetyNotifications,
  useSafetyState,
} from '@/features/safety/hooks/use-safety';
import type { ReportSummary, TicketSummary } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

type Tab = 'tickets' | 'reports' | 'notifications';

const TABS: { key: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'tickets', label: 'Destek Talepleri', icon: 'headset-outline' },
  { key: 'reports', label: 'Bildirimlerim', icon: 'flag-outline' },
  { key: 'notifications', label: 'Bildirimler', icon: 'notifications-outline' },
];

type TicketFilter = 'open' | 'closed' | 'all';

export default function MyRequestsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('tickets');
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>('open');

  const ticketsQuery = useMyTickets();
  const reportsQuery = useMyReports();
  const notificationsQuery = useSafetyNotifications();
  const { data: safety } = useSafetyState();
  const markRead = useMarkNotificationsRead();
  const closeTicketMutation = useCloseTicket();

  const unread = safety?.notifications_unread ?? 0;

  const filteredTickets = useMemo(() => {
    const items = ticketsQuery.data ?? [];
    if (ticketFilter === 'all') {
      return items;
    }
    const isClosed = (ticket: TicketSummary) =>
      ticket.status_code === 'closed' || ticket.status_code === 'resolved';
    return items.filter((ticket) =>
      ticketFilter === 'closed' ? isClosed(ticket) : !isClosed(ticket),
    );
  }, [ticketsQuery.data, ticketFilter]);

  const childReports = useMemo(
    () => (reportsQuery.data ?? []).filter((report: ReportSummary) => report.is_child_safety),
    [reportsQuery.data],
  );

  const refreshing =
    ticketsQuery.isRefetching || reportsQuery.isRefetching || notificationsQuery.isRefetching;

  const refresh = () => {
    void ticketsQuery.refetch();
    void reportsQuery.refetch();
    void notificationsQuery.refetch();
  };

  const closeTicket = (ticketId: string) => {
    closeTicketMutation.mutate(
      { ticketId },
      {
        onSuccess: () => {
          haptics.success();
        },
      },
    );
  };

  return (
    <Screen
      edges={['top', 'left', 'right']}
      scroll
      padded
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <SafetyHeader
        title="Başvurularım"
        subtitle="Taleplerini ve bildirimlerini tek yerden takip et"
        right={
          <Button
            label="Yeni"
            size="sm"
            fullWidth={false}
            onPress={() => router.push('/support/create')}
            leftIcon={<Ionicons name="add" size={15} color="#FFFFFF" />}
            style={{ paddingHorizontal: 14 }}
          />
        }
      />

      <View
        style={[
          styles.tabBar,
          { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.pill },
        ]}
      >
        {TABS.map((item) => {
          const active = tab === item.key;
          const count =
            item.key === 'tickets'
              ? (ticketsQuery.data ?? []).filter(
                  (ticket) => ticket.status_code !== 'closed' && ticket.status_code !== 'resolved',
                ).length
              : item.key === 'reports'
                ? (reportsQuery.data ?? []).length
                : unread;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              onPress={() => {
                haptics.selection();
                setTab(item.key);
              }}
              style={({ pressed }) => [
                styles.tab,
                {
                  backgroundColor: active ? theme.colors.surface : 'transparent',
                  borderRadius: theme.radius.pill,
                  opacity: pressed ? 0.8 : 1,
                },
                active ? theme.shadows.card : null,
              ]}
            >
              <Ionicons
                name={item.icon}
                size={15}
                color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
              <AppText
                variant="caption"
                color={active ? 'primaryDeep' : 'textTertiary'}
                numberOfLines={1}
              >
                {item.label}
              </AppText>
              {count > 0 ? (
                <View
                  style={[
                    styles.tabCount,
                    {
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'primaryDeep' : 'textTertiary'}>
                    {count > 99 ? '99+' : count}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {tab === 'tickets' ? (
        <View style={styles.section}>
          <View style={styles.filterRow}>
            {(
              [
                { key: 'open' as TicketFilter, label: 'Açık' },
                { key: 'closed' as TicketFilter, label: 'Kapanan' },
                { key: 'all' as TicketFilter, label: 'Tümü' },
              ]
            ).map((item) => {
              const active = ticketFilter === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTicketFilter(item.key)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                      borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    },
                  ]}
                >
                  <AppText
                    variant="caption"
                    color={active ? theme.colors.onPrimary : 'textSecondary'}
                  >
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {ticketsQuery.isLoading ? (
            <LoadingBlock />
          ) : ticketsQuery.isError ? (
            <SafetyEmptyState
              icon="cloud-offline-outline"
              title="Talepler yüklenemedi"
              body="Bağlantını kontrol edip tekrar dene."
              actionLabel="Tekrar dene"
              onAction={() => void ticketsQuery.refetch()}
            />
          ) : filteredTickets.length === 0 ? (
            <SafetyEmptyState
              icon="headset-outline"
              title={ticketFilter === 'open' ? 'Açık talebin yok' : 'Kayıt bulunamadı'}
              body="Bir sorun yaşıyorsan destek talebi oluştur; ekibimiz 24 saat içinde yanıtlar."
              actionLabel="Destek talebi oluştur"
              onAction={() => router.push('/support/create')}
            />
          ) : (
            <View style={styles.list}>
              {filteredTickets.map((ticket) => (
                <View key={ticket.id} style={styles.ticketWrap}>
                  <TicketCard
                    ticket={ticket}
                    onPress={() => router.push(`/support/${ticket.id}`)}
                  />
                  {ticket.status_code !== 'closed' && ticket.status_code !== 'resolved' ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${ticket.ticket_no} talebini kapat`}
                      onPress={() => closeTicket(ticket.id)}
                      style={styles.closeLink}
                    >
                      <Ionicons name="checkmark-done-outline" size={13} color={theme.colors.textTertiary} />
                      <AppText variant="caption" color="textTertiary">
                        Talebi kapat
                      </AppText>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {tab === 'reports' ? (
        <View style={styles.section}>
          {childReports.length > 0 ? (
            <Card
              style={styles.childBanner}
              tone="primarySoft"
              elevated={false}
            >
              <View style={styles.childRow}>
                <View style={[styles.childIcon, { backgroundColor: theme.colors.surface }]}>
                  <Ionicons name="shield-half-outline" size={20} color={theme.colors.danger} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" color="danger">
                    {childReports.length} çocuk güvenliği bildirimi
                  </AppText>
                  <AppText variant="caption" color="textSecondary">
                    Öncelikli kuyrukta inceleniyor. Kimliğin gizli tutuluyor.
                  </AppText>
                </View>
              </View>
            </Card>
          ) : null}

          {reportsQuery.isLoading ? (
            <LoadingBlock />
          ) : (reportsQuery.data ?? []).length === 0 ? (
            <SafetyEmptyState
              icon="flag-outline"
              title="Henüz bildirimin yok"
              body="Uygunsuz bir içerik veya davranış gördüğünde ilgili içerikteki “Bildir” seçeneğini kullanabilirsin."
              actionLabel="Bildirim sürecini öğren"
              onAction={() => router.push('/policy/child-safety')}
            />
          ) : (
            <View style={styles.list}>
              {(reportsQuery.data ?? []).map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </View>
          )}

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={14} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" style={styles.flex}>
              Bildirimlerin durum bilgisi inceleme tamamlandıkça güncellenir. Şüpheli bir durum
              gördüğünde beklemene gerek yok, hemen bildir.
            </AppText>
          </View>
        </View>
      ) : null}

      {tab === 'notifications' ? (
        <View style={styles.section}>
          <View style={styles.notifHead}>
            <AppText variant="body" color="textSecondary">
              {unread > 0 ? `${unread} okunmamış bildirim` : 'Tüm bildirimler okundu'}
            </AppText>
            {unread > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tümünü okundu işaretle"
                onPress={() =>
                  markRead.mutate(undefined, { onSuccess: () => haptics.success() })
                }
              >
                <AppText variant="caption" color="primaryDeep">
                  Tümünü okundu işaretle
                </AppText>
              </Pressable>
            ) : null}
          </View>

          {notificationsQuery.isLoading ? (
            <LoadingBlock />
          ) : (notificationsQuery.data ?? []).length === 0 ? (
            <SafetyEmptyState
              icon="notifications-off-outline"
              title="Bildirim yok"
              body="Destek talebine yanıt geldiğinde veya bir bildirimin durumu değiştiğinde burada görünecek."
            />
          ) : (
            <View style={styles.list}>
              {(notificationsQuery.data ?? []).map((notification) => (
                <View
                  key={notification.id}
                  style={[
                    styles.notification,
                    {
                      backgroundColor: notification.read_at
                        ? theme.colors.surface
                        : theme.colors.primarySoft,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                    },
                  ]}
                >
                  <View style={styles.notifTop}>
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {notification.title}
                    </AppText>
                    {!notification.read_at ? (
                      <Badge label="Yeni" tone="primary" />
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textSecondary">
                    {notification.body}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatRelativeTr(notification.created_at)}
                  </AppText>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function LoadingBlock() {
  const { theme } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.colors.primary} />
      <AppText variant="caption" color="textTertiary">
        Yükleniyor…
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabBar: { flexDirection: 'row', padding: 4, gap: 3, marginBottom: 6 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  tabCount: { minWidth: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  section: { gap: 12, marginTop: 10 },
  filterRow: { flexDirection: 'row', gap: 7 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  list: { gap: 10 },
  ticketWrap: { gap: 2 },
  closeLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 4 },
  childBanner: { borderWidth: 1, borderColor: 'transparent' },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  childIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  infoBox: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', paddingTop: 4 },
  notifHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notification: { padding: 13, gap: 5, borderWidth: StyleSheet.hairlineWidth },
  notifTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 40 },
});
