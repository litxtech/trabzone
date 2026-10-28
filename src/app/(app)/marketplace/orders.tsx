import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppText,
  Avatar,
  Button,
  Card,
  IconButton,
  Screen,
  ScreenHeader,
  Skeleton,
  TextField,
} from '@/components/ui';
import {
  useBuyerOrders,
  useSellerOrders,
  useSubmitReview,
  useUpdateOrderStatus,
} from '@/features/marketplace/hooks/use-marketplace';
import {
  ORDER_STATUS_LABELS,
  fetchOrderReceipt,
  fetchSalesSummary,
  formatPrice,
  type MarketOrder,
  type OrderStatus,
} from '@/features/marketplace/services/marketplace-service';
import { shareOrderReceipt, shareSalesReport } from '@/features/marketplace/services/order-pdf';
import { publicMediaUrl } from '@/features/media/media-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';
import { unwrap } from '@/utils/result';

type Role = 'buyer' | 'seller';

export default function OrdersScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [role, setRole] = useState<Role>('buyer');
  const buyerOrders = useBuyerOrders();
  const sellerOrders = useSellerOrders();
  const updateStatus = useUpdateOrderStatus();

  const [reviewOrder, setReviewOrder] = useState<MarketOrder | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const submitReview = useSubmitReview();

  const active = role === 'buyer' ? buyerOrders : sellerOrders;
  const orders = active.data ?? [];

  const salesSummary = useQuery({
    queryKey: ['market', 'sales-summary'],
    queryFn: async () => unwrap(fetchSalesSummary('mine')),
    staleTime: 60_000,
  });

  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const shareReceipt = async (order: MarketOrder) => {
    haptics.tap();
    setPdfBusy(order.id);
    const receipt = await fetchOrderReceipt(order.id);
    setPdfBusy(null);
    if (!receipt.ok) {
      Alert.alert('Fiş oluşturulamadı', receipt.error.message);
      return;
    }
    const shared = await shareOrderReceipt(receipt.data);
    if (!shared.ok) {
      Alert.alert('PDF', shared.error.message);
    }
  };

  const shareReport = async () => {
    if (!salesSummary.data) {
      return;
    }
    haptics.tap();
    const sellerList = sellerOrders.data ?? [];
    const result = await shareSalesReport({
      orders: sellerList.map((order) => ({
        order_no: order.order_no,
        created_at: order.created_at,
        status: order.status,
        total_cents: order.total_cents,
        currency: order.currency,
        buyer_username: order.counterpart_username,
        seller_username: 'ben',
      })),
      summary: salesSummary.data,
      scope: 'mine',
      ownerLabel: 'Satış özeti',
    });
    if (!result.ok) {
      Alert.alert('PDF', result.error.message);
    }
  };

  const changeStatus = (order: MarketOrder, status: OrderStatus) => {
    updateStatus.mutate(
      { orderId: order.id, status },
      {
        onSuccess: () => haptics.success(),
        onError: (error) => Alert.alert('Durum güncellenemedi', error.message),
      },
    );
  };

  const sendReview = () => {
    if (!reviewOrder) {
      return;
    }
    setReviewError(null);
    submitReview.mutate(
      { orderId: reviewOrder.id, rating, comment: comment.trim() || null },
      {
        onSuccess: () => {
          haptics.success();
          setReviewOrder(null);
          setComment('');
          setRating(5);
          Alert.alert('Değerlendirme gönderildi', 'Geri bildirimin satıcıyla paylaşıldı.');
        },
        onError: (error) => setReviewError(error.message),
      },
    );
  };

  const statusTone = (status: MarketOrder['status']) => {
    if (status === 'completed') return theme.colors.success;
    if (status === 'cancelled' || status === 'rejected') return theme.colors.danger;
    if (status === 'shipped' || status === 'delivered') return theme.colors.primaryDeep;
    return theme.colors.textSecondary;
  };

  const renderOrder = (order: MarketOrder) => {
    const name =
      `${order.counterpart_first_name ?? ''} ${order.counterpart_last_name ?? ''}`.trim() ||
      order.counterpart_username;

    return (
      <Card key={order.id} style={styles.orderCard} padding={14}>
        <View style={styles.orderHead}>
          <View style={styles.flex}>
            <AppText variant="label">{order.order_no}</AppText>
            <AppText variant="caption" color="textTertiary">
              {formatDateTr(order.created_at)} · {order.item_count} ürün
            </AppText>
          </View>
          <View style={[styles.statusPill, { backgroundColor: theme.colors.surfaceMuted }]}>
            <AppText variant="caption" color={statusTone(order.status)}>
              {ORDER_STATUS_LABELS[order.status]}
            </AppText>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name} profiline git`}
          onPress={() =>
            router.push(
              role === 'buyer'
                ? (`/marketplace/seller/${order.counterpart_id}` as never)
                : (`/profile/${order.counterpart_username}` as never),
            )
          }
          style={styles.counterpart}
        >
          <Avatar
            uri={mediaPublicUrl('avatar', order.counterpart_avatar_path)}
            name={name}
            size={36}
          />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {name}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {role === 'buyer' ? 'Satıcı' : 'Alıcı'} · @{order.counterpart_username}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
        </Pressable>

        <View style={styles.items}>
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title} ilanını aç`}
                onPress={() => router.push(`/marketplace/${item.listing_id}` as never)}
                style={styles.itemThumb}
              >
                {item.image_path ? (
                  <Image
                    source={{ uri: publicMediaUrl('listing-images', item.image_path) ?? undefined }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                ) : (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      styles.thumbFallback,
                      { backgroundColor: theme.colors.surfaceMuted },
                    ]}
                  >
                    <Ionicons name="image-outline" size={15} color={theme.colors.textTertiary} />
                  </View>
                )}
              </Pressable>
              <View style={styles.flex}>
                <AppText variant="caption" numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {item.quantity} × {formatPrice(item.unit_price_cents)}
                </AppText>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.orderFoot, { borderTopColor: theme.colors.divider }]}>
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary">
              Toplam
            </AppText>
            <AppText variant="bodyStrong" color="primaryDeep">
              {formatPrice(order.total_cents, order.currency)}
            </AppText>
          </View>

          <View style={styles.orderActions}>
            <SmallAction
              label={pdfBusy === order.id ? 'Hazırlanıyor…' : 'Fiş (PDF)'}
              onPress={() => void shareReceipt(order)}
              color="primary"
            />
            {role === 'seller' && order.status === 'requested' ? (
              <>
                <SmallAction
                  label="Reddet"
                  onPress={() => changeStatus(order, 'rejected')}
                  color="danger"
                />
                <SmallAction
                  label="Onayla"
                  onPress={() => changeStatus(order, 'confirmed')}
                  color="primary"
                  filled
                />
              </>
            ) : null}

            {role === 'seller' && order.status === 'confirmed' ? (
              <SmallAction
                label="Kargoya ver"
                onPress={() => changeStatus(order, 'shipped')}
                color="primary"
                filled
              />
            ) : null}

            {role === 'seller' && order.status === 'shipped' ? (
              <SmallAction
                label="Teslim edildi"
                onPress={() => changeStatus(order, 'delivered')}
                color="primary"
                filled
              />
            ) : null}

            {role === 'buyer' && order.status === 'requested' ? (
              <SmallAction
                label="Talebi iptal et"
                onPress={() => changeStatus(order, 'cancelled')}
                color="danger"
              />
            ) : null}

            {role === 'buyer' && (order.status === 'shipped' || order.status === 'delivered') ? (
              <SmallAction
                label="Teslim aldım"
                onPress={() => changeStatus(order, 'completed')}
                color="primary"
                filled
              />
            ) : null}

            {role === 'buyer' && (order.status === 'delivered' || order.status === 'completed') ? (
              <SmallAction
                label="Değerlendir"
                onPress={() => {
                  setRating(5);
                  setComment('');
                  setReviewError(null);
                  setReviewOrder(order);
                }}
                color="accent"
              />
            ) : null}
          </View>
        </View>
      </Card>
    );
  };

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.header}>
        <ScreenHeader
          title="Siparişlerim"
          subtitle="Talep, teslimat ve değerlendirmeler"
          onBack={() => router.back()}
        />
      </View>

      <View style={styles.tabs}>
        <Tab label="Satın aldıklarım" active={role === 'buyer'} onPress={() => setRole('buyer')} />
        <Tab label="Satışlarım" active={role === 'seller'} onPress={() => setRole('seller')} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={active.isRefetching}
            onRefresh={() => void active.refetch()}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {role === 'seller' && salesSummary.data ? (
          <Card padding={14} style={styles.summaryCard}>
            <View style={styles.summaryHead}>
              <View style={styles.flex}>
                <AppText variant="caption" color="textTertiary">
                  Satış özeti
                </AppText>
                <AppText variant="h2" color="primaryDeep">
                  {formatPrice(salesSummary.data.gross_cents)}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {salesSummary.data.order_count} sipariş · bu ay{' '}
                  {formatPrice(salesSummary.data.month_cents)}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Satış raporunu PDF olarak paylaş"
                onPress={() => void shareReport()}
                style={({ pressed }) => [
                  styles.reportButton,
                  {
                    backgroundColor: theme.colors.primarySoft,
                    borderColor: theme.colors.primary,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons name="document-text-outline" size={16} color={theme.colors.primaryDeep} />
                <AppText variant="caption" color="primaryDeep">
                  PDF rapor
                </AppText>
              </Pressable>
            </View>
            <View style={styles.summaryStats}>
              <SummaryStat label="Açık talep" value={String(salesSummary.data.open_count)} />
              <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
              <SummaryStat label="Tamamlanan" value={String(salesSummary.data.completed_count)} />
              <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
              <SummaryStat
                label="Tamamlanan ciro"
                value={formatPrice(salesSummary.data.completed_cents)}
              />
            </View>
          </Card>
        ) : null}

        {active.isLoading ? (
          <View style={styles.skeletons}>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} height={160} radius={18} />
            ))}
          </View>
        ) : active.isError ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={28} color={theme.colors.textSecondary} />
            <AppText variant="bodyStrong">Siparişler yüklenemedi</AppText>
            <Button label="Tekrar dene" variant="secondary" onPress={() => void active.refetch()} />
          </View>
        ) : orders.length === 0 ? (
          <View style={styles.state}>
            <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="receipt-outline" size={26} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="h3" align="center">
              {role === 'buyer' ? 'Henüz siparişin yok' : 'Henüz satış talebi yok'}
            </AppText>
            <AppText variant="body" color="textSecondary" align="center">
              {role === 'buyer'
                ? 'Marketplace’te bir ürün bulup satıcıya sipariş talebi gönder.'
                : 'İlanların satıldığında talepler burada görünecek.'}
            </AppText>
            <Button
              label={role === 'buyer' ? 'Marketplace’e git' : 'İlan oluştur'}
              variant="secondary"
              onPress={() =>
                role === 'buyer'
                  ? router.navigate('/marketplace')
                  : router.push('/marketplace/create' as never)
              }
              style={styles.stateButton}
            />
          </View>
        ) : (
          orders.map(renderOrder)
        )}
      </ScrollView>

      <Modal
        visible={reviewOrder !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setReviewOrder(null)}
        statusBarTranslucent
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Değerlendirmeyi kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={() => setReviewOrder(null)}
          />
          <View
            style={[
              styles.reviewSheet,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.xl,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={styles.reviewHead}>
              <AppText variant="h3">Satıcıyı değerlendir</AppText>
              <IconButton
                name="close"
                accessibilityLabel="Kapat"
                variant="surface"
                size={18}
                onPress={() => setReviewOrder(null)}
              />
            </View>

            <AppText variant="caption" color="textSecondary">
              {reviewOrder?.order_no} numaralı sipariş için deneyimini paylaş.
            </AppText>

            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} yıldız`}
                  accessibilityState={{ selected: rating === value }}
                  onPress={() => {
                    haptics.selection();
                    setRating(value);
                  }}
                  hitSlop={4}
                >
                  <Ionicons
                    name={value <= rating ? 'star' : 'star-outline'}
                    size={30}
                    color={value <= rating ? theme.colors.warning : theme.colors.textTertiary}
                  />
                </Pressable>
              ))}
            </View>

            <TextField
              label="Yorum (isteğe bağlı)"
              placeholder="Ürün ve satıcı deneyimin"
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={500}
            />

            {reviewError ? (
              <AppText variant="caption" color="danger">
                {reviewError}
              </AppText>
            ) : null}

            <Button
              label="Değerlendirmeyi gönder"
              onPress={sendReview}
              loading={submitReview.isPending}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={[styles.tab, { borderBottomColor: active ? theme.colors.primary : 'transparent' }]}
    >
      <AppText variant="label" color={active ? 'primaryDeep' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryStat}>
      <AppText variant="bodyStrong" numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function SmallAction({
  label,
  onPress,
  color,
  filled = false,
}: {
  label: string;
  onPress: () => void;
  color: 'danger' | 'primary' | 'accent';
  filled?: boolean;
}) {
  const { theme } = useTheme();
  const tint =
    color === 'danger'
      ? theme.colors.danger
      : color === 'accent'
        ? theme.colors.accent
        : theme.colors.primaryDeep;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallAction,
        {
          backgroundColor: filled ? tint : 'transparent',
          borderColor: tint,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <AppText variant="caption" color={filled ? '#FFFFFF' : tint}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20 },
  tabs: { flexDirection: 'row', paddingHorizontal: 20, gap: 4 },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 2,
  },
  content: { paddingHorizontal: 20, paddingTop: 14, gap: 12 },
  orderCard: { gap: 12 },
  orderHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  counterpart: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  items: { gap: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  itemThumb: { width: 42, height: 42, borderRadius: 10, overflow: 'hidden' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  orderFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  orderActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  smallAction: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 34,
    justifyContent: 'center',
  },
  skeletons: { gap: 10 },
  summaryCard: { gap: 12 },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summaryStats: { flexDirection: 'row', alignItems: 'center' },
  summaryStat: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 26 },
  state: { alignItems: 'center', gap: 10, paddingTop: 40, paddingHorizontal: 20 },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateButton: { marginTop: 6 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  reviewSheet: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 4 },
});
