// deepseek-blog: yönetici panelindeki blog editörü için DeepSeek köprüsü.
//
// Neden edge function: DeepSeek API anahtarı istemci paketine giremez. İstemci
// yalnızca kendi Supabase JWT'siyle buraya gelir; function önce kullanıcının
// yönetici olduğunu `admin_blog_ai_check` RPC'siyle doğrular, sonra anahtarı
// yalnızca sunucuda bulunan `DEEPSEEK_API_KEY` ortam değişkeninden okur.
//
// Eylemler:
//   article  -> { title, excerpt, body_markdown }
//   seo      -> { slug, seo_title, seo_description, keywords, tags, faq }
//   improve  -> { body_markdown }
//   title    -> { titles: string[] }
//   faq      -> { faq: {question, answer}[] }
//   outline  -> { outline: string }
//
// Gizli değerler (Supabase secrets):
//   DEEPSEEK_API_KEY   (zorunlu)
//   DEEPSEEK_BASE_URL  (opsiyonel, varsayılan https://api.deepseek.com)
//   SUPABASE_URL, SUPABASE_ANON_KEY otomatik gelir.

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ACTIONS = new Set(['article', 'seo', 'improve', 'title', 'faq', 'outline']);

type FaqItem = { question: string; answer: string };

type RequestBody = {
  action?: string;
  topic?: string;
  category?: string;
  keywords?: string[];
  audience?: string;
  tone?: string;
  targetWords?: number;
  notes?: string;
  title?: string;
  body_markdown?: string;
  instructions?: string;
  count?: number;
};

type AiSettings = {
  enabled: boolean;
  model: string;
  temperature: number;
  system_prompt: string;
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

function asStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
}

/** Modelin ```json çitleri veya baştaki açıklamalarını temizler. */
function parseJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Aşağıdaki onarım denemeleri.
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Yut ve boş nesne dön.
    }
  }
  return {};
}

function normalizeFaq(value: unknown): FaqItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const question = asString(record.question);
      const answer = asString(record.answer);
      if (question.length < 5 || answer.length < 5) return null;
      return { question: question.slice(0, 240), answer: answer.slice(0, 1200) };
    })
    .filter((item): item is FaqItem => item !== null)
    .slice(0, 10);
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

function buildMessages(
  body: RequestBody,
  settings: AiSettings,
): { messages: { role: string; content: string }[]; jsonMode: boolean; maxTokens: number } {
  const topic = asString(body.topic).slice(0, 300);
  const category = asString(body.category, 'Gezi').slice(0, 60);
  const keywords = asStringArray(body.keywords, 8);
  const audience = asString(body.audience, 'Trabzon’u gezecek veya Trabzon’da yaşayacak yetişkinler').slice(0, 200);
  const tone = asString(body.tone, 'samimi, net, abartısız').slice(0, 120);
  const notes = asString(body.notes).slice(0, 1200);
  const title = asString(body.title).slice(0, 200);
  const existingBody = asString(body.body_markdown).slice(0, 60000);
  const instructions = asString(body.instructions).slice(0, 1500);
  const targetWords = clamp(Number(body.targetWords) || 1800, 700, 3500);

  const style = [
    'Türkçe yaz. Trabzon’a özgü somut ayrıntılar kullan; genel geçer turizm cümleleri kurma.',
    'Uydurma istatistik, uydurma fiyat, uydurma mekân adı veya doğrulanamaz iddia üretme.',
    'Fiyat ve süre gibi değişken bilgilerde “yaklaşık” de, güncel doğrulama öner.',
    'Kısa paragraflar, açıklayıcı H2/H3 başlıklar, en az bir tablo ve madde listesi kullan.',
    'Metni H1 ile başlatma; başlık ayrı alanda dönecek.',
    'Markdown kullan; kod bloğu, HTML veya reklam dili kullanma.',
    'Okuyucuya gerçek fayda ver: kim için, ne zaman, nasıl, ne kadar, nelere dikkat edilmeli sorularını yanıtla.',
  ].join('\n');

  const system = `${settings.system_prompt || 'Sen Trabzone için çalışan deneyimli bir SEO içerik editörüsün.'}\n\n${style}`;

  if (body.action === 'article') {
    const prompt = `Aşağıdaki konuda uzun biçimli bir blog yazısı yaz.

Konu: ${topic || title}
Kategori: ${category}
Hedef okuyucu: ${audience}
Ton: ${tone}
Hedef uzunluk: en az ${targetWords} kelime
Anahtar kelimeler: ${keywords.length ? keywords.join(', ') : 'konuya uygun doğal anahtar kelimeler'}
${notes ? `Editör notları: ${notes}` : ''}

Yapı:
- En az 6 adet H2 bölümü; gerektiğinde H3 alt başlıkları.
- Girişte okuyucunun neden bu yazıyı okuması gerektiğini somut biçimde anlat.
- En az bir karşılaştırma/özet tablosu.
- "Pratik ipuçları" ve "Sık yapılan hatalar" bölümleri.
- Sonunda "Sık sorulan sorular" başlığı altında 4-6 soru-cevap (soru kalın, cevap kısa paragraf).
- Sonuç bölümünde net bir eylem önerisi.

Yanıtı yalnızca şu JSON nesnesi olarak ver:
{"title":"60-90 karakter arası çekici ama abartısız başlık","excerpt":"140-300 karakter arası özet","body_markdown":"tam markdown gövde"}`;
    return {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      jsonMode: true,
      maxTokens: Math.min(8192, targetWords * 2 + 1200),
    };
  }

  if (body.action === 'seo') {
    const prompt = `Aşağıdaki blog yazısı için SEO meta verileri üret.

Başlık: ${title}
Kategori: ${category}
Mevcut anahtar kelimeler: ${keywords.length ? keywords.join(', ') : 'yok'}
${instructions ? `Editör notu: ${instructions}` : ''}

Gövde:
${existingBody.slice(0, 24000)}

Kurallar:
- slug: Türkçe karakter içermeyen, küçük harfli, 3-8 kelimelik, tire ile ayrılmış URL parçası.
- seo_title: en fazla 60 karakter, tıklanabilir ama clickbait olmayan.
- seo_description: 140-160 karakter, arama niyetini yanıtlayan.
- keywords: 6-10 adet, kısa ve uzun kuyruk aramalar.
- tags: 3-6 adet etiket.
- faq: 5-8 adet soru-cevap; cevaplar 1-3 cümle, yazıdaki bilgilerle tutarlı.

Yanıtı yalnızca şu JSON nesnesi olarak ver:
{"slug":"...","seo_title":"...","seo_description":"...","keywords":["..."],"tags":["..."],"faq":[{"question":"...","answer":"..."}]}`;
    return {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      jsonMode: true,
      maxTokens: 2600,
    };
  }

  if (body.action === 'improve') {
    const prompt = `Aşağıdaki blog yazısını daha güçlü, daha özgün ve SEO açısından daha iyi hale getir.

Başlık: ${title}
${instructions ? `İstenen iyileştirme: ${instructions}` : 'Eksik bölümleri tamamla, tekrarları azalt, somut örnek ve pratik bilgi ekle.'}

Mevcut gövde:
${existingBody}

Kurallar:
- Yazarın tonunu ve yapısını koru; baştan yazmak yerine iyileştir.
- Bilgi uydurma; emin olmadığın yerde genel ifade kullan.
- En az 5 H2 başlığı ve bir tablo olsun.
- Yanıtı yalnızca {"body_markdown":"..."} JSON nesnesi olarak ver.`;
    return {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      jsonMode: true,
      maxTokens: Math.min(8192, Math.max(3000, Math.ceil(existingBody.length / 2))),
    };
  }

  if (body.action === 'title') {
    const count = clamp(Number(body.count) || 8, 3, 12);
    const prompt = `"${topic || title}" konusu için ${count} farklı blog başlığı öner.
Kurallar: Türkçe, 45-85 karakter, abartısız, arama niyetine uygun, birbirinden gerçekten farklı.
Yanıtı yalnızca {"titles":["..."]} JSON nesnesi olarak ver.`;
    return {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      jsonMode: true,
      maxTokens: 900,
    };
  }

  if (body.action === 'faq') {
    const prompt = `Aşağıdaki blog yazısı için 6 adet sık sorulan soru ve cevap üret.

Başlık: ${title}
Gövde:
${existingBody.slice(0, 20000)}

Kurallar: Sorular gerçek arama niyetini yansıtsın; cevaplar 1-3 cümle ve yazıyla tutarlı olsun. Uydurma veri kullanma.
Yanıtı yalnızca {"faq":[{"question":"...","answer":"..."}]} JSON nesnesi olarak ver.`;
    return {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      jsonMode: true,
      maxTokens: 1600,
    };
  }

  const prompt = `"${topic || title}" konulu, ${category} kategorisinde, en az ${targetWords} kelimelik bir blog yazısı için ayrıntılı bir taslak hazırla.
Her bölüm için hedefi, alt başlıkları ve eklenecek somut bilgileri yaz. Türkçe markdown düz metin döndür; JSON kullanma.`;
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    jsonMode: false,
    maxTokens: 2200,
  };
}

async function callDeepSeek(
  settings: AiSettings,
  body: RequestBody,
): Promise<{
  content: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}> {
  const apiKey = env('DEEPSEEK_API_KEY');
  if (!apiKey) {
    throw new Error('deepseek_key_missing');
  }
  const base = (env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com').replace(/\/+$/, '');
  const { messages, jsonMode, maxTokens } = buildMessages(body, settings);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 110_000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model || 'deepseek-chat',
        messages,
        temperature: clamp(Number(settings.temperature) || 0.7, 0, 1.5),
        max_tokens: maxTokens,
        stream: false,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error?.message ?? parsed.message ?? detail;
      } catch {
        // Ham metin.
      }
      throw new Error(`deepseek_${response.status}: ${detail}`);
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
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json(401, { ok: false, error: 'auth_required' });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const action = asString(body.action, 'article');
  if (!ACTIONS.has(action)) {
    return json(400, { ok: false, error: 'invalid_action' });
  }
  body.action = action;

  // 1) Yönetici yetkisi: RPC, RLS'li tablolara dokunmadan yalnızca yetki Kontrolü yapar.
  const check = await rpc('admin_blog_ai_check', {}, token);
  if (check.error) {
    return json(403, { ok: false, error: 'forbidden', detail: check.error.slice(0, 200) });
  }

  const settingsResponse = await rpc('admin_blog_ai_settings_get', {}, token);
  if (settingsResponse.error || !settingsResponse.data) {
    return json(500, { ok: false, error: 'settings_unavailable' });
  }
  const settings = settingsResponse.data as AiSettings;
  if (!settings.enabled) {
    return json(409, { ok: false, error: 'ai_disabled' });
  }

  const promptForLog = `${action}: ${asString(body.topic) || asString(body.title)} ${asString(body.instructions)}`.slice(0, 1000);

  try {
    const result = await callDeepSeek(settings, body);
    const duration = Date.now() - started;
    const usage = result.usage ?? {};

    // 2) Kullanım günlüğü. Log yazımı başarısız olsa bile içerik döner.
    await rpc(
      'admin_blog_ai_log',
      {
        p_action: action,
        p_model: settings.model,
        p_prompt: promptForLog,
        p_tokens_in: usage.prompt_tokens ?? null,
        p_tokens_out: usage.completion_tokens ?? null,
        p_duration_ms: duration,
        p_ok: true,
        p_error: null,
      },
      token,
    );

    if (action === 'outline') {
      return json(200, {
        ok: true,
        action,
        model: settings.model,
        content: result.content.trim(),
        duration_ms: duration,
        usage,
      });
    }

    const parsed = parseJsonObject(result.content);
    if (Object.keys(parsed).length === 0) {
      throw new Error('model_json_invalid');
    }

    if (action === 'article') {
      const articleBody = asString(parsed.body_markdown);
      if (articleBody.length < 300) {
        throw new Error('article_too_short');
      }
      return json(200, {
        ok: true,
        action,
        model: settings.model,
        title: asString(parsed.title).slice(0, 200),
        excerpt: asString(parsed.excerpt).slice(0, 600),
        body_markdown: articleBody,
        duration_ms: duration,
        usage,
      });
    }

    if (action === 'seo') {
      return json(200, {
        ok: true,
        action,
        model: settings.model,
        slug: asString(parsed.slug).slice(0, 140),
        seo_title: asString(parsed.seo_title).slice(0, 200),
        seo_description: asString(parsed.seo_description).slice(0, 400),
        keywords: asStringArray(parsed.keywords, 12),
        tags: asStringArray(parsed.tags, 8),
        faq: normalizeFaq(parsed.faq),
        duration_ms: duration,
        usage,
      });
    }

    if (action === 'improve') {
      const improved = asString(parsed.body_markdown);
      if (improved.length < 300) throw new Error('improve_too_short');
      return json(200, {
        ok: true,
        action,
        model: settings.model,
        body_markdown: improved,
        duration_ms: duration,
        usage,
      });
    }

    if (action === 'title') {
      return json(200, {
        ok: true,
        action,
        model: settings.model,
        titles: asStringArray(parsed.titles, 12),
        duration_ms: duration,
        usage,
      });
    }

    return json(200, {
      ok: true,
      action,
      model: settings.model,
      faq: normalizeFaq(parsed.faq),
      duration_ms: duration,
      usage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ai_failed';
    const duration = Date.now() - started;
    await rpc(
      'admin_blog_ai_log',
      {
        p_action: action,
        p_model: settings.model,
        p_prompt: promptForLog,
        p_tokens_in: null,
        p_tokens_out: null,
        p_duration_ms: duration,
        p_ok: false,
        p_error: message.slice(0, 400),
      },
      token,
    );
    const status = message.includes('deepseek_key_missing') ? 503 : 502;
    return json(status, {
      ok: false,
      error: message.includes('deepseek_key_missing') ? 'deepseek_key_missing' : 'ai_failed',
      detail: message.slice(0, 400),
      duration_ms: duration,
    });
  }
});
