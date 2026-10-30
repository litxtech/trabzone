import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Screen, ScreenHeader, Skeleton } from '@/components/ui';
import { StorageImage } from '@/features/explore/components/StorageImage';
import { useMyListings } from '@/features/explore/hooks/use-explore';
import type { MyListing } from '@/features/explore/types';
import { formatMoney, formatRelative } from '@/features/explore/utils/format';
import { listingStatusLabel } from '@/features/real-estate/labels';
import { useTheme } from '@/theme/ThemeProvider';
import { ViewCount } from '@/features/views/components/ViewCount';
import { useRouter } from '@/utils/router';

type FilterKey = 'all' | 'draft' | 'pending' | 'published' | 'rejected';

const FILTERS: { key: FilterKey; label: string; statuses: string[] | null }[] = [
  { key: 'all', label: 'Tümü', statuses: null },
  { key: 'draft', label: 'Taslak', statuses: ['draft', 'rejected'] },
  { key: 'pending', label: 'Doğrulama', statuses: ['pending_verification', 'pending_moderation'] },
  { key: 'published', label: 'Yayında', statuses: ['published'] },
  { key: 'rejected', label: 'Reddedilen', statuses: ['rejected'] },
];
export default function MyRealEstateListingsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const listings = useMyListings();
  const [filter, setFilter] = useState<FilterKey>('all');

  const items = useMemo(() => {
    const all = listings.data?.items ?? [];
    const entry = FILTERS.find((item) => item.key === filter);
    if (!entry?.statuses) return all;
    return all.filter((item) => entry.statuses?.includes(item.status));
  }, [filter, listings.data?.items]);

  const counts = useMemo(() => {
    const all = listings.data?.items ?? [];
    return {
      all: all.length,
      draft: all.filter((item) => ['draft', 'rejected'].includes(item.status)).length,
      pending: all.filter((item) =>
        ['pending_verification', 'pending_moderation'].includes(item.status),
      ).length,
      published: all.filter((item) => item.status === 'published').length,
      rejected: all.filter((item) => item.status === 'rejected').length,
    };
  }, [listings.data?.items]);

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <ScreenHeader
        title="İlanlarım"
        subtitle="Yayın, taslak ve doğrulama durumları"
        onBack={() => router.back()}
      />

      <View style={styles.summary}>
        <Summary label="Toplam" value={counts.all} tone={theme.colors.primaryDeep} />
        <Summary label="Yayında" value={counts.published} tone={theme.colors.success} />
        <Summary label="Doğrulama" value={counts.pending} tone={theme.colors.warning} />
        <Summary label="Taslak" value={counts.draft} tone={theme.colors.textSecondary} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {FILTERS.map((item) => {
          const active = filter === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(item.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                  borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {listings.isLoading ? (
        <View style={styles.skeleton}>
          <Skeleton height={88} radius={16} />
          <Skeleton height={88} radius={16} />
          <Skeleton height={88} radius={16} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="albums-outline" size={26} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="h3" align="center">
            Bu filtrede ilan yok
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Yeni bir emlak ilanı oluşturarak Trabzon’daki alıcılara ulaş.
          </AppText>
          <Button
            label="İlan oluştur"
            onPress={() => router.push('/marketplace/real-estate/create' as never)}
            style={styles.emptyButton}
          />
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <ListingRow key={item.id} item={item} />
          ))}
        </View>
      )}

      <View style={styles.footer}>
        <Button
          label="Yeni ilan oluştur"
          variant="secondary"
          onPress={() => router.push('/marketplace/real-estate/create' as never)}
        />
      </View>
    </Screen>
  );
}

function ListingRow({ item }: { item: MyListing }) {
  const router = useRouter();
  const { theme } = useTheme();
  const status = listingStatusLabel(item.status);
  const editable = ['draft', 'rejected', 'published', 'expired', 'archived'].includes(item.status);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={() => router.push(`/marketplace/real-estate/${item.id}` as never)}
      style={({ pressed }) => [
        styles.row,
        theme.shadows.xs,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: theme.colors.surfaceMuted }]}>
        <StorageImage
          path={item.cover_path}
          bucket="real-estate-media"
          style={StyleSheet.absoluteFill}
        />
        {!item.cover_path ? (
          <Ionicons name="home-outline" size={22} color={theme.colors.textTertiary} />
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <AppText variant="bodyStrong" numberOfLines={2} style={styles.flex}>
            {item.title}
          </AppText>
          <Badge label={status.label} tone={status.tone} />
        </View>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {[item.district, item.neighborhood].filter(Boolean).join(', ') || 'Trabzon'} ·{' '}
          {item.category_name}
        </AppText>
        <View style={styles.rowMeta}>
          <AppText variant="bodyStrong" color="primaryDeep">
            {formatMoney(item.price_cents, item.currency)}
          </AppText>
          <View style={styles.metaRight}>
            <ViewCount
              type="real_estate_listing"
              id={item.id}
              size={12}
              showLabel
              label="görüntüleme"
            />
            <AppText variant="caption" color="textTertiary">
              {formatRelative(item.updated_at)}
            </AppText>
          </View>
        </View>
        {item.rejection_reason ? (
          <AppText variant="caption" color="danger" numberOfLines={2}>
            {item.rejection_reason}
          </AppText>
        ) : null}
        {editable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="İlanı düzenle"
            onPress={(event) => {
              event.stopPropagation();
              router.push(`/marketplace/real-estate/create?id=${item.id}` as never);
            }}
            style={[styles.editButton, { backgroundColor: theme.colors.primarySoft }]}
          >
            <Ionicons name="create-outline" size={14} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep">
              Düzenle
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.summaryCell, { borderColor: theme.colors.border }]}>
      <AppText variant="h3" color={tone}>
        {value}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  summaryCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chips: { gap: 7, paddingVertical: 12, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: 9 },
  row: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 78,
    height: 92,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 5 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metaRight: { alignItems: 'flex-end', gap: 1 },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    alignSelf: 'flex-start',
  },
  empty: { alignItems: 'center', gap: 9, paddingVertical: 36, paddingHorizontal: 24 },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyButton: { maxWidth: 240 },
  skeleton: { gap: 9 },
  footer: { paddingTop: 16 },
  flex: { flex: 1 },
});
