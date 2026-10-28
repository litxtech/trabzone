import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import {
  usePauseRecurringDay,
  useRecurring,
  useRemoveRecurring,
  useRideVehicles,
  useSaveRecurring,
} from '@/features/ride/hooks/use-ride';
import { geocodePlace } from '@/features/ride/services/map-service';
import type { RideRecurring, RideScope } from '@/features/ride/types';
import {
  dateInputValue,
  formatMoney,
  SCOPE_LABEL,
  weekdayLabels,
} from '@/features/ride/utils/format';

const DAYS = [
  { value: 1, label: 'Pzt' },
  { value: 2, label: 'Sal' },
  { value: 3, label: 'Çar' },
  { value: 4, label: 'Per' },
  { value: 5, label: 'Cum' },
  { value: 6, label: 'Cmt' },
  { value: 7, label: 'Paz' },
];

export default function RideRecurringScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const recurring = useRecurring();
  const vehicles = useRideVehicles();
  const save = useSaveRecurring();
  const remove = useRemoveRecurring();
  const pause = usePauseRecurringDay();

  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState<'driver' | 'passenger'>('passenger');
  const [scope, setScope] = useState<RideScope>('intracity');
  const [originLabel, setOriginLabel] = useState('');
  const [originCity, setOriginCity] = useState('');
  const [destLabel, setDestLabel] = useState('');
  const [destCity, setDestCity] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [departTime, setDepartTime] = useState('08:00');
  const [returnTime, setReturnTime] = useState('');
  const [seats, setSeats] = useState(1);
  const [price, setPrice] = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [womenOnly, setWomenOnly] = useState(false);
  const [noSmoking, setNoSmoking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pausedDate, setPausedDate] = useState(dateInputValue(new Date()));

  const toggleDay = (value: number) => {
    setWeekdays((current) =>
      current.includes(value) ? current.filter((day) => day !== value) : [...current, value].sort(),
    );
  };

  const handleSave = async () => {
    setError(null);
    if (!originLabel.trim() || !destLabel.trim() || !originCity.trim() || !destCity.trim()) {
      setError('Güzergâh ve şehir alanlarını doldur.');
      return;
    }
    if (weekdays.length === 0) {
      setError('En az bir gün seç.');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(departTime)) {
      setError('Kalkış saatini SS:DD biçiminde gir.');
      return;
    }
    if (role === 'driver' && !vehicleId) {
      setError('Sürücü düzenli yolculuğu için onaylı bir araç seç.');
      return;
    }
    try {
      const [originResult, destResult] = await Promise.all([
        geocodePlace(`${originLabel}, ${originCity}`),
        geocodePlace(`${destLabel}, ${destCity}`),
      ]);
      await save.mutateAsync({
        role,
        scope,
        originLabel: originLabel.trim(),
        originCity: originCity.trim(),
        originLat: originResult.ok ? originResult.data.lat : null,
        originLng: originResult.ok ? originResult.data.lng : null,
        destLabel: destLabel.trim(),
        destCity: destCity.trim(),
        destLat: destResult.ok ? destResult.data.lat : null,
        destLng: destResult.ok ? destResult.data.lng : null,
        weekdays,
        departTime,
        returnTime: returnTime.trim() || null,
        seats,
        pricePerSeatCents: price ? Math.round(Number(price.replace(',', '.')) * 100) : null,
        preferences: { women_only: womenOnly, smoking: !noSmoking },
        vehicleId: role === 'driver' ? vehicleId : null,
        luggage: 'medium',
        bookingMode: 'manual',
        visibility: 'public',
      });
      setShowForm(false);
      setOriginLabel('');
      setDestLabel('');
      setOriginCity('');
      setDestCity('');
    } catch (cause) {
      setError(errorMessage(cause, 'Düzenli yolculuk kaydedilemedi.'));
    }
  };

  const handlePause = (plan: RideRecurring) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pausedDate)) {
      setError('Duraklatma tarihi YYYY-AA-GG biçiminde olmalı.');
      return;
    }
    pause.mutate(
      { id: plan.id, date: pausedDate },
      { onError: (cause) => setError(cause.message) },
    );
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Düzenli yolculuklar"
        subtitle="Haftalık gidiş-dönüş planları ve tek gün duraklatma"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showForm ? 'Formu kapat' : 'Plan ekle'}
            onPress={() => setShowForm((value) => !value)}
            style={[
              styles.iconBtn,
              { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons
              name={showForm ? 'close' : 'add'}
              size={20}
              color={theme.colors.primaryDeep}
            />
          </Pressable>
        }
      />

      {showForm ? (
        <Card padding={15} style={styles.form}>
          <AppText variant="title">Yeni düzenli plan</AppText>
          <View style={styles.optionRow}>
            {(['passenger', 'driver'] as const).map((item) => {
              const active = role === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setRole(item)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active
                        ? theme.colors.primarySoft
                        : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                    {item === 'driver' ? 'Sürücü planı' : 'Yolcu planı'}
                  </AppText>
                </Pressable>
              );
            })}
            {(['intracity', 'intercity'] as RideScope[]).map((item) => {
              const active = scope === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setScope(item)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.colors.accent : theme.colors.border,
                      backgroundColor: active ? theme.colors.accentSoft : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'accent' : 'textSecondary'}>
                    {SCOPE_LABEL[item]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={originLabel}
            onChangeText={setOriginLabel}
            placeholder="Kalkış noktası"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <TextInput
            value={originCity}
            onChangeText={setOriginCity}
            placeholder="Kalkış şehri"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <TextInput
            value={destLabel}
            onChangeText={setDestLabel}
            placeholder="Varış noktası"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <TextInput
            value={destCity}
            onChangeText={setDestCity}
            placeholder="Varış şehri"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />

          <AppText variant="caption" color="textSecondary">
            Günler
          </AppText>
          <View style={styles.days}>
            {DAYS.map((day) => {
              const active = weekdays.includes(day.value);
              return (
                <Pressable
                  key={day.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => toggleDay(day.value)}
                  style={[
                    styles.day,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                    {day.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.split}>
            <TextInput
              value={departTime}
              onChangeText={setDepartTime}
              placeholder="08:00"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                styles.flex,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
            <TextInput
              value={returnTime}
              onChangeText={setReturnTime}
              placeholder="Dönüş 18:00"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                styles.flex,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
          </View>

          <View style={styles.counterRow}>
            <AppText variant="body" color="textSecondary">
              Koltuk
            </AppText>
            <View style={styles.counter}>
              <Pressable
                onPress={() => setSeats((value) => Math.max(1, value - 1))}
                style={[styles.stepBtn, { borderColor: theme.colors.border }]}
              >
                <Ionicons name="remove" size={14} color={theme.colors.text} />
              </Pressable>
              <AppText variant="label">{seats}</AppText>
              <Pressable
                onPress={() => setSeats((value) => Math.min(8, value + 1))}
                style={[styles.stepBtn, { borderColor: theme.colors.border }]}
              >
                <Ionicons name="add" size={14} color={theme.colors.text} />
              </Pressable>
            </View>
          </View>

          {role === 'driver' ? (
            <>
              <TextInput
                value={price}
                onChangeText={setPrice}
                placeholder="Koltuk başına bedel (₺)"
                keyboardType="decimal-pad"
                placeholderTextColor={theme.colors.textTertiary}
                style={[
                  styles.input,
                  {
                    color: theme.colors.text,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.inputBackground,
                  },
                ]}
              />
              <View style={styles.vehicles}>
                {(vehicles.data ?? [])
                  .filter((vehicle) => vehicle.status === 'approved' && vehicle.is_active)
                  .map((vehicle) => {
                    const active = vehicleId === vehicle.id;
                    return (
                      <Pressable
                        key={vehicle.id}
                        onPress={() => setVehicleId(vehicle.id)}
                        style={[
                          styles.vehicle,
                          {
                            borderColor: active ? theme.colors.primary : theme.colors.border,
                            backgroundColor: active
                              ? theme.colors.primarySoft
                              : theme.colors.surfaceMuted,
                          },
                        ]}
                      >
                        <Ionicons
                          name="car-sport-outline"
                          size={15}
                          color={theme.colors.primaryDeep}
                        />
                        <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                          {vehicle.make} {vehicle.model} · {vehicle.plate}
                        </AppText>
                      </Pressable>
                    );
                  })}
                {(vehicles.data ?? []).filter(
                  (vehicle) => vehicle.status === 'approved' && vehicle.is_active,
                ).length === 0 ? (
                  <AppText variant="caption" color="danger">
                    Onaylı araç yok. Önce garajdan araç ekle.
                  </AppText>
                ) : null}
              </View>
            </>
          ) : null}

          <View style={styles.switchRow}>
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              Sigarasız araç
            </AppText>
            <Switch
              value={noSmoking}
              onValueChange={setNoSmoking}
              trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
              thumbColor={noSmoking ? theme.colors.primary : theme.colors.textTertiary}
            />
          </View>
          <View style={styles.switchRow}>
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              Yalnızca kadın
            </AppText>
            <Switch
              value={womenOnly}
              onValueChange={setWomenOnly}
              trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
              thumbColor={womenOnly ? theme.colors.primary : theme.colors.textTertiary}
            />
          </View>

          {error ? (
            <AppText variant="caption" color="danger">
              {error}
            </AppText>
          ) : null}
          <Button label="Planı kaydet" loading={save.isPending} onPress={() => void handleSave()} />
        </Card>
      ) : null}

      {recurring.isLoading ? (
        <Card padding={18}>
          <AppText variant="body" color="textSecondary">
            Yükleniyor…
          </AppText>
        </Card>
      ) : recurring.isError ? (
        <RideEmptyState
          icon="cloud-offline-outline"
          title="Planlar yüklenemedi"
          message={recurring.error.message}
          action={
            <Button
              label="Tekrar dene"
              variant="secondary"
              onPress={() => void recurring.refetch()}
            />
          }
        />
      ) : (recurring.data?.length ?? 0) === 0 ? (
        <RideEmptyState
          icon="repeat-outline"
          title="Düzenli plan yok"
          message="İşe veya okula gidiş planını oluştur; uygun günlerde otomatik ilan üretilir."
          action={<Button label="Plan oluştur" onPress={() => setShowForm(true)} />}
        />
      ) : (
        <View style={styles.list}>
          {recurring.data?.map((plan) => (
            <Card key={plan.id} padding={14} style={styles.card}>
              <View style={styles.headRow}>
                <View
                  style={[
                    styles.mark,
                    {
                      backgroundColor:
                        plan.role === 'driver' ? theme.colors.primarySoft : theme.colors.accentSoft,
                    },
                  ]}
                >
                  <Ionicons
                    name={plan.role === 'driver' ? 'car-outline' : 'walk-outline'}
                    size={17}
                    color={plan.role === 'driver' ? theme.colors.primaryDeep : theme.colors.accent}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="label" numberOfLines={1}>
                    {plan.origin_label} → {plan.dest_label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {weekdayLabels(plan.weekdays)} · {plan.depart_time.slice(0, 5)}
                    {plan.return_time ? ` · dönüş ${plan.return_time.slice(0, 5)}` : ''}
                  </AppText>
                </View>
                <Badge
                  label={plan.is_active ? 'Aktif' : 'Pasif'}
                  tone={plan.is_active ? 'success' : 'neutral'}
                />
              </View>
              <View style={styles.badges}>
                <Badge label={SCOPE_LABEL[plan.scope]} tone="neutral" />
                <Badge label={plan.role === 'driver' ? 'Sürücü' : 'Yolcu'} tone="primary" />
                {plan.price_per_seat_cents != null ? (
                  <Badge label={formatMoney(plan.price_per_seat_cents)} tone="accent" />
                ) : null}
              </View>
              {plan.paused_dates.length ? (
                <AppText variant="caption" color="textTertiary">
                  Duraklatılan günler: {plan.paused_dates.slice(0, 6).join(', ')}
                </AppText>
              ) : null}
              <View style={styles.pauseRow}>
                <TextInput
                  value={pausedDate}
                  onChangeText={setPausedDate}
                  placeholder="YYYY-AA-GG"
                  placeholderTextColor={theme.colors.textTertiary}
                  style={[
                    styles.input,
                    styles.flex,
                    {
                      color: theme.colors.text,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.inputBackground,
                    },
                  ]}
                />
                <Button
                  label="Günü duraklat"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  loading={pause.isPending}
                  onPress={() => handlePause(plan)}
                />
              </View>
              <View style={styles.footRow}>
                <Button
                  label="Düzenle"
                  variant="ghost"
                  size="sm"
                  fullWidth={false}
                  onPress={() =>
                    router.navigate({
                      pathname: '/ride/search',
                      params: { scope: plan.scope },
                    } as never)
                  }
                />
                <View style={styles.flex} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Planı kaldır"
                  onPress={() => remove.mutate(plan.id)}
                  style={[styles.smallBtn, { backgroundColor: theme.colors.surfaceMuted }]}
                >
                  <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      )}

      <Card padding={12} tone="muted">
        <AppText variant="caption" color="textSecondary">
          Bir günü duraklatmak diğer tarihlerin rezervasyonlarını etkilemez. Otomatik üretilen
          ilanlar gerçek kapasite ve doğrulama kontrollerinden geçer.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: { gap: 9 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  days: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  day: {
    width: 42,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  split: { flexDirection: 'row', gap: 8 },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicles: { gap: 6 },
  vehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    padding: 9,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  list: { gap: 10 },
  card: { gap: 9 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pauseRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
