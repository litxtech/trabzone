import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useConnections } from '../hooks/use-profile-view';
import { mediaPublicUrl } from '../services/media-service';
import type { ConnectionKind } from '../services/social-service';

type Props = {
  visible: boolean;
  userId: string | null;
  kind: ConnectionKind;
  onClose: () => void;
};

const TITLES: Record<ConnectionKind, string> = {
  followers: 'Takipçiler',
  following: 'Takip edilenler',
};

export function ConnectionsSheet({ visible, userId, kind, onClose }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useConnections(userId, kind, visible);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Listeyi kapat"
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: insets.bottom + 8,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={styles.head}>
            <AppText variant="h3">{TITLES[kind]}</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              hitSlop={10}
              onPress={onClose}
            >
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : isError ? (
            <View style={styles.center}>
              <AppText variant="caption" color="textSecondary">
                Liste yüklenemedi.
              </AppText>
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
            </View>
          ) : (
            <FlatList
              data={data ?? []}
              keyExtractor={(item) => item.id}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Ionicons
                    name="people-outline"
                    size={26}
                    color={theme.colors.textTertiary}
                  />
                  <AppText variant="caption" color="textTertiary" align="center">
                    {kind === 'followers'
                      ? 'Henüz takipçi yok.'
                      : 'Henüz kimse takip edilmiyor.'}
                  </AppText>
                </View>
              }
              renderItem={({ item }) => {
                const name = `${item.first_name} ${item.last_name}`.trim();
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${name} profilini aç`}
                    onPress={() => {
                      onClose();
                      router.push(`/profile/${item.username}` as never);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' },
                    ]}
                  >
                    <Avatar uri={mediaPublicUrl('avatar', item.avatar_path)} name={name} size={44} />
                    <View style={styles.rowText}>
                      <View style={styles.nameRow}>
                        <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
                          {name}
                        </AppText>
                        {item.is_verified ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={14}
                            color={theme.colors.primary}
                          />
                        ) : null}
                      </View>
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        @{item.username}
                        {item.city ? ` · ${item.city}` : ''}
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  sheet: { maxHeight: '80%', paddingTop: 8, gap: 8 },
  grabber: { width: 40, height: 4, borderRadius: 999, alignSelf: 'center', marginBottom: 4 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  list: { marginTop: 2 },
  listContent: { paddingHorizontal: 12, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 12,
  },
  rowText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 34 },
  retry: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
});
