import type { District, ExternalPlaceSuggestion } from '../types';

/**
 * Harici harita sonuçlarını Trabzone formuna eşler.
 *
 * Google/Apple kendi kategori kodlarını ve adres biçimlerini döndürür.
 * Buradaki yardımcılar, seçilen işletmenin Trabzone kategorisini ve
 * ilçe/mahalle kaydını tahmin eder; kullanıcı yine de değiştirebilir.
 */

/** Türkçe karakterleri sadeleştirip karşılaştırılabilir metne çevirir. */
export function normalizeTr(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(value: string): string[] {
  const normalized = normalizeTr(value);
  return normalized.length > 0 ? normalized.split(' ') : [];
}

/**
 * Sağlayıcı tipi/kategori etiketini Trabzone kategori slug'ına eşler.
 * `categories` bootstrap'tan gelen düz liste (ebeveyn + alt kategoriler).
 */
export function matchCategorySlug(
  item: Pick<ExternalPlaceSuggestion, 'category' | 'types'>,
  categories: readonly { slug: string; name: string }[],
): string | null {
  const available = new Set(categories.map((category) => category.slug));
  const candidates = [item.category ?? '', ...item.types];

  for (const candidate of candidates) {
    const tokens = words(candidate);
    if (tokens.length === 0) {
      continue;
    }
    const joined = ` ${tokens.join(' ')} `;
    for (const rule of CATEGORY_RULES) {
      if (!available.has(rule.slug)) {
        continue;
      }
      const matched = rule.keywords.some((keyword) => {
        const normalized = normalizeTr(keyword);
        if (!normalized) {
          return false;
        }
        return normalized.includes(' ')
          ? joined.includes(` ${normalized} `)
          : tokens.includes(normalized);
      });
      if (matched) {
        return rule.slug;
      }
    }
  }

  // Son çare: sağlayıcının kategori etiketi Trabzone kategori adının
  // içinde geçiyorsa (örn. "Kafe" → "Kafeler") onu kullan.
  const label = normalizeTr(item.category ?? '');
  if (label.length >= 3) {
    const found = categories.find((category) => {
      const name = normalizeTr(category.name);
      return name.includes(label) || label.includes(name);
    });
    if (found) {
      return found.slug;
    }
  }
  return null;
}

type CategoryRule = { slug: string; keywords: string[] };

/**
 * Sıra önemli: daha özel kurallar (kahvaltı, fırın) genel olanlardan
 * (restoran, market) önce gelir. Eşleşme kelime bazındadır; "otopark"
 * kelimesi "park" kuralını tetiklemez.
 */
const CATEGORY_RULES: CategoryRule[] = [
  { slug: 'kahvalti', keywords: ['kahvalti', 'breakfast', 'breakfast_restaurant'] },
  { slug: 'firin', keywords: ['firin', 'bakery', 'baker', 'ekmek'] },
  {
    slug: 'pastane',
    keywords: ['pastane', 'patisserie', 'dessert_shop', 'ice_cream_shop', 'dondurma'],
  },
  { slug: 'kafe', keywords: ['kafe', 'cafe', 'coffee_shop', 'coffee', 'kahve'] },
  {
    slug: 'lokanta',
    keywords: [
      'lokanta',
      'lokantasi',
      'fast_food',
      'doner',
      'kebap',
      'pide',
      'lahmacun',
      'bufe',
      'esnaf',
    ],
  },
  {
    slug: 'restoran',
    keywords: ['restoran', 'restaurant', 'steak_house', 'seafood_restaurant', 'pizza_restaurant'],
  },
  { slug: 'bungalov', keywords: ['bungalov', 'bungalow', 'tiny_house'] },
  { slug: 'apart-otel', keywords: ['apart', 'aparthotel', 'apart_otel'] },
  { slug: 'pansiyon', keywords: ['pansiyon', 'guest_house', 'guesthouse', 'hostel'] },
  { slug: 'otel', keywords: ['otel', 'hotel', 'lodging', 'resort_hotel', 'motel'] },
  {
    slug: 'market',
    keywords: ['market', 'supermarket', 'grocery_store', 'convenience_store', 'bakkal'],
  },
  {
    slug: 'giyim',
    keywords: ['giyim', 'clothing_store', 'clothing', 'butik', 'shoes', 'shoe_store'],
  },
  {
    slug: 'elektronik',
    keywords: ['elektronik', 'electronics_store', 'electronics', 'phone_store', 'computer_store'],
  },
  { slug: 'mobilya', keywords: ['mobilya', 'furniture_store', 'furniture'] },
  { slug: 'kuyumcu', keywords: ['kuyumcu', 'jewelry_store', 'jewelry', 'altin'] },
  { slug: 'avm', keywords: ['avm', 'shopping_mall', 'department_store', 'alisveris_merkezi'] },
  { slug: 'berber', keywords: ['berber', 'barber', 'barber_shop'] },
  { slug: 'kuafor', keywords: ['kuafor', 'hair_salon', 'hair_care', 'hairdresser'] },
  {
    slug: 'guzellik-salonu',
    keywords: ['guzellik', 'beauty_salon', 'beauty', 'spa', 'nail_salon'],
  },
  {
    slug: 'oto-servis',
    keywords: ['oto_servis', 'car_repair', 'auto_repair', 'tire_shop', 'car_wash'],
  },
  { slug: 'arac-kiralama', keywords: ['arac_kiralama', 'car_rental', 'rent_a_car'] },
  { slug: 'emlak-ofisi', keywords: ['emlak', 'real_estate_agency', 'real_estate'] },
  {
    slug: 'teknik-servis',
    keywords: ['teknik_servis', 'phone_repair', 'electronics_repair', 'repair_shop'],
  },
  { slug: 'spor-salonu', keywords: ['spor_salonu', 'gym', 'fitness_center', 'fitness'] },
  { slug: 'eczane', keywords: ['eczane', 'pharmacy', 'drugstore'] },
  {
    slug: 'saglik',
    keywords: ['saglik', 'hospital', 'doctor', 'dentist', 'clinic', 'medical_center'],
  },
  { slug: 'banka', keywords: ['banka', 'bank', 'atm', 'finance'] },
  { slug: 'otopark', keywords: ['otopark', 'parking', 'parking_lot'] },
  {
    slug: 'kamu',
    keywords: [
      'kamu',
      'city_hall',
      'local_government',
      'police',
      'post_office',
      'government_office',
    ],
  },
  { slug: 'park', keywords: ['park', 'national_park', 'playground'] },
  {
    slug: 'tarihi-kulturel',
    keywords: ['muze', 'museum', 'historical', 'tarihi', 'kulturel', 'monument', 'castle'],
  },
  {
    slug: 'turistik-yer',
    keywords: ['turistik', 'tourist_attraction', 'tourist', 'observation_deck', 'zoo', 'aquarium'],
  },
  { slug: 'gezilecek-nokta', keywords: ['gezilecek', 'attraction', 'viewpoint', 'picnic_area'] },
];

function hasWord(haystack: string, needle: string): boolean {
  const normalized = normalizeTr(needle);
  if (!normalized) {
    return false;
  }
  return ` ${haystack} `.includes(` ${normalized} `);
}

/**
 * Adresteki ilçe/mahalle adlarını Trabzone kayıtlarıyla eşler.
 * Eşleşme bulunamazsa null döner; kullanıcı seçimi kendisi yapar.
 */
export function matchAdministrative(
  address: string,
  districts: readonly District[],
): { districtId: number | null; neighborhoodId: number | null } {
  const text = normalizeTr(address);
  if (!text || districts.length === 0) {
    return { districtId: null, neighborhoodId: null };
  }

  // En uzun ad eşleşmesi kazanır ("Ortahisar" > "Hisar" gibi durumlar için).
  const byLength = [...districts].sort(
    (a, b) => normalizeTr(b.name).length - normalizeTr(a.name).length,
  );
  const district = byLength.find((item) => hasWord(text, item.name)) ?? null;
  if (!district) {
    return { districtId: null, neighborhoodId: null };
  }

  // Adresin virgülle ayrılmış ilk parçaları genellikle mahalle adıdır.
  const segments = address
    .split(',')
    .map((part) => normalizeTr(part))
    .filter((part) => part.length > 0);
  const neighborhood =
    district.neighborhoods.find((item) => segments.includes(normalizeTr(item.name))) ??
    district.neighborhoods.find((item) => hasWord(text, item.name)) ??
    null;

  return { districtId: district.id, neighborhoodId: neighborhood?.id ?? null };
}
