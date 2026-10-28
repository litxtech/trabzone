import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
  Pager,
} from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { useAuditCenter } from '@/features/admin/hooks/use-admin';
import type { AuditEntry } from '@/features/admin/types';
import {
  DATE_PRESETS,
  dateRangeFor,
  defaultCustomRange,
  type DatePresetKey,
} from '@/features/admin/date-range';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

const PAGE_SIZE = 40;

const outcomeTone = (outcome: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  const normalized = (outcome || '').toLowerCase();
  if (['success', 'ok', 'applied', 'completed'].includes(normalized)) return 'success';
  if (['denied', 'rejected', 'forbidden', 'failed', 'error'].includes(normalized)) return 'danger';
  if (['pending', 'partial'].includes(normalized)) return 'warning';
  return 'neutral';
};

export default function AdminAuditScreen() {
  const { theme } = useTheme();
  const [preset, setPreset] = useState<DatePresetKey>('30');
  const [custom, setCustom] = useState(defaultCustomRange());
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<string>('all');
  const [target, setTarget] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const range = dateRangeFor(preset, custom.from, custom.to);
  const audit = useAuditCenter({
    actionCode: action === 'all' ? null : action,
    targetType: target === 'all' ? null : target,
    search: query,
    from: range.from,
    to: range.to,
    limit: PAGE_SIZE,
    offset,
  });

  const rows = audit.data?.items ?? [];
  const actions = useMemo(() => ['all', ...(audit.data?.actions ?? [])], [audit.data?.actions]);
  const targets = useMemo(() => ['all', ...(audit.data?.targets ?? [])], [audit.data?.targets]);

  const columns: Column<AuditEntry>[] = [
    {
      key: 'action',
      label: 'İşlem',
      width: 1.9,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
            {row.action_label}
          </AppText>
          <AppText
            variant="caption"
            color="textTertiary"
            style={{ fontFamily: 'monospace' }}
            numberOfLines={1}
          >
            {row.action_code}
          </AppText>
        </View>
      ),
    },
    {
      key: 'actor',
      label: 'Yönetici',
      width: 1.2,
      render: (row) => (
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {row.actor_name ?? 'Sistem'}
        </AppText>
      ),
    },
    {
      key: 'target',
      label: 'Hedef',
      width: 1.2,
      hideOnMobile: true,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <Badge label={row.target_type ?? '—'} tone="neutral" />
          <AppText
            variant="caption"
            color="textTertiary"
            style={{ fontFamily: 'monospace' }}
            numberOfLines={1}
          >
            {row.target_id ?? '—'}
          </AppText>
        </View>
      ),
    },
    {
      key: 'outcome',
      label: 'Sonuç',
      width: 0.7,
      render: (row) => <Badge label={row.outcome} tone={outcomeTone(row.outcome)} />,
    },
    {
      key: 'time',
      label: 'Zaman',
      width: 1.1,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {formatDateTimeTr(row.created_at)}
        </AppText>
      ),
    },
    {
      key: 'detail',
      label: '',
      width: 0.6,
      render: (row) => (
        <Button
          label="Detay"
          size="sm"
          variant="secondary"
          fullWidth={false}
          onPress={() => setDetail(row)}
        />
      ),
    },
  ];

  return (
    <AdminPage
      title="İşlem Geçmişi"
      subtitle="Değiştirilemez denetim kayıtları. Yönetici, hedef, sonuç ve zaman bilgisi."
      refreshing={audit.isRefetching}
      onRefresh={() => void audit.refetch()}
      actions={<Badge label={`${audit.data?.total ?? 0} kayıt`} tone="primary" />}
    >
      <AdminSection
        title="Denetim kaydı arama"
        subtitle="Hassas değerler maskelenir; kayıtlar normal yöneticiler tarafından silinemez."
      >
        <AdminToolbar>
          <FilterChips
            options={DATE_PRESETS.map((item) => ({
              key: item.key,
              label: item.label,
            }))}
            value={preset}
            onChange={(key) => {
              setPreset(key);
              setOffset(0);
            }}
          />
        </AdminToolbar>

        <TextField
          label="Ara"
          placeholder="İşlem kodu, hedef kimliği veya açıklama"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          autoCapitalize="none"
          leftIcon="search-outline"
        />

        <View style={{ gap: 6 }}>
          <AppText variant="caption" color="textTertiary">
            İşlem türü
          </AppText>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipScroll}
          >
            {actions.map((code) => (
              <Pressable
                key={code}
                onPress={() => {
                  setAction(code);
                  setOffset(0);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: action === code }}
                style={[
                  styles.chip,
                  {
                    borderColor: action === code ? theme.colors.primary : theme.colors.border,
                    backgroundColor:
                      action === code ? theme.colors.primarySoft : theme.colors.surface,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={action === code ? 'primaryDeep' : 'textSecondary'}
                >
                  {code === 'all' ? 'Tümü' : code}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={{ gap: 6 }}>
          <AppText variant="caption" color="textTertiary">
            Hedef türü
          </AppText>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipScroll}
          >
            {targets.map((code) => (
              <Pressable
                key={code}
                onPress={() => {
                  setTarget(code);
                  setOffset(0);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: target === code }}
                style={[
                  styles.chip,
                  {
                    borderColor: target === code ? theme.colors.primary : theme.colors.border,
                    backgroundColor:
                      target === code ? theme.colors.primarySoft : theme.colors.surface,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={target === code ? 'primaryDeep' : 'textSecondary'}
                >
                  {code === 'all' ? 'Tümü' : code}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {preset === 'custom' ? (
          <View style={styles.customRange}>
            <TextField
              label="Başlangıç"
              value={custom.from}
              onChangeText={(value) => setCustom((c) => ({ ...c, from: value }))}
              placeholder="YYYY-MM-DD"
            />
            <TextField
              label="Bitiş"
              value={custom.to}
              onChangeText={(value) => setCustom((c) => ({ ...c, to: value }))}
              placeholder="YYYY-MM-DD"
            />
          </View>
        ) : null}

        <DataTable
          columns={columns}
          rows={rows}
          keyExtractor={(row) => String(row.id)}
          loading={audit.isLoading}
          empty={
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={22} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textSecondary">
                Filtrelere uygun denetim kaydı bulunamadı.
              </AppText>
            </View>
          }
        />

        <Pager
          total={audit.data?.total ?? 0}
          limit={PAGE_SIZE}
          offset={offset}
          onChange={setOffset}
        />
      </AdminSection>

      <AdminSection title="Kayıt politikası" subtitle="Denetim altyapısı">
        <AuditLine icon="lock-closed-outline" label="Değiştirilemez kayıt" value="INSERT-only" />
        <AuditLine icon="eye-off-outline" label="Hassas veri" value="Maskelenir" />
        <AuditLine icon="person-outline" label="Aktör kimliği" value="Zorunlu" />
        <AuditLine icon="time-outline" label="Saklama" value="Kurumsal politika" />
      </AdminSection>

      <Modal
        visible={Boolean(detail)}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}
      >
        <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setDetail(null)}
            accessibilityLabel="Kapat"
          />
          <View
            style={[
              styles.modal,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.lg,
              },
            ]}
          >
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">{detail?.action_label}</AppText>
                <AppText variant="caption" color="textTertiary" style={{ fontFamily: 'monospace' }}>
                  {detail?.action_code}
                </AppText>
              </View>
              <Pressable
                onPress={() => setDetail(null)}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <View style={{ gap: 5 }}>
              <DetailLine label="Yönetici" value={detail?.actor_name ?? 'Sistem'} />
              <DetailLine
                label="Hedef"
                value={`${detail?.target_type ?? '—'} · ${detail?.target_id ?? '—'}`}
              />
              <DetailLine label="Sonuç" value={detail?.outcome ?? '—'} />
              <DetailLine
                label="Zaman"
                value={detail ? formatDateTimeTr(detail.created_at) : '—'}
              />
            </View>

            <AppText variant="caption" color="textTertiary">
              Ek veri
            </AppText>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={[
                styles.metadata,
                { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
              ]}
            >
              <AppText variant="caption" style={{ fontFamily: 'monospace' }} selectable>
                {JSON.stringify(detail?.metadata ?? {}, null, 2)}
              </AppText>
            </ScrollView>

            <Button label="Kapat" size="sm" variant="secondary" onPress={() => setDetail(null)} />
          </View>
        </View>
      </Modal>
    </AdminPage>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <AppText variant="caption" color="textTertiary" style={{ width: 80 }}>
        {label}
      </AppText>
      <AppText variant="caption" style={{ flex: 1 }} selectable>
        {value}
      </AppText>
    </View>
  );
}

function AuditLine({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.auditLine, { borderColor: theme.colors.divider }]}>
      <Ionicons name={icon} size={16} color={theme.colors.primary} />
      <AppText variant="caption" style={{ flex: 1 }}>
        {label}
      </AppText>
      <Badge label={value} tone="neutral" />
    </View>
  );
}

const styles = StyleSheet.create({
  chipScroll: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  customRange: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 30 },
  auditLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  modal: { width: '100%', maxWidth: 540, padding: 18, gap: 11, borderWidth: 1, maxHeight: '88%' },
  modalHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  metadata: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
    maxHeight: 260,
  },
});
