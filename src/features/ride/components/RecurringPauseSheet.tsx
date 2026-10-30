import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton, TextField } from '@/components/ui';
import { useKeyboardBottomInset } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';

import type { RideRecurring } from '../types';
import { dateInputValue } from '../utils/format';
import { dateChipLabel, pauseDateOptions, upcomingPausedDates } from '../utils/recurring';

/**
 * Tek günlük duraklatma paneli.
 *
 * Sunucu yalnızca ileri tarihli duraklatmayı kabul eder; o güne ait ilan
 * iptal edilir, diğer günler etkilenmez. Seçilen gün aktif rezervasyon
 * taşıyorsa RPC hata döner ve mesaj burada gösterilir.
 */
export function RecurringPauseSheet({
  plan,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  plan: RideRecurring;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (date: string) => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardBottomInset();
  const options = pauseDateOptions(plan);
  const [date, setDate] = useState(options[0]?.date ?? dateInputValue(new Date()));
  const [localError, setLocalError] = useState<string | null>(null);
  const pausedDates = upcomingPausedDates(plan);
  const alreadyPaused = pausedDates.includes(date);

  const confirm = () => {
    setLocalError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setLocalError('Tarihi YYYY-AA-GG biçiminde gir.');
      return;
    }
    if (date < dateInputValue(new Date())) {
      setLocalError('Geçmiş bir tarih duraklatılamaz.');
      return;
    }
    const parsed = new Date(`${date}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      setLocalError('Geçerli bir tarih gir.');
      return;
    }
    const weekday = parsed.getDay() || 7;
    if (!plan.weekdays.includes(weekday)) {
      setLocalError('Seçilen gün bu planın çalıştığı bir gün değil.');
      return;
    }
    if (alreadyPaused) {
      setLocalError('Bu gün zaten duraklatılmış.');
      return;
    }
    onConfirm(date);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.root, keyboardInset]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paneli kapat"
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: insets.bottom + 14,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={styles.head}>
            <View style={[styles.mark, { backgroundColor: theme.colors.warningSoft }]}>
              <Ionicons name="pause" size={17} color={theme.colors.warning} />
            </View>
            <View style={styles.flex}>
              <AppText variant="h3">Gün duraklat</AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {plan.origin_label} → {plan.dest_label}
              </AppText>
            </View>
            <IconButton
              name="close"
              accessibilityLabel="Kapat"
              onPress={onClose}
              color={theme.colors.textSecondary}
            />
          </View>

          <View style={styles.quickRow}>
            {options.map((option) => {
              const active = date === option.date;
              const paused = pausedDates.includes(option.date);
              return (
                <Pressable
                  key={option.date}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setDate(option.date)}
                  style={[
                    styles.quick,
                    {
                      backgroundColor: active
                        ? theme.colors.primarySoft
                        : theme.colors.surfaceMuted,
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      opacity: paused ? 0.55 : 1,
                    },
                  ]}
                >
                  <AppText variant="label" color={active ? 'primaryDeep' : 'text'}>
                    {option.label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {option.hint}
                    {paused ? ' · duraklatıldı' : ''}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <TextField
            label="Tarih"
            placeholder="YYYY-AA-GG"
            value={date}
            onChangeText={setDate}
            keyboardType="numbers-and-punctuation"
            leftIcon="calendar-outline"
            hint="Yalnızca seçilen günün ilanı iptal edilir; diğer günler etkilenmez."
          />

          {pausedDates.length > 0 ? (
            <View style={styles.pausedWrap}>
              <AppText variant="caption" color="textTertiary">
                Yaklaşan duraklatmalar
              </AppText>
              <View style={styles.pausedRow}>
                {pausedDates.slice(0, 5).map((item) => (
                  <View
                    key={item}
                    style={[
                      styles.pausedChip,
                      {
                        backgroundColor: theme.colors.warningSoft,
                        borderColor: theme.colors.warning,
                      },
                    ]}
                  >
                    <AppText variant="caption" color="warning">
                      {dateChipLabel(item)}
                    </AppText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {localError || error ? (
            <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {localError ?? error}
              </AppText>
            </View>
          ) : null}

          <Button
            label={saving ? 'Duraklatılıyor…' : `${dateChipLabel(date)} için duraklat`}
            loading={saving}
            onPress={confirm}
            leftIcon={<Ionicons name="pause" size={16} color={theme.colors.onPrimary} />}
          />
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  sheet: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  quickRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  quick: {
    flexGrow: 1,
    minWidth: '45%',
    gap: 2,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  pausedWrap: { gap: 6 },
  pausedRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  pausedChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 10,
    padding: 10,
  },
  flex: { flex: 1 },
});
