import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { RideStop } from '../types';

type Props = {
  stops: RideStop[];
  pickupSeq?: number;
  dropoffSeq?: number;
  onPick?: (seq: number) => void;
  onDrop?: (seq: number) => void;
  compact?: boolean;
};

/**
 * Gerçek durak sırasına göre çizilen güzergâh. Kullanıcı yalnızca kendi
 * biniş ve iniş noktalarını seçebilir; durak sırası sunucudan gelir.
 */
export function RouteTimeline({ stops, pickupSeq, dropoffSeq, onPick, onDrop, compact = false }: Props) {
  const { theme } = useTheme();
  if (stops.length === 0) {
    return (
      <AppText variant="body" color="textSecondary">
        Güzergâh durağı bulunamadı.
      </AppText>
    );
  }
  const selectable = Boolean(onPick || onDrop);

  return (
    <View style={styles.wrap}>
      {stops.map((stop, index) => {
        const isFirst = index === 0;
        const isLast = index === stops.length - 1;
        const isPick = pickupSeq === stop.seq;
        const isDrop = dropoffSeq === stop.seq;
        const action = isFirst ? onPick : isLast ? onDrop : null;
        const handler = isFirst ? onPick : isLast ? onDrop : null;
        const content = (
          <View style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.node,
                  {
                    backgroundColor: isPick
                      ? theme.colors.success
                      : isDrop
                        ? theme.colors.primary
                        : theme.colors.surface,
                    borderColor: isPick
                      ? theme.colors.success
                      : isDrop
                        ? theme.colors.primary
                        : theme.colors.borderStrong,
                    borderWidth: isPick || isDrop ? 0 : 1.5,
                  },
                ]}
              >
                {isPick || isDrop ? (
                  <Ionicons
                    name={isPick ? 'arrow-up' : 'arrow-down'}
                    size={10}
                    color="#FFFFFF"
                  />
                ) : null}
              </View>
              {!isLast ? (
                <View style={[styles.line, { backgroundColor: theme.colors.border }]} />
              ) : null}
            </View>
            <View style={[styles.stopBody, isLast && styles.lastBody]}>
              <View style={styles.labelRow}>
                <AppText variant={isFirst || isLast ? 'label' : 'body'} numberOfLines={2} style={styles.flex}>
                  {stop.label}
                </AppText>
                {isPick ? <AppText variant="caption" color="success">Biniş</AppText> : null}
                {isDrop ? <AppText variant="caption" color="primaryDeep">İniş</AppText> : null}
              </View>
              {!compact && (stop.city || stop.arrive_offset_minutes != null) ? (
                <AppText variant="caption" color="textTertiary">
                  {[stop.city, stop.district].filter(Boolean).join(', ')}
                  {stop.arrive_offset_minutes != null
                    ? `${stop.city ? ' · ' : ''}tahmini +${stop.arrive_offset_minutes} dk`
                    : ''}
                </AppText>
              ) : null}
              {selectable && (isFirst || isLast) && !isPick && !isDrop && handler ? (
                <AppText variant="caption" color="textTertiary">
                  {isFirst ? 'Biniş noktası olarak seç' : 'İniş noktası olarak seç'}
                </AppText>
              ) : null}
            </View>
          </View>
        );

        if (!selectable || !action || !handler) {
          return <View key={stop.id ?? `${stop.seq}-${stop.label}`}>{content}</View>;
        }
        return (
          <Pressable
            key={stop.id ?? `${stop.seq}-${stop.label}`}
            accessibilityRole="button"
            accessibilityLabel={`${stop.label} ${isFirst ? 'biniş' : 'iniş'} noktası seç`}
            onPress={() => handler(stop.seq)}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            {content}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  row: { flexDirection: 'row', gap: 10 },
  rail: { width: 18, alignItems: 'center' },
  node: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  line: { flex: 1, width: 2, marginVertical: 2, opacity: 0.7 },
  stopBody: { flex: 1, paddingBottom: 14, gap: 2 },
  lastBody: { paddingBottom: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
