// ai-news-worker: Trabzone AI Haber Merkezi çalışanı.
//
// Bu fonksiyon iki şekilde çağrılır:
//   1) pg_cron → net.http_post, `x-ai-news-token` başlığı ile (15 dakikalık döngü).
//   2) Admin paneli → kullanıcı JWT'si ile (elle çalıştırma, AI yardımı, tanılama).
//
// DeepSeek anahtarı yalnızca burada, `DEEPSEEK_API_KEY` ortam değişkeninden okunur.
// İstemciye asla dönmez, loglanmaz.
//
// Akış: arama → kayıt/tekrar eleme → sınıflandırma → kaynak doğrulama →
//       taslak → lisanslı görsel → otomatik yayın kapısı.
//
// Yayın kararı burada verilmez; tüm kapılar `ai_news_finalize` ve
// `ai_news_publish_event` RPC'lerinde veritabanı düzeyinde uygulanır.

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ai-news-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

import {
  DISTRICT_IMAGE_CREDITS,
  type DistrictImageCredit,
} from './district-credits.ts';

const DISTRICTS = [
  'Ortahisar', 'Akçaabat', 'Yomra', 'Arsin', 'Araklı', 'Sürmene', 'Of', 'Çaykara',
  'Dernekpazarı', 'Hayrat', 'Maçka', 'Düzköy', 'Vakfıkebir', 'Beşikdüzü', 'Çarşıbaşı',
  'Şalpazarı', 'Tonya', 'Köprübaşı',
];

// Haber görselleri ilçenin kendi fotoğrafından seçilir. Dosyalar `posts`
// kovasında `ai-news/districts/<slug>.jpg` altında tutulur.
const DISTRICT_SLUGS: Record<string, string> = {
  'akçaabat': 'akcaabat',
  'araklı': 'arakli',
  'arsin': 'arsin',
  'beşikdüzü': 'besikduzu',
  'çarşıbaşı': 'carsibasi',
  'çaykara': 'caykara',
  'dernekpazarı': 'dernekpazari',
  'düzköy': 'duzkoy',
  'hayrat': 'hayrat',
  'köprübaşı': 'koprubasi',
  'maçka': 'macka',
  'of': 'of',
  'ortahisar': 'ortahisar',
  'sürmene': 'surmene',
  'şalpazarı': 'salpazari',
  'tonya': 'tonya',
  'vakfıkebir': 'vakfikebir',
  'yomra': 'yomra',
};

function districtPhoto(district: string | null): {
  slug: string;
  credit: DistrictImageCredit;
} {
  const key = (district ?? '').trim().toLocaleLowerCase('tr-TR');
  const slug = DISTRICT_SLUGS[key] ?? 'ortahisar';
  return {
    slug,
    credit: DISTRICT_IMAGE_CREDITS[slug] ?? DISTRICT_IMAGE_CREDITS.ortahisar,
  };
}

const CATEGORY_SLUGS = [
  'son-dakika', 'trabzon-gundem', 'ilce-haberleri', 'trabzonspor', 'spor', 'belediye',
  'valilik-kamu', 'ekonomi', 'is-dunyasi', 'emlak-sehircilik', 'ulasim', 'trafik',
  'egitim', 'saglik', 'turizm', 'kultur-sanat', 'etkinlikler', 'cevre-doga', 'tarim',
  'findik-cay', 'altyapi', 'elektrik-su-kesintisi', 'hava-doga-olaylari', 'yerel-yasam', 'diger',
];

// Yüksek risk: otomatik yayın asla yapılmaz. Modelin "düşük risk" demesi bunu düşürmez.
const RISK_C_TERMS = [
  'öldü', 'ölen', 'ölüm', 'hayatını kaybetti', 'hayatını kaybeden', 'yaşamını yitirdi',
  'yaralı', 'yaralandı', 'yaralanan', 'kaza', 'çarpışma', 'devrildi', 'cinayet', 'öldürüldü',
  'tutuklama', 'tutuklandı', 'gözaltı', 'gözaltına', 'soruşturma', 'soruşturma açıldı',
  'dava açıldı', 'iddianame', 'taciz', 'istismar', 'çocuk', 'intihar', 'kayıp', 'kayboldu',
  'zehirlenme', 'patlama', 'yangın', 'deprem', 'sel ', 'su baskını', 'heyelan', 'göçük',
  'seçim', 'seçim sonucu', 'oy oranı', 'sandık', 'siyasi', 'vekil', 'milletvekili',
  'yolsuzluk', 'rüşvet', 'skandal', 'dolandırıcılık', 'sahtecilik', 'iftira', 'hakaret',
  'saldırı', 'silah', 'uyuşturucu', 'kaçakçılık', 'darp', 'tehdit', 'şiddet', 'istifa',
  'grev', 'protesto', 'ambulans', 'itfaiye', 'jandarma',
];

// Orta risk: editör kuyruğu.
const RISK_B_TERMS = [
  'zam', 'zam geldi', 'indirim', 'fiyat', 'tarife', 'ihale', 'ihaleye', 'inşaat',
  'kapatıldı', 'kapatma', 'ceza', 'ceza kesildi', 'vergi', 'işten çıkar', 'iflas',
  'satın alma', 'devraldı', 'anlaşma', 'sözleşme', 'lisans', 'ruhsat',
  'yeni düzenleme', 'yönetmelik', 'genelge', 'itiraz',
];

type Json = Record<string, unknown>;

// Görsel sağlayıcısı bir çalışma içinde yanıt vermezse her aday için
// tekrar denenmez; bu, çalışma süresini ve hata gürültüsünü azaltır.
const MEDIA_PROVIDER_FAILURES = new Set<string>();

type Settings = {
  max_events_per_run: number;
  max_article_age_hours: number;
  min_quality_score: number;
  duplicate_title_threshold: number;
  min_media_match: number;
  fast_model: string;
  reasoning_model: string;
  auto_publish_enabled: boolean;
  dry_run: boolean;
  price_input_per_m: number;
  price_output_per_m: number;
  price_search_per_call: number;
  price_fetch_per_call: number;
  notify_enabled: boolean;
};

type RunContext = {
  runId: string | null;
  settings: Settings;
  budgetExhausted: boolean;
  stats: {
    searches: number;
    search_results: number;
    new_results: number;
    ignored_results: number;
    events: number;
    duplicates: number;
    verified: number;
    drafts: number;
    published: number;
    queued: number;
    errors: number;
    cost_usd: number;
  };
};

type Source = {
  id: string;
  name: string;
  domain: string;
  kind: string;
  media_license_code: string | null;
  license_reference: string | null;
  attribution_text: string | null;
  reliability: number;
};

type Candidate = {
  id: number;
  title: string;
  url: string;
  source_domain: string;
  source_kind: string;
  snippet: string | null;
  summary: string | null;
  content: string;
  published_at: string | null;
  query: string | null;
};

type SearchResult = {
  title: string;
  url: string;
  summary: string;
  content: string;
  date: string | null;
  site_name: string;
  rerank_score: number | null;
};

type EventInfo = {
  event_id: string;
  created: boolean;
  status: string;
  primary_source: boolean;
  independent_sources: number;
};

type BeginPayload = {
  run_id: string;
  settings: Settings;
  topics: Array<{ id: string; query: string; kind: string; priority: number }>;
  publisher: Json | null;
};

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function env(name: string): string {
  return (Deno.env.get(name) ?? '').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown, max = 12): string[] {
  return asArray(value)
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
}

function preview(text: string, length = 400): string {
  return text.replace(/\s+/g, ' ').slice(0, length);
}

/** Modelin ```json çitlerini ve baştaki açıklamaları temizler. */
function parseJsonObject(raw: string): Json {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Json;
    }
  } catch {
    // Aşağıdaki onarım denemeleri.
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Json;
      }
    } catch {
      // Alan kurtarmaya geç.
    }
  }
  return salvageJsonFields(text);
}

/**
 * Yanıt token sınırında kesilirse JSON geçersiz olur. Bu durumda kaynak
 * metninde bulunan tamamlanmış alanları kurtarır; uydurma değer üretmez.
 */
function salvageJsonFields(text: string): Json {
  const out: Json = {};
  const stringField = (key: string) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    if (!match) return null;
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1];
    }
  };
  const booleanField = (key: string) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`));
    return match ? match[1] === 'true' : null;
  };
  const numberField = (key: string) => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
    return match ? Number(match[1]) : null;
  };

  for (const key of [
    'category_slug',
    'district',
    'event_date',
    'risk_level',
    'normalized_title',
    'summary',
  ]) {
    const value = stringField(key);
    if (value !== null) out[key] = value;
  }
  for (const key of ['trabzon_relevant']) {
    const value = booleanField(key);
    if (value !== null) out[key] = value;
  }
  const confidence = numberField('confidence');
  if (confidence !== null) out.confidence = confidence;

  // facts dizisi kesilmiş olabilir; yalnızca tamamlanmış string öğeleri al.
  const factsStart = text.indexOf('"facts"');
  if (factsStart >= 0) {
    const slice = text.slice(factsStart);
    const items = [...slice.matchAll(/"((?:\\.|[^"\\])*)"\s*(?:,|\])/g)]
      .slice(1, 6)
      .map((item) => item[1])
      .filter((item) => item && item !== 'facts');
    if (items.length > 0) out.facts = items;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Supabase REST yardımcıları
// ---------------------------------------------------------------------------
function supabaseUrl(): string {
  return env('SUPABASE_URL');
}

function jsonKey(name: string): string {
  const raw = env(name);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.default || Object.values(parsed)[0] || '';
  } catch {
    return '';
  }
}

function serviceKey(): string {
  return (
    env('SUPABASE_SERVICE_ROLE_KEY') ||
    env('SUPABASE_SECRET_KEY') ||
    jsonKey('SUPABASE_SECRET_KEYS')
  );
}

function anonKey(): string {
  return (
    env('SUPABASE_ANON_KEY') ||
    jsonKey('SUPABASE_PUBLISHABLE_KEYS') ||
    env('SUPABASE_PUBLISHABLE_KEY')
  );
}

/** Yeni sb_secret/sb_publishable anahtarları JWT değildir; Authorization'a yazılmaz. */
function looksLikeJwt(value: string): boolean {
  return value.split('.').length === 3 && value.length > 40;
}

function keyHeaders(key: string): Record<string, string> {
  return looksLikeJwt(key)
    ? { apikey: key, Authorization: `Bearer ${key}` }
    : { apikey: key };
}

async function rpcAs<T = unknown>(
  name: string,
  args: Json,
  bearer: string,
  apiKey: string = anonKey(),
): Promise<{ data: T | null; error: string | null }> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      ...keyHeaders(apiKey),
      ...(looksLikeJwt(bearer) ? { Authorization: `Bearer ${bearer}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args ?? {}),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = preview(text, 600);
    try {
      const parsed = JSON.parse(text);
      message = parsed.message ?? parsed.error ?? parsed.details ?? message;
    } catch {
      // Ham metin.
    }
    return { data: null, error: message };
  }
  return { data: text ? (JSON.parse(text) as T) : null, error: null };
}

async function svc<T = unknown>(
  name: string,
  args: Json = {},
): Promise<{ data: T | null; error: string | null }> {
  return rpcAs<T>(name, args, serviceKey(), serviceKey());
}

async function svcSelect<T = unknown>(table: string, query: string): Promise<T[]> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${table}?${query}`, {
    headers: {
      ...keyHeaders(serviceKey()),
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`db_select_${response.status}: ${preview(await response.text())}`);
  }
  return (await response.json()) as T[];
}

async function svcUpdate(table: string, values: Json, query: string): Promise<void> {
  const response = await fetch(`${supabaseUrl()}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: {
      ...keyHeaders(serviceKey()),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(values),
  });
  if (!response.ok) {
    throw new Error(`db_update_${response.status}: ${preview(await response.text())}`);
  }
}

// ---------------------------------------------------------------------------
// DeepSeek istemcisi
// ---------------------------------------------------------------------------
function deepseekBase(): string {
  return (env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com').replace(/\/+$/, '');
}

async function deepseek(
  path: string,
  payload: Json | null,
  method = 'POST',
): Promise<{ ok: boolean; status: number; data: Json; text: string }> {
  const apiKey = env('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('deepseek_key_missing');

  const response = await fetch(`${deepseekBase()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  let data: Json = {};
  try {
    const parsed = JSON.parse(text);
    data = parsed && typeof parsed === 'object' ? (parsed as Json) : {};
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, data, text };
}

async function logCost(
  ctx: RunContext,
  kind: 'search' | 'fetch' | 'model',
  options: { model?: string; calls?: number; tokensIn?: number; tokensOut?: number; note?: string },
): Promise<void> {
  if (!ctx.runId) return;

  const calls = Math.max(options.calls ?? 1, 1);
  const tokensIn = Math.max(options.tokensIn ?? 0, 0);
  const tokensOut = Math.max(options.tokensOut ?? 0, 0);
  let cost = 0;
  if (kind === 'search') cost = calls * ctx.settings.price_search_per_call;
  else if (kind === 'fetch') cost = calls * ctx.settings.price_fetch_per_call;
  else {
    cost =
      (tokensIn / 1_000_000) * ctx.settings.price_input_per_m +
      (tokensOut / 1_000_000) * ctx.settings.price_output_per_m;
  }

  ctx.stats.cost_usd += cost;

  await svc('ai_news_cost_log', {
    p_run_id: ctx.runId,
    p_kind: kind,
    p_model: options.model ?? null,
    p_calls: calls,
    p_tokens_in: tokensIn,
    p_tokens_out: tokensOut,
    p_cost_usd: Number(cost.toFixed(6)),
    p_note: options.note ?? null,
  });
}

async function logError(
  ctx: RunContext,
  stage: string,
  code: string,
  message: string,
  detail: Json = {},
): Promise<void> {
  ctx.stats.errors += 1;
  try {
    await svc('ai_news_log_error', {
      p_run_id: ctx.runId,
      p_stage: stage,
      p_code: code.slice(0, 80),
      p_message: preview(message, 600),
      p_detail: detail,
    });
  } catch {
    // Hata kaydı başarısız olsa da akış devam eder.
  }
}

async function refreshBudget(ctx: RunContext): Promise<void> {
  const { data } = await svc<Json>('ai_news_budget_status');
  if (data && data.exhausted === true) ctx.budgetExhausted = true;
}

async function chat(
  ctx: RunContext,
  options: {
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    json?: boolean;
  },
): Promise<string> {
  await refreshBudget(ctx);
  if (ctx.budgetExhausted) throw new Error('budget_exhausted');

  const body: Json = {
    model: options.model,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    temperature: 0.2,
    max_tokens: options.maxTokens,
    stream: false,
    // Bu hesaptaki deepseek modelleri varsayılan olarak "reasoning" üretiyor
    // ve tüm token bütçesini düşünmeye harcayıp içerik üretmeden
    // kesilebiliyor. Haber merkezi yapılandırılmış JSON çıktısı beklediği
    // için düşünme modu kapatılır; aksi halde taslaklar boş döner.
    thinking: { type: 'disabled' },
  };
  if (options.json !== false) body.response_format = { type: 'json_object' };

  let response = await deepseek('/chat/completions', body);
  // Bazı modeller response_format desteklemez; bir kez formatsız dene.
  if (!response.ok && response.status === 400 && body.response_format) {
    delete body.response_format;
    response = await deepseek('/chat/completions', body);
  }
  if (!response.ok) {
    throw new Error(`deepseek_chat_${response.status}: ${preview(response.text, 300)}`);
  }

  const usage = (response.data.usage ?? {}) as Json;
  await logCost(ctx, 'model', {
    model: options.model,
    tokensIn: asNumber(usage.prompt_tokens ?? usage.input_tokens),
    tokensOut: asNumber(usage.completion_tokens ?? usage.output_tokens),
  });

  const choices = asArray(response.data.choices);
  const first = (choices[0] ?? {}) as Json;
  const message = (first.message ?? {}) as Json;
  const content = asString(message.content);

  // Yanıt token sınırında kesildiyse bir kez daha geniş bütçeyle dene.
  if (!content && first.finish_reason === 'length') {
    const retry = await deepseek('/chat/completions', {
      ...body,
      max_tokens: Math.min(options.maxTokens * 2, 8000),
      temperature: 0,
    });
    if (retry.ok) {
      const retryChoice = (asArray(retry.data.choices)[0] ?? {}) as Json;
      const retryUsage = (retry.data.usage ?? {}) as Json;
      await logCost(ctx, 'model', {
        model: options.model,
        tokensIn: asNumber(retryUsage.prompt_tokens ?? retryUsage.input_tokens),
        tokensOut: asNumber(retryUsage.completion_tokens ?? retryUsage.output_tokens),
      });
      return asString(((retryChoice.message ?? {}) as Json).content);
    }
  }

  return content;
}

// ---------------------------------------------------------------------------
// Arama / getirme / görsel
// ---------------------------------------------------------------------------
function extractSearchResults(payload: Json): { results: SearchResult[]; raw: Json } {
  let container: unknown = payload;
  const keys = ['results', 'data', 'items', 'web_results', 'search_results', 'output'];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      container = value;
      break;
    }
  }

  // Bazı yanıtlar chat benzeri: içerik JSON ya da markdown olabilir.
  if (!Array.isArray(container)) {
    const choices = asArray(payload.choices);
    const message = ((choices[0] ?? {}) as Json).message as Json | undefined;
    const content = asString(message?.content);
    if (content) {
      const parsed = parseJsonObject(content);
      const inner = parsed.results ?? parsed.data ?? parsed.items;
      if (Array.isArray(inner)) container = inner;
    }
  }

  const results: SearchResult[] = [];
  if (Array.isArray(container)) {
    for (const entry of container) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Json;
      const url = asString(item.url) || asString(item.link) || asString(item.href);
      if (!url || !/^https?:\/\//i.test(url)) continue;
      const summary =
        asString(item.summary) || asString(item.snippet) || asString(item.description);
      const content = asString(item.content) || asString(item.markdown) || asString(item.text);
      results.push({
        title: asString(item.title) || asString(item.name) || url,
        url,
        summary: summary.slice(0, 3000),
        // DeepSeek arama yanıtı gövdeyi `summary` alanında döndürebiliyor.
        content: (content || summary).slice(0, 20000),
        date: asString(item.date) || asString(item.published_at) || asString(item.published) || null,
        site_name: asString(item.site_name) || asString(item.source) || asString(item.domain),
        rerank_score: item.rerank_score !== undefined ? asNumber(item.rerank_score) : null,
      });
    }
  }

  return { results, raw: payload };
}

async function searchWeb(
  ctx: RunContext,
  query: string,
  count = 8,
): Promise<{ results: SearchResult[]; raw: Json }> {
  await refreshBudget(ctx);
  if (ctx.budgetExhausted) throw new Error('budget_exhausted');

  const safeQuery = query.trim().slice(0, 128);
  const response = await deepseek('/v1/tools/search', {
    query: safeQuery,
    count: clamp(count, 1, 20),
    need_content: true,
  });
  await logCost(ctx, 'search', { note: safeQuery.slice(0, 200) });

  if (!response.ok) {
    throw new Error(`deepseek_search_${response.status}: ${preview(response.text, 300)}`);
  }
  return extractSearchResults(response.data);
}

async function fetchPage(ctx: RunContext, url: string): Promise<string> {
  await refreshBudget(ctx);
  if (ctx.budgetExhausted) throw new Error('budget_exhausted');

  const response = await deepseek('/v1/tools/fetch', { url });
  await logCost(ctx, 'fetch', { note: url.slice(0, 200) });
  if (!response.ok) {
    throw new Error(`deepseek_fetch_${response.status}: ${preview(response.text, 300)}`);
  }
  const data = response.data;
  const direct =
    asString(data.content) || asString(data.markdown) || asString(data.text) || asString(data.output);
  if (direct) return direct.slice(0, 40000);

  const nested = (data.data ?? {}) as Json;
  return (
    asString(nested.content) || asString(nested.markdown) || asString(nested.text)
  ).slice(0, 40000);
}

/** JPEG APP1/COM segmentlerini (EXIF, yorum) kaldırır; konum bilgisi sızmaz. */
function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const chunks: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      chunks.push(bytes.slice(offset));
      break;
    }
    const marker = bytes[offset + 1];
    // Tarama (SOS) sonrası entropy-coded veri: kalanı olduğu gibi kopyala.
    if (marker === 0xda) {
      chunks.push(bytes.slice(offset));
      break;
    }
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9) {
      chunks.push(bytes.slice(offset, offset + 2));
      break;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) {
      chunks.push(bytes.slice(offset));
      break;
    }
    const end = offset + 2 + length;
    if (end > bytes.length) {
      chunks.push(bytes.slice(offset));
      break;
    }
    const isMetadata = marker === 0xe1 || marker === 0xfe || marker === 0xed;
    if (!isMetadata) chunks.push(bytes.slice(offset, end));
    offset = end;
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

function imageExtension(contentType: string, url: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (/\.png(\?|$)/i.test(url)) return 'png';
  if (/\.webp(\?|$)/i.test(url)) return 'webp';
  return 'jpg';
}

async function uploadToPosts(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const response = await fetch(`${supabaseUrl()}/storage/v1/object/posts/${path}`, {
    method: 'POST',
    headers: {
      ...keyHeaders(serviceKey()),
      'Content-Type': contentType,
      'x-upsert': 'true',
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`storage_upload_${response.status}: ${preview(await response.text())}`);
  }
}

function sameSite(imageUrl: string, sourceDomain: string): boolean {
  try {
    const host = new URL(imageUrl).hostname.toLowerCase().replace(/^www\./, '');
    const domain = sourceDomain.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

function extractOgImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lisanslı gerçek fotoğraf arama (Openverse + Wikimedia Commons)
// ---------------------------------------------------------------------------
// Yalnızca ticari kullanıma ve düzenlemeye açık, atıfı belgelenebilir lisanslar
// kabul edilir. Google Görseller / haber sitesi görselleri otomatik olarak
// lisanslı sayılmaz; kaynak sayfası ve lisans adresi kayıt altına alınır.
type LicensedPhoto = {
  imageUrl: string;
  pageUrl: string;
  creator: string;
  credit: string;
  licenseCode: string;
  licenseReference: string;
  width: number;
  height: number;
  matchScore: number;
  description: string;
};

const LICENSED_STOPWORDS = new Set([
  'trabzon', 'son', 'dakika', 'haber', 'haberi', 'guncel', 'gündem', 'yeni', 'ile', 'icin', 'için',
  'olan', 'olarak', 'bir', 've', 'bu', 'da', 'de', 'mi', 'mu', 'ne', 'cok', 'çok', 'daha', 'gibi',
]);

function photoTokens(text: string): string[] {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !LICENSED_STOPWORDS.has(token))
    .slice(0, 24);
}

function photoMatchScore(title: string, district: string | null, candidateText: string): number {
  const haystack = ` ${candidateText.toLocaleLowerCase('tr-TR')} `;
  const tokens = photoTokens(title);
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  let score = 0.15;
  if (district && haystack.includes(district.toLocaleLowerCase('tr-TR'))) score += 0.25;
  if (tokens.length > 0) score += (hits / tokens.length) * 0.6;
  return Math.min(1, Number(score.toFixed(2)));
}

function licenseFromText(raw: string): { code: string; ok: boolean } {
  const value = raw.toLocaleLowerCase('tr-TR');
  const versionMatch = value.match(/\b([1-4])\.?0?\b/);
  const version = versionMatch ? versionMatch[1] : '4';
  if (/\bcc0\b|public domain|kamu malı|pdm/.test(value)) return { code: 'cc0', ok: true };
  if (/by-sa|by sa/.test(value)) return { code: `cc_by_sa_${version}`, ok: true };
  if (/by\b|attribution/.test(value) && !/nc|nd/.test(value)) return { code: `cc_by_${version}`, ok: true };
  return { code: 'unknown', ok: false };
}

async function searchOpenverse(query: string): Promise<LicensedPhoto[]> {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', query);
  url.searchParams.set('license', 'cc0,by,by-sa');
  url.searchParams.set('license_type', 'commercial,modification');
  url.searchParams.set('mature', 'false');
  url.searchParams.set('page_size', '12');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'TrabzoneNewsBot/1.0 (+https://trabzone.app)' },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as Json;
  const items = asArray(payload.results);
  const photos: LicensedPhoto[] = [];

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Json;
    const imageUrl = asString(item.url);
    const pageUrl = asString(item.foreign_landing_url) || asString(item.detail_url);
    const license = asString(item.license).toLowerCase();
    const versionText = asString(item.license_version);
    const versionMatch = versionText.match(/^([0-9])/);
    const version = versionMatch ? versionMatch[1] : '4';
    const code = license === 'cc0'
      ? 'cc0'
      : license === 'by-sa'
        ? `cc_by_sa_${version}`
        : license === 'by'
          ? `cc_by_${version}`
          : '';
    if (!imageUrl || !pageUrl || !code) continue;
    const width = asNumber(item.width);
    const height = asNumber(item.height);
    if (width > 0 && width < 800) continue;
    if (width > 0 && height > 0) {
      const ratio = width / height;
      if (ratio < 0.6 || ratio > 2.6) continue;
    }

    const creator = asString(item.creator) || 'Bilinmiyor';
    photos.push({
      imageUrl,
      pageUrl,
      creator,
      credit: asString(item.attribution) || `${creator} · ${asString(item.license, code).toUpperCase()}`,
      licenseCode: code,
      licenseReference: asString(item.license_url) || pageUrl,
      width,
      height,
      matchScore: 0,
      description: `${asString(item.title)} ${asString(item.description)}`.trim(),
    });
  }

  return photos;
}

async function searchWikimediaCommons(query: string): Promise<LicensedPhoto[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', `filetype:bitmap ${query}`);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', '8');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size|extmetadata');
  url.searchParams.set('iiextmetadatafilter', 'LicenseShortName|LicenseUrl|Artist|ImageDescription');
  url.searchParams.set('iiurlwidth', '1600');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'TrabzoneNewsBot/1.0 (+https://trabzone.app)' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as Json;
  const pages = (payload.query ?? {}) as Json;
  const entries = pages.pages && typeof pages.pages === 'object' ? Object.values(pages.pages as Json) : [];
  const photos: LicensedPhoto[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const page = entry as Json;
    const info = asArray(page.imageinfo)[0] as Json | undefined;
    if (!info) continue;
    const meta = (info.extmetadata ?? {}) as Json;
    const licenseText = asString((meta.LicenseShortName as Json)?.value);
    const licenseUrl = asString((meta.LicenseUrl as Json)?.value);
    const { code, ok } = licenseFromText(licenseText);
    if (!ok) continue;

    const imageUrl = asString(info.thumburl) || asString(info.url);
    const pageUrl = asString(info.descriptionurl);
    if (!imageUrl || !pageUrl) continue;
    const width = asNumber(info.thumbwidth) || asNumber(info.width);
    const height = asNumber(info.thumbheight) || asNumber(info.height);
    if (width > 0 && width < 800) continue;
    if (width > 0 && height > 0) {
      const ratio = width / height;
      if (ratio < 0.6 || ratio > 2.6) continue;
    }

    const rawArtist = asString((meta.Artist as Json)?.value);
    const creator = rawArtist.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'Wikimedia Commons';
    const description = asString((meta.ImageDescription as Json)?.value)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    photos.push({
      imageUrl,
      pageUrl,
      creator,
      credit: `${creator} · ${licenseText || code}`,
      licenseCode: code,
      licenseReference: licenseUrl || pageUrl,
      width,
      height,
      matchScore: 0,
      description: `${asString(page.title)} ${description}`.trim(),
    });
  }

  return photos;
}

/**
 * Olayla ilişkisi ve lisansı doğrulanmış gerçek fotoğraf arar.
 * Eşleşme eşiği altındaki görseller kullanılmaz; uydurma görsel üretilmez.
 */
async function findLicensedPhoto(
  ctx: RunContext,
  title: string,
  district: string | null,
  category: string,
): Promise<LicensedPhoto | null> {
  const queries = [
    `${title} ${district ?? 'Trabzon'}`.slice(0, 120),
    `${district ?? 'Trabzon'} ${category.replace(/-/g, ' ')}`,
    `${district ?? 'Trabzon'} Trabzon`,
  ];

  for (const query of queries) {
    // Sağlayıcılar paralel denenir; biri yanıt vermezse diğeri devam eder.
    const providers = [searchOpenverse, searchWikimediaCommons].filter(
      (provider) => !MEDIA_PROVIDER_FAILURES.has(provider.name),
    );
    const settled = await Promise.allSettled(providers.map((provider) => provider(query)));

    const collected: LicensedPhoto[] = [];
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        collected.push(...outcome.value);
      } else {
        // Aynı sağlayıcı için her adayda tekrar tekrar hata kaydetme.
        const name = providers[index]?.name ?? 'media_provider';
        if (!MEDIA_PROVIDER_FAILURES.has(name)) {
          MEDIA_PROVIDER_FAILURES.add(name);
          void logError(ctx, 'media', 'media_search_failed', String(outcome.reason), { query });
        }
      }
    });

    const scored = collected
      .map((photo) => ({
        ...photo,
        matchScore: photoMatchScore(title, district, `${photo.description} ${photo.credit}`),
      }))
      .filter((photo) => {
        // Yalnızca ilçe adının geçmesi yetmez: görsel açıklamasında olay
        // başlığından en az bir ayırt edici kelime bulunmalıdır. Aksi halde
        // eski veya başka olaya ait fotoğraf yanıltıcı biçimde kullanılabilir.
        const haystack = `${photo.description} ${photo.credit}`.toLocaleLowerCase('tr-TR');
        const titleHits = photoTokens(title).filter((token) => haystack.includes(token)).length;
        return titleHits >= 1 && photo.matchScore >= Math.max(0.75, ctx.settings.min_media_match);
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    if (scored.length > 0) {
      return scored[0];
    }
  }

  return null;
}


// ---------------------------------------------------------------------------
// Sınıflandırma yardımcıları
// ---------------------------------------------------------------------------
function keywordRisk(text: string): 'A' | 'B' | 'C' {
  const lower = ` ${text.toLocaleLowerCase('tr-TR')} `;
  if (RISK_C_TERMS.some((term) => matchesRiskTerm(lower, term))) return 'C';
  if (RISK_B_TERMS.some((term) => matchesRiskTerm(lower, term))) return 'B';
  return 'A';
}

/**
 * Risk terimlerini kelime sınırında arar. Türkçe ekler serbesttir
 * ("kazada", "kazası") ancak "kazandı" gibi farklı kökler eşleşmez.
 */
function matchesRiskTerm(haystack: string, term: string): boolean {
  const needle = term.toLocaleLowerCase('tr-TR');
  if (needle.includes(' ')) return haystack.includes(` ${needle}`);
  if (needle === 'kaza') return /(?:^|[^a-zçğıöşü])kaza(?!n)/.test(haystack);
  if (needle === 'sel') return /(?:^|[^a-zçğıöşü])sel(?: |$|i|i̇|de|e)/.test(haystack);
  return new RegExp(`(?:^|[^a-zçğıöşü])${needle}`).test(haystack);
}

function maxRisk(a: string, b: string): 'A' | 'B' | 'C' {
  const order = { A: 0, B: 1, C: 2 } as const;
  const riskA = (a === 'B' || a === 'C' ? a : 'A') as 'A' | 'B' | 'C';
  const riskB = (b === 'B' || b === 'C' ? b : 'A') as 'A' | 'B' | 'C';
  return order[riskA] >= order[riskB] ? riskA : riskB;
}

function normalizeDistrict(value: unknown): string | null {
  const text = asString(value).toLocaleLowerCase('tr-TR');
  if (!text) return null;
  const found = DISTRICTS.find(
    (district) => district.toLocaleLowerCase('tr-TR') === text,
  );
  if (found) return found;
  return DISTRICTS.find((district) => text.includes(district.toLocaleLowerCase('tr-TR'))) ?? null;
}

function normalizeCategory(value: unknown, text: string): string {
  const slug = asString(value).toLocaleLowerCase('tr-TR');
  if (CATEGORY_SLUGS.includes(slug)) return slug;

  const lower = text.toLocaleLowerCase('tr-TR');
  if (lower.includes('trabzonspor')) return 'trabzonspor';
  if (lower.includes('belediye')) return 'belediye';
  if (lower.includes('valilik') || lower.includes('kaymakam')) return 'valilik-kamu';
  if (lower.includes('kesinti')) return 'elektrik-su-kesintisi';
  if (lower.includes('fındık') || lower.includes('çay')) return 'findik-cay';
  if (lower.includes('turizm') || lower.includes('uzungöl')) return 'turizm';
  if (lower.includes('etkinlik') || lower.includes('festival')) return 'etkinlikler';
  return 'trabzon-gundem';
}

function heuristicQuality(input: { title: string; spot: string; body: string }): number {
  const words = input.body.trim().split(/\s+/).filter(Boolean).length;
  let score = 0.55;
  if (words >= 180) score += 0.15;
  if (words >= 260) score += 0.1;
  if (input.title.length >= 35 && input.title.length <= 120) score += 0.08;
  if (input.spot.length >= 80 && input.spot.length <= 320) score += 0.07;
  if (input.body.split(/\n{2,}/).length >= 4) score += 0.05;
  if (
    /\d{1,2}[:.]\d{2}/.test(input.body) ||
    /\d{1,2}\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)/i.test(input.body)
  ) {
    score += 0.05;
  }
  return Math.min(score, 0.95);
}

// ---------------------------------------------------------------------------
// Veri yükleme
// ---------------------------------------------------------------------------
async function loadSources(): Promise<Map<string, Source>> {
  const rows = await svcSelect<Source>(
    'ai_news_sources',
    'select=id,name,domain,kind,media_license_code,license_reference,attribution_text,reliability&active=eq.true',
  );
  const map = new Map<string, Source>();
  for (const source of rows) {
    if (!source.domain) continue;
    map.set(source.domain.toLowerCase(), { ...source, domain: source.domain.toLowerCase() });
  }
  return map;
}

async function readSettings(): Promise<Json> {
  const rows = await svcSelect<Json>('ai_news_settings', 'select=*&id=eq.true');
  return rows[0] ?? {};
}

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------
type Classification = {
  event: EventInfo;
  risk: 'A' | 'B' | 'C';
  category: string;
  district: string | null;
  eventDate: string | null;
  summary: string;
  facts: string[];
  institutions: string[];
};

async function classifyCandidate(
  ctx: RunContext,
  candidate: Candidate,
): Promise<Classification | null> {
  const sourceText = [
    candidate.title,
    candidate.summary ?? '',
    candidate.snippet ?? '',
    candidate.content.slice(0, 6000),
  ].join('\n');

  const prompt = `Aşağıdaki internet sonucunu Trabzone yerel haber editörü gibi değerlendir.

BASLIK: ${candidate.title}
KAYNAK: ${candidate.source_domain} (${candidate.source_kind})
YAYIN TARIHI: ${candidate.published_at ?? 'bilinmiyor'}
METIN:
${sourceText.slice(0, 7000)}

Kurallar:
- Yalnızca Trabzon ili veya 18 ilçesini doğrudan ilgilendiren gelişmeleri ilgili say.
- Başlıkta Trabzon veya bir ilçe adı geçiyorsa ilgili kabul et; metin kısa veya video sayfası diye ilgisiz sayma.
- Türkiye geneli, başka şehir veya magazin içeriğini ilgisiz say.
- Uydurma bilgi ekleme; metinde olmayan tarih/yer/kurum yazma.
- risk_level: A = düşük riskli resmî duyuru/etkinlik/hizmet; B = orta risk, doğrulanması güç veya ticari iddia; C = ölüm, yaralanma, suç, soruşturma, çocuk, kişisel veri, siyaset, seçim, afet, sağlık iddiası, itibar zedeleyici içerik.
- district yalnızca metinden doğrulanabiliyorsa yaz; yoksa null. İlçeler: ${DISTRICTS.join(', ')}.
- event_date: Olayın gerçekleştiği tarih. Metinde açık tarih varsa YYYY-MM-DD yaz. "Bugün", "dün", "bu akşam" gibi ifadeler varsa YAYIN TARIHI'ne göre çöz. Hiçbir tarih bilgisi yoksa null.
- category_slug şunlardan biri olmalı: ${CATEGORY_SLUGS.join(', ')}.
- normalized_title: aynı olayı farklı sitelerde eşleştirmek için 8-14 kelimelik, özel isimleri koruyan başlık.
- summary: en fazla 350 karakter, 2-3 cümle, yalnızca doğrulanabilir bilgi.
- facts: en fazla 5 kısa madde.

Yanıtı yalnızca şu JSON olarak ver:
{"trabzon_relevant":true,"category_slug":"...","district":null,"event_date":null,"risk_level":"A","normalized_title":"...","summary":"...","facts":["..."],"institutions":["..."],"confidence":0.8}`;

  const raw = await chat(ctx, {
    model: ctx.settings.fast_model,
    system:
      'Sen Trabzone Haber için çalışan titiz bir yerel haber editörüsün. ' +
      'Kaynakta olmayan hiçbir bilgiyi yazmazsın. Yanıtların yalnızca geçerli JSON olur.',
    user: prompt,
    maxTokens: 1600,
  });

  const parsed = parseJsonObject(raw);
  if (Object.keys(parsed).length === 0) {
    await logError(ctx, 'classify', 'classify_parse_failed', preview(raw, 400), {
      url: candidate.url,
    });
  }

  if (parsed.trabzon_relevant !== true) {
    // Model ilgisiz dediyse başlıkta açık Trabzon/ilçe kanıtı yoksa ele.
    const titleHasTrabzon = /trabzon/i.test(candidate.title)
      || DISTRICTS.some((district) =>
        candidate.title.toLocaleLowerCase('tr-TR').includes(district.toLocaleLowerCase('tr-TR')),
      );
    if (!titleHasTrabzon) return null;

    // İçerik ince (video/galeri) olduğunda model yanılabilir: risk en az B,
    // güven düşük işaretlenir ve doğrulama yine kaynak ister.
    await logError(ctx, 'classify', 'classify_title_fallback', 'Başlıkta Trabzon kanıtı var', {
      url: candidate.url,
    });
    parsed.trabzon_relevant = true;
    parsed.risk_level = maxRisk(asString(parsed.risk_level, 'B'), 'B');
    parsed.confidence = Math.min(asNumber(parsed.confidence, 0.4), 0.45);
  }

  const normalizedTitle =
    asString(parsed.normalized_title) || candidate.title.slice(0, 160);
  // Risk anahtar kelimeleri yalnızca başlık ve özet üzerinde uygulanır.
  // Tam sayfa metni site menüsü/başka haber başlıkları içerdiği için
  // gereksiz yere C sınıfına yükseltiyordu.
  const focusText = `${candidate.title}\n${candidate.summary ?? ''}\n${candidate.snippet ?? ''}`;
  const risk = maxRisk(
    asString(parsed.risk_level, 'B'),
    keywordRisk(focusText),
  );
  const category = normalizeCategory(parsed.category_slug, sourceText);
  const district = normalizeDistrict(parsed.district);
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(asString(parsed.event_date))
    ? asString(parsed.event_date)
    : null;

  const { data, error } = await svc<EventInfo>('ai_news_event_upsert', {
    p_payload: {
      result_id: candidate.id,
      title: normalizedTitle,
      category_slug: category,
      district,
      event_date: eventDate,
      summary: asString(parsed.summary).slice(0, 1200),
      risk_level: risk,
      confidence: clamp(asNumber(parsed.confidence, 0.5), 0, 1),
      facts: {
        items: asStringArray(parsed.facts, 10),
        institutions: asStringArray(parsed.institutions, 10),
      },
    },
  });

  if (error || !data) {
    throw new Error(error ?? 'event_upsert_failed');
  }

  return {
    event: data,
    risk,
    category,
    district,
    eventDate,
    summary: asString(parsed.summary).slice(0, 1200),
    facts: asStringArray(parsed.facts, 10),
    institutions: asStringArray(parsed.institutions, 10),
  };
}

type EvidenceItem = {
  domain: string;
  kind: string;
  url: string;
  title: string;
  excerpt: string;
};

async function gatherEvidence(
  ctx: RunContext,
  title: string,
  district: string | null,
  officialDomain: string | null,
): Promise<{ items: EvidenceItem[] }> {
  // DeepSeek arama ucu sorgu uzunluğunu 128 karakterle sınırlar.
  const query = `${title}${district ? ` ${district}` : ''} Trabzon`.slice(0, 120);
  const items: EvidenceItem[] = [];

  try {
    const { results } = await searchWeb(ctx, query, 10);
    ctx.stats.searches += 1;

    // Bağımsız doğrulama ancak farklı domainlerden gelirse anlamlıdır.
    // Aynı sitenin birden fazla sonucu tek kaynak sayılır.
    // Ayrıca sonuç, olayla gerçekten ilgili olmalıdır: sadece ilçe adının
    // geçtiği alakasız sayfalar kanıt olarak kaydedilmez.
    const seenDomains = new Set<string>();
    const chosen: typeof results = [];
    let irrelevant = 0;
    for (const result of results) {
      if (!result.url || !result.url.includes('://')) continue;
      if (officialDomain && result.url.includes(officialDomain)) continue;
      let host = '';
      try {
        host = new URL(result.url).hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      if (!host || seenDomains.has(host)) continue;
      const relevance = eventRelevance(title, `${result.title} ${result.summary}`);
      if (relevance < 2) {
        irrelevant += 1;
        continue;
      }
      seenDomains.add(host);
      chosen.push(result);
      if (chosen.length >= 4) break;
    }
    if (irrelevant > 0) {
      console.info(`[evidence] ${irrelevant} alakasız sonuç elendi: ${title.slice(0, 60)}`);
    }

    for (const result of chosen) {
      let domain = '';
      try {
        domain = new URL(result.url).hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      if (!domain) continue;

      let content = result.content;
      if (content.length < 400) {
        try {
          content = await fetchPage(ctx, result.url);
        } catch (error) {
          await logError(ctx, 'verify', 'fetch_failed', String(error), { url: result.url });
        }
      }

      // Getirilen tam sayfa da olayla ilgili olmalı; arama özeti aldatıcı
      // olabilir (ör. ilçe rehberi, başka bir kurumun duyurusu).
      if (content.length >= 400 && eventRelevance(title, content.slice(0, 6000)) < 2) {
        continue;
      }

      items.push({
        domain,
        kind: 'trusted_media',
        url: result.url,
        title: result.title,
        excerpt: (content || result.summary).slice(0, 1500),
      });
    }
  } catch (error) {
    await logError(ctx, 'verify', 'evidence_search_failed', String(error), { title });
  }

  return { items };
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase('tr-TR')
      .replace(/[^a-z0-9çğıöşü]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 2),
  );
}

function textSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

const NEWS_STOPWORDS = new Set([
  'trabzon',
  'trabzonun',
  'trabzonda',
  'haber',
  'haberi',
  'haberleri',
  'son',
  'dakika',
  'yeni',
  'için',
  'olan',
  'ilgili',
  'hakkında',
  'açıklama',
  'açıkladı',
  'duyurdu',
  'duyuru',
  'gündem',
  'gelişme',
  'gelişmeler',
  'büyük',
  'küçük',
]);

/**
 * Arama sonucunun olayla anlamsal ilgisini ölçer: başlıktaki ayırt edici
 * kelimelerden kaç tanesi sonuçta geçiyor? Sadece şehir/ilçe adının geçmesi
 * yeterli değildir, bu yüzden genel haber kelimeleri sayılmaz.
 */
function eventRelevance(title: string, candidateText: string): number {
  const titleTokens = [...tokenSet(title)].filter((token) => !NEWS_STOPWORDS.has(token));
  if (titleTokens.length === 0) return 0;
  const haystack = tokenSet(candidateText);
  let shared = 0;
  for (const token of titleTokens) if (haystack.has(token)) shared += 1;
  return shared;
}

/**
 * Bağımsız doğrulama için farklı domainlerden, aynı ajans metnini tekrar
 * etmeyen kaynak sayısı. Aynı metni yayımlayan siteler tek kaynak sayılır.
 */
function independentDomainCount(items: EvidenceItem[]): number {
  const accepted: { domain: string; text: string }[] = [];
  for (const item of items) {
    const text = `${item.title} ${item.excerpt}`.slice(0, 1500);
    if (accepted.some((other) => textSimilarity(other.text, text) >= 0.8)) continue;
    if (accepted.some((other) => other.domain === item.domain)) continue;
    accepted.push({ domain: item.domain, text });
  }
  return accepted.length;
}

async function verifyEvent(
  ctx: RunContext,
  eventId: string,
  classification: Classification,
  candidate: Candidate,
  sources: Map<string, Source>,
): Promise<{ status: string; risk: string; reasons: string[]; autoEligible: boolean }> {
  const bundle = await gatherEvidence(
    ctx,
    candidate.title,
    classification.district,
    candidate.source_domain,
  );

  // Bağımsız kaynakları olay kaydına ekle.
  const uniqueUrls = new Set<string>([candidate.url]);
  for (const item of bundle.items) {
    if (uniqueUrls.has(item.url)) continue;
    uniqueUrls.add(item.url);
    const source = sources.get(item.domain.toLowerCase());
    try {
      await svc('ai_news_evidence_add', {
        p_event_id: eventId,
        p_payload: {
          url: item.url,
          title: item.title,
          excerpt: item.excerpt,
          content: item.excerpt,
          source_kind: source?.kind ?? 'unknown',
          fetched_via: 'fetch',
        },
      });
    } catch (error) {
      await logError(ctx, 'verify', 'evidence_save_failed', String(error), { url: item.url });
    }
  }

  const official = sources.get(candidate.source_domain.toLowerCase())?.kind === 'official';
  const evidenceText = bundle.items
    .map((item, index) => `[${index + 1}] ${item.domain}: ${item.title}\n${item.excerpt.slice(0, 1500)}`)
    .join('\n\n');

  const prompt = `Aşağıdaki olayı yalnızca verilen kaynak metinlerine dayanarak doğrula.

OLAY: ${candidate.title}
ILCE: ${classification.district ?? 'belirtilmemiş'}
TARIH: ${classification.eventDate ?? 'belirtilmemiş'}
ANA KAYNAK: ${candidate.source_domain} (${candidate.source_kind})
ANA METIN:
${candidate.content.slice(0, 5000) || candidate.summary || candidate.snippet}

BAĞIMSIZ KAYNAKLAR:
${evidenceText || '(ek kaynak bulunamadı)'}

Kurallar:
- Kaynaklarda açıkça yazmayan hiçbir şeyi desteklenmiş sayma.
- Aynı ajans metninin kopyaları bağımsız doğrulama değildir.
- Her bağımsız kaynak, aynı olayın failini/konusunu ve eylemini açıkça anlatmalıdır. Yalnızca ilçe veya şehir adının geçtiği, olaydan bahsetmeyen sayfa kanıt sayılmaz.
- Ana kaynak ile bağımsız kaynaklar aynı olayı anlatmıyorsa supported=false yaz.
- Tarih, yer, kurum ve olayın ne olduğu tutarlı mı kontrol et.
- Çelişki varsa conflicts listesine yaz.
- risk_level: A = resmî/rutin duyuru, kamu hizmeti, etkinlik, spor müsabakası programı/sonuçları, turizm-tarım-ekonomi gelişmesi gibi hassas unsuru olmayan haberler. B = doğrulanması güç, ticari iddia veya çelişkili veri. C = ölüm, yaralanma, suç, soruşturma, çocuk, kişisel veri, siyaset, seçim, afet, ciddi sağlık iddiası, itibar zedeleyici içerik.
- Kaynaklar olayı destekliyorsa ve hassas unsur yoksa risk_level A olmalı; gerçek bir şüphe varsa B yaz.
- Trabzon bağlantısı metinden doğrulanmıyorsa trabzon_link false olsun.

Yanıtı yalnızca şu JSON olarak ver:
{"supported":true,"conflicts":[],"date_ok":true,"location_ok":true,"trabzon_link":true,"risk_level":"A","sensitive_flags":[],"notes":"kısa gerekçe"}`;

  let judged: Json = {};
  try {
    const raw = await chat(ctx, {
      model: ctx.settings.reasoning_model,
      system:
        'Sen Trabzone için kaynak doğrulaması yapan bir haber denetçisisin. ' +
        'Kanıt yoksa desteklenmiş saymazsın. Yalnızca JSON yanıt verirsin.',
      user: prompt,
      maxTokens: 1200,
    });
    judged = parseJsonObject(raw);
  } catch (error) {
    await logError(ctx, 'verify', 'verification_model_failed', String(error), { eventId });
  }

  const conflicts = asStringArray(judged.conflicts, 10);
  const supported = judged.supported === true;
  const dateOk = judged.date_ok !== false;
  const sensitiveFlags = asStringArray(judged.sensitive_flags, 10);
  const independentDomains = independentDomainCount([
    {
      domain: candidate.source_domain,
      kind: candidate.source_kind,
      url: candidate.url,
      title: candidate.title,
      excerpt: (candidate.content || candidate.summary || candidate.snippet || '').slice(0, 1500),
    },
    ...bundle.items,
  ]);
  // Resmî birincil kaynak yoksa en az 3 gerçekten bağımsız güvenilir kaynak
  // gerekir. Aynı ajans metnini kopyalayan siteler sayılmaz.
  const trabzonLink = judged.trabzon_link !== false && (official || independentDomains >= 3);
  // Risk yükseltmesi yalnızca başlık/özet ve doğrulayıcının hassas
  // işaretleri üzerinden yapılır; tam sayfa metni yanlış pozitif üretiyor.
  const focusText = `${candidate.title}\n${candidate.summary ?? ''}\n${candidate.snippet ?? ''}`;
  const risk = maxRisk(
    maxRisk(classification.risk, asString(judged.risk_level, 'B')),
    maxRisk(keywordRisk(focusText), sensitiveFlags.length > 0 ? 'C' : 'A'),
  );
  const passed = supported && conflicts.length === 0 && dateOk && trabzonLink && risk === 'A';

  const { data } = await svc<{
    status: string;
    risk_level: string;
    auto_block_reasons: string[];
    auto_eligible: boolean;
  }>('ai_news_verification_save', {
    p_event_id: eventId,
    p_payload: {
      checks: {
        supported,
        date_ok: dateOk,
        location_ok: judged.location_ok !== false,
        trabzon_link: trabzonLink,
        sensitive_flags: sensitiveFlags,
        notes: asString(judged.notes).slice(0, 600),
        independent_evidence: independentDomains,
        evidence_domains: bundle.items.map((item) => item.domain),
        official_source: official,
        source_domain: candidate.source_domain,
        source_kind: candidate.source_kind,
      },
      conflicts,
      passed,
      risk_level: risk,
      model: ctx.settings.reasoning_model,
    },
  });

  if (data) ctx.stats.verified += 1;

  return {
    status: data?.status ?? 'awaiting_review',
    risk: data?.risk_level ?? risk,
    reasons: data?.auto_block_reasons ?? [],
    autoEligible: data?.auto_eligible === true,
  };
}

/**
 * Veritabanı spotu 40-400 karakter arasında kabul eder. Model bazen uzun
 * yazar; cümle sınırında kısaltılır, çok kısaysa gövdeden tamamlanır.
 */
function normalizeSpot(value: string, body: string): string {
  let spot = value.replace(/\s+/g, ' ').trim();
  if (spot.length > 300) {
    const cut = spot.slice(0, 300);
    const sentenceEnd = Math.max(
      cut.lastIndexOf('. '),
      cut.lastIndexOf('! '),
      cut.lastIndexOf('? '),
    );
    spot = (sentenceEnd >= 60 ? cut.slice(0, sentenceEnd + 1) : cut.replace(/\s+\S*$/, '')).trim();
  }
  if (spot.length < 40) {
    const fallback = body.replace(/\s+/g, ' ').trim();
    const sentenceEnd = fallback.search(/[.!?](\s|$)/);
    spot = (sentenceEnd >= 40 ? fallback.slice(0, sentenceEnd + 1) : fallback).slice(0, 260).trim();
  }
  return spot;
}

async function writeDraft(
  ctx: RunContext,
  eventId: string,
  classification: Classification,
  candidate: Candidate,
  sourceInfo: Source | undefined,
): Promise<{ draftId: string | null; quality: number }> {
  const prompt = `Doğrulanmış bir Trabzon haberi için özgün Türkçe haber metni yaz.

OLAY: ${candidate.title}
TRABZON BAĞLAMI: ${classification.district ?? 'Trabzon geneli'}
OLAY TARIHI: ${classification.eventDate ?? 'belirtilmemiş'}
KATEGORI: ${classification.category}
ANA KAYNAK: ${candidate.source_domain}${sourceInfo?.name ? ` (${sourceInfo.name})` : ''}
ANA METIN:
${candidate.content.slice(0, 9000) || candidate.summary || candidate.snippet}
${classification.facts.length ? `\nDOĞRULANMIŞ BİLGİLER:\n- ${classification.facts.join('\n- ')}` : ''}

Kurallar:
- Sadece yukarıdaki metinlerdeki doğrulanmış bilgileri kullan.
- Uydurma alıntı, tanık, rakam, tarih, fiyat veya kurum ekleme.
- Kaynağın cümlelerini kopyalama; kendi gazetecilik dilinle, olguları koruyarak yaz.
- Sansasyon yok, abartı yok, başlıkla içerik birebir uyumlu.
- Başlık 40-120 karakter, spot 90-300 karakter, gövde 180-350 kelime.
- Gövde 3-5 paragraf olsun; gerekiyorsa kısa bir bağlam paragrafı ver.
- Türkçe yazım kurallarına uy; resmî kurum adlarını doğru yaz.
- SEO başlığı en fazla 60 karakter, SEO açıklaması 140-160 karakter.
- social_copy: 1-2 cümle, sosyal akışta paylaşılabilir, abartısız.
- Metnin hiçbir yerinde "yapay zekâ", "AI", "otomatik", "bot", "derleme", "özet" veya haberin nasıl hazırlandığına dair açıklama kullanma.
- Okuyucuya doğrudan seslenen yapay zekâ notu, editör notu veya şeffaflık paragrafı ekleme; metin doğrudan haber gibi başlasın.

Yanıtı yalnızca şu JSON olarak ver:
{"title":"...","spot":"...","body":"paragraflar \\n\\n ile ayrılmış","social_copy":"...","seo_title":"...","seo_description":"...","quality_score":0.8}`;

  let parsed: Json = {};
  let model = ctx.settings.reasoning_model;

  for (const attemptModel of [ctx.settings.reasoning_model, ctx.settings.fast_model]) {
    try {
      const raw = await chat(ctx, {
        model: attemptModel,
        system:
          'Sen Trabzone Haber için çalışan deneyimli bir Türkçe haber editörüsün. ' +
          'Doğrulanmamış tek bir cümle bile yazmazsın. Yalnızca JSON yanıt verirsin.',
        user: prompt,
        maxTokens: 2200,
      });
      parsed = parseJsonObject(raw);
      model = attemptModel;
      if (asString(parsed.body).length > 350) break;
    } catch (error) {
      await logError(ctx, 'draft', 'draft_model_failed', String(error), { eventId });
    }
  }

  const rawTitle = asString(parsed.title);
  const title = (rawTitle.length >= 15 ? rawTitle : candidate.title).slice(0, 180);
  const spot = normalizeSpot(asString(parsed.spot), asString(parsed.body));
  const body = asString(parsed.body).slice(0, 11900);
  if (!title || !spot || body.length < 350) {
    await logError(ctx, 'draft', 'draft_incomplete', 'Model yeterli uzunlukta metin üretmedi', {
      eventId,
      title_length: title.length,
      spot_length: spot.length,
      body_length: body.length,
    });
    return { draftId: null, quality: 0 };
  }

  const quality = Math.min(
    clamp(asNumber(parsed.quality_score, 0.7), 0, 1),
    heuristicQuality({ title, spot, body }),
  );

  const { data, error } = await svc<{ draft_id: string; version: number; risk_level: string }>(
    'ai_news_draft_save',
    {
      p_event_id: eventId,
      p_payload: {
        title,
        spot,
        body,
        social_copy: asString(parsed.social_copy).slice(0, 500),
        category_slug: classification.category,
        district: classification.district,
        event_date: classification.eventDate,
        seo_title: asString(parsed.seo_title).slice(0, 70),
        seo_description: asString(parsed.seo_description).slice(0, 180),
        quality_score: Number(quality.toFixed(3)),
        plagiarism_score: 0,
        risk_level: classification.risk,
        ai_model: model,
      },
    },
  );

  if (error || !data) {
    await logError(ctx, 'draft', 'draft_save_failed', error ?? 'unknown', { eventId });
    return { draftId: null, quality: 0 };
  }

  ctx.stats.drafts += 1;
  return { draftId: data.draft_id, quality };
}

async function saveDistrictPhoto(
  ctx: RunContext,
  eventId: string,
  district: string | null,
): Promise<boolean> {
  const photo = districtPhoto(district);
  const storagePath = `ai-news/districts/${photo.slug}.jpg`;
  const creator = photo.credit.credit.split(' · ')[0] || 'Wikimedia Commons';
  const altText = district
    ? `${district} ilçesinden bir görünüm`
    : 'Trabzon ilçelerinden bir görünüm';

  try {
    const saved = await svc<{ status: string }>('ai_news_media_save', {
      p_event_id: eventId,
      p_payload: {
        storage_path: storagePath,
        source_url: photo.credit.sourceUrl,
        creator,
        credit: photo.credit.credit,
        attribution: photo.credit.credit,
        license_code: photo.credit.license,
        license_reference: photo.credit.sourceUrl,
        is_placeholder: false,
        event_match_score: 1,
        mime_type: 'image/jpeg',
        alt_text: altText.length > 280 ? altText.slice(0, 280) : altText,
      },
    });

    if (saved.error) {
      await logError(ctx, 'media', 'district_photo_save_failed', saved.error, {
        eventId,
        district: photo.slug,
      });
      return false;
    }
    if (saved.data?.status === 'approved') return true;
    await logError(ctx, 'media', 'district_photo_not_approved', saved.data?.status ?? 'unknown', {
      eventId,
      district: photo.slug,
    });
  } catch (error) {
    await logError(ctx, 'media', 'district_photo_failed', String(error), {
      eventId,
      district: photo.slug,
    });
  }
  return false;
}

async function resolveMedia(
  ctx: RunContext,
  eventId: string,
  title: string,
  category: string,
  district: string | null,
  candidate: Candidate,
  sourceInfo: Source | undefined,
): Promise<void> {
  // 1) İlçenin kendi fotoğrafı: her haberde o ilçeyi temsil eden gerçek görsel.
  if (await saveDistrictPhoto(ctx, eventId, district)) return;

  // 2) Resmî kaynağın yazılı izinli görseli.
  if (
    sourceInfo &&
    sourceInfo.kind === 'official' &&
    sourceInfo.media_license_code === 'official_press_permission' &&
    sourceInfo.license_reference
  ) {
    try {
      const page = await fetch(candidate.url, {
        headers: { 'User-Agent': 'TrabzoneNewsBot/1.0 (+https://trabzone.app)' },
      });
      if (page.ok) {
        const html = await page.text();
        const imageUrl = extractOgImage(html);
        if (imageUrl && sameSite(imageUrl, sourceInfo.domain)) {
          const image = await fetch(imageUrl, {
            headers: { 'User-Agent': 'TrabzoneNewsBot/1.0 (+https://trabzone.app)' },
            redirect: 'follow',
          });
          const contentType = image.headers.get('content-type') ?? 'image/jpeg';
          if (image.ok && contentType.startsWith('image/')) {
            const rawBytes = new Uint8Array(await image.arrayBuffer());
            if (rawBytes.byteLength >= 15_000) {
              const bytes = contentType.includes('jpeg')
                ? stripJpegMetadata(rawBytes)
                : rawBytes;
              const ext = imageExtension(contentType, imageUrl);
              const path = `ai-news/${eventId}/${Date.now()}-official.${ext}`;
              await uploadToPosts(path, bytes, contentType.split(';')[0]);

              const saved = await svc<{ status: string }>('ai_news_media_save', {
                p_event_id: eventId,
                p_payload: {
                  storage_path: path,
                  source_url: imageUrl,
                  creator: sourceInfo.name,
                  credit: sourceInfo.attribution_text ?? sourceInfo.name,
                  attribution: sourceInfo.attribution_text ?? sourceInfo.name,
                  license_code: 'official_press_permission',
                  license_reference: sourceInfo.license_reference,
                  is_placeholder: false,
                  event_match_score: 0.92,
                  mime_type: contentType.split(';')[0],
                  alt_text: title.slice(0, 280),
                },
              });

              if (saved.data?.status === 'approved') return;
            }
          }
        }
      }
    } catch (error) {
      await logError(ctx, 'media', 'official_photo_failed', String(error), {
        eventId,
        source: sourceInfo.domain,
      });
    }
  }

  // 3) Lisansı ve olay ilişkisi doğrulanmış gerçek fotoğraf (Openverse / Wikimedia).
  try {
    const photo = await findLicensedPhoto(ctx, title, candidate.district ?? null, category);
    if (photo) {
      const image = await fetch(photo.imageUrl, {
        headers: { 'User-Agent': 'TrabzoneNewsBot/1.0 (+https://trabzone.app)' },
        redirect: 'follow',
      });
      const contentType = image.headers.get('content-type') ?? 'image/jpeg';
      if (image.ok && contentType.startsWith('image/')) {
        const rawBytes = new Uint8Array(await image.arrayBuffer());
        if (rawBytes.byteLength >= 15_000) {
          const bytes = contentType.includes('jpeg') ? stripJpegMetadata(rawBytes) : rawBytes;
          const ext = imageExtension(contentType, photo.imageUrl);
          const path = `ai-news/${eventId}/${Date.now()}-licensed.${ext}`;
          await uploadToPosts(path, bytes, contentType.split(';')[0]);

          const saved = await svc<{ status: string }>('ai_news_media_save', {
            p_event_id: eventId,
            p_payload: {
              storage_path: path,
              source_url: photo.pageUrl,
              creator: photo.creator,
              credit: photo.credit,
              attribution: photo.credit,
              license_code: photo.licenseCode,
              license_reference: photo.licenseReference,
              is_placeholder: false,
              event_match_score: photo.matchScore,
              width: photo.width || null,
              height: photo.height || null,
              mime_type: contentType.split(';')[0],
              alt_text: title.slice(0, 280),
            },
          });
          if (saved.data?.status === 'approved') return;
        }
      }
    }
  } catch (error) {
    await logError(ctx, 'media', 'licensed_photo_failed', String(error), { eventId });
  }

  // 4) Son çare: Trabzon merkezini temsil eden ilçe fotoğrafı.
  // Kategori tasarımı veya yapay zekâ görseli hiçbir zaman kullanılmaz.
  await saveDistrictPhoto(ctx, eventId, null);
}

async function processCandidate(
  ctx: RunContext,
  candidate: Candidate,
  sources: Map<string, Source>,
): Promise<void> {
  // Arama özeti kısaltılmış olabilir; tam metni bir kez getir.
  if (candidate.content.length < 2000) {
    try {
      const full = await fetchPage(ctx, candidate.url);
      if (full.length > candidate.content.length) {
        candidate.content = full.slice(0, 20000);
      }
    } catch (error) {
      await logError(ctx, 'fetch', 'primary_fetch_failed', String(error), {
        url: candidate.url,
      });
    }
  }

  const classification = await classifyCandidate(ctx, candidate);
  if (!classification) {
    await svc('ai_news_result_mark', {
      p_result_id: candidate.id,
      p_status: 'ignored',
      p_reason: 'not_trabzon',
    });
    ctx.stats.ignored_results += 1;
    return;
  }

  ctx.stats.events += 1;
  if (!classification.event.created) ctx.stats.duplicates += 1;

  // Aynı olay zaten yayımlandıysa yeni gönderi üretme.
  if (classification.event.status === 'published' || classification.event.status === 'retracted') {
    return;
  }

  const sourceInfo = sources.get(candidate.source_domain.toLowerCase());
  const verification = await verifyEvent(
    ctx,
    classification.event.event_id,
    classification,
    candidate,
    sources,
  );

  if (!verification.autoEligible) {
    // Otomatik yayın koşulları sağlanmadıysa haber editör kuyruğuna gider.
    // Editörün inceleyebilmesi için AI taslağı ve lisanslı/placeholder
    // görsel adayı risk sınıfından bağımsız olarak hazırlanır.
    const reviewDraft = await writeDraft(
      ctx,
      classification.event.event_id,
      classification,
      candidate,
      sourceInfo,
    );
    if (reviewDraft.draftId) {
      await resolveMedia(
        ctx,
        classification.event.event_id,
        candidate.title,
        classification.category,
        classification.district,
        candidate,
        sourceInfo,
      );
    }
    await svc('ai_news_finalize', {
      p_event_id: classification.event.event_id,
      p_run_id: ctx.runId,
    });
    ctx.stats.queued += 1;
    return;
  }

  const draft = await writeDraft(
    ctx,
    classification.event.event_id,
    classification,
    candidate,
    sourceInfo,
  );

  if (!draft.draftId) {
    await svc('ai_news_finalize', {
      p_event_id: classification.event.event_id,
      p_run_id: ctx.runId,
    });
    ctx.stats.queued += 1;
    return;
  }

  await resolveMedia(
    ctx,
    classification.event.event_id,
    candidate.title,
    classification.category,
    classification.district,
    candidate,
    sourceInfo,
  );

  const finalized = await svc<{ action: string; reasons: unknown }>('ai_news_finalize', {
    p_event_id: classification.event.event_id,
    p_run_id: ctx.runId,
  });

  if (finalized.error) {
    await logError(ctx, 'publish', 'finalize_failed', finalized.error, {
      eventId: classification.event.event_id,
    });
    ctx.stats.queued += 1;
    return;
  }

  if (finalized.data?.action === 'published') ctx.stats.published += 1;
  else ctx.stats.queued += 1;
}

async function recoverQueuedDrafts(
  ctx: RunContext,
  sources: Map<string, Source>,
): Promise<void> {
  type RecoveryItem = Candidate & {
    event_id: string;
    risk_level: 'A' | 'B' | 'C';
    category_slug: string | null;
    district: string | null;
    event_date: string | null;
    summary_text: string | null;
  };

  const { data } = await svc<RecoveryItem[]>('ai_news_events_needing_draft', { p_limit: 2 });
  for (const item of data ?? []) {
    if (ctx.budgetExhausted) break;
    await svc('ai_news_run_heartbeat', { p_run_id: ctx.runId });

    const candidate: Candidate = {
      id: item.id,
      title: item.title,
      url: item.url,
      source_domain: item.source_domain,
      source_kind: item.source_kind,
      snippet: item.snippet,
      summary: item.summary_text,
      content: item.content ?? '',
      published_at: item.published_at,
      query: null,
    };
    const classification: Classification = {
      event: {
        event_id: item.event_id,
        created: false,
        status: 'awaiting_review',
        primary_source: false,
        independent_sources: 0,
      },
      risk: item.risk_level,
      category: item.category_slug || 'diger',
      district: item.district,
      eventDate: item.event_date,
      summary: item.summary ?? '',
      facts: [],
      institutions: [],
    };

    try {
      const draft = await writeDraft(
        ctx,
        item.event_id,
        classification,
        candidate,
        sources.get(item.source_domain?.toLowerCase() ?? ''),
      );
      if (draft.draftId) {
        await resolveMedia(
          ctx,
          item.event_id,
          item.title,
          classification.category,
          classification.district,
          candidate,
          sources.get(item.source_domain?.toLowerCase() ?? ''),
        );
      }
    } catch (error) {
      await logError(ctx, 'draft', 'draft_recovery_failed', String(error), {
        eventId: item.event_id,
      });
    }
  }
}

async function runPipeline(
  ctx: RunContext,
  begin: BeginPayload,
): Promise<void> {
  const sources = await loadSources();
  const topicStats: Array<{ id: string; hits: number }> = [];

  for (const topic of begin.topics ?? []) {
    await svc('ai_news_run_heartbeat', { p_run_id: ctx.runId });
    if (ctx.budgetExhausted) break;

    try {
      const { results } = await searchWeb(ctx, topic.query, 8);
      ctx.stats.searches += 1;
      ctx.stats.search_results += results.length;

      if (results.length === 0) {
        topicStats.push({ id: topic.id, hits: 0 });
        continue;
      }

      const recorded = await svc<{ new: number; ignored: number }>('ai_news_record_results', {
        p_run_id: ctx.runId,
        p_query: topic.query,
        p_results: results,
        p_source: 'search',
      });
      if (recorded.data) {
        ctx.stats.new_results += recorded.data.new;
        ctx.stats.ignored_results += recorded.data.ignored;
      }
      topicStats.push({ id: topic.id, hits: recorded.data?.new ?? 0 });
    } catch (error) {
      await logError(ctx, 'search', 'search_failed', String(error), { query: topic.query });
      topicStats.push({ id: topic.id, hits: 0 });
    }
  }

  await svc('ai_news_topic_mark', { p_topics: topicStats });

  const { data: candidateData } = await svc<{ items: Candidate[] }>('ai_news_candidates', {
    p_run_id: ctx.runId,
    p_limit: ctx.settings.max_events_per_run,
  });

  for (const candidate of candidateData?.items ?? []) {
    if (ctx.budgetExhausted) break;
    await svc('ai_news_run_heartbeat', { p_run_id: ctx.runId });

    try {
      await processCandidate(ctx, candidate, sources);
    } catch (error) {
      await logError(ctx, 'pipeline', 'candidate_failed', String(error), {
        candidate: candidate.url,
      });
      try {
        await svc('ai_news_result_mark', {
          p_result_id: candidate.id,
          p_status: 'rejected',
          p_reason: 'processing_failed',
        });
      } catch {
        // Yoksay.
      }
    }
  }

  // Önceki çalışmalarda taslağı üretilememiş kuyruk olaylarını tamamla.
  if (!ctx.budgetExhausted) {
    await recoverQueuedDrafts(ctx, sources);
  }
}

// ---------------------------------------------------------------------------
// Tanılama
// ---------------------------------------------------------------------------
async function diagnostics(): Promise<Json> {
  const result: Json = {
    checked_at: new Date().toISOString(),
    base_url: deepseekBase(),
    models: [],
    chat_ok: false,
    search_ok: false,
    fetch_ok: false,
  };

  try {
    const models = await deepseek('/models', null, 'GET');
    if (models.ok) {
      const list = asArray(models.data.data ?? models.data.models ?? models.data);
      result.models = list
        .map((entry) => (entry && typeof entry === 'object' ? asString((entry as Json).id) : ''))
        .filter(Boolean);
    } else {
      result.models_error = `${models.status}: ${preview(models.text, 200)}`;
    }
  } catch (error) {
    result.models_error = preview(String(error), 200);
  }

  try {
    const balance = await deepseek('/user/balance', null, 'GET');
    if (balance.ok) {
      result.balance = {
        available: balance.data.is_available ?? null,
        balances: balance.data.balance_infos ?? balance.data.balances ?? null,
      };
    }
  } catch {
    // Bakiye ucu opsiyonel.
  }

  const models = result.models as string[];
  const chatModel = models.includes('deepseek-chat')
    ? 'deepseek-chat'
    : models[0] || 'deepseek-chat';

  try {
    const chatResponse = await deepseek('/chat/completions', {
      model: chatModel,
      messages: [{ role: 'user', content: 'Yalnızca OK yaz.' }],
      max_tokens: 8,
      temperature: 0,
      stream: false,
    });
    result.chat_ok = chatResponse.ok;
    result.chat_model = chatModel;
    if (!chatResponse.ok) {
      result.chat_error = `${chatResponse.status}: ${preview(chatResponse.text, 300)}`;
    }
  } catch (error) {
    result.chat_error = preview(String(error), 300);
  }

  try {
    const searchResponse = await deepseek('/v1/tools/search', {
      query: 'Trabzon son dakika haber',
      count: 3,
      need_content: false,
    });
    result.search_ok = searchResponse.ok;
    result.search_status = searchResponse.status;
    result.search_sample = preview(JSON.stringify(searchResponse.data), 1500);
    if (!searchResponse.ok) {
      result.search_error = `${searchResponse.status}: ${preview(searchResponse.text, 300)}`;
    }
  } catch (error) {
    result.search_error = preview(String(error), 300);
  }

  try {
    const fetchResponse = await deepseek('/v1/tools/fetch', { url: 'https://www.trabzon.bel.tr' });
    result.fetch_ok = fetchResponse.ok;
    result.fetch_status = fetchResponse.status;
    result.fetch_sample = preview(JSON.stringify(fetchResponse.data), 900);
    if (!fetchResponse.ok) {
      result.fetch_error = `${fetchResponse.status}: ${preview(fetchResponse.text, 300)}`;
    }
  } catch (error) {
    result.fetch_error = preview(String(error), 300);
  }

  // Lisanslı görsel sağlayıcılarının gerçekten erişilebilir olduğunu ve
  // eşleşme eşiğini geçebilen bir aday ürettiğini doğrular.
  try {
    const commonsProbe = new URL('https://commons.wikimedia.org/w/api.php');
    commonsProbe.searchParams.set('action', 'query');
    commonsProbe.searchParams.set('format', 'json');
    commonsProbe.searchParams.set('generator', 'search');
    commonsProbe.searchParams.set('gsrsearch', 'filetype:bitmap Uzungöl');
    commonsProbe.searchParams.set('gsrnamespace', '6');
    commonsProbe.searchParams.set('gsrlimit', '3');
    commonsProbe.searchParams.set('prop', 'imageinfo');
    commonsProbe.searchParams.set('iiprop', 'url|size|extmetadata');
    commonsProbe.searchParams.set('iiextmetadatafilter', 'LicenseShortName|LicenseUrl|Artist|ImageDescription');
    const commonsResponse = await fetch(commonsProbe, {
      headers: { 'User-Agent': 'TrabzoneNewsBot/1.0 (+https://trabzone.app)' },
      signal: AbortSignal.timeout(12000),
    });
    result.commons_status = commonsResponse.status;
    const commonsJson = (await commonsResponse.json()) as Json;
    const commonsPages = (commonsJson.query ?? {}) as Json;
    const entries = commonsPages.pages && typeof commonsPages.pages === 'object'
      ? (Object.values(commonsPages.pages as Json) as Json[])
      : [];
    result.commons_pages = entries.length;
    const first = entries[0];
    const info = first ? asArray(first.imageinfo)[0] as Json | undefined : undefined;
    result.commons_first = info
      ? {
          title: asString(first?.title),
          license: asString(((((info.extmetadata ?? {}) as Json).LicenseShortName ?? {}) as Json).value),
          width: asNumber(info.thumbwidth) || asNumber(info.width),
        }
      : null;

    const query = 'Uzungöl';
    const settled = await Promise.allSettled([searchWikimediaCommons(query), searchOpenverse(query)]);
    const photos: LicensedPhoto[] = [];
    const providerStatus: Record<string, number> = {};
    settled.forEach((outcome, index) => {
      const name = index === 0 ? 'wikimedia' : 'openverse';
      if (outcome.status === 'fulfilled') {
        providerStatus[name] = outcome.value.length;
        photos.push(...outcome.value);
      } else {
        providerStatus[name] = -1;
      }
    });
    const scored = photos
      .map((photo) => ({
        ...photo,
        matchScore: photoMatchScore('Uzungöl', null, `${photo.description} ${photo.credit}`),
      }))
      .filter((photo) => {
        const haystack = `${photo.description} ${photo.credit}`.toLocaleLowerCase('tr-TR');
        return photoTokens('Uzungöl').some((token) => haystack.includes(token)) && photo.matchScore >= 0.75;
      })
      .sort((a, b) => b.matchScore - a.matchScore);
    result.media_ok = scored.length > 0;
    result.media_providers = providerStatus;
    result.media_sample = scored[0]
      ? {
          license: scored[0].licenseCode,
          license_reference: scored[0].licenseReference,
          creator: scored[0].creator,
          match_score: scored[0].matchScore,
          page: scored[0].pageUrl,
        }
      : null;
  } catch (error) {
    result.media_error = preview(String(error), 300);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Yönetici yardımcıları
// ---------------------------------------------------------------------------
async function assist(
  action: string,
  payload: Json,
  jwt: string,
  ctx: RunContext,
): Promise<Json> {
  const eventId = asString(payload.event_id);
  if (!eventId) throw new Error('event_id_required');

  const { data: review, error } = await rpcAs<Json>('admin_ai_news_review_get', {
    p_event_id: eventId,
  }, jwt);
  if (error || !review) throw new Error(error ?? 'event_not_found');

  const draft = (review.draft ?? {}) as Json;
  const event = (review.event ?? {}) as Json;
  const evidence = asArray(review.evidence) as Json[];

  if (action === 'rewrite') {
    const prompt = `Aşağıdaki AI hazırlığı haber taslağını editör için iyileştir.

BAŞLIK: ${asString(draft.title)}
SPOT: ${asString(draft.spot)}
GÖVDE:
${asString(draft.body).slice(0, 8000)}

KAYNAKLAR:
${evidence.map((item, index) => `[${index + 1}] ${asString(item.domain)}: ${asString(item.title)}\n${asString(item.excerpt).slice(0, 700)}`).join('\n\n').slice(0, 8000)}

Kurallar: Yeni bilgi ekleme; yalnızca kaynaklardaki olguları koru. Başlığı içerikle uyumlu hale getir,
spotu netleştir, gövdeyi sadeleştir, yazım hatalarını düzelt. Aynı JSON alanlarını döndür:
{"title":"...","spot":"...","body":"...","social_copy":"...","seo_title":"...","seo_description":"..."}`;

    const raw = await chat(ctx, {
      model: ctx.settings.reasoning_model,
      system:
        'Sen deneyimli bir Türkçe haber editörüsün. Kaynak dışı bilgi üretmezsin. JSON döndürürsün.',
      user: prompt,
      maxTokens: 2200,
    });
    return { suggestion: parseJsonObject(raw) };
  }

  if (action === 'recheck_sources') {
    const title = asString(event.title);
    const district = asString(event.district);
    const bundle = await gatherEvidence(ctx, title, district || null, null);
    for (const item of bundle.items) {
      await svc('ai_news_evidence_add', {
        p_event_id: eventId,
        p_payload: {
          url: item.url,
          title: item.title,
          excerpt: item.excerpt,
          content: item.excerpt,
          source_kind: item.kind,
          fetched_via: 'fetch',
        },
      });
    }
    return { added: bundle.items.length, sources: bundle.items.map((item) => item.domain) };
  }

  if (action === 'find_photo') {
    const sources = await loadSources();
    const candidate: Candidate = {
      id: 0,
      title: asString(draft.title) || asString(event.title),
      url: asString(evidence[0]?.url),
      source_domain: asString(evidence[0]?.domain),
      source_kind: asString(evidence[0]?.kind, 'unknown'),
      snippet: '',
      summary: '',
      content: '',
      published_at: null,
      query: null,
    };
    const sourceInfo = sources.get(candidate.source_domain.toLowerCase());
    await resolveMedia(
      ctx,
      eventId,
      candidate.title,
      asString(event.category_slug),
      asString(event.district) || null,
      candidate,
      sourceInfo,
    );
    const media = await svcSelect<{
      license_code: string;
      is_placeholder: boolean;
      storage_path: string;
      credit: string | null;
    }>(
      'ai_news_media_assets',
      `select=license_code,is_placeholder,storage_path,credit&event_id=eq.${encodeURIComponent(eventId)}&status=eq.approved&order=is_placeholder.asc,created_at.desc&limit=1`,
    );
    const found = media[0];
    return {
      found: Boolean(found && !found.is_placeholder),
      license_code: found?.license_code ?? null,
      credit: found?.credit ?? null,
      placeholder: found ? found.is_placeholder : true,
      storage_path: found?.storage_path ?? null,
    };
  }

  // Editör için tek amaçlı metin işlemleri. Hepsi yalnızca kayıtlı kaynaklara
  // dayanır; doğrulama ve kaynak kayıtları değiştirilmez.
  const textActions: Record<string, string> = {
    improve_title:
      'Yalnızca başlığı iyileştir: içerikle birebir uyumlu, sansasyonsuz, 60-120 karakter. ' +
      'Yanıt: {"title":"..."}',
    simplify:
      'Gövdeyi ve spotu sadeleştir: gereksiz uzun cümleleri kısalt, anlamı ve olguları koru. ' +
      'Yanıt: {"spot":"...","body":"..."}',
    proofread:
      'Yazım, dil bilgisi ve noktalama hatalarını düzelt; olguları ve cümle yapısını değiştirme. ' +
      'Yanıt: {"title":"...","spot":"...","body":"..."}',
    social_copy:
      'Sosyal akış için 1-2 cümlelik, abartısız, haberin özünü veren paylaşım metni hazırla. ' +
      'Yanıt: {"social_copy":"..."}',
    check_conflicts:
      'Kaynakları birbiriyle karşılaştır: tarih, yer, kurum, sayı ve olay örgüsü çelişkilerini ' +
      'listeleyerek incele. Yeni bilgi ekleme. Yanıt: {"conflicts":["..."],"notes":"..."}',
  };

  const instruction = textActions[action];
  if (instruction) {
    const raw = await chat(ctx, {
      model: ctx.settings.reasoning_model,
      system:
        'Sen deneyimli bir Türkçe haber editörüsün. Yalnızca verilen kaynak ve taslak ' +
        'metinlerdeki olgulara dayanırsın, uydurma bilgi üretmezsin. Yalnızca JSON yanıt verirsin.',
      user: `GÖREV: ${instruction}

BAŞLIK: ${asString(draft.title)}
SPOT: ${asString(draft.spot)}
GÖVDE:
${asString(draft.body).slice(0, 8000)}

KAYNAKLAR:
${evidence.map((item, index) => `[${index + 1}] ${asString(item.domain)}: ${asString(item.title)}\n${asString(item.excerpt).slice(0, 700)}`).join('\n\n').slice(0, 9000)}`,
      maxTokens: 1800,
    });
    return { suggestion: parseJsonObject(raw) };
  }

  throw new Error('invalid_assist_action');
}

async function bootstrapPublisher(bearer: string, isAdmin: boolean): Promise<Json> {
  // Ayarlar admin oturumu ya da service_role ile okunur.
  let username = 'trabzonehaber';
  if (isAdmin) {
    const { data: current } = await rpcAs<Json>('admin_ai_news_settings_get', {}, bearer);
    username = asString((current as Json | null)?.publisher_username, 'trabzonehaber').toLowerCase();
  } else {
    const rows = await svcSelect<{ publisher_username: string }>(
      'ai_news_settings',
      'select=publisher_username&id=eq.true',
    );
    username = asString(rows[0]?.publisher_username, 'trabzonehaber').toLowerCase();
  }

  const profileRows = await svcSelect<{ id: string }>(
    'profiles',
    `select=id&username=eq.${encodeURIComponent(username)}&limit=1`,
  );
  if (profileRows.length > 0) {
    return bindPublisher(username, profileRows[0].id, bearer, isAdmin);
  }

  // Auth kullanıcısı yoksa resmî yayıncı hesabını bir kez oluştur.
  const email = `${username}@trabzone.app`;
  const password = `Tz1${crypto.randomUUID().replace(/-/g, '').slice(0, 40)}Aa`;

  const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      ...keyHeaders(serviceKey()),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: 'Trabzone',
        last_name: 'Haber',
        full_name: 'Trabzone Haber',
      },
    }),
  });

  const text = await response.text();
  let userId = '';
  if (response.ok) {
    const created = JSON.parse(text) as Json;
    userId = asString(created.id) || asString((created.user as Json)?.id);
  }
  if (!userId) {
    // Daha önce oluşturulmuş olabilir; e-posta ile bul.
    const list = await fetch(`${supabaseUrl()}/auth/v1/admin/users?page=1&per_page=200`, {
      headers: { ...keyHeaders(serviceKey()), Accept: 'application/json' },
    });
    if (list.ok) {
      const payload = (await list.json()) as Json;
      const found = asArray(payload.users).find(
        (entry) => asString((entry as Json).email).toLowerCase() === email,
      ) as Json | undefined;
      userId = asString(found?.id);
    }
  }
  if (!userId) {
    throw new Error(`publisher_create_${response.status}: ${preview(text, 300)}`);
  }

  const profilePatch = await fetch(
    `${supabaseUrl()}/rest/v1/profiles?id=eq.${userId}&select=id`,
    {
      method: 'PATCH',
      headers: {
        ...keyHeaders(serviceKey()),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        username,
        first_name: 'Trabzone',
        last_name: 'Haber',
        is_verified: true,
        account_status: 'active',
        bio: 'Trabzone’un resmî haber hesabı. Trabzon ve 18 ilçesinden güncel gelişmeler, resmî duyurular ve yerel yaşam haberleri.',
      }),
    },
  );
  if (!profilePatch.ok) {
    throw new Error(`publisher_profile_${profilePatch.status}: ${preview(await profilePatch.text())}`);
  }
  const patched = (await profilePatch.json()) as Json[];
  if (patched.length === 0) {
    // Trigger profil oluşturmadıysa doğrudan ekle.
    const insert = await fetch(`${supabaseUrl()}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        ...keyHeaders(serviceKey()),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: userId,
        username,
        first_name: 'Trabzone',
        last_name: 'Haber',
        is_verified: true,
        account_status: 'active',
        onboarding_completed: true,
        bio: 'Trabzone’un resmî haber hesabı.',
      }),
    });
    if (!insert.ok) {
      throw new Error(`publisher_profile_insert_${insert.status}: ${preview(await insert.text())}`);
    }
  }

  return bindPublisher(username, userId, bearer, isAdmin);
}

async function bindPublisher(
  username: string,
  userId: string,
  bearer: string,
  isAdmin: boolean,
): Promise<Json> {
  if (isAdmin) {
    return (await rpcAs('admin_ai_news_bind_publisher', { p_username: username }, bearer)).data ?? {};
  }
  await svcUpdate(
    'ai_news_settings',
    { publisher_user_id: userId, publisher_username: username },
    'id=eq.true',
  );
  return { id: userId, username };
}

// ---------------------------------------------------------------------------
// HTTP girişi
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let body: Json = {};
  try {
    body = (await req.json()) as Json;
  } catch {
    body = {};
  }

  const action = asString(body.action, 'run');

  // Sağlık yoklaması: hiçbir gizli değer döndürmez, yalnızca varlık bilgisi.
  if (action === 'health') {
    return json(200, {
      ok: true,
      service_key: serviceKey().length > 0,
      service_key_kind: env('SUPABASE_SERVICE_ROLE_KEY')
        ? 'service_role'
        : env('SUPABASE_SECRET_KEY')
          ? 'secret_key'
          : jsonKey('SUPABASE_SECRET_KEYS')
            ? 'secret_keys_json'
            : 'missing',
      anon_key: anonKey().length > 0,
      service_key_head: serviceKey().slice(0, 6),
      anon_key_head: anonKey().slice(0, 6),
      deepseek_key: env('DEEPSEEK_API_KEY').length > 0,
      supabase_url: supabaseUrl().length > 0,
    });
  }

  const headerToken = req.headers.get('x-ai-news-token') ?? '';
  const authorization = req.headers.get('authorization') ?? '';
  const jwt = authorization.replace(/^Bearer\s+/i, '').trim();

  let workerAuthorized = false;
  let workerAuthError: string | null = null;
  if (headerToken) {
    try {
      const { data, error } = await svc<boolean>('ai_news_worker_token_ok', {
        p_token: headerToken,
      });
      workerAuthorized = data === true;
      workerAuthError = error;
    } catch (error) {
      workerAuthorized = false;
      workerAuthError = preview(String(error), 200);
    }
  }

  let adminAuthorized = false;
  if (!workerAuthorized && jwt && jwt !== anonKey()) {
    const { data } = await rpcAs<boolean>('admin_ai_news_ai_check', {}, jwt);
    adminAuthorized = data === true;
  }

  if (!workerAuthorized && !adminAuthorized) {
    return json(401, {
      error: 'unauthorized',
      token_present: headerToken.length > 0,
      token_length: headerToken.length,
      token_error: workerAuthError,
    });
  }

  if (action === 'diagnostics') {
    try {
      const result = await diagnostics();
      if (adminAuthorized) {
        await rpcAs('admin_ai_news_diagnostics_save', { p_payload: result }, jwt);
      } else {
        await svcUpdate('ai_news_settings', { last_diagnostics: result }, 'id=eq.true');
      }
      return json(200, { ok: true, diagnostics: result });
    } catch (error) {
      return json(500, { ok: false, error: preview(String(error), 400) });
    }
  }

  if (workerAuthorized && action === 'run') {
    const started = Date.now();
    let runId: string | null = null;
    let ctx: RunContext | null = null;

    try {
      const { data: begin, error } = await svc<BeginPayload & { skipped?: string; reason?: string }>(
        'ai_news_run_begin',
        { p_trigger: asString(body.trigger, 'cron') },
      );
      if (error) throw new Error(error);

      if (!begin || begin.skipped) {
        return json(200, {
          ok: true,
          skipped: begin?.skipped ?? 'unknown',
          reason: begin?.reason ?? null,
        });
      }

      runId = asString(begin.run_id);
      const settings = begin.settings;
      ctx = {
        runId,
        settings: {
          max_events_per_run: clamp(asNumber(settings.max_events_per_run, 2), 1, 5),
          max_article_age_hours: asNumber(settings.max_article_age_hours, 72),
          min_quality_score: asNumber(settings.min_quality_score, 0.72),
          duplicate_title_threshold: asNumber(settings.duplicate_title_threshold, 0.45),
          min_media_match: asNumber(settings.min_media_match, 0.6),
          fast_model: asString(settings.fast_model, 'deepseek-flash'),
          reasoning_model: asString(settings.reasoning_model, 'deepseek-v4-pro'),
          auto_publish_enabled: settings.auto_publish_enabled !== false,
          dry_run: settings.dry_run === true,
          price_input_per_m: asNumber(settings.price_input_per_m, 0.3),
          price_output_per_m: asNumber(settings.price_output_per_m, 1.2),
          price_search_per_call: asNumber(settings.price_search_per_call, 0.00075),
          price_fetch_per_call: asNumber(settings.price_fetch_per_call, 0.00075),
          notify_enabled: settings.notify_enabled !== false,
        },
        budgetExhausted: false,
        stats: {
          searches: 0,
          search_results: 0,
          new_results: 0,
          ignored_results: 0,
          events: 0,
          duplicates: 0,
          verified: 0,
          drafts: 0,
          published: 0,
          queued: 0,
          errors: 0,
          cost_usd: 0,
        },
      };

      if (!begin.publisher) {
        await logError(
          ctx,
          'publish',
          'publisher_missing',
          'Trabzone Haber profili bağlı değil; otomatik yayın yapılamaz.',
          {},
        );
      }

      await runPipeline(ctx, begin);

      // Zamanlaması dolan yayına hazır olayları gönder (pencere + aralık kuralları).
      let publishReady: Json = {};
      try {
        const ready = await svc<Json>('ai_news_publish_ready', { p_limit: 2 });
        publishReady = ready.data ?? {};
        if (asNumber((publishReady as Json).published) > 0) {
          ctx.stats.published += asNumber((publishReady as Json).published);
        }
      } catch (error) {
        await logError(ctx, 'publish', 'publish_ready_failed', String(error), {});
      }

      await svc('ai_news_run_finish', {
        p_run_id: runId,
        p_stats: {
          ...ctx.stats,
          duration_ms: Date.now() - started,
          publish_ready: publishReady,
          budget: (await svc('ai_news_budget_status')).data,
        },
        p_error: null,
      });

      return json(200, { ok: true, run_id: runId, stats: ctx.stats });
    } catch (error) {
      if (ctx) {
        await logError(ctx, 'run', 'run_failed', String(error), {});
      }
      if (runId) {
        await svc('ai_news_run_finish', {
          p_run_id: runId,
          p_stats: ctx?.stats ?? {},
          p_error: preview(String(error), 400),
        });
      }
      return json(500, { ok: false, error: preview(String(error), 400), run_id: runId });
    }
  }

  if (action === 'bootstrap_publisher') {
    if (!adminAuthorized && !workerAuthorized) return json(403, { error: 'admin_required' });
    try {
      const result = await bootstrapPublisher(jwt, adminAuthorized);
      return json(200, result ?? { ok: true });
    } catch (error) {
      return json(500, { error: preview(String(error), 400) });
    }
  }

  if (action === 'assist') {
    if (!adminAuthorized) return json(403, { error: 'admin_required' });

    const settings = await readSettings();
    if (!settings || Object.keys(settings).length === 0) {
      return json(500, { error: 'settings_unavailable' });
    }

    const ctx: RunContext = {
      runId: null,
      settings: {
        max_events_per_run: 2,
        max_article_age_hours: asNumber(settings.max_article_age_hours, 72),
        min_quality_score: asNumber(settings.min_quality_score, 0.72),
        duplicate_title_threshold: asNumber(settings.duplicate_title_threshold, 0.45),
        min_media_match: asNumber(settings.min_media_match, 0.6),
        fast_model: asString(settings.fast_model, 'deepseek-flash'),
        reasoning_model: asString(settings.reasoning_model, 'deepseek-v4-pro'),
        auto_publish_enabled: false,
        dry_run: true,
        price_input_per_m: asNumber(settings.price_input_per_m, 0.3),
        price_output_per_m: asNumber(settings.price_output_per_m, 1.2),
        price_search_per_call: asNumber(settings.price_search_per_call, 0.00075),
        price_fetch_per_call: asNumber(settings.price_fetch_per_call, 0.00075),
        notify_enabled: false,
      },
      budgetExhausted: false,
      stats: {
        searches: 0,
        search_results: 0,
        new_results: 0,
        ignored_results: 0,
        events: 0,
        duplicates: 0,
        verified: 0,
        drafts: 0,
        published: 0,
        queued: 0,
        errors: 0,
        cost_usd: 0,
      },
    };

    try {
      const result = await assist(
        asString(body.assist_action),
        (body.payload ?? {}) as Json,
        jwt,
        ctx,
      );
      return json(200, { ok: true, ...result });
    } catch (error) {
      return json(500, { error: preview(String(error), 400) });
    }
  }

  return json(400, { error: 'unknown_action' });
});
