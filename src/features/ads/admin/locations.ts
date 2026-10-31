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
  Adana: { lat: 37.0, lng: 35.3213 },
  Adıyaman: { lat: 37.7648, lng: 38.2786 },
  Afyonkarahisar: { lat: 38.75, lng: 30.55 },
  Ağrı: { lat: 39.7191, lng: 43.0503 },
  Aksaray: { lat: 38.3687, lng: 34.037 },
  Amasya: { lat: 40.6499, lng: 35.8353 },
  Ankara: { lat: 39.9334, lng: 32.8597 },
  Antalya: { lat: 36.8969, lng: 30.7133 },
  Ardahan: { lat: 41.1105, lng: 42.7022 },
  Artvin: { lat: 41.1828, lng: 41.8183 },
  Aydın: { lat: 37.856, lng: 27.8416 },
  Balıkesir: { lat: 39.6484, lng: 27.8826 },
  Bartın: { lat: 41.6344, lng: 32.3375 },
  Batman: { lat: 37.8812, lng: 41.1351 },
  Bayburt: { lat: 40.2552, lng: 40.2249 },
  Bilecik: { lat: 40.1501, lng: 29.9831 },
  Bingöl: { lat: 38.8853, lng: 40.498 },
  Bitlis: { lat: 38.4006, lng: 42.1095 },
  Bolu: { lat: 40.7392, lng: 31.6089 },
  Burdur: { lat: 37.7203, lng: 30.2908 },
  Bursa: { lat: 40.1885, lng: 29.061 },
  Çanakkale: { lat: 40.1553, lng: 26.4142 },
  Çankırı: { lat: 40.6013, lng: 33.6134 },
  Çorum: { lat: 40.5506, lng: 34.9556 },
  Denizli: { lat: 37.7765, lng: 29.0864 },
  Diyarbakır: { lat: 37.9144, lng: 40.2306 },
  Düzce: { lat: 40.8438, lng: 31.1565 },
  Edirne: { lat: 41.6818, lng: 26.5623 },
  Elazığ: { lat: 38.681, lng: 39.2264 },
  Erzincan: { lat: 39.75, lng: 39.5 },
  Erzurum: { lat: 39.9043, lng: 41.2679 },
  Eskişehir: { lat: 39.7767, lng: 30.5206 },
  Gaziantep: { lat: 37.0662, lng: 37.3833 },
  Giresun: { lat: 40.9128, lng: 38.3895 },
  Gümüşhane: { lat: 40.4386, lng: 39.5086 },
  Hakkâri: { lat: 37.5744, lng: 43.7408 },
  Hatay: { lat: 36.2025, lng: 36.1606 },
  Iğdır: { lat: 39.9167, lng: 44.0333 },
  Isparta: { lat: 37.7648, lng: 30.5566 },
  İstanbul: { lat: 41.0082, lng: 28.9784 },
  İzmir: { lat: 38.4192, lng: 27.1287 },
  Kahramanmaraş: { lat: 37.5775, lng: 36.9371 },
  Karabük: { lat: 41.2061, lng: 32.6204 },
  Karaman: { lat: 37.1759, lng: 33.2287 },
  Kars: { lat: 40.6013, lng: 43.0975 },
  Kastamonu: { lat: 41.3887, lng: 33.7827 },
  Kayseri: { lat: 38.7312, lng: 35.4787 },
  Kırıkkale: { lat: 39.8468, lng: 33.5153 },
  Kırklareli: { lat: 41.7333, lng: 27.2167 },
  Kırşehir: { lat: 39.1425, lng: 34.1709 },
  Kilis: { lat: 36.7184, lng: 37.1212 },
  Kocaeli: { lat: 40.8533, lng: 29.8815 },
  Konya: { lat: 37.8746, lng: 32.4932 },
  Kütahya: { lat: 39.4242, lng: 29.9833 },
  Malatya: { lat: 38.3552, lng: 38.3095 },
  Manisa: { lat: 38.6191, lng: 27.4289 },
  Mardin: { lat: 37.3212, lng: 40.7245 },
  Mersin: { lat: 36.8, lng: 34.6333 },
  Muğla: { lat: 37.2153, lng: 28.3636 },
  Muş: { lat: 38.9462, lng: 41.7539 },
  Nevşehir: { lat: 38.6939, lng: 34.6857 },
  Niğde: { lat: 37.9667, lng: 34.6833 },
  Ordu: { lat: 40.9839, lng: 37.8764 },
  Osmaniye: { lat: 37.0742, lng: 36.2478 },
  Rize: { lat: 41.0201, lng: 40.5234 },
  Sakarya: { lat: 40.7569, lng: 30.3783 },
  Samsun: { lat: 41.2867, lng: 36.33 },
  Siirt: { lat: 37.9333, lng: 41.95 },
  Sinop: { lat: 42.0231, lng: 35.1531 },
  Sivas: { lat: 39.7477, lng: 37.0179 },
  Şanlıurfa: { lat: 37.1591, lng: 38.7969 },
  Şırnak: { lat: 37.5164, lng: 42.4611 },
  Tekirdağ: { lat: 40.9833, lng: 27.5167 },
  Tokat: { lat: 40.3167, lng: 36.55 },
  Trabzon: { lat: 41.0027, lng: 39.7168 },
  Tunceli: { lat: 39.1079, lng: 39.5401 },
  Uşak: { lat: 38.6823, lng: 29.4082 },
  Van: { lat: 38.4891, lng: 43.4089 },
  Yalova: { lat: 40.65, lng: 29.2667 },
  Yozgat: { lat: 39.82, lng: 34.8044 },
  Zonguldak: { lat: 41.4564, lng: 31.7987 },
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
  return (match ? AD_DISTRICTS[match] : undefined) ?? [];
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
  return (match ? CITY_CENTERS[match] : undefined) ?? null;
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
