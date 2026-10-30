import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppImage, AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAccommodationCampaigns,
  useEndCampaign,
  useSaveCampaign,
} from '../hooks/use-accommodation';
import type { CampaignInput } from '../services/accommodation-service';
import {
  accommodationMediaUrl,
  uploadAccommodationMedia,
} from '../services/accommodation-media-service';
import type { Campaign, CampaignKind, CampaignStatus } from '../types';
import {
  CAMPAIGN_KIND_LABELS,
  CAMPAIGN_KIND_OPTIONS,
  CAMPAIGN_STATUS_LABELS,
  addDaysIso,
  formatDate,
  formatMoneyCents,
  parseMoneyToCents,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  Chip,
  DateField,
  EmptyState,
  InlineError,
  InfoBanner,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  StatusPill,
} from './AccommodationUI';

type FormState = {
  title: string;
  description: string;
  kind: CampaignKind;
  startDate: string;
  endDate: string;
  bookingDeadline: string | null;
  roomTypeIds: string[];
  ratePlanIds: string[];
  discountPercent: string;
  fixedPrice: string;
  minNights: string;
  maxNights: string;
  quota: string;
  stackable: boolean;
  status: CampaignStatus;
  coverPath: string | null;
};

function emptyForm(): FormState {
  return {
    title: '',
    description: '',
    kind: 'trabzone',
    startDate: todayIso(),
    endDate: addDaysIso(todayIso(), 30),
    bookingDeadline: null,
    roomTypeIds: [],
    ratePlanIds: [],
    discountPercent: '10',
    fixedPrice: '',
    minNights: '1',
    maxNights: '',
    quota: '',
    stackable: false,
    status: 'draft',
    coverPath: null,
  };
}

function formFromCampaign(campaign: Campaign): FormState {
  return {
    title: campaign.title,
    description: campaign.description ?? '',
    kind: campaign.kind,
    startDate: campaign.start_date,
    endDate: campaign.end_date,
    bookingDeadline: campaign.booking_deadline,
    roomTypeIds: campaign.room_type_ids ?? [],
    ratePlanIds: campaign.rate_plan_ids ?? [],
    discountPercent: String(campaign.discount_percent),
    fixedPrice: campaign.fixed_price_cents ? String(campaign.fixed_price_cents / 100) : '',
    minNights: String(campaign.min_nights),
    maxNights: campaign.max_nights ? String(campaign.max_nights) : '',
    quota: campaign.quota ? String(campaign.quota) : '',
    stackable: campaign.stackable,
    status: campaign.status,
    coverPath: campaign.cover_path,
  };
}

const STATUS_TONES: Record<CampaignStatus, { color: string; background: string }> = {
  active: { color: '#1B7F4B', background: '#DCF5E7' },
  draft: { color: '#6B7280', background: '#EEF1F5' },
  paused: { color: '#9A6A00', background: '#FDF3D9' },
  ended: { color: '#B42318', background: '#FBE4E1' },
};

export function CampaignManager({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const campaigns = useAccommodationCampaigns(propertyId);
  const save = useSaveCampaign(propertyId);
  const end = useEndCampaign();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<Campaign | null>(null);
  const [uploading, setUploading] = useState(false);

  const data = campaigns.data;
  const items = data?.items ?? [];
  const activeCount = items.filter((item) => item.status === 'active').length;

  const roomTypeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of data?.room_types ?? []) map.set(entry.id, entry.name);
    return map;
  }, [data?.room_types]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const toggleArray = (key: 'roomTypeIds' | 'ratePlanIds', id: string) =>
    setForm((current) => {
      const exists = current[key].includes(id);
      return {
        ...current,
        [key]: exists ? current[key].filter((entry) => entry !== id) : [...current[key], id],
      };
    });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setErrors({});
    setError(null);
    setOpen(true);
  };

  const openEdit = (campaign: Campaign) => {
    setEditingId(campaign.id);
    setForm(formFromCampaign(campaign));
    setErrors({});
    setError(null);
    setOpen(true);
  };

  const pickCover = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const uploaded = await uploadAccommodationMedia({
        propertyId,
        uri: asset.uri,
        name: asset.fileName ?? `kampanya-${Date.now()}.jpg`,
        mime: asset.mimeType ?? 'image/jpeg',
        kind: 'image',
        size: asset.fileSize ?? null,
      });
      if (!uploaded.ok) {
        setError(uploaded.error.message);
        return;
      }
      patch('coverPath', uploaded.data.path);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (status: CampaignStatus) => {
    setError(null);
    const next: Record<string, string | null> = {};
    if (form.title.trim().length < 3) next.title = 'Kampanya adı en az 3 karakter olmalı.';
    if (form.endDate < form.startDate) next.endDate = 'Bitiş tarihi başlangıçtan önce olamaz.';
    if (form.bookingDeadline && form.bookingDeadline > form.endDate) {
      next.bookingDeadline = 'Son rezervasyon tarihi bitişten sonra olamaz.';
    }
    const discount = Number(form.discountPercent.replace(',', '.'));
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      next.discount = 'İndirim oranı 0–100 arasında olmalı.';
    }
    const fixed = form.fixedPrice.trim() ? parseMoneyToCents(form.fixedPrice) : null;
    if (form.fixedPrice.trim() && (!fixed || fixed <= 0)) next.fixedPrice = 'Sabit fiyat geçerli değil.';
    const minNights = Number(form.minNights);
    if (!Number.isFinite(minNights) || minNights < 1) next.minNights = 'Minimum gece en az 1 olmalı.';
    const maxNights = form.maxNights.trim() ? Number(form.maxNights) : null;
    if (maxNights !== null && (!Number.isFinite(maxNights) || maxNights < minNights)) {
      next.maxNights = 'Maksimum gece minimumdan küçük olamaz.';
    }
    const quota = form.quota.trim() ? Number(form.quota) : null;
    if (quota !== null && (!Number.isFinite(quota) || quota < 1)) next.quota = 'Kontenjan en az 1 olmalı.';

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: CampaignInput = {
      id: editingId ?? undefined,
      title: form.title.trim(),
      description: form.description.trim() || null,
      cover_path: form.coverPath,
      kind: form.kind,
      start_date: form.startDate,
      end_date: form.endDate,
      booking_deadline: form.bookingDeadline,
      room_type_ids: form.roomTypeIds,
      rate_plan_ids: form.ratePlanIds,
      discount_percent: discount,
      fixed_price_cents: fixed,
      min_nights: Math.round(minNights),
      max_nights: maxNights ? Math.round(maxNights) : null,
      quota: quota ? Math.round(quota) : null,
      stackable: form.stackable,
      status,
    };

    try {
      await save.mutateAsync(payload);
      setOpen(false);
      void campaigns.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kampanya kaydedilemedi.');
    }
  };

  const applyStatus = async (campaign: Campaign, status: CampaignStatus) => {
    setError(null);
    try {
      await save.mutateAsync({
        id: campaign.id,
        title: campaign.title,
        description: campaign.description,
        cover_path: campaign.cover_path,
        kind: campaign.kind,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        booking_deadline: campaign.booking_deadline,
        room_type_ids: campaign.room_type_ids,
        rate_plan_ids: campaign.rate_plan_ids,
        discount_percent: campaign.discount_percent,
        fixed_price_cents: campaign.fixed_price_cents,
        min_nights: campaign.min_nights,
        max_nights: campaign.max_nights,
        quota: campaign.quota,
        stackable: campaign.stackable,
        status,
      });
      void campaigns.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kampanya durumu güncellenemedi.');
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">İndirim kampanyaları</AppText>
          <AppText variant="caption" color="textTertiary">
            {activeCount > 0 ? `${activeCount} aktif kampanya` : 'Aktif kampanya yok'}
          </AppText>
        </View>
        <Button
          label="Kampanya oluştur"
          size="sm"
          fullWidth={false}
          leftIcon={<Ionicons name="pricetag-outline" size={15} color={theme.colors.onPrimary} />}
          onPress={openCreate}
        />
      </View>

      {error ? <InlineError message={error} /> : null}

      <InfoBanner text="Kampanya indirimi yalnızca seçilen oda tipi ve fiyat planlarının uygun gecelerine uygulanır. Sabit fiyat girildiğinde indirim oranı yerine bu fiyat kullanılır; toplam fiyat negatife düşürülmez." />

      {campaigns.isLoading ? (
        <LoadingBlock height={200} />
      ) : campaigns.isError ? (
        <InlineError
          message={campaigns.error instanceof Error ? campaigns.error.message : 'Kampanyalar yüklenemedi.'}
          onRetry={() => void campaigns.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title="Kampanya yok"
          message="Son dakika, erken rezervasyon veya Trabzone'a özel indirimler oluşturarak görünürlüğünü artır."
          compact
        />
      ) : (
        <View style={styles.grid}>
          {items.map((campaign) => {
            const tone = STATUS_TONES[campaign.status];
            const cover = accommodationMediaUrl(campaign.cover_path);
            const scope =
              campaign.room_type_ids.length === 0
                ? 'Tüm oda tipleri'
                : campaign.room_type_ids
                    .map((id) => roomTypeName.get(id) ?? 'Oda tipi')
                    .join(', ');
            return (
              <AccCard key={campaign.id} padding={0} style={styles.card}>
                {cover ? (
                  <AppImage source={{ uri: cover }} style={styles.cover} contentFit="cover" />
                ) : (
                  <View style={[styles.cover, styles.coverFallback, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="pricetags-outline" size={22} color={theme.colors.primary} />
                  </View>
                )}
                <View style={styles.body}>
                  <View style={styles.titleRow}>
                    <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                      {campaign.title}
                    </AppText>
                    <StatusPill label={CAMPAIGN_STATUS_LABELS[campaign.status]} color={tone.color} background={tone.background} />
                  </View>
                  <View style={styles.metaRow}>
                    <View style={[styles.kindPill, { backgroundColor: theme.colors.surfaceMuted }]}>
                      <AppText variant="caption" color="textSecondary" style={styles.small}>
                        {CAMPAIGN_KIND_LABELS[campaign.kind]}
                      </AppText>
                    </View>
                    <AppText variant="caption" color="textTertiary" style={styles.small} numberOfLines={1}>
                      {formatDate(campaign.start_date)} – {formatDate(campaign.end_date)}
                    </AppText>
                  </View>
                  <View style={styles.valueRow}>
                    <AppText variant="h3" color="primary">
                      {campaign.fixed_price_cents
                        ? formatMoneyCents(campaign.fixed_price_cents)
                        : `%${campaign.discount_percent}`}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {campaign.fixed_price_cents ? 'sabit gecelik fiyat' : 'indirim'}
                    </AppText>
                  </View>
                  <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                    {scope}
                  </AppText>
                  <View style={styles.metaRow}>
                    <AppText variant="caption" color="textTertiary">
                      Min {campaign.min_nights} gece
                    </AppText>
                    {campaign.quota ? (
                      <AppText variant="caption" color="textTertiary">
                        Kontenjan {campaign.used_count}/{campaign.quota}
                      </AppText>
                    ) : null}
                    {campaign.booking_deadline ? (
                      <AppText variant="caption" color="textTertiary">
                        Son: {formatDate(campaign.booking_deadline)}
                      </AppText>
                    ) : null}
                  </View>
                  <View style={[styles.cardActions, { borderTopColor: theme.colors.divider }]}>
                    <Button label="Düzenle" size="sm" variant="ghost" fullWidth={false} onPress={() => openEdit(campaign)} />
                    {campaign.status === 'active' ? (
                      <Button label="Duraklat" size="sm" variant="ghost" fullWidth={false} loading={save.isPending} onPress={() => void applyStatus(campaign, 'paused')} />
                    ) : campaign.status !== 'ended' ? (
                      <Button label="Yayınla" size="sm" variant="ghost" fullWidth={false} loading={save.isPending} onPress={() => void applyStatus(campaign, 'active')} />
                    ) : null}
                    {campaign.status !== 'ended' ? (
                      <Button label="Bitir" size="sm" variant="ghost" fullWidth={false} onPress={() => setEnding(campaign)} />
                    ) : null}
                  </View>
                </View>
              </AccCard>
            );
          })}
        </View>
      )}

      <ModalSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Kampanyayı düzenle' : 'Yeni kampanya'}
        subtitle="İndirim ve geçerlilik kuralları"
        maxWidth={640}
        footer={
          <View style={styles.modalFooter}>
            <Button
              label="Taslak kaydet"
              variant="outline"
              fullWidth={false}
              loading={save.isPending}
              onPress={() => void submit('draft')}
            />
            <Button
              label="Yayınla"
              fullWidth={false}
              loading={save.isPending}
              onPress={() => void submit('active')}
            />
          </View>
        }
      >
        <View style={styles.form}>
          {error ? <InlineError message={error} /> : null}
          <TextField
            label="Kampanya adı"
            value={form.title}
            onChangeText={(value) => patch('title', value)}
            placeholder="Örn. Erken rezervasyon %15"
            error={errors.title}
          />
          <TextField
            label="Açıklama"
            value={form.description}
            onChangeText={(value) => patch('description', value)}
            multiline
            numberOfLines={3}
            placeholder="Misafirin göreceği kısa açıklama"
          />

          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Kampanya türü</AppText>
            <View style={styles.chips}>
              {CAMPAIGN_KIND_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  active={form.kind === option.value}
                  onPress={() => patch('kind', option.value as CampaignKind)}
                />
              ))}
            </View>
          </View>

          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <DateField label="Başlangıç" value={form.startDate} onChange={(iso) => patch('startDate', iso)} />
            </View>
            <View style={styles.flex}>
              <DateField label="Bitiş" value={form.endDate} onChange={(iso) => patch('endDate', iso)} minDate={form.startDate} error={errors.endDate} />
            </View>
          </View>

          <DateField
            label="Son rezervasyon tarihi (opsiyonel)"
            value={form.bookingDeadline}
            onChange={(iso) => patch('bookingDeadline', iso)}
            minDate={todayIso()}
            error={errors.bookingDeadline}
            hint="Boş bırakılırsa kampanya bitimine kadar geçerli."
          />

          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>
              Oda tipleri {form.roomTypeIds.length === 0 ? '(tümü)' : `(${form.roomTypeIds.length})`}
            </AppText>
            <View style={styles.chips}>
              {(data?.room_types ?? []).map((roomType) => (
                <Chip
                  key={roomType.id}
                  label={roomType.name}
                  active={form.roomTypeIds.includes(roomType.id)}
                  onPress={() => toggleArray('roomTypeIds', roomType.id)}
                />
              ))}
            </View>
          </View>

          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>
              Fiyat planları {form.ratePlanIds.length === 0 ? '(tümü)' : `(${form.ratePlanIds.length})`}
            </AppText>
            <View style={styles.chips}>
              {(data?.rate_plans ?? []).map((plan) => (
                <Chip
                  key={plan.id}
                  label={plan.name}
                  active={form.ratePlanIds.includes(plan.id)}
                  onPress={() => toggleArray('ratePlanIds', plan.id)}
                />
              ))}
            </View>
          </View>

          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <TextField
                label="İndirim oranı (%)"
                value={form.discountPercent}
                onChangeText={(value) => patch('discountPercent', value.replace(/[^\d.,]/g, ''))}
                keyboardType="decimal-pad"
                error={errors.discount}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Sabit gecelik fiyat (₺)"
                value={form.fixedPrice}
                onChangeText={(value) => patch('fixedPrice', value.replace(/[^\d.,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="Opsiyonel"
                error={errors.fixedPrice}
              />
            </View>
          </View>

          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <TextField
                label="Minimum gece"
                value={form.minNights}
                onChangeText={(value) => patch('minNights', value.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
                error={errors.minNights}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Maksimum gece"
                value={form.maxNights}
                onChangeText={(value) => patch('maxNights', value.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
                placeholder="Sınırsız"
                error={errors.maxNights}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Kontenjan"
                value={form.quota}
                onChangeText={(value) => patch('quota', value.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
                placeholder="Sınırsız"
                error={errors.quota}
              />
            </View>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: form.stackable }}
            onPress={() => patch('stackable', !form.stackable)}
            style={[styles.switchRow, { borderColor: theme.colors.border }]}
          >
            <View style={styles.flex}>
              <AppText variant="body">Diğer kampanyalarla birleştirilebilir</AppText>
              <AppText variant="caption" color="textTertiary">
                Kapalıysa bu kampanya diğer indirimlerle üst üste uygulanmaz.
              </AppText>
            </View>
            <View
              style={[
                styles.switch,
                { backgroundColor: form.stackable ? theme.colors.primary : theme.colors.surfaceMuted },
              ]}
            >
              <View
                style={[
                  styles.switchKnob,
                  {
                    backgroundColor: form.stackable ? '#fff' : theme.colors.textTertiary,
                    alignSelf: form.stackable ? 'flex-end' : 'flex-start',
                  },
                ]}
              />
            </View>
          </Pressable>

          <View style={styles.coverRow}>
            {accommodationMediaUrl(form.coverPath) ? (
              <AppImage source={{ uri: accommodationMediaUrl(form.coverPath)! }} style={styles.coverPreview} contentFit="cover" />
            ) : null}
            <Button
              label={form.coverPath ? 'Kapak görselini değiştir' : 'Kapak görseli ekle'}
              size="sm"
              variant="outline"
              fullWidth={false}
              loading={uploading}
              onPress={() => void pickCover()}
            />
          </View>

          {editingId ? (
            <View style={[styles.summary, { borderColor: theme.colors.border }]}>
              <KeyValueRow label="Mevcut durum" value={CAMPAIGN_STATUS_LABELS[form.status]} />
              <KeyValueRow
                label="Uygulanacak değer"
                value={form.fixedPrice.trim() ? `${form.fixedPrice} ₺ sabit` : `%${form.discountPercent} indirim`}
              />
            </View>
          ) : null}
        </View>
      </ModalSheet>

      <ModalSheet
        visible={Boolean(ending)}
        onClose={() => setEnding(null)}
        title="Kampanyayı bitir"
        subtitle={ending?.title}
        maxWidth={420}
        footer={
          <View style={styles.modalFooter}>
            <Button label="Vazgeç" variant="ghost" fullWidth={false} onPress={() => setEnding(null)} />
            <Button
              label="Bitir"
              variant="danger"
              fullWidth={false}
              loading={end.isPending}
              onPress={async () => {
                if (!ending) return;
                try {
                  await end.mutateAsync(ending.id);
                  setEnding(null);
                  void campaigns.refetch();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Kampanya bitirilemedi.');
                }
              }}
            />
          </View>
        }
      >
        <AppText variant="body" color="textSecondary">
          Kampanya bitirildiğinde misafirler yeni rezervasyonlarda bu indirimi göremez. Mevcut rezervasyonların fiyatı değişmez.
        </AppText>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '32%', minWidth: 280, overflow: 'hidden', flexGrow: 1 },
  cover: { width: '100%', height: 96 },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: 11, gap: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  kindPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  small: { fontSize: 9 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  cardActions: { flexDirection: 'row', gap: 2, paddingTop: 7, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  form: { gap: 12 },
  fieldLabel: { marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  twoCols: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  switch: { width: 40, height: 22, borderRadius: 11, padding: 2, justifyContent: 'center' },
  switchKnob: { width: 18, height: 18, borderRadius: 9 },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  coverPreview: { width: 84, height: 56, borderRadius: 8 },
  summary: { gap: 3, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
});
