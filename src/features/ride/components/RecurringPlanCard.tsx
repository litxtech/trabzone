import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { RideRecurring } from '../types';
import { SCOPE_LABEL, formatMoney } from '../utils/format';
import {
  WEEKDAYS,
  dateChipLabel,
  occurrenceLabel,
  shortTime,
  upcomingOccurrence,
  upcomingPausedDates,
  weekdaySummary,
} from '../utils/recurring';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function RecurringPlanCard({
  plan,
  onEdit,
  onPause,
  onRemove,
  onReactivate,
  reactivating = false,
}: {
  plan: RideRecurring;
  onEdit: () => void;
  onPause: () => void;
  onRemove: () => void;
  onReactivate: () => void;
  reactivating?: boolean;
}) {
  const { theme } = useTheme();
  const isDriver = plan.role === 'driver';
  const accent = isDriver ? theme.colors.primaryDeep : theme.colors.accent;
  const accentSoft = isDriver ? theme.colors.primarySoft : theme.colors.accentSoft;
  const next = upcomingOccurrence(plan);
  const pausedDates = upcomingPausedDates(plan);
  const visiblePaused = pausedDates.slice(0, 3);
  const hiddenPaused = pausedDates.length - visiblePaused.length;
  const crossCity = plan.origin_city !== plan.dest_city;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          opacity: plan.is_active ? 1 : 0.9,
        },
        theme.shadows.card,
      ]}
    >
      <View style={styles.head}>
        <View style={[styles.mark, { backgroundColor: accentSoft }]}>
          <Ionicons
            name={isDriver ? 'car-sport-outline' : 'walk-outline'}
            size={19}
            color={accent}
          />
        </View>
        <View style={styles.headText}>
          <AppText variant="title" numberOfLines={2}>
            {plan.origin_label}
            <AppText variant="title" color="textTertiary">
              {'  →  '}
            </AppText>
            {plan.dest_label}
          </AppText>
          <View style={styles.metaLine}>
            <Ionicons name="business-outline" size={11} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {isDriver ? 'Sürücü' : 'Yolcu'} ·{' '}
              {crossCity ? `${plan.origin_city} → ${plan.dest_city}` : plan.origin_city} ·{' '}
              {SCOPE_LABEL[plan.scope]}
            </AppText>
          </View>
        </View>
        <Badge
          label={plan.is_active ? 'Aktif' : 'Pasif'}
          tone={plan.is_active ? 'success' : 'neutral'}
        />
      </View>

      <View style={styles.dayStrip}>
        {WEEKDAYS.map((day) => {
          const active = plan.weekdays.includes(day.value);
          return (
            <View
              key={day.value}
              accessibilityLabel={day.long}
              style={[
                styles.dayCell,
                {
                  backgroundColor: active ? accent : theme.colors.surfaceMuted,
                  borderColor: active ? accent : theme.colors.border,
                  opacity: plan.is_active ? 1 : active ? 0.6 : 0.75,
                },
              ]}
            >
              <AppText
                variant="caption"
                style={[styles.dayText, { color: active ? '#FFFFFF' : theme.colors.textTertiary }]}
              >
                {day.short}
              </AppText>
            </View>
          );
        })}
      </View>

      <View style={styles.chips}>
        <MetaChip
          icon="time-outline"
          label={`Kalkış ${shortTime(plan.depart_time)}`}
          tone="primary"
        />
        {plan.return_time ? (
          <MetaChip
            icon="return-down-back-outline"
            label={`Dönüş ${shortTime(plan.return_time)}`}
            tone="accent"
          />
        ) : null}
        <MetaChip icon="people-outline" label={`${plan.seats} koltuk`} tone="neutral" />
        {plan.price_per_seat_cents != null ? (
          <MetaChip
            icon="wallet-outline"
            label={`${formatMoney(plan.price_per_seat_cents)}/kişi`}
            tone="success"
          />
        ) : null}
        {plan.preferences?.women_only === true ? (
          <MetaChip icon="shield-checkmark-outline" label="Yalnızca kadın" tone="accent" />
        ) : null}
        {plan.preferences?.smoking === false ? (
          <MetaChip icon="ban-outline" label="Sigarasız" tone="neutral" />
        ) : null}
      </View>

      <View
        style={[
          styles.nextRow,
          {
            backgroundColor: plan.is_active ? theme.colors.surfaceMuted : theme.colors.dangerSoft,
            borderColor: theme.colors.border,
          },
        ]}
      >
        <Ionicons
          name={plan.is_active ? 'calendar-clear-outline' : 'pause-circle-outline'}
          size={14}
          color={plan.is_active ? theme.colors.primaryDeep : theme.colors.danger}
        />
        <AppText
          variant="caption"
          color={plan.is_active ? 'textSecondary' : 'danger'}
          style={styles.flex}
        >
          {plan.is_active
            ? next
              ? `Sonraki sefer: ${occurrenceLabel(next)}`
              : `${weekdaySummary(plan.weekdays)} · yaklaşan sefer yok`
            : 'Plan pasif. Yeniden başlattığında ilanlar tekrar üretilir.'}
        </AppText>
      </View>

      {visiblePaused.length > 0 ? (
        <View style={styles.pausedRow}>
          <Ionicons name="pause-outline" size={12} color={theme.colors.warning} />
          {visiblePaused.map((date) => (
            <View
              key={date}
              style={[
                styles.pausedChip,
                { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warning },
              ]}
            >
              <AppText variant="caption" color="warning">
                {dateChipLabel(date)}
              </AppText>
            </View>
          ))}
          {hiddenPaused > 0 ? (
            <AppText variant="caption" color="textTertiary">
              +{hiddenPaused}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

      <View style={styles.foot}>
        {plan.is_active ? (
          <>
            <CardAction icon="create-outline" label="Düzenle" onPress={onEdit} />
            <CardAction icon="calendar-outline" label="Gün duraklat" onPress={onPause} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Planı kaldır"
              onPress={onRemove}
              style={({ pressed }) => [
                styles.iconAction,
                {
                  backgroundColor: theme.colors.dangerSoft,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="trash-outline" size={17} color={theme.colors.danger} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Planı yeniden başlat"
              disabled={reactivating}
              onPress={onReactivate}
              style={({ pressed }) => [
                styles.reactivate,
                {
                  backgroundColor: theme.colors.primarySoft,
                  opacity: reactivating ? 0.6 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Ionicons name="play" size={13} color={theme.colors.primaryDeep} />
              <AppText variant="label" color="primaryDeep">
                {reactivating ? 'Başlatılıyor…' : 'Yeniden başlat'}
              </AppText>
            </Pressable>
            <View style={styles.flex} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Planı kaldır"
              onPress={onRemove}
              style={({ pressed }) => [
                styles.iconAction,
                { backgroundColor: theme.colors.surfaceMuted, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="trash-outline" size={17} color={theme.colors.danger} />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function MetaChip({
  icon,
  label,
  tone,
}: {
  icon: IconName;
  label: string;
  tone: 'primary' | 'accent' | 'neutral' | 'success';
}) {
  const { theme } = useTheme();
  const palette = {
    primary: { bg: theme.colors.primarySoft, fg: theme.colors.primaryDeep },
    accent: { bg: theme.colors.accentSoft, fg: theme.colors.accent },
    neutral: { bg: theme.colors.surfaceMuted, fg: theme.colors.textSecondary },
    success: { bg: theme.colors.successSoft, fg: theme.colors.success },
  }[tone];

  return (
    <View style={[styles.chip, { backgroundColor: palette.bg }]}>
      <Ionicons name={icon} size={12} color={palette.fg} />
      <AppText variant="caption" color={palette.fg}>
        {label}
      </AppText>
    </View>
  );
}

function CardAction({
  icon,
  label,
  onPress,
  tone = 'neutral',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'accent';
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: tone === 'accent' ? theme.colors.accentSoft : theme.colors.surfaceMuted,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={14}
        color={tone === 'accent' ? theme.colors.accent : theme.colors.primaryDeep}
      />
      <AppText variant="caption" color={tone === 'accent' ? 'accent' : 'primaryDeep'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 15,
    gap: 11,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, gap: 2 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dayStrip: { flexDirection: 'row', gap: 5, maxWidth: 430 },
  dayCell: {
    flex: 1,
    height: 30,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontSize: 10.5, letterSpacing: 0.1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pausedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  pausedChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  divider: { height: StyleSheet.hairlineWidth },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 10,
  },
  iconAction: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  reactivate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  flex: { flex: 1 },
});
