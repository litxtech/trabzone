import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, IconButton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState, RideRouteBlock } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { useCloseRideRequest, useMyRequests } from '@/features/ride/hooks/use-ride';
import type { RideRequest } from '@/features/ride/types';
import { SCOPE_LABEL, formatDateTime } from '@/features/ride/utils/format';

const STATUS: Record<
  RideRequest['status'],
  { label: string; tone: 'success' | 'primary' | 'neutral' }
> = {
  open: { label: 'Açık', tone: 'success' },
  matched: { label: 'Eşleşti', tone: 'primary' },
  closed: { label: 'Kapandı', tone: 'neutral' },
  expired: { label: 'Süresi doldu', tone: 'neutral' },
};

const LUGGAGE_LABEL: Record<string, string> = {
  small: 'Az bagaj',
  medium: 'Orta bagaj',
  large: 'Çok bagaj',
};

/** Yolcunun açtığı talepler: sürücülerin eşleştirme havuzunda bekleyen kayıtlar. */
export default function RideRequestsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const requests = useMyRequests();
  const close = useCloseRideRequest();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      scroll
      padded
      contentContainerStyle={styles.page}
    >
      <RideHeader
        title="Yolcu taleplerim"
        subtitle="Sürücülerin eşleşebileceği açık talepler"
        right={
          <View style={styles.headerActions}>
            <IconButton
              name="search-outline"
              accessibilityLabel="Yolculuk ara"
              variant="surface"
              size={19}
              onPress={() => router.navigate('/ride/search' as never)}
            />
            <IconButton
              name="add"
              accessibilityLabel="Yeni yolcu talebi"
              variant="surface"
              size={20}
              onPress={() => router.navigate('/ride/request' as never)}
            />
          </View>
        }
      />

      {requests.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : requests.isError ? (
        <RideEmptyState
          icon="cloud-offline-outline"
          title="Talepler yüklenemedi"
          message={requests.error.message}
          action={
            <Button
              label="Tekrar dene"
              variant="secondary"
              size="sm"
              fullWidth={false}
              onPress={() => void requests.refetch()}
            />
          }
        />
      ) : (requests.data?.length ?? 0) === 0 ? (
        <RideEmptyState
          icon="hand-left-outline"
          title="Açık talebin yok"
          message="Nereye gitmek istediğini yaz; uygun sürücüler talebinle eşleşsin."
          action={
            <Button
              label="Yolcu talebi oluştur"
              size="sm"
              fullWidth={false}
              onPress={() => router.navigate('/ride/request' as never)}
            />
          }
        />
      ) : (
        <View style={styles.list}>
          {requests.data?.map((request) => {
            const status = STATUS[request.status];
            const isOpen = request.status === 'open';
            const isConfirming = confirming === request.id;
            return (
              <View
                key={request.id}
                style={[
                  styles.card,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.flex}>
                    <RideRouteBlock
                      origin={request.origin_label}
                      dest={request.dest_label}
                      emphasis
                    />
                  </View>
                  <Badge label={status.label} tone={status.tone} />
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.meta}>
                    <Ionicons
                      name="calendar-outline"
                      size={13}
                      color={theme.colors.textTertiary}
                    />
                    <AppText variant="caption" color="textSecondary">
                      {formatDateTime(request.earliest_depart)} –{' '}
                      {formatDateTime(request.latest_depart)}
                    </AppText>
                  </View>
                  <View style={styles.meta}>
                    <Ionicons
                      name="people-outline"
                      size={13}
                      color={theme.colors.textTertiary}
                    />
                    <AppText variant="caption" color="textSecondary">
                      {request.party_size} kişi
                    </AppText>
                  </View>
                  <View style={styles.meta}>
                    <Ionicons
                      name="briefcase-outline"
                      size={13}
                      color={theme.colors.textTertiary}
                    />
                    <AppText variant="caption" color="textSecondary">
                      {LUGGAGE_LABEL[request.luggage] ?? request.luggage}
                    </AppText>
                  </View>
                </View>

                {request.notes ? (
                  <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                    {request.notes}
                  </AppText>
                ) : null}

                <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

                <View style={styles.cardFoot}>
                  <AppText variant="caption" color="textTertiary">
                    {SCOPE_LABEL[request.scope]}
                  </AppText>
                  <View style={styles.flex} />
                  {isOpen ? (
                    isConfirming ? (
                      <View style={styles.confirmRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Kapatmayı iptal et"
                          onPress={() => setConfirming(null)}
                          hitSlop={6}
                        >
                          <AppText variant="label" color="textSecondary">
                            Vazgeç
                          </AppText>
                        </Pressable>
                        <Button
                          label="Talebi kapat"
                          size="sm"
                          variant="danger"
                          fullWidth={false}
                          loading={close.isPending && close.variables === request.id}
                          onPress={() =>
                            close.mutate(request.id, {
                              onSuccess: () => setConfirming(null),
                            })
                          }
                        />
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Talebi kapat"
                        onPress={() => setConfirming(request.id)}
                        hitSlop={6}
                      >
                        <AppText variant="label" color="danger">
                          Talebi kapat
                        </AppText>
                      </Pressable>
                    )
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 880, alignSelf: 'center', gap: 13 },
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  center: { paddingVertical: 44, alignItems: 'center' },
  list: { gap: 8 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    gap: 9,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  divider: { height: StyleSheet.hairlineWidth },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
