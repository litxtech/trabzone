import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useLiteApiRates } from '../hooks/use-accommodation';
import type { LiteApiRateOffer, PublicProperty } from '../types';
import { formatDate, formatMoneyCents } from '../utils/format';
import { InfoBanner, InlineError, LoadingBlock } from './AccommodationUI';

/**
 * LiteAPI kaynaklı tesislerde canlı fiyat ve müsaitlik listesi.
 *
 * - Fiyat, para birimi ve iptal koşulu doğrudan sağlayıcı yanıtından gelir.
 * - "Tesiste ödeme" yalnızca teklifte `PROPERTY_PAY` varsa gösterilir.
 * - Rezervasyon kapalıyken fiyatlar görünür, ancak satın alma çağrısı yapılmaz.
 */
export function LiteApiRatesPanel({
  property,
  checkIn,
  checkOut,
  adults,
  childGuests,
  onSelectOffer,
  onPickDates,
}: {
  property: PublicProperty;
  checkIn: string;
  checkOut: string;
  adults: number;
  childGuests: number;
  onSelectOffer: (offer: LiteApiRateOffer) => void;
  onPickDates: () => void;
}) {
  const hasDates = Boolean(checkIn && checkOut && checkOut > checkIn);
  const rates = useLiteApiRates(
    hasDates
      ? {
          propertyId: property.id,
          checkIn,
          checkOut,
          adults,
          children: childGuests,
          currency: 'TRY',
        }
      : null,
  );
  const offers = rates.data?.offers ?? [];

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Canlı fiyatlar</AppText>
          <AppText variant="caption" color="textTertiary">
            {hasDates
              ? `${formatDate(checkIn)} – ${formatDate(checkOut)} · ${adults} yetişkin${
                  childGuests > 0 ? `, ${childGuests} çocuk` : ''
                }`
              : 'Fiyat ve müsaitlik için tarih seç'}
          </AppText>
        </View>
        <Button
          label={hasDates ? 'Tarihi değiştir' : 'Tarih seç'}
          size="sm"
          variant="outline"
          fullWidth={false}
          onPress={onPickDates}
        />
      </View>

      {!hasDates ? (
        <InfoBanner text="Sağlayıcıdan canlı fiyat almak için giriş ve çıkış tarihini seç." />
      ) : rates.isLoading ? (
        <LoadingBlock label="Sağlayıcıdan fiyatlar alınıyor…" height={120} />
      ) : rates.isError ? (
        <InlineError
          message={rates.error instanceof Error ? rates.error.message : 'Fiyatlar alınamadı.'}
          onRetry={() => void rates.refetch()}
        />
      ) : offers.length === 0 ? (
        <InfoBanner
          tone="warning"
          icon="calendar-outline"
          text="Seçilen tarihlerde sağlayıcıda uygun oda bulunamadı. Farklı tarihler deneyebilirsin."
        />
      ) : (
        <View style={styles.list}>
          {offers.map((offer) => (
            <OfferRow
              key={offer.offerId}
              offer={offer}
              bookingEnabled={property.booking_enabled && offer.paymentAtProperty}
              onPress={() => onSelectOffer(offer)}
            />
          ))}
        </View>
      )}

      {rates.data ? (
        <View style={styles.meta}>
          <MetaLine
            icon={
              rates.data.propertyPayAvailable ? 'cash-outline' : 'card-outline'
            }
            label={
              rates.data.propertyPayAvailable
                ? 'Bu tesiste geçerli tekliflerde tesiste ödeme seçeneği var.'
                : 'Bu tarihlerde tesiste ödeme seçeneği sunulmuyor.'
            }
          />
          <MetaLine icon="time-outline" label="Fiyatlar sağlayıcıdan canlı alınır ve 5 dakika önbelleklenir." />
          {rates.data.fetchedAt ? (
            <MetaLine
              icon="refresh-outline"
              label={`Son güncelleme: ${new Date(rates.data.fetchedAt).toLocaleTimeString('tr-TR', {
                hour: '2-digit',
                minute: '2-digit',
              })}`}
            />
          ) : null}
          {!property.booking_enabled ? (
            <MetaLine
              icon="lock-closed-outline"
              label="Bu tesis için rezervasyon henüz etkin değil. Fiyatları inceleyebilirsin."
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function OfferRow({
  offer,
  bookingEnabled,
  onPress,
}: {
  offer: LiteApiRateOffer;
  bookingEnabled: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${offer.roomName}, ${formatMoneyCents(offer.priceCents, offer.currency)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.offer,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.88 : 1,
          borderRadius: theme.radius.lg,
        },
      ]}
    >
      <View style={styles.offerMain}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {offer.roomName}
        </AppText>
        <View style={styles.tagRow}>
          {offer.boardName ? <Tag label={offer.boardName} /> : null}
          {offer.paymentAtProperty ? (
            <Tag tone="success" icon="cash-outline" label="Tesiste ödeme" />
          ) : (
            <Tag tone="warning" icon="card-outline" label="Ön ödeme gerekli" />
          )}
          {offer.refundable === false ? (
            <Tag tone="danger" icon="close-circle-outline" label="İade edilmez" />
          ) : offer.refundable === true ? (
            <Tag tone="success" icon="shield-checkmark-outline" label="İade edilebilir" />
          ) : null}
        </View>
        {offer.cancellationPolicy ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={2}>
            İptal: {offer.cancellationPolicy}
          </AppText>
        ) : (
          <AppText variant="caption" color="textTertiary">
            İptal koşulu sağlayıcı tarafından belirtilmedi.
          </AppText>
        )}
        {!offer.taxesIncluded ? (
          <AppText variant="caption" color="warning">
            Vergiler fiyata dahil olmayabilir; ödeme adımında doğrulanır.
          </AppText>
        ) : null}
      </View>
      <View style={styles.offerSide}>
        <AppText variant="caption" color="textTertiary" style={styles.priceCaption}>
          toplam
        </AppText>
        <AppText variant="h3" color="primaryDeep" style={styles.price}>
          {formatMoneyCents(offer.priceCents, offer.currency, { decimals: false })}
        </AppText>
        <View
          style={[
            styles.cta,
            {
              backgroundColor: bookingEnabled ? theme.colors.primaryDeep : theme.colors.surfaceMuted,
            },
          ]}
        >
          <Ionicons
            name={bookingEnabled ? 'arrow-forward' : 'lock-closed'}
            size={13}
            color={bookingEnabled ? '#FFFFFF' : theme.colors.textTertiary}
          />
        </View>
      </View>
    </Pressable>
  );
}

function Tag({
  label,
  icon,
  tone = 'neutral',
}: {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const { theme } = useTheme();
  const palette = {
    neutral: { fg: theme.colors.textSecondary, bg: theme.colors.surfaceMuted },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
  }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: palette.bg }]}>
      {icon ? <Ionicons name={icon} size={10} color={palette.fg} /> : null}
      <AppText variant="caption" style={[styles.tagText, { color: palette.fg }]}>
        {label}
      </AppText>
    </View>
  );
}

function MetaLine({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.metaLine}>
      <Ionicons name={icon} size={12} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textTertiary" style={styles.flex}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  list: { gap: 8 },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  offerMain: { flex: 1, gap: 5, minWidth: 0 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 9 },
  offerSide: { alignItems: 'flex-end', gap: 2 },
  priceCaption: { fontSize: 9 },
  price: { fontVariant: ['tabular-nums'] },
  cta: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  meta: { gap: 4, paddingTop: 2 },
  metaLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
});
