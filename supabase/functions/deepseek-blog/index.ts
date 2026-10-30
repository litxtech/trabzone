// deepseek-blog: yönetici panelindeki blog editörü için DeepSeek köprüsü.
//
// Neden edge function: DeepSeek API anahtarı istemci paketine giremez. İstemci
// yalnızca kendi Supabase JWT'siyle buraya gelir; function önce kullanıcının
// yönetici olduğunu `admin_blog_ai_check` RPC'siyle doğrular, sonra anahtarı
// yalnızca sunucuda bulunan `DEEPSEEK_API_KEY` ortam değişkeninden okur.
//
// Eylemler:
//   full     -> yazı + tüm SEO alanları (tek çağrıda eksiksiz taslak)
//   article  -> { title, excerpt, body_markdown }  (düz metin üretimi)
//   seo      -> { slug, seo_title, seo_description, keywords, tags, faq,
//                 category, cover_image_alt }
//   improve  -> { body_markdown }  (düz metin iyileştirme)
//   title    -> { titles: string[] }
//   faq      -> { faq: {question, answer}[] }
//   outline  -> { content: string }
//
// Önemli tasarım kararı: uzun markdown gövde ASLA JSON içine gömülmez.
// Uzun yazıyı JSON string olarak istemek modelin çıktıyı yarıda kesmesine ve
// "model_json_invalid" hatasına yol açıyordu. Yazı düz metin (TITLE/EXCERPT
// başlıklarıyla), SEO meta verisi ise ayrı ve küçük bir JSON çağrısıyla alınır.
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

const ACTIONS = new Set(['full', 'article', 'seo', 'improve', 'title', 'faq', 'outline']);

const USER_AGENT = 'TrabzoneBlogEditor/2.0 (https://trabzone.app; contact@trabzone.app)';

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

type ChatMessage = { role: string; content: string };

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

type Draft = { title: string; excerpt: string; body: string };

type SeoResult = {
  slug: string;
  seo_title: string;
  seo_description: string;
  keywords: string[];
  tags: string[];
  faq: FaqItem[];
  category: string;
  cover_image_alt: string;
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

/** Modelin ```json çitleri, baştaki açıklamaları veya kırpılmış çıktısını temizler. */
function parseJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
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
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Bazı modeller string içinde kaçışsız satır sonu bırakır; temizleyip
      // bir kez daha dene.
      try {
        const loose = text
          .slice(start, end + 1)
          .replace(/[\u0000-\u001f]+/g, (char) => (char === '\n' || char === '\r' ? '\\n' : ''));
        const parsed = JSON.parse(loose);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Boş nesne dön.
      }
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

const TR_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  Ç: 'c',
  Ğ: 'g',
  İ: 'i',
  Ö: 'o',
  Ş: 's',
  Ü: 'u',
};

function slugify(input: string): string {
  return input
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (char) => TR_MAP[char] ?? char)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90)
    .replace(/-$/, '');
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|]/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  return stripMarkdown(text).split(' ').filter(Boolean).length;
}

/** Düz metin yanıtından TITLE/EXCERPT ve gövdeyi ayıklar. */
function parseArticleText(raw: string): Draft {
  let text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  if (fence) text = fence[1].trim();

  const titleMatch = text.match(/^\s*(?:TITLE|BAŞLIK)\s*:\s*(.+)$/im);
  const excerptMatch = text.match(/^\s*(?:EXCERPT|ÖZET)\s*:\s*(.+)$/im);
  const clean = (value: string | undefined) =>
    asString(value)
      .replace(/^["“']|["”']$/g, '')
      .trim();

  let body = text
    .replace(/^\s*(?:TITLE|BAŞLIK)\s*:.*$/gim, '')
    .replace(/^\s*(?:EXCERPT|ÖZET)\s*:.*$/gim, '')
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let title = clean(titleMatch?.[1]).slice(0, 200);
  if (!title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    title = clean(h1?.[1]).slice(0, 200);
  }
  // Gövdenin başında kalan H1 başlığı ayrı alanda tutulduğu için kaldırılır.
  body = body.replace(/^#\s+[^\n]+\n+/, '').trim();

  let excerpt = clean(excerptMatch?.[1]).slice(0, 600);
  if (!excerpt) excerpt = stripMarkdown(body).slice(0, 240);

  return { title, excerpt, body };
}

function styleRules(): string {
  return [
    'Türkçe yaz; Türkiye Türkçesinin doğal akışını kullan. Çeviri kokan cümleler kurma.',
    'Trabzon’a özgü somut ayrıntı kullan; genel geçer turizm cümleleri ve boş övgüler yazma.',
    'Uydurma istatistik, uydurma fiyat, uydurma mekân/işletme adı, uydurma hat numarası üretme.',
    'Sadece sana verilen araştırma notlarındaki sayıları kullan. Notlarda yoksa sayı verme; “yaklaşık” de ve doğrulama öner.',
    'Metin içinde yapay zekâ, editör, “uydurma bilgi yok” gibi meta açıklamalar yapma; doğrudan okuyucuya seslen.',
    'Kısa paragraflar, açıklayıcı H2/H3 başlıklar, en az bir markdown tablosu ve en az bir madde listesi kullan.',
    'Metni H1 ile başlatma; başlık ayrı alanda dönecek.',
    'Okuyucuya gerçek fayda ver: kim için, ne zaman, nasıl, ne kadar, nelere dikkat edilmeli sorularını yanıtla.',
    'Sonuç bölümünde net, uygulanabilir bir eylem planı ver.',
  ].join('\n');
}

/** Wikipedia (tr) üzerinden konuya dair doğrulanabilir bağlam toplar. */
async function research(topic: string): Promise<string> {
  try {
    const search = topic
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 120);
    if (!search) return '';
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrsearch: search,
      gsrlimit: '2',
      prop: 'extracts',
      explaintext: '1',
      exintro: '1',
      redirects: '1',
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(`https://tr.wikipedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return '';
    const data = await response.json();
    const pages = Object.values(data?.query?.pages ?? {}) as {
      title?: string;
      extract?: string;
    }[];
    const chunks = pages
      .map((page) => {
        const extract = asString(page.extract).replace(/\s+/g, ' ');
        if (extract.length < 120) return '';
        return `- ${page.title}: ${extract.slice(0, 900)}`;
      })
      .filter(Boolean);
    return chunks.join('\n').slice(0, 2000);
  } catch {
    return '';
  }
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

type DeepSeekCall = {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  timeoutMs: number;
  /** Düz metin çıktısında kırpılma kabul edilebilirse true. */
  allowTruncated?: boolean;
};

async function callDeepSeek(call: DeepSeekCall): Promise<{ content: string; usage: Usage }> {
  const apiKey = env('DEEPSEEK_API_KEY');
  if (!apiKey) throw new Error('deepseek_key_missing');
  const base = (env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = call.model || 'deepseek-chat';
  // deepseek-reasoner JSON modunu ve temperature'ı desteklemez.
  const reasoner = /reasoner/i.test(model);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), call.timeoutMs);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: call.messages,
        ...(reasoner ? {} : { temperature: clamp(call.temperature, 0, 1.5) }),
        max_tokens: Math.min(clamp(call.maxTokens, 256, 8192), 8192),
        stream: false,
        ...(call.jsonMode && !reasoner ? { response_format: { type: 'json_object' } } : {}),
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
    const finishReason = asString(payload?.choices?.[0]?.finish_reason, 'unknown');
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('deepseek_empty_response');
    }
    if (finishReason === 'length') {
      // Kırpılmış yanıt yarım markdown/JSON üretir; sessizce kaydetmektense
      // yeniden denemesi için açık hata dön. Taslak gibi kırpılması sorun
      // olmayan çıktılarda çağıran taraf bunu kapatabilir.
      if (!call.allowTruncated) throw new Error(`deepseek_truncated:${call.maxTokens}`);
    }
    return { content, usage: payload.usage ?? {} };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`deepseek_timeout:${call.timeoutMs}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function systemPrompt(settings: AiSettings): string {
  return `${settings.system_prompt || 'Sen Trabzone için çalışan deneyimli bir SEO içerik editörüsün.'}\n\n${styleRules()}`;
}

async function generateArticle(
  settings: AiSettings,
  input: {
    topic: string;
    category: string;
    audience: string;
    tone: string;
    targetWords: number;
    notes: string;
    keywords: string[];
    context: string;
    deadline: number;
  },
): Promise<{ draft: Draft; usage: Usage }> {
  const prompt = `Trabzon hakkında uzun biçimli, gerçek bilgiye dayanan bir blog yazısı yaz.

Konu: ${input.topic}
Kategori: ${input.category}
Hedef okuyucu: ${input.audience}
Ton: ${input.tone}
Hedef uzunluk: en az ${input.targetWords} kelime
Anahtar kelimeler: ${input.keywords.length ? input.keywords.join(', ') : 'konuya uygun doğal aramalar'}
${input.notes ? `Editör notları (mutlaka uy): ${input.notes}` : ''}

Araştırma notları (yalnızca buradaki sayıları kullanabilirsin):
${input.context || 'Somut sayısal veri yok. Bu durumda fiyat/süre gibi bilgilerde sayı verme, “yaklaşık” ifadesi kullan ve doğrulama öner.'}

Yapı kuralları:
- En az 7 adet H2 bölümü; gerektiğinde H3 alt başlıkları.
- Girişte okuyucunun neden bu yazıyı okuması gerektiğini somut biçimde anlat.
- En az bir karşılaştırma/özet tablosu (markdown).
- En az iki madde listesi.
- "Pratik ipuçları" ve "Sık yapılan hatalar" bölümleri.
- Sonunda "Sık sorulan sorular" başlığı altında 4-6 soru-cevap (soru kalın, cevap kısa paragraf).
- Hedef uzunluk: en az ${input.targetWords} kelime. Kısa yazma; her bölümü örnek ve ayrıntıyla derinleştir.

Yanıt biçimi (çok önemli):
- JSON kullanma, düz metin döndür.
- İlk satır: TITLE: <60-90 karakterlik, abartısız ama merak uyandıran başlık>
- İkinci satır: EXCERPT: <150-300 karakterlik özet>
- Üçüncü satırdan itibaren yalnızca markdown gövde.`;

  const response = await callDeepSeek({
    model: settings.model,
    messages: [
      { role: 'system', content: systemPrompt(settings) },
      { role: 'user', content: prompt },
    ],
    temperature: settings.temperature || 0.8,
    maxTokens: 8192,
    jsonMode: false,
    // SEO çağrısı için her zaman en az 45 sn pay bırak.
    timeoutMs: Math.max(15_000, Math.min(90_000, input.deadline - Date.now() - 45_000)),
  });

  let draft = parseArticleText(response.content);
  let usage = response.usage;

  // Model hedefin altında kalırsa aynı yapıyı koruyarak genişletme turu.
  // Toplam süre edge function sınırını aşmasın diye yeterli zaman yoksa atlanır.
  if (
    countWords(draft.body) < Math.min(900, Math.round(input.targetWords * 0.6)) &&
    input.deadline - Date.now() > 60_000
  ) {
    try {
      const expanded = await callDeepSeek({
        model: settings.model,
        messages: [
          { role: 'system', content: systemPrompt(settings) },
          {
            role: 'user',
            content: `Aşağıdaki blog yazısı hedef uzunluğun altında kaldı. Aynı başlıkları ve sırayı koruyarak her bölümü genişlet.
Kurallar:
- Yeni bilgi uydurma; editör notlarına ve genel doğrulanabilir bilgilere bağlı kal.
- Her bölüme somut örnek, kontrol listesi veya pratik ayrıntı ekle.
- En az ${input.targetWords} kelime olsun.
- JSON kullanma; düz markdown döndür. İlk satırda TITLE: ..., ikinci satırda EXCERPT: ... yaz.

Konu: ${input.topic}
${input.notes ? `Editör notları: ${input.notes}` : ''}

Mevcut yazı:
${draft.body.slice(0, 24_000)}`,
          },
        ],
        temperature: settings.temperature || 0.8,
        maxTokens: 8192,
        jsonMode: false,
        timeoutMs: Math.max(10_000, Math.min(60_000, input.deadline - Date.now() - 42_000)),
      });
      const next = parseArticleText(expanded.content);
      if (countWords(next.body) > countWords(draft.body)) {
        draft = {
          title: next.title || draft.title,
          excerpt: next.excerpt || draft.excerpt,
          body: next.body,
        };
      }
      usage = {
        prompt_tokens: (usage.prompt_tokens ?? 0) + (expanded.usage.prompt_tokens ?? 0),
        completion_tokens: (usage.completion_tokens ?? 0) + (expanded.usage.completion_tokens ?? 0),
        total_tokens: (usage.total_tokens ?? 0) + (expanded.usage.total_tokens ?? 0),
      };
    } catch {
      // Genişletme başarısız olsa da eldeki taslak yeterliyse devam et.
    }
  }

  if (draft.body.length < 400) throw new Error('article_too_short');

  // Bazı modeller TITLE/EXCERPT satırını atlar; başlığı konudan türet.
  if (!draft.title) draft.title = input.topic.slice(0, 200);

  return { draft, usage };
}

async function generateSeo(
  settings: AiSettings,
  input: {
    title: string;
    category: string;
    body: string;
    keywords: string[];
    topic: string;
    deadline: number;
  },
): Promise<{ seo: SeoResult; usage: Usage }> {
  const prompt = `Aşağıdaki blog yazısı için tüm SEO alanlarını üret.

Başlık: ${input.title}
Kategori: ${input.category}
Konu: ${input.topic}
Mevcut anahtar kelimeler: ${input.keywords.length ? input.keywords.join(', ') : 'yok'}

Gövde:
${input.body.slice(0, 20_000)}

Kurallar:
- slug: Türkçe karakter içermeyen, küçük harfli, 3-8 kelimelik, tire ile ayrılmış URL parçası.
- seo_title: en fazla 60 karakter, tıklanabilir ama clickbait olmayan.
- seo_description: 140-160 karakter, arama niyetini yanıtlayan.
- keywords: 6-10 adet kısa ve uzun kuyruk arama.
- tags: 3-6 adet etiket.
- faq: 5-8 adet soru-cevap; cevaplar 1-3 cümle, yazıdaki bilgilerle tutarlı.
- category: yazının gerçekten ait olduğu tek kategori (Gezi, Ulaşım, Emlak, Doğa, Yemek, Yaşam, Alışveriş, Spor, Kültür, Şehir, Eğitim, Etkinlik, Tarih, Aile, Kariyer).
- cover_image_alt: kapak görselini tarif eden 8-14 kelimelik Türkçe alt metin.

Yanıtı yalnızca şu JSON nesnesi olarak ver:
{"slug":"...","seo_title":"...","seo_description":"...","keywords":["..."],"tags":["..."],"faq":[{"question":"...","answer":"..."}],"category":"...","cover_image_alt":"..."}`;

  const response = await callDeepSeek({
    model: settings.model,
    messages: [
      {
        role: 'system',
        content:
          'Sen teknik SEO ve Türkçe içerik editörlüğü konusunda uzmansın. Yalnızca geçerli JSON döndür.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
    maxTokens: 2600,
    jsonMode: true,
    timeoutMs: Math.max(10_000, Math.min(40_000, input.deadline - Date.now() - 3_000)),
  });

  const parsed = parseJsonObject(response.content);
  if (Object.keys(parsed).length === 0) throw new Error('model_json_invalid');

  const seoTitle = asString(parsed.seo_title).slice(0, 200) || input.title.slice(0, 200);
  const seoDescription =
    asString(parsed.seo_description).slice(0, 400) || stripMarkdown(input.body).slice(0, 200);

  return {
    seo: {
      slug: slugify(asString(parsed.slug) || input.title),
      seo_title: seoTitle,
      seo_description: seoDescription,
      keywords: asStringArray(parsed.keywords, 12),
      tags: asStringArray(parsed.tags, 8),
      faq: normalizeFaq(parsed.faq),
      category: asString(parsed.category) || input.category,
      cover_image_alt: asString(parsed.cover_image_alt).slice(0, 240),
    },
    usage: response.usage,
  };
}

function mergeUsage(...items: Usage[]): Usage {
  return items.reduce<Usage>(
    (total, item) => ({
      prompt_tokens: (total.prompt_tokens ?? 0) + (item.prompt_tokens ?? 0),
      completion_tokens: (total.completion_tokens ?? 0) + (item.completion_tokens ?? 0),
      total_tokens: (total.total_tokens ?? 0) + (item.total_tokens ?? 0),
    }),
    {},
  );
}

type ActionResult = { payload: Record<string, unknown>; usage: Usage };

async function runAction(
  action: string,
  body: RequestBody,
  settings: AiSettings,
): Promise<ActionResult> {
  // Edge function duvar saati sınırı ~150 sn. Tüm alt çağrılar bu bütçeye
  // sığacak şekilde zaman aşımı alır.
  const deadline = Date.now() + 128_000;
  const topic = asString(body.topic).slice(0, 300);
  const title = asString(body.title).slice(0, 200);
  const category = asString(body.category, 'Gezi').slice(0, 60);
  const keywords = asStringArray(body.keywords, 10);
  const audience = asString(
    body.audience,
    'Trabzon’u gezecek veya Trabzon’da yaşayacak yetişkinler',
  ).slice(0, 240);
  const tone = asString(body.tone, 'samimi, net, abartısız').slice(0, 160);
  const notes = asString(body.notes).slice(0, 1500);
  const instructions = asString(body.instructions).slice(0, 2000);
  const existingBody = asString(body.body_markdown).slice(0, 60_000);
  const targetWords = clamp(Number(body.targetWords) || 1600, 700, 3000);

  if (action === 'seo') {
    if (existingBody.length < 40) throw new Error('body_required');
    const { seo, usage } = await generateSeo(settings, {
      title: title || topic,
      category,
      body: existingBody,
      keywords,
      topic: topic || title,
      deadline,
    });
    return { payload: { ...seo }, usage };
  }

  if (action === 'improve') {
    if (existingBody.length < 40) throw new Error('body_required');
    const response = await callDeepSeek({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt(settings) },
        {
          role: 'user',
          content: `Aşağıdaki blog yazısını daha güçlü, daha özgün ve SEO açısından daha iyi hale getir.

Başlık: ${title || topic}
${instructions ? `İstenen iyileştirme: ${instructions}` : 'Eksik bölümleri tamamla, tekrarları azalt, somut örnek ve pratik bilgi ekle.'}

Mevcut gövde:
${existingBody}

Kurallar:
- Yazarın tonunu ve yapısını koru; baştan yazmak yerine iyileştir.
- Bilgi uydurma; emin olmadığın yerde genel ifade kullan.
- En az 5 H2 başlığı ve bir tablo olsun.
- Yanıtı yalnızca iyileştirilmiş markdown gövde olarak ver; JSON, açıklama veya kod bloğu ekleme.`,
        },
      ],
      temperature: settings.temperature || 0.7,
      maxTokens: 8192,
      jsonMode: false,
      timeoutMs: 85_000,
    });
    const bodyText = response.content
      .replace(/^```(?:markdown|md)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .replace(/^#\s+[^\n]+\n+/, '')
      .trim();
    if (bodyText.length < 300) throw new Error('improve_too_short');
    return { payload: { body_markdown: bodyText }, usage: response.usage };
  }

  if (action === 'title') {
    const count = clamp(Number(body.count) || 8, 3, 12);
    const response = await callDeepSeek({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt(settings) },
        {
          role: 'user',
          content: `"${topic || title}" konusu için ${count} farklı blog başlığı öner.
Kurallar: Türkçe, 45-85 karakter, abartısız, arama niyetine uygun, birbirinden gerçekten farklı.
Yanıtı yalnızca {"titles":["..."]} JSON nesnesi olarak ver.`,
        },
      ],
      temperature: 0.8,
      maxTokens: 900,
      jsonMode: true,
      timeoutMs: 30_000,
    });
    const parsed = parseJsonObject(response.content);
    return { payload: { titles: asStringArray(parsed.titles, 12) }, usage: response.usage };
  }

  if (action === 'faq') {
    if (existingBody.length < 40) throw new Error('body_required');
    const response = await callDeepSeek({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt(settings) },
        {
          role: 'user',
          content: `Aşağıdaki blog yazısı için 6 adet sık sorulan soru ve cevap üret.

Başlık: ${title || topic}
Gövde:
${existingBody.slice(0, 20_000)}

Kurallar: Sorular gerçek arama niyetini yansıtsın; cevaplar 1-3 cümle ve yazıyla tutarlı olsun. Uydurma veri kullanma.
Yanıtı yalnızca {"faq":[{"question":"...","answer":"..."}]} JSON nesnesi olarak ver.`,
        },
      ],
      temperature: 0.5,
      maxTokens: 1600,
      jsonMode: true,
      timeoutMs: 35_000,
    });
    const parsed = parseJsonObject(response.content);
    return { payload: { faq: normalizeFaq(parsed.faq) }, usage: response.usage };
  }

  if (action === 'outline') {
    const response = await callDeepSeek({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt(settings) },
        {
          role: 'user',
          content: `"${topic || title}" konulu, ${category} kategorisinde, en az ${targetWords} kelimelik bir blog yazısı için ayrıntılı bir taslak hazırla.
Her bölüm için hedefi, alt başlıkları ve eklenecek somut bilgileri yaz. Türkçe markdown düz metin döndür; JSON kullanma.`,
        },
      ],
      temperature: 0.7,
      maxTokens: 3200,
      jsonMode: false,
      timeoutMs: 40_000,
      allowTruncated: true,
    });
    return { payload: { content: response.content.trim() }, usage: response.usage };
  }

  // 'full' ve 'article': uzun yazı düz metin olarak üretilir.
  if (!topic && !title) throw new Error('topic_required');
  const context = await research(topic || title);
  const { draft, usage } = await generateArticle(settings, {
    topic: topic || title,
    category,
    audience,
    tone,
    targetWords,
    notes,
    keywords,
    context,
    deadline,
  });

  if (action === 'article') {
    return {
      payload: {
        title: draft.title,
        excerpt: draft.excerpt,
        body_markdown: draft.body,
      },
      usage,
    };
  }

  const { seo, usage: seoUsage } = await generateSeo(settings, {
    title: draft.title,
    category,
    body: draft.body,
    keywords,
    topic: topic || title,
    deadline,
  });

  const words = countWords(draft.body);
  return {
    payload: {
      title: draft.title,
      excerpt: draft.excerpt,
      body_markdown: draft.body,
      slug: seo.slug,
      seo_title: seo.seo_title,
      seo_description: seo.seo_description,
      keywords: seo.keywords.length ? seo.keywords : keywords,
      tags: seo.tags,
      faq: seo.faq,
      category: seo.category,
      cover_image_alt: seo.cover_image_alt,
      reading_minutes: Math.max(1, Math.ceil(words / 200)),
      word_count: words,
    },
    usage: mergeUsage(usage, seoUsage),
  };
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

  const action = asString(body.action, 'full');
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

  const promptForLog =
    `${action}: ${asString(body.topic) || asString(body.title)} ${asString(body.instructions)}`.slice(
      0,
      1000,
    );

  try {
    const result = await runAction(action, body, settings);
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

    return json(200, {
      ok: true,
      action,
      model: settings.model,
      ...result.payload,
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
