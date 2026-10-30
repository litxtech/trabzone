// deepseek-live-news: Anlık Haber editörü için DeepSeek köprüsü.
//
// DeepSeek anahtarı istemciye inmez. Kullanıcı kendi Supabase JWT'siyle gelir;
// function önce `live_news_ai_check` RPC'siyle oturumu ve dakika/gün kotasını
// doğrular, sonra yalnızca kullanıcının yazdığı metni modele gönderir.
//
// Eylemler:
//   polish   -> başlığı ve açıklamayı düzenler, yazım hatalarını düzeltir
//   title    -> yalnızca başlık alternatifleri üretir
//   category -> metne göre kategori önerir
//   district -> metindeki yer ipuçlarına göre ilçe önerir (konum uydurmaz)
//
// Gizli değerler:
//   DEEPSEEK_API_KEY   (zorunlu)
//   DEEPSEEK_BASE_URL  (opsiyonel)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ACTIONS = new Set(['polish', 'title', 'category', 'district']);

const CATEGORIES = [
  { key: 'guncel', label: 'Güncel' },
  { key: 'trafik', label: 'Trafik & Ulaşım' },
  { key: 'hava', label: 'Hava Durumu' },
  { key: 'etkinlik', label: 'Etkinlik' },
  { key: 'spor', label: 'Spor' },
  { key: 'guvenlik', label: 'Güvenlik' },
  { key: 'altyapi', label: 'Altyapı' },
];

type RequestBody = {
  action?: string;
  title?: string;
  summary?: string;
  district?: string | null;
  mediaKind?: string;
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

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
}

/** Modelin ```json çitlerini ve baştaki açıklamalarını temizler. */
function parseJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Aşağıdaki onarım denemesi.
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Boş nesne dön.
    }
  }
  return {};
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
  token: string,
): Promise<{ data: unknown; error: string | null }> {
  const base = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args ?? {}),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text);
      message = parsed.message ?? parsed.error ?? message;
    } catch {
      // Ham metin yeterli.
    }
    return { data: null, error: message };
  }
  return { data: text ? JSON.parse(text) : null, error: null };
}

const EDITOR_RULES = [
  'Yalnızca kullanıcının verdiği bilgileri kullan. Yeni olay, kişi, sayı, saat, hasar veya sonuç uydurma.',
  'Medyada görünen belirsiz bir unsuru kesin bilgi gibi yazma; “görünüyor”, “iddia ediliyor” gibi temkinli ifade kullan.',
  'Kullanıcının anlatımını değiştirme; yalnızca dilbilgisi, yazım ve okunabilirliği düzelt.',
  'Tıbbi durum, ölüm, yaralanma veya suç isnadı varsa kesinlik iddia etme; resmi doğrulama gerektiğini ima et.',
  'Kısa, sakin ve haber diline uygun Türkçe yaz. Clickbait, emoji ve ünlem yığını kullanma.',
  'Başlık 6-140 karakter, açıklama en fazla 1200 karakter olmalı.',
].join('\n');

function buildPrompt(
  action: string,
  body: RequestBody,
  districts: string[],
): { system: string; user: string; maxTokens: number } {
  const title = asString(body.title).slice(0, 140);
  const summary = asString(body.summary).slice(0, 1200);
  const mediaKind = asString(body.mediaKind, 'text');
  const district = asString(body.district);

  const system = [
    'Sen Trabzone için çalışan deneyimli bir yerel haber editörüsün.',
    'Vatandaşın gönderdiği anlık gelişmeyi yayına hazırlarsın; muhabir gibi yeni bilgi eklemezsin.',
    EDITOR_RULES,
    `Kategoriler: ${CATEGORIES.map((item) => `${item.key} (${item.label})`).join(', ')}.`,
    `Trabzon ilçeleri: ${districts.join(', ')}.`,
  ].join('\n');

  const context = [
    `Başlık: ${title || '(boş)'}`,
    `Açıklama: ${summary || '(boş)'}`,
    `Medya türü: ${mediaKind}`,
    `Kullanıcının seçtiği ilçe: ${district || '(seçilmedi)'}`,
  ].join('\n');

  if (action === 'title') {
    return {
      system,
      user: `${context}

Gönderi için 5 farklı başlık öner. Her biri 6-140 karakter olsun, birbirinden gerçekten farklı ve abartısız olsun.
Yanıtı yalnızca {"titles":["..."]} JSON nesnesi olarak ver.`,
      maxTokens: 500,
    };
  }

  if (action === 'category') {
    return {
      system,
      user: `${context}

Bu gelişme için en uygun kategoriyi seç. Emin değilsen "guncel" seç.
Yanıtı yalnızca {"category":"guncel","reason":"kısa gerekçe"} JSON nesnesi olarak ver.`,
      maxTokens: 300,
    };
  }

  if (action === 'district') {
    return {
      system,
      user: `${context}

Metinde açıkça geçen bir yer adı varsa o ilçeyi öner. Yer adı yoksa veya emin değilsen district null olsun. Konum tahmin etme, koordinat üretme.
Yanıtı yalnızca {"district":"Ortahisar veya null","confidence":"low|medium|high","reason":"kısa gerekçe"} JSON nesnesi olarak ver.`,
      maxTokens: 300,
    };
  }

  return {
    system,
    user: `${context}

Başlığı ve açıklamayı düzenle. Yalnızca şu JSON nesnesiyle yanıt ver:
{"title":"düzenlenmiş başlık","summary":"düzenlenmiş açıklama","notes":["yapılan değişikliklerin kısa listesi"]}`,
    maxTokens: 900,
  };
}

async function callDeepSeek(
  model: string,
  prompt: { system: string; user: string; maxTokens: number },
): Promise<{
  content: string;
  usage: { prompt_tokens?: number; completion_tokens?: number };
}> {
  const apiKey = env('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('deepseek_key_missing');
  const base = (env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com').replace(/\/+$/, '');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: 0.25,
        max_tokens: prompt.maxTokens,
        stream: false,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`deepseek_${response.status}: ${text.slice(0, 200)}`);
    }
    const payload = JSON.parse(text);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('deepseek_empty_response');
    }
    return { content, usage: payload.usage ?? {} };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  const started = Date.now();
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json(401, { ok: false, error: 'auth_required' });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const action = asString(body.action, 'polish');
  if (!ACTIONS.has(action)) {
    return json(400, { ok: false, error: 'invalid_action' });
  }

  if (!asString(body.title) && !asString(body.summary)) {
    return json(400, { ok: false, error: 'empty_content' });
  }

  const check = await rpc('live_news_ai_check', {}, token);
  if (check.error) {
    return json(429, { ok: false, error: 'rate_limited', detail: check.error.slice(0, 200) });
  }
  const model = asString((check.data as { model?: string } | null)?.model, 'deepseek-chat');

  const districtResponse = await rpc('live_news_districts', {}, token);
  const districts = Array.isArray(districtResponse.data)
    ? (districtResponse.data as string[])
    : [];
  if (districts.length === 0) {
    return json(500, { ok: false, error: 'districts_unavailable' });
  }

  try {
    const prompt = buildPrompt(action, body, districts);
    const result = await callDeepSeek(model, prompt);
    const duration = Date.now() - started;
    const parsed = parseJsonObject(result.content);

    await rpc(
      'live_news_ai_log',
      {
        p_action: action,
        p_model: model,
        p_ok: true,
        p_error_code: null,
        p_tokens_in: result.usage.prompt_tokens ?? null,
        p_tokens_out: result.usage.completion_tokens ?? null,
        p_duration_ms: duration,
      },
      token,
    );

    if (action === 'title') {
      const titles = asStringArray(parsed.titles, 5)
        .map((item) => item.slice(0, 140))
        .filter((item) => item.length >= 6);
      if (titles.length === 0) throw new Error('model_json_invalid');
      return json(200, { ok: true, action, model, titles, duration_ms: duration });
    }

    if (action === 'category') {
      const category = asString(parsed.category, 'guncel');
      if (!CATEGORIES.some((item) => item.key === category)) {
        throw new Error('model_json_invalid');
      }
      return json(200, {
        ok: true,
        action,
        model,
        category,
        reason: asString(parsed.reason).slice(0, 240),
        duration_ms: duration,
      });
    }

    if (action === 'district') {
      const rawDistrict = asString(parsed.district);
      const district = districts.includes(rawDistrict) ? rawDistrict : null;
      return json(200, {
        ok: true,
        action,
        model,
        district,
        confidence: asString(parsed.confidence, 'low'),
        reason: asString(parsed.reason).slice(0, 240),
        duration_ms: duration,
      });
    }

    const newTitle = asString(parsed.title).slice(0, 140);
    const newSummary = asString(parsed.summary).slice(0, 1200);
    if (newTitle.length < 6) throw new Error('model_json_invalid');
    return json(200, {
      ok: true,
      action,
      model,
      title: newTitle,
      summary: newSummary,
      notes: asStringArray(parsed.notes, 5).map((item) => item.slice(0, 160)),
      duration_ms: duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ai_failed';
    const duration = Date.now() - started;
    await rpc(
      'live_news_ai_log',
      {
        p_action: action,
        p_model: model,
        p_ok: false,
        p_error_code: message.slice(0, 120),
        p_tokens_in: null,
        p_tokens_out: null,
        p_duration_ms: duration,
      },
      token,
    );
    return json(message.includes('deepseek_key_missing') ? 503 : 502, {
      ok: false,
      error: message.includes('deepseek_key_missing') ? 'deepseek_key_missing' : 'ai_failed',
      detail: message.slice(0, 300),
    });
  }
});
