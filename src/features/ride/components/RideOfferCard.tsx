import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Badge } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';

import type { RideSearchItem } from '../types';
import {
  LEVEL_LABEL,
  dayLabel,
  formatDistance,
  formatDuration,
  formatMoney,
  formatTime,
  initials,
} from '../utils/format';
import { VerifiedTick } from './IdentityBadge';

export function RideOfferCard({ offer }: { offer: RideSearchItem }) {
  const { theme } = useTheme();
  const router = useRouter();
  const driverName =
    [offer.driver.first_name, offer.driver.username].filter(Boolean).join(' ') || 'Sürücü';
  const score = offer.match?.score;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${offer.origin_label} - ${offer.dest_label} yolculuğu`}
      onPress={() => router.navigate(`/ride/offers/${offer.id}` as never)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      <View style={styles.top}>
        <View style={styles.timeBlock}>
          <AppText variant="h3">{formatTime(offer.depart_at)}</AppText>
          <AppText variant="caption" color="textTertiary">
            {dayLabel(offer.depart_at)}
          </AppText>
        </View>
        <View style={styles.routeBlock}>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: theme.colors.success }]} />
            <AppText variant="label" numberOfLines={1} style={styles.flex}>
              {offer.origin_label}
            </AppText>
          </View>
          <View style={[styles.connector, { borderColor: theme.colors.borderStrong }]} />
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
            <AppText variant="label" numberOfLines={1} style={styles.flex}>
              {offer.dest_label}
            </AppText>
          </View>
        </View>
        <View style={styles.priceBlock}>
          <AppText variant="title" color="primaryDeep">
            {formatMoney(offer.price_per_seat_cents, offer.currency)}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            koltuk başı
          </AppText>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.meta}>
          <Ionicons name="people-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary">
            {offer.seats_available} boş / {offer.seats_total}
          </AppText>
        </View>
        {offer.distance_meters ? (
          <View style={styles.meta}>
            <Ionicons name="speedometer-outline" size={13} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary">
              {formatDistance(offer.distance_meters)}
            </AppText>
          </View>
        ) : null}
        {offer.duration_minutes ? (
          <View style={styles.meta}>
            <Ionicons name="time-outline" size={13} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary">
              {formatDuration(offer.duration_minutes)}
            </AppText>
          </View>
        ) : null}
        <View style={styles.meta}>
          <Ionicons name="car-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {offer.vehicle.make} {offer.vehicle.model}
          </AppText>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

      <View style={styles.footer}>
        <Avatar
          size={34}
          uri={mediaPublicUrl('avatar', offer.driver.avatar_path)}
          name={initials(offer.driver.first_name, offer.driver.username)}
        />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <AppText variant="label" numberOfLines={1}>
              {driverName}
            </AppText>
            {offer.driver.identity_verified ? <VerifiedTick size={15} /> : null}
          </View>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {offer.driver.rating_avg
              ? `${offer.driver.rating_avg.toFixed(1)} ★ · ${offer.driver.completed_trips ?? 0} yolculuk`
              : `${offer.driver.completed_trips ?? 0} tamamlanmış yolculuk`}
            {offer.driver.level ? ` · ${LEVEL_LABEL[offer.driver.level]}` : ''}
          </AppText>
        </View>
        <View style={styles.badges}>
          {typeof score === 'number' ? (
            <Badge label={`Eşleşme ${Math.round(score)}`} tone={score >= 75 ? 'success' : 'primary'} />
          ) : null}
          <Badge
            label={offer.booking_mode === 'auto' ? 'Otomatik onay' : 'Sürücü onayı'}
            tone="neutral"
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 11,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  timeBlock: { width: 58, gap: 0 },
  routeBlock: { flex: 1, gap: 2, minWidth: 0 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  connector: { borderLeftWidth: 1, borderStyle: 'dashed', height: 10, marginLeft: 3 },
  priceBlock: { alignItems: 'flex-end', minWidth: 76 },
  flex: { flex: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '48%' },
  divider: { height: StyleSheet.hairlineWidth },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badges: { alignItems: 'flex-end', gap: 4 },
});
