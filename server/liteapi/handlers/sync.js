/**
 * LiteAPI otel senkronizasyonu — yönetici uç noktası.
 *
 *   POST /api/liteapi-sync
 *   { mode: 'test'|'full', limit?: 10, cursor?: 0, phase?: 'city'|'radius',
 *     runId?: string, fetchDetail?: boolean }
 *
 * Yetki: yönetici JWT'si veya `x-sync-secret: LITEAPI_SYNC_SECRET`.
 * Varsayılan test çağrısı 10 otel çeker. Tam senkron, dönen `nextPhase` ve
 * `nextCursor` ile parça parça yürütülür.
 */

const { runSyncBatch } = require('../sync');
const { isConfigured } = require('../config');
const { verifyAdmin } = require('../supabase');
const { sendJson, readJsonBody } = require('../../http-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, reason: 'method_not_allowed' });
    return;
  }

  if (!isConfigured()) {
    sendJson(res, 503, {
      ok: false,
      reason: 'not_configured',
      message: 'Sunucuda LITEAPI_API_KEY tanımlı değil.',
    });
    return;
  }

  const auth = await verifyAdmin(req);
  if (!auth.ok) {
    sendJson(res, auth.reason === 'not_admin' ? 403 : 401, {
      ok: false,
      reason: auth.reason,
      message:
        auth.reason === 'not_admin'
          ? 'Bu işlem için yönetici yetkisi gerekir.'
          : 'Geçerli bir yönetici oturumu gerekir.',
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (cause) {
    sendJson(res, cause.code === 'payload_too_large' ? 413 : 400, {
      ok: false,
      reason: cause.code || 'invalid_json',
    });
    return;
  }

  const mode = body.mode === 'full' ? 'full' : 'test';
  try {
    const result = await runSyncBatch({
      mode,
      limit: body.limit,
      cursor: body.cursor,
      phase: body.phase === 'radius' ? 'radius' : 'city',
      runId: typeof body.runId === 'string' ? body.runId : null,
      fetchDetail: body.fetchDetail === false ? false : undefined,
      userId: auth.userId,
      label: auth.via === 'sync_secret' ? 'cron' : 'admin',
    });

    sendJson(res, 200, {
      ok: true,
      runId: result.runId,
      resumed: result.resumed,
      mode: result.mode,
      phase: result.phase,
      nextPhase: result.nextPhase,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      totalAvailable: result.totalAvailable,
      counts: result.counts,
      skippedReasons: result.skippedReasons,
      sample: result.results.slice(0, 20).map((entry) => ({
        externalId: entry.externalId,
        name: entry.name,
        action: entry.action,
        district: entry.district ?? null,
        reason: entry.reason || entry.detailError?.code || null,
      })),
    });
  } catch (cause) {
    const code = cause && cause.code ? cause.code : 'sync_failed';
    console.error('[liteapi-sync]', code, cause && cause.message ? cause.message : cause);
    sendJson(res, code === 'not_configured' ? 503 : 502, {
      ok: false,
      reason: code,
      message:
        code === 'not_configured'
          ? 'Sunucuda LITEAPI_API_KEY tanımlı değil.'
          : 'Senkronizasyon tamamlanamadı. Ayrıntılar sunucu günlüğünde.',
    });
  }
};
