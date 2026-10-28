import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { formatViewCount } from '../format';
import type { ViewContentType } from '../types';
import { useOwnViewStats } from '../use-content-views';

type Props = {
  visible: boolean;
  onClose: () => void;
  type: ViewContentType;
  id: string | null;
  /** İçerik başlığı; başlık alanı boş bırakılabilir. */
  title?: string;
};

const formatDay = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
  });

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatNumber = (value: number) => value.toLocaleString('tr-TR');

/**
 * İçerik sahibine özel tekil görüntüleme özeti.
 *
 * Görüntüleyen hesapların kimlikleri hiçbir koşulda listelenmez; yalnızca
 * toplulaştırılmış sayılar ve günlük eğilim gösterilir.
 */
export function ContentStatsSheet({ visible, onClose, type, id, title }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const stats = useOwnViewStats(type, visible ? id : null, visible);

  const data = stats.data ?? null;
  const series = data?.series ?? [];
  const maxSeries = Math.max(...series.map((point) => point.views), 1);

  const metrics = useMemo(() => {
    const source = data?.metrics;
    if (!source) {
      return [] as { key: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; value: string }[];
    }
    const rows: {
      key: string;
      label: string;
      icon: React.ComponentProps<typeof Ionicons>['name'];
      value: string | number;
    }[] = [
      { key: 'like', label: 'Beğeni', icon: 'heart-outline', value: source.like_count ?? 0 },
      { key: 'comment', label: 'Yorum', icon: 'chatbubble-outline', value: source.comment_count ?? 0 },
      { key: 'save', label: 'Kaydetme', icon: 'bookmark-outline', value: source.save_count ?? 0 },
      { key: 'share', label: 'Paylaşım', icon: 'paper-plane-outline', value: source.share_count ?? 0 },
    ];
    return rows.map((row) => ({ ...row, value: formatNumber(Number(row.value)) }));
  }, [data?.metrics]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="İstatistikleri kapat"
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View style={[styles.wrap, { paddingBottom: insets.bottom + 12 }]}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.xl,
              },
            ]}
          >
            <View style={styles.head}>
              <View style={styles.headText}>
                <AppText variant="title">İçerik istatistikleri</AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {title?.trim() || 'Tekil görüntüleme özeti'}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                hitSlop={8}
                onPress={onClose}
                style={[styles.close, { backgroundColor: theme.colors.surfaceMuted }]}
              >
                <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            {stats.isLoading ? (
              <View style={styles.center}>
                <ActivityIndicator color={theme.colors.primary} />
              </View>
            ) : stats.isError || !data ? (
              <View style={styles.center}>
                <Ionicons name="alert-circle-outline" size={22} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textSecondary" align="center">
                  İstatistikler şu anda görüntülenemiyor.
                </AppText>
              </View>
            ) : (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
              >
                <View
                  style={[
                    styles.hero,
                    {
                      backgroundColor: theme.colors.primarySoft,
                      borderRadius: theme.radius.lg,
                    },
                  ]}
                >
                  <View style={styles.heroRow}>
                    <Ionicons name="eye-outline" size={20} color={theme.colors.primaryDeep} />
                    <AppText variant="h1" color="primaryDeep">
                      {formatViewCount(data.unique_views)}
                    </AppText>
                  </View>
                  <AppText variant="caption" color="primaryDeep">
                    Tekil görüntüleme · her hesap yalnızca bir kez sayılır
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    İlk sayım {formatDate(data.counted_since)} · Son görüntüleme{' '}
                    {formatDate(data.last_viewed_at)}
                  </AppText>
                </View>

                {data.legacy_views > 0 ? (
                  <View
                    style={[
                      styles.legacy,
                      { borderColor: theme.colors.border, borderRadius: theme.radius.md },
                    ]}
                  >
                    <View style={styles.legacyHead}>
                      <Ionicons
                        name="information-circle-outline"
                        size={16}
                        color={theme.colors.warning}
                      />
                      <AppText variant="caption" color="textSecondary" style={styles.flex}>
                        {data.legacy_label || 'Eski toplam görüntüleme (tekil doğrulanmamış)'}
                      </AppText>
                    </View>
                    <AppText variant="bodyStrong">{formatNumber(data.legacy_views)}</AppText>
                    <AppText variant="caption" color="textTertiary">
                      Geçmiş dönemde tekil hesap doğrulaması yapılmadığı için bu sayı tekil
                      görüntüleme olarak sunulmaz.
                    </AppText>
                  </View>
                ) : null}

                {metrics.length > 0 ? (
                  <View style={styles.grid}>
                    {metrics.map((metric) => (
                      <View
                        key={metric.key}
                        style={[
                          styles.metric,
                          {
                            backgroundColor: theme.colors.surfaceMuted,
                            borderRadius: theme.radius.md,
                          },
                        ]}
                      >
                        <Ionicons
                          name={metric.icon}
                          size={15}
                          color={theme.colors.textTertiary}
                        />
                        <AppText variant="bodyStrong">{metric.value}</AppText>
                        <AppText variant="caption" color="textTertiary">
                          {metric.label}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={styles.trendHead}>
                  <AppText variant="bodyStrong">Son 30 gün</AppText>
                  <AppText variant="caption" color="textTertiary">
                    günlük yeni tekil görüntüleme
                  </AppText>
                </View>

                {series.length > 0 ? (
                  <>
                    <View style={styles.bars}>
                      {series.map((point) => {
                        const height = Math.max((point.views / maxSeries) * 54, 3);
                        return (
                          <View
                            key={point.date}
                            style={[
                              styles.bar,
                              {
                                height,
                                backgroundColor:
                                  point.views > 0
                                    ? theme.colors.primary
                                    : theme.colors.surfaceMuted,
                                borderRadius: 3,
                              },
                            ]}
                            accessibilityLabel={`${formatDay(point.date)}: ${point.views} görüntüleme`}
                          />
                        );
                      })}
                    </View>
                    <View style={styles.axis}>
                      <AppText variant="caption" color="textTertiary">
                        {formatDay(series[0]?.date ?? '')}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {formatDay(series[series.length - 1]?.date ?? '')}
                      </AppText>
                    </View>
                  </>
                ) : (
                  <AppText variant="caption" color="textTertiary">
                    Henüz günlük veri yok.
                  </AppText>
                )}

                <AppText variant="caption" color="textTertiary">
                  Görüntüleyen hesapların kimlikleri gizlilik nedeniyle gösterilmez. Bu sayı
                  tekrar oynatma toplamı değil, farklı hesapların tekil görüntülemesidir.
                </AppText>
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  wrap: { paddingHorizontal: 12 },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '86%',
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  headText: { flex: 1, gap: 2 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 16, paddingBottom: 18, gap: 12 },
  center: { paddingVertical: 34, alignItems: 'center', gap: 8 },
  hero: { padding: 14, gap: 4 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legacy: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  legacyHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { flexGrow: 1, flexBasis: '22%', minWidth: 74, padding: 10, gap: 2 },
  trendHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 58,
  },
  bar: { flex: 1, minWidth: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  flex: { flex: 1 },
});
