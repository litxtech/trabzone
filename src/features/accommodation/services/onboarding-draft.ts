import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PropertyType } from '../types';

/**
 * Otel başvuru formunun cihaz üzerinde tutulan otomatik taslağı.
 *
 * Kullanıcı formu doldururken uygulama her değişiklikte sessizce bu taslağı
 * yazar. Böylece yanlışlıkla geri gidilse, uygulama kapansa veya sayfa
 * yenilense bile girilen bilgiler kaybolmaz. Başvuru sayfası yeniden
 * açıldığında kullanıcıya "kaldığın yerden devam et" ya da "yeni başvuru"
 * seçeneği sunulur.
 */

export type HotelApplicationForm = {
  name: string;
  property_type: PropertyType;
  description: string;
  district_id: number | null;
  district: string;
  neighborhood_id: number | null;
  neighborhood: string;
  address: string;
  lat: string;
  lng: string;
  phone: string;
  email: string;
  website: string;
  tax_office: string;
  tax_number: string;
  invoice_title: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  room_capacity: string;
  checkin_time: string;
  checkout_time: string;
  languages: string;
  amenities: string[];
  cancellation_policy: string;
  pet_policy: string;
  child_policy: string;
  general_rules: string;
};

export type HotelApplicationDraft = {
  version: 1;
  updatedAt: number;
  step: number;
  /** Başvuru sunucuda taslak olarak kaydedildiyse tesis kimliği. */
  propertyId: string | null;
  form: HotelApplicationForm;
};

export const HOTEL_APPLICATION_STEPS = [
  'Temel bilgiler',
  'Konum ve iletişim',
  'Ticari bilgiler',
  'Olanaklar ve kurallar',
  'Belgeler ve doğrulama',
] as const;

export const EMPTY_HOTEL_APPLICATION: HotelApplicationForm = {
  name: '',
  property_type: 'hotel',
  description: '',
  district_id: null,
  district: '',
  neighborhood_id: null,
  neighborhood: '',
  address: '',
  lat: '',
  lng: '',
  phone: '',
  email: '',
  website: '',
  tax_office: '',
  tax_number: '',
  invoice_title: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  room_capacity: '',
  checkin_time: '14:00',
  checkout_time: '11:00',
  languages: 'Türkçe',
  amenities: [],
  cancellation_policy: '',
  pet_policy: '',
  child_policy: '',
  general_rules: '',
};

const STORAGE_PREFIX = 'trabzone.accommodation.application-draft.v1';
const MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;
const PROPERTY_TYPES: PropertyType[] = ['hotel', 'bungalow', 'apartment', 'pension', 'villa'];

function storageKey(userId: string | null | undefined) {
  return `${STORAGE_PREFIX}.${userId || 'anon'}`;
}

const asText = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asTextArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const asNumberOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function asPropertyType(value: unknown): PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as string[]).includes(value)
    ? (value as PropertyType)
    : 'hotel';
}

/** Eski/bozuk kayıtları da güvenle okuyabilmek için her alanı tek tek normalize eder. */
function normalizeForm(value: unknown): HotelApplicationForm {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    name: asText(record.name),
    property_type: asPropertyType(record.property_type),
    description: asText(record.description),
    district_id: asNumberOrNull(record.district_id),
    district: asText(record.district),
    neighborhood_id: asNumberOrNull(record.neighborhood_id),
    neighborhood: asText(record.neighborhood),
    address: asText(record.address),
    lat: asText(record.lat),
    lng: asText(record.lng),
    phone: asText(record.phone),
    email: asText(record.email),
    website: asText(record.website),
    tax_office: asText(record.tax_office),
    tax_number: asText(record.tax_number),
    invoice_title: asText(record.invoice_title),
    contact_name: asText(record.contact_name),
    contact_phone: asText(record.contact_phone),
    contact_email: asText(record.contact_email),
    room_capacity: asText(record.room_capacity),
    checkin_time: asText(record.checkin_time, EMPTY_HOTEL_APPLICATION.checkin_time),
    checkout_time: asText(record.checkout_time, EMPTY_HOTEL_APPLICATION.checkout_time),
    languages: asText(record.languages, EMPTY_HOTEL_APPLICATION.languages),
    amenities: asTextArray(record.amenities),
    cancellation_policy: asText(record.cancellation_policy),
    pet_policy: asText(record.pet_policy),
    child_policy: asText(record.child_policy),
    general_rules: asText(record.general_rules),
  };
}

/**
 * Taslak olarak saklamaya değer bir bilgi girildi mi? Boş form her açılışta
 * "yarım kalan başvuru" uyarısı göstermemeli.
 */
export function hasHotelApplicationContent(form: HotelApplicationForm): boolean {
  return Boolean(
    form.name.trim() ||
      form.description.trim() ||
      form.district.trim() ||
      form.district_id ||
      form.address.trim() ||
      form.phone.trim() ||
      form.email.trim() ||
      form.tax_office.trim() ||
      form.tax_number.trim() ||
      form.invoice_title.trim() ||
      form.contact_name.trim() ||
      form.contact_phone.trim() ||
      form.contact_email.trim() ||
      form.room_capacity.trim() ||
      form.website.trim() ||
      form.amenities.length > 0 ||
      form.cancellation_policy.trim() ||
      form.pet_policy.trim() ||
      form.child_policy.trim() ||
      form.general_rules.trim(),
  );
}

const PROGRESS_FIELDS: ((form: HotelApplicationForm) => boolean)[] = [
  (form) => Boolean(form.name.trim()),
  (form) => form.description.trim().length >= 40,
  (form) => Boolean(form.district_id || form.district.trim()),
  (form) => Boolean(form.address.trim()),
  (form) => Boolean(form.phone.trim()),
  (form) => Boolean(form.email.trim()),
  (form) => Boolean(form.tax_number.trim()),
  (form) => Boolean(form.invoice_title.trim()),
  (form) => Boolean(form.contact_name.trim()),
  (form) => form.amenities.length > 0,
];

/** Başvuru kartındaki tamamlanma göstergesi. */
export function hotelApplicationProgress(form: HotelApplicationForm) {
  const filled = PROGRESS_FIELDS.filter((check) => check(form)).length;
  const total = PROGRESS_FIELDS.length;
  return { filled, total, percent: Math.round((filled / total) * 100) };
}

export async function readHotelApplicationDraft(
  userId: string | null | undefined,
): Promise<HotelApplicationDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) {
      return null;
    }
    const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : 0;
    if (!updatedAt || Date.now() - updatedAt > MAX_AGE_MS) {
      return null;
    }
    const form = normalizeForm(record.form);
    if (!hasHotelApplicationContent(form)) {
      return null;
    }
    const rawStep = typeof record.step === 'number' ? Math.round(record.step) : 0;
    return {
      version: 1,
      updatedAt,
      step: Math.min(Math.max(rawStep, 0), HOTEL_APPLICATION_STEPS.length - 1),
      propertyId: typeof record.propertyId === 'string' && record.propertyId ? record.propertyId : null,
      form,
    };
  } catch {
    return null;
  }
}

export async function writeHotelApplicationDraft(
  userId: string | null | undefined,
  draft: Omit<HotelApplicationDraft, 'version' | 'updatedAt'>,
): Promise<void> {
  try {
    const payload: HotelApplicationDraft = {
      version: 1,
      updatedAt: Date.now(),
      step: draft.step,
      propertyId: draft.propertyId,
      form: draft.form,
    };
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(payload));
  } catch {
    // Depolama reddedilirse form akışı bozulmaz; sunucu kaydı yine çalışır.
  }
}

export async function clearHotelApplicationDraft(userId: string | null | undefined): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId));
  } catch {
    // Sessizce yut: temizlik başarısız olsa da akış devam eder.
  }
}
