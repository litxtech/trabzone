import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useArchiveRatePlan,
  usePropertyInventory,
  useSaveRatePlan,
} from '../hooks/use-accommodation';
import type { ManagedRatePlan } from '../types';
import { BOOKING_MODE_LABELS } from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
  StatusPill,
} from './AccommodationUI';

type FormState = {
  name: string;
  description: string;
  roomTypeId: string | null;
  bookingMode: 'instant' | 'manual';
  cancellationPolicy: string;
  cancellationHours: string;
  depositPercent: string;
  includesBreakfast: boolean;
  minStay: string;
  maxStay: string;
  active: boolean;
};

const EMPTY: FormState = {
  name: '',
  description: '',
  roomTypeId: null,
  bookingMode: 'manual',
  cancellationPolicy: '',
  cancellationHours: '48',
  depositPercent: '0',
  includesBreakfast: false,
  minStay: '1',
  maxStay: '',
  active: true,
};

export function RatePlansManager({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const inventory = usePropertyInventory(propertyId);
  const save = useSaveRatePlan(propertyId);
  const archive = useArchiveRatePlan();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<ManagedRatePlan | null>(null);

  const plans = inventory.data?.rate_plans ?? [];
  const roomTypes = inventory.data?.room_types ?? [];
  const pricesByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const type of roomTypes) map.set(type.id, type.base_price_cents);
    return map;
  }, [roomTypes]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY, roomTypeId: roomTypes[0]?.id ?? null });
    setError(null);
    setOpen(true);
  };

  const openEdit = (plan: ManagedRatePlan) => {
    setEditingId(plan.id);
    setError(null);
    setForm({
      name: plan.name,
      description: plan.description ?? '',
      roomTypeId: plan.room_type_id,
      bookingMode: plan.booking_mode,
      cancellationPolicy: plan.cancellation_policy ?? '',
      cancellationHours: String(plan.cancellation_hours),
      depositPercent: String(plan.deposit_percent),
      includesBreakfast: plan.includes_breakfast,
      minStay: String(plan.min_stay),
      maxStay: plan.max_stay ? String(plan.max_stay) : '',
      active: plan.active,
    });
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    if (form.name.trim().length < 2) {
      setError('Fiyat planı adı en az 2 karakter olmalı.');
      return;
    }
    const hours = Number(form.cancellationHours);
    const deposit = Number(form.depositPercent.replace(',', '.'));
    const minStay = Number(form.minStay);
    const maxStay = form.maxStay.trim() ? Number(form.maxStay) : null;
    if (!Number.isFinite(hours) || hours < 0) {
      setError('İptal süresi geçerli değil.');
      return;
    }
    if (!Number.isFinite(deposit) || deposit < 0 || deposit > 100) {
      setError('Depozito oranı 0–100 arasında olmalı.');
      return;
    }
    if (!Number.isFinite(minStay) || minStay < 1) {
      setError('Minimum konaklama en az 1 gece olmalı.');
      return;
    }
    if (maxStay !== null && (!Number.isFinite(maxStay) || maxStay < minStay)) {
      setError('Maksimum konaklama minimumdan küçük olamaz.');
      return;
    }
    try {
      await save.mutateAsync({
        id: editingId ?? undefined,
        name: form.name.trim(),
        description: form.description.trim() || null,
        room_type_id: form.roomTypeId,
        booking_mode: form.bookingMode,
        cancellation_policy: form.cancellationPolicy.trim() || null,
        cancellation_hours: Math.round(hours),
        deposit_percent: deposit,
        includes_breakfast: form.includesBreakfast,
        min_stay: Math.round(minStay),
        max_stay: maxStay === null ? null : Math.round(maxStay),
        active: form.active,
      });
      setOpen(false);
      void inventory.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fiyat planı kaydedilemedi.');
    }
  };

  if (inventory.isLoading) return <LoadingBlock height={240} />;
  if (inventory.isError) {
    return (
      <InlineError
        message={inventory.error instanceof Error ? inventory.error.message : 'Fiyat planları yüklenemedi.'}
        onRetry={() => void inventory.refetch()}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Fiyat planları</AppText>
          <AppText variant="caption" color="textTertiary">
            {plans.length} plan · anında veya manuel onay
          </AppText>
        </View>
        <Button
          label="Plan ekle"
          size="sm"
          fullWidth={false}
          disabled={roomTypes.length === 0}
          leftIcon={<Ionicons name="pricetags-outline" size={15} color={theme.colors.onPrimary} />}
          onPress={openCreate}
        />
      </View>

      {roomTypes.length === 0 ? (
        <InfoBanner text="Fiyat planı eklemeden önce en az bir oda tipi oluşturmalısın." tone="warning" />
      ) : null}

      {error ? <InlineError message={error} /> : null}

      {plans.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title="Fiyat planı yok"
          message="Esnek, iade edilemez veya kahvaltı dahil gibi fiyat planları oluştur. Her plan için rezervasyon modu seçilebilir."
          compact
        />
      ) : (
        <View style={styles.grid}>
          {plans.map((plan) => {
            const instant = plan.booking_mode === 'instant';
            const price = plan.room_type_id ? pricesByType.get(plan.room_type_id) : null;
            return (
              <AccCard key={plan.id} padding={12} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.icon, { backgroundColor: instant ? theme.colors.successSoft : theme.colors.warningSoft }]}>
                    <Ionicons
                      name={instant ? 'flash-outline' : 'time-outline'}
                      size={17}
                      color={instant ? theme.colors.success : theme.colors.warning}
                    />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>{plan.name}</AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {plan.room_type_name ?? 'Tüm oda tipleri'}
                    </AppText>
                  </View>
                  <StatusPill
                    label={plan.active ? 'Aktif' : 'Pasif'}
                    color={plan.active ? theme.colors.success : theme.colors.textTertiary}
                    background={plan.active ? theme.colors.successSoft : theme.colors.surfaceMuted}
                  />
                </View>

                <View style={styles.modeRow}>
                  <View
                    style={[
                      styles.modePill,
                      { backgroundColor: instant ? theme.colors.successSoft : theme.colors.warningSoft },
                    ]}
                  >
                    <AppText variant="caption" style={{ color: instant ? theme.colors.success : theme.colors.warning }}>
                      {BOOKING_MODE_LABELS[plan.booking_mode]}
                    </AppText>
                  </View>
                  {plan.includes_breakfast ? (
                    <View style={[styles.modePill, { backgroundColor: theme.colors.primarySoft }]}>
                      <AppText variant="caption" color="primary">Kahvaltı dahil</AppText>
                    </View>
                  ) : null}
                </View>

                {price != null ? (
                  <AppText variant="bodyStrong">{new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(price / 100)} baz</AppText>
                ) : null}

                <View style={styles.metaGrid}>
                  <Metric label="Min gece" value={String(plan.min_stay)} />
                  <Metric label="Maks gece" value={plan.max_stay ? String(plan.max_stay) : '∞'} />
                  <Metric label="Depozito" value={`%${plan.deposit_percent}`} />
                  <Metric label="İptal" value={plan.cancellation_hours > 0 ? `${plan.cancellation_hours} sa` : 'Yok'} />
                </View>

                {plan.cancellation_policy ? (
                  <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                    {plan.cancellation_policy}
                  </AppText>
                ) : null}

                <View style={[styles.cardFooter, { borderTopColor: theme.colors.divider }]}>
                  <Button label="Düzenle" size="sm" variant="ghost" fullWidth={false} onPress={() => openEdit(plan)} />
                  <Button label="Arşivle" size="sm" variant="ghost" fullWidth={false} onPress={() => setArchiving(plan)} />
                </View>
              </AccCard>
            );
          })}
        </View>
      )}

      <InfoBanner text="Bir tesisin farklı oda tiplerinde farklı rezervasyon modelleri kullanılabilir. Örneğin standart odalar anında, süitler manuel onaylı satılabilir. Anında rezervasyonda stok ve fiyat sunucuda atomik olarak doğrulanır." />

      <ModalSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Fiyat planını düzenle' : 'Yeni fiyat planı'}
        maxWidth={560}
        footer={<Button label="Kaydet" loading={save.isPending} onPress={() => void submit()} />}
      >
        <View style={{ gap: 10 }}>
          {error ? <InlineError message={error} /> : null}
          <TextField label="Plan adı" value={form.name} onChangeText={(value) => patch('name', value)} placeholder="Esnek iade edilebilir" />
          <TextField label="Açıklama" value={form.description} onChangeText={(value) => patch('description', value)} multiline numberOfLines={2} />
          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Oda tipi</AppText>
            <View style={styles.chips}>
              <Chip label="Tümü" active={form.roomTypeId === null} onPress={() => patch('roomTypeId', null)} />
              {roomTypes.map((type) => (
                <Chip key={type.id} label={type.name} active={form.roomTypeId === type.id} onPress={() => patch('roomTypeId', type.id)} />
              ))}
            </View>
          </View>
          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Rezervasyon modu</AppText>
            <View style={styles.chips}>
              {(['instant', 'manual'] as const).map((mode) => (
                <Chip
                  key={mode}
                  label={BOOKING_MODE_LABELS[mode]}
                  active={form.bookingMode === mode}
                  onPress={() => patch('bookingMode', mode)}
                />
              ))}
            </View>
            <AppText variant="caption" color="textTertiary" style={styles.modeHint}>
              {form.bookingMode === 'instant'
                ? 'Misafir uygun oda ve fiyatı seçtiğinde rezervasyon atomik olarak kesinleşir.'
                : 'Misafir talep gönderir; otel onaylayana kadar oda geçici süre tutulur.'}
            </AppText>
          </View>
          <TextField
            label="İptal politikası"
            value={form.cancellationPolicy}
            onChangeText={(value) => patch('cancellationPolicy', value)}
            multiline
            numberOfLines={3}
            placeholder="Girişe 48 saat kalaya kadar ücretsiz iptal."
          />
          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <TextField
                label="Ücretsiz iptal (saat)"
                value={form.cancellationHours}
                onChangeText={(value) => patch('cancellationHours', value.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Depozito (%)"
                value={form.depositPercent}
                onChangeText={(value) => patch('depositPercent', value.replace(/[^\d.,]/g, ''))}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <TextField
                label="Minimum gece"
                value={form.minStay}
                onChangeText={(value) => patch('minStay', value.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Maksimum gece"
                value={form.maxStay}
                onChangeText={(value) => patch('maxStay', value.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
                placeholder="Sınırsız"
              />
            </View>
          </View>
          <View style={styles.chips}>
            <Chip label="Kahvaltı dahil" active={form.includesBreakfast} onPress={() => patch('includesBreakfast', !form.includesBreakfast)} />
            <Chip label="Aktif" active={form.active} onPress={() => patch('active', !form.active)} />
          </View>
        </View>
      </ModalSheet>

      <ModalSheet
        visible={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title="Fiyat planını arşivle"
        subtitle={archiving?.name}
        maxWidth={420}
        footer={
          <View style={styles.modalFooter}>
            <Button label="Vazgeç" variant="ghost" fullWidth={false} onPress={() => setArchiving(null)} />
            <Button
              label="Arşivle"
              variant="danger"
              fullWidth={false}
              loading={archive.isPending}
              onPress={async () => {
                if (!archiving) return;
                try {
                  await archive.mutateAsync(archiving.id);
                  setArchiving(null);
                  void inventory.refetch();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Fiyat planı arşivlenemedi.');
                }
              }}
            />
          </View>
        }
      >
        <AppText variant="body" color="textSecondary">
          Plan yeni rezervasyonlara kapatılır. Mevcut rezervasyonların fiyatı ve koşulları değişmez.
        </AppText>
      </ModalSheet>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: theme.colors.surfaceMuted }]}>
      <AppText variant="caption" color="textTertiary" style={styles.tiny}>{label}</AppText>
      <AppText variant="caption" color="text">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '32%', minWidth: 270, flexGrow: 1, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  modeRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  modePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  metaGrid: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  metric: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, minWidth: 54 },
  tiny: { fontSize: 8 },
  cardFooter: { flexDirection: 'row', gap: 2, paddingTop: 6, marginTop: 2, borderTopWidth: StyleSheet.hairlineWidth },
  fieldLabel: { marginBottom: 6 },
  modeHint: { marginTop: 5 },
  twoCols: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
