import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAddPropertyDocument,
  usePropertyDetail,
  usePropertyDocuments,
  usePropertyLocationOptions,
  useSaveProperty,
} from '../hooks/use-accommodation';
import { uploadAccommodationDocument } from '../services/accommodation-media-service';
import {
  EMPTY_HOTEL_APPLICATION,
  HOTEL_APPLICATION_STEPS as STEPS,
  clearHotelApplicationDraft,
  hasHotelApplicationContent,
  writeHotelApplicationDraft,
  type HotelApplicationDraft,
  type HotelApplicationForm as Draft,
} from '../services/onboarding-draft';
import { PROPERTY_TYPE_OPTIONS, formatDate } from '../utils/format';
import type { PmsTabKey } from '../utils/pms-tabs';
import {
  AccCard,
  Chip,
  ChipsRow,
  InfoBanner,
  InlineError,
  KeyValueRow,
  LoadingBlock,
  StatusPill,
} from './AccommodationUI';
import { LocationPicker } from './LocationPicker';

type AutoSaveState = 'idle' | 'saving' | 'saved';

const AMENITIES = [
  'Ücretsiz Wi-Fi',
  'Otopark',
  'Kahvaltı',
  'Restoran',
  'Bar',
  'Havuz',
  'Klima',
  'Spor salonu',
  'Spa',
  'Deniz manzarası',
  'Evcil hayvan kabulü',
  'Engelli erişimi',
  '24 saat resepsiyon',
  'Çamaşırhane',
  'Havaalanı transferi',
  'Plaj',
  'Mutfak',
  'Balkon',
];

export function HotelOnboardingWizard({
  propertyId,
  initialDraft,
  onSaved,
  onCancel,
  onOpenManagement,
}: {
  propertyId?: string | null;
  /** Cihazda bulunan otomatik taslak; kullanıcı devam etmeyi seçtiyse dolu gelir. */
  initialDraft?: HotelApplicationDraft | null;
  onSaved?: (id: string) => void;
  onCancel?: () => void;
  onOpenManagement?: (propertyId: string, tab: PmsTabKey) => void;
}) {
  const { theme } = useTheme();
  const session = useSession();
  const draftUserId = session?.user?.id ?? null;
  const [step, setStep] = useState(() =>
    Math.min(Math.max(initialDraft?.step ?? 0, 0), STEPS.length - 1),
  );
  const [draft, setDraft] = useState<Draft>(() => initialDraft?.form ?? EMPTY_HOTEL_APPLICATION);
  const [savedId, setSavedId] = useState<string | null>(propertyId ?? initialDraft?.propertyId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>('idle');
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);

  const locations = usePropertyLocationOptions();
  const districts = useMemo(() => locations.data ?? [], [locations.data]);
  const detail = usePropertyDetail(propertyId ?? savedId);
  const documents = usePropertyDocuments(savedId);
  const addDocument = useAddPropertyDocument(savedId ?? '');
  const save = useSaveProperty();
  // Sunucudan gelen veri formu yalnızca ilk açılışta doldurur; sonraki
  // yenilemeler kullanıcının o adımda yazdıklarını ezmez.
  const hydratedRef = useRef<string | null>(initialDraft?.propertyId ?? null);

  useEffect(() => {
    const data = detail.data;
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMissing(data.missing);
    if (hydratedRef.current === data.id) return;
    hydratedRef.current = data.id;
    setDraft({
      name: data.name,
      property_type: data.property_type,
      description: data.description ?? '',
      district_id: data.district_id,
      district: data.district ?? '',
      neighborhood_id: data.neighborhood_id ?? null,
      neighborhood: data.neighborhood ?? '',
      address: data.address ?? '',
      lat: data.lat != null ? String(data.lat) : '',
      lng: data.lng != null ? String(data.lng) : '',
      phone: data.phone ?? '',
      email: data.email ?? '',
      website: data.website ?? '',
      tax_office: data.tax_office ?? '',
      tax_number: data.tax_number ?? '',
      invoice_title: data.invoice_title ?? '',
      contact_name: data.contact_name ?? '',
      contact_phone: data.contact_phone ?? '',
      contact_email: data.contact_email ?? '',
      room_capacity: data.room_capacity != null ? String(data.room_capacity) : '',
      checkin_time: data.checkin_time?.slice(0, 5) ?? '14:00',
      checkout_time: data.checkout_time?.slice(0, 5) ?? '11:00',
      languages: data.languages.join(', '),
      amenities: data.amenities,
      cancellation_policy:
        typeof data.policies.cancellation === 'string' ? data.policies.cancellation : '',
      pet_policy: typeof data.policies.pets === 'string' ? data.policies.pets : '',
      child_policy: typeof data.policies.children === 'string' ? data.policies.children : '',
      general_rules: typeof data.policies.general === 'string' ? data.policies.general : '',
    });
  }, [detail.data]);

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

  // ---------------------------------------------------------------------------
  // Otomatik taslak
  // ---------------------------------------------------------------------------
  // Yeni başvuru akışında form her değiştiğinde sessizce cihaza yazılır.
  // Düzenleme ekranında (propertyId ile açılan) sunucu kaydı zaten mevcut
  // olduğu için otomatik taslak kapalıdır.
  const autoSaveEnabled = !propertyId;
  const clearedRef = useRef(false);
  const latestRef = useRef({ form: draft, step, propertyId: savedId });
  latestRef.current = { form: draft, step, propertyId: savedId };

  const flushDraft = useCallback(() => {
    if (!autoSaveEnabled || clearedRef.current) return;
    const latest = latestRef.current;
    if (!hasHotelApplicationContent(latest.form)) return;
    void writeHotelApplicationDraft(draftUserId, latest);
    setAutoSavedAt(Date.now());
  }, [autoSaveEnabled, draftUserId]);

  useEffect(() => {
    if (!autoSaveEnabled || clearedRef.current) return;
    if (!hasHotelApplicationContent(draft)) {
      // Kullanıcı her şeyi temizlediyse boş taslak kaydı bırakma.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAutoSaveState('idle');
      void clearHotelApplicationDraft(draftUserId);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoSaveState('saving');
    const timer = setTimeout(() => {
      void writeHotelApplicationDraft(draftUserId, latestRef.current);
      setAutoSaveState('saved');
      setAutoSavedAt(Date.now());
    }, 650);
    return () => clearTimeout(timer);
  }, [draft, step, savedId, autoSaveEnabled, draftUserId]);

  // Uygulama arka plana alındığında bekleyen yazım hemen diske aktarılır.
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushDraft();
    });
    return () => subscription.remove();
  }, [autoSaveEnabled, flushDraft]);

  // Sayfadan çıkılırken (geri, sekme kapatma) son hâl kaydedilir.
  useEffect(() => {
    if (!autoSaveEnabled) return;
    return () => {
      const latest = latestRef.current;
      if (clearedRef.current || !hasHotelApplicationContent(latest.form)) return;
      void writeHotelApplicationDraft(draftUserId, latest);
    };
  }, [autoSaveEnabled, draftUserId]);

  const clearAutoDraft = useCallback(() => {
    clearedRef.current = true;
    setAutoSaveState('idle');
    void clearHotelApplicationDraft(draftUserId);
  }, [draftUserId]);

  const payload = useMemo(
    () => ({
      name: draft.name.trim(),
      property_type: draft.property_type,
      description: draft.description.trim() || null,
      city: 'Trabzon',
      district_id: draft.district_id,
      district: draft.district || null,
      neighborhood_id: draft.neighborhood_id,
      neighborhood: draft.neighborhood.trim() || null,
      address: draft.address.trim() || null,
      lat: draft.lat ? Number(draft.lat.replace(',', '.')) : null,
      lng: draft.lng ? Number(draft.lng.replace(',', '.')) : null,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      website: draft.website.trim() || null,
      tax_office: draft.tax_office.trim() || null,
      tax_number: draft.tax_number.trim() || null,
      invoice_title: draft.invoice_title.trim() || null,
      contact_name: draft.contact_name.trim() || null,
      contact_phone: draft.contact_phone.trim() || null,
      contact_email: draft.contact_email.trim() || null,
      room_capacity: draft.room_capacity ? Number(draft.room_capacity) : null,
      checkin_time: draft.checkin_time,
      checkout_time: draft.checkout_time,
      languages: draft.languages
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      amenities: draft.amenities,
      policies: {
        cancellation: draft.cancellation_policy.trim() || null,
        pets: draft.pet_policy.trim() || null,
        children: draft.child_policy.trim() || null,
        general: draft.general_rules.trim() || null,
      },
    }),
    [draft],
  );

  const persist = async (submit = false) => {
    setError(null);
    setInfo(null);
    if (!draft.name.trim()) {
      setError('Tesis adı zorunludur.');
      return null;
    }
    // İlçe yalnızca doğrulamaya gönderirken zorunlu. Taslak kaydı ilçe
    // seçilmeden de yapılabilir; aksi halde kullanıcı ilçe adımına hiç
    // geçemeden "İlçe seçimi zorunludur" hatasında takılıyordu.
    if (submit && !draft.district_id && !draft.district.trim()) {
      setError('Doğrulamaya göndermek için ilçe seçmelisin.');
      return null;
    }
    try {
      const result = await save.mutateAsync({ propertyId: savedId, payload, submit });
      setSavedId(result.id);
      setMissing(result.missing ?? []);
      if (submit) {
        setInfo(
          result.submitted
            ? 'Tesis doğrulamaya gönderildi. Admin onayı sonrası yayına alınacak.'
            : 'Tesis kaydedildi ancak doğrulama için eksik bilgiler var.',
        );
        if (result.submitted) {
          // Doğrulamaya gönderilen başvuru artık sunucuda; cihazdaki taslak
          // gereksiz "yarım kalan başvuru" uyarısı üretmesin.
          clearAutoDraft();
          onSaved?.(result.id);
        }
      } else {
        setInfo('Taslak kaydedildi. Kaldığın adımdan devam edebilirsin.');
      }
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tesis kaydedilemedi.');
      return null;
    }
  };

  const next = async () => {
    setError(null);
    if (!draft.name.trim()) {
      setStep(0);
      setError('Devam etmek için tesis adını gir.');
      return;
    }
    if (step === 0 && !savedId) {
      const result = await persist(false);
      if (!result) return;
    }
    if (step === 1 && !draft.district_id && !draft.district.trim()) {
      setError('Devam etmek için ilçe seç.');
      return;
    }
    setInfo(null);
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
    if (savedId) void detail.refetch();
  };

  const pickDocument = async (kind: string, title: string) => {
    if (!savedId) {
      setError('Belge yüklemek için önce taslağı kaydet.');
      return;
    }
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    if (!asset) return;
    setUploadingKind(kind);
    try {
      const uploaded = await uploadAccommodationDocument({
        propertyId: savedId,
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? 'application/pdf',
        size: asset.size ?? null,
      });
      if (!uploaded.ok) {
        setError(uploaded.error.message);
        return;
      }
      await addDocument.mutateAsync({
        kind,
        title,
        storagePath: uploaded.data.path,
      });
      void documents.refetch();
      setInfo(`${title} yüklendi. Admin incelemesine gönderildi.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Belge yüklenemedi.');
    } finally {
      setUploadingKind(null);
    }
  };

  /**
   * Sunucudan gelen "eksik alan" mesajını ilgili adıma eşler; kullanıcı
   * uyarıya dokunduğunda doğrudan düzeltmesi gereken forma gider.
   */
  const stepForMissing = (message: string): number => {
    const text = message.toLocaleLowerCase('tr-TR');
    if (text.includes('tesis adı') || text.includes('açıklama')) return 0;
    if (
      text.includes('ilçe') ||
      text.includes('adres') ||
      text.includes('konum') ||
      text.includes('telefon') ||
      text.includes('posta')
    ) {
      return 1;
    }
    if (text.includes('vergi') || text.includes('yetkili') || text.includes('fatura')) return 2;
    if (text.includes('politika')) return 3;
    return 4;
  };

  if (propertyId && detail.isLoading) {
    return <LoadingBlock height={240} />;
  }
  return (
    <View style={styles.wrap}>
      <AccCard padding={14} style={styles.progressCard}>
        <View style={styles.progressHead}>
          <View style={styles.flex}>
            <AppText variant="overline" color="primaryDeep">
              ADIM {step + 1} / {STEPS.length}
            </AppText>
            <AppText variant="h3">{STEPS[step]}</AppText>
          </View>
          {savedId ? (
            <StatusPill
              label={missing.length === 0 ? 'Bilgiler tam' : `${missing.length} eksik`}
              color={missing.length === 0 ? theme.colors.success : theme.colors.warning}
              background={missing.length === 0 ? theme.colors.successSoft : theme.colors.warningSoft}
            />
          ) : null}
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
          <View
            style={[
              styles.progressFill,
              { width: `${((step + 1) / STEPS.length) * 100}%`, backgroundColor: theme.colors.primary },
            ]}
          />
        </View>
        {autoSaveEnabled ? (
          <View style={styles.autoSaveRow}>
            <Ionicons
              name={
                autoSaveState === 'saved'
                  ? 'cloud-done-outline'
                  : autoSaveState === 'saving'
                    ? 'cloud-upload-outline'
                    : 'cloud-outline'
              }
              size={13}
              color={autoSaveState === 'saved' ? theme.colors.success : theme.colors.textTertiary}
            />
            <AppText variant="caption" color="textTertiary" style={styles.flex} numberOfLines={1}>
              {autoSaveState === 'saved' && autoSavedAt
                ? `Taslak otomatik kaydedildi · ${formatClock(autoSavedAt)}`
                : autoSaveState === 'saving'
                  ? 'Taslak kaydediliyor…'
                  : 'Yazdıkların otomatik taslak olarak saklanır'}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              %{Math.round(((step + 1) / STEPS.length) * 100)}
            </AppText>
          </View>
        ) : null}
        <ChipsRow style={styles.stepChips}>
          {STEPS.map((label, index) => (
            <Chip
              key={label}
              label={`${index + 1}. ${label.split(' ')[0]}`}
              icon={index < step ? 'checkmark-circle' : undefined}
              active={index === step}
              onPress={() => {
                setError(null);
                setInfo(null);
                setStep(index);
              }}
            />
          ))}
        </ChipsRow>
      </AccCard>

      {error ? <InlineError message={error} /> : null}
      {info ? <InfoBanner tone="success" text={info} /> : null}
      {missing.length > 0 && step === STEPS.length - 1 ? (
        <View style={styles.missingBox}>
          <InfoBanner
            tone="warning"
            text={`Doğrulama için eksik alanlar (${missing.length}). Düzeltmek istediğin alana dokun:`}
          />
          <View style={styles.missingList}>
            {missing.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={`${item} alanını düzelt`}
                onPress={() => {
                  setError(null);
                  setInfo(null);
                  setStep(stepForMissing(item));
                }}
                style={({ pressed }) => [
                  styles.missingRow,
                  {
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.sm,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={15} color={theme.colors.warning} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  {item}
                </AppText>
                <AppText variant="caption" color="primaryDeep">
                  Düzelt
                </AppText>
              </Pressable>
            ))}
          </View>
          <AppText variant="caption" color="textTertiary">
            Oda tipi, oda ve fiyat planı eklemek için Otel Yönetimim › Odalar / Fiyat Planları
            sekmelerini kullan.
          </AppText>
        </View>
      ) : null}

      {step === 0 ? (
        <View style={styles.form}>
          <TextField
            label="Tesis adı *"
            value={draft.name}
            onChangeText={(name) => patch({ name })}
            placeholder="Örn. Trabzon Uzungöl Bungalov"
            leftIcon="business-outline"
          />
          <AppText variant="label" color="textSecondary">
            Tesis türü *
          </AppText>
          <ChipsRow>
            {PROPERTY_TYPE_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={draft.property_type === option.value}
                onPress={() => patch({ property_type: option.value })}
              />
            ))}
          </ChipsRow>
          <TextField
            label="Açıklama"
            value={draft.description}
            onChangeText={(description) => patch({ description })}
            placeholder="Tesisinin öne çıkan özelliklerini anlat."
            hint={`Doğrulama için en az 40 karakter. Şu an ${draft.description.trim().length}.`}
            multiline
          />
          <View style={styles.row}>
            <TextField
              label="Giriş saati"
              value={draft.checkin_time}
              onChangeText={(checkin_time) => patch({ checkin_time })}
              placeholder="14:00"
              containerStyle={styles.flex}
              leftIcon="log-in-outline"
            />
            <TextField
              label="Çıkış saati"
              value={draft.checkout_time}
              onChangeText={(checkout_time) => patch({ checkout_time })}
              placeholder="11:00"
              containerStyle={styles.flex}
              leftIcon="log-out-outline"
            />
          </View>
          <TextField
            label="Oda kapasitesi"
            value={draft.room_capacity}
            onChangeText={(room_capacity) => patch({ room_capacity: room_capacity.replace(/\D/g, '') })}
            keyboardType="number-pad"
            placeholder="Örn. 40"
            leftIcon="bed-outline"
          />
          <TextField
            label="Konuşulan diller"
            value={draft.languages}
            onChangeText={(languages) => patch({ languages })}
            placeholder="Türkçe, İngilizce, Arapça"
            hint="Virgülle ayırarak birden fazla dil ekleyebilirsin."
          />
        </View>
      ) : null}

      {step === 1 ? (
        <View style={styles.form}>
          <LocationPicker
            districts={districts}
            districtId={draft.district_id}
            district={draft.district}
            neighborhoodId={draft.neighborhood_id}
            neighborhood={draft.neighborhood}
            loading={locations.isLoading}
            errorMessage={locations.isError ? locations.error.message : null}
            onRetry={() => void locations.refetch()}
            onChange={(nextLocation) =>
              patch({
                district_id: nextLocation.districtId,
                district: nextLocation.district,
                neighborhood_id: nextLocation.neighborhoodId,
                neighborhood: nextLocation.neighborhood,
                // İlçe merkezi biliniyorsa ve kullanıcı henüz koordinat
                // girmediyse harita konumu otomatik dolar.
                lat:
                  !draft.lat && nextLocation.lat != null
                    ? String(nextLocation.lat)
                    : draft.lat,
                lng:
                  !draft.lng && nextLocation.lng != null
                    ? String(nextLocation.lng)
                    : draft.lng,
              })
            }
          />
          <TextField
            label="Açık adres"
            value={draft.address}
            onChangeText={(address) => patch({ address })}
            placeholder="Cadde, sokak, no"
            multiline
            leftIcon="map-outline"
          />
          <View style={styles.row}>
            <TextField
              label="Enlem (lat)"
              value={draft.lat}
              onChangeText={(lat) => patch({ lat })}
              placeholder="41.0027"
              keyboardType="decimal-pad"
              containerStyle={styles.flex}
            />
            <TextField
              label="Boylam (lng)"
              value={draft.lng}
              onChangeText={(lng) => patch({ lng })}
              placeholder="39.7168"
              keyboardType="decimal-pad"
              containerStyle={styles.flex}
            />
          </View>
          <InfoBanner text="Harita koordinatını Google Maps'te konuma uzun basıp koordinatları kopyalayarak bulabilirsin. Konum eklenen tesisler haritada listelenir." />
          <TextField
            label="Telefon"
            value={draft.phone}
            onChangeText={(phone) => patch({ phone })}
            placeholder="+90 462 000 00 00"
            keyboardType="phone-pad"
            leftIcon="call-outline"
          />
          <TextField
            label="E-posta"
            value={draft.email}
            onChangeText={(email) => patch({ email })}
            placeholder="resepsiyon@tesis.com"
            autoCapitalize="none"
            keyboardType="email-address"
            leftIcon="mail-outline"
          />
          <TextField
            label="Web sitesi"
            value={draft.website}
            onChangeText={(website) => patch({ website })}
            placeholder="https://"
            autoCapitalize="none"
            leftIcon="globe-outline"
          />
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.form}>
          <InfoBanner text="Vergi ve fatura bilgileri, komisyon faturalandırması ve yasal belgeler için kullanılır. Bilgiler yalnızca yetkili personel ve Trabzone admini tarafından görülebilir." />
          <TextField
            label="Vergi dairesi"
            value={draft.tax_office}
            onChangeText={(tax_office) => patch({ tax_office })}
            placeholder="Örn. Trabzon"
            leftIcon="document-text-outline"
          />
          <TextField
            label="Vergi / TC kimlik no"
            value={draft.tax_number}
            onChangeText={(tax_number) => patch({ tax_number: tax_number.replace(/[^\d]/g, '') })}
            keyboardType="number-pad"
            placeholder="10 veya 11 haneli"
          />
          <TextField
            label="Fatura unvanı"
            value={draft.invoice_title}
            onChangeText={(invoice_title) => patch({ invoice_title })}
            placeholder="Şirket / şahıs tam unvanı"
          />
          <TextField
            label="Yetkili adı soyadı"
            value={draft.contact_name}
            onChangeText={(contact_name) => patch({ contact_name })}
            placeholder="Tesis yetkilisi"
            leftIcon="person-outline"
          />
          <View style={styles.row}>
            <TextField
              label="Yetkili telefon"
              value={draft.contact_phone}
              onChangeText={(contact_phone) => patch({ contact_phone })}
              keyboardType="phone-pad"
              containerStyle={styles.flex}
            />
            <TextField
              label="Yetkili e-posta"
              value={draft.contact_email}
              onChangeText={(contact_email) => patch({ contact_email })}
              autoCapitalize="none"
              keyboardType="email-address"
              containerStyle={styles.flex}
            />
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.form}>
          <AppText variant="label" color="textSecondary">
            Tesis olanakları
          </AppText>
          <View style={styles.amenityWrap}>
            {AMENITIES.map((amenity) => {
              const active = draft.amenities.includes(amenity);
              return (
                <Chip
                  key={amenity}
                  label={amenity}
                  active={active}
                  onPress={() =>
                    patch({
                      amenities: active
                        ? draft.amenities.filter((item) => item !== amenity)
                        : [...draft.amenities, amenity],
                    })
                  }
                />
              );
            })}
          </View>
          <TextField
            label="İptal politikası"
            value={draft.cancellation_policy}
            onChangeText={(cancellation_policy) => patch({ cancellation_policy })}
            placeholder="Örn. Girişten 48 saat öncesine kadar ücretsiz iptal."
            multiline
          />
          <TextField
            label="Evcil hayvan politikası"
            value={draft.pet_policy}
            onChangeText={(pet_policy) => patch({ pet_policy })}
            placeholder="Örn. Küçük ırk evcil hayvanlar kabul edilir."
            multiline
          />
          <TextField
            label="Çocuk politikası"
            value={draft.child_policy}
            onChangeText={(child_policy) => patch({ child_policy })}
            placeholder="Örn. 6 yaş altı çocuklar ücretsizdir."
            multiline
          />
          <TextField
            label="Diğer tesis kuralları"
            value={draft.general_rules}
            onChangeText={(general_rules) => patch({ general_rules })}
            placeholder="Sessizlik saatleri, sigara politikası vb."
            multiline
          />
        </View>
      ) : null}

      {step === 4 ? (
        <View style={styles.form}>
          <InfoBanner
            text="Tesis türüne göre istenen belgeler değişebilir. Vergi levhası ve işletme yetki belgesi olmadan tesis yayına alınmaz. Yüklenen belgeler gizli depolamada saklanır."
          />

          {savedId && onOpenManagement ? (
            <AccCard padding={14} style={styles.nextCard}>
              <AppText variant="bodyStrong">Sıradaki adımlar</AppText>
              <AppText variant="caption" color="textSecondary">
                Doğrulama için en az bir oda tipi, bir fiziksel oda ve bir fiyat planı gerekir. Aşağıdaki
                ekranlarda ekledikten sonra buraya dönüp doğrulamaya gönderebilirsin.
              </AppText>
              <View style={styles.quickActions}>
                <Button
                  label="Oda tipleri ve odalar"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => onOpenManagement(savedId, 'odalar')}
                />
                <Button
                  label="Fiyat planları"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => onOpenManagement(savedId, 'fiyat-planlari')}
                />
                <Button
                  label="Fotoğraf ve medya"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => onOpenManagement(savedId, 'medya')}
                />
              </View>
            </AccCard>
          ) : null}

          {[
            { kind: 'tax_certificate', title: 'Vergi levhası' },
            { kind: 'business_license', title: 'İşletme / turizm işletme belgesi' },
            { kind: 'authority', title: 'Yetki / kimlik belgesi' },
          ].map((requirement) => {
            const existing = (documents.data?.items ?? []).filter((item) => item.kind === requirement.kind);
            return (
              <AccCard key={requirement.kind} padding={12} style={{ gap: 7 }}>
                <View style={styles.docHead}>
                  <Ionicons name="document-attach-outline" size={17} color={theme.colors.primaryDeep} />
                  <AppText variant="bodyStrong" style={styles.flex}>
                    {requirement.title}
                  </AppText>
                  <Button
                    label={existing.length > 0 ? 'Yenile' : 'Yükle'}
                    size="sm"
                    variant="outline"
                    loading={uploadingKind === requirement.kind}
                    onPress={() => void pickDocument(requirement.kind, requirement.title)}
                    style={styles.docButton}
                  />
                </View>
                {existing.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Henüz belge yüklenmedi.
                  </AppText>
                ) : (
                  existing.map((document) => (
                    <View key={document.id} style={styles.docRow}>
                      <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
                      <AppText variant="caption" color="textSecondary" style={styles.flex}>
                        {formatDate(document.created_at.slice(0, 10))} yüklendi
                      </AppText>
                      <StatusPill
                        label={
                          document.status === 'approved'
                            ? 'Onaylandı'
                            : document.status === 'rejected'
                              ? 'Reddedildi'
                              : 'İnceleniyor'
                        }
                        color={
                          document.status === 'approved'
                            ? theme.colors.success
                            : document.status === 'rejected'
                              ? theme.colors.danger
                              : theme.colors.warning
                        }
                        background={
                          document.status === 'approved'
                            ? theme.colors.successSoft
                            : document.status === 'rejected'
                              ? theme.colors.dangerSoft
                              : theme.colors.warningSoft
                        }
                      />
                    </View>
                  ))
                )}
              </AccCard>
            );
          })}

          {detail.data ? (
            <AccCard padding={14}>
              <AppText variant="bodyStrong" style={styles.docHead}>
                Doğrulama durumu
              </AppText>
              <KeyValueRow
                label="Durum"
                value={
                  detail.data.verification_status === 'verified'
                    ? 'Doğrulandı'
                    : detail.data.verification_status === 'pending'
                      ? 'İnceleniyor'
                      : detail.data.verification_status === 'rejected'
                        ? 'Reddedildi'
                        : 'Doğrulanmadı'
                }
              />
              {detail.data.verification_note ? (
                <KeyValueRow label="Admin notu" value={detail.data.verification_note} />
              ) : null}
              {detail.data.published_at ? (
                <KeyValueRow label="Yayın tarihi" value={formatDate(detail.data.published_at.slice(0, 10))} />
              ) : null}
            </AccCard>
          ) : null}

          <InfoBanner
            tone="warning"
            text="Doğrulama tamamlanana kadar tesis kamuya açık rezervasyona açılmaz. Taslağını kaydedip daha sonra Otel Yönetimim > Tesis Bilgileri üzerinden devam edebilirsin."
          />
        </View>
      ) : null}

      <View style={styles.actions}>
        {step > 0 ? (
          <Button label="Geri" variant="outline" onPress={() => setStep((current) => Math.max(0, current - 1))} style={styles.flex} />
        ) : onCancel ? (
          <Button label="Vazgeç" variant="outline" onPress={onCancel} style={styles.flex} />
        ) : null}
        <Button
          label="Taslak kaydet"
          variant="outline"
          loading={save.isPending && !save.isSuccess}
          onPress={() => void persist(false)}
          style={styles.flex}
        />
        {step < STEPS.length - 1 ? (
          <Button label="Devam" onPress={() => void next()} loading={save.isPending} style={styles.flex} />
        ) : (
          <Button
            label="Doğrulamaya gönder"
            loading={save.isPending}
            onPress={() => void persist(true)}
            style={styles.flex}
          />
        )}
      </View>

      {savedId && onSaved ? (
        <Button
          label="Tesis yönetimine git"
          variant="secondary"
          rightIcon={<Ionicons name="arrow-forward" size={16} color={theme.colors.primaryDeep} />}
          onPress={() => onSaved(savedId)}
        />
      ) : null}
    </View>
  );
}

function formatClock(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  progressCard: { gap: 9 },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  autoSaveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stepChips: { paddingTop: 2 },
  form: { gap: 10 },
  amenityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  missingBox: { gap: 8 },
  missingList: { gap: 6 },
  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  nextCard: { gap: 7 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  docHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docButton: { alignSelf: 'flex-start' },
});
