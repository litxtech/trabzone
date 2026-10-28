import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Card, Screen, ScreenHeader, Skeleton } from '@/components/ui';
import {
  useCancelFriendRequest,
  useFriendRequests,
  useRespondFriendRequest,
} from '@/features/profile/hooks/use-friend-requests';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import type { FriendRequestItem } from '@/features/profile/services/social-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

export default function FriendsScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const { data, isLoading, isError, refetch, isFetching } = useFriendRequests();
  const respond = useRespondFriendRequest();
  const cancel = useCancelFriendRequest();
  const [error, setError] = useState<string | null>(null);

  const incoming = (data ?? []).filter((item) => item.direction === 'in');
  const outgoing = (data ?? []).filter((item) => item.direction === 'out');

  const onRespond = (item: FriendRequestItem, action: 'accepted' | 'rejected') => {
    setError(null);
    respond.mutate(
      { requestId: item.id, action },
      {
        onSuccess: () => (action === 'accepted' ? haptics.success() : haptics.selection()),
        onError: (mutationError) => {
          haptics.error();
          setError(mutationError.message);
        },
      },
    );
  };

  const onCancel = (item: FriendRequestItem) => {
    setError(null);
    cancel.mutate(item.id, {
      onSuccess: () => haptics.selection(),
      onError: (mutationError) => {
        haptics.error();
        setError(mutationError.message);
      },
    });
  };

  return (
    <Screen
      edges={['top', 'left', 'right']}
      scroll
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={() => void refetch()}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <ScreenHeader
        title="Arkadaşlıklar"
        subtitle={
          incoming.length > 0
            ? `${incoming.length} bekleyen istek`
            : 'Gelen ve giden istekler'
        }
        onBack={() => router.back()}
      />

      {isLoading ? (
        <View style={styles.skeleton}>
          <Skeleton height={72} radius={18} />
          <Skeleton height={72} radius={18} />
        </View>
      ) : isError ? (
        <Card style={styles.stateCard}>
          <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
          <AppText variant="bodyStrong">İstekler yüklenemedi</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            onPress={() => void refetch()}
            style={[styles.retry, { backgroundColor: theme.colors.primarySoft }]}
          >
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </Card>
      ) : (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <AppText variant="h3">Gelen istekler</AppText>
              {respond.isPending ? (
                <ActivityIndicator size="small" color={theme.colors.textTertiary} />
              ) : null}
            </View>

            {incoming.length === 0 ? (
              <Card tone="muted" elevated={false} style={styles.emptyCard}>
                <Ionicons name="mail-open-outline" size={24} color={theme.colors.textTertiary} />
                <AppText variant="body" color="textSecondary" align="center">
                  Şu an bekleyen arkadaşlık isteğin yok.
                </AppText>
              </Card>
            ) : (
              <Card padding={0} style={styles.listCard}>
                {incoming.map((item, index) => (
                  <RequestRow
                    key={item.id}
                    item={item}
                    last={index === incoming.length - 1}
                    busy={respond.isPending}
                    onOpen={() => router.push(`/profile/${item.username}` as never)}
                    primary={{ label: 'Kabul et', onPress: () => onRespond(item, 'accepted') }}
                    secondary={{ label: 'Reddet', onPress: () => onRespond(item, 'rejected') }}
                  />
                ))}
              </Card>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <AppText variant="h3">Gönderdiğin istekler</AppText>
              {cancel.isPending ? (
                <ActivityIndicator size="small" color={theme.colors.textTertiary} />
              ) : null}
            </View>

            {outgoing.length === 0 ? (
              <Card tone="muted" elevated={false} style={styles.emptyCard}>
                <Ionicons name="paper-plane-outline" size={24} color={theme.colors.textTertiary} />
                <AppText variant="body" color="textSecondary" align="center">
                  Bekleyen bir isteğin yok. Topluluktan yeni kişiler ekleyebilirsin.
                </AppText>
              </Card>
            ) : (
              <Card padding={0} style={styles.listCard}>
                {outgoing.map((item, index) => (
                  <RequestRow
                    key={item.id}
                    item={item}
                    last={index === outgoing.length - 1}
                    busy={cancel.isPending}
                    onOpen={() => router.push(`/profile/${item.username}` as never)}
                    secondary={{ label: 'İptal et', onPress: () => onCancel(item) }}
                  />
                ))}
              </Card>
            )}
          </View>

          {error ? (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yeni kişiler keşfet"
            onPress={() => router.push('/feed')}
            style={({ pressed }) => [
              styles.discover,
              {
                backgroundColor: theme.colors.primarySoft,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="people-outline" size={17} color={theme.colors.primaryDeep} />
            <AppText variant="label" color="primaryDeep" style={styles.flex}>
              Yeni kişiler keşfet
            </AppText>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.primaryDeep} />
          </Pressable>
        </>
      )}
    </Screen>
  );
}

function RequestRow({
  item,
  last,
  busy,
  primary,
  secondary,
  onOpen,
}: {
  item: FriendRequestItem;
  last: boolean;
  busy: boolean;
  primary?: { label: string; onPress: () => void };
  secondary: { label: string; onPress: () => void };
  onOpen: () => void;
}) {
  const { theme } = useTheme();
  const name = `${item.first_name} ${item.last_name}`.trim();

  return (
    <View
      style={[
        styles.row,
        {
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} profilini aç`}
        onPress={onOpen}
        style={styles.person}
      >
        <Avatar uri={mediaPublicUrl('avatar', item.avatar_path)} name={name} size={44} />
        <View style={styles.personText}>
          <View style={styles.nameRow}>
            <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
              {name}
            </AppText>
            {item.is_verified ? (
              <Ionicons name="checkmark-circle" size={14} color={theme.colors.primary} />
            ) : null}
          </View>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            @{item.username} · {formatWhen(item.created_at)}
          </AppText>
        </View>
      </Pressable>

      <View style={styles.rowActions}>
        {primary ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${name} için ${primary.label}`}
            disabled={busy}
            onPress={primary.onPress}
            style={({ pressed }) => [
              styles.pillPrimary,
              { backgroundColor: theme.colors.primary, opacity: pressed || busy ? 0.6 : 1 },
            ]}
          >
            <AppText variant="caption" color="onPrimary">
              {primary.label}
            </AppText>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name} için ${secondary.label}`}
          disabled={busy}
          onPress={secondary.onPress}
          style={({ pressed }) => [
            styles.pillSecondary,
            {
              borderColor: theme.colors.borderStrong,
              opacity: pressed || busy ? 0.6 : 1,
            },
          ]}
        >
          <AppText variant="caption" color="textSecondary">
            {secondary.label}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skeleton: { gap: 10, paddingTop: 6 },
  stateCard: { alignItems: 'center', gap: 10, marginTop: 16 },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  section: { gap: 8, marginTop: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 22, borderWidth: 0 },
  listCard: { overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexWrap: 'wrap',
  },
  person: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1, minWidth: 160 },
  personText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pillPrimary: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    minHeight: 32,
    justifyContent: 'center',
  },
  pillSecondary: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 16,
  },
  discover: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    marginTop: 18,
  },
});
