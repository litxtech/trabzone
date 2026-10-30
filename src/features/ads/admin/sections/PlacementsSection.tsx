import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { ChipSelect, ToggleRow } from '@/features/admin/components/news-api/shared';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useTheme } from '@/theme/ThemeProvider';

import type { AdPlatform } from '../../types';
import { useAdPlacementUpdate, useAdPlacements } from '../hooks';
import { FORMAT_LABELS, PLACEMENT_GROUPS, PLATFORMS, formatCount, parseLocalDateTime, toLocalDateTime } from '../labels';
import type { AdFormat, AdPlacementPatch, AdPlacementRow } from '../types';

const NUMERIC_FIELDS: { key: keyof AdPlacementRow['effective']; label: string; hint: string }[] = [
  { key: 'first_after', label: 'İlk reklam konumu', hint: 'Kaç organik içerikten sonra' },
  { key: 'interval_min', label: 'Minimum aralık', hint: 'İki reklam arası en az içerik' },
  { key: 'interval_max', label: 'Maksimum aralık', hint: 'İki reklam arası en çok içerik' },
  { key: 'max_per_session', label: 'Oturum başına en fazla', hint: '0 = bu yerleşimde gösterme' },
  { key: 'max_daily_per_user', label: 'Kullanıcı başına günlük', hint: 'Tüm kampanyalar toplamı' },
  { key: 'campaign_repeat_limit', label: 'Kampanya tekrar sınırı', hint: 'Oturumda aynı kampanya' },
];

export function PlacementsSection({ canManage }: { canManage: boolean }) {
  const placements = useAdPlacements();
  const groups = new Map<string, AdPlacementRow[]>();
  for (const row of placements.data ?? []) {
    const list = groups.get(row.group_key) ?? [];
    list.push(row);
    groups.set(row.group_key, list);
  }

  return (
    <AdminSection
      title="Reklam yerleşimleri"
      subtitle="Her akış teknik olarak hazırdır; reklam yalnızca burada açılan yerleşimlerde görünür. Sayısal değerler güvenli sınırlara oturtulur."
    >
      {placements.isLoading ? (
        <AppText variant="body" color="textSecondary">
          Yükleniyor…
        </AppText>
      ) : null}
      {[...groups.entries()].map(([group, rows]) => (
        <View key={group} style={styles.group}>
          <AppText variant="label" color="textSecondary">
            {PLACEMENT_GROUPS[group] ?? group}
          </AppText>
          {rows.map((row) => (
            <PlacementCard key={row.key} row={row} canManage={canManage} />
          ))}
        </View>
      ))}
    </AdminSection>
  );
}

function PlacementCard({ row, canManage }: { row: AdPlacementRow; canManage: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const update = useAdPlacementUpdate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ patch: AdPlacementPatch; title: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [platforms, setPlatforms] = useState<AdPlatform[]>(row.platforms);
  const [format, setFormat] = useState<AdFormat>(row.format);
  const [minPriority, setMinPriority] = useState(String(row.min_priority));
  const [activeFrom, setActiveFrom] = useState(toLocalDateTime(row.active_from));
  const [activeUntil, setActiveUntil] = useState(toLocalDateTime(row.active_until));
  const [admobFallback, setAdmobFallback] = useState(row.allow_admob_fallback);
  const reserved = row.surface_status === 'reserved';
  const ctr = row.impressions_7d > 0 ? ((row.clicks_7d / row.impressions_7d) * 100).toFixed(2) : '0';

  const openEditor = () => {
    setDraft(Object.fromEntries(NUMERIC_FIELDS.map((field) => [field.key, String(row[field.key])])));
    setPlatforms(row.platforms);
    setFormat(row.format);
    setMinPriority(String(row.min_priority));
    setActiveFrom(toLocalDateTime(row.active_from));
    setActiveUntil(toLocalDateTime(row.active_until));
    setAdmobFallback(row.allow_admob_fallback);
    setOpen(true);
  };

  const buildPatch = (): AdPlacementPatch | null => {
    const patch: AdPlacementPatch = {};
    for (const field of NUMERIC_FIELDS) {
      const value = Number.parseInt(draft[field.key] ?? '', 10);
      if (!Number.isFinite(value)) {
        toast.error(`${field.label} sayısal olmalı.`);
        return null;
      }
      patch[field.key] = value;
    }
    const from = activeFrom.trim() ? parseLocalDateTime(activeFrom) : null;
    const until = activeUntil.trim() ? parseLocalDateTime(activeUntil) : null;
    if ((activeFrom.trim() && !from) || (activeUntil.trim() && !until)) {
      toast.error('Tarihler YYYY-AA-GG SS:DD biçiminde olmalı.');
      return null;
    }
    return {
      ...patch,
      platforms,
      format,
      min_priority: Number.parseInt(minPriority, 10) || 1,
      active_from: from,
      active_until: until,
      allow_admob_fallback: admobFallback,
    };
  };

  return (
    <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <AppText variant="bodyStrong">{row.label_tr}</AppText>
            <Badge label={reserved ? 'Hazırlık' : 'Canlı yüzey'} tone={reserved ? 'neutral' : 'primary'} />
            <Badge label={FORMAT_LABELS[row.format]} tone="accent" />
            {row.enabled ? <Badge label="Açık" tone="success" /> : <Badge label="Kapalı" tone="neutral" />}
          </View>
          <AppText variant="caption" color="textTertiary">
            {row.description_tr}
          </AppText>
          {reserved && row.surface_note ? (
            <AppText variant="caption" color="warning">
              {row.surface_note}
            </AppText>
          ) : null}
          <AppText variant="caption" color="textSecondary">
            Etkin: ilk {row.effective.first_after}. içerikten sonra · her {row.effective.interval_min}–
            {row.effective.interval_max} içerikte bir · oturumda en fazla {row.effective.max_per_session} · günlük{' '}
            {row.effective.max_daily_per_user} · {row.active_campaigns} uygun kampanya · 7 gün: {formatCount(row.impressions_7d)}{' '}
            gösterim, {formatCount(row.clicks_7d)} tıklama (%{ctr})
          </AppText>
        </View>
        <Switch
          accessibilityLabel={`${row.label_tr} reklamlarını ${row.enabled ? 'kapat' : 'aç'}`}
          value={row.enabled}
          disabled={!canManage || (reserved && !row.enabled) || update.isPending}
          onValueChange={(value) =>
            setPending({
              patch: { enabled: value },
              title: value ? `${row.label_tr} reklamlarını aç` : `${row.label_tr} reklamlarını kapat`,
            })
          }
          trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
          thumbColor={theme.colors.surface}
        />
      </View>

      {canManage ? (
        <View style={styles.actions}>
          <Button
            label={open ? 'Ayarları gizle' : 'Ayarlar'}
            size="sm"
            variant="ghost"
            fullWidth={false}
            onPress={() => (open ? setOpen(false) : openEditor())}
          />
        </View>
      ) : null}

      {open ? (
        <View style={styles.editor}>
          <View style={styles.grid}>
            {NUMERIC_FIELDS.map((field) => (
              <View key={field.key} style={styles.cell}>
                <TextField
                  label={field.label}
                  value={draft[field.key] ?? ''}
                  onChangeText={(value) => setDraft((prev) => ({ ...prev, [field.key]: value }))}
                  keyboardType="number-pad"
                  hint={`${field.hint} · kayıtlı ${row[field.key]}, etkin ${row.effective[field.key]}`}
                />
              </View>
            ))}
            <View style={styles.cell}>
              <TextField label="En düşük kampanya önceliği" value={minPriority} onChangeText={setMinPriority} keyboardType="number-pad" hint="1–10" />
            </View>
            <View style={styles.cell}>
              <TextField label="Başlangıç (opsiyonel)" value={activeFrom} onChangeText={setActiveFrom} placeholder="2026-11-01 00:00" autoCapitalize="none" />
            </View>
            <View style={styles.cell}>
              <TextField label="Bitiş (opsiyonel)" value={activeUntil} onChangeText={setActiveUntil} placeholder="2026-12-31 23:59" autoCapitalize="none" />
            </View>
          </View>
          <AppText variant="caption" color="textTertiary">
            Platformlar
          </AppText>
          <ChipSelect
            multiple
            options={PLATFORMS}
            values={platforms}
            onToggle={(value) =>
              setPlatforms((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]))
            }
          />
          <AppText variant="caption" color="textTertiary">
            Format
          </AppText>
          <ChipSelect
            options={row.supported_formats.map((value) => ({ value, label: FORMAT_LABELS[value] }))}
            value={format}
            onChange={setFormat}
          />
          <ToggleRow
            title="AdMob yedeği"
            description="Uygun doğrudan kampanya yoksa ve AdMob sistem ayarlarında yapılandırılmışsa kullanılır."
            value={admobFallback}
            onValueChange={setAdmobFallback}
          />
          <View style={styles.actions}>
            <Button label="Vazgeç" size="sm" variant="secondary" fullWidth={false} onPress={() => setOpen(false)} />
            <Button
              label="Kaydet"
              size="sm"
              fullWidth={false}
              onPress={() => {
                const patch = buildPatch();
                if (patch) setPending({ patch, title: `${row.label_tr} ayarlarını kaydet` });
              }}
            />
          </View>
        </View>
      ) : null}

      <ReasonDialog
        visible={pending != null}
        title={pending?.title ?? ''}
        description="Değişiklik denetim kaydına yazılır. Güvenli sınır dışındaki değerler otomatik düzeltilir."
        loading={update.isPending}
        onCancel={() => setPending(null)}
        onConfirm={async ({ reason }) => {
          if (!pending) return;
          try {
            const result = await update.mutateAsync({ key: row.key, patch: pending.patch, reason });
            setPending(null);
            setOpen(false);
            if (result.adjustments.length) {
              toast.success(
                `Kaydedildi. Güvenli sınıra çekilen alanlar: ${result.adjustments
                  .map((item) => `${item.field} ${item.requested}→${item.applied}`)
                  .join(', ')}`,
              );
            } else {
              toast.success('Yerleşim güncellendi.');
            }
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Yerleşim güncellenemedi.');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0, gap: 3 },
  group: { gap: 8 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  editor: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexGrow: 1, flexBasis: 200, minWidth: 180 },
});
