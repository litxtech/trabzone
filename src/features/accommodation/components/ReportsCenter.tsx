import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useAccommodationReport } from '../hooks/use-accommodation';
import type { ReportData } from '../types';
import {
  addDaysIso,
  formatDate,
  formatMoneyCents,
  startOfMonth,
  todayIso,
} from '../utils/format';
import { exportReportExcel, exportReportPdf } from '../utils/pdf-excel-export';
import {
  AccCard,
  DateField,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  StatTile,
} from './AccommodationUI';

export function ReportsCenter({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [from, setFrom] = useState(startOfMonth(todayIso()));
  const [to, setTo] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);
  const report = useAccommodationReport(propertyId, from, to);

  const data: ReportData | undefined = report.data;

  const run = async (kind: 'pdf' | 'excel') => {
    setBusy(kind);
    setError(null);
    try {
      let payload = report.data;
      if (!payload) {
        const result = await report.refetch();
        payload = result.data;
      }
      if (!payload) {
        setError('Rapor verisi yüklenemedi.');
        return;
      }
      const result = kind === 'pdf' ? await exportReportPdf(payload) : await exportReportExcel(payload);
      if (!result.ok) setError(result.error.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">PDF / Excel raporları</AppText>
          <AppText variant="caption" color="textTertiary">
            Tarih aralığına göre finansal ve operasyonel rapor
          </AppText>
        </View>
        <View style={styles.actions}>
          <Button
            label="PDF"
            size="sm"
            fullWidth={false}
            loading={busy === 'pdf'}
            leftIcon={<Ionicons name="document-text-outline" size={15} color={theme.colors.onPrimary} />}
            onPress={() => void run('pdf')}
          />
          <Button
            label="Excel"
            size="sm"
            fullWidth={false}
            variant="outline"
            loading={busy === 'excel'}
            leftIcon={<Ionicons name="grid-outline" size={15} color={theme.colors.text} />}
            onPress={() => void run('excel')}
          />
        </View>
      </View>

      <View style={styles.dateRow}>
        <View style={styles.flex}>
          <DateField label="Başlangıç" value={from} onChange={(iso) => { setFrom(iso); if (iso > to) setTo(iso); }} />
        </View>
        <View style={styles.flex}>
          <DateField label="Bitiş" value={to} onChange={setTo} minDate={from} />
        </View>
        <View style={styles.flex}>
          <View>
            <AppText variant="label" color="textSecondary" style={styles.quickLabel}>Hızlı seçim</AppText>
            <View style={styles.quickRow}>
              <Button
                label="Bu ay"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={() => { setFrom(startOfMonth(todayIso())); setTo(todayIso()); }}
              />
              <Button
                label="Son 7 gün"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={() => { setFrom(addDaysIso(todayIso(), -6)); setTo(todayIso()); }}
              />
            </View>
          </View>
        </View>
      </View>

      {error ? <InlineError message={error} /> : null}

      {report.isLoading ? (
        <LoadingBlock height={200} />
      ) : report.isError ? (
        <InlineError
          message={report.error instanceof Error ? report.error.message : 'Rapor yüklenemedi.'}
          onRetry={() => void report.refetch()}
        />
      ) : data ? (
        <>
          <View style={styles.stats}>
            <View style={styles.statTile}>
              <StatTile label="Konaklama geliri" value={formatMoneyCents(data.totals.revenue_cents)} icon="bed-outline" tone="primary" />
            </View>
            <View style={styles.statTile}>
              <StatTile label="Tahsilat" value={formatMoneyCents(data.totals.collected_cents)} icon="download-outline" tone="success" />
            </View>
            <View style={styles.statTile}>
              <StatTile label="Gider" value={formatMoneyCents(data.totals.expenses_cents)} icon="arrow-up-outline" tone="warning" />
            </View>
            <View style={styles.statTile}>
              <StatTile label="Komisyon" value={formatMoneyCents(data.totals.commission_cents)} icon="calculator-outline" tone="danger" />
            </View>
          </View>

          <AccCard padding={12} style={styles.summary}>
            <AppText variant="bodyStrong">{data.property.name}</AppText>
            <AppText variant="caption" color="textTertiary">
              {formatDate(data.from)} – {formatDate(data.to)} · {data.totals.reservation_count} rezervasyon
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {[data.property.district, data.property.address].filter(Boolean).join(' · ')}
            </AppText>
            <View style={styles.summaryMeta}>
              <AppText variant="caption" color="textSecondary">
                Vergi dairesi: {data.property.tax_office ?? '—'}
              </AppText>
              <AppText variant="caption" color="textSecondary">
                Vergi no: {data.property.tax_number ?? '—'}
              </AppText>
            </View>
          </AccCard>

          {data.daily.length === 0 ? (
            <EmptyState icon="document-text-outline" title="Veri yok" message="Seçilen tarih aralığında finansal hareket bulunmuyor." compact />
          ) : (
            <AccCard padding={0} style={styles.table}>
              <View style={[styles.tableHead, { borderBottomColor: theme.colors.divider }]}>
                <AppText variant="caption" color="textTertiary" style={styles.colDate}>Tarih</AppText>
                <AppText variant="caption" color="textTertiary" style={styles.colNum}>Gelir</AppText>
                <AppText variant="caption" color="textTertiary" style={styles.colNum}>Tahsilat</AppText>
                <AppText variant="caption" color="textTertiary" style={styles.colNum}>Gider</AppText>
                <AppText variant="caption" color="textTertiary" style={styles.colNum}>Komisyon</AppText>
              </View>
              {data.daily.map((day, index) => (
                <View
                  key={day.date}
                  style={[
                    styles.tableRow,
                    {
                      borderBottomColor: theme.colors.divider,
                      borderBottomWidth: index === data.daily.length - 1 ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <AppText variant="caption" color="textSecondary" style={styles.colDate}>{formatDate(day.date)}</AppText>
                  <AppText variant="caption" color="text" style={styles.colNum}>{formatMoneyCents(day.revenue_cents)}</AppText>
                  <AppText variant="caption" color="success" style={styles.colNum}>{formatMoneyCents(day.collected_cents)}</AppText>
                  <AppText variant="caption" color="warning" style={styles.colNum}>{formatMoneyCents(day.expenses_cents)}</AppText>
                  <AppText variant="caption" color="danger" style={styles.colNum}>{formatMoneyCents(day.commission_cents)}</AppText>
                </View>
              ))}
            </AccCard>
          )}

          <InfoBanner text="PDF ve Excel raporları tahsilat ile konaklama gelirini ayrı gösterir. Rapor oluşturulduğu andaki verileri yansıtır; sonradan yapılan düzeltmeler yeni rapora yansır, geçmiş belge değişmez." />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: 6 },
  dateRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  quickLabel: { marginBottom: 6 },
  quickRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { width: '23.4%', minWidth: 150, flexGrow: 1 },
  summary: { gap: 2 },
  summaryMeta: { flexDirection: 'row', gap: 14, flexWrap: 'wrap', marginTop: 4 },
  table: { overflow: 'hidden' },
  tableHead: { flexDirection: 'row', gap: 8, paddingHorizontal: 11, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  tableRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 11, paddingVertical: 8 },
  colDate: { flex: 1.4, minWidth: 0 },
  colNum: { flex: 1, minWidth: 0, textAlign: 'right' },
});
