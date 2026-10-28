import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button, Card, Screen, ScreenHeader, Skeleton } from '@/components/ui';
import { ListingCard } from '@/features/marketplace/components/ListingCard';
import {
  useSeller,
  useSellerListings,
  useToggleFavorite,
} from '@/features/marketplace/hooks/use-marketplace';
import { useStartDirectConversation } from '@/features/messaging/hooks/use-chat';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

export default function SellerScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const sellerId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { theme } = useTheme();

  const seller = useSeller(sellerId || null);
  const listings = useSellerListings(sellerId || null);
  const favorite = useToggleFavorite();
  const startChat = useStartDirectConversation();

  const [tab, setTab] = useState<'listings' | 'reviews'>('listings');

  const data = seller.data;
  const name = useMemo(
    () =>
      data ? `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || data.username : 'Satıcı',
    [data],
  );

  const messageSeller = () => {
    if (!sellerId) {
      return;
    }
    startChat.mutate(sellerId, {
      onSuccess: ({ id }) => router.push(`/chat/${id}` as never),
      onError: (error) => Alert.alert('Sohbet açılamadı', error.message),
    });
  };

  if (seller.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <ScreenHeader title="Satıcı" onBack={() => router.back()} />
        <View style={styles.skeleton}>
          <Skeleton height={100} radius={20} />
          <Skeleton height={70} radius={16} />
          <Skeleton height={180} radius={18} />
        </View>
      </Screen>
    );
  }

  if (seller.isError || !data) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <ScreenHeader title="Satıcı" onBack={() => router.back()} />
        <Card style={styles.stateCard}>
          <Ionicons name="storefront-outline" size={28} color={theme.colors.textSecondary} />
          <AppText variant="bodyStrong">Satıcı bulunamadı</AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Bu satıcı hesabı kaldırılmış olabilir.
          </AppText>
          <Button label="Geri dön" variant="secondary" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.header}>
        <ScreenHeader title="Satıcı profili" onBack={() => router.back()} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.identity} padding={16}>
          <View style={styles.identityRow}>
            <Avatar uri={mediaPublicUrl('avatar', data.avatar_path)} name={name} size={64} ring />
            <View style={styles.identityText}>
              <View style={styles.nameRow}>
                <AppText variant="h3" numberOfLines={1} style={styles.flex}>
                  {name}
                </AppText>
                {data.is_verified ? (
                  <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} />
                ) : null}
              </View>
              <AppText variant="caption" color="textTertiary">
                @{data.username}
              </AppText>
              <View style={styles.metaRow}>
                {data.city ? (
                  <View style={styles.meta}>
                    <Ionicons name="location-outline" size={12} color={theme.colors.textTertiary} />
                    <AppText variant="caption" color="textSecondary">
                      {data.city}
                    </AppText>
                  </View>
                ) : null}
                <View style={styles.meta}>
                  <Ionicons name="calendar-outline" size={12} color={theme.colors.textTertiary} />
                  <AppText variant="caption" color="textSecondary">
                    {formatDateTr(data.created_at)}
                  </AppText>
                </View>
              </View>
            </View>
          </View>

          {data.bio ? (
            <AppText variant="body" color="textSecondary">
              {data.bio}
            </AppText>
          ) : null}

          <View style={[styles.stats, { borderColor: theme.colors.divider }]}>
            <Stat value={data.listings} label="İlan" />
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <Stat value={data.sales} label="Satış" />
            <View style={[styles.statDivider, { backgroundColor: theme.colors.divider }]} />
            <Stat
              value={data.rating ? Number(data.rating.toFixed(1)) : 0}
              label={data.review_count > 0 ? `${data.review_count} değerlendirme` : 'Değerlendirme'}
              icon="star"
            />
          </View>

          <View style={styles.actions}>
            <Button
              label="Mesaj gönder"
              onPress={messageSeller}
              loading={startChat.isPending}
              leftIcon={<Ionicons name="chatbubble-outline" size={16} color="#FFFFFF" />}
              style={styles.flex}
            />
            <Button
              label="Profili gör"
              variant="outline"
              onPress={() => router.push(`/profile/${data.username}` as never)}
              style={styles.flex}
            />
          </View>
        </Card>

        <View style={[styles.tabs, { borderColor: theme.colors.divider }]}>
          <Tab
            label={`İlanlar (${data.listings})`}
            active={tab === 'listings'}
            onPress={() => setTab('listings')}
          />
          <Tab
            label={`Değerlendirmeler (${data.review_count})`}
            active={tab === 'reviews'}
            onPress={() => setTab('reviews')}
          />
        </View>

        {tab === 'listings' ? (
          listings.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : (listings.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <AppText variant="body" color="textSecondary" align="center">
                Bu satıcının yayında ilanı yok.
              </AppText>
            </View>
          ) : (
            <View style={styles.grid}>
              {(listings.data ?? []).map((listing) => (
                <View key={listing.id} style={styles.gridCell}>
                  <ListingCard
                    listing={listing}
                    onPress={() => router.push(`/marketplace/${listing.id}` as never)}
                    onToggleFavorite={() => favorite.mutate(listing.id)}
                    favoritePending={favorite.isPending && favorite.variables === listing.id}
                  />
                </View>
              ))}
            </View>
          )
        ) : data.reviews.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="star-outline" size={24} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="bodyStrong">Henüz değerlendirme yok</AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Tamamlanan siparişlerden sonra alıcı yorumları burada görünür.
            </AppText>
          </View>
        ) : (
          <View style={styles.reviews}>
            {data.reviews.map((review) => (
              <Card key={review.id} padding={13} style={styles.reviewCard}>
                <View style={styles.reviewHead}>
                  <AppText variant="caption" color="textSecondary">
                    @{review.reviewer_username}
                  </AppText>
                  <View style={styles.reviewStars}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Ionicons
                        key={value}
                        name={value <= review.rating ? 'star' : 'star-outline'}
                        size={12}
                        color={
                          value <= review.rating ? theme.colors.warning : theme.colors.textTertiary
                        }
                      />
                    ))}
                  </View>
                </View>
                {review.comment ? (
                  <AppText variant="body" color="textSecondary">
                    {review.comment}
                  </AppText>
                ) : null}
                <AppText variant="caption" color="textTertiary">
                  {formatDateTr(review.created_at)}
                </AppText>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({
  value,
  label,
  icon,
}: {
  value: number;
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.stat}>
      <View style={styles.statValue}>
        {icon ? <Ionicons name={icon} size={13} color={theme.colors.warning} /> : null}
        <AppText variant="h3">{value.toLocaleString('tr-TR')}</AppText>
      </View>
      <AppText variant="caption" color="textTertiary" align="center">
        {label}
      </AppText>
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, { borderBottomColor: active ? theme.colors.primary : 'transparent' }]}
    >
      <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20 },
  skeleton: { paddingHorizontal: 20, gap: 12 },
  stateCard: { alignItems: 'center', gap: 10, marginTop: 20 },
  content: { paddingHorizontal: 20, paddingBottom: 30, gap: 14 },
  identity: { gap: 12 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identityText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  statValue: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28 },
  actions: { flexDirection: 'row', gap: 10 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 2 },
  flex: { flex: 1 },
  loading: { paddingVertical: 30, alignItems: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 20 },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridCell: { width: '48%' },
  reviews: { gap: 8 },
  reviewCard: { gap: 6 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewStars: { flexDirection: 'row', gap: 1 },
});
