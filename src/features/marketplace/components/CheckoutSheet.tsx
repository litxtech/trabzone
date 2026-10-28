import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton, TextField } from '@/components/ui';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { PROVINCES } from '@/features/profile/constants/regions';
import { SelectSheet } from '@/components/ui/SelectSheet';
import {
  createOrder,
  formatPrice,
} from '@/features/marketplace/services/marketplace-service';
import { lineTotalCents, marketplaceTotals, sumCents } from '@/features/pricing';
import type { CartItem } from '@/features/marketplace/store/cart-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useKeyboard } from '@/providers/keyboard';
import { unwrap } from '@/utils/result';
import { haptics } from '@/utils/haptics';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

export type CheckoutSheetProps = {
  visible: boolean;
  items: CartItem[];
  onClose: () => void;
  onCompleted?: (orderNumbers: string[]) => void;
};

/**
 * Sipariş talebi oluşturma. Ödeme almaz: `market_create_order` yalnızca talep
 * kaydı ve stok düşümü yapar; ödeme durumu "pending" olarak kalır.
 */
export function CheckoutSheet({ visible, items, onClose, onCompleted }: CheckoutSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data: profile } = useMyProfile();
  const { height: keyboardHeight } = useKeyboard();

  // Modal ayri bir pencerede acildigi icin Android'de klavye, pencereyi
  // kucultmuyor; alanlari ve gonder butonunu klavyenin ustunde tutmak icin
  // yuksekligi sayfanin kendisinden ayiriyoruz.
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboardHeight.value + insets.bottom + 12,
  }));

  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cityOpen, setCityOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, CartItem[]>();
    for (const item of items) {
      const list = map.get(item.sellerId) ?? [];
      list.push(item);
      map.set(item.sellerId, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const summary = useMemo(
    () =>
      marketplaceTotals({
        lines: items.map((item) => ({
          unitPriceCents: item.priceCents,
          quantity: item.quantity,
        })),
        pricesIncludeVat: true,
      }),
    [items],
  );
  const total = summary.totalCents;

  const submit = useMutation({
    mutationFn: async () => {
      const fallbackName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim();
      const contact = {
        contact_name: contactName.trim() || fallbackName || null,
        contact_phone: phone.trim() || null,
        shipping_city: city.trim() || null,
        shipping_address: address.trim() || null,
        note: note.trim() || null,
      };

      const numbers: string[] = [];
      for (const [, sellerItems] of groups) {
        const result = await unwrap(
          createOrder({
            items: sellerItems.map((item) => ({
              listing_id: item.listingId,
              quantity: item.quantity,
            })),
            contact,
          }),
        );
        numbers.push(result.order_no);
      }
      return numbers;
    },
    onSuccess: (numbers) => {
      haptics.success();
      void queryClient.invalidateQueries({ queryKey: ['market'] });
      setError(null);
      setNote('');
      onClose();
      Alert.alert(
        'Sipariş talebi gönderildi',
        `${numbers.join(', ')} numaralı talep satıcıya iletildi. Ödeme, satıcı onayından sonra ayrı bir adımda alınacak.`,
      );
      onCompleted?.(numbers);
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent transparent>
      <View style={styles.root}>
        <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.background,
                borderTopLeftRadius: theme.radius.xl,
                borderTopRightRadius: theme.radius.xl,
              },
              keyboardStyle,
            ]}
          >
            <View style={styles.head}>
              <View style={styles.headTitles}>
                <AppText variant="h3">Sipariş talebi</AppText>
                <AppText variant="caption" color="textTertiary">
                  {summary.itemCount} ürün · {formatPrice(total)}
                </AppText>
              </View>
              <IconButton name="close" accessibilityLabel="Kapat" variant="surface" size={19} onPress={close} />
            </View>

            <View style={styles.flex}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.content}
              >
                <View style={[styles.note, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="information-circle-outline" size={17} color={theme.colors.primaryDeep} />
                  <AppText variant="caption" color="primaryDeep" style={styles.flex}>
                    Uygulama içinde ödeme alınmaz. Sipariş talebi satıcıya iletilir; teslimat ve ödeme
                    satıcıyla birlikte planlanır.
                  </AppText>
                </View>

                {groups.map(([sellerId, sellerItems]) => (
                  <View
                    key={sellerId}
                    style={[styles.sellerGroup, { borderColor: theme.colors.border }]}
                  >
                    <View style={styles.itemRow}>
                      <AppText variant="caption" color="textSecondary" style={styles.flex}>
                        Satıcı: @{sellerItems[0]?.sellerUsername ?? '—'}
                      </AppText>
                      <AppText variant="caption" color="textSecondary">
                        {formatPrice(
                          sumCents(
                            sellerItems.map((item) =>
                              lineTotalCents(item.priceCents, item.quantity),
                            ),
                          ),
                        )}
                      </AppText>
                    </View>
                    {sellerItems.map((item) => (
                      <View key={item.listingId} style={styles.itemRow}>
                        <AppText variant="body" numberOfLines={1} style={styles.flex}>
                          {item.title}
                        </AppText>
                        <AppText variant="caption" color="textSecondary">
                          {item.quantity} × {formatPrice(item.priceCents, item.currency)}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ))}

                <TextField
                  label="Ad soyad"
                  placeholder="Teslimat için ad soyad"
                  value={contactName}
                  onChangeText={setContactName}
                  autoCapitalize="words"
                  leftIcon="person-outline"
                />

                <TextField
                  label="Telefon"
                  placeholder="05XX XXX XX XX"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  leftIcon="call-outline"
                />

                <View style={styles.fieldGroup}>
                  <AppText variant="label" color="textSecondary">
                    Şehir
                  </AppText>
                  <Button
                    label={city || 'Şehir seç'}
                    variant="outline"
                    onPress={() => setCityOpen(true)}
                    leftIcon={<Ionicons name="location-outline" size={16} color={theme.colors.text} />}
                    haptic="none"
                  />
                </View>

                <TextField
                  label="Adres"
                  placeholder="Mahalle, sokak, bina, daire"
                  value={address}
                  onChangeText={setAddress}
                  leftIcon="home-outline"
                  multiline
                />

                <TextField
                  label="Satıcıya not (isteğe bağlı)"
                  placeholder="Teslimat veya ürün hakkında not"
                  value={note}
                  onChangeText={setNote}
                  multiline
                />

                {error ? (
                  <View
                    style={[
                      styles.error,
                      { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
                    ]}
                  >
                    <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
                    <AppText variant="caption" color="danger" style={styles.flex}>
                      {error}
                    </AppText>
                  </View>
                ) : null}
              </ScrollView>
            </View>

            <View style={styles.footer}>
              <Button
                label={`Sipariş talebi gönder · ${formatPrice(total)}`}
                onPress={() => submit.mutate()}
                loading={submit.isPending}
                disabled={items.length === 0}
              />
            </View>

            <SelectSheet
              visible={cityOpen}
              title="Şehir seç"
              options={PROVINCES}
              value={city}
              onClose={() => setCityOpen(false)}
              onSelect={(value) => {
                setCity(value);
                setCityOpen(false);
              }}
            />
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '90%', paddingTop: 10 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headTitles: { flex: 1, gap: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 18, gap: 12 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 14,
  },
  sellerGroup: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldGroup: { gap: 6 },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  footer: { paddingHorizontal: 20, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'transparent' },
});
