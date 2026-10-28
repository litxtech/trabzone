import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Card, Screen, ScreenHeader, Skeleton } from '@/components/ui';
import {
  useBlockedUsers,
  useUnblockUser,
} from '@/features/profile/hooks/use-profile-mutations';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import type { BlockedUser } from '@/features/profile/services/social-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

export default function BlockedUsersScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const { data, isLoading, isError, refetch, isFetching } = useBlockedUsers();
  const unblock = useUnblockUser();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const people = data ?? [];

  const runUnblock = (person: BlockedUser) => {
    setError(null);
    setPendingId(person.id);
    unblock.mutate(person.id, {
      onSuccess: () => haptics.success(),
      onError: (mutationError) => {
        haptics.error();
        setError(mutationError.message);
      },
      onSettled: () => setPendingId(null),
    });
  };

  const confirmUnblock = (person: BlockedUser) => {
    const label = displayName(person);
    if (Platform.OS === 'web') {
      runUnblock(person);
      return;
    }
    Alert.alert(
      'Engeli kaldır',
      `${label} kişisinin engelini kaldırmak istiyor musun? İçerikleri yeniden görünür olacak.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Engeli kaldır', onPress: () => runUnblock(person) },
      ],
    );
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
        title="Engellenen kişiler"
        subtitle={
          people.length > 0 ? `${people.length} kişi engelli` : 'Engel listen boş'
        }
        onBack={() => router.back()}
      />

      <Card
        tone="muted"
        elevated={false}
        style={[styles.intro, { borderColor: theme.colors.border }]}
      >
        <View style={[styles.introIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          Engellediğin kişiler profiline, gönderilerine, yorumlarına ve hikâyelerine hiçbir
          koşulda erişemez. Seni arayamaz, mesaj gönderemez, takip edemez ve seni aramalarda
          bulamaz. Sohbet geçmişin yalnızca sende kalır.
        </AppText>
      </Card>

      {isLoading ? (
        <View style={styles.skeleton}>
          <Skeleton height={72} radius={18} />
          <Skeleton height={72} radius={18} />
        </View>
      ) : isError ? (
        <Card style={styles.stateCard}>
          <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
          <AppText variant="bodyStrong">Engel listesi yüklenemedi</AppText>
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
      ) : people.length === 0 ? (
        <Card tone="muted" elevated={false} style={styles.stateCard}>
          <Ionicons name="ban-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="bodyStrong">Engellediğin kimse yok</AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Bir profilden, gönderiden veya sohbetten engellediğin kişiler burada listelenir.
          </AppText>
        </Card>
      ) : (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AppText variant="h3">Engel listesi</AppText>
            {unblock.isPending ? (
              <ActivityIndicator size="small" color={theme.colors.textTertiary} />
            ) : null}
          </View>

          <Card padding={0} style={styles.listCard}>
            {people.map((person, index) => (
              <BlockedRow
                key={person.id}
                person={person}
                last={index === people.length - 1}
                busy={pendingId === person.id && unblock.isPending}
                onUnblock={() => confirmUnblock(person)}
              />
            ))}
          </Card>
        </View>
      )}

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

      <View style={styles.note}>
        <Ionicons name="lock-closed-outline" size={14} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          Engellenen kişi engellendiğini göremez; profilini açtığında hesabı bulunamaz.
        </AppText>
      </View>
    </Screen>
  );
}

function displayName(person: BlockedUser): string {
  const full = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();
  return full || `@${person.username}`;
}

function BlockedRow({
  person,
  last,
  busy,
  onUnblock,
}: {
  person: BlockedUser;
  last: boolean;
  busy: boolean;
  onUnblock: () => void;
}) {
  const { theme } = useTheme();
  const name = displayName(person);

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
      <Avatar uri={mediaPublicUrl('avatar', person.avatar_path)} name={name} size={44} />

      <View style={styles.personText}>
        <View style={styles.nameRow}>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
            {name}
          </AppText>
          {person.is_verified ? (
            <Ionicons name="checkmark-circle" size={14} color={theme.colors.primary} />
          ) : null}
        </View>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          @{person.username}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {formatDateTr(person.blocked_at)} tarihinde engellendi
        </AppText>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} engelini kaldır`}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onUnblock}
        style={({ pressed }) => [
          styles.unblockButton,
          {
            backgroundColor: theme.colors.surfaceMuted,
            borderColor: theme.colors.border,
            opacity: pressed || busy ? 0.7 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        ) : (
          <AppText variant="caption" color="textSecondary">
            Engeli kaldır
          </AppText>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  introIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeleton: { gap: 12, paddingTop: 14 },
  stateCard: { alignItems: 'center', gap: 8, marginTop: 16 },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  section: { gap: 8, marginTop: 18 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCard: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12 },
  personText: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { flexShrink: 1 },
  unblockButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 96,
    alignItems: 'center',
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
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 16 },
});
