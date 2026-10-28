import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from '@/utils/router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Screen, ScreenHeader } from '@/components/ui';
import { CheckoutSheet } from '@/features/marketplace/components/CheckoutSheet';
import { formatPrice } from '@/features/marketplace/services/marketplace-service';
import { cartTotal, useCartStore, type CartItem } from '@/features/marketplace/store/cart-store';
import { publicMediaUrl } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

export default function CartScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const items = useCartStore((state) => state.items);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const remove = useCartStore((state) => state.remove);
  const removeSeller = useCartStore((state) => state.removeSeller);
  const clear = useCartStore((state) => state.clear);

  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, CartItem[]>();
    for (const item of items) {
      const list = map.get(item.sellerId) ?? [];
      list.push(item);
      map.set(item.sellerId, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const total = cartTotal(items);

  if (items.length === 0) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <ScreenHeader title="Sepet" onBack={() => router.back()} />
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="bag-handle-outline" size={28} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="h3" align="center">
            Sepetin boş
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Beğendiğin ilanları sepete ekleyerek satıcıya sipariş talebi gönderebilirsin.
          </AppText>
          <Button
            label="Marketplace'e göz at"
            variant="secondary"
            onPress={() => router.navigate('/marketplace')}
            style={styles.emptyButton}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.header}>
        <ScreenHeader
          title="Sepet"
          subtitle={`${items.length} ürün · ${groups.length} satıcı`}
          onBack={() => router.back()}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sepeti boşalt"
              hitSlop={8}
              onPress={() =>
                Alert.alert('Sepeti boşalt', 'Sepetteki tüm ürünler kaldırılacak.', [
                  { text: 'Vazgeç', style: 'cancel' },
                  { text: 'Boşalt', style: 'destructive', onPress: () => clear() },
                ])
              }
              style={styles.clearButton}
            >
              <AppText variant="caption" color="danger">
                Temizle
              </AppText>
            </Pressable>
          }
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {groups.map(([sellerId, sellerItems]) => {
          const sellerTotal = sellerItems.reduce(
            (sum, item) => sum + item.priceCents * item.quantity,
            0,
          );
          return (
            <View
              key={sellerId}
              style={[
                styles.sellerCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <View style={styles.sellerHead}>
                <Ionicons name="storefront-outline" size={15} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  @{sellerItems[0]?.sellerUsername ?? 'satıcı'}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {formatPrice(sellerTotal)}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Satıcının ürünlerini sepetten çıkar"
                  hitSlop={6}
                  onPress={() => removeSeller(sellerId)}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={17}
                    color={theme.colors.textTertiary}
                  />
                </Pressable>
              </View>

              {sellerItems.map((item) => (
                <View key={item.listingId} style={styles.itemRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title} ilanını aç`}
                    onPress={() => router.push(`/marketplace/${item.listingId}` as never)}
                    style={styles.thumb}
                  >
                    {item.imagePath ? (
                      <Image
                        source={{
                          uri: publicMediaUrl('listing-images', item.imagePath) ?? undefined,
                        }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={140}
                      />
                    ) : (
                      <View
                        style={[
                          StyleSheet.absoluteFill,
                          styles.thumbFallback,
                          { backgroundColor: theme.colors.surfaceMuted },
                        ]}
                      >
                        <Ionicons
                          name="image-outline"
                          size={18}
                          color={theme.colors.textTertiary}
                        />
                      </View>
                    )}
                  </Pressable>

                  <View style={styles.itemBody}>
                    <AppText variant="bodyStrong" numberOfLines={2}>
                      {item.title}
                    </AppText>
                    <AppText variant="label" color="primaryDeep">
                      {formatPrice(item.priceCents, item.currency)}
                    </AppText>

                    <View style={styles.itemActions}>
                      <View style={styles.stepper}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Adet azalt"
                          onPress={() => {
                            haptics.selection();
                            setQuantity(item.listingId, item.quantity - 1);
                          }}
                          style={[styles.stepButton, { borderColor: theme.colors.border }]}
                        >
                          <Ionicons name="remove" size={14} color={theme.colors.text} />
                        </Pressable>
                        <AppText variant="caption">{item.quantity}</AppText>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Adet artır"
                          disabled={item.quantity >= item.stock}
                          onPress={() => {
                            haptics.selection();
                            setQuantity(item.listingId, item.quantity + 1);
                          }}
                          style={[
                            styles.stepButton,
                            {
                              borderColor: theme.colors.border,
                              opacity: item.quantity >= item.stock ? 0.4 : 1,
                            },
                          ]}
                        >
                          <Ionicons name="add" size={14} color={theme.colors.text} />
                        </Pressable>
                      </View>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Ürünü sepetten çıkar"
                        hitSlop={6}
                        onPress={() => remove(item.listingId)}
                      >
                        <AppText variant="caption" color="danger">
                          Kaldır
                        </AppText>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          );
        })}

        <View style={[styles.note, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Ionicons name="shield-checkmark-outline" size={17} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Ödeme uygulama içinde alınmaz. Sipariş talebi satıcıya iletilir, ödeme ve teslimat
            satıcıyla birlikte planlanır. Aynı sipariş yalnızca tek satıcının ürünlerini içerebilir;
            birden fazla satıcı varsa her biri için ayrı talep oluşturulur.
          </AppText>
        </View>
      </ScrollView>

      <View
        style={[
          styles.checkoutBar,
          {
            backgroundColor: theme.colors.background,
            borderTopColor: theme.colors.divider,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <View style={styles.totalRow}>
          <AppText variant="caption" color="textSecondary">
            Toplam
          </AppText>
          <AppText variant="h3" color="primaryDeep">
            {formatPrice(total)}
          </AppText>
        </View>
        <Button label="Sipariş talebi gönder" onPress={() => setCheckoutOpen(true)} />
      </View>

      <CheckoutSheet
        visible={checkoutOpen}
        items={items}
        onClose={() => setCheckoutOpen(false)}
        onCompleted={() => {
          clear();
          router.push('/marketplace/orders' as never);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20 },
  clearButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 },
  content: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  empty: {
    paddingHorizontal: 34,
    paddingTop: 70,
    alignItems: 'center',
    gap: 10,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyButton: { marginTop: 10 },
  sellerCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 12,
  },
  sellerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemRow: { flexDirection: 'row', gap: 11 },
  thumb: { width: 76, height: 76, borderRadius: 14, overflow: 'hidden' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  itemBody: { flex: 1, gap: 4 },
  itemActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepButton: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 14,
  },
  flex: { flex: 1 },
  checkoutBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
