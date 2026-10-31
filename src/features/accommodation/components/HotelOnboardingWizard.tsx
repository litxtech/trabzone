import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  AppState,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import type { TextFieldProps } from '@/components/ui/TextField';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import {
  accKeys,
  useAcceptPolicy,
  usePolicyConsent,
  usePropertyDetail,
  usePropertyDocuments,
  usePropertyLocationOptions,
  useSaveProperty,
} from '../hooks/use-accommodation';
import * as accApi from '../services/accommodation-service';
import { uploadAccommodationDocument } from '../services/accommodation-media-service';
import {
  ACCOMMODATION_POLICY_SLUG,
  EMPTY_HOTEL_APPLICATION,
  POLICY_CONSENT_STEP,
  clearHotelApplicationDraft,
  hasHotelApplicationContent,
  writeHotelApplicationDraft,
  type HotelApplicationDraft,
  type HotelApplicationForm as Draft,
} from '../services/onboarding-draft';
import { PROPERTY_TYPE_LABELS, PROPERTY_TYPE_OPTIONS, formatDate } from '../utils/format';
import type { PmsTabKey } from '../utils/pms-tabs';
import {
  Chip,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
  StatusPill,
} from './AccommodationUI';
import { HotelPhotoUploader } from './HotelPhotoUploader';
import { LocationPicker } from './LocationPicker';
import { amenityIcon, propertyTypeIcon } from './PremiumUI';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type ViewRef = ComponentRef<typeof View>;

type AutoSaveState = 'idle' | 'saving' | 'saved';

/**
 * Boş bırakılınca uyarı gösterilen alanlar. Sunucudaki doğrulama
 * (`acc_property_missing`) ile aynı listeyi kapsar; böylece kullanıcı
 * "gönder"e bastığında hatayı sunucudan değil, doğrudan alanın altında görür.
 */
type FieldKey =
  | 'name'
  | 'description'
  | 'district'
  | 'address'
  | 'map'
  | 'phone'
  | 'email'
  | 'contact_name'
  | 'tax'
  | 'cancellation'
  | 'photos'
  | 'documents';

type FieldErrors = Partial<Record<FieldKey, string>>;

type StepMeta = {
  key: string;
  overline: string;
  title: string;
  hint: string;
  icon: IconName;
};

/**
 * Akışın tek ekranlık adımları. `HOTEL_APPLICATION_STEPS` ile aynı sırada ve
 * aynı sayıda olmalıdır (cihazdaki taslak adımı bu indekse göre saklanır).
 */
const STEP_META: readonly StepMeta[] = [
  {
    key: 'profile',
    overline: 'PROPERTY PROFILE',
    title: 'Tesis profili',
    hint: 'Misafirlerin ilk göreceği bilgiler. Kısa tut; ayrıntıları sonraki adımlarda ekleyeceksin.',
    icon: 'business-outline',
  },
  {
    key: 'location',
    overline: 'LOCATION & CONTACT',
    title: 'Konum ve iletişim',
    hint: 'İlçeyi seç, adresi tamamla. Harita konumu ilçe merkezinden otomatik gelir.',
    icon: 'location-outline',
  },
  {
    key: 'billing',
    overline: 'LEGAL & BILLING',
    title: 'Ticari ve yetkili',
    hint: 'Faturalandırma ve doğrulama için gerekli bilgiler. Yalnızca yetkili personel görür.',
    icon: 'document-text-outline',
  },
  {
    key: 'policies',
    overline: 'AMENITIES & POLICIES',
    title: 'Olanaklar ve kurallar',
    hint: 'Olanakları seç, iptal politikasını tanımla. Diğer kurallar opsiyoneldir.',
    icon: 'sparkles-outline',
  },
  {
    key: 'media',
    overline: 'MEDIA & DOCUMENTS',
    title: 'Fotoğraf ve belgeler',
    hint: 'En az bir fotoğraf ve bir doğrulama belgesi yükle. Yüklemeler otomatik kaydedilir.',
    icon: 'images-outline',
  },
  {
    key: 'review',
    overline: 'REVIEW & CONSENT',
    title: 'Onay ve gönder',
    hint: 'Bilgileri kontrol et, misafir hakları beyanını onayla ve doğrulamaya gönder.',
    icon: 'shield-checkmark-outline',
  },
];

/** Her adımda tamamlanması gereken alanlar (uyarı olarak gösterilir). */
const STEP_REQUIRED: FieldKey[][] = [
  ['name', 'description'],
  ['district', 'address', 'map', 'phone', 'email'],
  ['tax', 'contact_name'],
  ['cancellation'],
  ['photos', 'documents'],
  [],
];

const FIELD_LABEL: Record<FieldKey, string> = {
  name: 'Tesis adı',
  description: 'Açıklama',
  district: 'İlçe',
  address: 'Adres',
  map: 'Harita konumu',
  phone: 'Telefon',
  email: 'E-posta',
  contact_name: 'Yetkili',
  tax: 'Vergi no',
  cancellation: 'İptal politikası',
  photos: 'Fotoğraf',
  documents: 'Belge',
};

const FIELD_STEP: Record<FieldKey, number> = {
  name: 0,
  description: 0,
  district: 1,
  address: 1,
  map: 1,
  phone: 1,
  email: 1,
  contact_name: 2,
  tax: 2,
  cancellation: 3,
  photos: 4,
  documents: 4,
};

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

const LANGUAGE_PRESETS = ['Türkçe', 'İngilizce', 'Almanca', 'Rusça', 'Arapça', 'Fransızca'];

const CANCELLATION_PRESETS = [
  'Girişten 48 saat öncesine kadar ücretsiz iptal.',
  'Girişten 7 gün öncesine kadar ücretsiz iptal.',
  'Giriş günü dahil iptal edilemez.',
];

const REQUIRED_DOCUMENTS = [
  { kind: 'tax_certificate', title: 'Vergi levhası', hint: 'Güncel vergi levhası' },
  { kind: 'business_license', title: 'İşletme / turizm belgesi', hint: 'Turizm işletme belgesi' },
  { kind: 'authority', title: 'Yetki / kimlik belgesi', hint: 'İmza yetkilisi belgesi' },
] as const;

const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Alanın geçerli olup olmadığını tek yerden söyler. Adım geçişi, ilerleme
 * yüzdesi ve "başvuru kontrolü" paneli aynı kontrolü kullanır; böylece
 * ekranda "tamam" görünen bir alan gönderimde eksik çıkmaz.
 */
function validateField(
  key: FieldKey,
  draft: Draft,
  env: { photoCount: number; documentCount: number },
): string | null {
  switch (key) {
    case 'name':
      return draft.name.trim().length >= 3 ? null : 'Tesis adını en az 3 karakterle yaz.';
    case 'description':
      return draft.description.trim().length >= 40
        ? null
        : 'Doğrulama için açıklama en az 40 karakter olmalı.';
    case 'district':
      return draft.district_id || draft.district.trim()
        ? null
        : 'İlçe seçimi zorunlu. Listeden seçebilir ya da adını yazabilirsin.';
    case 'address':
      return draft.address.trim() ? null : 'Açık adresi yaz.';
    case 'map':
      return draft.lat.trim() && draft.lng.trim()
        ? null
        : 'Harita konumu için enlem ve boylam gerekli.';
    case 'phone':
      return draft.phone.trim() ? null : 'Tesis telefonunu yaz.';
    case 'email':
      if (!draft.email.trim()) return 'Tesis e-postasını yaz.';
      return emailValid(draft.email) ? null : 'Geçerli bir e-posta adresi yaz.';
    case 'contact_name':
      return draft.contact_name.trim() ? null : 'Yetkili adını ve soyadını yaz.';
    case 'tax':
      return draft.tax_number.trim() ? null : 'Vergi veya TC kimlik numarasını yaz.';
    case 'cancellation':
      return draft.cancellation_policy.trim() ? null : 'İptal politikasını kısaca yaz.';
    case 'photos':
      return env.photoCount > 0 ? null : 'Doğrulama için en az bir tesis fotoğrafı yükle.';
    case 'documents':
      return env.documentCount > 0 ? null : 'Vergi levhası veya işletme belgesi yükle.';
  }
}

function documentStatusLabel(status: 'pending' | 'approved' | 'rejected') {
  if (status === 'approved') return 'Onaylandı';
  if (status === 'rejected') return 'Reddedildi';
  return 'İnceleniyor';
}

/**
 * Metin alanlarını kaydırma sırasında kilitler: parmak sayfayı kaydırırken
 * bir alanın üzerinden geçtiğinde klavye açılmaz. Kaydırma bittiğinde alanlar
 * kısa bir gecikmeyle yeniden düzenlenebilir olur.
 */
const FieldEnvContext = createContext<{
  locked: boolean;
  register: (key: FieldKey, node: ViewRef | null) => void;
  setFocused: (key: FieldKey) => void;
}>({ locked: false, register: () => undefined, setFocused: () => undefined });

type FieldProps = TextFieldProps & { anchorKey?: FieldKey };

function Field({ anchorKey, containerStyle, editable, onFocus, ...rest }: FieldProps) {
  const env = useContext(FieldEnvContext);
  const lockedEditable = env.locked ? false : editable;
  const handleFocus = (event: Parameters<NonNullable<TextFieldProps['onFocus']>>[0]) => {
    if (anchorKey) env.setFocused(anchorKey);
    onFocus?.(event);
  };
  if (!anchorKey) {
    return (
      <TextField
        {...rest}
        containerStyle={containerStyle}
        editable={lockedEditable}
        onFocus={handleFocus}
        tapToEdit={Boolean(rest.multiline)}
      />
    );
  }
  return (
    <View
      style={containerStyle}
      ref={(node) => {
        env.register(anchorKey, node);
      }}
    >
      <TextField
        {...rest}
        editable={lockedEditable}
        onFocus={handleFocus}
        tapToEdit={Boolean(rest.multiline)}
      />
    </View>
  );
}

export function HotelOnboardingWizard({
  propertyId,
  initialDraft,
  embedded = false,
  onSaved,
  onCancel,
  onOpenManagement,
}: {
  propertyId?: string | null;
  /** Cihazda bulunan otomatik taslak; kullanıcı devam etmeyi seçtiyse dolu gelir. */
  initialDraft?: HotelApplicationDraft | null;
  /** Yönetim paneli sekmesi içinde açıldığında kendi kaydırma alanını kurmaz. */
  embedded?: boolean;
  onSaved?: (id: string) => void;
  onCancel?: () => void;
  onOpenManagement?: (propertyId: string, tab: PmsTabKey) => void;
}) {
  const { theme } = useTheme();
  const session = useSession();
  const draftUserId = session?.user?.id ?? null;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(() =>
    Math.min(Math.max(initialDraft?.step ?? 0, 0), STEP_META.length - 1),
  );
  const [draft, setDraft] = useState<Draft>(() => initialDraft?.form ?? EMPTY_HOTEL_APPLICATION);
  const [savedId, setSavedId] = useState<string | null>(
    propertyId ?? initialDraft?.propertyId ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showMissing, setShowMissing] = useState(false);
  const [photoCount, setPhotoCount] = useState<number | null>(null);
  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>('idle');
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [showOptionalPolicies, setShowOptionalPolicies] = useState(false);
  const [scrollLocked, setScrollLocked] = useState(false);

  const locations = usePropertyLocationOptions();
  const districts = useMemo(() => locations.data ?? [], [locations.data]);
  const detail = usePropertyDetail(propertyId ?? savedId);
  const documents = usePropertyDocuments(savedId);
  const save = useSaveProperty();

  // ---------------------------------------------------------------------------
  // Zorunlu işletmeci kabul beyanı (Misafir Hakları Politikası)
  // ---------------------------------------------------------------------------
  const policy = usePolicyConsent(savedId);
  const acceptPolicy = useAcceptPolicy(savedId ?? '');
  const [consent, setConsent] = useState({
    terms: false,
    noMarriageCertificate: false,
    equalService: false,
  });
  const policyHydratedRef = useRef<string | null>(null);

  useEffect(() => {
    const data = policy.data;
    if (!data || data.accepted !== true) return;
    const key = `${data.slug}:${data.version}`;
    if (policyHydratedRef.current === key) return;
    policyHydratedRef.current = key;
    // Sunucuda bu sürüm için kabul varsa kutular işaretli gelir; kullanıcı
    // yine de değiştirebilir, gönderimde tekrar kaydedilir.
    setConsent({ terms: true, noMarriageCertificate: true, equalService: true });
  }, [policy.data]);

  const consentComplete = consent.terms && consent.noMarriageCertificate && consent.equalService;

  const openPolicy = () =>
    router.push({
      pathname: '/policy/[slug]',
      params: { slug: ACCOMMODATION_POLICY_SLUG },
    });

  // Sunucudan gelen veri formu yalnızca ilk açılışta doldurur; sonraki
  // yenilemeler kullanıcının o adımda yazdıklarını ezmez.
  const hydratedRef = useRef<string | null>(initialDraft?.propertyId ?? null);

  useEffect(() => {
    const data = detail.data;
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setServerMissing(data.missing);
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

  /** Alanı güncellerken kırmızı uyarıyı hemen kaldırır (kullanıcı düzeltmeye başladı). */
  const clearFieldError = useCallback((key: FieldKey) => {
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const patchField = (key: FieldKey, next: Partial<Draft>) => {
    patch(next);
    clearFieldError(key);
  };

  // ---------------------------------------------------------------------------
  // Kaydırma davranışı
  // ---------------------------------------------------------------------------
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const contentRef = useRef<ViewRef>(null);
  const offsetsRef = useRef<number[]>([]);
  const ignoreScrollRef = useRef(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorsRef = useRef<Partial<Record<FieldKey, ViewRef>>>({});

  const registerAnchor = useCallback((key: FieldKey, node: ViewRef | null) => {
    if (node) anchorsRef.current[key] = node;
    else delete anchorsRef.current[key];
  }, []);

  const lockFields = useCallback(() => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    setScrollLocked(true);
    // Emniyet supabı: kaydırma bitiş olayı gelmezse alanlar kilitli kalmasın.
    unlockTimer.current = setTimeout(() => setScrollLocked(false), 1200);
  }, []);

  const unlockFields = useCallback((delay = 160) => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => setScrollLocked(false), delay);
  }, []);

  useEffect(
    () => () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    },
    [],
  );

  /**
   * Adım değişince o adımda bıraktığı kaydırma konumuna dönülür. Böylece
   * "geri" ile dönen kullanıcı formun başına değil, kaldığı yere gelir.
   */
  useEffect(() => {
    if (embedded) return;
    ignoreScrollRef.current = true;
    const target = offsetsRef.current[step] ?? 0;
    const first = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: target, animated: false });
    }, 0);
    const release = setTimeout(() => {
      ignoreScrollRef.current = false;
    }, 180);
    return () => {
      clearTimeout(first);
      clearTimeout(release);
      ignoreScrollRef.current = false;
    };
  }, [embedded, step]);

  const scrollToField = useCallback(
    (key: FieldKey) => {
      if (embedded) return;
      const node = anchorsRef.current[key];
      const container = contentRef.current;
      if (!node || !container) return;
      node.measureLayout(
        container,
        (_x, y) => {
          const target = Math.max(0, y - 16);
          offsetsRef.current[step] = target;
          scrollRef.current?.scrollTo({ y: target, animated: true });
        },
        () => undefined,
      );
    },
    [embedded, step],
  );

  /** İlk eksik alana kaydırır: kullanıcı "neyi eklemedim?" diye aramak zorunda kalmaz. */
  const jumpToFirstMissing = useCallback(
    (keys: FieldKey[], errors: FieldErrors, delay = 90) => {
      if (embedded) return;
      const first = keys.find((key) => errors[key]);
      if (!first) return;
      setTimeout(() => scrollToField(first), delay);
    },
    [embedded, scrollToField],
  );

  // Odaklanan alanı klavyenin üstüne getir. Ekranın alt kısmına denk gelen
  // bir alan, klavye açıldığında görünür kalır.
  const focusedKeyRef = useRef<FieldKey | null>(null);
  useEffect(() => {
    if (embedded || Platform.OS === 'web') return;
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(eventName, () => {
      const key = focusedKeyRef.current;
      if (!key) return;
      setTimeout(() => scrollToField(key), 110);
    });
    return () => subscription.remove();
  }, [embedded, scrollToField]);

  const setFocusedField = useCallback((key: FieldKey) => {
    focusedKeyRef.current = key;
  }, []);

  const fieldEnv = useMemo(
    () => ({ locked: scrollLocked, register: registerAnchor, setFocused: setFocusedField }),
    [scrollLocked, registerAnchor, setFocusedField],
  );

  // ---------------------------------------------------------------------------
  // Doğrulama ve ilerleme
  // ---------------------------------------------------------------------------
  const documentCount = documents.data?.items.length ?? 0;
  const mediaCount = photoCount ?? detail.data?.counts.media ?? 0;

  const validationEnv = useMemo(
    () => ({ photoCount: mediaCount, documentCount }),
    [mediaCount, documentCount],
  );

  const filledField = (key: FieldKey) => validateField(key, draft, validationEnv) === null;

  const stepMissingFields = useCallback(
    (index: number) =>
      (STEP_REQUIRED[index] ?? []).filter(
        (key) => validateField(key, draft, validationEnv) !== null,
      ),
    [draft, validationEnv],
  );

  const currentMissing = stepMissingFields(step);

  const stepDone = (index: number) => {
    if (index === POLICY_CONSENT_STEP) return consentComplete;
    return stepMissingFields(index).length === 0;
  };

  const progress = useMemo(() => {
    const required = STEP_REQUIRED.flat();
    const total = required.length + 1;
    const filled = required.filter(
      (key) => validateField(key, draft, validationEnv) === null,
    ).length;
    const done = filled + (consentComplete ? 1 : 0);
    return { filled: done, total, percent: Math.round((done / total) * 100) };
  }, [draft, validationEnv, consentComplete]);

  const meta = STEP_META[step] ?? STEP_META[0]!;
  const hasCoordinates = Boolean(draft.lat.trim() && draft.lng.trim());
  const coordinatesVisible = showCoordinates || !hasCoordinates;

  const languageList = draft.languages
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const toggleLanguage = (language: string) => {
    const exists = languageList.some(
      (item) => item.toLocaleLowerCase('tr-TR') === language.toLocaleLowerCase('tr-TR'),
    );
    const next = exists
      ? languageList.filter(
          (item) => item.toLocaleLowerCase('tr-TR') !== language.toLocaleLowerCase('tr-TR'),
        )
      : [...languageList, language];
    patch({ languages: next.join(', ') });
  };

  const applyFieldErrors = (keys: FieldKey[], errors: FieldErrors) => {
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return { ...next, ...errors };
    });
  };

  const friendlyMissingMessage = (count: number) =>
    count === 1
      ? 'Bir alanı tamamlaman gerekiyor. Aşağıdaki bağlantıya dokunup doldurabilirsin.'
      : `${count} alanı tamamlaman gerekiyor. Aşağıdaki eksik bağlantılarına dokunarak alana gidebilirsin.`;

  const handlePhotosChange = useCallback(
    (count: number) => {
      setPhotoCount(count);
      if (count > 0) clearFieldError('photos');
    },
    [clearFieldError],
  );

  const goToStep = useCallback((index: number) => {
    const clamped = Math.min(Math.max(index, 0), STEP_META.length - 1);
    setError(null);
    setInfo(null);
    setShowMissing(false);
    setStep(clamped);
  }, []);

  // ---------------------------------------------------------------------------
  // Otomatik taslak
  // ---------------------------------------------------------------------------
  // Yeni başvuru akışında form her değiştiğinde sessizce cihaza yazılır.
  // Düzenleme ekranında (propertyId ile açılan) sunucu kaydı zaten mevcut
  // olduğu için otomatik taslak kapalıdır.
  const autoSaveEnabled = !propertyId;
  const clearedRef = useRef(false);
  const latestRef = useRef({ form: draft, step, propertyId: savedId });

  useEffect(() => {
    latestRef.current = { form: draft, step, propertyId: savedId };
  }, [draft, step, savedId]);

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

  // ---------------------------------------------------------------------------
  // Sunucu işlemleri
  // ---------------------------------------------------------------------------
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

  const persist = async (submit = false, options: { silent?: boolean } = {}) => {
    setError(null);
    if (!options.silent) setInfo(null);
    if (!draft.name.trim()) {
      setError('Tesis adı zorunludur.');
      return null;
    }
    // İlçe yalnızca doğrulamaya gönderirken zorunlu. Taslak kaydı ilçe
    // seçilmeden de yapılabilir.
    if (submit && !draft.district_id && !draft.district.trim()) {
      setError('Doğrulamaya göndermek için ilçe seçmelisin.');
      return null;
    }
    // Zorunlu işletmeci kabul beyanı tamamlanmadan başvuru gönderilemez.
    if (submit) {
      if (!savedId) {
        goToStep(0);
        setError('Başvuruyu göndermek için önce tesis taslağını kaydet.');
        return null;
      }
      if (!consentComplete) {
        goToStep(POLICY_CONSENT_STEP);
        setError('Başvuruyu göndermek için üç zorunlu kabul beyanını da onaylamalısın.');
        return null;
      }
      try {
        // Aynı sürüm daha önce kabul edildiyse gereksiz yazma yapılmaz.
        if (!policy.data?.accepted) {
          await acceptPolicy.mutateAsync(consent);
        }
      } catch (cause) {
        goToStep(POLICY_CONSENT_STEP);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Misafir hakları politikası onayı kaydedilemedi. Tekrar dene.',
        );
        return null;
      }
    }
    try {
      const result = await save.mutateAsync({ propertyId: savedId, payload, submit });
      setSavedId(result.id);
      setServerMissing(result.missing ?? []);
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
      } else if (!options.silent) {
        setInfo('Taslak kaydedildi. Kaldığın adımdan devam edebilirsin.');
      }
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tesis kaydedilemedi.');
      return null;
    }
  };

  /**
   * Fotoğraf veya belge yüklemeden önce tesisin sunucuda bir kimliği olmalı.
   * Kullanıcıyı "önce taslağı kaydet" uyarısıyla geri çevirmek yerine formu
   * sessizce kaydediyoruz; yükleme aynı akışta devam eder.
   */
  const ensureSaved = async (): Promise<string | null> => {
    if (savedId) return savedId;
    if (!draft.name.trim()) {
      goToStep(0);
      setError('Yükleme yapmak için önce tesis adını gir.');
      return null;
    }
    const result = await persist(false, { silent: true });
    return result?.id ?? null;
  };

  const next = async () => {
    setError(null);
    setInfo(null);
    const keys = STEP_REQUIRED[step] ?? [];
    const errors: FieldErrors = {};
    for (const key of keys) {
      const message = validateField(key, draft, validationEnv);
      if (message) errors[key] = message;
    }
    applyFieldErrors(keys, errors);
    if (Object.keys(errors).length > 0) {
      setShowMissing(true);
      jumpToFirstMissing(keys, errors);
      return;
    }
    setShowMissing(false);
    if (step === 0 && !savedId) {
      const result = await persist(false, { silent: true });
      if (!result) return;
    }
    setStep(Math.min(STEP_META.length - 1, step + 1));
  };

  /** Gönderimden önce bütün zorunlu alanları kontrol eder ve ilk eksiğe atlar. */
  const submitApplication = () => {
    setInfo(null);
    const allFields = STEP_REQUIRED.flat();
    const errors: FieldErrors = {};
    for (const key of allFields) {
      const message = validateField(key, draft, validationEnv);
      if (message) errors[key] = message;
    }
    setFieldErrors(errors);
    const keys = Object.keys(errors) as FieldKey[];
    if (keys.length > 0) {
      const firstStep = keys.reduce(
        (min, key) => Math.min(min, FIELD_STEP[key]),
        STEP_META.length - 1,
      );
      goToStep(firstStep);
      setShowMissing(true);
      setError(friendlyMissingMessage(keys.length));
      // Adım değişimi tamamlandıktan sonra ilk eksik alana kaydır.
      jumpToFirstMissing(keys, errors, 280);
      return;
    }
    setError(null);
    void (async () => {
      const result = await persist(true);
      if (result && !result.submitted) {
        setChecklistOpen(true);
      }
    })();
  };

  const errorMessageFor = (key: FieldKey) => fieldErrors[key] ?? null;

  const pickDocument = async (kind: string, title: string) => {
    setError(null);
    setInfo(null);
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
      const targetId = await ensureSaved();
      if (!targetId) return;
      const uploaded = await uploadAccommodationDocument({
        propertyId: targetId,
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? 'application/pdf',
        size: asset.size ?? null,
      });
      if (!uploaded.ok) {
        setError(uploaded.error.message);
        return;
      }
      const registered = await accApi.addPropertyDocument({
        propertyId: targetId,
        kind,
        title,
        storagePath: uploaded.data.path,
      });
      if (!registered.ok) {
        setError(registered.error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: accKeys.all });
      void documents.refetch();
      clearFieldError('documents');
      setInfo(`${title} yüklendi. Admin incelemesine gönderildi.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Belge yüklenemedi.');
    } finally {
      setUploadingKind(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Başvuru kontrolü paneli
  // ---------------------------------------------------------------------------
  const counts = detail.data?.counts;
  const externalRequirements: {
    key: string;
    label: string;
    count: number;
    tab: PmsTabKey;
    icon: IconName;
  }[] = [
    {
      key: 'room_types',
      label: 'Oda tipi',
      count: counts?.room_types ?? 0,
      tab: 'odalar',
      icon: 'bed-outline',
    },
    {
      key: 'rooms',
      label: 'Fiziksel oda',
      count: counts?.rooms ?? 0,
      tab: 'odalar',
      icon: 'business-outline',
    },
    {
      key: 'rate_plans',
      label: 'Fiyat planı',
      count: counts?.rate_plans ?? 0,
      tab: 'fiyat-planlari',
      icon: 'options-outline',
    },
  ];
  const externalMissing = externalRequirements.filter((item) => item.count === 0).length;
  const checklistMissing = STEP_META.reduce((total, _item, index) => {
    if (index === POLICY_CONSENT_STEP) return total + (consentComplete ? 0 : 1);
    return total + stepMissingFields(index).length;
  }, externalMissing);

  const openExternal = (tab: PmsTabKey) => {
    if (!savedId) return;
    setChecklistOpen(false);
    onOpenManagement?.(savedId, tab);
  };

  const loadingEdit = Boolean(propertyId) && detail.isLoading;

  if (loadingEdit) return <LoadingBlock height={240} />;

  const saveLabel =
    autoSaveState === 'saved' && autoSavedAt
      ? `Taslak kaydedildi · ${formatClock(autoSavedAt)}`
      : autoSaveState === 'saving'
        ? 'Taslak kaydediliyor…'
        : propertyId
          ? 'Değişiklikler otomatik taslak olarak saklanır'
          : 'Yazdıkların otomatik taslak olarak saklanır';

  const primaryLabel = step < STEP_META.length - 1 ? 'Devam' : 'Doğrulamaya gönder';

  const body = (
    <FieldEnvContext.Provider value={fieldEnv}>
      <View style={styles.stack}>
        {/* Adım başlığı + ilerleme */}
        <View
          style={[
            styles.hero,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <View style={styles.heroTop}>
            <View style={[styles.heroIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name={meta.icon} size={18} color={theme.colors.primaryDeep} />
            </View>
            <View style={styles.flex}>
              <AppText variant="overline" color="textTertiary" style={styles.overline}>
                {meta.overline}
              </AppText>
              <AppText variant="h2">{meta.title}</AppText>
            </View>
            <View style={[styles.percentPill, { backgroundColor: theme.colors.primarySoft }]}>
              <AppText
                variant="caption"
                style={{ color: theme.colors.primaryDeep, fontWeight: '700' }}
              >
                %{progress.percent}
              </AppText>
            </View>
          </View>

          <AppText variant="caption" color="textSecondary">
            {meta.hint}
          </AppText>

          <View style={styles.segments}>
            {STEP_META.map((item, index) => {
              const done = stepDone(index);
              const active = index === step;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${index + 1}. adım: ${item.title}${done ? ', tamamlandı' : ''}`}
                  onPress={() => goToStep(index)}
                  hitSlop={6}
                  style={styles.segmentTouch}
                >
                  <View
                    style={[
                      styles.segment,
                      {
                        backgroundColor:
                          active || done ? theme.colors.primary : theme.colors.surfaceMuted,
                        opacity: !active && !done ? 0.7 : 1,
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.heroFoot}>
            <AppText variant="caption" color="textTertiary">
              Adım {step + 1} / {STEP_META.length}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Başvuru kontrolü"
              onPress={() => setChecklistOpen(true)}
              style={({ pressed }) => [
                styles.checkButton,
                { backgroundColor: theme.colors.surfaceMuted, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="list-outline" size={14} color={theme.colors.primaryDeep} />
              <AppText variant="caption" style={{ color: theme.colors.primaryDeep }}>
                Başvuru kontrolü
              </AppText>
              {checklistMissing > 0 ? (
                <View style={[styles.checkDot, { backgroundColor: theme.colors.warning }]}>
                  <AppText variant="caption" style={styles.checkDotText}>
                    {checklistMissing}
                  </AppText>
                </View>
              ) : (
                <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
              )}
            </Pressable>
          </View>
        </View>

        {error ? <InlineError message={error} /> : null}
        {info ? <InfoBanner tone="success" text={info} /> : null}

        {step === 0 ? (
          <>
            <Section
              icon="business-outline"
              title="Tesis kimliği"
              subtitle="Vitrin kartında ve arama sonuçlarında görünen bilgiler."
            >
              <Field
                anchorKey="name"
                label="Tesis adı *"
                value={draft.name}
                onChangeText={(name) => patchField('name', { name })}
                placeholder="Örn. Uzungöl Bungalov"
                leftIcon="business-outline"
                error={errorMessageFor('name')}
                editable={!scrollLocked}
              />

              <View style={styles.block}>
                <AppText
                  variant="label"
                  color={errorMessageFor('name') ? 'danger' : 'textSecondary'}
                >
                  Tesis türü *
                </AppText>
                <View style={styles.typeGrid}>
                  {PROPERTY_TYPE_OPTIONS.map((option) => {
                    const active = draft.property_type === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={PROPERTY_TYPE_LABELS[option.value]}
                        onPress={() => patch({ property_type: option.value })}
                        style={({ pressed }) => [
                          styles.typeCard,
                          {
                            borderColor: active ? theme.colors.primary : theme.colors.border,
                            backgroundColor: active
                              ? theme.colors.primarySoft
                              : theme.colors.inputBackground,
                            opacity: pressed ? 0.85 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name={propertyTypeIcon(option.value)}
                          size={18}
                          color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
                        />
                        <AppText
                          variant="caption"
                          style={{
                            color: active ? theme.colors.primaryDeep : theme.colors.textSecondary,
                            fontWeight: '600',
                          }}
                        >
                          {option.label}
                        </AppText>
                        {active ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={14}
                            color={theme.colors.primary}
                          />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Field
                anchorKey="description"
                label="Açıklama *"
                value={draft.description}
                onChangeText={(description) => patchField('description', { description })}
                placeholder="Tesisinin öne çıkan özelliklerini 2-3 cümleyle anlat."
                hint={`${draft.description.trim().length} / 40 karakter`}
                hintTone={draft.description.trim().length >= 40 ? 'success' : 'neutral'}
                multiline
                error={errorMessageFor('description')}
                editable={!scrollLocked}
              />
            </Section>

            <Section
              icon="bed-outline"
              title="Konaklama düzeni"
              subtitle="Giriş-çıkış saatleri ve kapasite misafire gösterilir."
            >
              <View style={styles.row}>
                <Field
                  label="Giriş (check-in)"
                  value={draft.checkin_time}
                  onChangeText={(checkin_time) => patch({ checkin_time })}
                  placeholder="14:00"
                  containerStyle={styles.flex}
                  leftIcon="log-in-outline"
                  editable={!scrollLocked}
                />
                <Field
                  label="Çıkış (check-out)"
                  value={draft.checkout_time}
                  onChangeText={(checkout_time) => patch({ checkout_time })}
                  placeholder="11:00"
                  containerStyle={styles.flex}
                  leftIcon="log-out-outline"
                  editable={!scrollLocked}
                />
              </View>
              <Field
                label="Oda kapasitesi"
                value={draft.room_capacity}
                onChangeText={(room_capacity) =>
                  patch({ room_capacity: room_capacity.replace(/\D/g, '') })
                }
                keyboardType="number-pad"
                placeholder="Örn. 40"
                leftIcon="bed-outline"
                editable={!scrollLocked}
              />
              <View style={styles.block}>
                <AppText variant="label" color="textSecondary">
                  Konuşulan diller
                </AppText>
                <View style={styles.chipWrap}>
                  {LANGUAGE_PRESETS.map((language) => (
                    <Chip
                      key={language}
                      label={language}
                      active={languageList.some(
                        (item) =>
                          item.toLocaleLowerCase('tr-TR') === language.toLocaleLowerCase('tr-TR'),
                      )}
                      onPress={() => toggleLanguage(language)}
                    />
                  ))}
                </View>
                <Field
                  value={draft.languages}
                  onChangeText={(languages) => patch({ languages })}
                  placeholder="Türkçe, İngilizce"
                  hint="Virgülle ayırarak başka diller de ekleyebilirsin."
                  editable={!scrollLocked}
                />
              </View>
            </Section>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Section
              icon="location-outline"
              title="Konum"
              subtitle="İlçe ve mahalle listeleri Trabzon'a göre hazırdır."
            >
              <View ref={(node) => registerAnchor('district', node as ViewRef | null)}>
                <LocationPicker
                  districts={districts}
                  districtId={draft.district_id}
                  district={draft.district}
                  neighborhoodId={draft.neighborhood_id}
                  neighborhood={draft.neighborhood}
                  loading={locations.isLoading}
                  errorMessage={locations.isError ? locations.error.message : null}
                  validationError={errorMessageFor('district')}
                  onRetry={() => void locations.refetch()}
                  onChange={(nextLocation) => {
                    clearFieldError('district');
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
                    });
                    if (nextLocation.lat != null && nextLocation.lng != null) {
                      clearFieldError('map');
                    }
                  }}
                />
              </View>

              <Field
                anchorKey="address"
                label="Açık adres *"
                value={draft.address}
                onChangeText={(address) => patchField('address', { address })}
                placeholder="Cadde, sokak, kapı no"
                multiline
                leftIcon="map-outline"
                error={errorMessageFor('address')}
                editable={!scrollLocked}
              />

              <View
                ref={(node) => registerAnchor('map', node as ViewRef | null)}
                style={[
                  styles.coordsBox,
                  {
                    borderColor: errorMessageFor('map') ? theme.colors.danger : theme.colors.border,
                    backgroundColor: theme.colors.inputBackground,
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Harita konumunu düzenle"
                  onPress={() => setShowCoordinates((current) => !current)}
                  style={styles.coordsHead}
                >
                  <Ionicons
                    name={hasCoordinates ? 'checkmark-circle' : 'location-outline'}
                    size={17}
                    color={hasCoordinates ? theme.colors.success : theme.colors.warning}
                  />
                  <View style={styles.flex}>
                    <AppText variant="caption" style={{ fontWeight: '700' }}>
                      {hasCoordinates ? 'Harita konumu hazır' : 'Harita konumu gerekli'}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {hasCoordinates
                        ? `${draft.lat}, ${draft.lng}`
                        : 'İlçe seçince otomatik dolar; gerekirse elle gir.'}
                    </AppText>
                  </View>
                  <AppText variant="caption" color="primaryDeep">
                    {coordinatesVisible ? 'Gizle' : 'Düzenle'}
                  </AppText>
                </Pressable>
                {coordinatesVisible ? (
                  <View style={styles.row}>
                    <Field
                      label="Enlem (lat)"
                      value={draft.lat}
                      onChangeText={(lat) => patchField('map', { lat })}
                      placeholder="41.0027"
                      keyboardType="decimal-pad"
                      containerStyle={styles.flex}
                      error={errorMessageFor('map')}
                      editable={!scrollLocked}
                    />
                    <Field
                      label="Boylam (lng)"
                      value={draft.lng}
                      onChangeText={(lng) => patchField('map', { lng })}
                      placeholder="39.7168"
                      keyboardType="decimal-pad"
                      containerStyle={styles.flex}
                      editable={!scrollLocked}
                    />
                  </View>
                ) : null}
              </View>
            </Section>

            <Section
              icon="call-outline"
              title="İletişim"
              subtitle="Misafirlerin rezervasyon öncesi ulaşabileceği kanallar."
            >
              <Field
                anchorKey="phone"
                label="Telefon *"
                value={draft.phone}
                onChangeText={(phone) => patchField('phone', { phone })}
                placeholder="+90 462 000 00 00"
                keyboardType="phone-pad"
                leftIcon="call-outline"
                error={errorMessageFor('phone')}
                editable={!scrollLocked}
              />
              <Field
                anchorKey="email"
                label="E-posta *"
                value={draft.email}
                onChangeText={(email) => patchField('email', { email })}
                placeholder="resepsiyon@tesis.com"
                autoCapitalize="none"
                keyboardType="email-address"
                leftIcon="mail-outline"
                error={errorMessageFor('email')}
                editable={!scrollLocked}
              />
              <Field
                label="Web sitesi"
                value={draft.website}
                onChangeText={(website) => patch({ website })}
                placeholder="https://"
                autoCapitalize="none"
                leftIcon="globe-outline"
                editable={!scrollLocked}
              />
            </Section>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Section
              icon="receipt-outline"
              title="Fatura bilgileri"
              subtitle="Komisyon faturalandırması ve yasal belgeler için kullanılır."
            >
              <Field
                label="Vergi dairesi"
                value={draft.tax_office}
                onChangeText={(tax_office) => patch({ tax_office })}
                placeholder="Örn. Trabzon"
                leftIcon="document-text-outline"
                editable={!scrollLocked}
              />
              <Field
                anchorKey="tax"
                label="Vergi / TC kimlik no *"
                value={draft.tax_number}
                onChangeText={(tax_number) =>
                  patchField('tax', { tax_number: tax_number.replace(/[^\d]/g, '') })
                }
                keyboardType="number-pad"
                placeholder="10 veya 11 haneli"
                error={errorMessageFor('tax')}
                editable={!scrollLocked}
              />
              <Field
                label="Fatura unvanı"
                value={draft.invoice_title}
                onChangeText={(invoice_title) => patch({ invoice_title })}
                placeholder="Şirket / şahıs tam unvanı"
                editable={!scrollLocked}
              />
            </Section>

            <Section
              icon="person-outline"
              title="Yetkili kişi"
              subtitle="Doğrulama ekibi gerektiğinde bu kişiye ulaşır."
            >
              <Field
                anchorKey="contact_name"
                label="Adı soyadı *"
                value={draft.contact_name}
                onChangeText={(contact_name) => patchField('contact_name', { contact_name })}
                placeholder="Tesis yetkilisi"
                leftIcon="person-outline"
                error={errorMessageFor('contact_name')}
                editable={!scrollLocked}
              />
              <View style={styles.row}>
                <Field
                  label="Telefon"
                  value={draft.contact_phone}
                  onChangeText={(contact_phone) => patch({ contact_phone })}
                  keyboardType="phone-pad"
                  containerStyle={styles.flex}
                  editable={!scrollLocked}
                />
                <Field
                  label="E-posta"
                  value={draft.contact_email}
                  onChangeText={(contact_email) => patch({ contact_email })}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  containerStyle={styles.flex}
                  editable={!scrollLocked}
                />
              </View>
            </Section>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Section
              icon="sparkles-outline"
              title="Olanaklar"
              subtitle="Misafirlerin filtreleyebileceği hizmetler."
              right={
                <StatusPill
                  label={`${draft.amenities.length} seçili`}
                  color={theme.colors.primaryDeep}
                  background={theme.colors.primarySoft}
                />
              }
            >
              <View style={styles.chipWrap}>
                {AMENITIES.map((amenity) => {
                  const active = draft.amenities.includes(amenity);
                  return (
                    <Chip
                      key={amenity}
                      label={amenity}
                      icon={amenityIcon(amenity)}
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
            </Section>

            <Section
              icon="calendar-clear-outline"
              title="İptal politikası"
              subtitle="Rezervasyon onayından önce misafire gösterilir."
            >
              <View style={styles.chipWrap}>
                {CANCELLATION_PRESETS.map((preset) => (
                  <Chip
                    key={preset}
                    label={preset.replace(/\.$/, '')}
                    active={draft.cancellation_policy.trim() === preset}
                    onPress={() => patchField('cancellation', { cancellation_policy: preset })}
                  />
                ))}
              </View>
              <Field
                anchorKey="cancellation"
                value={draft.cancellation_policy}
                onChangeText={(cancellation_policy) =>
                  patchField('cancellation', { cancellation_policy })
                }
                placeholder="Örn. Girişten 48 saat öncesine kadar ücretsiz iptal."
                multiline
                error={errorMessageFor('cancellation')}
                editable={!scrollLocked}
              />
            </Section>

            <Section
              icon="options-outline"
              title="Diğer tesis kuralları"
              subtitle="Opsiyonel. Boş bırakabilirsin."
              collapsible
              collapsed={!showOptionalPolicies}
              onToggle={() => setShowOptionalPolicies((current) => !current)}
            >
              <Field
                label="Evcil hayvan politikası"
                value={draft.pet_policy}
                onChangeText={(pet_policy) => patch({ pet_policy })}
                placeholder="Örn. Küçük ırk evcil hayvanlar kabul edilir."
                multiline
                editable={!scrollLocked}
              />
              <Field
                label="Çocuk politikası"
                value={draft.child_policy}
                onChangeText={(child_policy) => patch({ child_policy })}
                placeholder="Örn. 6 yaş altı çocuklar ücretsizdir."
                multiline
                editable={!scrollLocked}
              />
              <Field
                label="Diğer kurallar"
                value={draft.general_rules}
                onChangeText={(general_rules) => patch({ general_rules })}
                placeholder="Sessizlik saatleri, sigara politikası vb."
                multiline
                editable={!scrollLocked}
              />
            </Section>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Section
              icon="images-outline"
              title="Tesis fotoğrafları"
              subtitle="En az 1 fotoğraf zorunlu. İlk fotoğraf vitrin kapağı olur."
            >
              <HotelPhotoUploader
                propertyId={savedId}
                ensurePropertyId={ensureSaved}
                onChanged={() => void detail.refetch()}
                onPhotosChange={handlePhotosChange}
                validationError={errorMessageFor('photos')}
              />
            </Section>

            <Section
              icon="document-attach-outline"
              title="Doğrulama belgeleri"
              subtitle="Belgeler gizli depolamada saklanır, yalnızca yetkililer görür."
              right={
                <StatusPill
                  label={`${documentCount} dosya`}
                  color={theme.colors.textSecondary}
                  background={theme.colors.surfaceMuted}
                  icon="documents-outline"
                />
              }
            >
              {errorMessageFor('documents') ? (
                <InlineError message={errorMessageFor('documents')!} />
              ) : null}

              <View style={styles.docList}>
                {REQUIRED_DOCUMENTS.map((requirement) => {
                  const existing = (documents.data?.items ?? []).filter(
                    (item) => item.kind === requirement.kind,
                  );
                  const latest = existing[0];
                  return (
                    <View
                      key={requirement.kind}
                      style={[styles.docRow, { borderColor: theme.colors.border }]}
                    >
                      <View
                        style={[
                          styles.docIcon,
                          {
                            backgroundColor: latest
                              ? theme.colors.successSoft
                              : theme.colors.surfaceMuted,
                          },
                        ]}
                      >
                        <Ionicons
                          name={
                            latest?.status === 'approved'
                              ? 'checkmark'
                              : latest
                                ? 'time-outline'
                                : 'document-attach-outline'
                          }
                          size={16}
                          color={
                            latest?.status === 'approved'
                              ? theme.colors.success
                              : latest
                                ? theme.colors.warning
                                : theme.colors.textTertiary
                          }
                        />
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong">{requirement.title}</AppText>
                        <AppText variant="caption" color="textTertiary">
                          {latest
                            ? `${formatDate(latest.created_at.slice(0, 10))} · ${documentStatusLabel(latest.status)}`
                            : requirement.hint}
                        </AppText>
                      </View>
                      <Button
                        label={latest ? 'Yenile' : 'Yükle'}
                        size="sm"
                        variant={latest ? 'ghost' : 'outline'}
                        fullWidth={false}
                        loading={uploadingKind === requirement.kind}
                        onPress={() => void pickDocument(requirement.kind, requirement.title)}
                      />
                    </View>
                  );
                })}
              </View>
            </Section>

            {detail.data ? (
              <Section icon="shield-checkmark-outline" title="Doğrulama durumu">
                <View style={styles.kvRow}>
                  <AppText variant="caption" color="textSecondary" style={styles.flex}>
                    Durum
                  </AppText>
                  <AppText variant="caption" style={{ fontWeight: '700' }}>
                    {detail.data.verification_status === 'verified'
                      ? 'Doğrulandı'
                      : detail.data.verification_status === 'pending'
                        ? 'İnceleniyor'
                        : detail.data.verification_status === 'rejected'
                          ? 'Reddedildi'
                          : 'Doğrulanmadı'}
                  </AppText>
                </View>
                {detail.data.verification_note ? (
                  <AppText variant="caption" color="textSecondary">
                    {detail.data.verification_note}
                  </AppText>
                ) : null}
              </Section>
            ) : null}
          </>
        ) : null}

        {step === POLICY_CONSENT_STEP ? (
          <>
            <Section
              icon="clipboard-outline"
              title="Başvuru özeti"
              subtitle="Bir alanı düzeltmek için satıra dokun."
            >
              <SummaryRow
                label="Tesis"
                value={draft.name.trim() || PROPERTY_TYPE_LABELS[draft.property_type]}
                done={Boolean(draft.name.trim())}
                onPress={() => goToStep(0)}
              />
              <SummaryRow
                label="Açıklama"
                value={
                  draft.description.trim().length >= 40
                    ? `${draft.description.trim().length} karakter`
                    : 'En az 40 karakter'
                }
                done={draft.description.trim().length >= 40}
                onPress={() => goToStep(0)}
              />
              <SummaryRow
                label="Konum"
                value={
                  [draft.neighborhood, draft.district].filter(Boolean).join(', ') ||
                  'İlçe seçilmedi'
                }
                done={filledField('district')}
                onPress={() => goToStep(1)}
              />
              <SummaryRow
                label="Adres"
                value={draft.address.trim() || 'Adres girilmedi'}
                done={filledField('address')}
                onPress={() => goToStep(1)}
              />
              <SummaryRow
                label="Telefon"
                value={draft.phone.trim() || 'Telefon girilmedi'}
                done={filledField('phone')}
                onPress={() => goToStep(1)}
              />
              <SummaryRow
                label="E-posta"
                value={draft.email.trim() || 'E-posta girilmedi'}
                done={filledField('email')}
                onPress={() => goToStep(1)}
              />
              <SummaryRow
                label="Ticari bilgiler"
                value={
                  draft.tax_number.trim()
                    ? `Vergi no ${draft.tax_number.trim()}`
                    : 'Vergi bilgisi girilmedi'
                }
                done={filledField('tax')}
                onPress={() => goToStep(2)}
              />
              <SummaryRow
                label="Yetkili"
                value={draft.contact_name.trim() || 'Yetkili girilmedi'}
                done={filledField('contact_name')}
                onPress={() => goToStep(2)}
              />
              <SummaryRow
                label="Olanaklar"
                value={`${draft.amenities.length} olanak`}
                done
                onPress={() => goToStep(3)}
              />
              <SummaryRow
                label="İptal politikası"
                value={draft.cancellation_policy.trim() || 'Tanımlanmadı'}
                done={filledField('cancellation')}
                onPress={() => goToStep(3)}
              />
              <SummaryRow
                label="Fotoğraf"
                value={`${mediaCount} fotoğraf`}
                done={mediaCount > 0}
                onPress={() => goToStep(4)}
              />
              <SummaryRow
                label="Belgeler"
                value={`${documentCount} dosya`}
                done={documentCount > 0}
                onPress={() => goToStep(4)}
              />
            </Section>

            <Section
              icon="layers-outline"
              title="Yayın için gerekenler"
              subtitle="Bu adımlar tesis yönetimi ekranlarında tamamlanır."
              right={
                <StatusPill
                  label={externalMissing > 0 ? `${externalMissing} eksik` : 'Hazır'}
                  color={externalMissing > 0 ? theme.colors.warning : theme.colors.success}
                  background={
                    externalMissing > 0 ? theme.colors.warningSoft : theme.colors.successSoft
                  }
                />
              }
            >
              {externalRequirements.map((requirement) => {
                const done = requirement.count > 0;
                return (
                  <View key={requirement.key} style={styles.externalRow}>
                    <View
                      style={[
                        styles.externalIcon,
                        {
                          backgroundColor: done
                            ? theme.colors.successSoft
                            : theme.colors.surfaceMuted,
                        },
                      ]}
                    >
                      <Ionicons
                        name={done ? 'checkmark' : requirement.icon}
                        size={15}
                        color={done ? theme.colors.success : theme.colors.textTertiary}
                      />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="body">{requirement.label}</AppText>
                      <AppText variant="caption" color="textTertiary">
                        {done ? `${requirement.count} kayıt` : 'Henüz eklenmedi'}
                      </AppText>
                    </View>
                    {savedId && onOpenManagement ? (
                      <Button
                        label={done ? 'Aç' : 'Ekle'}
                        size="sm"
                        variant={done ? 'ghost' : 'outline'}
                        fullWidth={false}
                        onPress={() => openExternal(requirement.tab)}
                      />
                    ) : (
                      <AppText variant="caption" color="textTertiary">
                        Yönetim panelinde
                      </AppText>
                    )}
                  </View>
                );
              })}
              {!savedId ? (
                <AppText variant="caption" color="textTertiary">
                  Taslak kaydedildikten sonra oda tipi, oda ve fiyat planlarını Otel Yönetimi
                  ekranından ekleyebilirsin.
                </AppText>
              ) : null}
            </Section>

            <Section
              icon="shield-checkmark-outline"
              title="Zorunlu işletmeci beyanı"
              subtitle={
                policy.data?.version
                  ? `Misafir Hakları Politikası · sürüm ${policy.data.version}`
                  : 'Trabzone Misafir Hakları Politikası'
              }
              right={
                policy.data?.accepted ? (
                  <StatusPill
                    label="Onaylandı"
                    color={theme.colors.success}
                    background={theme.colors.successSoft}
                    icon="checkmark-circle"
                  />
                ) : (
                  <StatusPill
                    label="Onay bekliyor"
                    color={theme.colors.warning}
                    background={theme.colors.warningSoft}
                  />
                )
              }
            >
              <AppText variant="caption" color="textSecondary">
                Trabzone Konaklama&apos;ya katılan tesisler misafirlere eşit, saygılı ve
                ayrımcılıktan uzak hizmet sunar. Yetişkin misafirlerden evlilik cüzdanı istenemez;
                bekâr olmaları veya aralarında evlilik bağı bulunmaması rezervasyonun reddi için
                gerekçe olamaz. Yasal kimlik bildirimi ve güvenlik yükümlülükleri saklıdır.{' '}
                <AppText
                  variant="caption"
                  color="primaryDeep"
                  onPress={openPolicy}
                  accessibilityRole="link"
                >
                  Tam metni oku
                </AppText>
              </AppText>

              <ConsentCheckRow
                checked={consent.terms}
                onToggle={() => setConsent((current) => ({ ...current, terms: !current.terms }))}
                title="Politikayı okudum ve kabul ediyorum."
                description="Misafir Hakları, Eşit Konaklama ve İşletmeci Yükümlülükleri Politikası tesisim için bağlayıcıdır."
              />
              <ConsentCheckRow
                checked={consent.noMarriageCertificate}
                onToggle={() =>
                  setConsent((current) => ({
                    ...current,
                    noMarriageCertificate: !current.noMarriageCertificate,
                  }))
                }
                title="Evlilik cüzdanı talep etmeyeceğim."
                description="Yetişkin misafirlerden medeni durum belgesi istenmez; aynı fiyat ve koşullar uygulanır."
              />
              <ConsentCheckRow
                checked={consent.equalService}
                onToggle={() =>
                  setConsent((current) => ({
                    ...current,
                    equalService: !current.equalService,
                  }))
                }
                title="Eşit ve ayrımcılıktan uzak hizmet sunacağım."
                description="Yasal kimlik bildirimi ve güvenlik yükümlülüklerine uyarak tüm misafirlere eşit hizmet sunacağım."
              />

              {policy.data?.accepted && policy.data.accepted_at ? (
                <AppText variant="caption" color="textTertiary">
                  Politika sürüm {policy.data.version} bu tesis için{' '}
                  {formatDate(policy.data.accepted_at.slice(0, 10))} tarihinde kabul edildi.
                </AppText>
              ) : null}
              {policy.isError ? (
                <AppText variant="caption" color="textTertiary">
                  Politika kabul durumu okunamadı; gönderim sırasında sunucu tekrar kontrol edilir.
                </AppText>
              ) : null}
            </Section>

            {serverMissing.length > 0 ? (
              <InfoBanner
                tone="warning"
                text={`Sunucu doğrulamasında ${serverMissing.length} eksik görünüyor. Başvuru kontrolünden tek tek düzeltebilirsin.`}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </FieldEnvContext.Provider>
  );

  const footer = (
    <View
      style={[
        styles.footer,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.divider,
        },
      ]}
    >
      <View style={styles.footerMeta}>
        <View style={styles.footerMetaLeft}>
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
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
            {saveLabel}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Taslak kaydet"
          disabled={save.isPending}
          onPress={() => void persist(false)}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <AppText variant="caption" color="primaryDeep">
            Taslak kaydet
          </AppText>
        </Pressable>
      </View>

      {showMissing && currentMissing.length > 0 ? (
        <View style={[styles.missingRow, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="alert-circle" size={14} color={theme.colors.danger} />
          <AppText variant="caption" color="danger">
            Eksik:
          </AppText>
          <View style={styles.missingLinks}>
            {currentMissing.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${FIELD_LABEL[key]} alanına git`}
                onPress={() => scrollToField(key)}
                hitSlop={6}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <AppText variant="caption" style={styles.missingLink}>
                  {FIELD_LABEL[key]}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.footerActions}>
        {step > 0 || onCancel ? (
          <Button
            label={step > 0 ? 'Geri' : 'Vazgeç'}
            variant="ghost"
            fullWidth={false}
            leftIcon={
              step > 0 ? (
                <Ionicons name="chevron-back" size={16} color={theme.colors.textSecondary} />
              ) : undefined
            }
            onPress={() => {
              if (step > 0) goToStep(step - 1);
              else onCancel?.();
            }}
            style={styles.backButton}
          />
        ) : null}
        <Button
          label={primaryLabel}
          onPress={() => {
            if (step < STEP_META.length - 1) void next();
            else submitApplication();
          }}
          loading={save.isPending}
          rightIcon={
            step < STEP_META.length - 1 ? (
              <Ionicons name="arrow-forward" size={16} color={theme.colors.onPrimary} />
            ) : (
              <Ionicons name="send" size={15} color={theme.colors.onPrimary} />
            )
          }
          style={styles.primaryButton}
        />
      </View>
    </View>
  );

  return (
    <View style={styles.flex}>
      {embedded ? (
        <View style={styles.stack}>
          {body}
          {footer}
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingHorizontal: theme.layout.screenPadding },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScrollBeginDrag={lockFields}
            onScrollEndDrag={() => unlockFields()}
            onMomentumScrollBegin={lockFields}
            onMomentumScrollEnd={() => unlockFields(80)}
            onScroll={(event) => {
              if (ignoreScrollRef.current) return;
              offsetsRef.current[step] = event.nativeEvent.contentOffset.y;
            }}
          >
            <View ref={contentRef} collapsable={false}>
              {body}
            </View>
          </ScrollView>
          {footer}
        </>
      )}

      <ModalSheet
        visible={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        title="Başvuru kontrolü"
        subtitle={
          checklistMissing > 0
            ? `${checklistMissing} eksik · %${progress.percent} form tamam`
            : `Her şey hazır · %${progress.percent} form tamam`
        }
        maxWidth={620}
      >
        <View style={styles.checklist}>
          {STEP_META.map((item, index) => {
            const missing =
              index === POLICY_CONSENT_STEP
                ? consentComplete
                  ? []
                  : ['Onay beyanları']
                : stepMissingFields(index).map((key) => FIELD_LABEL[key]);
            const done = missing.length === 0;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={`${index + 1}. adım: ${item.title}`}
                onPress={() => {
                  setChecklistOpen(false);
                  goToStep(index);
                }}
                style={({ pressed }) => [
                  styles.checklistRow,
                  {
                    borderColor: done ? theme.colors.border : theme.colors.warningSoft,
                    backgroundColor: done ? theme.colors.surface : theme.colors.warningSoft,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.checklistIcon,
                    {
                      backgroundColor: done ? theme.colors.successSoft : theme.colors.surface,
                    },
                  ]}
                >
                  <Ionicons
                    name={done ? 'checkmark' : 'alert'}
                    size={15}
                    color={done ? theme.colors.success : theme.colors.warning}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{item.title}</AppText>
                  <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                    {done ? 'Tamamlandı' : `Eksik: ${missing.join(', ')}`}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
              </Pressable>
            );
          })}
        </View>

        <AppText variant="overline" color="textTertiary" style={styles.checklistOverline}>
          YAYIN İÇİN GEREKENLER
        </AppText>
        <View style={styles.checklist}>
          {externalRequirements.map((requirement) => {
            const done = requirement.count > 0;
            return (
              <View
                key={requirement.key}
                style={[
                  styles.checklistRow,
                  {
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface,
                  },
                ]}
              >
                <View
                  style={[
                    styles.checklistIcon,
                    {
                      backgroundColor: done ? theme.colors.successSoft : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <Ionicons
                    name={done ? 'checkmark' : requirement.icon}
                    size={15}
                    color={done ? theme.colors.success : theme.colors.textTertiary}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{requirement.label}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {done ? `${requirement.count} kayıt` : 'Tesis yönetiminde eklenmeli'}
                  </AppText>
                </View>
                {savedId && onOpenManagement ? (
                  <Button
                    label={done ? 'Aç' : 'Ekle'}
                    size="sm"
                    variant={done ? 'ghost' : 'outline'}
                    fullWidth={false}
                    onPress={() => openExternal(requirement.tab)}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
        <AppText variant="caption" color="textTertiary">
          Oda tipi, fiziksel oda ve fiyat planı olmadan başvuru doğrulamaya gönderilemez. Bunlar
          Otel Yönetimi › Odalar ve Fiyat Planları ekranlarından tamamlanır.
        </AppText>
      </ModalSheet>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Yerel görsel bileşenler
// -----------------------------------------------------------------------------

function Section({
  icon,
  title,
  subtitle,
  right,
  children,
  collapsible = false,
  collapsed = false,
  onToggle,
  style,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const head = (
    <View style={styles.sectionHead}>
      <View style={[styles.sectionIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={17} color={theme.colors.primaryDeep} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color="textTertiary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {collapsible ? (
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={17}
          color={theme.colors.textTertiary}
        />
      ) : null}
    </View>
  );
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      {collapsible && onToggle ? (
        <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onToggle}>
          {head}
        </Pressable>
      ) : (
        head
      )}
      {collapsed ? null : <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

function SummaryRow({
  label,
  value,
  done,
  onPress,
}: {
  label: string;
  value: string;
  done: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Düzenle`}
      onPress={onPress}
      style={({ pressed }) => [styles.summaryRow, { opacity: pressed ? 0.65 : 1 }]}
    >
      <Ionicons
        name={done ? 'checkmark-circle' : 'alert-circle-outline'}
        size={16}
        color={done ? theme.colors.success : theme.colors.warning}
      />
      <AppText variant="caption" color="textSecondary" style={styles.summaryLabel}>
        {label}
      </AppText>
      <AppText
        variant="caption"
        color={done ? 'text' : 'textTertiary'}
        style={styles.summaryValue}
        numberOfLines={1}
      >
        {value}
      </AppText>
      <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

function ConsentCheckRow({
  checked,
  onToggle,
  title,
  description,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  description: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.consentRow,
        {
          borderColor: checked ? theme.colors.success : theme.colors.border,
          backgroundColor: checked ? theme.colors.successSoft : theme.colors.surface,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.consentCheck,
          {
            borderColor: checked ? theme.colors.success : theme.colors.borderStrong,
            backgroundColor: checked ? theme.colors.success : 'transparent',
          },
        ]}
      >
        {checked ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" style={{ fontWeight: '700' }}>
          {title}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {description}
        </AppText>
      </View>
    </Pressable>
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
  flex: { flex: 1 },
  stack: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  block: { gap: 6 },
  scrollContent: { paddingTop: 4, paddingBottom: 24, gap: 12 },

  hero: {
    gap: 10,
    padding: 14,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overline: { fontSize: 9, letterSpacing: 1.6, marginBottom: 1 },
  percentPill: {
    minWidth: 46,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'center',
  },
  segments: { flexDirection: 'row', gap: 4 },
  segmentTouch: { flex: 1, paddingVertical: 4 },
  segment: { height: 5, borderRadius: 3 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
  },
  checkDot: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  checkDotText: { color: '#FFFFFF', fontSize: 9, fontWeight: '700' },

  section: {
    gap: 0,
    padding: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionBody: { gap: 10, paddingTop: 12 },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    minHeight: 40,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  coordsBox: { borderRadius: 12, borderWidth: 1, padding: 10, gap: 10 },
  coordsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  docList: { gap: 8 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  docIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kvRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  externalRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 },
  externalIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    minHeight: 36,
  },
  summaryLabel: { width: 92 },
  summaryValue: { flex: 1, textAlign: 'right' },

  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  consentCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },

  footer: {
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerMetaLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backButton: { minWidth: 84, paddingHorizontal: 12 },
  primaryButton: { flex: 1 },
  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 9,
    flexWrap: 'wrap',
  },
  missingLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  missingLink: {
    color: '#2F55D4',
    textDecorationLine: 'underline',
  },

  checklist: { gap: 7 },
  checklistOverline: { marginTop: 4, fontSize: 9, letterSpacing: 1.4 },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  checklistIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
