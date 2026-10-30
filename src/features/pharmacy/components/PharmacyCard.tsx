import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import type { PharmacySummary } from '../types';
import {
  describePharmacyState,
  dutyEndsNextDay,
  formatDistance,
  formatDutyWindow,
} from '../utils/status';
import { PharmacyActions } from './PharmacyActions';
import { PharmacyStatusBadge } from './PharmacyStatusBadge';

function dutyLine(item: PharmacySummary) {
  const shift = item.state?.shift;
  if (shift) {
    return `${formatDutyWindow(shift.starts_at, shift.ends_at)}${dutyEndsNextDay(shift) ? ' (ertesi gün)' : ''}`;
  }
  const view = describePharmacyState(item.state);
  if (view.detail) {
    return view.detail;
  }
  if (!item.state?.hours_known) {
    return 'Çalışma saatleri doğrulanmadı';
  }
  return 'Bugün nöbet kaydı yok';
}

function RatingBadge({ rating, count }: { rating: number; count: number }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.rating, { backgroundColor: theme.colors.warningSoft }]}>
      <Ionicons name="star" size={10} color={theme.colors.warning} />
      <AppText variant="caption" style={{ color: theme.colors.text, fontWeight: '700' }}>
        {rating.toFixed(1)}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        ({count})
      </AppText>
    </View>
  );
}

/**
 * Eczane kartı. Bilgi hiyerarşisi: durum → ad → ilçe/mahalle → nöbet saati →
 * aksiyonlar. Durum bilinmiyorsa kart "nöbetçi" iddiasında bulunmaz.
 */
export function PharmacyCard({
  item,
  onPress,
  onMap,
  variant = 'list',
}: {
  item: PharmacySummary;
  onPress: () => void;
  onMap: () => void;
  variant?: 'list' | 'hero';
}) {
  const { theme, scheme } = useTheme();
  const view = describePharmacyState(item.state);
  const hero = variant === 'hero';
  const place = [item.district, item.neighborhood].filter(Boolean).join(' · ');
  const distance = formatDistance(item.distance_km);
  const onDuty = view.onDutyNow;
  const tint = onDuty ? theme.colors.success : theme.colors.primaryDeep;
  const tintSoft = onDuty ? theme.colors.successSoft : theme.colors.primarySoft;

  return (
    <View
      style={[
        styles.card,
        theme.shadows.card,
        Platform.OS === 'web'
          ? ({
              boxShadow:
                scheme === 'dark'
                  ? '0 8px 24px rgba(0, 0, 0, 0.28)'
                  : '0 8px 24px rgba(30, 58, 138, 0.07), 0 1px 3px rgba(23, 34, 56, 0.04)',
            } as unknown as object)
          : null,
        { backgroundColor: theme.colors.surface },
      ]}
    >
      <View style={styles.inner}>
        {/* Aksiyonlar dışarıda: iç içe geçmiş dokunma alanları erişilebilirliği bozar. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${view.label}, ${place}`}
          onPress={() => {
            haptics.tap();
            onPress();
          }}
          style={({ pressed }) => [styles.pressArea, { opacity: pressed ? 0.94 : 1 }]}
        >
          <View style={styles.head}>
            <View style={[styles.icon, hero && styles.iconHero, { backgroundColor: tintSoft }]}>
              <Ionicons name={onDuty ? 'moon' : 'medkit'} size={hero ? 20 : 18} color={tint} />
            </View>
            <View style={styles.flex}>
              <AppText variant={hero ? 'h3' : 'title'} numberOfLines={1}>
                {item.name}
              </AppText>
              <View style={styles.placeRow}>
                <Ionicons name="location-sharp" size={11} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
                  {place || 'İlçe bilgisi yok'}
                  {distance ? ` · ${distance}` : ''}
                </AppText>
              </View>
            </View>
            {item.rating != null && item.review_count > 0 ? (
              <RatingBadge rating={item.rating} count={item.review_count} />
            ) : null}
          </View>

          <View style={[styles.infoPanel, { backgroundColor: theme.colors.surfaceMuted }]}>
            <View style={styles.badgeRow}>
              <PharmacyStatusBadge state={item.state} compact={!hero} />
              {item.state?.stale ? (
                <View style={styles.staleRow}>
                  <Ionicons name="alert-circle-outline" size={11} color={theme.colors.warning} />
                  <AppText variant="caption" color="warning">
                    Kayıt eski
                  </AppText>
                </View>
              ) : null}
            </View>

            <View style={styles.metaRow}>
              <Ionicons name="time-outline" size={13} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
                {dutyLine(item)}
              </AppText>
            </View>

            {hero ? (
              <View style={styles.metaRow}>
                <Ionicons
                  name={item.address ? 'navigate-circle-outline' : 'alert-circle-outline'}
                  size={13}
                  color={theme.colors.textSecondary}
                />
                <AppText
                  variant="caption"
                  color={item.address ? 'textSecondary' : 'textTertiary'}
                  numberOfLines={2}
                  style={styles.flex}
                >
                  {item.address ?? 'Açık adres henüz doğrulanmadı'}
                </AppText>
              </View>
            ) : null}
          </View>
        </Pressable>

        <PharmacyActions
          name={item.name}
          phone={item.phone}
          lat={item.lat}
          lng={item.lng}
          onMap={onMap}
          compact={!hero}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inner: { padding: 14, gap: 10 },
  pressArea: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconHero: { width: 46, height: 46, borderRadius: 16 },
  flex: { flex: 1 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  infoPanel: { borderRadius: 14, paddingHorizontal: 11, paddingVertical: 9, gap: 7 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  staleRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
});
