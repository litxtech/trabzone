import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
} from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { Distribution, TrendChart } from '@/features/admin/components/Charts';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { formatViewCount } from '@/features/views/format';
import {
  useAdminViewAnalytics,
  useUpdateAdminViewSettings,
} from '@/features/views/use-content-views';
import type {
  AdminViewTopItem,
  AdminViewTypeBreakdown,
  ViewSettings,
} from '@/features/views/types';
import { useTheme } from '@/theme/ThemeProvider';

type RankKey = 'posts' | 'news' | 'marketplace' | 'reels' | 'places';
type RangeKey = 'all' | '7' | '30';

const RANK_LABELS: Record<RankKey, string> = {
  posts: 'Gönderiler',
  news: 'Haberler',
  marketplace: 'Marketplace',
  reels: 'Reels',
  places: 'İşletmeler',
};

const formatNumber = (value: number) => Math.round(value).toLocaleString('tr-TR');

const formatDay = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
  });

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
};

function RankList({ items }: { items: AdminViewTopItem[] }) {
  const { theme } = useTheme();
  if (items.length === 0) {
    return (
      <AppText variant="caption" color="textTertiary">
        Bu içerik türünde henüz tekil görüntüleme yok.
      </AppText>
    );
  }
  return (
    <View style={styles.rankList}>
      {items.map((item, index) => (
        <View
          key={item.id}
          style={[styles.rankRow, index > 0 && { borderTopColor: theme.colors.divider }]}
        >
          <View
            style={[
              styles.rankIndex,
              { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm },
            ]}
          >
            <AppText variant="caption" color="textTertiary">
              {index + 1}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="caption" color="textSecondary" numberOfLines={2}>
              {item.title || 'İçerik'}
            </AppText>
            {item.author_username ? (
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                @{item.author_username}
              </AppText>
            ) : null}
          </View>
          <View style={styles.rankValue}>
            <View style={styles.rankViews}>
              <Ionicons name="eye-outline" size={13} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep">
                {formatViewCount(item.unique_views)}
              </AppText>
            </View>
            {typeof item.legacy_views === 'number' && item.legacy_views > 0 ? (
              <AppText variant="caption" color="textTertiary">
                eski toplam {formatNumber(item.legacy_views)}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export default function AdminViewAnalyticsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const analytics = useAdminViewAnalytics();
  const updateSettings = useUpdateAdminViewSettings();

  const [rank, setRank] = useState<RankKey>('posts');
  const [range, setRange] = useState<RangeKey>('all');
  const [draft, setDraft] = useState<ViewSettings | null>(null);

  const data = analytics.data;
  const permissions = me.data?.permissions ?? [];
  const canManage = permissions.includes('settings.manage');

  useEffect(() => {
    if (data?.settings) {
      setDraft({ ...data.settings });
    }
  }, [data?.settings]);

  const series = useMemo(() => {
    const list = data?.daily_series ?? [];
    const limit = range === '7' ? 7 : range === '30' ? 30 : list.length;
    return list.slice(Math.max(list.length - limit, 0));
  }, [data?.daily_series, range]);

  const topItems = useMemo<AdminViewTopItem[]>(() => {
    if (!data) return [];
    switch (rank) {
      case 'news':
        return data.top_news;
      case 'marketplace':
        return data.top_marketplace;
      case 'reels':
        return data.top_reels;
      case 'places':
        return data.top_places;
      default:
        return data.top_posts;
    }
  }, [data, rank]);

  const byType = useMemo(
    () =>
      (data?.by_type ?? []).map((item: AdminViewTypeBreakdown) => ({
        label: item.label,
        value: item.views,
      })),
    [data?.by_type],
  );

  const setField = (key: keyof ViewSettings, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const numeric = Number(value.replace(',', '.'));
      return { ...current, [key]: Number.isFinite(numeric) ? numeric : current[key] };
    });
  };

  const save = async () => {
    if (!draft) return;
    try {
      await updateSettings.mutateAsync({
        min_visible_ratio: draft.min_visible_ratio,
        min_visible_ms: draft.min_visible_ms,
        video_min_play_ms: draft.video_min_play_ms,
        batch_window_ms: draft.batch_window_ms,
        rate_limit_per_minute: draft.rate_limit_per_minute,
        daily_active_retention_days: draft.daily_active_retention_days,
        enabled: draft.enabled,
      });
      toast.success('Görüntüleme eşikleri güncellendi.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Eşikler kaydedilemedi.');
    }
  };

  return (
    <AdminPage
      title="Görüntüleme Analitiği"
      subtitle="Hesap bazlı tekil görüntüleme: 1 hesap + 1 içerik = en fazla 1 sayım. Tekrar açılışlar, diğer cihazlar ve web aynı kaydı kullanır."
      refreshing={analytics.isRefetching}
      onRefresh={() => void analytics.refetch()}
      actions={
        <Badge
          label={data ? `${formatNumber(data.lifetime.records)} tekil kayıt` : 'Yükleniyor'}
          tone="primary"
        />
      }
    >
      {analytics.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : analytics.isError || !data ? (
        <AdminSection title="Veri alınamadı" subtitle="report.view yetkisi gerekir.">
          <AppText variant="caption" color="textSecondary">
            Analitik servisine erişilemedi. Yetkinizi ve bağlantıyı kontrol edip yeniden deneyin.
          </AppText>
          <Button label="Yeniden dene" size="sm" fullWidth={false} onPress={() => void analytics.refetch()} />
        </AdminSection>
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Bugün tekil görüntüleme"
              value={formatNumber(data.today.views)}
              hint={`${formatNumber(data.today.accounts)} benzersiz hesap`}
              icon="eye-outline"
            />
            <StatCard
              label="Son 7 gün"
              value={formatNumber(data.week.views)}
              hint={`${formatNumber(data.week.accounts)} benzersiz hesap`}
              icon="calendar-outline"
              tone="accent"
            />
            <StatCard
              label="Son 30 gün"
              value={formatNumber(data.month.views)}
              hint={`${formatNumber(data.month.accounts)} benzersiz hesap`}
              icon="stats-chart-outline"
              tone="success"
            />
            <StatCard
              label="Toplam tekil görüntüleme"
              value={formatViewCount(data.lifetime.views)}
              hint={`${formatNumber(data.lifetime.accounts)} benzersiz hesap · ${formatNumber(data.lifetime.records)} kayıt`}
              icon="infinite-outline"
              tone="warning"
            />
          </StatGrid>

          <AdminSection
            title="Günlük tekil görüntüleme"
            subtitle="Her gün yeni eklenen tekil görüntüleme kayıtları; aynı hesabın tekrar açılışları sayılmaz."
            action={
              <FilterChips
                options={[
                  { key: 'all', label: 'Tümü' },
                  { key: '30', label: '30 gün' },
                  { key: '7', label: '7 gün' },
                ]}
                value={range}
                onChange={setRange}
              />
            }
          >
            <TrendChart
              data={series.map((point) => ({ label: formatDay(point.date), value: point.views }))}
              formatValue={(value) => formatNumber(value)}
            />
            <AppText variant="caption" color="textTertiary">
              Günlük toplamlar, içerik türlerinin tamamındaki yeni tekil kayıtların toplamıdır.
            </AppText>
          </AdminSection>

          <AdminSection
            title="İçerik türüne göre dağılım"
            subtitle="Toplam tekil görüntülemeler içerik türleri arasında paylaştırılmıştır (yaşam boyu)."
          >
            <Distribution data={byType} totalLabel="tekil" />
            <View style={styles.typeStats}>
              {data.by_type.map((item) => (
                <View
                  key={item.content_type}
                  style={[
                    styles.typeRow,
                    {
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                    },
                  ]}
                >
                  <AppText variant="caption" color="textSecondary" style={styles.flex}>
                    {item.label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatNumber(item.contents)} içerik
                  </AppText>
                  <AppText variant="bodyStrong">{formatViewCount(item.views)}</AppText>
                </View>
              ))}
            </View>
          </AdminSection>

          <AdminSection
            title="En çok görüntülenen içerikler"
            subtitle="Tekil görüntüleme sıralaması; eski doğrulanmamış toplamlar ayrı etiketlenir."
          >
            <AdminToolbar>
              <FilterChips
                options={(Object.keys(RANK_LABELS) as RankKey[]).map((key) => ({
                  key,
                  label: RANK_LABELS[key],
                }))}
                value={rank}
                onChange={setRank}
              />
            </AdminToolbar>
            <RankList items={topItems} />
          </AdminSection>

          <AdminSection
            title="Platform toplamı nasıl okunur?"
            subtitle="İki metrik birbirinden farklıdır ve karıştırılmamalıdır."
          >
            <View style={styles.note}>
              <Ionicons name="layers-outline" size={17} color={theme.colors.primaryDeep} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Ayrı içeriklerdeki toplam tekil görüntülemeler</AppText>
                <AppText variant="caption" color="textSecondary">
                  Her içerik için ayrı sayılır: aynı hesap 10 farklı gönderiyi açarsa 10 tekil
                  görüntüleme oluşur. Bu sayı içerik tüketim hacmini gösterir.
                </AppText>
              </View>
            </View>
            <View style={styles.note}>
              <Ionicons name="people-outline" size={17} color={theme.colors.accent} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Platforma erişen benzersiz hesap sayısı</AppText>
                <AppText variant="caption" color="textSecondary">
                  Aynı hesap kaç içerik açarsa açsın yalnızca bir kez sayılır. Günlük "benzersiz
                  hesap" değeri o gün en az bir tekil görüntüleme oluşturan hesapların sayısıdır.
                </AppText>
              </View>
            </View>
            <AppText variant="caption" color="textTertiary">
              Giriş yapmamış ziyaretçiler, arama motoru botları, yönetici önizlemeleri ve içerik
              sahibinin kendi görüntülemeleri hesap bazlı tekil sayaca eklenmez.
            </AppText>
          </AdminSection>

          <AdminSection
            title="Şüpheli görüntüleme aktivitesi"
            subtitle="Kısa sürede olağan dışı sayıda farklı içerik görüntüleyen hesaplar; otomatik ceza uygulanmaz, inceleme gerekir."
          >
            {data.suspicious.length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Şüpheli aktivite tespit edilmedi.
              </AppText>
            ) : (
              data.suspicious.map((item) => (
                <View key={item.user_id} style={styles.suspiciousRow}>
                  <Ionicons name="warning-outline" size={15} color={theme.colors.warning} />
                  <AppText variant="caption" color="textSecondary" style={styles.flex}>
                    {item.username ? `@${item.username}` : item.user_id.slice(0, 8)}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatNumber(item.views)} görüntüleme
                  </AppText>
                </View>
              ))
            )}
          </AdminSection>

          <AdminSection
            title="Sistem hata kayıtları"
            subtitle="Sunucu tarafı görüntüleme kaydı sırasında oluşan son hatalar."
          >
            {data.errors.length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Kayıtlı hata yok.
              </AppText>
            ) : (
              data.errors.map((error) => (
                <View
                  key={error.id}
                  style={[styles.errorRow, { borderTopColor: theme.colors.divider }]}
                >
                  <View style={styles.flex}>
                    <AppText variant="caption" color="textSecondary">
                      {error.error_code}
                      {error.content_type ? ` · ${error.content_type}` : ''}
                    </AppText>
                    {error.message ? (
                      <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                        {error.message}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textTertiary">
                    {formatDate(error.created_at)}
                  </AppText>
                </View>
              ))
            )}
          </AdminSection>

          <AdminSection
            title="Sayım eşikleri"
            subtitle="Görünürlük ve oynatma süreleri buradan yönetilir. Eşik değişikliği geçmiş kayıtları geriye dönük değiştirmez."
            action={
              <Badge
                label={draft?.enabled ? 'Sayım açık' : 'Sayım kapalı'}
                tone={draft?.enabled ? 'success' : 'warning'}
              />
            }
          >
            {draft ? (
              <>
                <View style={styles.fields}>
                  <TextField
                    label="Görünür alan oranı (0-1)"
                    value={String(draft.min_visible_ratio)}
                    keyboardType="decimal-pad"
                    onChangeText={(value) => setField('min_visible_ratio', value)}
                  />
                  <TextField
                    label="Akış görünürlük süresi (ms)"
                    value={String(draft.min_visible_ms)}
                    keyboardType="number-pad"
                    onChangeText={(value) => setField('min_visible_ms', value)}
                  />
                  <TextField
                    label="Reels / video oynatma (ms)"
                    value={String(draft.video_min_play_ms)}
                    keyboardType="number-pad"
                    onChangeText={(value) => setField('video_min_play_ms', value)}
                  />
                  <TextField
                    label="İstemci toplu gönderim aralığı (ms)"
                    value={String(draft.batch_window_ms)}
                    keyboardType="number-pad"
                    onChangeText={(value) => setField('batch_window_ms', value)}
                  />
                  <TextField
                    label="Dakikada istek sınırı"
                    value={String(draft.rate_limit_per_minute)}
                    keyboardType="number-pad"
                    onChangeText={(value) => setField('rate_limit_per_minute', value)}
                  />
                  <TextField
                    label="Günlük hesap kaydı saklama (gün)"
                    value={String(draft.daily_active_retention_days)}
                    keyboardType="number-pad"
                    onChangeText={(value) => setField('daily_active_retention_days', value)}
                  />
                </View>
                <AdminToolbar>
                  <Button
                    label={draft.enabled ? 'Sayımı geçici kapat' : 'Sayımı etkinleştir'}
                    size="sm"
                    variant={draft.enabled ? 'outline' : 'secondary'}
                    fullWidth={false}
                    onPress={() =>
                      setDraft((current) =>
                        current ? { ...current, enabled: !current.enabled } : current,
                      )
                    }
                  />
                  <Button
                    label="Eşikleri kaydet"
                    size="sm"
                    fullWidth={false}
                    loading={updateSettings.isPending}
                    disabled={!canManage}
                    onPress={() => void save()}
                  />
                  {!canManage ? <Badge label="settings.manage gerekir" tone="warning" /> : null}
                </AdminToolbar>
                <AppText variant="caption" color="textTertiary">
                  Ayar güncellemesi yalnızca settings.manage yetkisiyle ve denetim kaydıyla
                  yapılır. Hiçbir yönetici işlemi geçmiş tekil görüntüleme kayıtlarını elle
                  şişiremez; sayaçlar yalnızca yeni ve doğrulanmış tekil görüntülemede artar.
                </AppText>
              </>
            ) : (
              <AppText variant="caption" color="textTertiary">
                Eşikler yükleniyor…
              </AppText>
            )}
          </AdminSection>
        </>
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 40, alignItems: 'center' },
  flex: { flex: 1 },
  rankList: { gap: 0 },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
  },
  rankIndex: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  rankValue: { alignItems: 'flex-end', gap: 1 },
  rankViews: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  typeStats: { gap: 6 },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  suspiciousRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
