import { PROVINCES, normalizeForSearch } from '@/features/profile/constants/regions';

/**
 * Reklam hedeflemesinde kullanılan şehir/ilçe kataloğu.
 *
 * Enlem-boylam girişi kaldırıldı: yönetici şehir seçer, ardından o şehirdeki
 * ilçeleri işaretler. İlçe seçilmezse kampanya şehir genelinde yayınlanır.
 */

export type AdDistrict = {
  name: string;
  population: number;
  /** Haritada "yaklaşık konum" olarak kullanılan ilçe merkezi. */
  lat: number;
  lng: number;
};

export const TRABZON_CITY = 'Trabzon';

/** 81 il — profil şehir seçimiyle aynı kaynak. */
export const AD_CITIES: readonly string[] = PROVINCES;

/**
 * İlçe listesi bulunan şehirler. Yeni şehirler eklendiğinde yalnızca bu
 * katalog büyür; arayüz ve veritabanı aynı kuralları kullanmaya devam eder.
 */
export const AD_DISTRICTS: Readonly<Record<string, readonly AdDistrict[]>> = {
  Trabzon: [
    { name: 'Akçaabat', population: 131162, lat: 40.9572, lng: 39.5158 },
    { name: 'Araklı', population: 49230, lat: 40.7246, lng: 39.9622 },
    { name: 'Arsin', population: 31493, lat: 40.8672, lng: 39.9289 },
    { name: 'Beşikdüzü', population: 23246, lat: 41.0136, lng: 39.1995 },
    { name: 'Çarşıbaşı', population: 15004, lat: 41.042, lng: 39.4045 },
    { name: 'Çaykara', population: 12921, lat: 40.6329, lng: 40.2795 },
    { name: 'Dernekpazarı', population: 3717, lat: 40.7818, lng: 40.2277 },
    { name: 'Düzköy', population: 13105, lat: 40.8406, lng: 39.3856 },
    { name: 'Hayrat', population: 7410, lat: 40.7589, lng: 40.4027 },
    { name: 'Köprübaşı', population: 4271, lat: 40.714, lng: 40.1134 },
    { name: 'Maçka', population: 24931, lat: 40.7407, lng: 39.5775 },
    { name: 'Of', population: 43591, lat: 40.8833, lng: 40.3143 },
    { name: 'Ortahisar', population: 335116, lat: 40.9279, lng: 39.7313 },
    { name: 'Sürmene', population: 25281, lat: 40.8318, lng: 40.1095 },
    { name: 'Şalpazarı', population: 10575, lat: 40.8567, lng: 39.1892 },
    { name: 'Tonya', population: 13332, lat: 40.8497, lng: 39.2841 },
    { name: 'Vakfıkebir', population: 27278, lat: 40.9952, lng: 39.3257 },
    { name: 'Yomra', population: 51660, lat: 40.851, lng: 39.8363 },
  ],
};

const CITY_CENTERS: Readonly<Record<string, { lat: number; lng: number }>> = {
  Trabzon: { lat: 41.0027, lng: 39.7168 },
};

/** Sunucudaki `ad_fold` ile aynı sadeleştirme: karşılaştırmalar birebir eşleşir. */
export function adFold(value: string | null | undefined): string {
  const map: Record<string, string> = {
    Ç: 'C',
    Ğ: 'G',
    İ: 'I',
    I: 'I',
    Ö: 'O',
    Ş: 'S',
    Ü: 'U',
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
    Â: 'A',
    â: 'a',
    Î: 'I',
    î: 'i',
    Û: 'U',
    û: 'u',
  };
  return (value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[ÇĞİIÖŞÜçğıöşüÂâÎîÛû]/g, (char) => map[char] ?? char)
    .trim();
}

export function districtsForCity(city: string | null | undefined): readonly AdDistrict[] {
  if (!city) {
    return [];
  }
  const match = Object.keys(AD_DISTRICTS).find((name) => adFold(name) === adFold(city));
  return match ? AD_DISTRICTS[match] : [];
}

export function districtByName(city: string | null | undefined, name: string | null | undefined): AdDistrict | null {
  if (!name) {
    return null;
  }
  return districtsForCity(city).find((item) => adFold(item.name) === adFold(name)) ?? null;
}

export function cityCenter(city: string | null | undefined): { lat: number; lng: number } | null {
  if (!city) {
    return null;
  }
  const match = Object.keys(CITY_CENTERS).find((name) => adFold(name) === adFold(city));
  return match ? CITY_CENTERS[match] : null;
}

/** Seçilen şehir/ilçe için yaklaşık harita noktası; yoksa null. */
export function locationCoords(city: string | null, district: string | null): { lat: number; lng: number } | null {
  const item = districtByName(city, district);
  if (item) {
    return { lat: item.lat, lng: item.lng };
  }
  return cityCenter(city);
}

/** Kayıtlı koordinata en yakın ilçeyi bulur (eski kampanyaları düzenlerken). */
export function nearestDistrict(
  city: string | null,
  lat: number | null,
  lng: number | null,
): AdDistrict | null {
  if (lat == null || lng == null) {
    return null;
  }
  let best: AdDistrict | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of districtsForCity(city)) {
    const distance = (item.lat - lat) ** 2 + (item.lng - lng) ** 2;
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  // ~0.35° kareden uzak noktalar ilçe merkezi sayılmaz.
  return best && bestDistance < 0.12 ? best : null;
}

export function searchCities(query: string): readonly string[] {
  const needle = normalizeForSearch(query);
  if (!needle) {
    return AD_CITIES;
  }
  return AD_CITIES.filter((city) => normalizeForSearch(city).includes(needle));
}

export function formatPopulation(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} mn`;
  }
  if (n >= 1000) {
    return `${Math.round(n / 1000).toLocaleString('tr-TR')} bin`;
  }
  return n.toLocaleString('tr-TR');
}

/** Kartlarda ve özetlerde gösterilen kısa hedef etiketi. */
export function formatTargetLabel(
  cities: readonly string[] | null | undefined,
  districts: readonly string[] | null | undefined,
): string {
  const cityList = (cities ?? []).filter(Boolean);
  const districtList = (districts ?? []).filter(Boolean);
  if (cityList.length === 0) {
    return districtList.length ? `${districtList.join(', ')} (ilçe)` : 'Tüm Türkiye';
  }
  if (cityList.length === 1 && districtList.length === 0) {
    return `${cityList[0]} · tüm ilçeler`;
  }
  if (cityList.length === 1) {
    return `${cityList[0]} · ${districtList.join(', ')}`;
  }
  return `${cityList.join(', ')}${districtList.length ? ` · ${districtList.length} ilçe` : ''}`;
}

/** Özet kartı için daha açıklayıcı metin. */
export function describeTarget(
  cities: readonly string[] | null | undefined,
  districts: readonly string[] | null | undefined,
): string {
  const cityList = (cities ?? []).filter(Boolean);
  const districtList = (districts ?? []).filter(Boolean);
  if (cityList.length === 0 && districtList.length === 0) {
    return 'Tüm şehirlerde, tüm kullanıcılara gösterilir.';
  }
  if (cityList.length === 0) {
    return `İlçe adı eşleşen kullanıcılara gösterilir: ${districtList.join(', ')}.`;
  }
  if (districtList.length === 0) {
    return `${cityList.join(', ')} içindeki her ilçede gösterilir.`;
  }
  return `${cityList.join(', ')} içinde yalnızca ${districtList.join(', ')} ilçelerinde gösterilir.`;
}
