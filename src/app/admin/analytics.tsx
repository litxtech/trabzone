import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
  Pager,
} from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { buildCsv, buildExcelXml, exportFile } from '@/features/admin/export';
import { shareAdminReport } from '@/features/documents';
import {
  useAdminMe,
  useReportCatalog,
  useReportExport,
  useReportPreview,
} from '@/features/admin/hooks/use-admin';
import type { ReportCatalogItem } from '@/features/admin/types';
import {
  DATE_PRESETS,
  dateRangeFor,
  defaultCustomRange,
  iso,
  type DatePresetKey,
} from '@/features/admin/date-range';
import { useTheme } from '@/theme/ThemeProvider';

const PAGE_SIZE = 25;

const humanize = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase());

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  if (typeof value === 'number') return value.toLocaleString('tr-TR');
  if (typeof value === 'string') {
    const date = /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
    if (date && !Number.isNaN(date.getTime())) {
      return date.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
    }
    return value;
  }
  return JSON.stringify(value);
};

export default function AdminAnalyticsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const catalog = useReportCatalog();
  const exportReport = useReportExport();

  const [preset, setPreset] = useState<DatePresetKey>('30');
  const [custom, setCustom] = useState(defaultCustomRange());
  const [category, setCategory] = useState('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);

  const range = dateRangeFor(preset, custom.from, custom.to);
  const reports = catalog.data?.items ?? [];
  const categories = catalog.data?.categories ?? [];
  const filteredReports = useMemo(
    () => (category === 'all' ? reports : reports.filter((item) => item.category === category)),
    [category, reports],
  );
  const activeReport: ReportCatalogItem | null =
    reports.find((item) => item.key === selectedKey) ?? filteredReports[0] ?? reports[0] ?? null;

  const preview = useReportPreview({
    key: activeReport?.key ?? null,
    from: range.from,
    to: range.to,
    filters,
    limit: PAGE_SIZE,
    offset,
  });

  const permissions = me.data?.permissions ?? [];
  const canSensitive = (report: ReportCatalogItem) =>
    !report.sensitive || report.required_permissions.every((code) => permissions.includes(code));

  const columns: Column<Record<string, unknown>>[] = (preview.data?.columns ?? []).map((column) => ({
    key: column.key,
    label: column.label,
    width: Math.max(column.width / 100, 0.7),
    render: (row) => (
      <AppText variant="caption" color="textSecondary" numberOfLines={3}>
        {displayValue(row[column.key])}
      </AppText>
    ),
  }));

  const selectReport = (report: ReportCatalogItem) => {
    setSelectedKey(report.key);
    setFilters({});
    setOffset(0);
  };

  const download = async (format: 'csv' | 'excel' | 'pdf') => {
    if (!activeReport) return;
    if (!canSensitive(activeReport)) {
      toast.error('Bu raporu dışa aktarma yetkiniz yok.');
      return;
    }
    if (format === 'pdf') {
      setPdfBusy(true);
    }
    try {
      const result = await exportReport.mutateAsync({
        key: activeReport.key,
        from: range.from,
        to: range.to,
        filters,
      });

      if (format === 'pdf') {
        const pdf = await shareAdminReport({
          reportKey: activeReport.key,
          title: activeReport.title,
          description: activeReport.description,
          category: activeReport.category,
          columns: result.columns.map((column) => ({ key: column.key, label: column.label })),
          rows: result.rows,
          range: { from: range.from, to: range.to },
          generatedBy: me.data?.display_name ?? me.data?.user_id ?? undefined,
          sensitive: activeReport.sensitive,
        });
        if (!pdf.ok) {
          toast.error(pdf.error.message);
          return;
        }
        toast.success(
          pdf.data.action === 'share'
            ? 'PDF paylaşımı açıldı.'
            : 'PDF yazdırma penceresi açıldı; "PDF olarak kaydet" seçebilirsiniz.',
        );
        return;
      }

      const content =
        format === 'csv'
          ? buildCsv(result.columns, result.rows)
          : buildExcelXml(activeReport.title, result.columns, result.rows);
      const mode = await exportFile({
        content,
        mime:
          format === 'csv'
            ? 'text/csv;charset=utf-8'
            : 'application/vnd.ms-excel;charset=utf-8',
        filename: `trabzone-${activeReport.key}-${iso(new Date(range.from))}-${iso(new Date(range.to))}.${format === 'csv' ? 'csv' : 'xls'}`,
      });
      toast.success(
        mode === 'downloaded'
          ? `${result.rows.length} kayıt dışa aktarıldı.`
          : 'Rapor panoya kopyalandı.',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rapor dışa aktarılamadı.');
    } finally {
      if (format === 'pdf') {
        setPdfBusy(false);
      }
    }
  };

  return (
    <AdminPage
      title="Analitik ve Raporlar"
      subtitle="Yetkiye duyarlı rapor kataloğu, canlı önizleme ve CSV / Excel / PDF dışa aktarma."
      refreshing={catalog.isRefetching}
      onRefresh={() => {
        void catalog.refetch();
        void preview.refetch();
      }}
      actions={
        <Badge
          label={activeReport ? `${preview.data?.total ?? 0} satır` : 'Rapor seçin'}
          tone="primary"
        />
      }
    >
      <AdminSection
        title="Rapor kataloğu"
        subtitle="Dışa aktarılan içerik yönetici rolüne ve required_permissions listesine göre sınırlandırılır."
        action={
          activeReport ? (
            <Badge
              label={activeReport.sensitive ? 'Hassas rapor' : 'Standart rapor'}
              tone={activeReport.sensitive ? 'warning' : 'neutral'}
            />
          ) : undefined
        }
      >
        {catalog.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : (
          <>
            <AdminToolbar>
              <FilterChips
                options={[
                  { key: 'all', label: 'Tüm kategoriler', count: reports.length },
                  ...categories.map((item) => ({ key: item, label: humanize(item) })),
                ]}
                value={category}
                onChange={(key) => {
                  setCategory(key);
                  setSelectedKey(null);
                  setFilters({});
                  setOffset(0);
                }}
              />
            </AdminToolbar>

            <View style={styles.reportGrid}>
              {filteredReports.map((report) => {
                const active = activeReport?.key === report.key;
                const allowed = canSensitive(report);
                return (
                  <Pressable
                    key={report.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => selectReport(report)}
                    style={[
                      styles.reportCard,
                      {
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                      },
                    ]}
                  >
                    <View style={styles.reportHead}>
                      <View
                        style={[
                          styles.reportIcon,
                          {
                            backgroundColor: active
                              ? theme.colors.primary
                              : theme.colors.surface,
                          },
                        ]}
                      >
                        <Ionicons
                          name="bar-chart-outline"
                          size={15}
                          color={active ? theme.colors.onPrimary : theme.colors.primary}
                        />
                      </View>
                      <AppText variant="caption" style={{ flex: 1, fontWeight: '700' }} numberOfLines={2}>
                        {report.title}
                      </AppText>
                      {report.sensitive ? <Badge label="Hassas" tone="warning" /> : null}
                    </View>
                    <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                      {report.description}
                    </AppText>
                    <View style={styles.chips}>
                      <Badge label={humanize(report.category)} tone="neutral" />
                      {allowed ? null : <Badge label="Yetki gerekli" tone="danger" />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </AdminSection>

      {activeReport ? (
        <AdminSection
          title={activeReport.title}
          subtitle={activeReport.description}
          action={
            <View style={styles.chips}>
              <Button
                label="CSV"
                size="sm"
                variant="secondary"
                fullWidth={false}
                loading={exportReport.isPending}
                disabled={!canSensitive(activeReport)}
                onPress={() => void download('csv')}
              />
              <Button
                label="Excel"
                size="sm"
                variant="secondary"
                fullWidth={false}
                loading={exportReport.isPending}
                disabled={!canSensitive(activeReport)}
                onPress={() => void download('excel')}
              />
              <Button
                label="PDF"
                size="sm"
                variant="secondary"
                fullWidth={false}
                loading={pdfBusy}
                disabled={!canSensitive(activeReport)}
                onPress={() => void download('pdf')}
              />
            </View>
          }
        >
          <FilterChips
            options={DATE_PRESETS.map((item) => ({ key: item.key, label: item.label }))}
            value={preset}
            onChange={(key) => {
              setPreset(key);
              setOffset(0);
            }}
          />

          {preset === 'custom' ? (
            <View style={styles.customRange}>
              <TextField
                label="Başlangıç"
                value={custom.from}
                onChangeText={(value) => {
                  setCustom((current) => ({ ...current, from: value }));
                  setOffset(0);
                }}
                placeholder="YYYY-MM-DD"
              />
              <TextField
                label="Bitiş"
                value={custom.to}
                onChangeText={(value) => {
                  setCustom((current) => ({ ...current, to: value }));
                  setOffset(0);
                }}
                placeholder="YYYY-MM-DD"
              />
            </View>
          ) : null}

          {Object.keys(activeReport.filters).length > 0 ? (
            <View style={styles.customRange}>
              {Object.keys(activeReport.filters).map((key) => (
                <TextField
                  key={key}
                  label={humanize(key)}
                  value={filters[key] ?? ''}
                  onChangeText={(next) => {
                    setFilters((current) => ({ ...current, [key]: next }));
                    setOffset(0);
                  }}
                  placeholder={`Filtre: ${humanize(key)}`}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.chips}>
            {activeReport.required_permissions.map((code) => (
              <Badge
                key={code}
                label={code}
                tone={permissions.includes(code) ? 'success' : 'danger'}
              />
            ))}
          </View>

          <DataTable
            columns={columns}
            rows={preview.data?.rows ?? []}
            keyExtractor={(row) => String(row.id ?? row.key ?? row.user_id ?? row.email ?? JSON.stringify(row))}
            loading={preview.isLoading}
            empty={
              <View style={styles.empty}>
                <Ionicons name="document-outline" size={22} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textSecondary">
                  Seçili aralıkta kayıt bulunamadı.
                </AppText>
              </View>
            }
          />

          <Pager
            total={preview.data?.total ?? 0}
            limit={PAGE_SIZE}
            offset={offset}
            onChange={setOffset}
          />

          <AppText variant="caption" color="textTertiary">
            Önizleme ilk {PAGE_SIZE} satırı gösterir; dışa aktarma en fazla 5.000 satır içerir.
            PDF çıktısı marka bilgileri, sayfa numarası ve belge kodu içerir. Finansal ve kişisel
            veri içeren raporlar yalnızca yetkili roller tarafından indirilebilir.
          </AppText>
        </AdminSection>
      ) : null}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 30, alignItems: 'center' },
  reportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  reportCard: { flexGrow: 1, flexBasis: 250, maxWidth: 380, borderWidth: StyleSheet.hairlineWidth, borderRadius: 13, padding: 11, gap: 7 },
  reportHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  reportIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  customRange: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 30 },
});
