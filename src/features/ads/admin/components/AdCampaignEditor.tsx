import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { AppText, Badge, Button, IconButton, TextField } from '@/components/ui';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { ChipSelect, ToggleRow } from '@/features/admin/components/news-api/shared';
import { useTheme } from '@/theme/ThemeProvider';

import type { AdDestinationType, AdPlacementKey, AdPlatform } from '../../types';
import {
  useAdAdvertiserSave,
  useAdAdvertisers,
  useAdCampaign,
  useAdCampaignSave,
  useAdCampaignTransition,
  useAdPlacements,
} from '../hooks';
import {
  AD_STEPS,
  AD_TEMPLATES,
  CAMPAIGN_TYPES,
  DESTINATION_TYPES,
  PLACEMENT_GROUPS,
  PLATFORMS,
  POLICY_CATEGORIES,
  PROHIBITED_CATEGORIES,
  parseLocalDateTime,
  toLocalDateTime,
} from '../labels';
import {
  formatTargetLabel,
  locationCoords,
  nearestDistrict,
} from '../locations';
import { adIssueLabel } from '../service';
import type { AdCampaignFull, AdCampaignPayload, AdPlacementRow } from '../types';
import { AdDevicePreview } from './AdDevicePreview';
import { AdMediaField } from './AdMediaField';
import { LocationPicker, type LocationValue } from './LocationPicker';

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
  cities: string[];
  districts: string[];
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
  destCity: string;
  destDistrict: string;
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
  detailCity: string;
  detailDistrict: string;
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
    cities: ['Trabzon'],
    districts: [],
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
    destCity: 'Trabzon',
    destDistrict: '',
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
    detailCity: 'Trabzon',
    detailDistrict: '',
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
  const cities = c.target_cities?.length
    ? c.target_cities
    : c.target_districts?.length
      ? ['Trabzon']
      : [];
  const targetCity = cities[0] ?? 'Trabzon';
  const destDistrict = nearestDistrict(targetCity, c.destination?.lat ?? null, c.destination?.lng ?? null);
  const detailDistrict = nearestDistrict(targetCity, c.detail?.lat ?? null, c.detail?.lng ?? null);
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
    cities,
    districts: c.target_districts ?? [],
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
    destCity: destDistrict ? targetCity : c.destination?.lat != null ? targetCity : base.destCity,
    destDistrict: destDistrict?.name ?? '',
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
    detailCity: detailDistrict ? targetCity : c.detail?.lat != null ? targetCity : base.detailCity,
    detailDistrict: detailDistrict?.name ?? '',
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

function destinationNeeds(type: AdDestinationType) {
  return DESTINATION_TYPES.find((item) => item.value === type)?.needs ?? 'none';
}

function destinationCoords(form: Form): { lat: number | null; lng: number | null } {
  const derived = locationCoords(form.destCity, form.destDistrict);
  if (derived) {
    return derived;
  }
  return { lat: floatOrNull(form.destLat), lng: floatOrNull(form.destLng) };
}

function detailCoords(form: Form): { lat: number | null; lng: number | null } {
  const derived = locationCoords(form.detailCity, form.detailDistrict);
  if (derived) {
    return derived;
  }
  return { lat: floatOrNull(form.detailLat), lng: floatOrNull(form.detailLng) };
}

/** Adım bazlı eksikler: kullanıcı ilerlerken nerede takıldığını görür. */
function stepIssues(form: Form, step: number): string[] {
  const issues: string[] = [];
  if (step === 0) {
    if (!form.advertiserId) issues.push('Reklamveren seçilmedi.');
    if (form.name.trim().length < 2) issues.push('Kampanya adı en az 2 karakter olmalı.');
    if (!form.campaignType) issues.push('Kampanya türü seçilmedi.');
    return issues;
  }
  if (step === 1) {
    const start = parseLocalDateTime(form.startsAt);
    const end = parseLocalDateTime(form.endsAt);
    if (!start || !end) issues.push('Tarihler YYYY-AA-GG SS:DD biçiminde olmalı.');
    else if (new Date(end) <= new Date(start)) issues.push('Bitiş tarihi başlangıçtan sonra olmalı.');
    if (form.platforms.length === 0) issues.push(adIssueLabel('platforms_missing'));
    if (form.placements.length === 0) issues.push(adIssueLabel('placements_missing'));
    return issues;
  }
  if (step === 2) {
    if (form.title.trim().length < 3) issues.push(adIssueLabel('title_missing'));
    if (form.title.length > 70) issues.push(adIssueLabel('title_too_long'));
    if (form.description.length > 140) issues.push(adIssueLabel('description_too_long'));
    if (!form.imageUrl.trim()) issues.push(adIssueLabel('media_missing'));
    return issues;
  }
  const needs = destinationNeeds(form.destType);
  if (needs === 'target' && !/^[0-9a-f-]{36}$/i.test(form.destTarget.trim())) {
    issues.push('Seçilen yönlendirme için hedef kimliği (UUID) girilmeli.');
  }
  if (needs === 'category' && !form.destTarget.trim()) issues.push('Kategori kısa adı (slug) girilmeli.');
  if (needs === 'url' && !/^https:\/\//i.test(form.destUrl.trim())) issues.push('Web adresi https ile başlamalı.');
  if (needs === 'phone' && !/^\+?[0-9]{10,13}$/.test(form.destPhone.replace(/[^\d+]/g, ''))) {
    issues.push('Telefon numarası geçersiz.');
  }
  if (needs === 'location') {
    const coords = destinationCoords(form);
    if (coords.lat == null || coords.lng == null) issues.push('Harita konumu için şehir ve ilçe seçilmeli.');
  }
  if (form.destType === 'detail_page' && !form.detailEnabled) {
    issues.push('Detay sayfası yönlendirmesi için detay sayfası açık olmalı.');
  }
  return issues;
}

function firstStepWithIssues(form: Form): number {
  for (let step = 0; step < AD_STEPS.length; step += 1) {
    if (stepIssues(form, step).length > 0) {
      return step;
    }
  }
  return AD_STEPS.length - 1;
}

function allIssues(form: Form): string[] {
  return AD_STEPS.flatMap((_, step) => stepIssues(form, step));
}

function toPayload(form: Form): AdCampaignPayload {
  const dest = destinationCoords(form);
  const detail = detailCoords(form);
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
    target_cities: form.cities,
    target_districts: form.districts,
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
      lat: dest.lat,
      lng: dest.lng,
      label: form.destLabel.trim() || form.destDistrict.trim() || form.destCity.trim() || null,
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
      lat: detail.lat,
      lng: detail.lng,
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

const DESTINATION_ICONS: Record<AdDestinationType, React.ComponentProps<typeof Ionicons>['name']> = {
  detail_page: 'document-text-outline',
  external_url: 'globe-outline',
  phone: 'call-outline',
  map_location: 'map-outline',
  business: 'storefront-outline',
  market_listing: 'pricetags-outline',
  real_estate: 'home-outline',
  vehicle: 'car-outline',
  job: 'briefcase-outline',
  ride: 'navigate-circle-outline',
  post: 'chatbubble-ellipses-outline',
  category: 'grid-outline',
};

function addDays(value: string, days: number): string {
  const iso = parseLocalDateTime(value);
  const base = iso ? new Date(iso) : new Date();
  base.setDate(base.getDate() + days);
  return toLocalDateTime(base.toISOString());
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
  const save = useAdCampaignSave();
  const transition = useAdCampaignTransition();
  const saveAdvertiser = useAdAdvertiserSave();
  const [form, setForm] = useState<Form>(defaultForm);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [advancedMedia, setAdvancedMedia] = useState(false);
  const [advancedBudget, setAdvancedBudget] = useState(false);
  const [detailAdvanced, setDetailAdvanced] = useState(false);
  const [newAdvertiserOpen, setNewAdvertiserOpen] = useState(false);
  const [advertiserDraft, setAdvertiserDraft] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '' });

  const loadedKey = campaignId ? (existing.data ? `${campaignId}:${existing.data.updated_at ?? ''}` : null) : 'new';
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible || loadedKey == null) return;
    setForm(campaignId && existing.data ? fromCampaign(existing.data) : defaultForm());
    setStep(0);
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
  const needs = destinationNeeds(form.destType);
  const status = existing.data?.status ?? 'draft';
  const canSubmit = ['draft', 'rejected'].includes(status);

  const groupedPlacements = useMemo(() => {
    const groups = new Map<string, AdPlacementRow[]>();
    for (const item of placements.data ?? []) {
      if (!item.supported_formats.includes('glass_banner')) continue;
      const key = item.group_key || 'other';
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [placements.data]);

  const advertiserOptions = (advertisers.data?.items ?? [])
    .filter((item) => item.status === 'active' || item.id === form.advertiserId)
    .map((item) => ({ value: item.id, label: item.name }));

  const stepErrors = stepIssues(form, step);
  const totalIssues = allIssues(form);
  const targetCityHint = form.cities.length === 0 ? 'Tüm şehirler' : formatTargetLabel(form.cities, form.districts);

  const applyTemplate = (key: string) => {
    const template = AD_TEMPLATES.find((item) => item.key === key);
    if (!template) return;
    setForm((prev) => ({
      ...prev,
      campaignType: template.campaignType,
      policyCategory: template.policyCategory,
      title: template.title,
      description: template.description,
      ctaLabel: template.ctaLabel,
      name: prev.name.trim() ? prev.name : `${template.label} · ${new Date().toLocaleDateString('tr-TR')}`,
    }));
  };

  const changeLocation = (value: LocationValue) => {
    setForm((prev) => ({
      ...prev,
      cities: value.cities,
      districts: value.districts,
      destCity: value.cities[0] ?? prev.destCity,
      detailCity: value.cities[0] ?? prev.detailCity,
      destLat: '',
      destLng: '',
      detailLat: '',
      detailLng: '',
    }));
  };

  const goNext = () => {
    if (stepErrors.length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors([]);
    setStep((value) => Math.min(value + 1, AD_STEPS.length - 1));
  };

  const persist = async (submit: boolean) => {
    const issues = allIssues(form);
    if (issues.length) {
      setErrors(issues);
      setStep(firstStepWithIssues(form));
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

  const createAdvertiser = async () => {
    if (advertiserDraft.name.trim().length < 2) {
      toast.error('Reklamveren adı en az 2 karakter olmalı.');
      return;
    }
    try {
      const created = await saveAdvertiser.mutateAsync({
        id: null,
        payload: {
          name: advertiserDraft.name.trim(),
          contact_name: advertiserDraft.contact_name.trim() || null,
          contact_email: advertiserDraft.contact_email.trim() || null,
          contact_phone: advertiserDraft.contact_phone.trim() || null,
          status: 'active',
        },
      });
      set('advertiserId', created.id);
      setNewAdvertiserOpen(false);
      setAdvertiserDraft({ name: '', contact_name: '', contact_email: '', contact_phone: '' });
      toast.success('Reklamveren eklendi ve seçildi.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Reklamveren eklenemedi.');
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

  const summary = (
    <View style={[styles.summaryCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}>
      <View style={styles.summaryHead}>
        <AppText variant="label">Kampanya özeti</AppText>
        <Badge
          label={status === 'draft' ? 'Taslak' : status === 'pending_review' ? 'İncelemede' : status === 'active' ? 'Aktif' : status}
          tone={status === 'active' ? 'success' : status === 'pending_review' ? 'warning' : 'neutral'}
        />
      </View>
      <SummaryRow icon="storefront-outline" label="Reklamveren" value={advertiserOptions.find((item) => item.value === form.advertiserId)?.label ?? 'Seçilmedi'} />
      <SummaryRow icon="location-outline" label="Yayın bölgesi" value={targetCityHint} />
      <SummaryRow icon="calendar-outline" label="Tarih" value={`${form.startsAt} → ${form.endsAt}`} />
      <SummaryRow
        icon="albums-outline"
        label="Yerleşim"
        value={form.placements.length ? `${form.placements.length} yerleşim seçildi` : 'Seçilmedi'}
      />
      <SummaryRow
        icon="navigate-outline"
        label="Tıklanınca"
        value={DESTINATION_TYPES.find((item) => item.value === form.destType)?.label ?? form.destType}
      />
      <View style={[styles.checklist, { borderColor: theme.colors.border }]}>
        <ChecklistRow done={Boolean(form.advertiserId)} text="Reklamveren" />
        <ChecklistRow done={form.platforms.length > 0 && form.placements.length > 0} text="Yerleşim ve platform" />
        <ChecklistRow done={form.title.trim().length >= 3 && Boolean(form.imageUrl)} text="Banner görseli ve başlık" />
        <ChecklistRow done={stepIssues(form, 3).length === 0} text="Yönlendirme" />
      </View>
      {totalIssues.length ? (
        <AppText variant="caption" color="warning">
          {totalIssues.length} eksik var. Tamamlamadan incelemeye gönderemezsin.
        </AppText>
      ) : (
        <AppText variant="caption" color="success">
          Her şey hazır. İncelemeye gönderebilirsin.
        </AppText>
      )}
    </View>
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
              <AppText variant="h3">{campaignId ? 'Reklamı düzenle' : 'Yeni reklam oluştur'}</AppText>
              <AppText variant="caption" color="textTertiary">
                Dört adımda hazırla · kaydettiğinde taslakta kalır, “İncelemeye gönder” ile yayına alınır
              </AppText>
            </View>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.stepRail, { borderColor: theme.colors.divider }]}
            contentContainerStyle={styles.stepRailContent}
          >
            {AD_STEPS.map((item, index) => {
              const active = index === step;
              const done = index < step;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    if (index > step && stepIssues(form, step).length > 0) {
                      setErrors(stepIssues(form, step));
                      return;
                    }
                    setStep(index);
                    setErrors([]);
                  }}
                  style={[
                    styles.step,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.stepIndex,
                      {
                        backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted,
                      },
                    ]}
                  >
                    {done && !active ? (
                      <Ionicons name="checkmark" size={12} color={theme.colors.success} />
                    ) : (
                      <AppText variant="caption" color={active ? 'textInverse' : 'textSecondary'}>
                        {index + 1}
                      </AppText>
                    )}
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="caption" color={active ? 'primaryDeep' : 'text'} style={styles.bold}>
                      {item.title}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {item.description}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.body, wide && styles.bodyWide]}>
            <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              {locked ? (
                <Notice tone="warning" text="Süresi dolan veya arşivlenen kampanya düzenlenemez." />
              ) : null}

              {step === 0 ? (
                <>
                  <Group title="Hızlı başlangıç" hint="Hazır şablonlardan birini seç; metinleri sonra düzenleyebilirsin.">
                    <View style={styles.quickRow}>
                      {AD_TEMPLATES.map((template) => (
                        <Pressable
                          key={template.key}
                          accessibilityRole="button"
                          accessibilityLabel={template.label}
                          onPress={() => applyTemplate(template.key)}
                          style={({ pressed }) => [
                            styles.quickChip,
                            {
                              borderColor: theme.colors.border,
                              backgroundColor: pressed ? theme.colors.primarySoft : theme.colors.inputBackground,
                            },
                          ]}
                        >
                          <Ionicons name={template.icon as never} size={15} color={theme.colors.primaryDeep} />
                          <AppText variant="caption" color="text">
                            {template.label}
                          </AppText>
                        </Pressable>
                      ))}
                    </View>
                  </Group>

                  <Group title="Reklamveren" hint="Reklamın kimin adına yayınlanacağını seç.">
                    {advertiserOptions.length ? (
                      <ChipSelect
                        options={advertiserOptions}
                        value={form.advertiserId}
                        onChange={(value) => set('advertiserId', value)}
                      />
                    ) : (
                      <Notice
                        tone="warning"
                        text="Henüz reklamveren yok. Aşağıdaki formdan ekleyebilirsin; kampanyayı kaydetmek için reklamveren zorunlu."
                      />
                    )}
                    {newAdvertiserOpen ? (
                      <View style={[styles.subCard, { borderColor: theme.colors.border }]}>
                        <AppText variant="label">Yeni reklamveren</AppText>
                        <TextField
                          label="Görünen ad"
                          value={advertiserDraft.name}
                          onChangeText={(value) => setAdvertiserDraft((prev) => ({ ...prev, name: value }))}
                          placeholder="Örn. Karadeniz Kahve"
                          maxLength={120}
                        />
                        <Row>
                          <TextField
                            label="Yetkili"
                            value={advertiserDraft.contact_name}
                            onChangeText={(value) => setAdvertiserDraft((prev) => ({ ...prev, contact_name: value }))}
                          />
                          <TextField
                            label="E-posta"
                            value={advertiserDraft.contact_email}
                            onChangeText={(value) => setAdvertiserDraft((prev) => ({ ...prev, contact_email: value }))}
                            autoCapitalize="none"
                            keyboardType="email-address"
                          />
                          <TextField
                            label="Telefon"
                            value={advertiserDraft.contact_phone}
                            onChangeText={(value) => setAdvertiserDraft((prev) => ({ ...prev, contact_phone: value }))}
                            keyboardType="phone-pad"
                          />
                        </Row>
                        <View style={styles.actions}>
                          <Button
                            label="Reklamvereni ekle"
                            size="sm"
                            fullWidth={false}
                            loading={saveAdvertiser.isPending}
                            onPress={() => void createAdvertiser()}
                          />
                          <Button
                            label="Vazgeç"
                            size="sm"
                            variant="ghost"
                            fullWidth={false}
                            onPress={() => setNewAdvertiserOpen(false)}
                          />
                        </View>
                      </View>
                    ) : (
                      <Button
                        label="Listede yok mu? Yeni reklamveren ekle"
                        size="sm"
                        variant="ghost"
                        fullWidth={false}
                        leftIcon={<Ionicons name="add" size={14} color={theme.colors.text} />}
                        onPress={() => setNewAdvertiserOpen(true)}
                      />
                    )}
                  </Group>

                  <Group title="Kampanya bilgisi" hint="Kampanya adı yalnızca yönetim panelinde görünür.">
                    <TextField
                      label="Kampanya adı"
                      value={form.name}
                      onChangeText={(value) => set('name', value)}
                      maxLength={120}
                      placeholder="Örn. Kasım indirimi"
                    />
                    <Label text="Kampanya türü" />
                    <ChipSelect options={CAMPAIGN_TYPES} value={form.campaignType} onChange={(value) => set('campaignType', value)} />
                    <Label text="İçerik kategorisi" />
                    <ChipSelect
                      options={POLICY_CATEGORIES}
                      value={form.policyCategory}
                      onChange={(value) => set('policyCategory', value)}
                    />
                    <AppText variant="caption" color="textTertiary">
                      Kabul edilmeyen içerikler: {PROHIBITED_CATEGORIES.join(', ')}.
                    </AppText>
                  </Group>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <Group title="Nerede gösterilsin?" hint="Şehir ve ilçe seç; koordinat girmene gerek yok.">
                    <LocationPicker cities={form.cities} districts={form.districts} onChange={changeLocation} disabled={locked} />
                  </Group>

                  <Group title="Hangi ekranlarda?" hint="Reklam yalnızca seçtiğin akışlarda görünür.">
                    {groupedPlacements.length === 0 ? (
                      <AppText variant="caption" color="textSecondary">
                        {placements.isLoading ? 'Yerleşimler yükleniyor…' : 'Açık bir yerleşim bulunamadı.'}
                      </AppText>
                    ) : (
                      groupedPlacements.map(([key, rows]) => (
                        <View key={key} style={styles.placementGroup}>
                          <AppText variant="caption" color="textTertiary">
                            {PLACEMENT_GROUPS[key] ?? key}
                          </AppText>
                          {rows.map((item) => {
                            const active = form.placements.includes(item.key);
                            const closed = !item.enabled || item.surface_status === 'reserved';
                            return (
                              <Pressable
                                key={item.key}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: active, disabled: closed }}
                                disabled={locked}
                                onPress={() => set('placements', toggle(form.placements, item.key))}
                                style={[
                                  styles.placementCard,
                                  {
                                    borderColor: active ? theme.colors.primary : theme.colors.border,
                                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                                    opacity: closed ? 0.6 : 1,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name={active ? 'checkbox' : 'square-outline'}
                                  size={18}
                                  color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
                                />
                                <View style={styles.flex}>
                                  <AppText variant="caption" color={active ? 'primaryDeep' : 'text'}>
                                    {item.label_tr}
                                  </AppText>
                                  {item.description_tr ? (
                                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                                      {item.description_tr}
                                    </AppText>
                                  ) : null}
                                </View>
                                {item.surface_status === 'reserved' ? (
                                  <Badge label="Hazırlık" tone="neutral" />
                                ) : !item.enabled ? (
                                  <Badge label="Kapalı" tone="neutral" />
                                ) : null}
                              </Pressable>
                            );
                          })}
                        </View>
                      ))
                    )}
                    <AppText variant="caption" color="textTertiary">
                      Kapalı yerleşimlerde reklam gösterilmez. Yerleşimi “Yerleşimler” bölümünden yönetici açar.
                    </AppText>
                  </Group>

                  <Group title="Cihazlar">
                    <ChipSelect
                      multiple
                      options={PLATFORMS}
                      values={form.platforms}
                      onToggle={(value) => set('platforms', toggle(form.platforms, value))}
                    />
                  </Group>

                  <Group title="Yayın takvimi" hint="Sunucu saati kullanılır; cihaz saati dikkate alınmaz.">
                    <Row>
                      <TextField
                        label="Başlangıç"
                        value={form.startsAt}
                        onChangeText={(value) => set('startsAt', value)}
                        placeholder="2026-11-01 09:00"
                        autoCapitalize="none"
                      />
                      <TextField
                        label="Bitiş"
                        value={form.endsAt}
                        onChangeText={(value) => set('endsAt', value)}
                        placeholder="2026-11-30 23:59"
                        autoCapitalize="none"
                      />
                    </Row>
                    <View style={styles.quickRow}>
                      {[7, 14, 30, 60].map((days) => (
                        <Pressable
                          key={days}
                          accessibilityRole="button"
                          accessibilityLabel={`${days} gün yayınla`}
                          onPress={() => set('endsAt', addDays(form.startsAt, days))}
                          style={[styles.quickChip, { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground }]}
                        >
                          <AppText variant="caption" color="text">
                            {days} gün
                          </AppText>
                        </Pressable>
                      ))}
                    </View>
                  </Group>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <Group title="Hazır metinler" hint="Bir şablon seçip üzerine yazabilirsin.">
                    <View style={styles.quickRow}>
                      {AD_TEMPLATES.map((template) => (
                        <Pressable
                          key={template.key}
                          accessibilityRole="button"
                          accessibilityLabel={template.label}
                          onPress={() => applyTemplate(template.key)}
                          style={[styles.quickChip, { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground }]}
                        >
                          <Ionicons name={template.icon as never} size={15} color={theme.colors.primaryDeep} />
                          <AppText variant="caption" color="text">
                            {template.label}
                          </AppText>
                        </Pressable>
                      ))}
                    </View>
                  </Group>

                  <Group title="Banner metni" hint="Kısa ve net tut; banner’da iki satırdan sonrası kesilir.">
                    <TextField
                      label="Başlık"
                      value={form.title}
                      onChangeText={(value) => set('title', value)}
                      maxLength={70}
                      hint={`${form.title.length}/70`}
                      placeholder="Örn. Hafta sonu kahve indirimi"
                    />
                    <TextField
                      label="Kısa açıklama"
                      value={form.description}
                      onChangeText={(value) => set('description', value)}
                      maxLength={140}
                      hint={`${form.description.length}/140`}
                      multiline
                      placeholder="Örn. Cumartesi ve pazar tüm sıcak içeceklerde %20 indirim."
                    />
                    <Row>
                      <TextField
                        label="Buton metni"
                        value={form.ctaLabel}
                        onChangeText={(value) => set('ctaLabel', value)}
                        maxLength={24}
                        placeholder="Fırsatı gör"
                      />
                      <TextField
                        label="İşletme adı"
                        value={form.businessName}
                        onChangeText={(value) => set('businessName', value)}
                        maxLength={60}
                        placeholder="Örn. Karadeniz Kahve"
                      />
                    </Row>
                    <Label text="Görsel odağı" />
                    <ChipSelect
                      options={[
                        { value: 'left', label: 'Sol' },
                        { value: 'center', label: 'Orta' },
                        { value: 'right', label: 'Sağ' },
                      ]}
                      value={form.imageFocus}
                      onChange={(value) => set('imageFocus', value as Form['imageFocus'])}
                    />
                  </Group>

                  <Group title="Banner görseli" hint="Yatay bir görsel yükle; metinlerin okunacağı alanı önizlemede kontrol et.">
                    <AdMediaField
                      label="Banner görseli (zorunlu)"
                      value={form.imageUrl}
                      onChange={(value) => set('imageUrl', value)}
                      variant="banner"
                      crop
                      focus={form.imageFocus}
                      hint="Önerilen 1500×500 (3:1)."
                      disabled={locked}
                    />
                    <Button
                      label={advancedMedia ? 'Gelişmiş görselleri kapat' : 'Mobil / web görseli ekle'}
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() => setAdvancedMedia((value) => !value)}
                    />
                    {advancedMedia ? (
                      <>
                        <AdMediaField
                          label="Mobil görsel (opsiyonel)"
                          value={form.mobileImageUrl}
                          onChange={(value) => set('mobileImageUrl', value)}
                          variant="mobile"
                          crop
                          focus={form.imageFocus}
                          disabled={locked}
                        />
                        <AdMediaField
                          label="Web görseli (opsiyonel)"
                          value={form.webImageUrl}
                          onChange={(value) => set('webImageUrl', value)}
                          variant="web"
                          crop
                          focus={form.imageFocus}
                          hint="Geniş ekranlar için 1920×600 önerilir."
                          disabled={locked}
                        />
                      </>
                    ) : null}
                  </Group>

                  {!wide ? <Group title="Önizleme">{preview}</Group> : null}
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <Group title="Tıklanınca ne olsun?" hint="Kullanıcı banner’a dokunduğunda açılacak yeri seç.">
                    <View style={styles.destinationGrid}>
                      {DESTINATION_TYPES.map((item) => {
                        const active = form.destType === item.value;
                        return (
                          <Pressable
                            key={item.value}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: active }}
                            disabled={locked}
                            onPress={() => {
                              set('destType', item.value);
                              if (item.value === 'detail_page') set('detailEnabled', true);
                            }}
                            style={[
                              styles.destinationCard,
                              {
                                borderColor: active ? theme.colors.primary : theme.colors.border,
                                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                              },
                            ]}
                          >
                            <Ionicons
                              name={DESTINATION_ICONS[item.value]}
                              size={17}
                              color={active ? theme.colors.primaryDeep : theme.colors.textSecondary}
                            />
                            <AppText variant="caption" color={active ? 'primaryDeep' : 'text'}>
                              {item.label}
                            </AppText>
                            <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                              {item.description}
                            </AppText>
                          </Pressable>
                        );
                      })}
                    </View>

                    {needs === 'target' ? (
                      <TextField
                        label="Hedef kimliği (UUID)"
                        value={form.destTarget}
                        onChangeText={(value) => set('destTarget', value)}
                        autoCapitalize="none"
                        hint="Hedef yayında değilse kampanya otomatik olarak uygunsuz sayılır."
                      />
                    ) : null}
                    {needs === 'category' ? (
                      <TextField
                        label="Kategori kısa adı (slug)"
                        value={form.destTarget}
                        onChangeText={(value) => set('destTarget', value)}
                        autoCapitalize="none"
                        placeholder="vasita"
                      />
                    ) : null}
                    {needs === 'url' ? (
                      <TextField
                        label="Web adresi (https)"
                        value={form.destUrl}
                        onChangeText={(value) => set('destUrl', value)}
                        autoCapitalize="none"
                        placeholder="https://ornek.com/kampanya"
                        hint="Alan adı Sistem Ayarları’ndaki izin listesiyle denetlenir."
                      />
                    ) : null}
                    {needs === 'phone' ? (
                      <TextField
                        label="Telefon"
                        value={form.destPhone}
                        onChangeText={(value) => set('destPhone', value)}
                        keyboardType="phone-pad"
                        placeholder="+904621234567"
                      />
                    ) : null}
                    {needs === 'location' ? (
                      <LocationPicker
                        cities={form.destCity ? [form.destCity] : []}
                        districts={form.destDistrict ? [form.destDistrict] : []}
                        onChange={(value) =>
                          setForm((prev) => ({
                            ...prev,
                            destCity: value.cities[0] ?? '',
                            destDistrict: value.districts[0] ?? '',
                            destLat: '',
                            destLng: '',
                          }))
                        }
                        title="İşletme konumu"
                        description="Haritada gösterilecek şehir ve ilçeyi seç. Enlem-boylam girmezsin."
                        disabled={locked}
                      />
                    ) : null}
                  </Group>

                  <Group title="Reklam sayfası" hint="İsteğe bağlı: banner’a dokunan kullanıcı için zengin bir sayfa hazırla.">
                    <ToggleRow
                      title="Reklam detay sayfası yayında"
                      description="Boş bırakılan alanlar kullanıcıya gösterilmez."
                      value={form.detailEnabled}
                      onValueChange={(value) => set('detailEnabled', value)}
                    />
                    {form.detailEnabled ? (
                      <>
                        <TextField
                          label="Sayfa başlığı"
                          value={form.headline}
                          onChangeText={(value) => set('headline', value)}
                          maxLength={140}
                          placeholder={form.title || 'Banner başlığı kullanılır'}
                        />
                        <TextField
                          label="Açıklama"
                          value={form.body}
                          onChangeText={(value) => set('body', value)}
                          multiline
                          maxLength={5000}
                          placeholder="Ürün, hizmet veya kampanya hakkında kısa bilgi."
                        />
                        <Row>
                          <TextField
                            label="Fiyat"
                            value={form.priceText}
                            onChangeText={(value) => set('priceText', value)}
                            maxLength={80}
                            placeholder="Örn. 249 ₺"
                          />
                          <TextField
                            label="Kampanya / indirim"
                            value={form.offerText}
                            onChangeText={(value) => set('offerText', value)}
                            maxLength={200}
                            placeholder="Örn. 2 al 1 öde"
                          />
                        </Row>
                        <TextField
                          label="Adres"
                          value={form.address}
                          onChangeText={(value) => set('address', value)}
                          maxLength={240}
                          placeholder="Mahalle, sokak, no"
                        />
                        <LocationPicker
                          cities={form.detailCity ? [form.detailCity] : []}
                          districts={form.detailDistrict ? [form.detailDistrict] : []}
                          onChange={(value) =>
                            setForm((prev) => ({
                              ...prev,
                              detailCity: value.cities[0] ?? '',
                              detailDistrict: value.districts[0] ?? '',
                              detailLat: '',
                              detailLng: '',
                            }))
                          }
                          title="Sayfadaki harita konumu"
                          description="İsteğe bağlı. Şehir ve ilçe seçersen “Haritada göster” butonu eklenir."
                          disabled={locked}
                        />
                        <Row>
                          <TextField
                            label="Telefon"
                            value={form.phone}
                            onChangeText={(value) => set('phone', value)}
                            keyboardType="phone-pad"
                          />
                          <TextField
                            label="E-posta"
                            value={form.email}
                            onChangeText={(value) => set('email', value)}
                            autoCapitalize="none"
                            keyboardType="email-address"
                          />
                          <TextField
                            label="Web sitesi (https)"
                            value={form.website}
                            onChangeText={(value) => set('website', value)}
                            autoCapitalize="none"
                          />
                        </Row>
                        <AdMediaField
                          label="Kapak görseli"
                          value={form.coverUrl}
                          onChange={(value) => set('coverUrl', value)}
                          variant="cover"
                          disabled={locked}
                        />
                        <Button
                          label={detailAdvanced ? 'Gelişmiş alanları kapat' : 'Gelişmiş sayfa alanları'}
                          size="sm"
                          variant="ghost"
                          fullWidth={false}
                          onPress={() => setDetailAdvanced((value) => !value)}
                        />
                        {detailAdvanced ? (
                          <>
                            <TextField
                              label="Galeri adresleri (her satıra bir https adresi, en fazla 12)"
                              value={form.gallery}
                              onChangeText={(value) => set('gallery', value)}
                              multiline
                              autoCapitalize="none"
                            />
                            <AdMediaField
                              label="Galeriye görsel ekle"
                              value=""
                              onChange={(value) => value && set('gallery', [...lines(form.gallery), value].join('\n'))}
                              variant="gallery"
                            />
                            <AdMediaField
                              label="Tanıtım videosu (opsiyonel)"
                              value={form.detailVideo}
                              onChange={(value) => set('detailVideo', value)}
                              variant="video"
                            />
                            <TextField
                              label="Öne çıkan özellikler (her satıra bir madde)"
                              value={form.features}
                              onChangeText={(value) => set('features', value)}
                              multiline
                            />
                            <Row>
                              <TextField
                                label="Son geçerlilik"
                                value={form.validUntil}
                                onChangeText={(value) => set('validUntil', value)}
                                placeholder="2026-12-31 23:59"
                                autoCapitalize="none"
                              />
                              <TextField
                                label="İşletme profili kimliği (UUID)"
                                value={form.placeId}
                                onChangeText={(value) => set('placeId', value)}
                                autoCapitalize="none"
                              />
                            </Row>
                            <Label text="Bağlı ilan" />
                            <ChipSelect
                              options={[
                                { value: '', label: 'Yok' },
                                { value: 'market_listing', label: 'Marketplace ilanı' },
                                { value: 'real_estate', label: 'Emlak ilanı' },
                              ]}
                              value={form.listingType}
                              onChange={(value) => set('listingType', value as Form['listingType'])}
                            />
                            {form.listingType ? (
                              <TextField
                                label="İlan kimliği (UUID)"
                                value={form.listingId}
                                onChangeText={(value) => set('listingId', value)}
                                autoCapitalize="none"
                              />
                            ) : null}
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </Group>

                  <Group title="Bütçe ve sınırlar" hint="Boş bırakılan alanlar sınırsız kabul edilir. Çoğu kampanya için gerekmez.">
                    <Button
                      label={advancedBudget ? 'Gelişmiş ayarları kapat' : 'Gelişmiş ayarları aç'}
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() => setAdvancedBudget((value) => !value)}
                    />
                    {advancedBudget ? (
                      <>
                        <Row>
                          <TextField
                            label="Günlük gösterim sınırı"
                            value={form.dailyCap}
                            onChangeText={(value) => set('dailyCap', value)}
                            keyboardType="number-pad"
                            placeholder="Sınırsız"
                          />
                          <TextField
                            label="Toplam gösterim sınırı"
                            value={form.totalCap}
                            onChangeText={(value) => set('totalCap', value)}
                            keyboardType="number-pad"
                            placeholder="Sınırsız"
                          />
                          <TextField
                            label="Kullanıcı başına günlük"
                            value={form.perUserDailyCap}
                            onChangeText={(value) => set('perUserDailyCap', value)}
                            keyboardType="number-pad"
                            hint="1–10 arası"
                          />
                        </Row>
                        <Row>
                          <TextField
                            label="Bütçe (₺)"
                            value={form.budget}
                            onChangeText={(value) => set('budget', value)}
                            keyboardType="decimal-pad"
                            placeholder="Sınırsız"
                          />
                          <TextField
                            label="BGBM / CPM (₺)"
                            value={form.cpm}
                            onChangeText={(value) => set('cpm', value)}
                            keyboardType="decimal-pad"
                            placeholder="Ücretsiz"
                            hint="1000 gösterim başına"
                          />
                          <TextField
                            label="Öncelik (1–10)"
                            value={form.priority}
                            onChangeText={(value) => set('priority', value)}
                            keyboardType="number-pad"
                            hint="Yüksek değer daha sık gösterilir"
                          />
                        </Row>
                      </>
                    ) : null}
                  </Group>

                  {!wide ? summary : null}
                </>
              ) : null}

              {errors.length ? <IssueList title="Devam etmeden önce" items={errors} tone="danger" /> : null}
              {serverIssues.length ? (
                <IssueList title="Yayın öncesi doğrulama" items={serverIssues.map(adIssueLabel)} tone="warning" />
              ) : null}
            </ScrollView>

            {wide ? (
              <ScrollView style={[styles.previewPane, { borderColor: theme.colors.divider }]} contentContainerStyle={styles.form}>
                {summary}
                <AppText variant="title">Banner önizlemesi</AppText>
                {preview}
                <AppText variant="caption" color="textTertiary">
                  Önizleme gerçek banner bileşenini kullanır; yayınlanan görünümle aynıdır.
                </AppText>
              </ScrollView>
            ) : null}
          </View>

          <View style={[styles.footer, { borderColor: theme.colors.divider }]}>
            <View style={styles.footerInfo}>
              <AppText variant="caption" color="textTertiary">
                Adım {step + 1}/{AD_STEPS.length} · {stepErrors.length ? `${stepErrors.length} eksik` : 'Bu adım hazır'}
              </AppText>
            </View>
            <Button
              label={step === 0 ? 'Vazgeç' : 'Geri'}
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={() => (step === 0 ? onClose() : setStep((value) => value - 1))}
            />
            <Button
              label="Taslak olarak kaydet"
              size="sm"
              variant="outline"
              fullWidth={false}
              disabled={!canManage || locked}
              loading={save.isPending && !transition.isPending}
              onPress={() => void persist(false)}
            />
            {step < AD_STEPS.length - 1 ? (
              <Button
                label="İleri"
                size="sm"
                fullWidth={false}
                leftIcon={<Ionicons name="arrow-forward" size={14} color={theme.colors.onPrimary} />}
                onPress={goNext}
              />
            ) : (
              <Button
                label={canSubmit ? 'Kaydet ve incelemeye gönder' : 'Değişiklikleri kaydet'}
                size="sm"
                fullWidth={false}
                disabled={!canManage || locked}
                loading={transition.isPending}
                leftIcon={<Ionicons name="send-outline" size={14} color={theme.colors.onPrimary} />}
                onPress={() => void persist(canSubmit)}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.group, { borderColor: theme.colors.border }]}>
      <View style={styles.groupHead}>
        <AppText variant="title" style={styles.flex}>
          {title}
        </AppText>
      </View>
      {hint ? (
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      ) : null}
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

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.summaryRow}>
      <Ionicons name={icon} size={14} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textTertiary" style={styles.summaryLabel}>
        {label}
      </AppText>
      <AppText variant="caption" color="text" style={styles.flex} numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

function ChecklistRow({ done, text }: { done: boolean; text: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.checklistRow}>
      <Ionicons
        name={done ? 'checkmark-circle' : 'ellipse-outline'}
        size={14}
        color={done ? theme.colors.success : theme.colors.textTertiary}
      />
      <AppText variant="caption" color={done ? 'textSecondary' : 'textTertiary'}>
        {text}
      </AppText>
    </View>
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
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '700' },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  panel: {
    width: '100%',
    maxWidth: 1320,
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
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  stepRail: { maxHeight: 74, flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  stepRailContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 180,
  },
  stepIndex: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  bodyWide: { flexDirection: 'row' },
  form: { padding: 16, gap: 14 },
  previewPane: { maxWidth: 520, borderLeftWidth: StyleSheet.hairlineWidth },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 10 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexGrow: 1, flexBasis: 180, minWidth: 160 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  subCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8 },
  placementGroup: { gap: 6 },
  placementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  destinationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  destinationCard: {
    flexGrow: 1,
    flexBasis: 180,
    maxWidth: 260,
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    padding: 10,
  },
  summaryCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, gap: 8 },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  summaryLabel: { width: 92 },
  checklist: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 4 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  issueList: { flexDirection: 'column', alignItems: 'flex-start', gap: 3 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerInfo: { flexGrow: 1, minWidth: 160 },
});
