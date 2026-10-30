import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { formatDateTime } from '@/features/pharmacy/admin/shared';

import { REGION_LABELS } from '../utils/format';
import { adminApi, useEarthquakeAdminMutation, type AdminSettings } from './api';
import { SettingSwitch, useReasonAction } from './ui';

const REGION_KEYS = [
  'center_lat',
  'center_lng',
  'center_label',
  'default_region',
  'radius_options',
  'turkey_enabled',
  'district_filter_enabled',
  'default_range_days',
  'map_default_zoom',
  'map_layers',
  'chart_max_points',
  'sync_enabled',
  'sync_interval_seconds',
  'overlap_minutes',
  'revision_sweep_hours',
  'stale_after_seconds',
] as const;

const NOTIFY_KEYS = [
  'notifications_enabled',
  'notifications_paused',
  'notify_trabzon_enabled',
  'notify_turkey_enabled',
  'notify_small_enabled',
  'small_magnitude_threshold',
  'late_event_max_minutes',
  'revision_notify_min_delta',
  'important_magnitude',
  'quiet_bypass_magnitude',
  'push_expire_minutes',
] as const;

const NUMERIC_KEYS = new Set<string>([
  'center_lat',
  'center_lng',
  'default_range_days',
  'map_default_zoom',
  'chart_max_points',
  'sync_interval_seconds',
  'overlap_minutes',
  'revision_sweep_hours',
  'stale_after_seconds',
  'small_magnitude_threshold',
  'late_event_max_minutes',
  'revision_notify_min_delta',
  'important_magnitude',
  'quiet_bypass_magnitude',
  'push_expire_minutes',
]);

type Draft = Record<string, unknown>;

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingsTab({ settings, canManage, canNotify }: { settings: AdminSettings; canManage: boolean; canNotify: boolean }) {
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<string | null>(null);
  const update = useEarthquakeAdminMutation(adminApi.updateSettings);
  const { ask, dialog } = useReasonAction();

  const value = <K extends keyof AdminSettings>(key: K): AdminSettings[K] =>
    (key in draft ? draft[key as string] : settings[key]) as AdminSettings[K];
  const text = (key: keyof AdminSettings) => String(key in draft ? draft[key as string] : settings[key] ?? '');
  const set = (key: keyof AdminSettings, next: unknown) => {
    setErrors(null);
    setDraft((prev) => ({ ...prev, [key]: next }));
  };

  const buildPatch = (keys: readonly string[]) => {
    const patch: Record<string, unknown> = {};
    for (const key of keys) {
      if (!(key in draft)) continue;
      let next = draft[key];
      if (NUMERIC_KEYS.has(key)) {
        const parsed = Number(String(next).replace(',', '.'));
        if (!Number.isFinite(parsed)) throw new Error(`Geçersiz sayı: ${key}`);
        next = parsed;
      }
      if (!same(next, settings[key as keyof AdminSettings])) patch[key] = next;
    }
    return patch;
  };

  const save = (group: 'region' | 'notify') => {
    let patch: Record<string, unknown>;
    try {
      patch = buildPatch(group === 'region' ? REGION_KEYS : NOTIFY_KEYS);
    } catch (error) {
      setErrors(error instanceof Error ? error.message : 'Geçersiz değer.');
      return;
    }
    if (Object.keys(patch).length === 0) {
      setErrors('Değişiklik yok.');
      return;
    }
    ask({
      title: group === 'region' ? 'Bölge ve senkron ayarları kaydedilsin mi?' : 'Bildirim ayarları kaydedilsin mi?',
      description: `Değişen alanlar: ${Object.keys(patch).join(', ')}. Eski ve yeni değerler audit kaydına yazılır.`,
      run: async (reason) => {
        const result = await update.mutateAsync({ patch, reason });
        setDraft((prev) => {
          const next = { ...prev };
          Object.keys(patch).forEach((key) => delete next[key]);
          return next;
        });
        return result;
      },
      success: 'Ayarlar kaydedildi.',
    });
  };

  const radius = new Set(value('radius_options'));
  const layers = value('map_layers') ?? {};

  return (
    <View style={{ gap: 14 }}>
      <AppText variant="caption" color="textSecondary">
        Son güncelleme: {formatDateTime(settings.updated_at)}. Kayıt sırasında her değişiklik için gerekçe istenir.
      </AppText>
      {errors ? (
        <AppText variant="caption" color="danger">
          {errors}
        </AppText>
      ) : null}

      <AdminSection title="Bölge ve harita" subtitle={canManage ? undefined : 'Düzenlemek için earthquake.manage izni gerekir.'}>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <TextField label="Merkez adı" value={text('center_label')} editable={canManage} onChangeText={(v) => set('center_label', v)} containerStyle={{ flex: 1, minWidth: 180 }} />
          <TextField label="Merkez enlem" value={text('center_lat')} editable={canManage} keyboardType="decimal-pad" onChangeText={(v) => set('center_lat', v)} containerStyle={{ flex: 1, minWidth: 140 }} hint="40,4–41,5" />
          <TextField label="Merkez boylam" value={text('center_lng')} editable={canManage} keyboardType="decimal-pad" onChangeText={(v) => set('center_lng', v)} containerStyle={{ flex: 1, minWidth: 140 }} hint="38,9–40,6" />
        </View>
        <AppText variant="caption" color="textTertiary">
          Merkez değişirse tüm kayıtların uzaklık ve bölge sınıfı yeniden hesaplanır.
        </AppText>
        <AppText variant="label">Varsayılan bölge</AppText>
        <FilterChips
          options={(['province', 'r50', 'r100', 'r150', 'r250', 'turkey'] as const).map((key) => ({ key, label: REGION_LABELS[key] }))}
          value={value('default_region') as string}
          onChange={(key) => canManage && set('default_region', key)}
        />
        <AppText variant="label">Mesafe seçenekleri</AppText>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {[50, 100, 150, 250].map((km) => (
            <Button
              key={km}
              label={`${km} km`}
              size="sm"
              fullWidth={false}
              variant={radius.has(km) ? 'secondary' : 'outline'}
              disabled={!canManage}
              onPress={() => {
                const next = new Set(radius);
                if (next.has(km)) next.delete(km);
                else next.add(km);
                if (next.size > 0) set('radius_options', [...next].sort((a, b) => a - b));
              }}
            />
          ))}
        </View>
        <SettingSwitch label="Türkiye geneli seçeneği" value={Boolean(value('turkey_enabled'))} disabled={!canManage} onChange={(v) => set('turkey_enabled', v)} />
        <SettingSwitch label="İlçe filtresi" value={Boolean(value('district_filter_enabled'))} disabled={!canManage} onChange={(v) => set('district_filter_enabled', v)} />
        <SettingSwitch label="Haritada il sınırı" value={layers.boundary !== false} disabled={!canManage} onChange={(v) => set('map_layers', { ...layers, boundary: v })} />
        <SettingSwitch label="Haritada mesafe halkası" value={layers.radius !== false} disabled={!canManage} onChange={(v) => set('map_layers', { ...layers, radius: v })} />
        <SettingSwitch label="Harita kümeleme" value={layers.clusters !== false} disabled={!canManage} onChange={(v) => set('map_layers', { ...layers, clusters: v })} />
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <TextField label="Varsayılan aralık (gün)" value={text('default_range_days')} editable={canManage} keyboardType="number-pad" onChangeText={(v) => set('default_range_days', v)} containerStyle={{ flex: 1, minWidth: 140 }} />
          <TextField label="Varsayılan yakınlaştırma" value={text('map_default_zoom')} editable={canManage} keyboardType="decimal-pad" onChangeText={(v) => set('map_default_zoom', v)} containerStyle={{ flex: 1, minWidth: 140 }} />
          <TextField label="Grafik nokta sınırı" value={text('chart_max_points')} editable={canManage} keyboardType="number-pad" onChangeText={(v) => set('chart_max_points', v)} containerStyle={{ flex: 1, minWidth: 140 }} />
        </View>
      </AdminSection>

      <AdminSection title="Senkron" subtitle="Kaynak kullanım şartlarını aşmamak için aralık 30 saniyenin altına indirilmemelidir.">
        <SettingSwitch label="Otomatik senkron" value={Boolean(value('sync_enabled'))} disabled={!canManage} onChange={(v) => set('sync_enabled', v)} />
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <TextField label="Aralık (sn)" value={text('sync_interval_seconds')} editable={canManage} keyboardType="number-pad" onChangeText={(v) => set('sync_interval_seconds', v)} containerStyle={{ flex: 1, minWidth: 120 }} />
          <TextField label="Örtüşme (dk)" value={text('overlap_minutes')} editable={canManage} keyboardType="number-pad" onChangeText={(v) => set('overlap_minutes', v)} containerStyle={{ flex: 1, minWidth: 120 }} />
          <TextField label="Revizyon taraması (sa)" value={text('revision_sweep_hours')} editable={canManage} keyboardType="number-pad" onChangeText={(v) => set('revision_sweep_hours', v)} containerStyle={{ flex: 1, minWidth: 140 }} />
          <TextField label="Gecikme eşiği (sn)" value={text('stale_after_seconds')} editable={canManage} keyboardType="number-pad" onChangeText={(v) => set('stale_after_seconds', v)} containerStyle={{ flex: 1, minWidth: 140 }} />
        </View>
        {canManage ? <Button label="Bölge ve senkron ayarlarını kaydet" size="sm" fullWidth={false} onPress={() => save('region')} /> : null}
      </AdminSection>

      <AdminSection title="Bildirim kuralları" subtitle={canNotify ? undefined : 'Düzenlemek için earthquake.notify izni gerekir.'}>
        <SettingSwitch label="Deprem bildirimleri" hint="Kapalıyken yeni kayıtlar için bildirim oluşturulmaz." value={Boolean(value('notifications_enabled'))} disabled={!canNotify} onChange={(v) => set('notifications_enabled', v)} />
        <SettingSwitch label="Gönderimi duraklat" hint="Kuyruk birikir, gönderim durur; TEST bildirimleri çalışır." value={Boolean(value('notifications_paused'))} disabled={!canNotify} onChange={(v) => set('notifications_paused', v)} />
        <SettingSwitch label="Trabzon bildirimleri" value={Boolean(value('notify_trabzon_enabled'))} disabled={!canNotify} onChange={(v) => set('notify_trabzon_enabled', v)} />
        <SettingSwitch label="Türkiye geneli bildirimleri" value={Boolean(value('notify_turkey_enabled'))} disabled={!canNotify} onChange={(v) => set('notify_turkey_enabled', v)} />
        <SettingSwitch label="Küçük depremler için push" hint="Kapalıyken eşik altındaki depremler yalnızca uygulama içi bildirim olur." value={Boolean(value('notify_small_enabled'))} disabled={!canNotify} onChange={(v) => set('notify_small_enabled', v)} />
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <TextField label="Küçük deprem eşiği" value={text('small_magnitude_threshold')} editable={canNotify} keyboardType="decimal-pad" onChangeText={(v) => set('small_magnitude_threshold', v)} containerStyle={{ flex: 1, minWidth: 130 }} />
          <TextField label="Önemli büyüklük" value={text('important_magnitude')} editable={canNotify} keyboardType="decimal-pad" onChangeText={(v) => set('important_magnitude', v)} containerStyle={{ flex: 1, minWidth: 130 }} />
          <TextField label="Sessiz saati aşan büyüklük" value={text('quiet_bypass_magnitude')} editable={canNotify} keyboardType="decimal-pad" onChangeText={(v) => set('quiet_bypass_magnitude', v)} containerStyle={{ flex: 1, minWidth: 160 }} />
          <TextField label="Revizyon bildirimi farkı" value={text('revision_notify_min_delta')} editable={canNotify} keyboardType="decimal-pad" onChangeText={(v) => set('revision_notify_min_delta', v)} containerStyle={{ flex: 1, minWidth: 150 }} />
          <TextField label="Geç kayıt sınırı (dk)" value={text('late_event_max_minutes')} editable={canNotify} keyboardType="number-pad" onChangeText={(v) => set('late_event_max_minutes', v)} containerStyle={{ flex: 1, minWidth: 140 }} />
          <TextField label="Push geçerlilik (dk)" value={text('push_expire_minutes')} editable={canNotify} keyboardType="number-pad" onChangeText={(v) => set('push_expire_minutes', v)} containerStyle={{ flex: 1, minWidth: 140 }} />
        </View>
        {canNotify ? <Button label="Bildirim ayarlarını kaydet" size="sm" fullWidth={false} onPress={() => save('notify')} /> : null}
      </AdminSection>
      {dialog}
    </View>
  );
}
