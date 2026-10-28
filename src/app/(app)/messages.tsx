import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from '@/utils/router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import {
  ActionSheet,
  AppText,
  Avatar,
  IconButton,
  Screen,
  Skeleton,
  TextField,
} from '@/components/ui';
import { useDrawer } from '@/features/navigation/drawer-context';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { NewChatSheet } from '@/features/messaging/components/NewChatSheet';
import {
  useConversationListRealtime,
  useConversations,
  useLeaveConversation,
  useMuteConversation,
} from '@/features/messaging/hooks/use-chat';
import type { Conversation } from '@/features/messaging/services/messaging-service';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatShortDateTr, formatTimeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

export default function MessagesScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { open: openDrawer } = useDrawer();
  const session = useSession();
  const myId = session?.user?.id ?? null;

  const { data: profile } = useMyProfile();
  const conversations = useConversations();
  useConversationListRealtime();

  const [query, setQuery] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<'direct' | 'group'>('direct');
  const [actionOpen, setActionOpen] = useState(false);
  const [menuTarget, setMenuTarget] = useState<Conversation | null>(null);

  const mute = useMuteConversation();
  const leave = useLeaveConversation();

  const items = useMemo(() => {
    const list = conversations.data ?? [];
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    if (!needle) {
      return list;
    }
    return list.filter((conversation) =>
      `${conversation.title} ${conversation.last_message_preview ?? ''} ${conversation.peer_username ?? ''}`
        .toLocaleLowerCase('tr-TR')
        .includes(needle),
    );
  }, [conversations.data, query]);

  const unreadTotal = useMemo(
    () => (conversations.data ?? []).reduce((total, item) => total + item.unread_count, 0),
    [conversations.data],
  );

  const openConversation = useCallback(
    (id: string) => {
      setComposerOpen(false);
      router.push(`/chat/${id}` as never);
    },
    [router],
  );

  const openComposer = (mode: 'direct' | 'group') => {
    haptics.tap();
    setComposerMode(mode);
    setComposerOpen(true);
  };

  const openMenu = useCallback((conversation: Conversation) => {
    haptics.press();
    setMenuTarget(conversation);
    setActionOpen(true);
  }, []);

  const confirmLeave = () => {
    if (!menuTarget) {
      return;
    }
    const target = menuTarget;
    setActionOpen(false);
    Alert.alert(
      target.kind === 'group' ? 'Gruptan ayrıl' : 'Sohbeti kapat',
      target.kind === 'group'
        ? `"${target.title}" grubundan ayrılmak istiyor musun?`
        : 'Bu sohbet listeden kaldırılacak. Yeni mesaj gelirse yeniden görünür.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Ayrıl',
          style: 'destructive',
          onPress: () =>
            leave.mutate(target.id, {
              onSuccess: () => haptics.success(),
              onError: (error) => Alert.alert('İşlem tamamlanamadı', error.message),
            }),
        },
      ],
    );
  };

  const renderConversation = useCallback(
    ({ item }: { item: Conversation }) => {
      const unread = item.unread_count > 0;
      const preview =
        item.last_message_preview ??
        (item.kind === 'group' ? 'Grup oluşturuldu' : 'Sohbeti başlat');
      const isMine = item.last_message_sender_id === myId;

      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.title} sohbetini aç${unread ? `, ${item.unread_count} okunmamış` : ''}`}
          onPress={() => router.push(`/chat/${item.id}` as never)}
          onLongPress={() => openMenu(item)}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' },
          ]}
        >
          <View>
            <Avatar
              uri={mediaPublicUrl('avatar', item.avatar_path)}
              name={item.title}
              size={54}
              recycleKey={item.id}
            />
            {item.kind === 'group' ? (
              <View
                style={[
                  styles.groupBadge,
                  {
                    backgroundColor: theme.colors.primaryDeep,
                    borderColor: theme.colors.background,
                  },
                ]}
              >
                <Ionicons name="people" size={10} color={theme.colors.onPrimary} />
              </View>
            ) : null}
          </View>

          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                {item.title}
              </AppText>
              <AppText variant="caption" color={unread ? 'primaryDeep' : 'textTertiary'}>
                {formatConversationTime(item.last_message_at)}
              </AppText>
            </View>

            <View style={styles.rowBottom}>
              <AppText
                variant="caption"
                color={unread ? 'text' : 'textSecondary'}
                numberOfLines={1}
                style={styles.flex}
              >
                {isMine ? 'Sen: ' : ''}
                {preview}
              </AppText>

              {item.is_muted ? (
                <Ionicons
                  name="notifications-off-outline"
                  size={14}
                  color={theme.colors.textTertiary}
                />
              ) : null}

              {unread ? (
                <View style={[styles.unread, { backgroundColor: theme.colors.primary }]}>
                  <AppText variant="caption" color="onPrimary" style={styles.unreadText}>
                    {item.unread_count > 99 ? '99+' : item.unread_count}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [myId, openMenu, router, theme.colors],
  );

  const listEmpty = conversations.isLoading ? (
    <View style={styles.skeletons}>
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <View key={key} style={styles.skeletonRow}>
          <Skeleton height={54} width={54} radius={27} />
          <View style={styles.skeletonText}>
            <Skeleton height={12} width="55%" radius={4} />
            <Skeleton height={10} width="80%" radius={4} />
          </View>
        </View>
      ))}
    </View>
  ) : conversations.isError ? (
    <View style={styles.state}>
      <Ionicons name="cloud-offline-outline" size={30} color={theme.colors.textSecondary} />
      <AppText variant="h3" align="center">
        Mesajlar yüklenemedi
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        Bağlantını kontrol edip tekrar dene.
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tekrar dene"
        onPress={() => void conversations.refetch()}
        style={({ pressed }) => [
          styles.stateButton,
          { backgroundColor: theme.colors.primarySoft, opacity: pressed ? 0.75 : 1 },
        ]}
      >
        <AppText variant="label" color="primaryDeep">
          Tekrar dene
        </AppText>
      </Pressable>
    </View>
  ) : query.trim() ? (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name="search-outline" size={24} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="bodyStrong" align="center">
        Eşleşen sohbet yok
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        &quot;{query.trim()}&quot; için sonuç bulunamadı.
      </AppText>
    </View>
  ) : (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name="chatbubbles-outline" size={26} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="h3" align="center">
        Henüz sohbet yok
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        Bir kişiyle birebir sohbet başlat ya da grup oluştur.
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Yeni sohbet başlat"
        onPress={() => openComposer('direct')}
        style={({ pressed }) => [
          styles.stateButton,
          { backgroundColor: theme.colors.primary, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="create-outline" size={16} color={theme.colors.onPrimary} />
        <AppText variant="label" color="onPrimary">
          Yeni sohbet
        </AppText>
      </Pressable>
    </View>
  );

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.header}>
        <IconButton
          name="menu"
          accessibilityLabel="Menüyü aç"
          variant="surface"
          size={20}
          onPress={() => openDrawer('main')}
        />

        <View style={styles.headerTitles}>
          <AppText variant="h2">Mesajlar</AppText>
          <AppText variant="caption" color="textTertiary">
            {unreadTotal > 0
              ? `${unreadTotal} okunmamış mesaj`
              : items.length > 0
                ? `${items.length} sohbet`
                : 'Bağlantılarını buradan sürdür'}
          </AppText>
        </View>

        <View style={styles.headerActions}>
          <IconButton
            name="people-outline"
            accessibilityLabel="Yeni grup oluştur"
            variant="surface"
            size={19}
            onPress={() => openComposer('group')}
          />
          <IconButton
            name="create-outline"
            accessibilityLabel="Yeni sohbet başlat"
            variant="surface"
            size={20}
            onPress={() => openComposer('direct')}
          />
        </View>
      </View>

      <View style={styles.searchWrap}>
        <TextField
          placeholder="Sohbetlerde ara"
          value={query}
          onChangeText={setQuery}
          leftIcon="search-outline"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          rightSlot={
            query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
                onPress={() => setQuery('')}
              >
                <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ) : null
          }
        />
      </View>

      <FlashList
        keyboardShouldPersistTaps="handled"
        data={items}
        renderItem={renderConversation}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={conversations.isRefetching}
            onRefresh={() => void conversations.refetch()}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          items.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Profilime git"
              onPress={() => router.navigate('/profile')}
              style={({ pressed }) => [styles.selfRow, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Avatar
                uri={mediaPublicUrl('avatar', profile?.avatar_path)}
                name={profile ? `${profile.first_name} ${profile.last_name}` : undefined}
                size={38}
                recycleKey={profile?.id ?? 'self'}
              />
              <AppText variant="caption" color="textTertiary" style={styles.flex}>
                Profilim · @{profile?.username ?? 'sen'}
              </AppText>
              <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
            </Pressable>
          ) : null
        }
        ListFooterComponent={
          items.length > 0 ? (
            <View style={styles.footer}>
              <Ionicons name="lock-closed-outline" size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary" align="center">
                Sohbetler yalnızca üyeler tarafından okunabilir.
              </AppText>
            </View>
          ) : null
        }
      />

      {conversations.isFetching && !conversations.isLoading ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.busy} />
      ) : null}

      <NewChatSheet
        visible={composerOpen}
        initialMode={composerMode}
        onClose={() => setComposerOpen(false)}
        onOpenConversation={openConversation}
      />

      <ActionSheet
        visible={actionOpen}
        title={menuTarget?.title}
        items={[
          {
            key: 'mute',
            label: menuTarget?.is_muted ? 'Bildirimleri aç' : 'Bildirimleri sessize al',
            icon: menuTarget?.is_muted ? 'notifications-outline' : 'notifications-off-outline',
          },
          {
            key: 'leave',
            label: menuTarget?.kind === 'group' ? 'Gruptan ayrıl' : 'Sohbeti kapat',
            icon: 'exit-outline',
            destructive: true,
          },
        ]}
        onClose={() => setActionOpen(false)}
        onSelect={(key) => {
          if (!menuTarget) {
            return;
          }
          if (key === 'mute') {
            const target = menuTarget;
            setActionOpen(false);
            mute.mutate(
              { conversationId: target.id, muted: !target.is_muted },
              {
                onSuccess: () => haptics.selection(),
                onError: (error) => Alert.alert('İşlem tamamlanamadı', error.message),
              },
            );
          } else if (key === 'leave') {
            confirmLeave();
          }
        }}
      />
    </Screen>
  );
}

function formatConversationTime(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return formatTimeTr(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) {
    return 'Dün';
  }

  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diffDays < 7) {
    return date.toLocaleDateString('tr-TR', { weekday: 'short' });
  }
  return formatShortDateTr(date);
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitles: { flex: 1, gap: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchWrap: { paddingHorizontal: 20, paddingBottom: 10 },
  listContent: { paddingHorizontal: 12, paddingBottom: 28 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 18,
    minHeight: 74,
  },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  groupBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { fontSize: 10.5, lineHeight: 14 },
  selfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 4,
  },
  skeletons: { paddingHorizontal: 8, paddingTop: 8, gap: 16 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skeletonText: { flex: 1, gap: 7 },
  state: { paddingHorizontal: 40, paddingTop: 46, paddingBottom: 30, alignItems: 'center', gap: 9 },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    marginTop: 8,
    minHeight: 42,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 18,
  },
  busy: { position: 'absolute', top: 130, alignSelf: 'center' },
});
