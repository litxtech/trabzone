import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAccommodationReport,
  useCommissionSummary,
  useFinanceSummary,
  usePayCommission,
} from '../hooks/use-accommodation';
import type { FinanceSummary } from '../types';
import { exportReportExcel, exportReportPdf } from '../utils/pdf-excel-export';
import {
  SOURCE_LABELS,
  addDaysIso,
  endOfMonth,
  formatDate,
  formatDateShort,
  formatMoneyCents,
  formatPercent,
  isoToDate,
  monthLabel,
  parseMoneyToCents,
  reservationTone,
  startOfMonth,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  EmptyState,
  InlineError,
  InfoBanner,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  MoneyText,
  StatTile,
  StatusPill,
} from './AccommodationUI';

type ExportState = { kind: 'pdf' | 'excel' | null; error: string | null };

export function FinanceReportCenter({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>({ kind: null, error: null });

  const from = startOfMonth(`${month}-01`);
  const to = endOfMonth(`${month}-01`);
  const commissionTo = addDaysIso(to, -1);

  const finance = useFinanceSummary(propertyId, month);
  const commission = useCommissionSummary(propertyId, from, commissionTo);
  const report = useAccommodationReport(propertyId, from, addDaysIso(to, -1));
  const pay = usePayCommission(propertyId);

  const summary: FinanceSummary | undefined = finance.data;
  const maxDaily = Math.max(
    1,
    ...(summary?.daily ?? []).map((day) => Math.max(day.revenue_cents, day.collected_cents)),
  );

  const shiftMonth = (direction: number) => {
    const date = isoToDate(`${month}-01`);
    const next = new Date(date.getFullYear(), date.getMonth() + direction, 1);
    setMonth(`${next.getFullYear()}-${`${next.getMonth() + 1}`.padStart(2, '0')}`);
  };

  const exportReport = async (kind: 'pdf' | 'excel') => {
    setExportState({ kind, error: null });
    try {
      let data = report.data;
      if (!data) {
        const result = await report.refetch();
        data = result.data;
      }
      if (!data) {
        setExportState({ kind: null, error: 'Rapor verisi yüklenemedi.' });
        return;
      }
      const result = kind === 'pdf' ? await exportReportPdf(data) : await exportReportExcel(data);
      if (!result.ok) {
        setExportState({ kind: null, error: result.error.message });
      } else {
        setExportState({ kind: null, error: null });
      }
    } finally {
      setExportState((current) => ({ ...current, kind: null }));
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Finans ve komisyon</AppText>
          <AppText variant="caption" color="textTertiary">
            Tahakkuk, tahsilat ve %10 Trabzone komisyonu ayrı izlenir
          </AppText>
        </View>
        <View style={styles.monthNav}>
          <Pressable accessibilityRole="button" accessibilityLabel="Önceki ay" onPress={() => shiftMonth(-1)} style={[styles.navButton, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="chevron-back" size={17} color={theme.colors.text} />
          </Pressable>
          <View style={styles.monthLabel}>
            <AppText variant="bodyStrong">{monthLabel(`${month}-01`)}</AppText>
            <AppText variant="caption" color="textTertiary">
              {formatDate(from)} – {formatDate(commissionTo)}
            </AppText>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Sonraki ay" onPress={() => shiftMonth(1)} style={[styles.navButton, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="chevron-forward" size={17} color={theme.colors.text} />
          </Pressable>
        </View>
      </View>

      <View style={styles.exportRow}>
        <Button
          label="PDF raporu"
          size="sm"
          fullWidth={false}
          variant="outline"
          loading={exportState.kind === 'pdf'}
          leftIcon={<Ionicons name="document-text-outline" size={15} color={theme.colors.text} />}
          onPress={() => void exportReport('pdf')}
        />
        <Button
          label="Excel raporu"
          size="sm"
          fullWidth={false}
          variant="outline"
          loading={exportState.kind === 'excel'}
          leftIcon={<Ionicons name="grid-outline" size={15} color={theme.colors.text} />}
          onPress={() => void exportReport('excel')}
        />
        <Button label="Komisyon öde" size="sm" fullWidth={false} onPress={() => setPayOpen(true)} />
      </View>

      {exportState.error ? <InlineError message={exportState.error} /> : null}

      {finance.isLoading ? (
        <LoadingBlock height={160} />
      ) : finance.isError || !summary ? (
        <InlineError
          message={finance.error instanceof Error ? finance.error.message : 'Finans özeti yüklenemedi.'}
          onRetry={() => void finance.refetch()}
        />
      ) : (
        <>
          <View style={styles.statsGrid}>
            <View style={styles.statTile}><StatTile label="Konaklama geliri" value={formatMoneyCents(summary.revenue_cents)} icon="bed-outline" tone="primary" /></View>
            <View style={styles.statTile}><StatTile label="Diğer gelir" value={formatMoneyCents(summary.other_income_cents)} icon="add-circle-outline" /></View>
            <View style={styles.statTile}><StatTile label="İndirim toplamı" value={formatMoneyCents(summary.discount_cents)} icon="pricetags-outline" /></View>
            <View style={styles.statTile}><StatTile label="Tahsil edilen" value={formatMoneyCents(summary.collected_cents)} icon="download-outline" tone="success" /></View>
            <View style={styles.statTile}><StatTile label="İade edilen" value={formatMoneyCents(summary.refunded_cents)} icon="return-down-back-outline" tone="danger" /></View>
            <View style={styles.statTile}><StatTile label="Giderler" value={formatMoneyCents(summary.expenses_cents)} icon="arrow-up-outline" tone="warning" /></View>
            <View style={styles.statTile}><StatTile label="Açık bakiye" value={formatMoneyCents(summary.open_balance_cents)} icon="alert-circle-outline" tone="warning" /></View>
            <View style={styles.statTile}><StatTile label="Tahakkuk eden komisyon" value={formatMoneyCents(summary.commission_accrued_cents)} icon="calculator-outline" /></View>
          </View>

          <AccCard padding={13} style={styles.chartCard}>
            <View style={styles.chartHead}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Günlük gelir ve tahsilat</AppText>
                <AppText variant="caption" color="textTertiary">
                  Mavi: konaklama geliri · Yeşil: tahsilat
                </AppText>
              </View>
              <View style={styles.chartLegend}>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} />
                <AppText variant="caption" color="textTertiary">Gelir</AppText>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.success }]} />
                <AppText variant="caption" color="textTertiary">Tahsilat</AppText>
              </View>
            </View>
            {summary.daily.length === 0 ? (
              <EmptyState icon="bar-chart-outline" title="Veri yok" message="Bu ay için finansal hareket bulunmuyor." compact />
            ) : (
              <View style={styles.chart}>
                {summary.daily.map((day) => (
                  <View key={day.date} style={styles.chartColumn}>
                    <View style={styles.bars}>
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${Math.max(2, (day.revenue_cents / maxDaily) * 100)}%`,
                            backgroundColor: theme.colors.primary,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.bar,
                          {
                            height: `${Math.max(2, (day.collected_cents / maxDaily) * 100)}%`,
                            backgroundColor: theme.colors.success,
                          },
                        ]}
                      />
                    </View>
                    <AppText variant="caption" color="textTertiary" style={styles.chartDay}>
                      {day.date.slice(8, 10)}
                    </AppText>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.chartFooter}>
              <AppText variant="caption" color="textTertiary">
                Ay toplamı: {formatMoneyCents(summary.revenue_cents)} gelir · {formatMoneyCents(summary.collected_cents)} tahsilat
              </AppText>
            </View>
          </AccCard>

          <View style={styles.twoCols}>
            <AccCard padding={13} style={styles.flex}>
              <AppText variant="bodyStrong" style={styles.cardTitle}>Kaynağa göre dağılım</AppText>
              {summary.by_source.length === 0 ? (
                <AppText variant="caption" color="textTertiary">Kayıt yok.</AppText>
              ) : (
                summary.by_source.map((source) => (
                  <View key={source.source} style={styles.sourceRow}>
                    <View style={styles.flex}>
                      <AppText variant="caption" color="textSecondary">
                        {SOURCE_LABELS[source.source]}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                        {source.reservations} rezervasyon · komisyon {formatMoneyCents(source.commission_cents)}
                      </AppText>
                    </View>
                    <AppText variant="caption" color="text">
                      {formatMoneyCents(source.total_cents)}
                    </AppText>
                  </View>
                ))
              )}
            </AccCard>
            <AccCard padding={13} style={styles.flex}>
              <AppText variant="bodyStrong" style={styles.cardTitle}>Tahsilat kategorileri</AppText>
              {summary.payments_by_category.length === 0 ? (
                <AppText variant="caption" color="textTertiary">Kayıt yok.</AppText>
              ) : (
                summary.payments_by_category.map((category) => (
                  <View key={category.category} style={styles.sourceRow}>
                    <AppText variant="caption" color="textSecondary" style={styles.flex}>
                      {category.category}
                    </AppText>
                    <AppText variant="caption" color="text">
                      {formatMoneyCents(category.total_cents)}
                    </AppText>
                  </View>
                ))
              )}
            </AccCard>
          </View>

          <AccCard padding={13} style={{ gap: 5 }}>
            <AppText variant="bodyStrong" style={styles.cardTitle}>Komisyon mutabakatı</AppText>
            {commission.isLoading ? (
              <LoadingBlock height={80} />
            ) : commission.data ? (
              <>
                <KeyValueRow label="Tahmini (bekleyen konaklamalar)" value={formatMoneyCents(commission.data.estimated_cents)} />
                <KeyValueRow label="Kesinleşen" value={formatMoneyCents(commission.data.finalized_cents)} />
                <KeyValueRow label="Ödenen" value={formatMoneyCents(commission.data.paid_cents)} />
                <KeyValueRow label="Ödenmemiş bakiye" value={<MoneyText cents={commission.data.due_cents} variant="bodyStrong" color={theme.colors.danger} />} />
                {commission.data.reservations.length > 0 ? (
                  <View style={styles.table}>
                    {commission.data.reservations.slice(0, 12).map((row) => (
                      <View key={row.reservation_id} style={[styles.tableRow, { borderBottomColor: theme.colors.divider }]}>
                        <View style={styles.flex}>
                          <View style={styles.codeRow}>
                            <AppText variant="caption" color="text" numberOfLines={1}>
                              {row.code}
                            </AppText>
                            <StatusPill
                              label={reservationTone(row.status).label}
                              color={reservationTone(row.status).color}
                              background={reservationTone(row.status).background}
                            />
                          </View>
                          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                            {row.guest_name} · {formatDateShort(row.check_in)} → {formatDateShort(row.check_out)}
                          </AppText>
                        </View>
                        <AppText variant="caption" color="textTertiary">
                          {formatPercent(row.commission_rate, 1)}
                        </AppText>
                        <AppText variant="caption" color="text">
                          {formatMoneyCents(row.commission_cents)}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ) : (
                  <AppText variant="caption" color="textTertiary">
                    Bu dönemde komisyona tabi rezervasyon yok.
                  </AppText>
                )}
              </>
            ) : null}
          </AccCard>
        </>
      )}

      {error ? <InlineError message={error} /> : null}

      <ModalSheet
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        title="Komisyon ödemesi kaydet"
        subtitle={monthLabel(`${month}-01`)}
        maxWidth={520}
        footer={
          <Button
            label="Ödemeyi kaydet"
            loading={pay.isPending}
            onPress={async () => {
              setError(null);
              const amount = parseMoneyToCents(payAmount);
              if (!amount || amount <= 0) {
                setError('Geçerli bir tutar gir.');
                return;
              }
              try {
                await pay.mutateAsync({ amountCents: amount, occurredOn: todayIso(), note: payNote.trim() || null });
                setPayOpen(false);
                setPayAmount('');
                setPayNote('');
                void commission.refetch();
                void finance.refetch();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Komisyon ödemesi kaydedilemedi.');
              }
            }}
          />
        }
      >
        <View style={{ gap: 10 }}>
          <InfoBanner text="Komisyon ödemesi kasa hesabına gider olarak yansımaz; ayrı komisyon defterine işlenir. Ödenen komisyon finans ekranında ayrı gösterilir." />
          <TextField
            label="Ödeme tutarı (₺)"
            value={payAmount}
            onChangeText={(next) => setPayAmount(next.replace(/[^\d.,]/g, ''))}
            keyboardType="decimal-pad"
            placeholder={commission.data ? String(commission.data.due_cents / 100) : '0'}
          />
          <TextField label="Not" value={payNote} onChangeText={setPayNote} placeholder="Dekont / mutabakat notu" />
        </View>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navButton: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { minWidth: 150, alignItems: 'center' },
  exportRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { width: '23.4%', minWidth: 150, flexGrow: 1 },
  chartCard: { gap: 8 },
  chartHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chartLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 120, paddingTop: 12 },
  chartColumn: { flex: 1, alignItems: 'center', gap: 2, height: '100%', justifyContent: 'flex-end' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: '100%', width: '100%', justifyContent: 'center' },
  bar: { width: '38%', borderRadius: 2, minHeight: 2 },
  chartDay: { fontSize: 7 },
  chartFooter: { alignItems: 'flex-end' },
  twoCols: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  cardTitle: { paddingBottom: 4 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  tiny: { fontSize: 8 },
  table: { gap: 0 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
