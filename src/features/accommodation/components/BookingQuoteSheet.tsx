import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import { useBookStay, useStayQuote } from '../hooks/use-accommodation';
import type { PublicProperty, PublicRatePlan, PublicRoomType } from '../types';
import { formatDate, formatMoneyCents, nightsBetween, todayIso } from '../utils/format';
import { AccCard, InfoBanner, InlineError, LoadingBlock, ModalSheet, MoneyText } from './AccommodationUI';
import { DatePickerModal } from './DatePickerModal';

type Step = 'quote' | 'guest' | 'done';

export function BookingQuoteSheet({
  visible,
  onClose,
  property,
  roomType,
  ratePlan,
  initialCheckIn,
  initialCheckOut,
  initialAdults = 2,
  initialChildren = 0,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  property: PublicProperty;
  roomType: PublicRoomType | null;
  ratePlan: PublicRatePlan | null;
  initialCheckIn?: string | null;
  initialCheckOut?: string | null;
  initialAdults?: number;
  initialChildren?: number;
  onDone?: (reservationCode: string) => void;
}) {
  const { theme } = useTheme();
  const session = useAuthStore((state) => state.session);
  const [step, setStep] = useState<Step>('quote');
  const [checkIn, setCheckIn] = useState(initialCheckIn ?? todayIso());
  const [checkOut, setCheckOut] = useState(initialCheckOut ?? '');
  const [adults, setAdults] = useState(initialAdults);
  const [children, setChildren] = useState(initialChildren);
  const [dateOpen, setDateOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const book = useBookStay();

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep('quote');
    setError(null);
    if (initialCheckIn) setCheckIn(initialCheckIn);
    if (initialCheckOut) setCheckOut(initialCheckOut);
    const name =
      (session?.user.user_metadata?.full_name as string | undefined) ??
      (session?.user.user_metadata?.name as string | undefined) ??
      '';
    setGuestName((current) => current || name);
    setGuestEmail((current) => current || session?.user.email || '');
    setGuestPhone((current) => current || (session?.user.phone ?? ''));
  }, [visible, initialCheckIn, initialCheckOut, session]);

  const nights = checkOut ? nightsBetween(checkIn, checkOut) : 0;

  const quoteInput = useMemo(
    () =>
      property && roomType && ratePlan && checkOut && nights > 0
        ? {
            propertyId: property.id,
            roomTypeId: roomType.id,
            ratePlanId: ratePlan.id,
            checkIn,
            checkOut,
            adults,
            children,
          }
        : null,
    [adults, checkIn, checkOut, children, nights, property, ratePlan, roomType],
  );

  const quote = useStayQuote(quoteInput);

  if (!roomType || !ratePlan) {
    return null;
  }

  const blockedReason = quote.data
    ? quote.data.sold_out
      ? 'Bu tarihlerde uygun oda kalmadı.'
      : quote.data.available_rooms <= 0
        ? 'Bu tarihlerde müsait oda yok.'
        : !quote.data.min_stay_ok
          ? `En az ${quote.data.min_stay} gece konaklama gerekli.`
          : !quote.data.max_stay_ok
            ? `En fazla ${quote.data.max_stay ?? '—'} gece konaklanabilir.`
            : quote.data.closed_to_arrival
              ? 'Seçilen giriş tarihi girişe kapalı.'
              : quote.data.closed_to_departure
                ? 'Seçilen çıkış tarihi çıkışa kapalı.'
                : null
    : null;

  const canContinue = Boolean(quote.data && !blockedReason);

  const submit = async () => {
    setError(null);
    if (!guestName.trim()) {
      setError('Misafir adı ve soyadı zorunlu.');
      return;
    }
    if (!guestPhone.trim() && !guestEmail.trim()) {
      setError('Size ulaşabilmemiz için telefon veya e-posta girmelisin.');
      return;
    }
    try {
      const result = await book.mutateAsync({
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        checkIn,
        checkOut,
        adults,
        children,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || null,
        guestEmail: guestEmail.trim() || null,
        note: note.trim() || null,
      });
      setStep('done');
      onDone?.(result.code);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Rezervasyon oluşturulamadı.');
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={step === 'done' ? 'Rezervasyon alındı' : `${property.name} · Rezervasyon`}
      subtitle={`${roomType.name} · ${ratePlan.name}`}
      maxWidth={680}
      footer={
        step === 'quote' ? (
          <Button
            label={blockedReason ? 'Uygun tarih seç' : 'Devam et'}
            disabled={!canContinue}
            loading={quote.isFetching}
            onPress={() => setStep('guest')}
          />
        ) : step === 'guest' ? (
          <View style={styles.footerButtons}>
            <Button label="Geri" variant="outline" onPress={() => setStep('quote')} style={styles.flex} />
            <Button
              label={
                ratePlan.booking_mode === 'instant'
                  ? 'Rezervasyonu tamamla'
                  : 'Rezervasyon talebi gönder'
              }
              loading={book.isPending}
              onPress={() => void submit()}
              style={styles.flex}
            />
          </View>
        ) : (
          <Button label="Rezervasyonlarım" onPress={onClose} />
        )
      }
    >
      {step === 'quote' ? (
        <>
          <AccCard style={{ gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tarih aralığını seç"
              onPress={() => setDateOpen(true)}
              style={[styles.dateRow, { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground }]}
            >
              <View style={styles.flex}>
                <AppText variant="caption" color="textTertiary">
                  Giriş
                </AppText>
                <AppText variant="bodyStrong">{formatDate(checkIn)}</AppText>
              </View>
              <Ionicons name="moon-outline" size={16} color={theme.colors.textTertiary} />
              <View style={styles.flex}>
                <AppText variant="caption" color="textTertiary">
                  Çıkış
                </AppText>
                <AppText variant="bodyStrong">{checkOut ? formatDate(checkOut) : 'Seç'}</AppText>
              </View>
              <Ionicons name="calendar-outline" size={18} color={theme.colors.primary} />
            </Pressable>

            <View style={styles.counterRow}>
              <Counter
                label="Yetişkin"
                value={adults}
                min={1}
                max={roomType.capacity_adults}
                onChange={setAdults}
              />
              <Counter
                label="Çocuk"
                value={children}
                min={0}
                max={roomType.capacity_children}
                onChange={setChildren}
              />
            </View>
            <AppText variant="caption" color="textTertiary">
              En fazla {roomType.capacity_adults} yetişkin, {roomType.capacity_children} çocuk.
            </AppText>
          </AccCard>

          {!quoteInput ? (
            <InfoBanner text="Toplam fiyatı görmek için giriş ve çıkış tarihini seç." />
          ) : quote.isLoading ? (
            <LoadingBlock label="Fiyat hesaplanıyor…" />
          ) : quote.isError ? (
            <InlineError
              message={quote.error instanceof Error ? quote.error.message : 'Fiyat alınamadı.'}
              onRetry={() => void quote.refetch()}
            />
          ) : quote.data ? (
            <AccCard style={{ gap: 9 }}>
              <View style={styles.rowBetween}>
                <AppText variant="bodyStrong">{nights} gece</AppText>
                <AppText variant="caption" color="textTertiary">
                  {quote.data.available_rooms} oda müsait
                </AppText>
              </View>
              {quote.data.nightly.map((night) => (
                <View key={night.date} style={styles.rowBetween}>
                  <AppText variant="caption" color="textSecondary">
                    {formatDate(night.date)}
                  </AppText>
                  <AppText variant="caption" color={night.discount_cents > 0 ? 'success' : 'text'}>
                    {formatMoneyCents(night.total_cents, quote.data?.currency)}
                    {night.discount_cents > 0 ? ` · ${formatMoneyCents(night.discount_cents, quote.data?.currency)} indirim` : ''}
                  </AppText>
                </View>
              ))}
              <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
              <View style={styles.rowBetween}>
                <AppText variant="caption" color="textSecondary">
                  Ara toplam
                </AppText>
                <MoneyText cents={quote.data.subtotal_cents} currency={quote.data.currency} variant="body" />
              </View>
              {quote.data.discount_cents > 0 ? (
                <View style={styles.rowBetween}>
                  <AppText variant="caption" color="success">
                    Kampanya indirimi
                  </AppText>
                  <AppText variant="body" color="success">
                    −{formatMoneyCents(quote.data.discount_cents, quote.data.currency)}
                  </AppText>
                </View>
              ) : null}
              <View style={[styles.rowBetween, styles.totalRow]}>
                <AppText variant="bodyStrong">Toplam</AppText>
                <MoneyText cents={quote.data.total_cents} currency={quote.data.currency} variant="h3" color={theme.colors.primaryDeep} />
              </View>
              <InfoBanner
                icon="shield-checkmark-outline"
                tone="success"
                text={
                  ratePlan.booking_mode === 'instant'
                    ? 'Anında rezervasyon: oda bu işlemle kesinleşir. Ödemeyi tesiste yaparsın.'
                    : 'Manuel onay: talebin tesise iletilir, onay sonrası oda kesinleşir. Ödemeyi tesiste yaparsın.'
                }
              />
              {blockedReason ? <InlineError message={blockedReason} /> : null}
            </AccCard>
          ) : null}
        </>
      ) : step === 'guest' ? (
        <>
          <AccCard style={{ gap: 10 }}>
            <AppText variant="bodyStrong">Misafir bilgileri</AppText>
            <TextField
              label="Ad soyad *"
              value={guestName}
              onChangeText={setGuestName}
              leftIcon="person-outline"
              autoCapitalize="words"
            />
            <TextField
              label="Telefon"
              value={guestPhone}
              onChangeText={setGuestPhone}
              keyboardType="phone-pad"
              leftIcon="call-outline"
            />
            <TextField
              label="E-posta"
              value={guestEmail}
              onChangeText={setGuestEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              leftIcon="mail-outline"
            />
            <TextField
              label="Tesise not (isteğe bağlı)"
              value={note}
              onChangeText={setNote}
              multiline
              placeholder="Varış saati, özel talepler…"
            />
            {error ? <InlineError message={error} /> : null}
          </AccCard>
          {quote.data ? (
            <AccCard style={{ gap: 6 }}>
              <AppText variant="bodyStrong">Özet</AppText>
              <View style={styles.rowBetween}>
                <AppText variant="caption" color="textSecondary">
                  {roomType.name} · {nights} gece
                </AppText>
                <MoneyText cents={quote.data.total_cents} currency={quote.data.currency} />
              </View>
              <AppText variant="caption" color="textTertiary">
                Ödeme tesiste yapılır. Trabzone komisyonu misafire yansıtılmaz.
              </AppText>
            </AccCard>
          ) : null}
        </>
      ) : (
        <View style={{ gap: 12 }}>
          <View style={[styles.successIcon, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="checkmark-circle" size={44} color={theme.colors.success} />
          </View>
          <AppText variant="h3" align="center">
            {ratePlan.booking_mode === 'instant' ? 'Rezervasyonun onaylandı' : 'Talebin tesise gönderildi'}
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {ratePlan.booking_mode === 'instant'
              ? 'Rezervasyon kodun aşağıda. Girişte bu kodu resepsiyona iletebilirsin.'
              : 'Tesis talebini inceledikten sonra bilgilendirileceksin. Onaylanana kadar oda geçici olarak tutulur.'}
          </AppText>
          <AccCard style={{ gap: 6 }}>
            <AppText variant="caption" color="textTertiary" align="center">
              Rezervasyon kodu
            </AppText>
            <AppText variant="h3" align="center" color="primaryDeep">
              {book.data?.code ?? '—'}
            </AppText>
            <AppText variant="caption" color="textSecondary" align="center">
              {property.name} · {formatDate(checkIn)} – {formatDate(checkOut)}
            </AppText>
          </AccCard>
        </View>
      )}

      <DatePickerModal
        visible={dateOpen}
        title="Konaklama tarihleri"
        mode="range"
        value={checkIn}
        endValue={checkOut}
        minDate={todayIso()}
        onClose={() => setDateOpen(false)}
        onSelectRange={(start, end) => {
          setCheckIn(start);
          setCheckOut(end);
        }}
      />
    </ModalSheet>
  );
}

function Counter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.counter}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      <View style={styles.counterControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} azalt`}
          disabled={value <= min}
          onPress={() => onChange(Math.max(min, value - 1))}
          style={[styles.counterButton, { borderColor: theme.colors.border, opacity: value <= min ? 0.4 : 1 }]}
        >
          <Ionicons name="remove" size={15} color={theme.colors.text} />
        </Pressable>
        <AppText variant="bodyStrong" style={styles.counterValue}>
          {value}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} artır`}
          disabled={value >= max}
          onPress={() => onChange(Math.min(max, value + 1))}
          style={[styles.counterButton, { borderColor: theme.colors.border, opacity: value >= max ? 0.4 : 1 }]}
        >
          <Ionicons name="add" size={15} color={theme.colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footerButtons: { flexDirection: 'row', gap: 8 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  counterRow: { flexDirection: 'row', gap: 12 },
  counter: { flex: 1, gap: 6 },
  counterControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  counterButton: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  counterValue: { minWidth: 22, textAlign: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  divider: { height: StyleSheet.hairlineWidth },
  totalRow: { paddingTop: 4 },
  successIcon: { width: 72, height: 72, borderRadius: 36, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
});
