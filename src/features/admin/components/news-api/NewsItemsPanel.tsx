import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

import { useNewsApiItemAction, useNewsApiItems } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import { Pager } from '../AdminPage';
import { ReasonDialog } from '../ReasonDialog';
import type { NewsItem, NewsItemStatus } from '@/features/news-api/types';

import { EmptyHint, ItemStatusBadge, newsApiStyles } from './shared';
import { NewsItemDetailModal } from './NewsItemDetailModal';

const STATUS_FILTERS: { key: NewsItemStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'published', label: 'Yayında' },
  { key: 'pending_review', label: 'İnceleme' },
  { key: 'drafted', label: 'Taslak' },
  { key: 'blocked', label: 'Engellenen' },
  { key: 'duplicate', label: 'Tekrar' },
  { key: 'removed', label: 'Kaldırılan' },
];

const PAGE_SIZE = 25;

export function NewsItemsPanel({
  connectionId,
  canManage,
  canPublish,
}: {
  connectionId: string;
  canManage: boolean;
  canPublish: boolean;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [status, setStatus] = useState<NewsItemStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<NewsItem | null>(null);
  const action = useNewsApiItemAction();

  const items = useNewsApiItems({
    connectionId,
    status: status === 'all' ? null : status,
    search: query,
    limit: PAGE_SIZE,
    offset,
  });

  const remove = async (item: NewsItem, reason: string) => {
    try {
      await action.mutateAsync({ kind: 'remove', itemId: item.id, reason });
      toast.success('Haber kaldırıldı. Münhasır gönderi ve sitemap kaydı güncellendi.');
      setRemoveTarget(null);
    } catch (removeError) {
      toast.error(errorMessage(removeError, 'Haber kaldırılamadı.'));
    }
  };

  const rows = items.data?.items ?? [];
  const total = items.data?.total ?? 0;

  return (
    <View style={newsApiStyles.gap}>
      <View style={newsApiStyles.row}>
        <TextField
          value={search}
          onChangeText={setSearch}
          placeholder="Başlıkta ara"
          containerStyle={styles.search}
          onSubmitEditing={() => {
            setQuery(search);
            setOffset(0);
          }}
        />
        <Button
          label="Ara"
          size="sm"
          variant="outline"
          fullWidth={false}
          onPress={() => {
            setQuery(search);
            setOffset(0);
          }}
        />
        <Button
          label="Yenile"
          size="sm"
          variant="ghost"
          fullWidth={false}
          loading={items.isFetching}
          onPress={() => void items.refetch()}
        />
      </View>

      <View style={newsApiStyles.chips}>
        {STATUS_FILTERS.map((filter) => {
          const active = filter.key === status;
          return (
            <Pressable
              key={filter.key}
              accessibilityRole="button"
              onPress={() => {
                setStatus(filter.key);
                setOffset(0);
              }}
              style={[
                newsApiStyles.chip,
                {
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                {filter.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {items.isLoading ? (
        <ActivityIndicator />
      ) : rows.length === 0 ? (
        <EmptyHint text="Bu filtreye uygun haber yok. Kaynak açıksa bir sonraki çekim turunu bekle veya elle çalıştır." />
      ) : (
        <View style={[styles.table, { borderColor: theme.colors.border }]}>
          {rows.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => setSelectedItemId(item.id)}
              style={[styles.row, { borderBottomColor: theme.colors.divider }]}
            >
              <View style={styles.rowMain}>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {item.title}
                </AppText>
                <View style={styles.meta}>
                  <ItemStatusBadge status={item.status} />
                  {item.category_slug ? <Badge label={item.category_slug} tone="primary" /> : null}
                  {item.district ? <Badge label={item.district} tone="neutral" /> : null}
                  {item.source_category ? <Badge label={item.source_category} tone="neutral" /> : null}
                  <AppText variant="caption" color="textTertiary">
                    {item.published_at ? formatDateTimeTr(item.published_at) : 'Tarih yok'}
                  </AppText>
                  {item.block_reason ? (
                    <AppText variant="caption" color="danger">
                      {item.block_reason}
                    </AppText>
                  ) : null}
                </View>
              </View>
              <View style={styles.rowActions}>
                {canPublish && item.status !== 'published' && item.status !== 'removed' ? (
                  <Button
                    label="Yayınla"
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    loading={action.isPending}
                    onPress={() => void action.mutateAsync({ kind: 'approve', itemId: item.id })}
                  />
                ) : null}
                {canManage && item.status !== 'removed' ? (
                  <Button
                    label="Kaldır"
                    size="sm"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => setRemoveTarget(item)}
                  />
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <Pager total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />

      <AppText variant="caption" color="textTertiary">
        Kaldırılan haberler sitemap’ten çıkarılır ve münhasır sosyal gönderileri kaldırılır. Google indeksinden
        kaldırma ayrı bir süreçtir.
      </AppText>

      <NewsItemDetailModal
        visible={selectedItemId !== null}
        itemId={selectedItemId}
        canManage={canManage}
        onClose={() => setSelectedItemId(null)}
      />

      <ReasonDialog
        visible={removeTarget !== null}
        title="Haberi kaldır"
        description={`${removeTarget?.title ?? ''} · Münhasırsa sosyal gönderi kaldırılır ve sitemap kaydı düşer.`}
        confirmLabel="Kaldır"
        destructive
        loading={action.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={({ reason }) => {
          if (removeTarget) void remove(removeTarget, reason);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flex: 1, minWidth: 200 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 11 },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, minWidth: 240, gap: 5 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  rowActions: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
});
