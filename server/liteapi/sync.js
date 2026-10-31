/**
 * LiteAPI otel senkronizasyonu.
 *
 * Akış:
 *   1. `/data/hotels` ile Trabzon ilçeleri dahil adaylar sayfalanır.
 *   2. Gerekli kayıtlar için `/data/hotel` detayı tamamlanır.
 *   3. Koordinat, Trabzon il/ilçe sınır poligonuyla doğrulanır.
 *   4. Doğrulanan tesis `acc_liteapi_upsert_property` RPC'sine gönderilir.
 *      RPC; sağlayıcı kimliği, isim + mesafe ve manuel kayıt eşleşmesiyle
 *      mükerrer kaydı engeller.
 *
 * Batch tasarımı: tek çağrı en fazla `limit` tesis işler. Yönetici paneli veya
 * CLI, `phase`/`nextCursor` değerlerini kullanarak tam senkronu parça parça
 * yürütür. Böylece Vercel fonksiyon süresi ve sağlayıcı hız limiti aşılmaz.
 */

const { config, isConfigured } = require('./config');
const { LiteApiError, listHotels, getHotelDetail } = require('./http');
const { normalizeHotel, extractHotelList, extractHotelDetail } = require('./normalize');
const { validateLocation } = require('./location');
const { serviceRpc, hasServiceConfig } = require('./supabase');

function clampLimit(value, fallback = 10) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

function mergeHotel(listHotel, detailHotel) {
  if (!detailHotel) return listHotel;
  const merged = { ...listHotel, ...detailHotel };
  merged.photos = detailHotel.photos.length > 0 ? detailHotel.photos : listHotel.photos;
  merged.amenities = detailHotel.amenities.length > 0 ? detailHotel.amenities : listHotel.amenities;
  merged.raw = detailHotel.raw || listHotel.raw;
  return merged;
}

function scanQuery(scan, offset, limit) {
  if (scan === 'radius') {
    return {
      countryCode: config.trabzon.countryCode,
      latitude: config.trabzon.centerLat,
      longitude: config.trabzon.centerLng,
      radius: config.trabzon.radiusKm,
      limit,
      offset,
    };
  }
  return {
    countryCode: config.trabzon.countryCode,
    cityName: config.trabzon.cityName,
    limit,
    offset,
  };
}

async function fetchScanPage(scan, offset, limit) {
  const payload = await listHotels(scanQuery(scan, offset, limit));
  const { hotels, total } = extractHotelList(payload);
  return { scan, hotels, total, offset, limit };
}

function buildPayload(hotel, location) {
  return {
    provider: 'liteapi',
    id: hotel.id,
    name: hotel.name,
    description: hotel.description,
    address: hotel.address,
    city: 'Trabzon',
    district: location.district || hotel.district,
    latitude: location.lat,
    longitude: location.lng,
    stars: hotel.stars,
    rating: hotel.rating,
    reviewCount: hotel.reviewCount,
    amenities: hotel.amenities,
    photos: hotel.photos,
    phone: hotel.phone,
    email: hotel.email,
    website: hotel.website,
    roomCapacity: hotel.roomCapacity,
    checkinTime: hotel.checkinTime,
    checkoutTime: hotel.checkoutTime,
    active: true,
    raw: hotel.raw,
  };
}

async function processHotel({ hotel, mode, runId, fetchDetail }) {
  let detail = null;
  let detailError = null;

  if (fetchDetail) {
    try {
      const payload = await getHotelDetail(hotel.id);
      detail = extractHotelDetail(payload);
    } catch (cause) {
      detailError = {
        code: cause instanceof LiteApiError ? cause.code : 'detail_failed',
        message: cause instanceof Error ? cause.message : 'Otel detayı alınamadı.',
      };
    }
  }

  const merged = mergeHotel(hotel, detail);
  const location = validateLocation({
    lat: merged.latitude,
    lng: merged.longitude,
    city: merged.city,
    address: merged.address,
  });

  if (!location.ok) {
    return {
      action: 'skipped',
      externalId: hotel.id,
      name: hotel.name,
      reason: location.reason,
      detailError,
    };
  }

  try {
    const result = await serviceRpc('acc_liteapi_upsert_property', {
      p_external_id: hotel.id,
      p_payload: buildPayload(merged, location),
      p_run_id: runId,
    });
    return {
      action: result?.action || 'updated',
      propertyId: result?.property_id || null,
      externalId: hotel.id,
      name: hotel.name,
      district: location.district,
      detailError,
    };
  } catch (cause) {
    return {
      action: 'failed',
      externalId: hotel.id,
      name: hotel.name,
      reason: 'upsert_failed',
      message: cause instanceof Error ? cause.message : 'Tesis kaydedilemedi.',
      detailError,
    };
  }
}

async function recordError(runId, result) {
  if (!runId) return;
  const code = result.reason || result.detailError?.code || 'sync_error';
  const message =
    result.message ||
    result.detailError?.message ||
    (code === 'outside_province'
      ? 'Tesis Trabzon il sınırlarının dışında.'
      : code === 'missing_coordinates'
        ? 'Tesisin koordinatı yok; konum doğrulanamadı.'
        : code);
  try {
    await serviceRpc('acc_liteapi_record_error', {
      p_run_id: runId,
      p_external_id: result.externalId || null,
      p_hotel_name: result.name || null,
      p_code: code,
      p_message: message,
      p_payload: result.detailError ? { detail_error: result.detailError } : {},
    });
  } catch {
    // Hata kaydı yazılamaması senkronu durdurmaz.
  }
}

async function startOrResumeRun({ runId, mode, userId, label }) {
  if (runId) {
    return { runId, resumed: true };
  }
  const result = await serviceRpc('acc_liteapi_start_run', {
    p_mode: mode,
    p_triggered_by: userId || null,
    p_triggered_by_label: label || null,
  });
  return {
    runId: result?.run_id || null,
    resumed: Boolean(result?.resumed),
  };
}

async function finishRun(runId, status, error, details) {
  if (!runId) return;
  await serviceRpc('acc_liteapi_finish_run', {
    p_run_id: runId,
    p_status: status,
    p_error: error || null,
    p_details: details || {},
  });
}

async function progressRun(runId, counts, details) {
  if (!runId) return;
  await serviceRpc('acc_liteapi_run_progress', {
    p_run_id: runId,
    p_counts: counts,
    p_details: details || {},
  });
}

function emptyCounts() {
  return {
    scanned: 0,
    inserted: 0,
    updated: 0,
    linked: 0,
    skipped: 0,
    failed: 0,
    pages: 0,
  };
}

function applyResult(counts, result) {
  counts.scanned += 1;
  switch (result.action) {
    case 'inserted':
      counts.inserted += 1;
      break;
    case 'updated':
      counts.updated += 1;
      break;
    case 'linked':
      counts.linked += 1;
      break;
    case 'skipped':
      counts.skipped += 1;
      break;
    default:
      counts.failed += 1;
      break;
  }
}

/**
 * Tek bir senkron partisi çalıştırır.
 *
 * @param {{
 *   mode?: 'test'|'full',
 *   limit?: number,
 *   cursor?: number,
 *   phase?: 'city'|'radius'|'done',
 *   runId?: string|null,
 *   userId?: string|null,
 *   label?: string|null,
 *   fetchDetail?: boolean
 * }} input
 */
async function runSyncBatch(input = {}) {
  if (!isConfigured()) {
    const error = new Error('LITEAPI_API_KEY tanımlı değil.');
    error.code = 'not_configured';
    throw error;
  }
  if (!hasServiceConfig()) {
    const error = new Error('Supabase servis yapılandırması eksik.');
    error.code = 'supabase_not_configured';
    throw error;
  }

  const mode = input.mode === 'full' ? 'full' : 'test';
  const limit = clampLimit(input.limit, mode === 'test' ? 10 : 25);
  const fetchDetail = input.fetchDetail ?? config.fetchDetail;
  const phase = input.phase === 'radius' ? 'radius' : 'city';
  const cursor = Math.max(0, Math.trunc(Number(input.cursor) || 0));

  const run = await startOrResumeRun({
    runId: input.runId || null,
    mode,
    userId: input.userId || null,
    label: input.label || null,
  });
  if (!run.runId) {
    const error = new Error('Senkron kaydı başlatılamadı.');
    error.code = 'run_not_created';
    throw error;
  }

  const counts = emptyCounts();
  counts.pages = 1;
  const details = {
    mode,
    limit,
    phase,
    cursor,
    scans: [],
    skipped_reasons: {},
  };
  const results = [];

  try {
    let hotels = [];
    let nextPhase = 'done';
    let nextCursor = 0;

    if (mode === 'test') {
      // Test modunda hem şehir hem yarıçap taramasının ilk sayfası alınır;
      // ilçe otelleri de ilk 10 içinde görülsün.
      const scans = [await fetchScanPage('city', 0, limit)];
      if (config.radiusScan) {
        try {
          scans.push(await fetchScanPage('radius', 0, limit));
        } catch (cause) {
          details.radius_scan_error =
            cause instanceof Error ? cause.message : 'Yarıçap taraması başarısız.';
        }
      }
      const seen = new Set();
      for (const scan of scans) {
        details.scans.push({
          scan: scan.scan,
          offset: scan.offset,
          returned: scan.hotels.length,
          total: scan.total,
        });
        for (const hotel of scan.hotels) {
          if (seen.has(hotel.id)) continue;
          seen.add(hotel.id);
          hotels.push(hotel);
        }
      }
      hotels = hotels.slice(0, limit);
      nextPhase = 'done';
    } else if (phase === 'radius' && config.radiusScan) {
      const page = await fetchScanPage('radius', cursor, limit);
      details.scans.push({
        scan: 'radius',
        offset: cursor,
        returned: page.hotels.length,
        total: page.total,
      });
      hotels = page.hotels.slice(0, limit);
      const consumed = cursor + hotels.length;
      if (hotels.length >= limit && (page.total === 0 || consumed < page.total)) {
        nextPhase = 'radius';
        nextCursor = consumed;
      } else {
        nextPhase = 'done';
      }
    } else {
      const page = await fetchScanPage('city', cursor, limit);
      details.scans.push({
        scan: 'city',
        offset: cursor,
        returned: page.hotels.length,
        total: page.total,
      });
      hotels = page.hotels.slice(0, limit);
      const consumed = cursor + hotels.length;

      if (hotels.length >= limit && (page.total === 0 || consumed < page.total)) {
        nextPhase = 'city';
        nextCursor = consumed;
      } else if (config.radiusScan) {
        // Şehir taraması bitti; ilçe kapsamı için yarıçapa geç.
        nextPhase = 'radius';
        nextCursor = 0;
      } else {
        nextPhase = 'done';
      }
    }

    for (const hotel of hotels) {
      const result = await processHotel({ hotel, mode, runId: run.runId, fetchDetail });
      applyResult(counts, result);
      results.push(result);

      if (result.action === 'skipped') {
        details.skipped_reasons[result.reason] =
          (details.skipped_reasons[result.reason] || 0) + 1;
      }
      if (result.action === 'failed' || result.detailError || result.action === 'skipped') {
        await recordError(run.runId, result);
      }
    }

    details.next_phase = nextPhase;
    details.next_cursor = nextCursor;
    details.result_sample = results.slice(0, 20).map((result) => ({
      external_id: result.externalId,
      name: result.name,
      action: result.action,
      reason: result.reason || result.detailError?.code || null,
    }));

    await progressRun(run.runId, counts, details);

    const hasMore = nextPhase !== 'done';
    if (!hasMore) {
      const status = counts.failed > 0 && counts.inserted + counts.updated + counts.linked === 0
        ? 'failed'
        : counts.failed > 0 || counts.skipped > 0
          ? 'partial'
          : 'success';
      if (mode === 'full' && status !== 'failed') {
        await serviceRpc('acc_liteapi_deactivate_unseen', { p_run_id: run.runId });
      }
      await finishRun(run.runId, status, null, details);
    }

    return {
      ok: true,
      runId: run.runId,
      resumed: run.resumed,
      mode,
      phase,
      nextPhase,
      nextCursor,
      hasMore,
      totalAvailable: details.scans.reduce((sum, scan) => sum + (scan.total || 0), 0),
      counts,
      results,
      skippedReasons: details.skipped_reasons,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Senkronizasyon başarısız.';
    try {
      await finishRun(run.runId, 'failed', message, details);
    } catch {
      // yoksay
    }
    throw cause;
  }
}

module.exports = {
  runSyncBatch,
  fetchScanPage,
  processHotel,
  mergeHotel,
  clampLimit,
};
