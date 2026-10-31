import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import { useBookLiteApiOffer } from '../hooks/use-accommodation';
import type { LiteApiRateOffer, PublicProperty } from '../types';
import { formatDate, formatMoneyCents } from '../utils/format';
import { AccCard, InfoBanner, InlineError, ModalSheet } from './AccommodationUI';

type Step = 'details' | 'guest' | 'done';

/**
 * LiteAPI teklifi için rezervasyon akışı.
 *
 * Güvenlik: sağlayıcı `POST /rates/book` çağrısı sunucuda varsayılan olarak
 * kapalıdır. Bu ekran yalnızca `property.booking_enabled` açıkken gönderim
 * yapar; yine de sunucu iki ayrı ortam bayrağı ve veritabanı anahtarını
 * doğrular. Sağlayıcı açıkça onaylamadan "onaylandı" denmez.
 */
export function LiteApiBookingSheet({
  visible,
  onClose,
  property,
  offer,
  checkIn,
  checkOut,
  adults,
  childGuests,
}: {
  visible: boolean;
  onClose: () => void;
  property: PublicProperty;
  offer: LiteApiRateOffer | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  childGuests: number;
}) {
  const { theme } = useTheme();
  const session = useAuthStore((state) => state.session);
  const book = useBookLiteApiOffer();
  const [step, setStep] = useState<Step>('details');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep('details');
    setError(null);
    book.reset();
    const fullName =
      (session?.user.user_metadata?.full_name as string | undefined) ??
      (session?.user.user_metadata?.name as string | undefined) ??
      '';
    const parts = fullName.trim().split(/\s+/);
    setFirstName((current) => current || parts[0] || '');
    setLastName((current) => current || parts.slice(1).join(' ') || '');
    setEmail((current) => current || session?.user.email || '');
    setPhone((current) => current || session?.user.phone || '');
    // book.reset kimliği kararlı; yalnızca modal açılışında çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session]);

  if (!offer) return null;

  const bookingPossible = property.booking_enabled && offer.paymentAtProperty;
  const nights =
    checkIn && checkOut
      ? Math.max(0, Math.round((new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86_400_000))
      : 0;

  const submit = async () => {
    setError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setError('Misafir adı ve soyadı zorunlu.');
      return;
    }
    if (!email.trim()) {
      setError('Sağlayıcı rezervasyonu için e-posta zorunlu.');
      return;
    }
    try {
      await book.mutateAsync({
        propertyId: property.id,
        offerId: offer.offerId,
        checkIn,
        checkOut,
        adults,
        children: childGuests,
        expectedPriceCents: offer.priceCents,
        guest: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          country: 'TR',
        },
      });
      setStep('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Rezervasyon tamamlanamadı.');
    }
  };

  const result = book.data;
  const confirmed = result?.confirmed === true && result.status === 'confirmed';

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={step === 'done' ? 'Rezervasyon durumu' : `${property.name} · Rezervasyon`}
      subtitle={`${offer.roomName} · ${formatDate(checkIn)} – ${formatDate(checkOut)}`}
      maxWidth={620}
      footer={
        step === 'details' ? (
          <Button
            label={bookingPossible ? 'Devam et' : 'Rezervasyon henüz etkin değil'}
            disabled={!bookingPossible}
            onPress={() => setStep('guest')}
          />
        ) : step === 'guest' ? (
          <View style={styles.footerButtons}>
            <Button label="Geri" variant="outline" onPress={() => setStep('details')} style={styles.flex} />
            <Button
              label="Rezervasyonu gönder"
              loading={book.isPending}
              disabled={!bookingPossible}
              onPress={() => void submit()}
              style={styles.flex}
            />
          </View>
        ) : (
          <Button label="Kapat" onPress={onClose} />
        )
      }
    >
      {step === 'details' ? (
        <View style={styles.body}>
          <AccCard style={styles.summary}>
            <View style={styles.rowBetween}>
              <AppText variant="bodyStrong">{offer.roomName}</AppText>
              <AppText variant="h3" color="primaryDeep">
                {formatMoneyCents(offer.priceCents, offer.currency, { decimals: false })}
              </AppText>
            </View>
            <View style={styles.rowBetween}>
              <AppText variant="caption" color="textSecondary">
                {nights} gece · {adults} yetişkin{childGuests > 0 ? `, ${childGuests} çocuk` : ''}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                Toplam
              </AppText>
            </View>
            {offer.boardName ? (
              <Row icon="restaurant-outline" text={offer.boardName} />
            ) : null}
            <Row
              icon={offer.paymentAtProperty ? 'cash-outline' : 'card-outline'}
              text={offer.paymentAtProperty ? 'Tesiste ödeme (PROPERTY_PAY)' : 'Ön ödeme / online ödeme gerekli'}
            />
            <Row
              icon={offer.refundable === false ? 'close-circle-outline' : 'shield-checkmark-outline'}
              text={
                offer.refundable === false
                  ? 'İade edilemez teklif'
                  : offer.refundable === true
                    ? 'İade edilebilir teklif'
                    : 'İade koşulu sağlayıcıya göre değişir'
              }
            />
            <Row
              icon="document-text-outline"
              text={offer.cancellationPolicy ? `İptal: ${offer.cancellationPolicy}` : 'İptal koşulu belirtilmedi.'}
            />
            {!offer.taxesIncluded ? (
              <InfoBanner tone="warning" text="Vergiler fiyata dahil olmayabilir. Sağlayıcı son tutarı rezervasyon sırasında doğrular." />
            ) : null}
          </AccCard>

          {!property.booking_enabled ? (
            <InfoBanner
              tone="warning"
              icon="lock-closed-outline"
              text="Canlı LiteAPI rezervasyonu henüz etkin değil. Fiyat ve koşulları inceleyebilirsin; rezervasyon gönderilemez."
            />
          ) : !offer.paymentAtProperty ? (
            <InfoBanner
              tone="warning"
              icon="card-outline"
              text="Bu teklif tesiste ödemeyi desteklemiyor. Trabzone yalnızca PROPERTY_PAY destekleyen tekliflerde rezervasyon sunar."
            />
          ) : (
            <InfoBanner
              tone="success"
              icon="shield-checkmark-outline"
              text="Rezervasyon yalnızca sağlayıcı açıkça onayladıktan sonra kesinleşir. Onay gelmeden 'onaylandı' mesajı gösterilmez."
            />
          )}

          <AppText variant="caption" color="textTertiary">
            Trabzone, LiteAPI rezervasyonlarına otomatik %10 komisyon eklemez. Fiyat sağlayıcıdan geldiği gibidir.
          </AppText>
        </View>
      ) : step === 'guest' ? (
        <View style={styles.body}>
          <AccCard style={styles.form}>
            <AppText variant="bodyStrong">Misafir bilgileri</AppText>
            <TextField label="Ad *" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
            <TextField label="Soyad *" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
            <TextField
              label="E-posta *"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              leftIcon="mail-outline"
            />
            <TextField
              label="Telefon"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              leftIcon="call-outline"
            />
            {error ? <InlineError message={error} /> : null}
          </AccCard>
          <AppText variant="caption" color="textTertiary">
            Gönderimden önce teklif sunucuda yeniden doğrulanır. Fiyat değişirse rezervasyon oluşturulmaz ve güncel fiyat gösterilir.
          </AppText>
        </View>
      ) : (
        <View style={styles.body}>
          <View
            style={[
              styles.resultIcon,
              { backgroundColor: confirmed ? theme.colors.successSoft : theme.colors.warningSoft },
            ]}
          >
            <Ionicons
              name={confirmed ? 'checkmark-circle' : 'time-outline'}
              size={42}
              color={confirmed ? theme.colors.success : theme.colors.warning}
            />
          </View>
          <AppText variant="h3" align="center">
            {confirmed ? 'Rezervasyon sağlayıcı tarafından onaylandı' : 'Rezervasyon sağlayıcıya iletildi'}
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {confirmed
              ? 'Rezervasyonunuz kesinleşti. Ödemeyi tesiste yapabilirsiniz.'
              : 'Sağlayıcı onayı bekleniyor. Onay gelmeden rezervasyon kesinleşmiş sayılmaz.'}
          </AppText>
          {result ? (
            <AccCard style={styles.summary}>
              <View style={styles.rowBetween}>
                <AppText variant="caption" color="textTertiary">
                  Trabzone takip numarası
                </AppText>
                <AppText variant="caption" color="text">
                  {result.bookingId}
                </AppText>
              </View>
              {result.providerBookingId ? (
                <View style={styles.rowBetween}>
                  <AppText variant="caption" color="textTertiary">
                    Sağlayıcı rezervasyon no
                  </AppText>
                  <AppText variant="caption" color="text">
                    {result.providerBookingId}
                  </AppText>
                </View>
              ) : null}
            </AccCard>
          ) : null}
          {phone ? (
            <Button
              label="Tesisi ara"
              variant="outline"
              onPress={() => {
                if (property.phone) void Linking.openURL(`tel:${property.phone}`);
              }}
            />
          ) : null}
        </View>
      )}
    </ModalSheet>
  );
}

function Row({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={13} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { gap: 12 },
  footerButtons: { flexDirection: 'row', gap: 8 },
  summary: { gap: 8 },
  form: { gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  resultIcon: { width: 72, height: 72, borderRadius: 36, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
});
