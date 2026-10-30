import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppText, Button, IconButton, TextField } from '@/components/ui';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { ChipSelect, ToggleRow } from '@/features/admin/components/news-api/shared';
import { useTheme } from '@/theme/ThemeProvider';

import type { AdDestinationType, AdPlacementKey, AdPlatform } from '../../types';
import { useAdAdvertisers, useAdCampaign, useAdCampaignSave, useAdCampaignTransition, useAdPlacements, useAdsTargeting } from '../hooks';
import {
  CAMPAIGN_TYPES,
  DESTINATION_TYPES,
  PLATFORMS,
  POLICY_CATEGORIES,
  PROHIBITED_CATEGORIES,
  parseLocalDateTime,
  toLocalDateTime,
} from '../labels';
import { adIssueLabel } from '../service';
import type { AdCampaignFull, AdCampaignPayload } from '../types';
import { AdDevicePreview } from './AdDevicePreview';
import { AdMediaField } from './AdMediaField';

type Form = {
  advertiserId: string;
  name: string;
  campaignType: string;
  policyCategory: string;
  priority: string;
  startsAt: string;
  endsAt: string;
  dailyCap: string;
  totalCap: string;
  perUserDailyCap: string;
  budget: string;
  cpm: string;
  districts: string;
  platforms: AdPlatform[];
  placements: AdPlacementKey[];
  title: string;
  description: string;
  ctaLabel: string;
  businessName: string;
  imageUrl: string;
  mobileImageUrl: string;
  webImageUrl: string;
  videoUrl: string;
  imageFocus: 'left' | 'center' | 'right';
  destType: AdDestinationType;
  destTarget: string;
  destUrl: string;
  destPhone: string;
  destLat: string;
  destLng: string;
  destLabel: string;
  detailEnabled: boolean;
  headline: string;
  coverUrl: string;
  gallery: string;
  detailVideo: string;
  body: string;
  features: string;
  priceText: string;
  offerText: string;
  address: string;
  detailLat: string;
  detailLng: string;
  phone: string;
  email: string;
  website: string;
  validUntil: string;
  placeId: string;
  listingType: '' | 'market_listing' | 'real_estate';
  listingId: string;
};

function defaultForm(): Form {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  return {
    advertiserId: '',
    name: '',
    campaignType: 'business_promo',
    policyCategory: 'general',
    priority: '5',
    startsAt: toLocalDateTime(start.toISOString()),
    endsAt: toLocalDateTime(end.toISOString()),
    dailyCap: '',
    totalCap: '',
    perUserDailyCap: '3',
    budget: '',
    cpm: '',
    districts: '',
    platforms: ['ios', 'android', 'web'],
    placements: [],
    title: '',
    description: '',
    ctaLabel: 'İncele',
    businessName: '',
    imageUrl: '',
    mobileImageUrl: '',
    webImageUrl: '',
    videoUrl: '',
    imageFocus: 'center',
    destType: 'detail_page',
    destTarget: '',
    destUrl: '',
    destPhone: '',
    destLat: '',
    destLng: '',
    destLabel: '',
    detailEnabled: true,
    headline: '',
    coverUrl: '',
    gallery: '',
    detailVideo: '',
    body: '',
    features: '',
    priceText: '',
    offerText: '',
    address: '',
    detailLat: '',
    detailLng: '',
    phone: '',
    email: '',
    website: '',
    validUntil: '',
    placeId: '',
    listingType: '',
    listingId: '',
  };
}

function fromCampaign(c: AdCampaignFull): Form {
  const base = defaultForm();
  const num = (v: number | null | undefined) => (v == null ? '' : String(v));
  return {
    ...base,
    advertiserId: c.advertiser_id,
    name: c.name,
    campaignType: c.campaign_type,
    policyCategory: c.policy_category,
    priority: String(c.priority),
    startsAt: toLocalDateTime(c.starts_at),
    endsAt: toLocalDateTime(c.ends_at),
    dailyCap: num(c.daily_impression_cap),
    totalCap: num(c.total_impression_cap),
    perUserDailyCap: String(c.per_user_daily_cap),
    budget: c.budget_cents == null ? '' : String(c.budget_cents / 100),
    cpm: c.cpm_cents == null ? '' : String(c.cpm_cents / 100),
    districts: c.target_districts.join(', '),
    platforms: c.platforms,
    placements: c.placements,
    title: c.creative?.title ?? '',
    description: c.creative?.description ?? '',
    ctaLabel: c.creative?.cta_label ?? 'İncele',
    businessName: c.creative?.business_name ?? '',
    imageUrl: c.creative?.image_url ?? '',
    mobileImageUrl: c.creative?.mobile_image_url ?? '',
    webImageUrl: c.creative?.web_image_url ?? '',
    videoUrl: c.creative?.video_url ?? '',
    imageFocus: c.creative?.image_focus ?? 'center',
    destType: c.destination?.type ?? 'detail_page',
    destTarget: c.destination?.target_id ?? '',
    destUrl: c.destination?.url ?? '',
    destPhone: c.destination?.phone ?? '',
    destLat: num(c.destination?.lat),
    destLng: num(c.destination?.lng),
    destLabel: c.destination?.label ?? '',
    detailEnabled: c.detail?.enabled ?? c.destination?.type === 'detail_page',
    headline: c.detail?.headline ?? '',
    coverUrl: c.detail?.cover_url ?? '',
    gallery: (c.detail?.gallery ?? []).join('\n'),
    detailVideo: c.detail?.video_url ?? '',
    body: c.detail?.body ?? '',
    features: (c.detail?.features ?? []).join('\n'),
    priceText: c.detail?.price_text ?? '',
    offerText: c.detail?.offer_text ?? '',
    address: c.detail?.address ?? '',
    detailLat: num(c.detail?.lat),
    detailLng: num(c.detail?.lng),
    phone: c.detail?.phone ?? '',
    email: c.detail?.email ?? '',
    website: c.detail?.website ?? '',
    validUntil: toLocalDateTime(c.detail?.valid_until),
    placeId: c.detail?.place_id ?? '',
    listingType: c.detail?.listing_type ?? '',
    listingId: c.detail?.listing_id ?? '',
  };
}

const intOrNull = (text: string) => {
  const value = Number.parseInt(text.replace(/\D/g, ''), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
};
const centsOrNull = (text: string) => {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
};
const floatOrNull = (text: string) => {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};
const lines = (text: string) =>
  text
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);

/** Kayıttan önce istemcide yakalanabilen sorunlar; sunucu aynı kuralları yeniden uygular. */
function clientIssues(form: Form): string[] {
  const issues: string[] = [];
  if (!form.advertiserId) issues.push('Reklamveren seçilmedi.');
  if (form.name.trim().length < 2) issues.push('Kampanya adı en az 2 karakter olmalı.');
  const start = parseLocalDateTime(form.startsAt);
  const end = parseLocalDateTime(form.endsAt);
  if (!start || !end) issues.push('Tarihler YYYY-AA-GG SS:DD biçiminde olmalı.');
  else if (new Date(end) <= new Date(start)) issues.push('Bitiş tarihi başlangıçtan sonra olmalı.');
  if (form.title.trim().length < 3) issues.push(adIssueLabel('title_missing'));
  if (form.title.length > 70) issues.push(adIssueLabel('title_too_long'));
  if (form.description.length > 140) issues.push(adIssueLabel('description_too_long'));
  if (!form.imageUrl.trim()) issues.push(adIssueLabel('media_missing'));
  if (form.platforms.length === 0) issues.push(adIssueLabel('platforms_missing'));
  if (form.placements.length === 0) issues.push(adIssueLabel('placements_missing'));
  const needs = DESTINATION_TYPES.find((item) => item.value === form.destType)?.needs;
  if (needs === 'target' && !/^[0-9a-f-]{36}$/i.test(form.destTarget.trim())) issues.push('Hedef kimliği (UUID) girilmeli.');
  if (needs === 'category' && !form.destTarget.trim()) issues.push('Kategori kısa adı (slug) girilmeli.');
  if (needs === 'url' && !/^https:\/\//i.test(form.destUrl.trim())) issues.push('Harici adres https ile başlamalı.');
  if (needs === 'phone' && !/^\+?[0-9]{10,13}$/.test(form.destPhone.replace(/[^\d+]/g, ''))) issues.push('Telefon numarası geçersiz.');
  if (needs === 'location' && (floatOrNull(form.destLat) == null || floatOrNull(form.destLng) == null)) issues.push('Harita konumu için enlem ve boylam girilmeli.');
  if (form.destType === 'detail_page' && !form.detailEnabled) issues.push('Detay sayfası yönlendirmesi için detay sayfası açık olmalı.');
  return issues;
}

function toPayload(form: Form): AdCampaignPayload {
  return {
    advertiser_id: form.advertiserId,
    name: form.name.trim(),
    campaign_type: form.campaignType,
    policy_category: form.policyCategory,
    priority: Math.max(1, Math.min(10, intOrNull(form.priority) ?? 5)),
    starts_at: parseLocalDateTime(form.startsAt) ?? '',
    ends_at: parseLocalDateTime(form.endsAt) ?? '',
    daily_impression_cap: intOrNull(form.dailyCap),
    total_impression_cap: intOrNull(form.totalCap),
    per_user_daily_cap: intOrNull(form.perUserDailyCap) ?? 3,
    budget_cents: centsOrNull(form.budget),
    cpm_cents: centsOrNull(form.cpm),
    target_districts: form.districts
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    platforms: form.platforms,
    placements: form.placements,
    creative: {
      title: form.title.trim(),
      description: form.description.trim() || null,
      cta_label: form.ctaLabel.trim() || 'İncele',
      business_name: form.businessName.trim() || null,
      image_url: form.imageUrl.trim() || null,
      mobile_image_url: form.mobileImageUrl.trim() || null,
      web_image_url: form.webImageUrl.trim() || null,
      video_url: form.videoUrl.trim() || null,
      image_focus: form.imageFocus,
    },
    destination: {
      type: form.destType,
      target_id: form.destTarget.trim() || null,
      url: form.destUrl.trim() || null,
      phone: form.destPhone.trim() || null,
      lat: floatOrNull(form.destLat),
      lng: floatOrNull(form.destLng),
      label: form.destLabel.trim() || null,
    },
    detail: {
      enabled: form.detailEnabled,
      headline: form.headline.trim() || null,
      cover_url: form.coverUrl.trim() || null,
      gallery: lines(form.gallery),
      video_url: form.detailVideo.trim() || null,
      body: form.body.trim() || null,
      features: lines(form.features),
      price_text: form.priceText.trim() || null,
      offer_text: form.offerText.trim() || null,
      address: form.address.trim() || null,
      lat: floatOrNull(form.detailLat),
      lng: floatOrNull(form.detailLng),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      website: form.website.trim() || null,
      valid_until: form.validUntil.trim() ? parseLocalDateTime(form.validUntil) : null,
      place_id: form.placeId.trim() || null,
      listing_type: form.listingType || null,
      listing_id: form.listingId.trim() || null,
    },
  };
}

export function AdCampaignEditor({
  visible,
  campaignId,
  canManage,
  onClose,
  onSaved,
}: {
  visible: boolean;
  campaignId: string | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const { width } = useWindowDimensions();
  const wide = width >= 1100;
  const existing = useAdCampaign(visible ? campaignId : null);
  const advertisers = useAdAdvertisers('', 0, 100);
  const placements = useAdPlacements();
  const targeting = useAdsTargeting(visible);
  const save = useAdCampaignSave();
  const transition = useAdCampaignTransition();
  const [form, setForm] = useState<Form>(defaultForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [serverIssues, setServerIssues] = useState<string[]>([]);

  const loadedKey = campaignId ? (existing.data ? `${campaignId}:${existing.data.updated_at ?? ''}` : null) : 'new';
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible || loadedKey == null) return;
    setForm(campaignId && existing.data ? fromCampaign(existing.data) : defaultForm());
    setErrors([]);
    setServerIssues(campaignId && existing.data ? existing.data.issues : []);
    // Form yalnızca editör açıldığında veya kampanya yüklendiğinde doldurulur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, loadedKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const locked = existing.data ? ['expired', 'archived'].includes(existing.data.status) : false;
  const destNeeds = DESTINATION_TYPES.find((item) => item.value === form.destType)?.needs ?? 'none';
  const districtSuggestions = useMemo(
    () => (targeting.data?.profile_districts ?? []).slice(0, 14).map((item) => item.district),
    [targeting.data],
  );

  const persist = async (submit: boolean) => {
    const issues = clientIssues(form);
    if (issues.length) {
      setErrors(issues);
      return;
    }
    setErrors([]);
    try {
      const saved = await save.mutateAsync({ id: campaignId, payload: toPayload(form) });
      setServerIssues(saved.issues);
      if (submit) {
        if (saved.issues.length) {
          toast.error('Kampanya kaydedildi ancak yayına hazır değil. Sorunları giderin.');
          return;
        }
        if (['draft', 'rejected'].includes(saved.status)) {
          await transition.mutateAsync({ id: saved.id, action: 'submit' });
        }
        onSaved('Kampanya kaydedildi ve incelemeye gönderildi.');
        return;
      }
      onSaved(
        saved.status === 'pending_review' && existing.data?.status !== 'pending_review'
          ? 'Değişiklikler kaydedildi; kampanya yeniden incelemeye alındı.'
          : 'Kampanya kaydedildi.',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kampanya kaydedilemedi.');
    }
  };

  const preview = (
    <AdDevicePreview
      creative={{
        title: form.title,
        description: form.description,
        ctaLabel: form.ctaLabel,
        businessName: form.businessName,
        imageUrl: form.mobileImageUrl.trim() || form.imageUrl.trim() || null,
        imageFocus: form.imageFocus,
      }}
    />
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="h3">{campaignId ? 'Kampanyayı düzenle' : 'Yeni Reklam Oluştur'}</AppText>
              <AppText variant="caption" color="textTertiary">
                Doğrudan (Trabzone) kampanya · yönetici onayı olmadan yayına çıkmaz
              </AppText>
            </View>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>

          <View style={[styles.body, wide && styles.bodyWide]}>
            <ScrollView
              style={styles.flex}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.form}
            >
              {locked ? (
                <Notice tone="warning" text="Süresi dolan veya arşivlenen kampanya düzenlenemez." />
              ) : null}

              <Group title="Kampanya">
                <Label text="Reklamveren" />
                {advertisers.data?.items.length ? (
                  <ChipSelect
                    options={advertisers.data.items
                      .filter((item) => item.status === 'active' || item.id === form.advertiserId)
                      .map((item) => ({ value: item.id, label: item.name }))}
                    value={form.advertiserId}
                    onChange={(value) => set('advertiserId', value)}
                  />
                ) : (
                  <Notice tone="warning" text="Önce Reklamverenler bölümünden bir reklamveren ekleyin." />
                )}
                <TextField label="Kampanya adı (iç kullanım)" value={form.name} onChangeText={(v) => set('name', v)} maxLength={120} />
                <Label text="Kampanya türü" />
                <ChipSelect options={CAMPAIGN_TYPES} value={form.campaignType} onChange={(v) => set('campaignType', v)} />
                <Label text="Politika kategorisi" />
                <ChipSelect options={POLICY_CATEGORIES} value={form.policyCategory} onChange={(v) => set('policyCategory', v)} />
                <AppText variant="caption" color="textTertiary">
                  Kabul edilmeyen: {PROHIBITED_CATEGORIES.join(', ')}.
                </AppText>
                <Row>
                  <TextField label="Başlangıç" value={form.startsAt} onChangeText={(v) => set('startsAt', v)} placeholder="2026-11-01 09:00" autoCapitalize="none" />
                  <TextField label="Bitiş" value={form.endsAt} onChangeText={(v) => set('endsAt', v)} placeholder="2026-11-30 23:59" autoCapitalize="none" />
                  <TextField label="Öncelik (1–10)" value={form.priority} onChangeText={(v) => set('priority', v)} keyboardType="number-pad" />
                </Row>
                <AppText variant="caption" color="textTertiary">
                  Yayın takvimi sunucu saatine göre uygulanır; cihaz saati dikkate alınmaz.
                </AppText>
              </Group>

              <Group title="Limitler ve bütçe">
                <Row>
                  <TextField label="Günlük gösterim sınırı" value={form.dailyCap} onChangeText={(v) => set('dailyCap', v)} keyboardType="number-pad" placeholder="Sınırsız" />
                  <TextField label="Toplam gösterim sınırı" value={form.totalCap} onChangeText={(v) => set('totalCap', v)} keyboardType="number-pad" placeholder="Sınırsız" />
                  <TextField label="Kullanıcı başına günlük" value={form.perUserDailyCap} onChangeText={(v) => set('perUserDailyCap', v)} keyboardType="number-pad" hint="1–10 arası" />
                </Row>
                <Row>
                  <TextField label="Bütçe (₺)" value={form.budget} onChangeText={(v) => set('budget', v)} keyboardType="decimal-pad" placeholder="Sınırsız" />
                  <TextField label="BGBM / CPM (₺)" value={form.cpm} onChangeText={(v) => set('cpm', v)} keyboardType="decimal-pad" placeholder="Ücretsiz" hint="1000 gösterim başına" />
                </Row>
              </Group>

              <Group title="Hedefleme ve yerleşimler">
                <TextField
                  label="Hedef ilçeler (virgülle; boş = tüm Trabzon)"
                  value={form.districts}
                  onChangeText={(v) => set('districts', v)}
                  placeholder="Ortahisar, Akçaabat"
                  hint="Kullanıcının profilde seçtiği ilçe veya ekrandaki ilçe filtresi kullanılır; kesin konum istenmez."
                />
                {districtSuggestions.length ? (
                  <ChipSelect
                    multiple
                    options={districtSuggestions.map((name) => ({ value: name, label: name }))}
                    values={form.districts.split(',').map((item) => item.trim()).filter(Boolean)}
                    onToggle={(name) => {
                      const current = form.districts.split(',').map((item) => item.trim()).filter(Boolean);
                      set('districts', toggle(current, name).join(', '));
                    }}
                  />
                ) : null}
                <Label text="Platformlar" />
                <ChipSelect multiple options={PLATFORMS} values={form.platforms} onToggle={(v) => set('platforms', toggle(form.platforms, v))} />
                <Label text="Yerleşimler" />
                <ChipSelect
                  multiple
                  options={(placements.data ?? [])
                    .filter((item) => item.supported_formats.includes('glass_banner'))
                    .map((item) => ({
                      value: item.key,
                      label: `${item.label_tr}${item.surface_status === 'reserved' ? ' (hazırlık)' : item.enabled ? '' : ' (kapalı)'}`,
                    }))}
                  values={form.placements}
                  onToggle={(v) => set('placements', toggle(form.placements, v))}
                />
                <AppText variant="caption" color="textTertiary">
                  Kapalı yerleşimlerde reklam gösterilmez; yerleşimi Yerleşimler bölümünden yönetici açar.
                </AppText>
              </Group>

              <Group title="Banner içeriği">
                <TextField label="Başlık" value={form.title} onChangeText={(v) => set('title', v)} maxLength={70} hint={`${form.title.length}/70`} />
                <TextField label="Kısa açıklama" value={form.description} onChangeText={(v) => set('description', v)} maxLength={140} hint={`${form.description.length}/140`} />
                <Row>
                  <TextField label="Buton metni" value={form.ctaLabel} onChangeText={(v) => set('ctaLabel', v)} maxLength={24} />
                  <TextField label="İşletme adı" value={form.businessName} onChangeText={(v) => set('businessName', v)} maxLength={60} />
                </Row>
                <Label text="Görsel odağı (kırpma ve konumlandırma)" />
                <ChipSelect
                  options={[
                    { value: 'left', label: 'Sol' },
                    { value: 'center', label: 'Orta' },
                    { value: 'right', label: 'Sağ' },
                  ]}
                  value={form.imageFocus}
                  onChange={(v) => set('imageFocus', v as Form['imageFocus'])}
                />
                <AdMediaField label="Banner görseli (zorunlu)" value={form.imageUrl} onChange={(v) => set('imageUrl', v)} variant="banner" crop focus={form.imageFocus} hint="Önerilen 1500×500 (3:1). Metin sol tarafta okunur." />
                <AdMediaField label="Mobil görsel (opsiyonel)" value={form.mobileImageUrl} onChange={(v) => set('mobileImageUrl', v)} variant="mobile" crop focus={form.imageFocus} />
                <AdMediaField label="Web görseli (opsiyonel)" value={form.webImageUrl} onChange={(v) => set('webImageUrl', v)} variant="web" crop focus={form.imageFocus} hint="Geniş ekranlar için 1920×600 önerilir." />
              </Group>

              <Group title="Yönlendirme">
                <ChipSelect
                  options={DESTINATION_TYPES.map((item) => ({ value: item.value, label: item.label }))}
                  value={form.destType}
                  onChange={(v) => {
                    set('destType', v);
                    if (v === 'detail_page') set('detailEnabled', true);
                  }}
                />
                {destNeeds === 'target' ? (
                  <TextField label="Hedef kimliği (UUID)" value={form.destTarget} onChangeText={(v) => set('destTarget', v)} autoCapitalize="none" hint="Hedef yayında değilse reklam otomatik olarak uygunsuz sayılır." />
                ) : null}
                {destNeeds === 'category' ? (
                  <TextField label="Kategori kısa adı (slug)" value={form.destTarget} onChangeText={(v) => set('destTarget', v)} autoCapitalize="none" placeholder="vasita" />
                ) : null}
                {destNeeds === 'url' ? (
                  <TextField label="Web adresi (https)" value={form.destUrl} onChangeText={(v) => set('destUrl', v)} autoCapitalize="none" hint="İzin verilen alan adı listesi Sistem Ayarları'ndan yönetilir." />
                ) : null}
                {destNeeds === 'phone' ? (
                  <TextField label="Telefon" value={form.destPhone} onChangeText={(v) => set('destPhone', v)} keyboardType="phone-pad" placeholder="+90462…" />
                ) : null}
                {destNeeds === 'location' ? (
                  <Row>
                    <TextField label="Enlem" value={form.destLat} onChangeText={(v) => set('destLat', v)} keyboardType="decimal-pad" placeholder="41.0027" />
                    <TextField label="Boylam" value={form.destLng} onChangeText={(v) => set('destLng', v)} keyboardType="decimal-pad" placeholder="39.7168" />
                    <TextField label="Konum etiketi" value={form.destLabel} onChangeText={(v) => set('destLabel', v)} />
                  </Row>
                ) : null}
              </Group>

              <Group title="Reklam detay sayfası">
                <ToggleRow
                  title="Detay sayfası yayında"
                  description="Boş bırakılan alanlar kullanıcıya gösterilmez."
                  value={form.detailEnabled}
                  onValueChange={(v) => set('detailEnabled', v)}
                />
                {form.detailEnabled ? (
                  <>
                    <TextField label="Sayfa başlığı" value={form.headline} onChangeText={(v) => set('headline', v)} maxLength={140} placeholder={form.title} />
                    <AdMediaField label="Kapak görseli" value={form.coverUrl} onChange={(v) => set('coverUrl', v)} variant="cover" />
                    <TextField label="Galeri adresleri (her satıra bir https adresi, en fazla 12)" value={form.gallery} onChangeText={(v) => set('gallery', v)} multiline autoCapitalize="none" />
                    <AdMediaField label="Galeriye görsel ekle" value="" onChange={(v) => v && set('gallery', [...lines(form.gallery), v].join('\n'))} variant="gallery" />
                    <AdMediaField label="Tanıtım videosu (opsiyonel)" value={form.detailVideo} onChange={(v) => set('detailVideo', v)} variant="video" />
                    <TextField label="Açıklama" value={form.body} onChangeText={(v) => set('body', v)} multiline maxLength={5000} />
                    <TextField label="Öne çıkan özellikler (her satıra bir madde)" value={form.features} onChangeText={(v) => set('features', v)} multiline />
                    <Row>
                      <TextField label="Fiyat" value={form.priceText} onChangeText={(v) => set('priceText', v)} maxLength={80} />
                      <TextField label="Kampanya / indirim" value={form.offerText} onChangeText={(v) => set('offerText', v)} maxLength={200} />
                      <TextField label="Son geçerlilik" value={form.validUntil} onChangeText={(v) => set('validUntil', v)} placeholder="2026-12-31 23:59" autoCapitalize="none" />
                    </Row>
                    <TextField label="Adres" value={form.address} onChangeText={(v) => set('address', v)} maxLength={240} />
                    <Row>
                      <TextField label="Harita enlemi" value={form.detailLat} onChangeText={(v) => set('detailLat', v)} keyboardType="decimal-pad" />
                      <TextField label="Harita boylamı" value={form.detailLng} onChangeText={(v) => set('detailLng', v)} keyboardType="decimal-pad" />
                    </Row>
                    <Row>
                      <TextField label="Telefon" value={form.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" />
                      <TextField label="E-posta" value={form.email} onChangeText={(v) => set('email', v)} autoCapitalize="none" />
                      <TextField label="Web sitesi (https)" value={form.website} onChangeText={(v) => set('website', v)} autoCapitalize="none" />
                    </Row>
                    <TextField label="İşletme profili kimliği (UUID)" value={form.placeId} onChangeText={(v) => set('placeId', v)} autoCapitalize="none" />
                    <Label text="Bağlı ilan" />
                    <ChipSelect
                      options={[
                        { value: '', label: 'Yok' },
                        { value: 'market_listing', label: 'Marketplace ilanı' },
                        { value: 'real_estate', label: 'Emlak ilanı' },
                      ]}
                      value={form.listingType}
                      onChange={(v) => set('listingType', v as Form['listingType'])}
                    />
                    {form.listingType ? (
                      <TextField label="İlan kimliği (UUID)" value={form.listingId} onChangeText={(v) => set('listingId', v)} autoCapitalize="none" />
                    ) : null}
                  </>
                ) : null}
              </Group>

              {!wide ? <Group title="Mobil önizleme">{preview}</Group> : null}

              {errors.length ? <IssueList title="Kaydetmeden önce düzeltin" items={errors} tone="danger" /> : null}
              {serverIssues.length ? (
                <IssueList title="Yayın öncesi doğrulama" items={serverIssues.map(adIssueLabel)} tone="warning" />
              ) : null}
            </ScrollView>

            {wide ? (
              <ScrollView style={[styles.previewPane, { borderColor: theme.colors.divider }]} contentContainerStyle={styles.form}>
                <AppText variant="title">Mobil önizleme</AppText>
                {preview}
              </ScrollView>
            ) : null}
          </View>

          <View style={[styles.footer, { borderColor: theme.colors.divider }]}>
            <Button label="Vazgeç" size="sm" variant="secondary" fullWidth={false} onPress={onClose} />
            <Button
              label="Taslak olarak kaydet"
              size="sm"
              variant="outline"
              fullWidth={false}
              disabled={!canManage || locked}
              loading={save.isPending && !transition.isPending}
              onPress={() => void persist(false)}
            />
            <Button
              label="Kaydet ve incelemeye gönder"
              size="sm"
              fullWidth={false}
              disabled={!canManage || locked}
              loading={transition.isPending}
              leftIcon={<Ionicons name="send-outline" size={14} color={theme.colors.onPrimary} />}
              onPress={() => void persist(true)}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.group, { borderColor: theme.colors.border }]}>
      <AppText variant="title">{title}</AppText>
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      {(Array.isArray(children) ? children : [children]).map((child, index) => (
        <View key={index} style={styles.cell}>
          {child}
        </View>
      ))}
    </View>
  );
}

function Label({ text }: { text: string }) {
  return (
    <AppText variant="caption" color="textTertiary">
      {text}
    </AppText>
  );
}

function Notice({ text, tone }: { text: string; tone: 'warning' | 'danger' }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: tone === 'warning' ? theme.colors.warningSoft : theme.colors.dangerSoft }]}>
      <Ionicons name="alert-circle-outline" size={16} color={tone === 'warning' ? theme.colors.warning : theme.colors.danger} />
      <AppText variant="caption" color={tone} style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

function IssueList({ title, items, tone }: { title: string; items: string[]; tone: 'warning' | 'danger' }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.notice, styles.issueList, { backgroundColor: tone === 'warning' ? theme.colors.warningSoft : theme.colors.dangerSoft }]}>
      <AppText variant="label" color={tone}>
        {title}
      </AppText>
      {items.map((item) => (
        <AppText key={item} variant="caption" color={tone}>
          • {item}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  panel: {
    width: '100%',
    maxWidth: 1280,
    height: '94%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  panelHead: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  body: { flex: 1 },
  bodyWide: { flexDirection: 'row' },
  form: { padding: 16, gap: 14 },
  previewPane: { maxWidth: 500, borderLeftWidth: StyleSheet.hairlineWidth },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexGrow: 1, flexBasis: 180, minWidth: 160 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  issueList: { flexDirection: 'column', alignItems: 'flex-start', gap: 3 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
