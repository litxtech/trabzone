import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { TrendChart } from '@/features/admin/components/Charts';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  DATE_PRESETS,
  dateRangeFor,
  defaultCustomRange,
  type DatePresetKey,
} from '@/features/admin/date-range';
import {
  useAdminMe,
  useCommissionSet,
  useCommissionSettings,
  useFinanceOverview,
  useFinanceTransactions,
} from '@/features/admin/hooks/use-admin';
import type { FinanceTransaction } from '@/features/admin/types';
import { useAdminCategories } from '@/features/marketplace/hooks/use-market-admin';
import { formatPrice } from '@/features/marketplace/services/marketplace-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

const number = (value: number) => new Intl.NumberFormat('tr-TR').format(value);
const PAGE_SIZE = 25;

const STATUS_LABELS: Record<string, string> = {
  paid: 'Ödendi',
  pending: 'Bekliyor',
  failed: 'Başarısız',
  refunded: 'İade',
  not_collected: 'Tahsil edilmedi',
  canceled: 'İptal',
};

export default function AdminFinanceScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const initial = defaultCustomRange();
  const [preset, setPreset] = useState<DatePresetKey>('30');
  const [customFrom, setCustomFrom] = useState(initial.from);
  const [customTo, setCustomTo] = useState(initial.to);
  const [kind, setKind] = useState<'all' | 'premium' | 'marketplace'>('all');
  const [status, setStatus] = useState<'all' | 'paid' | 'pending' | 'failed' | 'refunded'>('all');
  const [offset, setOffset] = useState(0);

  const range = dateRangeFor(preset, customFrom, customTo);
  const overview = useFinanceOverview(range.from, range.to);
  const transactions = useFinanceTransactions({
    kind,
    status: status === 'all' ? undefined : status,
    from: range.from,
    to: range.to,
    limit: PAGE_SIZE,
    offset,
  });

  const stats = overview.data?.stats;

  const columns: Column<FinanceTransaction>[] = [
    {
      key: 'reference',
      label: 'İşlem',
      width: 1.2,
      render: (row) => (
        <View style={{ gap: 1 }}>
          <AppText variant="caption" style={{ fontWeight: '700' }}>
            {row.reference}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {row.kind === 'premium' ? 'Premium' : 'Marketplace'} · {row.provider}
          </AppText>
        </View>
      ),
    },
    {
      key: 'user',
      label: 'Kullanıcı',
      width: 1.2,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" numberOfLines={1}>
          {row.user_name ?? '—'}
        </AppText>
      ),
    },
    {
      key: 'amount',
      label: 'Tutar',
      width: 0.8,
      align: 'right',
      render: (row) => (
        <AppText variant="caption" style={{ fontWeight: '700' }}>
          {formatPrice(row.amount_cents, row.currency)}
        </AppText>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 0.8,
      render: (row) => (
        <Badge
          label={STATUS_LABELS[row.status] ?? row.status}
          tone={
            row.status === 'paid'
              ? 'success'
              : row.status === 'failed'
                ? 'danger'
                : row.status === 'refunded'
                  ? 'warning'
                  : 'neutral'
          }
        />
      ),
    },
    {
      key: 'date',
      label: 'Tarih',
      width: 1,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textTertiary">
          {formatDateTimeTr(row.created_at)}
        </AppText>
      ),
    },
  ];

  return (
    <AdminPage
      title="Gelir ve Finans"
      subtitle="Doğrulanmış ödeme hacmi, komisyonlar, iadeler ve marketplace mutabakatı."
      refreshing={overview.isRefetching || transactions.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void transactions.refetch();
      }}
      actions={<Badge label="Salt okunur işlem kayıtları" tone="neutral" />}
    >
      <FilterChips
        options={DATE_PRESETS.map((item) => ({ key: item.key, label: item.label }))}
        value={preset}
        onChange={setPreset}
      />
      {preset === 'custom' ? (
        <View style={styles.dateRow}>
          <DateInput label="Başlangıç" value={customFrom} onChange={setCustomFrom} />
          <DateInput label="Bitiş" value={customTo} onChange={setCustomTo} />
        </View>
      ) : null}

      <StatGrid>
        <StatCard label="Brüt gelir" value={formatPrice(stats?.gross_cents ?? 0)} icon="trending-up-outline" hint="Premium + marketplace" />
        <StatCard label="Platform komisyonu" value={formatPrice(stats?.commission_cents ?? 0)} icon="pricetag-outline" tone="accent" hint={`${number(stats?.paid_transactions ?? 0)} ödenmiş işlem`} />
        <StatCard label="Net gelir" value={formatPrice(stats?.net_cents ?? 0)} icon="wallet-outline" tone="success" hint="İadeler düşülmüş" />
        <StatCard label="İade" value={formatPrice(stats?.refunded_cents ?? 0)} icon="return-down-back-outline" tone="warning" hint="Onaylanmış iadeler" />
        <StatCard label="Bekleyen ödeme" value={number(stats?.pending_payments ?? 0)} icon="hourglass-outline" tone="warning" hint="Tahsilat bekleyen" />
        <StatCard label="Başarısız ödeme" value={number(stats?.failed_payments ?? 0)} icon="close-circle-outline" tone={stats?.failed_payments ? 'danger' : 'success'} hint="Sağlayıcı reddi" />
        <StatCard label="Aktif abonelik" value={number(stats?.active_subscriptions ?? 0)} icon="star-outline" tone="accent" hint={`${number(stats?.canceled_subscriptions ?? 0)} iptal`} />
        <StatCard label="ARPU" value={formatPrice(stats?.arpu_cents ?? 0)} icon="analytics-outline" hint="Kullanıcı başına gelir" />
      </StatGrid>

      <AdminSection title="Gelir trendi" subtitle="Günlük brüt gelir ve platform komisyonu">
        <View style={styles.chartGrid}>
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary">
              Brüt gelir
            </AppText>
            <TrendChart
              data={(overview.data?.series ?? []).map((point) => ({
                label: point.date.slice(5).replace('-', '.'),
                value: point.premium_cents + point.marketplace_cents,
              }))}
              color={theme.colors.primary}
              formatValue={(value) => formatPrice(Math.round(value))}
            />
          </View>
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary">
              Komisyon
            </AppText>
            <TrendChart
              data={(overview.data?.series ?? []).map((point) => ({
                label: point.date.slice(5).replace('-', '.'),
                value: point.commission_cents,
              }))}
              color={theme.colors.accent}
              formatValue={(value) => formatPrice(Math.round(value))}
            />
          </View>
        </View>
      </AdminSection>

      <AdminSection title="İşlem kayıtları" subtitle="Premium ödemeleri ve marketplace siparişleri">
        <View style={styles.filterRow}>
          <FilterChips
            options={[
              { key: 'all' as const, label: 'Tümü' },
              { key: 'premium' as const, label: 'Premium' },
              { key: 'marketplace' as const, label: 'Marketplace' },
            ]}
            value={kind}
            onChange={(value) => {
              setKind(value);
              setOffset(0);
            }}
          />
          <FilterChips
            options={[
              { key: 'all' as const, label: 'Her durum' },
              { key: 'paid' as const, label: 'Ödenen' },
              { key: 'pending' as const, label: 'Bekleyen' },
              { key: 'failed' as const, label: 'Başarısız' },
              { key: 'refunded' as const, label: 'İade' },
            ]}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setOffset(0);
            }}
          />
        </View>

        <DataTable
          columns={columns}
          rows={transactions.data?.items ?? []}
          keyExtractor={(row) => `${row.kind}-${row.id}`}
          loading={transactions.isLoading}
          empty={
            <View style={[styles.empty, { borderColor: theme.colors.border }]}>
              <Ionicons name="receipt-outline" size={22} color={theme.colors.textTertiary} />
              <AppText variant="body" color="textSecondary">
                Bu dönemde işlem bulunamadı.
              </AppText>
            </View>
          }
        />
        {transactions.data ? (
          <Pager
            total={transactions.data.total}
            limit={transactions.data.limit}
            offset={transactions.data.offset}
            onChange={setOffset}
          />
        ) : null}
      </AdminSection>

      <CommissionPanel onDone={(message) => toast.success(message)} />

      <View style={[styles.noteCard, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
        <Ionicons name="shield-checkmark-outline" size={17} color={theme.colors.success} />
        <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
          Komisyon oranı değişiklikleri yalnızca yeni siparişlere uygulanır; geçmiş siparişlerin
          finansal kayıtları geriye dönük değiştirilmez. Ödeme durumu panelden yapay olarak
          “başarılı” işaretlenemez.
        </AppText>
      </View>
    </AdminPage>
  );
}

function CommissionPanel({ onDone }: { onDone: (message: string) => void }) {
  const { theme } = useTheme();
  const me = useAdminMe();
  const canManage = (me.data?.permissions ?? []).includes('finance.action');
  const settings = useCommissionSettings();
  const categories = useAdminCategories();
  const setCommission = useCommissionSet();
  const toast = useAdminToast();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const parsed = Number(rate.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 50) {
      setError('Oran 0 ile 50 arasında olmalı.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Gerekçe en az 3 karakter olmalı.');
      return;
    }
    try {
      await setCommission.mutateAsync({
        rateBps: Math.round(parsed * 100),
        categoryId,
        reason: reason.trim(),
      });
      setReason('');
      setRate('');
      setError(null);
      onDone('Komisyon oranı yeni işlemler için güncellendi.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Komisyon güncellenemedi.');
    }
  };

  return (
    <AdminSection
      title="Komisyon yönetimi"
      subtitle="Genel veya kategori bazlı oran. Değişiklikler yalnızca ileriye dönük uygulanır."
      action={<Badge label={`Mevcut: %${((settings.data?.current_global_bps ?? 0) / 100).toFixed(2)}`} tone="accent" />}
    >
      {canManage ? (
        <View style={{ gap: 10 }}>
          <View style={styles.categoryRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setCategoryId(null)}
              style={[
                styles.categoryChip,
                {
                  borderColor: categoryId === null ? theme.colors.primary : theme.colors.border,
                  backgroundColor: categoryId === null ? theme.colors.primarySoft : 'transparent',
                },
              ]}
            >
              <AppText variant="caption" color={categoryId === null ? 'primaryDeep' : 'textSecondary'}>
                Genel oran
              </AppText>
            </Pressable>
            {(categories.data ?? []).slice(0, 18).map((category: { id: string; name: string }) => (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                onPress={() => setCategoryId(category.id)}
                style={[
                  styles.categoryChip,
                  {
                    borderColor: categoryId === category.id ? theme.colors.primary : theme.colors.border,
                    backgroundColor: categoryId === category.id ? theme.colors.primarySoft : 'transparent',
                  },
                ]}
              >
                <AppText variant="caption" color={categoryId === category.id ? 'primaryDeep' : 'textSecondary'}>
                  {category.name}
                </AppText>
              </Pressable>
            ))}
          </View>
          <View style={styles.formRow}>
            <View style={{ width: 140 }}>
              <TextField
                label="Oran (%)"
                placeholder="8.5"
                value={rate}
                onChangeText={setRate}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1, minWidth: 240 }}>
              <TextField
                label="Gerekçe"
                placeholder="Sözleşme veya kategori kararı gerekçesi"
                value={reason}
                onChangeText={setReason}
                maxLength={400}
                hint="Denetim kaydına yazılır; kişisel veri girmeyin."
              />
            </View>
            <Button
              label="Oranı uygula"
              size="sm"
              fullWidth={false}
              loading={setCommission.isPending}
              onPress={() => void submit()}
              style={{ minWidth: 130, marginTop: 18 }}
            />
          </View>
          {error ? (
            <AppText variant="caption" color="danger">
              {error}
            </AppText>
          ) : null}
        </View>
      ) : (
        <AppText variant="caption" color="textTertiary">
          Oran değiştirmek için `finance.action` yetkisi gerekir. Geçmiş değişiklikler aşağıda listelenir.
        </AppText>
      )}

      <View style={{ gap: 4 }}>
        {(settings.data?.items ?? []).slice(0, 12).map((item) => (
          <View key={item.id} style={[styles.rateRow, { borderColor: theme.colors.divider }]}>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" style={{ fontWeight: '600' }}>
                {item.category_name ?? 'Genel oran'} · %{(item.rate_bps / 100).toFixed(2)}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {formatDateTimeTr(item.effective_from)} · {item.created_by_name ?? 'Sistem'} · {item.note ?? '—'}
              </AppText>
            </View>
            <Badge label={`%${(item.rate_bps / 100).toFixed(2)}`} tone="neutral" />
          </View>
        ))}
      </View>
    </AdminSection>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 3 }}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.colors.textTertiary}
        style={[
          styles.dateInput,
          {
            backgroundColor: theme.colors.inputBackground,
            borderColor: theme.colors.border,
            color: theme.colors.text,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 280 },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  dateInput: {
    height: 35,
    minWidth: 132,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    fontSize: 12,
    outlineStyle: 'none',
  } as never,
  chartGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  filterRow: { gap: 7 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 36, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  categoryChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
});
