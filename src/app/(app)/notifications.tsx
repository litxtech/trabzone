import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button, Screen, ScreenHeader, Skeleton } from '@/components/ui';
import {
  useMarkNotificationsRead,
  useNotificationRealtime,
  useNotifications,
  useUnreadNotifications,
} from '@/features/notifications/hooks/use-notifications';
import type { AppNotification, NotificationKind } from '@/features/notifications/services/notifications-service';
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
};

const COLORS: Partial<Record<NotificationKind, 'primary' | 'danger' | 'accent' | 'success'>> = {
  like: 'danger',
  message: 'primary',
  order: 'success',
  group_invite: 'accent',
};

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
  useNotificationRealtime();

  const notifications = useNotifications();
  const unread = useUnreadNotifications();
  const markRead = useMarkNotificationsRead();

  const items = notifications.data?.items ?? [];

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
          unread.data && unread.data > 0 ? (
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
          ) : undefined
        }
      />

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
                onPress={() => openNotification(notification)}
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
                    <Ionicons name={ICONS[notification.kind]} size={19} color={accentColor} />
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
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {markRead.isPending ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.busy} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  markAll: { paddingHorizontal: 8, paddingVertical: 6 },
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
