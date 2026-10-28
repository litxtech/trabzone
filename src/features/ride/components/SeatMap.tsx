import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { occupiedSeatSet } from '@/features/pricing';
import { useTheme } from '@/theme/ThemeProvider';

import type { SeatAvailability } from '../types';

type Props = {
  availability: SeatAvailability | null | undefined;
  fromSeq: number;
  toSeq: number;
  selected: number[];
  onToggle: (seat: number) => void;
  maxSeats?: number;
};

/**
 * Koltuk planı yalnızca sunucudan gelen gerçek tahsis kayıtlarıyla çizilir.
 * Koltuk numaraları araç kapasitesine göre üretilir; pencere/ön konumu
 * gösterim amacıyla 2'li sıralardan türetilir, uydurma doluluk gösterilmez.
 */
export function SeatMap({ availability, fromSeq, toSeq, selected, onToggle, maxSeats = 8 }: Props) {
  const { theme } = useTheme();
  const total = availability?.seats_total ?? 0;
  const occupied = occupiedSeatSet(availability, fromSeq, toSeq);
  const seats = Array.from({ length: total }, (_, index) => index + 1);

  if (total === 0) {
    return (
      <AppText variant="body" color="textSecondary">
        Araç kapasitesi bilgisi alınamadı.
      </AppText>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.success }]} />
          <AppText variant="caption" color="textTertiary">Boş</AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]} />
          <AppText variant="caption" color="textTertiary">Seçili</AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]} />
          <AppText variant="caption" color="textTertiary">Dolu</AppText>
        </View>
      </View>

      <View style={[styles.cabin, { borderColor: theme.colors.border, backgroundColor: theme.colors.backgroundAlt }]}>
        <View style={styles.cabinHead}>
          <Ionicons name="car-sport-outline" size={14} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary">
            Ön
          </AppText>
        </View>
        <View style={styles.grid}>
          {seats.map((seat) => {
            const isOccupied = occupied.has(seat);
            const isSelected = selected.includes(seat);
            return (
              <Pressable
                key={seat}
                accessibilityRole="button"
                accessibilityLabel={`Koltuk ${seat}${isOccupied ? ' dolu' : isSelected ? ' seçili' : ' boş'}`}
                accessibilityState={{ selected: isSelected, disabled: isOccupied }}
                disabled={isOccupied}
                onPress={() => onToggle(seat)}
                style={[
                  styles.seat,
                  {
                    backgroundColor: isOccupied
                      ? theme.colors.surfaceMuted
                      : isSelected
                        ? theme.colors.primary
                        : theme.colors.successSoft,
                    borderColor: isOccupied
                      ? theme.colors.border
                      : isSelected
                        ? theme.colors.primary
                        : theme.colors.success,
                    opacity: isOccupied ? 0.55 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={isOccupied ? 'person' : 'person-outline'}
                  size={13}
                  color={isSelected ? '#FFFFFF' : isOccupied ? theme.colors.textTertiary : theme.colors.success}
                />
                <AppText
                  variant="caption"
                  style={{ color: isSelected ? '#FFFFFF' : theme.colors.textSecondary }}
                >
                  {seat}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="caption" color="textTertiary">
          En fazla {maxSeats} koltuk seçebilirsin. Seçmezsen sistem uygun koltukları atar.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  legend: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 13, height: 13, borderRadius: 4, borderWidth: 1 },
  cabin: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 12, gap: 10 },
  cabinHead: { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'flex-end' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  seat: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
});
