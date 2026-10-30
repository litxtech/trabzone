import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useBulkRateUpdate } from '../hooks/use-accommodation';
import type { BulkRateAction, BulkRateResult } from '../types';
import {
  addDaysIso,
  formatDate,
  formatMoneyCents,
  parseMoneyToCents,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  Chip,
  ChipsRow,
  DateField,
  InfoBanner,
  InlineError,
  LoadingBlock,
  ModalSheet,
} from './AccommodationUI';

type ActionOption = {
  value: BulkRateAction;
  label: string;
  requiresValue: boolean;
  valueLabel?: string;
  valueSuffix?: string;
  description: string;
};

const ACTIONS: ActionOption[] = [
  { value: 'set_price', label: 'Sabit fiyat', requiresValue: true, valueLabel: 'Gecelik fiyat (₺)', description: 'Seçilen tüm gecelere aynı fiyatı yazar.' },
  { value: 'increase_percent', label: 'Fiyat artır', requiresValue: true, valueLabel: 'Artış (%)', description: 'Mevcut gecelik fiyatları yüzde oranında artırır.' },
  { value: 'decrease_percent', label: 'Fiyat azalt', requiresValue: true, valueLabel: 'Azalış (%)', description: 'Mevcut gecelik fiyatları yüzde oranında azaltır. Fiyat sıfırın altına inmez.' },
  { value: 'weekday_weekend', label: 'Hafta içi / sonu', requiresValue: false, description: 'Hafta içi ve hafta sonu için ayrı sabit fiyat tanımlar.' },
  { value: 'set_availability', label: 'Müsait oda', requiresValue: true, valueLabel: 'Oda sayısı', description: 'Seçilen günlerde satılabilir oda sayısını belirler.' },
  { value: 'close', label: 'Satışa kapat', requiresValue: false, description: 'Seçilen günleri rezervasyona kapatır.' },
  { value: 'open', label: 'Satışa aç', requiresValue: false, description: 'Kapalı günleri yeniden satışa açar.' },
  { value: 'set_min_stay', label: 'Min. gece', requiresValue: true, valueLabel: 'Minimum gece', description: 'Seçilen günlerde minimum konaklama süresi.' },
  { value: 'set_max_stay', label: 'Maks. gece', requiresValue: true, valueLabel: 'Maksimum gece', description: 'Seçilen günlerde maksimum konaklama süresi.' },
  { value: 'close_arrival', label: 'Girişe kapat', requiresValue: false, description: 'Bu günlerde giriş yapılamaz, konaklama devam edenler etkilenmez.' },
  { value: 'open_arrival', label: 'Girişe aç', requiresValue: false, description: 'Giriş kısıtını kaldırır.' },
  { value: 'close_departure', label: 'Çıkışa kapat', requiresValue: false, description: 'Bu günlerde çıkış yapılamaz.' },
  { value: 'open_departure', label: 'Çıkışa aç', requiresValue: false, description: 'Çıkış kısıtını kaldırır.' },
];

export function BulkRateModal({
  visible,
  onClose,
  propertyId,
  defaultFrom,
  defaultTo,
  roomTypes,
  ratePlans,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: string;
  defaultFrom: string;
  defaultTo: string;
  roomTypes: { id: string; name: string }[];
  ratePlans: { id: string; name: string; room_type_id: string | null }[];
}) {
  const { theme } = useTheme();
  const bulk = useBulkRateUpdate(propertyId);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [roomTypeIds, setRoomTypeIds] = useState<string[]>([]);
  const [ratePlanIds, setRatePlanIds] = useState<string[]>([]);
  const [action, setAction] = useState<BulkRateAction>('increase_percent');
  const [value, setValue] = useState('');
  const [weekday, setWeekday] = useState('');
  const [weekend, setWeekend] = useState('');
  const [preview, setPreview] = useState<BulkRateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrom(defaultFrom);
    setTo(addDaysIso(defaultTo, 1));
    setRoomTypeIds(roomTypes.map((item) => item.id));
    setRatePlanIds([]);
    setAction('increase_percent');
    setValue('');
    setPreview(null);
    setError(null);
    setInfo(null);
  }, [visible, defaultFrom, defaultTo, roomTypes]);

  const option = ACTIONS.find((item) => item.value === action) ?? ACTIONS[0]!;

  const availablePlans = useMemo(
    () =>
      ratePlans.filter(
        (plan) =>
          roomTypeIds.length === 0 ||
          plan.room_type_id == null ||
          roomTypeIds.includes(plan.room_type_id),
      ),
    [ratePlans, roomTypeIds],
  );

  const numericValue = useMemo(() => {
    if (action === 'set_price') return parseMoneyToCents(value) != null ? (parseMoneyToCents(value) as number) / 100 : null;
    if (!option.requiresValue) return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }, [action, option.requiresValue, value]);

  const canSubmit =
    roomTypeIds.length > 0 &&
    to > from &&
    (action === 'weekday_weekend'
      ? Number(weekday.replace(',', '.')) > 0 && Number(weekend.replace(',', '.')) > 0
      : !option.requiresValue || (numericValue != null && numericValue >= 0));

  const run = async (dryRun: boolean) => {
    setError(null);
    setInfo(null);
    if (!canSubmit) {
      setError('Tarih, oda tipi ve işlem değerlerini kontrol et.');
      return;
    }
    try {
      const result = await bulk.mutateAsync({
        roomTypeIds,
        ratePlanIds,
        from,
        to,
        action,
        value: action === 'weekday_weekend' ? null : numericValue,
        dryRun,
        extra:
          action === 'weekday_weekend'
            ? { weekday_price: Number(weekday.replace(',', '.')), weekend_price: Number(weekend.replace(',', '.')) }
            : {},
      });
      if (dryRun) {
        setPreview(result);
      } else {
        setPreview(null);
        setInfo(`${result.affected} hücre güncellendi.`);
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fiyat güncellemesi yapılamadı.');
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Toplu fiyat ve müsaitlik"
      subtitle="Tarih aralığı, oda tipleri ve fiyat planları için tek işlem"
      footer={
        <View style={styles.footer}>
          <Button
            label="Önizle"
            variant="outline"
            loading={bulk.isPending && !preview}
            onPress={() => void run(true)}
            style={styles.flex}
          />
          <Button
            label={preview ? 'Değişiklikleri uygula' : 'Uygula'}
            loading={bulk.isPending && Boolean(preview)}
            disabled={!preview}
            onPress={() => void run(false)}
            style={styles.flex}
          />
        </View>
      }
    >
      <View style={styles.section}>
        <AppText variant="bodyStrong">Tarih aralığı</AppText>
        <View style={styles.row}>
          <DateField
            label="Başlangıç"
            value={from}
            minDate={todayIso()}
            onChange={(next) => {
              setFrom(next);
              if (to <= next) setTo(addDaysIso(next, 1));
              setPreview(null);
            }}
          />
        </View>
        <DateField label="Bitiş (hariç)" value={to} minDate={addDaysIso(from, 1)} onChange={(next) => { setTo(next); setPreview(null); }} />
        <AppText variant="caption" color="textTertiary">
          {from && to ? `${formatDate(from)} – ${formatDate(addDaysIso(to, -1))} · ${Math.max(0, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000))} gece` : 'Tarih seç'}
        </AppText>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <AppText variant="bodyStrong">Oda tipleri</AppText>
          <AppText variant="caption" color="textTertiary">
            {roomTypeIds.length} seçili
          </AppText>
        </View>
        <ChipsRow>
          {roomTypes.map((roomType) => (
            <Chip
              key={roomType.id}
              label={roomType.name}
              active={roomTypeIds.includes(roomType.id)}
              onPress={() => {
                setRoomTypeIds((current) =>
                  current.includes(roomType.id)
                    ? current.filter((id) => id !== roomType.id)
                    : [...current, roomType.id],
                );
                setPreview(null);
              }}
            />
          ))}
        </ChipsRow>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <AppText variant="bodyStrong">Fiyat planları</AppText>
          <Chip
            label={ratePlanIds.length === 0 ? 'Tümü seçili' : `${ratePlanIds.length} seçili`}
            active={ratePlanIds.length === 0}
            onPress={() => setRatePlanIds([])}
          />
        </View>
        <ChipsRow>
          {availablePlans.map((plan) => (
            <Chip
              key={plan.id}
              label={plan.name}
              active={ratePlanIds.includes(plan.id)}
              onPress={() => {
                setRatePlanIds((current) =>
                  current.includes(plan.id)
                    ? current.filter((id) => id !== plan.id)
                    : [...current, plan.id],
                );
                setPreview(null);
              }}
            />
          ))}
        </ChipsRow>
        <AppText variant="caption" color="textTertiary">
          Plan seçilmezse ilgili oda tiplerinin tüm aktif fiyat planları etkilenir.
        </AppText>
      </View>

      <View style={styles.section}>
        <AppText variant="bodyStrong">İşlem</AppText>
        <ChipsRow>
          {ACTIONS.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              active={action === item.value}
              onPress={() => {
                setAction(item.value);
                setValue('');
                setPreview(null);
                setError(null);
              }}
            />
          ))}
        </ChipsRow>
        <AppText variant="caption" color="textTertiary">
          {option.description}
        </AppText>

        {action === 'weekday_weekend' ? (
          <View style={styles.row}>
            <TextField
              label="Hafta içi fiyat (₺)"
              value={weekday}
              onChangeText={(next) => { setWeekday(next.replace(/[^\d.,]/g, '')); setPreview(null); }}
              keyboardType="decimal-pad"
              containerStyle={styles.flex}
            />
            <TextField
              label="Hafta sonu fiyat (₺)"
              value={weekend}
              onChangeText={(next) => { setWeekend(next.replace(/[^\d.,]/g, '')); setPreview(null); }}
              keyboardType="decimal-pad"
              containerStyle={styles.flex}
            />
          </View>
        ) : option.requiresValue ? (
          <TextField
            label={option.valueLabel ?? 'Değer'}
            value={value}
            onChangeText={(next) => { setValue(next.replace(/[^\d.,]/g, '')); setPreview(null); }}
            keyboardType="decimal-pad"
            placeholder={action === 'set_price' ? 'Örn. 2.500' : action.includes('percent') ? 'Örn. 10' : 'Örn. 3'}
          />
        ) : null}
      </View>

      {error ? <InlineError message={error} /> : null}
      {info ? <InfoBanner tone="success" text={info} /> : null}

      {bulk.isPending && !preview ? <LoadingBlock height={64} label="Önizleme hazırlanıyor…" /> : null}

      {preview ? (
        <AccCard padding={12} style={{ gap: 7 }}>
          <View style={styles.sectionHead}>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">Önizleme</AppText>
              <AppText variant="caption" color="textTertiary">
                {preview.affected} hücre etkilenecek · {formatDate(preview.from)} – {formatDate(addDaysIso(preview.to, -1))}
              </AppText>
            </View>
            <Ionicons name="eye-outline" size={17} color={theme.colors.primaryDeep} />
          </View>
          {preview.sample.slice(0, 8).map((sample, index) => (
            <View key={`${sample.date}-${sample.room_type_name}-${index}`} style={styles.sampleRow}>
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                {formatDate(sample.date)} · {sample.room_type_name} · {sample.rate_plan_name}
              </AppText>
              <AppText variant="caption" color="text">
                {formatMoneyCents(sample.base_price_cents, 'TRY', { decimals: false })}
              </AppText>
              {sample.closed ? (
                <StatusPillMini label="Kapalı" />
              ) : sample.available_rooms != null ? (
                <AppText variant="caption" color="textTertiary">
                  {sample.available_rooms} oda
                </AppText>
              ) : null}
            </View>
          ))}
          {preview.affected > preview.sample.length ? (
            <AppText variant="caption" color="textTertiary">
              + {preview.affected - preview.sample.length} hücre daha
            </AppText>
          ) : null}
          <InfoBanner text="Önizleme yalnızca hesaplama sonucudur; onaylayana kadar veritabanı değişmez. Onaylı eski rezervasyonların fiyatları değişmez." />
        </AccCard>
      ) : null}
    </ModalSheet>
  );
}

function StatusPillMini({ label }: { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.miniPill, { backgroundColor: theme.colors.dangerSoft }]}>
      <AppText variant="caption" color="danger" style={styles.miniPillText}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { flexDirection: 'row', gap: 8 },
  sampleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  miniPillText: { fontSize: 9 },
});
