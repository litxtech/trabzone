import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAvailableRooms,
  useCashOverview,
  useCreateManualReservation,
  usePropertyInventory,
} from '../hooks/use-accommodation';
import type { ReservationDetail, ReservationSource } from '../types';
import {
  BOOKING_MODE_LABELS,
  SOURCE_OPTIONS,
  formatDate,
  formatMoneyCents,
  guestCount,
  nightsBetween,
  parseMoneyToCents,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  Chip,
  ChipsRow,
  DateField,
  InfoBanner,
  InlineError,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  MoneyText,
  ToggleRow,
} from './AccommodationUI';

export function ManualBookingModal({
  visible,
  onClose,
  propertyId,
  defaultDate,
  defaultRoomId,
  defaultRoomTypeId,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: string;
  defaultDate?: string | null;
  defaultRoomId?: string | null;
  defaultRoomTypeId?: string | null;
  onCreated?: (reservation: ReservationDetail) => void;
}) {
  const { theme } = useTheme();
  const inventory = usePropertyInventory(propertyId);
  const cash = useCashOverview(propertyId);
  const create = useCreateManualReservation(propertyId);

  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [checkIn, setCheckIn] = useState(defaultDate ?? todayIso());
  const [checkOut, setCheckOut] = useState('');
  const [roomTypeId, setRoomTypeId] = useState<string | null>(defaultRoomTypeId ?? null);
  const [roomId, setRoomId] = useState<string | null>(defaultRoomId ?? null);
  const [ratePlanId, setRatePlanId] = useState<string | null>(null);
  const [nightlyPrice, setNightlyPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'pos' | 'bank' | null>(null);
  const [cashAccountId, setCashAccountId] = useState<string | null>(null);
  const [source, setSource] = useState<ReservationSource>('phone');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [notify, setNotify] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckIn(defaultDate ?? todayIso());
    setCheckOut(defaultDate ? nextDay(defaultDate) : '');
    setRoomTypeId(defaultRoomTypeId ?? null);
    setRoomId(defaultRoomId ?? null);
    setRatePlanId(null);
    setGuestName('');
    setGuestPhone('');
    setGuestEmail('');
    setAdults('2');
    setChildren('0');
    setDiscount('');
    setPaid('');
    setPaymentMethod(null);
    setCashAccountId(null);
    setSource('phone');
    setNotes('');
    setInternalNotes('');
    setNotify(false);
    setPending(false);
    setError(null);
  }, [visible, defaultDate, defaultRoomId, defaultRoomTypeId]);

  const roomTypes = inventory.data?.room_types ?? [];
  const activeRoomType = roomTypes.find((roomType) => roomType.id === roomTypeId) ?? null;
  const plans = useMemo(
    () =>
      (inventory.data?.rate_plans ?? []).filter(
        (plan) =>
          plan.room_type_id == null || (activeRoomType && plan.room_type_id === activeRoomType.id),
      ),
    [activeRoomType, inventory.data?.rate_plans],
  );
  const activePlan = plans.find((plan) => plan.id === ratePlanId) ?? null;
  const rooms = (inventory.data?.rooms ?? []).filter(
    (room) => !activeRoomType || room.room_type_id === activeRoomType.id,
  );
  const availability = useAvailableRooms(
    roomTypeId && checkOut && checkOut > checkIn
      ? { propertyId, roomTypeId, from: checkIn, to: checkOut }
      : null,
  );
  const availableRooms = availability.data ?? [];
  const nights = checkOut ? nightsBetween(checkIn, checkOut) : 0;

  const priceCents = parseMoneyToCents(nightlyPrice) ?? activeRoomType?.base_price_cents ?? 0;
  const discountCents = parseMoneyToCents(discount) ?? 0;
  const paidCents = parseMoneyToCents(paid) ?? 0;
  const totalCents = Math.max(0, priceCents * nights - discountCents);
  const commission = source === 'trabzone' ? Math.round(totalCents * 0.1) : 0;

  const submit = async () => {
    setError(null);
    if (!guestName.trim()) {
      setError('Misafir adı zorunludur.');
      return;
    }
    if (!roomTypeId || !ratePlanId || !checkIn || !checkOut || nights <= 0) {
      setError('Oda tipi, fiyat planı ve geçerli tarih aralığı seçmelisin.');
      return;
    }
    if (paidCents > 0 && !paymentMethod) {
      setError('Tahsilat girildiyse ödeme yöntemi seçmelisin.');
      return;
    }
    if (!source) {
      setError('Rezervasyon kaynağı zorunludur.');
      return;
    }
    try {
      const result = await create.mutateAsync({
        roomTypeId,
        ratePlanId,
        roomId,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || null,
        guestEmail: guestEmail.trim() || null,
        adults: Math.max(1, Number(adults) || 1),
        children: Math.max(0, Number(children) || 0),
        checkIn,
        checkOut,
        nightlyPriceCents: priceCents,
        discountCents,
        paidCents,
        paymentMethod,
        cashAccountId,
        source,
        status: pending ? 'pending' : 'confirmed',
        notes: notes.trim() || null,
        internalNotes: internalNotes.trim() || null,
        sendNotification: notify,
      });
      onCreated?.(result);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Rezervasyon oluşturulamadı.');
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Yeni rezervasyon"
      subtitle="Resepsiyon / telefon rezervasyonu — stok otomatik düşer"
      maxWidth={820}
      footer={
        <View style={styles.footer}>
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary">
              {nights} gece · toplam
            </AppText>
            <MoneyText cents={totalCents} variant="h3" color={theme.colors.primaryDeep} />
          </View>
          <Button label="Vazgeç" variant="outline" onPress={onClose} style={styles.footerButton} />
          <Button
            label={pending ? 'Onay bekleyen olarak kaydet' : 'Rezervasyonu oluştur'}
            loading={create.isPending}
            onPress={() => void submit()}
            style={styles.footerButton}
          />
        </View>
      }
    >
      {inventory.isLoading ? (
        <LoadingBlock height={180} />
      ) : inventory.isError ? (
        <InlineError message="Oda ve fiyat planı envanteri yüklenemedi." onRetry={() => void inventory.refetch()} />
      ) : (
        <View style={styles.form}>
          <View style={styles.row}>
            <TextField
              label="Misafir adı soyadı *"
              value={guestName}
              onChangeText={setGuestName}
              placeholder="Ad soyad"
              leftIcon="person-outline"
              containerStyle={styles.flex}
            />
            <TextField
              label="Telefon"
              value={guestPhone}
              onChangeText={setGuestPhone}
              placeholder="+90 5xx xxx xx xx"
              keyboardType="phone-pad"
              leftIcon="call-outline"
              containerStyle={styles.flex}
            />
          </View>
          <TextField
            label="E-posta"
            value={guestEmail}
            onChangeText={setGuestEmail}
            placeholder="misafir@ornek.com"
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon="mail-outline"
          />
          <View style={styles.row}>
            <TextField
              label="Yetişkin"
              value={adults}
              onChangeText={(next) => setAdults(next.replace(/\D/g, ''))}
              keyboardType="number-pad"
              containerStyle={styles.flex}
            />
            <TextField
              label="Çocuk"
              value={children}
              onChangeText={(next) => setChildren(next.replace(/\D/g, ''))}
              keyboardType="number-pad"
              containerStyle={styles.flex}
            />
            <TextField
              label="Kaynak *"
              value={SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? ''}
              editable={false}
              containerStyle={styles.flex}
            />
          </View>
          <ChipsRow>
            {SOURCE_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={source === option.value}
                onPress={() => {
                  setSource(option.value);
                  if (option.value !== 'trabzone') setNotify(false);
                }}
              />
            ))}
          </ChipsRow>
          {source !== 'trabzone' ? (
            <InfoBanner text="Trabzone komisyonu yalnızca Trabzone kaynaklı rezervasyonlarda uygulanır. Telefon, resepsiyon ve doğrudan web rezervasyonlarında komisyon eklenmez." />
          ) : (
            <InfoBanner text={`Trabzone kaynağı seçildi. Tahmini %10 komisyon: ${formatMoneyCents(commission)} (tamamlanan uygun konaklamada kesinleşir).`} />
          )}

          <AppText variant="bodyStrong">Konaklama</AppText>
          <DateField
            label="Giriş"
            mode="range"
            value={checkIn}
            endValue={checkOut || null}
            onChange={(next) => setCheckIn(next)}
            onEndChange={(next) => setCheckOut(next)}
            minDate={todayIso()}
            hint={nights > 0 ? `${formatDate(checkIn)} – ${formatDate(checkOut)} · ${nights} gece` : 'Çıkış tarihi seç'}
          />

          <AppText variant="label" color="textSecondary">
            Oda tipi *
          </AppText>
          <ChipsRow>
            {roomTypes.map((roomType) => (
              <Chip
                key={roomType.id}
                label={`${roomType.name} (${roomType.room_count} oda)`}
                active={roomTypeId === roomType.id}
                onPress={() => {
                  setRoomTypeId(roomType.id);
                  setRoomId(null);
                  setRatePlanId(null);
                  setNightlyPrice(String(roomType.base_price_cents / 100));
                }}
              />
            ))}
          </ChipsRow>

          {activeRoomType ? (
            <>
              <AppText variant="label" color="textSecondary">
                Fiyat planı *
              </AppText>
              <ChipsRow>
                {plans.map((plan) => (
                  <Chip
                    key={plan.id}
                    label={`${plan.name} · ${BOOKING_MODE_LABELS[plan.booking_mode]}`}
                    active={ratePlanId === plan.id}
                    onPress={() => setRatePlanId(plan.id)}
                  />
                ))}
              </ChipsRow>

              <AppText variant="label" color="textSecondary">
                Fiziksel oda
              </AppText>
              <ChipsRow>
                <Chip label="Oda atama (sonra)" active={!roomId} onPress={() => setRoomId(null)} />
                {rooms.map((room) => {
                  const info = availableRooms.find((item) => item.id === room.id);
                  const busy = info?.busy ?? false;
                  return (
                    <Chip
                      key={room.id}
                      label={`${room.number}${busy ? ' · dolu' : ''}`}
                      active={roomId === room.id}
                      onPress={() => {
                        if (!busy) setRoomId(room.id);
                      }}
                    />
                  );
                })}
              </ChipsRow>
              {availability.isFetching ? (
                <AppText variant="caption" color="textTertiary">
                  Uygun odalar kontrol ediliyor…
                </AppText>
              ) : (
                <AppText variant="caption" color="textTertiary">
                  Seçilen tarihlerde {availableRooms.filter((room) => !room.busy && !room.blocked).length} uygun oda var.
                  Çakışan rezervasyon sunucu tarafından reddedilir.
                </AppText>
              )}
            </>
          ) : null}

          <View style={styles.row}>
            <TextField
              label="Gecelik fiyat (₺)"
              value={nightlyPrice}
              onChangeText={(next) => setNightlyPrice(next.replace(/[^\d.,]/g, ''))}
              keyboardType="decimal-pad"
              containerStyle={styles.flex}
              placeholder={activeRoomType ? String(activeRoomType.base_price_cents / 100) : '0'}
            />
            <TextField
              label="İndirim (₺)"
              value={discount}
              onChangeText={(next) => setDiscount(next.replace(/[^\d.,]/g, ''))}
              keyboardType="decimal-pad"
              containerStyle={styles.flex}
            />
          </View>

          <AccCard padding={12} style={{ gap: 4 }}>
            <KeyValueRow label={`Gecelik × ${nights} gece`} value={formatMoneyCents(priceCents * nights)} />
            {discountCents > 0 ? <KeyValueRow label="İndirim" value={`-${formatMoneyCents(discountCents)}`} /> : null}
            {source === 'trabzone' ? (
              <KeyValueRow label="Trabzone komisyonu (%10)" value={formatMoneyCents(commission)} />
            ) : null}
            <KeyValueRow
              label="Misafir toplamı"
              value={<MoneyText cents={totalCents} variant="bodyStrong" color={theme.colors.primaryDeep} />}
            />
          </AccCard>

          <AppText variant="bodyStrong">Tahsilat</AppText>
          <ChipsRow>
            <Chip label="Henüz ödeme yok" active={!paymentMethod} onPress={() => { setPaymentMethod(null); setPaid(''); setCashAccountId(null); }} />
            <Chip label="Nakit" active={paymentMethod === 'cash'} onPress={() => setPaymentMethod('cash')} />
            <Chip label="POS" active={paymentMethod === 'pos'} onPress={() => setPaymentMethod('pos')} />
            <Chip label="Banka / havale" active={paymentMethod === 'bank'} onPress={() => setPaymentMethod('bank')} />
          </ChipsRow>
          {paymentMethod ? (
            <>
              <TextField
                label="Tahsil edilen tutar (₺)"
                value={paid}
                onChangeText={(next) => setPaid(next.replace(/[^\d.,]/g, ''))}
                keyboardType="decimal-pad"
                hint={`Kalan bakiye: ${formatMoneyCents(Math.max(0, totalCents - paidCents))}`}
              />
              <ChipsRow>
                {(cash.data?.accounts ?? [])
                  .filter((account) =>
                    paymentMethod === 'cash'
                      ? account.kind === 'cash'
                      : paymentMethod === 'pos'
                        ? account.kind === 'pos'
                        : account.kind === 'bank',
                  )
                  .map((account) => (
                    <Chip
                      key={account.id}
                      label={account.name}
                      active={cashAccountId === account.id}
                      onPress={() => setCashAccountId(account.id)}
                    />
                  ))}
              </ChipsRow>
            </>
          ) : null}

          <TextField
            label="Misafire not"
            value={notes}
            onChangeText={setNotes}
            placeholder="Giriş saati, özel istek vb. (misafir görebilir)"
            multiline
          />
          <TextField
            label="İç not (yalnızca personel)"
            value={internalNotes}
            onChangeText={setInternalNotes}
            placeholder="Operasyon notu"
            multiline
          />
          <ToggleRow
            label="Misafire bildirim gönder"
            description="Telefon/e-posta varsa rezervasyon bilgisi iletilir"
            value={notify}
            onChange={setNotify}
          />
          <ToggleRow
            label="Onay bekleyen olarak kaydet"
            description="Manuel onay akışına düşer; stok geçici tutulur"
            value={pending}
            onChange={setPending}
          />

          {error ? <InlineError message={error} /> : null}
          <View style={styles.summary}>
            <Ionicons name="information-circle-outline" size={14} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" style={styles.flex}>
              {guestCount(Math.max(1, Number(adults) || 1), Math.max(0, Number(children) || 0))} ·{' '}
              {activePlan ? activePlan.name : 'fiyat planı seçilmedi'} · {source}
            </AppText>
          </View>
        </View>
      )}
    </ModalSheet>
  );
}

function nextDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  footerButton: { flexGrow: 1, flexBasis: 150 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
