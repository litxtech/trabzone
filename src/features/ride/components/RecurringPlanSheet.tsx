import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton, TextField } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { PROVINCES } from '@/features/profile/constants/regions';
import { useKeyboardBottomInset } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';

import type { RideRecurring, RideScope, RideVehicle } from '../types';
import {
  DAY_PRESETS,
  DEPART_TIME_SUGGESTIONS,
  POPULAR_ROUTES,
  RETURN_TIME_SUGGESTIONS,
  WEEKDAYS,
  activeDayPreset,
  draftFromPlan,
  emptyDraft,
  isValidTime,
  normalizeTimeInput,
  parsePriceCents,
  uniqueDays,
  weekdaySummary,
  type RecurringDraft,
} from '../utils/recurring';

type IconName = ComponentProps<typeof Ionicons>['name'];
type CityTarget = 'origin' | 'dest' | null;

export function RecurringPlanSheet({
  plan,
  vehicles,
  saving,
  error,
  driverReady,
  onClose,
  onSubmit,
  onOpenGarage,
}: {
  plan: RideRecurring | null;
  vehicles: RideVehicle[];
  saving: boolean;
  error: string | null;
  driverReady: boolean;
  onClose: () => void;
  onSubmit: (draft: RecurringDraft) => void;
  onOpenGarage: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardBottomInset();
  const [draft, setDraft] = useState<RecurringDraft>(() =>
    plan ? draftFromPlan(plan) : emptyDraft(),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [cityTarget, setCityTarget] = useState<CityTarget>(null);

  const usableVehicles = vehicles.filter(
    (vehicle) =>
      vehicle.is_active && vehicle.status !== 'rejected' && vehicle.status !== 'suspended',
  );
  const preset = activeDayPreset(draft.weekdays);

  const patch = (changes: Partial<RecurringDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const toggleDay = (value: number) => {
    const next = draft.weekdays.includes(value)
      ? draft.weekdays.filter((day) => day !== value)
      : [...draft.weekdays, value];
    patch({ weekdays: uniqueDays(next) });
  };

  const swapRoute = () => {
    patch({
      originLabel: draft.destLabel,
      originCity: draft.destCity,
      destLabel: draft.originLabel,
      destCity: draft.originCity,
    });
  };

  const handleSubmit = () => {
    setLocalError(null);
    const origin = draft.originLabel.trim();
    const dest = draft.destLabel.trim();
    if (origin.length < 2 || dest.length < 2) {
      setLocalError('KalkÄ±ÅŸ ve varÄ±ÅŸ noktalarÄ±nÄ± yaz.');
      return;
    }
    if (origin.toLocaleLowerCase('tr-TR') === dest.toLocaleLowerCase('tr-TR')) {
      setLocalError('KalkÄ±ÅŸ ve varÄ±ÅŸ noktalarÄ± aynÄ± olamaz.');
      return;
    }
    if (!draft.originCity.trim() || !draft.destCity.trim()) {
      setLocalError('Åehir alanlarÄ±nÄ± doldur.');
      return;
    }
    if (draft.weekdays.length === 0) {
      setLocalError('En az bir gÃ¼n seÃ§.');
      return;
    }
    if (!isValidTime(draft.departTime)) {
      setLocalError('KalkÄ±ÅŸ saatini SS:DD biÃ§iminde gir.');
      return;
    }
    if (draft.returnTime.trim() && !isValidTime(draft.returnTime)) {
      setLocalError('DÃ¶nÃ¼ÅŸ saatini SS:DD biÃ§iminde gir ya da boÅŸ bÄ±rak.');
      return;
    }
    if (draft.role === 'driver' && !draft.vehicleId) {
      setLocalError('SÃ¼rÃ¼cÃ¼ planÄ± iÃ§in onaylÄ± bir araÃ§ seÃ§.');
      return;
    }
    if (draft.role === 'driver' && draft.price.trim() && parsePriceCents(draft.price) == null) {
      setLocalError('Koltuk bedelini sayÄ± olarak gir.');
      return;
    }
    onSubmit({
      ...draft,
      originLabel: origin,
      destLabel: dest,
      originCity: draft.originCity.trim(),
      destCity: draft.destCity.trim(),
      departTime: draft.departTime.trim(),
      returnTime: draft.returnTime.trim(),
      weekdays: uniqueDays(draft.weekdays),
    });
  };

  const showDriverHint = draft.role === 'driver' && !driverReady;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.root, keyboardInset]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Formu kapat"
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
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={styles.head}>
            <View style={styles.flex}>
              <AppText variant="h2">{plan ? 'PlanÄ± dÃ¼zenle' : 'Yeni dÃ¼zenli plan'}</AppText>
              <AppText variant="caption" color="textTertiary">
                {weekdaySummary(draft.weekdays)} Â· {draft.departTime || '--:--'} kalkÄ±ÅŸ
              </AppText>
            </View>
            <IconButton
              name="close"
              accessibilityLabel="Kapat"
              onPress={onClose}
              color={theme.colors.textSecondary}
            />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Section icon="people-circle-outline" title="RolÃ¼n">
              <View style={styles.roleRow}>
                <RoleTile
                  active={draft.role === 'passenger'}
                  icon="walk-outline"
                  title="Yolcu planÄ±"
                  subtitle="GÃ¼zergÃ¢hÄ±nÄ± yayÄ±nla"
                  onPress={() => patch({ role: 'passenger' })}
                />
                <RoleTile
                  active={draft.role === 'driver'}
                  icon="car-sport-outline"
                  title="SÃ¼rÃ¼cÃ¼ planÄ±"
                  subtitle="Koltuk aÃ§, ilan Ã¼ret"
                  onPress={() => patch({ role: 'driver' })}
                />
              </View>
              <View style={styles.segment}>
                {(['intracity', 'intercity'] as RideScope[]).map((scope) => {
                  const active = draft.scope === scope;
                  return (
                    <Pressable
                      key={scope}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => patch({ scope })}
                      style={[
                        styles.segmentItem,
                        {
                          backgroundColor: active ? theme.colors.surface : 'transparent',
                          borderColor: active ? theme.colors.border : 'transparent',
                        },
                      ]}
                    >
                      <Ionicons
                        name={scope === 'intracity' ? 'business-outline' : 'trail-sign-outline'}
                        size={14}
                        color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
                      />
                      <AppText variant="caption" color={active ? 'primaryDeep' : 'textTertiary'}>
                        {scope === 'intracity' ? 'Åehir iÃ§i' : 'Åehirler arasÄ±'}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
              {showDriverHint ? (
                <View style={[styles.note, { backgroundColor: theme.colors.warningSoft }]}>
                  <Ionicons
                    name="information-circle-outline"
                    size={14}
                    color={theme.colors.warning}
                  />
                  <AppText variant="caption" color="warning" style={styles.flex}>
                    SÃ¼rÃ¼cÃ¼ planÄ± iÃ§in onaylÄ± kimlik, ehliyet ve araÃ§ gerekir. Eksikse kayÄ±t sunucu
                    tarafÄ±ndan reddedilir.
                  </AppText>
                </View>
              ) : null}
            </Section>

            <Section
              icon="git-branch-outline"
              title="GÃ¼zergÃ¢h"
              action={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="KalkÄ±ÅŸ ve varÄ±ÅŸÄ± yer deÄŸiÅŸtir"
                  onPress={swapRoute}
                  style={[styles.swap, { backgroundColor: theme.colors.surfaceMuted }]}
                >
                  <Ionicons name="swap-vertical" size={14} color={theme.colors.primaryDeep} />
                  <AppText variant="caption" color="primaryDeep">
                    Yer deÄŸiÅŸtir
                  </AppText>
                </Pressable>
              }
            >
              <TextField
                label="KalkÄ±ÅŸ noktasÄ±"
                placeholder="Ã–rn. Meydan, Ã‡Ã¶mlekÃ§i"
                value={draft.originLabel}
                onChangeText={(originLabel) => patch({ originLabel })}
                leftIcon="radio-button-on-outline"
                rightSlot={
                  <CityButton city={draft.originCity} onPress={() => setCityTarget('origin')} />
                }
              />
              <TextField
                label="VarÄ±ÅŸ noktasÄ±"
                placeholder="Ã–rn. KTÃœ Kanuni KampÃ¼sÃ¼"
                value={draft.destLabel}
                onChangeText={(destLabel) => patch({ destLabel })}
                leftIcon="location-outline"
                rightSlot={
                  <CityButton city={draft.destCity} onPress={() => setCityTarget('dest')} />
                }
              />
              <View style={styles.presetRow}>
                <AppText variant="caption" color="textTertiary">
                  PopÃ¼ler:
                </AppText>
                {POPULAR_ROUTES.slice(0, 3).map((route) => (
                  <Pressable
                    key={`${route.origin}-${route.dest}`}
                    accessibilityRole="button"
                    onPress={() =>
                      patch({
                        originLabel: route.origin,
                        originCity: route.city,
                        destLabel: route.dest,
                        destCity: route.city,
                      })
                    }
                    style={[
                      styles.quickChip,
                      {
                        backgroundColor: theme.colors.surfaceMuted,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                      {route.origin} â†’ {route.dest}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </Section>

            <Section
              icon="calendar-outline"
              title="GÃ¼nler"
              action={
                <AppText variant="caption" color="primaryDeep">
                  {weekdaySummary(draft.weekdays)}
                </AppText>
              }
            >
              <View style={styles.dayRow}>
                {WEEKDAYS.map((day) => {
                  const active = draft.weekdays.includes(day.value);
                  return (
                    <Pressable
                      key={day.value}
                      accessibilityRole="button"
                      accessibilityLabel={day.long}
                      accessibilityState={{ selected: active }}
                      onPress={() => toggleDay(day.value)}
                      style={[
                        styles.dayCell,
                        {
                          backgroundColor: active
                            ? theme.colors.primary
                            : theme.colors.surfaceMuted,
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                        },
                      ]}
                    >
                      <AppText
                        variant="caption"
                        style={{ color: active ? '#FFFFFF' : theme.colors.textSecondary }}
                      >
                        {day.short}
                      </AppText>
                      <View
                        style={[
                          styles.dayDot,
                          {
                            backgroundColor: active
                              ? 'rgba(255,255,255,0.85)'
                              : theme.colors.borderStrong,
                          },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.presetRow}>
                {DAY_PRESETS.map((item) => {
                  const active = preset === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => patch({ weekdays: item.days })}
                      style={[
                        styles.quickChip,
                        {
                          backgroundColor: active
                            ? theme.colors.primarySoft
                            : theme.colors.surfaceMuted,
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={active ? 'checkmark-circle' : 'ellipse-outline'}
                        size={12}
                        color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
                      />
                      <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                        {item.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section icon="time-outline" title="Saatler">
              <View style={styles.split}>
                <TextField
                  label="KalkÄ±ÅŸ"
                  placeholder="08:00"
                  value={draft.departTime}
                  onChangeText={(value) => patch({ departTime: normalizeTimeInput(value) })}
                  keyboardType="number-pad"
                  maxLength={5}
                  containerStyle={styles.flex}
                />
                <TextField
                  label="DÃ¶nÃ¼ÅŸ (isteÄŸe baÄŸlÄ±)"
                  placeholder="18:00"
                  value={draft.returnTime}
                  onChangeText={(value) => patch({ returnTime: normalizeTimeInput(value) })}
                  keyboardType="number-pad"
                  maxLength={5}
                  containerStyle={styles.flex}
                />
              </View>
              {!draft.returnTime ? (
                <View style={styles.presetRow}>
                  <AppText variant="caption" color="textTertiary">
                    KalkÄ±ÅŸ:
                  </AppText>
                  {DEPART_TIME_SUGGESTIONS.map((time) => (
                    <TimeChip
                      key={time}
                      label={time}
                      active={draft.departTime === time}
                      onPress={() => patch({ departTime: time })}
                    />
                  ))}
                </View>
              ) : (
                <View style={styles.presetRow}>
                  <AppText variant="caption" color="textTertiary">
                    DÃ¶nÃ¼ÅŸ:
                  </AppText>
                  {RETURN_TIME_SUGGESTIONS.map((time) => (
                    <TimeChip
                      key={time}
                      label={time}
                      active={draft.returnTime === time}
                      onPress={() => patch({ returnTime: time })}
                    />
                  ))}
                </View>
              )}
            </Section>

            <Section icon="options-outline" title="Detaylar">
              <View style={styles.counterRow}>
                <View style={styles.flex}>
                  <AppText variant="label">Koltuk sayÄ±sÄ±</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {draft.role === 'driver' ? 'AÃ§acaÄŸÄ±n koltuk' : 'Ä°htiyacÄ±n olan koltuk'}
                  </AppText>
                </View>
                <View style={styles.counter}>
                  <StepButton
                    icon="remove"
                    label="Koltuk azalt"
                    disabled={draft.seats <= 1}
                    onPress={() => patch({ seats: Math.max(1, draft.seats - 1) })}
                  />
                  <AppText variant="title" style={styles.counterValue}>
                    {draft.seats}
                  </AppText>
                  <StepButton
                    icon="add"
                    label="Koltuk artÄ±r"
                    disabled={draft.seats >= 8}
                    onPress={() => patch({ seats: Math.min(8, draft.seats + 1) })}
                  />
                </View>
              </View>

              {draft.role === 'driver' ? (
                <>
                  <TextField
                    label="Koltuk baÅŸÄ±na bedel (â‚º)"
                    placeholder="Ã–rn. 25"
                    value={draft.price}
                    onChangeText={(price) => patch({ price })}
                    keyboardType="decimal-pad"
                    leftIcon="wallet-outline"
                    hint="BoÅŸ bÄ±rakÄ±rsan yalnÄ±zca masraf paylaÅŸÄ±mÄ± ilanÄ± Ã¼retilir."
                  />
                  <View style={styles.vehicleBox}>
                    <AppText variant="caption" color="textSecondary">
                      AraÃ§
                    </AppText>
                    {usableVehicles.length === 0 ? (
                      <View
                        style={[
                          styles.vehicleEmpty,
                          {
                            borderColor: theme.colors.border,
                            backgroundColor: theme.colors.surfaceMuted,
                          },
                        ]}
                      >
                        <Ionicons name="car-outline" size={18} color={theme.colors.textTertiary} />
                        <View style={styles.flex}>
                          <AppText variant="label">OnaylÄ± araÃ§ yok</AppText>
                          <AppText variant="caption" color="textTertiary">
                            SÃ¼rÃ¼cÃ¼ planÄ± iÃ§in garajÄ±ndan onaylÄ± bir araÃ§ seÃ§melisin.
                          </AppText>
                        </View>
                        <Button
                          label="Garaj"
                          size="sm"
                          variant="secondary"
                          fullWidth={false}
                          onPress={onOpenGarage}
                        />
                      </View>
                    ) : (
                      usableVehicles.map((vehicle) => {
                        const active = draft.vehicleId === vehicle.id;
                        return (
                          <Pressable
                            key={vehicle.id}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: active }}
                            onPress={() => patch({ vehicleId: vehicle.id })}
                            style={[
                              styles.vehicle,
                              {
                                backgroundColor: active
                                  ? theme.colors.primarySoft
                                  : theme.colors.surfaceMuted,
                                borderColor: active ? theme.colors.primary : theme.colors.border,
                              },
                            ]}
                          >
                            <Ionicons
                              name="car-sport-outline"
                              size={17}
                              color={active ? theme.colors.primaryDeep : theme.colors.textSecondary}
                            />
                            <View style={styles.flex}>
                              <AppText variant="label" color={active ? 'primaryDeep' : 'text'}>
                                {vehicle.make} {vehicle.model}
                              </AppText>
                              <AppText variant="caption" color="textTertiary">
                                {vehicle.plate} Â· {vehicle.color} Â· {vehicle.seat_capacity} koltuk
                              </AppText>
                            </View>
                            {active ? (
                              <Ionicons
                                name="checkmark-circle"
                                size={18}
                                color={theme.colors.primary}
                              />
                            ) : null}
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                </>
              ) : null}

              <SwitchRow
                icon="ban-outline"
                label="SigarasÄ±z araÃ§"
                value={draft.noSmoking}
                onChange={(noSmoking) => patch({ noSmoking })}
              />
              <SwitchRow
                icon="shield-checkmark-outline"
                label="YalnÄ±zca kadÄ±n yolcular"
                value={draft.womenOnly}
                onChange={(womenOnly) => patch({ womenOnly })}
              />
            </Section>

            {localError || error ? (
              <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
                <AppText variant="caption" color="danger" style={styles.flex}>
                  {localError ?? error}
                </AppText>
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.colors.divider }]}>
            <Button
              label={plan ? 'DeÄŸiÅŸiklikleri kaydet' : 'PlanÄ± oluÅŸtur'}
              loading={saving}
              onPress={handleSubmit}
              leftIcon={
                <Ionicons
                  name={plan ? 'checkmark' : 'add'}
                  size={17}
                  color={theme.colors.onPrimary}
                />
              }
            />
            <AppText variant="caption" color="textTertiary" align="center">
              Ä°lanlar her gÃ¼n otomatik Ã¼retilir; duraklatÄ±lan gÃ¼nler atlanÄ±r.
            </AppText>
          </View>
        </View>
      </Animated.View>

      <SelectSheet
        visible={cityTarget != null}
        title={cityTarget === 'dest' ? 'VarÄ±ÅŸ ÅŸehri' : 'KalkÄ±ÅŸ ÅŸehri'}
        options={PROVINCES}
        value={cityTarget === 'dest' ? draft.destCity : draft.originCity}
        onSelect={(city) => {
          patch(cityTarget === 'dest' ? { destCity: city } : { originCity: city });
          setCityTarget(null);
        }}
        onClose={() => setCityTarget(null)}
      />
    </Modal>
  );
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
      ]}
    >
      <View style={styles.sectionHead}>
        <View style={[styles.sectionIcon, { backgroundColor: theme.colors.surface }]}>
          <Ionicons name={icon} size={15} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="label" style={styles.flex}>
          {title}
        </AppText>
        {action}
      </View>
      {children}
    </View>
  );
}

function RoleTile({
  active,
  icon,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.roleTile,
        {
          backgroundColor: active ? theme.colors.surface : theme.colors.surfaceMuted,
          borderColor: active ? theme.colors.primary : theme.colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.roleIcon,
          { backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted },
        ]}
      >
        <Ionicons
          name={icon}
          size={17}
          color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
        />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" color={active ? 'primaryDeep' : 'text'}>
          {title}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      {active ? <Ionicons name="checkmark-circle" size={17} color={theme.colors.primary} /> : null}
    </Pressable>
  );
}

function CityButton({ city, onPress }: { city: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Åehir: ${city}. DeÄŸiÅŸtir`}
      onPress={onPress}
      style={[styles.cityButton, { backgroundColor: theme.colors.surfaceMuted }]}
    >
      <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
        {city}
      </AppText>
      <Ionicons name="chevron-down" size={12} color={theme.colors.primaryDeep} />
    </Pressable>
  );
}

function TimeChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.quickChip,
        {
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
          borderColor: active ? theme.colors.primary : theme.colors.border,
        },
      ]}
    >
      <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.stepBtn,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={theme.colors.primaryDeep} />
    </Pressable>
  );
}

function SwitchRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: IconName;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.switchRow}>
      <Ionicons name={icon} size={15} color={theme.colors.textSecondary} />
      <AppText variant="body" color="textSecondary" style={styles.flex}>
        {label}
      </AppText>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primarySoft }}
        thumbColor={value ? theme.colors.primary : theme.colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  sheet: {
    width: '100%',
    maxWidth: 580,
    alignSelf: 'center',
    maxHeight: '92%',
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8 },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: 10, paddingBottom: 14 },
  section: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 9,
  },
  roleIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(127,140,165,0.12)',
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    padding: 8,
  },
  swap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayRow: { flexDirection: 'row', gap: 5 },
  dayCell: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    gap: 5,
  },
  dayDot: { width: 4, height: 4, borderRadius: 2 },
  split: { flexDirection: 'row', gap: 8 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  counterValue: { minWidth: 22, textAlign: 'center' },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleBox: { gap: 7 },
  vehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  vehicleEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    padding: 10,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 10,
    padding: 10,
  },
  footer: {
    gap: 8,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    maxWidth: 110,
  },
  flex: { flex: 1 },
});
