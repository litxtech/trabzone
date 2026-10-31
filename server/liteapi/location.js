/**
 * Trabzon il sınırı doğrulaması.
 *
 * Sağlayıcı `cityName=Trabzon` filtresi ilçelerdeki tesislerin bir kısmını
 * kaçırabilir. Bu yüzden her aday tesisin koordinatı, OpenStreetMap'ten alınan
 * il ve ilçe sınır poligonlarıyla doğrulanır. Sınır dışındaki tesis veritabanına
 * hiç yazılmaz.
 */

const boundaries = require('../data/trabzon-boundaries.json');

const TRABZON_DISTRICTS = boundaries.districts.map((district) => district.name);

function ringBBox(ring) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return false;
  const outer = polygon[0];
  const bbox = ringBBox(outer);
  if (lng < bbox.minLng || lng > bbox.maxLng || lat < bbox.minLat || lat > bbox.maxLat) {
    return false;
  }
  if (!pointInRing(lng, lat, outer)) return false;
  // Delikler (varsa) dışarıda bırakır.
  for (let index = 1; index < polygon.length; index += 1) {
    if (pointInRing(lng, lat, polygon[index])) return false;
  }
  return true;
}

function pointInGeometry(lng, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return pointInPolygon(lng, lat, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygon(lng, lat, polygon));
  }
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.some((entry) => pointInGeometry(lng, lat, entry));
  }
  return false;
}

const provinceGeometry = boundaries.province;
const districtGeometries = boundaries.districts.map((district) => ({
  name: district.name,
  geometry: district.geojson,
}));

const TURKISH_FOLD = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  I: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
};

/** Karşılaştırma için Türkçe karakterleri sadeleştirir. */
function normalizeText(value) {
  return String(value ?? '')
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (char) => TURKISH_FOLD[char] ?? char)
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function includesTrabzon(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.includes('trabzon')) return true;
  return TRABZON_DISTRICTS.some((district) => {
    const needle = normalizeText(district);
    return needle.length >= 4 && text.includes(needle);
  });
}

function isInTrabzon(lat, lng) {
  return pointInGeometry(lng, lat, provinceGeometry);
}

function districtFor(lat, lng) {
  for (const district of districtGeometries) {
    if (pointInGeometry(lng, lat, district.geometry)) {
      return district.name;
    }
  }
  return null;
}

/**
 * @param {{lat?: unknown, lng?: unknown, city?: unknown, address?: unknown}} input
 * @returns {{ok: boolean, reason: string, district: string|null, lat: number|null, lng: number|null}}
 */
function validateLocation(input) {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'missing_coordinates', district: null, lat: null, lng: null };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: 'invalid_coordinates', district: null, lat, lng };
  }
  // Trabzon kaba sınır kutusu: poligon hesabından önce hızlı eleme.
  if (lat < 40.0 || lat > 41.5 || lng < 38.0 || lng > 41.0) {
    return { ok: false, reason: 'outside_province', district: null, lat, lng };
  }
  if (!isInTrabzon(lat, lng)) {
    return { ok: false, reason: 'outside_province', district: null, lat, lng };
  }

  const district = districtFor(lat, lng);
  if (!district) {
    // İl poligonu içinde ama ilçe poligonunda değil: kıyı/ada gibi kenar
    // durumlar. Metin ipucu Trabzon'u doğruluyorsa kabul et.
    const hint = includesTrabzon(input?.city) || includesTrabzon(input?.address);
    if (!hint) {
      return { ok: false, reason: 'district_unresolved', district: null, lat, lng };
    }
  }

  return { ok: true, reason: 'ok', district, lat, lng };
}

module.exports = {
  TRABZON_DISTRICTS,
  boundaries,
  normalizeText,
  includesTrabzon,
  isInTrabzon,
  districtFor,
  validateLocation,
  pointInGeometry,
};
