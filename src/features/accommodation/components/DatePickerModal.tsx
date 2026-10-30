import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useAccommodationLayout } from '../hooks/use-accommodation-layout';
import { dateToIso, formatDate, isoToDate, todayIso } from '../utils/format';

type Props = {
  visible: boolean;
  title?: string;
  mode?: 'single' | 'range';
  value?: string | null;
  endValue?: string | null;
  minDate?: string | null;
  onClose: () => void;
  onSelectSingle?: (iso: string) => void;
  onSelectRange?: (start: string, end: string) => void;
};

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(date);
}

function buildGrid(monthDate: Date): (string | null)[] {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(dateToIso(new Date(monthDate.getFullYear(), monthDate.getMonth(), day)));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

/**
 * Takvimden tek tarih veya tarih aralığı seçimi. Harici tarih seçici
 * bağımlılığı yoktur; tüm platformlarda aynı davranır.
 */
export function DatePickerModal({
  visible,
  title = 'Tarih seç',
  mode = 'single',
  value,
  endValue,
  minDate,
  onClose,
  onSelectSingle,
  onSelectRange,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useAccommodationLayout();
  const [cursor, setCursor] = useState(() => isoToDate(value ?? todayIso()));
  const [start, setStart] = useState<string | null>(value ?? null);
  const [end, setEnd] = useState<string | null>(endValue ?? null);

  useEffect(() => {
    if (!visible) return;
    const next = value ?? todayIso();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCursor(isoToDate(next));
    setStart(value ?? null);
    setEnd(endValue ?? null);
  }, [visible, value, endValue]);

  const grid = useMemo(() => buildGrid(cursor), [cursor]);
  const today = todayIso();
  const min = minDate ?? null;

  const move = (delta: number) => {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
  };

  const pick = (iso: string) => {
    if (min && iso < min) return;
    if (mode === 'single') {
      onSelectSingle?.(iso);
      onClose();
      return;
    }
    if (!start || (start && end)) {
      setStart(iso);
      setEnd(null);
      return;
    }
    if (iso < start) {
      setStart(iso);
      setEnd(null);
      return;
    }
    if (iso === start) {
      setEnd(dateToIso(new Date(isoToDate(iso).getTime() + 86_400_000)));
      return;
    }
    setEnd(iso);
  };

  const applyRange = () => {
    if (start && end) {
      onSelectRange?.(start, end);
      onClose();
    }
  };

  const isInRange = (iso: string) => Boolean(start && end && iso > start && iso < end);

  const weeks = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pa'];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Takvimi kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.xl,
              width: layout.isDesktop ? 440 : Math.min(layout.width - 24, 440),
              paddingBottom: layout.isDesktop ? 18 : insets.bottom + 18,
            },
          ]}
        >
          <View style={styles.head}>
            <View style={styles.flex}>
              <AppText variant="h3">{title}</AppText>
              <AppText variant="caption" color="textSecondary">
                {mode === 'range' ? 'Giriş ve çıkış tarihini seç' : 'Bir tarih seç'}
              </AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Kapat" hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.monthRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Önceki ay"
              hitSlop={8}
              onPress={() => move(-1)}
              style={[styles.navButton, { backgroundColor: theme.colors.surfaceMuted }]}
            >
              <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
            </Pressable>
            <AppText variant="bodyStrong" style={styles.monthLabel}>
              {monthLabel(cursor)}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sonraki ay"
              hitSlop={8}
              onPress={() => move(1)}
              style={[styles.navButton, { backgroundColor: theme.colors.surfaceMuted }]}
            >
              <Ionicons name="chevron-forward" size={18} color={theme.colors.text} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {weeks.map((week) => (
              <AppText key={week} variant="caption" color="textTertiary" align="center" style={styles.cell}>
                {week}
              </AppText>
            ))}
          </View>

          <ScrollView style={styles.gridScroll} contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {grid.map((iso, index) => {
              if (!iso) {
                return <View key={`empty-${index}`} style={styles.cell} />;
              }
              const disabled = Boolean(min && iso < min);
              const selected = iso === start || iso === end;
              const inRange = isInRange(iso);
              const isToday = iso === today;
              return (
                <Pressable
                  key={iso}
                  accessibilityRole="button"
                  accessibilityLabel={formatDate(iso)}
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  onPress={() => pick(iso)}
                  style={[
                    styles.cell,
                    styles.day,
                    selected
                      ? { backgroundColor: theme.colors.primaryDeep }
                      : inRange
                        ? { backgroundColor: theme.colors.primarySoft }
                        : null,
                  ]}
                >
                  <AppText
                    variant="body"
                    color={
                      disabled
                        ? 'textTertiary'
                        : selected
                          ? '#FFFFFF'
                          : inRange
                            ? 'primaryDeep'
                            : 'text'
                    }
                    style={[
                      styles.dayText,
                      isToday && !selected ? { color: theme.colors.primaryDeep } : null,
                    ]}
                  >
                    {isoToDate(iso).getDate()}
                  </AppText>
                  {isToday ? (
                    <View
                      style={[
                        styles.todayDot,
                        { backgroundColor: selected ? '#FFFFFF' : theme.colors.primary },
                      ]}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {mode === 'range' ? (
            <View style={styles.rangeFooter}>
              <View style={styles.rangeInfo}>
                <AppText variant="caption" color="textTertiary">
                  Giriş
                </AppText>
                <AppText variant="bodyStrong">{start ? formatDate(start) : '—'}</AppText>
              </View>
              <Ionicons name="arrow-forward" size={16} color={theme.colors.textTertiary} />
              <View style={styles.rangeInfo}>
                <AppText variant="caption" color="textTertiary">
                  Çıkış
                </AppText>
                <AppText variant="bodyStrong">{end ? formatDate(end) : '—'}</AppText>
              </View>
              <Button
                label="Uygula"
                size="sm"
                disabled={!start || !end}
                onPress={applyRange}
                style={styles.applyButton}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 12 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  flex: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthLabel: { flex: 1, textAlign: 'center', textTransform: 'capitalize' },
  navButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row', flexWrap: 'wrap' },
  gridScroll: { maxHeight: 330 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center' },
  day: { height: 42, borderRadius: 12, gap: 2 },
  dayText: { fontSize: 14 },
  todayDot: { width: 4, height: 4, borderRadius: 2 },
  rangeFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6 },
  rangeInfo: { flex: 1, gap: 1 },
  applyButton: { minWidth: 96 },
});
