import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { centsToInput, parseMoneyToCents } from '@/features/pricing/money';
import { RideEmptyState, RideSection } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import {
  usePriceHint,
  usePublishOffer,
  useRideProfile,
  useRideVehicles,
} from '@/features/ride/hooks/use-ride';
import { fetchDrivingRoute, geocodePlace } from '@/features/ride/services/map-service';
import type {
  RideBookingMode,
  RideMode,
  RideRouteMode,
  RideScope,
  RideVisibility,
} from '@/features/ride/types';
import {
  dateInputValue,
  formatDistance,
  formatDuration,
  formatMoney,
  timeInputValue,
  toIsoFromLocal,
} from '@/features/ride/utils/format';

type StopDraft = { label: string; city: string; offset: string; isPublic: boolean };

const defaultDate = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 0);
  if (date.getMinutes() === 0) {
    date.setHours(date.getHours() + 1);
  }
  return date;
};

export default function CreateRideOfferScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const profile = useRideProfile();
  const vehicles = useRideVehicles();
  const publish = usePublishOffer();

  const initial = defaultDate();
  const [scope, setScope] = useState<RideScope>('intercity');
  const [mode, setMode] = useState<RideMode>('scheduled');
  const [routeMode, setRouteMode] = useState<RideRouteMode>('fixed');
  const [bookingMode, setBookingMode] = useState<RideBookingMode>('manual');
  const [visibility, setVisibility] = useState<RideVisibility>('public');
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [originLabel, setOriginLabel] = useState('');
  const [originCity, setOriginCity] = useState('');
  const [originDistrict, setOriginDistrict] = useState('');
  const [destLabel, setDestLabel] = useState('');
  const [destCity, setDestCity] = useState('');
  const [destDistrict, setDestDistrict] = useState('');
  const [date, setDate] = useState(dateInputValue(initial));
  const [time, setTime] = useState(timeInputValue(initial));
  const [seats, setSeats] = useState(3);
  const [price, setPrice] = useState('');
  const [luggage, setLuggage] = useState<'small' | 'medium' | 'large'>('medium');
  const [flex, setFlex] = useState(15);
  const [maxDetourKm, setMaxDetourKm] = useState('20');
  const [notes, setNotes] = useState('');
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [preferences, setPreferences] = useState({
    smoking: false,
    ac: true,
    pets: false,
    quiet: false,
    chat: 'any' as 'quiet' | 'friendly' | 'any',
    music: 'any' as 'none' | 'low' | 'any',
    breaks: false,
    charging: true,
    child_seat: false,
    women_only: false,
    accessible_required: false,
  });
  const [coords, setCoords] = useState<{
    origin: { lat: number; lng: number } | null;
    dest: { lat: number; lng: number } | null;
  }>({ origin: null, dest: null });
  const [geoBusy, setGeoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    distanceMeters: number;
    durationMinutes: number;
    origin: { lat: number; lng: number };
    dest: { lat: number; lng: number };
  } | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const priceHint = usePriceHint(routeInfo?.distanceMeters ?? null, seats);
  const fareHint = priceHint.data?.available === true ? priceHint.data : null;
  const fareHintReason = priceHint.data?.available === false ? priceHint.data.reason : null;

  const approvedVehicles = useMemo(
    () =>
      (vehicles.data ?? []).filter((vehicle) => vehicle.status === 'approved' && vehicle.is_active),
    [vehicles.data],
  );
  const selectedVehicle =
    approvedVehicles.find((vehicle) => vehicle.id === vehicleId) ?? approvedVehicles[0] ?? null;
  const totalSeats = selectedVehicle?.seat_capacity ?? 4;
  const ready =
    profile.data?.identity_status === 'approved' && profile.data?.driver_status === 'approved';

  const resolveCoords = async () => {
    setGeoBusy(true);
    try {
      const [originResult, destResult] = await Promise.all([
        geocodePlace(`${originLabel}, ${originCity}`),
        geocodePlace(`${destLabel}, ${destCity}`),
      ]);
      const resolved = {
        origin: originResult.ok ? { lat: originResult.data.lat, lng: originResult.data.lng } : null,
        dest: destResult.ok ? { lat: destResult.data.lat, lng: destResult.data.lng } : null,
      };
      setCoords(resolved);
      return resolved;
    } finally {
      setGeoBusy(false);
    }
  };

  const calculateRoute = async () => {
    setRouteBusy(true);
    setError(null);
    try {
      const resolved = coords.origin && coords.dest ? coords : await resolveCoords();
      if (!resolved.origin || !resolved.dest) {
        setError(
          'Kalkış ve varış için koordinat bulunamadı. Şehir ve nokta bilgisini kontrol edip tekrar dene.',
        );
        return;
      }
      const route = await fetchDrivingRoute(resolved.origin, resolved.dest);
      if (!route.ok) {
        setError(
          route.reason === 'map_token_missing'
            ? 'Harita yapılandırılmadığı için mesafe hesaplanamadı.'
            : 'Güzergâh hesaplanamadı. Adresleri kontrol edip tekrar dene.',
        );
        return;
      }
      setRouteInfo({
        distanceMeters: route.data.distanceMeters,
        durationMinutes: route.data.durationMinutes,
        origin: resolved.origin,
        dest: resolved.dest,
      });
    } finally {
      setRouteBusy(false);
    }
  };

  const togglePreference = (key: keyof typeof preferences) => {
    setPreferences((current) => ({ ...current, [key]: !current[key] }));
  };

  const handlePublish = async () => {
    setError(null);
    if (!selectedVehicle) {
      setError('Onaylanmış bir araç seçmelisin.');
      return;
    }
    if (!originLabel.trim() || !originCity.trim() || !destLabel.trim() || !destCity.trim()) {
      setError('Kalkış ve varış noktalarını şehir bilgisiyle doldur.');
      return;
    }
    const departAt = toIsoFromLocal(date, time);
    if (!departAt) {
      setError('Tarih YYYY-AA-GG, saat SS:DD biçiminde olmalı.');
      return;
    }
    if (new Date(departAt).getTime() < Date.now() - 15 * 60_000) {
      setError('Kalkış zamanı geçmişte olamaz.');
      return;
    }
    const cents = parseMoneyToCents(price);
    if (cents == null || cents <= 0) {
      setError('Geçerli bir koltuk bedeli gir.');
      return;
    }
    if (routeMode === 'flexible' && Number(maxDetourKm) <= 0) {
      setError('Esnek güzergâhta kabul edilen en fazla sapma mesafesini gir.');
      return;
    }
    try {
      const resolved = coords.origin && coords.dest ? coords : await resolveCoords();
      const offer = await publish.mutateAsync({
        scope,
        mode,
        vehicleId: selectedVehicle.id,
        originLabel: originLabel.trim(),
        originCity: originCity.trim(),
        originDistrict: originDistrict.trim() || null,
        originLat: resolved.origin?.lat ?? null,
        originLng: resolved.origin?.lng ?? null,
        destLabel: destLabel.trim(),
        destCity: destCity.trim(),
        destDistrict: destDistrict.trim() || null,
        destLat: resolved.dest?.lat ?? null,
        destLng: resolved.dest?.lng ?? null,
        departAt,
        departFlexMinutes: flex,
        seatsTotal: Math.min(seats, totalSeats),
        pricePerSeatCents: cents,
        luggage,
        preferences,
        routeMode,
        maxDetourMeters: routeMode === 'flexible' ? Math.round(Number(maxDetourKm) * 1000) : null,
        maxDetourMinutes: null,
        bookingMode,
        visibility,
        notes: notes.trim() || null,
        stops: stops
          .filter((stop) => stop.label.trim())
          .map((stop) => ({
            label: stop.label.trim(),
            city: stop.city.trim() || null,
            arrive_offset_minutes: stop.offset ? Number(stop.offset) : null,
            is_public: stop.isPublic,
          })),
      });
      router.replace(`/ride/offers/${offer.id}` as never);
    } catch (cause) {
      setError(errorMessage(cause, 'İlan yayınlanamadı.'));
    }
  };

  if (vehicles.isLoading || profile.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
        <RideHeader title="Yolculuk paylaş" />
        <Card padding={18}>
          <AppText variant="body" color="textSecondary">
            Hazırlanıyor…
          </AppText>
        </Card>
      </Screen>
    );
  }

  if (!ready) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
        <RideHeader title="Yolculuk paylaş" />
        <RideEmptyState
          icon="shield-outline"
          title="Sürücü doğrulaması gerekli"
          message="İlan yayınlamak için kimlik doğrulaması ve sürücü başvurusunun onaylanması gerekir. Belgelerin incelendikten sonra bu ekran açılır."
          action={
            <View style={styles.stack}>
              <Button
                label={
                  profile.data?.driver_status === 'pending'
                    ? 'Başvuru durumunu gör'
                    : 'Sürücü başvurusu yap'
                }
                onPress={() => router.navigate('/ride/verification' as never)}
              />
              <Button
                label="Garajım"
                variant="secondary"
                onPress={() => router.navigate('/ride/garage' as never)}
              />
            </View>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Yolculuk paylaş"
        subtitle="Sürücü ilanı · gerçek doğrulama ve koltuk kapasitesi"
      />

      <View style={styles.optionRow}>
        {(['intracity', 'intercity'] as RideScope[]).map((item) => {
          const active = scope === item;
          return (
            <Pressable
              key={item}
              onPress={() => setScope(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.option,
                {
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                },
              ]}
            >
              <Ionicons
                name={item === 'intracity' ? 'business-outline' : 'trail-sign-outline'}
                size={16}
                color={active ? theme.colors.primaryDeep : theme.colors.textSecondary}
              />
              <AppText variant="label" color={active ? 'primaryDeep' : 'textSecondary'}>
                {item === 'intracity' ? 'Şehir içi' : 'Şehirler arası'}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <Card padding={16} style={styles.form}>
        <RideSection
          bare
          title="Güzergâh"
          subtitle="Harita sağlayıcısı varsa koordinatlar gerçek adresten çözülür."
        >
          <View style={styles.fieldGroup}>
            <AppText variant="caption" color="textSecondary">
              Kalkış
            </AppText>
            <TextInput
              value={originLabel}
              onChangeText={setOriginLabel}
              placeholder="Mahalle, cadde veya buluşma noktası"
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
            <View style={styles.split}>
              <TextInput
                value={originCity}
                onChangeText={setOriginCity}
                placeholder="Şehir"
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
                value={originDistrict}
                onChangeText={setOriginDistrict}
                placeholder="İlçe"
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
          </View>

          <View style={styles.fieldGroup}>
            <AppText variant="caption" color="textSecondary">
              Varış
            </AppText>
            <TextInput
              value={destLabel}
              onChangeText={setDestLabel}
              placeholder="Mahalle, cadde veya varış noktası"
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
            <View style={styles.split}>
              <TextInput
                value={destCity}
                onChangeText={setDestCity}
                placeholder="Şehir"
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
                value={destDistrict}
                onChangeText={setDestDistrict}
                placeholder="İlçe"
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
          </View>

          <Button
            label={geoBusy ? 'Adresler çözülüyor…' : 'Adresleri koordinata çevir'}
            variant="secondary"
            size="sm"
            loading={geoBusy}
            onPress={() => void resolveCoords()}
          />
          <AppText variant="caption" color="textTertiary">
            {coords.origin && coords.dest
              ? 'Kalkış ve varış koordinatları hazır. Kesin adres yalnızca onaylı rezervasyonu olan yolculara gösterilir.'
              : 'Harita anahtarı yoksa koordinat boş kalır ve sunucu mesafeyi hesaplayamaz; sahte mesafe gösterilmez.'}
          </AppText>
        </RideSection>

        <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

        <View style={styles.fieldGroup}>
          <AppText variant="label">Tarih ve saat</AppText>
          <View style={styles.split}>
            <TextInput
              value={date}
              onChangeText={setDate}
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
            <TextInput
              value={time}
              onChangeText={setTime}
              placeholder="SS:DD"
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
          <View style={styles.chips}>
            {(['instant', 'scheduled'] as RideMode[]).map((item) => {
              const active = mode === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setMode(item)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.colors.accent : theme.colors.border,
                      backgroundColor: active ? theme.colors.accentSoft : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'accent' : 'textSecondary'}>
                    {item === 'instant' ? 'Anlık' : 'Planlı'}
                  </AppText>
                </Pressable>
              );
            })}
            <AppText variant="caption" color="textTertiary" style={styles.flex}>
              ± {flex} dk esneklik
            </AppText>
            <Stepper value={flex} onChange={setFlex} min={0} max={120} step={5} suffix="dk" />
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

        <View style={styles.fieldGroup}>
          <AppText variant="label">Ara duraklar</AppText>
          <AppText variant="caption" color="textTertiary">
            Şehirler arası güzergâhta ara durak ekleyebilirsin. Duraklar koltuk bölümlerini
            belirler; her bölümün kapasitesi ayrı hesaplanır.
          </AppText>
          {stops.map((stop, index) => (
            <View key={index} style={[styles.stopCard, { borderColor: theme.colors.border }]}>
              <View style={styles.split}>
                <TextInput
                  value={stop.label}
                  onChangeText={(value) =>
                    setStops((current) =>
                      current.map((item, i) => (i === index ? { ...item, label: value } : item)),
                    )
                  }
                  placeholder={`${index + 1}. durak`}
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
                  value={stop.offset}
                  onChangeText={(value) =>
                    setStops((current) =>
                      current.map((item, i) => (i === index ? { ...item, offset: value } : item)),
                    )
                  }
                  placeholder="+dk"
                  keyboardType="number-pad"
                  placeholderTextColor={theme.colors.textTertiary}
                  style={[
                    styles.input,
                    styles.smallInput,
                    {
                      color: theme.colors.text,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.inputBackground,
                    },
                  ]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Durağı kaldır"
                  onPress={() => setStops((current) => current.filter((_, i) => i !== index))}
                  style={styles.iconSmall}
                >
                  <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
                </Pressable>
              </View>
            </View>
          ))}
          {stops.length < 7 ? (
            <Button
              label="Ara durak ekle"
              variant="ghost"
              size="sm"
              leftIcon={<Ionicons name="add" size={16} color={theme.colors.primaryDeep} />}
              onPress={() =>
                setStops((current) => [
                  ...current,
                  { label: '', city: '', offset: '', isPublic: true },
                ])
              }
            />
          ) : null}
        </View>
      </Card>

      <Card padding={16} style={styles.form}>
        <RideSection
          bare
          title="Araç, koltuk ve bedel"
          subtitle="Yalnızca onaylanmış araçlar yayınlanabilir."
        >
          {approvedVehicles.length === 0 ? (
            <View style={styles.stack}>
              <AppText variant="body" color="textSecondary">
                Onaylanmış araç yok.
              </AppText>
              <Button
                label="Garajıma araç ekle"
                onPress={() => router.navigate('/ride/garage/create' as never)}
              />
            </View>
          ) : (
            <View style={styles.stack}>
              {approvedVehicles.map((vehicle) => {
                const active = selectedVehicle?.id === vehicle.id;
                return (
                  <Pressable
                    key={vehicle.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => setVehicleId(vehicle.id)}
                    style={[
                      styles.vehicleOption,
                      {
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active
                          ? theme.colors.primarySoft
                          : theme.colors.surfaceMuted,
                      },
                    ]}
                  >
                    <Ionicons name="car-sport-outline" size={18} color={theme.colors.primaryDeep} />
                    <View style={styles.flex}>
                      <AppText variant="label">
                        {vehicle.make} {vehicle.model}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {vehicle.plate} · {vehicle.seat_capacity} koltuk · {vehicle.color}
                      </AppText>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={18} color={theme.colors.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
              <Pressable onPress={() => router.navigate('/ride/garage' as never)}>
                <AppText variant="caption" color="primaryDeep">
                  Garajı yönet →
                </AppText>
              </Pressable>
            </View>
          )}

          <View style={styles.counterRow}>
            <AppText variant="body" color="textSecondary">
              Boş koltuk
            </AppText>
            <View style={styles.counter}>
              <Pressable
                onPress={() => setSeats((value) => Math.max(1, value - 1))}
                style={[styles.stepBtn, { borderColor: theme.colors.border }]}
              >
                <Ionicons name="remove" size={15} color={theme.colors.text} />
              </Pressable>
              <AppText variant="h3">{Math.min(seats, totalSeats)}</AppText>
              <Pressable
                onPress={() => setSeats((value) => Math.min(totalSeats, value + 1))}
                style={[styles.stepBtn, { borderColor: theme.colors.border }]}
              >
                <Ionicons name="add" size={15} color={theme.colors.text} />
              </Pressable>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <AppText variant="caption" color="textSecondary">
              Koltuk başına bedel (₺)
            </AppText>
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="0,00"
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
            <AppText variant="caption" color="textTertiary">
              Masraf paylaşımı ilanıdır. Ticari taşımacılık için gerekli yetki belgeleri olmadan
              ücretli ticari hizmet olarak sunulamaz.
            </AppText>
          </View>

          <Card padding={13} tone="muted" style={styles.calcCard}>
            <View style={styles.calcHead}>
              <View
                style={[styles.calcIcon, { backgroundColor: theme.colors.primarySoft }]}
              >
                <Ionicons name="calculator-outline" size={16} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.flex}>
                <AppText variant="label">Yolculuk maliyeti hesaplayıcı</AppText>
                <AppText variant="caption" color="textTertiary">
                  Mesafe ve koltuk sayısına göre yardımcı öneri
                </AppText>
              </View>
              <Button
                label={routeBusy ? 'Hesaplanıyor…' : 'Hesapla'}
                size="sm"
                variant="secondary"
                fullWidth={false}
                loading={routeBusy || geoBusy}
                onPress={() => void calculateRoute()}
              />
            </View>

            {routeInfo ? (
              <View style={styles.calcGrid}>
                <View style={styles.calcMetric}>
                  <AppText variant="caption" color="textTertiary">
                    Mesafe
                  </AppText>
                  <AppText variant="label">{formatDistance(routeInfo.distanceMeters)}</AppText>
                </View>
                <View style={styles.calcMetric}>
                  <AppText variant="caption" color="textTertiary">
                    Tahmini süre
                  </AppText>
                  <AppText variant="label">{formatDuration(routeInfo.durationMinutes)}</AppText>
                </View>
                <View style={styles.calcMetric}>
                  <AppText variant="caption" color="textTertiary">
                    Koltuk
                  </AppText>
                  <AppText variant="label">{Math.min(seats, totalSeats)}</AppText>
                </View>
              </View>
            ) : null}

            {priceHint.isLoading ? (
              <AppText variant="caption" color="textTertiary">
                Maliyet önerisi alınıyor…
              </AppText>
            ) : priceHint.isError ? (
              <AppText variant="caption" color="textTertiary">
                Maliyet önerisi alınamadı: {priceHint.error.message}
              </AppText>
            ) : fareHint ? (
              <View style={styles.hintBox}>
                <View style={styles.hintHead}>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">
                      {formatMoney(fareHint.per_seat_cents)} / koltuk
                    </AppText>
                    <AppText variant="caption" color="textSecondary">
                      Aralık {formatMoney(fareHint.suggested_min_cents)} –{' '}
                      {formatMoney(fareHint.suggested_max_cents)} · Toplam{' '}
                      {formatMoney(fareHint.estimated_cost_cents)}
                    </AppText>
                  </View>
                  <Button
                    label="Öneriyi uygula"
                    size="sm"
                    variant="primary"
                    fullWidth={false}
                    onPress={() => setPrice(centsToInput(fareHint.per_seat_cents))}
                  />
                </View>
                <AppText variant="caption" color="textTertiary">
                  {fareHint.formula} · {fareHint.distance_km} km
                </AppText>
              </View>
            ) : fareHintReason ? (
              <AppText variant="caption" color="textTertiary">
                {fareHintReason}
              </AppText>
            ) : (
              <AppText variant="caption" color="textTertiary">
                Kalkış ve varış noktalarını doldurup “Hesapla” ile gerçek mesafeyi al.
              </AppText>
            )}

            <AppText variant="caption" color="textTertiary">
              Bu bir yardımcı maliyet tahminidir; yasal fiyat sınırı veya zorunlu tarife değildir.
            </AppText>
          </Card>

          <View style={styles.chips}>
            {(['small', 'medium', 'large'] as const).map((item) => {
              const active = luggage === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setLuggage(item)}
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
                    {item === 'small'
                      ? 'Küçük bagaj'
                      : item === 'medium'
                        ? 'Orta bagaj'
                        : 'Büyük bagaj'}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </RideSection>
      </Card>

      <Card padding={16} style={styles.form}>
        <RideSection
          bare
          title="Rota ve rezervasyon"
          subtitle="Rota değişiklikleri sürücü onayı ve etkilenen yolcu onayıyla uygulanır."
        >
          <View style={styles.chips}>
            {(['fixed', 'flexible'] as RideRouteMode[]).map((item) => {
              const active = routeMode === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setRouteMode(item)}
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
                    {item === 'fixed' ? 'Sabit güzergâh' : 'Esnek güzergâh'}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {routeMode === 'flexible' ? (
            <View style={styles.fieldGroup}>
              <AppText variant="caption" color="textSecondary">
                Kabul edilen en fazla sapma (km)
              </AppText>
              <TextInput
                value={maxDetourKm}
                onChangeText={setMaxDetourKm}
                keyboardType="decimal-pad"
                placeholder="20"
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
            </View>
          ) : null}

          <View style={styles.chips}>
            {(['manual', 'auto'] as RideBookingMode[]).map((item) => {
              const active = bookingMode === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setBookingMode(item)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.colors.accent : theme.colors.border,
                      backgroundColor: active ? theme.colors.accentSoft : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'accent' : 'textSecondary'}>
                    {item === 'manual' ? 'Manuel onay' : 'Otomatik onay'}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.chips}>
            {(['public', 'friends', 'private'] as RideVisibility[]).map((item) => {
              const active = visibility === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setVisibility(item)}
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
                    {item === 'public'
                      ? 'Herkese açık'
                      : item === 'friends'
                        ? 'Bağlantılar'
                        : 'Özel'}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <AppText variant="caption" color="textTertiary">
            Özel ve bağlantılara açık ilanlar herkese açık aramada görünmez.
          </AppText>
        </RideSection>
      </Card>

      <Card padding={16} style={styles.form}>
        <RideSection
          bare
          title="Yolculuk tercihleri"
          subtitle="Zorunlu güvenlik ve erişilebilirlik koşulları eşleştirmede korunur."
        >
          {[
            { key: 'smoking' as const, label: 'Sigara içilebilir', icon: 'flame-outline' as const },
            { key: 'ac' as const, label: 'Klima', icon: 'snow-outline' as const },
            {
              key: 'pets' as const,
              label: 'Evcil hayvan kabul edilir',
              icon: 'paw-outline' as const,
            },
            {
              key: 'quiet' as const,
              label: 'Sessiz yolculuk',
              icon: 'volume-mute-outline' as const,
            },
            { key: 'breaks' as const, label: 'Mola verilebilir', icon: 'cafe-outline' as const },
            {
              key: 'charging' as const,
              label: 'Telefon şarjı',
              icon: 'battery-charging-outline' as const,
            },
            { key: 'child_seat' as const, label: 'Çocuk koltuğu', icon: 'happy-outline' as const },
            {
              key: 'women_only' as const,
              label: 'Yalnızca kadın yolcular',
              icon: 'woman-outline' as const,
            },
            {
              key: 'accessible_required' as const,
              label: 'Erişilebilirlik gerekli',
              icon: 'accessibility-outline' as const,
            },
          ].map((item) => (
            <View key={item.key} style={styles.switchRow}>
              <Ionicons name={item.icon} size={16} color={theme.colors.textTertiary} />
              <AppText variant="body" color="textSecondary" style={styles.flex}>
                {item.label}
              </AppText>
              <Switch
                value={preferences[item.key]}
                onValueChange={() => togglePreference(item.key)}
                trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
                thumbColor={
                  preferences[item.key] ? theme.colors.primary : theme.colors.textTertiary
                }
              />
            </View>
          ))}
          <View style={styles.chips}>
            {(['any', 'friendly', 'quiet'] as const).map((item) => (
              <Pressable
                key={item}
                onPress={() => setPreferences((current) => ({ ...current, chat: item }))}
                style={[
                  styles.chip,
                  {
                    borderColor:
                      preferences.chat === item ? theme.colors.primary : theme.colors.border,
                    backgroundColor:
                      preferences.chat === item
                        ? theme.colors.primarySoft
                        : theme.colors.surfaceMuted,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={preferences.chat === item ? 'primaryDeep' : 'textSecondary'}
                >
                  {item === 'any'
                    ? 'Sohbet serbest'
                    : item === 'friendly'
                      ? 'Sohbet edelim'
                      : 'Sessiz'}
                </AppText>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Yolculara not (buluşma noktası, bagaj, mola vb.)"
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            style={[
              styles.input,
              styles.noteInput,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
        </RideSection>
      </Card>

      {error ? (
        <Card padding={12} tone="muted">
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        </Card>
      ) : null}

      <Card padding={12} tone="primarySoft">
        <View style={styles.inlineRow}>
          <Ionicons name="information-circle-outline" size={16} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Kimlik ve sürücü doğrulaman onaylı. İlan yayınlandığında koşul sürümü kaydedilir ve
            rezervasyonlar bu koşullara göre oluşturulur.
          </AppText>
          <Badge label="Doğrulanmış" tone="success" />
        </View>
      </Card>

      <Button
        label="İlanı yayınla"
        size="lg"
        leftIcon={<Ionicons name="rocket-outline" size={18} color="#FFFFFF" />}
        loading={publish.isPending}
        disabled={!selectedVehicle || approvedVehicles.length === 0}
        onPress={() => void handlePublish()}
      />
      <AppText variant="caption" color="textTertiary" align="center">
        Yayınlanan ilan gerçek veritabanına yazılır. Sahte ilan veya sahte rezervasyon oluşturulmaz.
      </AppText>
    </Screen>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.counter}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepBtn, { borderColor: theme.colors.border }]}
      >
        <Ionicons name="remove" size={14} color={theme.colors.text} />
      </Pressable>
      <AppText variant="label">
        {value}
        {suffix ? ` ${suffix}` : ''}
      </AppText>
      <Pressable
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepBtn, { borderColor: theme.colors.border }]}
      >
        <Ionicons name="add" size={14} color={theme.colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: 8 },
  form: { gap: 14 },
  optionRow: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 13,
    borderWidth: 1,
    paddingVertical: 10,
  },
  fieldGroup: { gap: 7 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  smallInput: { width: 72 },
  noteInput: { minHeight: 74, textAlignVertical: 'top' },
  split: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  stopCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 8 },
  iconSmall: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  vehicleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 12,
    borderWidth: 1,
    padding: 11,
  },
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calcCard: { gap: 10 },
  calcHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  calcIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calcGrid: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  calcMetric: { flexBasis: '30%', flexGrow: 1, gap: 1 },
  hintBox: { gap: 6, padding: 10, borderRadius: 12 },
  hintHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
