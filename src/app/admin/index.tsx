import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { useAdminOverview, useShellCounts } from '@/features/admin/hooks/use-admin';
import { AdminPage, AdminSection } from '@/features/admin/components/AdminPage';
import { BarChart, Distribution, HorizontalBars, TrendChart } from '@/features/admin/components/Charts';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import {
  DATE_PRESETS,
  dateRangeFor,
  defaultCustomRange,
  type DatePresetKey,
} from '@/features/admin/date-range';
import { formatPrice } from '@/features/marketplace/services/marketplace-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

type PresetKey = DatePresetKey;

const number = (value: number) =>
  new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(value);

const compact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value / 1_000_000)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value / 1_000)}K`;
  }
  return number(value);
};

export default function AdminOverviewScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const [preset, setPreset] = useState<PresetKey>('30');
  const [initialRange] = useState(defaultCustomRange);
  const [customFrom, setCustomFrom] = useState(initialRange.from);
  const [customTo, setCustomTo] = useState(initialRange.to);

  const range = useMemo(() => dateRangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const validRange = Boolean(range.from && range.to && range.from <= range.to);
  const overview = useAdminOverview(range.from, range.to);
  const counts = useShellCounts();

  const data = overview.data;
  const stats = data?.stats;

  const growth = useMemo(
    () => (data?.growth ?? []).map((point) => ({ label: point.date.slice(5).replace('-', '.'), value: point.new_users })),
    [data],
  );
  const active = useMemo(
    () => (data?.growth ?? []).map((point) => ({ label: point.date.slice(5).replace('-', '.'), value: point.active_users })),
    [data],
  );
  const posts = useMemo(
    () => (data?.growth ?? []).map((point) => ({ label: point.date.slice(5).replace('-', '.'), value: point.posts })),
    [data],
  );
  const views = useMemo(
    () => (data?.growth ?? []).map((point) => ({ label: point.date.slice(5).replace('-', '.'), value: point.reel_views })),
    [data],
  );
  const orders = useMemo(
    () => (data?.growth ?? []).map((point) => ({ label: point.date.slice(5).replace('-', '.'), value: point.orders })),
    [data],
  );
  const revenue = useMemo(
    () => (data?.growth ?? []).map((point) => ({ label: point.date.slice(5).replace('-', '.'), value: point.revenue_cents / 100 })),
    [data],
  );

  return (
    <AdminPage
      title="Canlı Kontrol Merkezi"
      subtitle="Platform büyümesi, içerik hacmi, ticaret ve operasyon sağlığı tek bakışta."
      refreshing={overview.isRefetching || counts.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void counts.refetch();
      }}
      actions={
        <>
          <View
            style={[
              styles.liveBadge,
              { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.success },
            ]}
          >
            <View style={[styles.liveDot, { backgroundColor: theme.colors.success }]} />
            <AppText variant="caption" color="success" style={{ fontWeight: '700' }}>
              Gerçek zamanlı
            </AppText>
          </View>
          <Button
            label="Raporlar"
            size="sm"
            variant="secondary"
            fullWidth={false}
            leftIcon={<Ionicons name="download-outline" size={14} color={theme.colors.text} />}
            onPress={() => router.push('/admin/analytics' as never)}
          />
        </>
      }
    >
      <View style={styles.filterRow}>
        <View style={styles.chips}>
          {DATE_PRESETS.map((item) => {
            const selected = item.key === preset;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setPreset(item.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={selected ? 'onPrimary' : 'textSecondary'}
                  style={{ fontWeight: selected ? '700' : '500' }}
                >
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="caption" color="textTertiary">
          {formatDateTr(range.from)} → {formatDateTr(range.to)}
        </AppText>
      </View>

      {preset === 'custom' ? (
        <View style={styles.customRow}>
          <DateInput label="Başlangıç" value={customFrom} onChange={setCustomFrom} />
          <DateInput label="Bitiş" value={customTo} onChange={setCustomTo} />
          {!validRange ? (
            <AppText variant="caption" color="danger">
              Başlangıç tarihi bitişten sonra olamaz.
            </AppText>
          ) : null}
        </View>
      ) : null}

      {overview.isError ? (
        <View style={[styles.errorCard, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" color="danger">
              Özet verisi yüklenemedi
            </AppText>
            <AppText variant="caption" color="textSecondary">
              Sunucu işlemi başarısız oldu. Yetkinizi ve bağlantıyı kontrol edip yeniden deneyin.
            </AppText>
          </View>
          <Button label="Yenile" size="sm" variant="outline" fullWidth={false} onPress={() => void overview.refetch()} />
        </View>
      ) : null}

      {overview.isLoading || !stats ? (
        <>
          <View style={styles.skeletonGrid}>
            {Array.from({ length: 8 }).map((_, index) => (
              <View
                key={index}
                style={[
                  styles.skeletonCard,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <Skeleton width={30} height={30} radius={9} />
                <Skeleton width="55%" height={22} />
                <Skeleton width="80%" height={10} />
              </View>
            ))}
          </View>
          <View style={styles.chartGrid}>
            {[0, 1].map((index) => (
              <View
                key={index}
                style={[
                  styles.chartCard,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <Skeleton width="35%" height={13} />
                <Skeleton width="100%" height={170} radius={10} />
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Toplam kullanıcı"
              value={number(stats.users_total)}
              icon="people-outline"
              hint={`${number(stats.users_new)} dönem kaydı`}
              delta={data?.deltas.users_new}
            />
            <StatCard
              label="Bugün kayıt"
              value={number(stats.users_today)}
              icon="person-add-outline"
              tone={stats.users_today > 0 ? 'success' : 'primary'}
              hint="Bugün oluşturulan hesaplar"
            />
            <StatCard
              label="Günlük aktif"
              value={number(stats.dau)}
              icon="pulse-outline"
              hint="Son 24 saatte aktif"
              tone="accent"
            />
            <StatCard
              label="Haftalık aktif"
              value={number(stats.wau)}
              icon="calendar-outline"
              hint={`Aylık ${compact(stats.mau)} kullanıcı`}
            />
            <StatCard
              label="Aylık aktif"
              value={number(stats.mau)}
              icon="calendar-number-outline"
              hint="Son 30 gün tekil kullanıcı"
            />
            <StatCard
              label="Tahmini çevrimiçi"
              value={number(stats.online_estimate)}
              icon="radio-outline"
              hint="Son 5 dakikada aktif oturumlar"
              tone="success"
            />
            <StatCard
              label="Toplam gönderi"
              value={number(stats.posts_total)}
              icon="newspaper-outline"
              hint={`${number(stats.posts_today)} bugün · ${number(stats.posts_period)} dönem`}
              delta={data?.deltas.posts}
            />
            <StatCard
              label="Toplam Reels"
              value={number(stats.reels_total)}
              icon="videocam-outline"
              hint={`${compact(stats.reels_views_today)} izlenme bugün`}
              tone="accent"
            />
            <StatCard
              label="Aktif ilan"
              value={number(stats.active_listings)}
              icon="storefront-outline"
              hint="Marketplace'te yayında"
            />
            <StatCard
              label="Marketplace siparişi"
              value={number(stats.orders_total)}
              icon="bag-handle-outline"
              hint={`${number(stats.orders_today)} bugün · ${number(stats.orders_period)} dönem`}
              delta={data?.deltas.orders}
            />
            <StatCard
              label="Tamamlanan işlem"
              value={number(stats.completed_orders)}
              icon="checkmark-done-outline"
              hint={`${number(stats.pending_orders)} işlem bekliyor`}
              tone="success"
            />
            <StatCard
              label="Bekleyen şikâyet"
              value={number(stats.pending_reports)}
              icon="flag-outline"
              hint={`${number(counts.data?.critical_reports ?? 0)} kritik öncelikli`}
              tone={stats.pending_reports > 0 ? 'danger' : 'success'}
            />
            <StatCard
              label="Açık destek talebi"
              value={number(stats.open_tickets)}
              icon="headset-outline"
              hint="SLA takibi destek merkezinde"
              tone={stats.open_tickets > 0 ? 'warning' : 'success'}
            />
            <StatCard
              label="Doğrulanmış ödeme hacmi"
              value={formatPrice(stats.verified_payment_volume_cents)}
              icon="shield-checkmark-outline"
              hint={`${number(stats.completed_orders)} tamamlanan işlem`}
              tone="success"
            />
            <StatCard
              label="Net gelir"
              value={formatPrice(stats.revenue_cents)}
              icon="wallet-outline"
              hint={`${formatPrice(stats.refunded_cents)} iade · ${number(stats.failed_payments)} başarısız`}
              delta={data?.deltas.revenue}
              tone="accent"
            />
          </StatGrid>

          <AdminSection
            title="Kullanıcı büyümesi"
            subtitle="Günlük yeni kayıtlar ve aktif kullanıcı hareketi"
            action={<Badge label={`${data?.growth.length ?? 0} gün`} tone="neutral" />}
          >
            <View style={styles.chartGrid}>
              <ChartBox title="Yeni kayıtlar" hint="Günlük kayıt">
                <TrendChart data={growth} color={theme.colors.primary} />
              </ChartBox>
              <ChartBox title="Günlük aktif kullanıcı" hint="Oturum açan tekil kullanıcı">
                <TrendChart data={active} color={theme.colors.accent} />
              </ChartBox>
            </View>
          </AdminSection>

          <AdminSection title="İçerik etkileşimi" subtitle="Gönderi üretimi ve Reels tüketimi">
            <View style={styles.chartGrid}>
              <ChartBox title="Gönderi etkileşimleri" hint="Günlük yeni gönderi">
                <BarChart data={posts} color={theme.colors.info} />
              </ChartBox>
              <ChartBox title="Reels izlenmeleri" hint="Günlük görüntüleme">
                <BarChart data={views} color={theme.colors.accent} />
              </ChartBox>
            </View>
          </AdminSection>

          <AdminSection title="Marketplace ve gelir" subtitle="Sipariş hacmi ve doğrulanmış gelir">
            <View style={styles.chartGrid}>
              <ChartBox title="Marketplace satışları" hint="Günlük sipariş adedi">
                <BarChart data={orders} color={theme.colors.success} />
              </ChartBox>
              <ChartBox title="Gelir" hint="Günlük net gelir (₺)">
                <TrendChart
                  data={revenue}
                  color={theme.colors.success}
                  formatValue={(value) => formatPrice(Math.round(value * 100))}
                />
              </ChartBox>
            </View>
          </AdminSection>

          <View style={styles.twoColumn}>
            <View style={styles.flex}>
              <AdminSection title="Ülke dağılımı" subtitle="Kullanıcıların ülkelere göre dağılımı">
                <Distribution data={data?.countries ?? []} totalLabel="kullanıcı" />
              </AdminSection>
            </View>
            <View style={styles.flex}>
              <AdminSection title="Şehir dağılımı" subtitle="En yoğun şehirler">
                <HorizontalBars data={(data?.cities ?? []).slice(0, 8).map((item) => ({ label: item.label, value: item.value }))} />
              </AdminSection>
            </View>
          </View>

          <View style={styles.twoColumn}>
            <View style={styles.flex}>
              <AdminSection title="Platform" subtitle="iOS / Android / Web dağılımı">
                <Distribution data={data?.platforms ?? []} totalLabel="oturum" />
              </AdminSection>
            </View>
            <View style={styles.flex}>
              <AdminSection title="Uygulama sürümleri" subtitle="Sürüm bazlı kullanım">
                <HorizontalBars data={(data?.app_versions ?? []).slice(0, 8).map((item) => ({ label: item.label, value: item.value }))} />
              </AdminSection>
            </View>
          </View>

          <View
            style={[
              styles.footNote,
              { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="information-circle-outline" size={17} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
              Tüm metrikler canlı veritabanından, rolünüze bağlı sunucu işlemleriyle hesaplanır.
              Çevrimiçi sayısı tahminidir; yalnızca son aktivite zaman damgalarına dayanır. Kişisel
              mesaj içerikleri bu ekranda gösterilmez.
            </AppText>
          </View>
        </>
      )}
    </AdminPage>
  );
}

function ChartBox({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.chartBox}>
      <View style={styles.chartHead}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      </View>
      {children}
    </View>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.dateInput}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.colors.textTertiary}
        style={[
          styles.dateText,
          {
            backgroundColor: theme.colors.inputBackground,
            borderColor: theme.colors.border,
            color: theme.colors.text,
          },
        ]}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 300 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    height: 32,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' },
  dateInput: { gap: 3 },
  dateText: {
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    fontSize: 13,
    minWidth: 136,
    outlineStyle: 'none',
  } as never,
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
  },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  skeletonCard: {
    flexGrow: 1,
    flexBasis: 190,
    minWidth: 170,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  chartGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  chartCard: {
    flexGrow: 1,
    flexBasis: 360,
    minWidth: 280,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  chartBox: { flex: 1, minWidth: 260, gap: 4 },
  chartHead: { gap: 1, marginBottom: 4 },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  footNote: {
    flexDirection: 'row',
    gap: 8,
    padding: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
});
