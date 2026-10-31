import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Avatar, Button, Screen, ScreenHeader, Skeleton } from '@/components/ui';
import {
  useDeleteNotifications,
  useMarkNotificationsRead,
  useNotificationRealtime,
  useNotifications,
  useUnreadNotifications,
} from '@/features/notifications/hooks/use-notifications';
import { currentPermission, registerForPush } from '@/features/notifications/push/push-registration';
import {
  notificationQueryKeys,
  type AppNotification,
  type NotificationKind,
} from '@/features/notifications/services/notifications-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

const ICONS: Record<NotificationKind, React.ComponentProps<typeof Ionicons>['name']> = {
  follow: 'person-add-outline',
  like: 'heart-outline',
  comment: 'chatbubble-outline',
  message: 'chatbubbles-outline',
  group_invite: 'people-outline',
  order: 'bag-check-outline',
  market_message: 'storefront-outline',
  support: 'headset-outline',
  security: 'shield-checkmark-outline',
  system: 'information-circle-outline',
  mention: 'at-outline',
  earthquake: 'pulse-outline',
  sports: 'football-outline',
  ride: 'car-outline',
  pharmacy: 'medkit-outline',
};

/** Sunucudan yeni bir tür gelirse simge boş kalmasın. */
function iconFor(kind: NotificationKind): React.ComponentProps<typeof Ionicons>['name'] {
  return ICONS[kind] ?? 'notifications-outline';
}

const COLORS: Partial<Record<NotificationKind, 'primary' | 'danger' | 'accent' | 'success'>> = {
  like: 'danger',
  message: 'primary',
  order: 'success',
  group_invite: 'accent',
};

type Permission = Awaited<ReturnType<typeof currentPermission>>;

function targetFor(notification: AppNotification): string | null {
  // Eski emlak alarmlarında yanlışlıkla "/real-estate/:id" yazılmış olabilir;
  // entity türü, route alanından daha güvenilir bir hedef verir.
  if (notification.entity_type === 'real_estate_listing' && notification.entity_id) {
    return `/marketplace/real-estate/${notification.entity_id}`;
  }
  const route = notification.route?.trim();
  if (route && route.startsWith('/')) {
    return route;
  }
  if (notification.entity_type === 'post' && notification.entity_id) {
    return `/post/${notification.entity_id}`;
  }
  if (notification.entity_type === 'conversation' && notification.entity_id) {
    return `/chat/${notification.entity_id}`;
  }
  if (notification.entity_type === 'order') {
    return '/marketplace/orders';
  }
  if (notification.actor_username) {
    return `/profile/${notification.actor_username}`;
  }
  return null;
}

export default function NotificationsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  useNotificationRealtime();

  const notifications = useNotifications();
  const unread = useUnreadNotifications();
  const markRead = useMarkNotificationsRead();
  const remove = useDeleteNotifications();
  const [menuFor, setMenuFor] = useState<AppNotification | null>(null);

  // Rozet, PushBridge tarafından okunmamış sayısıyla sürekli eşitlenir; bu
  // ekranı açmak tek başına bildirimleri okundu yapmaz.

  // Bildirim izni hiç istenmediyse bu ekran doğal karşılama noktasıdır.
  const [permission, setPermission] = useState<Permission>('undetermined');
  useEffect(() => {
    let alive = true;
    void currentPermission().then((value) => {
      if (alive) setPermission(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const enablePush = async () => {
    haptics.tap();
    await registerForPush({ prompt: true });
    const next = await currentPermission();
    setPermission(next);
    if (next === 'granted') {
      await queryClient.invalidateQueries({ queryKey: notificationQueryKeys.prefs });
    }
  };

  const [bulkMenu, setBulkMenu] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const items = notifications.data?.items ?? [];
  const hasUnread = Boolean(unread.data && unread.data > 0);

  const openMenu = (notification: AppNotification) => {
    haptics.tap();
    setMenuFor(notification);
  };

  const openNotification = useCallback(
    (notification: AppNotification) => {
      haptics.tap();
      if (!notification.read_at) {
        markRead.mutate([notification.id]);
      }
      const target = targetFor(notification);
      if (target) {
        router.push(target as never);
      }
    },
    [markRead, router],
  );

  return (
    <Screen
      edges={['top', 'left', 'right']}
      scroll
      refreshControl={
        <RefreshControl
          refreshing={notifications.isRefetching}
          onRefresh={() => void notifications.refetch()}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <ScreenHeader
        title="Bildirimler"
        subtitle={unread.data && unread.data > 0 ? `${unread.data} okunmamış` : 'Tümü okundu'}
        onBack={() => router.back()}
        right={
          items.length > 0 ? (
            <View style={styles.headerActions}>
              {hasUnread ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tümünü okundu işaretle"
                  onPress={() => markRead.mutate(undefined)}
                  style={({ pressed }) => [styles.markAll, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <AppText variant="label" color="primaryDeep">
                    Tümünü oku
                  </AppText>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Bildirim seçenekleri"
                hitSlop={8}
                onPress={() => setBulkMenu(true)}
                style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.text} />
              </Pressable>
            </View>
          ) : undefined
        }
      />

      {permission === 'undetermined' ? (
        <View style={[styles.pushBanner, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="notifications-outline" size={18} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Bu cihazda anlık bildirimler kapalı. Beğeni, yorum ve mesajları kaçırmamak için aç.
          </AppText>
          <Button label="Aç" size="sm" onPress={() => void enablePush()} />
        </View>
      ) : null}

      {remove.isError ? (
        <View style={[styles.errorBar, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            Bildirim silinemedi. Bağlantını kontrol edip tekrar dene.
          </AppText>
        </View>
      ) : null}

      {notifications.isLoading ? (
        <View style={styles.skeletons}>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} height={66} radius={18} />
          ))}
        </View>
      ) : notifications.isError ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={30} color={theme.colors.textSecondary} />
          <AppText variant="body" color="textSecondary" align="center">
            Bildirimler yüklenemedi.
          </AppText>
          <Button
            label="Tekrar dene"
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => void notifications.refetch()}
          />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="notifications-outline" size={26} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="h3" align="center">
            Bildirim yok
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Yeni takipçi, beğeni, yorum ve mesajlar burada görünecek.
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((notification) => {
            const name = notification.actor_username
              ? `${notification.actor_first_name ?? ''} ${notification.actor_last_name ?? ''}`.trim() ||
                notification.actor_username
              : null;
            const accentColor = theme.colors[COLORS[notification.kind] ?? 'primary'];
            const unreadItem = !notification.read_at;

            return (
              <Pressable
                key={notification.id}
                accessibilityRole="button"
                accessibilityLabel={notification.title}
                accessibilityHint="Seçenekler için basılı tutun"
                onPress={() => openNotification(notification)}
                onLongPress={() => openMenu(notification)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: unreadItem ? theme.colors.primarySoft : theme.colors.surface,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                {notification.actor_avatar_path ? (
                  <Avatar
                    uri={mediaPublicUrl('avatar', notification.actor_avatar_path)}
                    name={name ?? undefined}
                    size={42}
                  />
                ) : (
                  <View style={[styles.icon, { backgroundColor: theme.colors.surfaceMuted }]}>
                    <Ionicons name={iconFor(notification.kind)} size={19} color={accentColor} />
                  </View>
                )}

                <View style={styles.rowText}>
                  <AppText variant="bodyStrong" numberOfLines={2}>
                    {notification.title}
                  </AppText>
                  {notification.body ? (
                    <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                      {notification.body}
                    </AppText>
                  ) : null}
                  <AppText variant="caption" color="textTertiary">
                    {formatRelativeTr(notification.created_at)}
                  </AppText>
                </View>

                {unreadItem ? (
                  <View style={[styles.unreadDot, { backgroundColor: theme.colors.primary }]} />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bildirim seçenekleri"
                  hitSlop={6}
                  onPress={() => openMenu(notification)}
                  style={({ pressed }) => [styles.rowMenu, { opacity: pressed ? 0.5 : 1 }]}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textTertiary} />
                </Pressable>
              </Pressable>
            );
          })}
        </View>
      )}

      {markRead.isPending || remove.isPending ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.busy} />
      ) : null}

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.title}
        items={[
          ...(menuFor && !menuFor.read_at
            ? [{ key: 'read', label: 'Okundu işaretle', icon: 'checkmark-done-outline' as const }]
            : []),
          { key: 'delete', label: 'Bildirimi sil', icon: 'trash-outline', destructive: true },
        ]}
        onClose={() => setMenuFor(null)}
        onSelect={(key) => {
          const target = menuFor;
          setMenuFor(null);
          if (!target) return;
          if (key === 'read') {
            markRead.mutate([target.id]);
          } else if (key === 'delete') {
            haptics.tap();
            remove.mutate([target.id]);
          }
        }}
      />

      <ActionSheet
        visible={bulkMenu}
        title="Bildirimler"
        items={[
          ...(hasUnread
            ? [{ key: 'read-all', label: 'Tümünü okundu işaretle', icon: 'checkmark-done-outline' as const }]
            : []),
          { key: 'delete-all', label: 'Tüm bildirimleri sil', icon: 'trash-outline', destructive: true },
        ]}
        onClose={() => setBulkMenu(false)}
        onSelect={(key) => {
          setBulkMenu(false);
          if (key === 'read-all') {
            markRead.mutate(undefined);
          } else if (key === 'delete-all') {
            setConfirmClear(true);
          }
        }}
      />

      <ActionSheet
        visible={confirmClear}
        title="Tüm bildirimler silinsin mi?"
        message="Bu işlem geri alınamaz."
        items={[{ key: 'confirm', label: 'Tümünü sil', icon: 'trash-outline', destructive: true }]}
        onClose={() => setConfirmClear(false)}
        onSelect={() => {
          setConfirmClear(false);
          haptics.tap();
          remove.mutate(undefined);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  markAll: { paddingHorizontal: 8, paddingVertical: 6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  rowMenu: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  pushBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    marginTop: 8,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 6,
  },
  flex: { flex: 1 },
  list: { gap: 8, paddingTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4 },
  empty: { paddingVertical: 46, alignItems: 'center', gap: 9 },
  emptyIcon: { width: 54, height: 54, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  skeletons: { gap: 9, paddingTop: 8 },
  busy: { paddingVertical: 16 },
});
