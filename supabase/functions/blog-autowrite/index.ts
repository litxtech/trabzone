// blog-autowrite: günlük otomatik blog yazımı.
//
// pg_cron -> public.blog_ai_tick() -> pg_net -> bu function.
// Kimlik doğrulama `blog_ai_token_ok` RPC'siyle yapılır; anahtar Vault'ta durur
// ve yalnızca cron çağrısında gönderilir. DeepSeek anahtarı hiçbir zaman
// istemciye veya veritabanına yazılmaz.
//
// Akış (konu başına):
//   1. Konu havuzundan bir konu sahiplen (blog_ai_claim_topics).
//   2. Wikipedia (tr) özetinden doğrulanabilir bağlam topla.
//   3. DeepSeek ile uzun makale + SEO meta verisini üret.
//   4. Markdown'ı doğrula, gerçek fotoğrafı ve SSS bölümünü yerleştir.
//   5. blog_posts + blog_post_versions tablolarına yaz, konuyu 'used' işaretle.
//
// Kullanım:
//   POST /functions/v1/blog-autowrite
//   Header: x-blog-token: <vault'taki blog_ai_cron_secret>
//   Body:   { "count": 1, "dry_run": false, "trigger": "cron" }

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-blog-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_KEY;
const DEEPSEEK_KEY = (Deno.env.get('DEEPSEEK_API_KEY') ?? '').trim();
const DEEPSEEK_BASE = (Deno.env.get('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com').replace(/\/+$/, '');

const USER_AGENT = 'TrabzoneBlogBot/1.0 (https://trabzone.app; contact@trabzone.app)';

type Topic = {
  id: number;
  topic: string;
  category: string;
  keywords: string[] | null;
  audience: string | null;
  notes: string | null;
  image_url: string | null;
  image_alt: string | null;
};

type Settings = {
  enabled: boolean;
  posts_per_day: number;
  author_name: string;
  model: string;
  target_words: number;
  timezone: string;
};

type FaqItem = { question: string; answer: string };

type ArticleResult = {
  title: string;
  excerpt: string;
  body_markdown: string;
  faq: FaqItem[];
  seo_title: string;
  seo_description: string;
  keywords: string[];
  tags: string[];
};

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
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
    // Aşağıdaki onarım denemesi.
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
      // Boş nesne dön.
    }
  }
  return {};
}

function normalizeFaq(value: unknown, max = 8): FaqItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const question = asString(record.question);
      const answer = asString(record.answer);
      if (question.length < 8 || answer.length < 10) return null;
      return { question: question.slice(0, 240), answer: answer.slice(0, 1200) };
    })
    .filter((item): item is FaqItem => item !== null)
    .slice(0, max);
}

const TR_MAP: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
  Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u',
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

function countH2(text: string): number {
  return (text.match(/^## /gm) ?? []).length;
}

function hasTable(text: string): boolean {
  return /\n\|[^\n]*\|[^\n]*\n\|[\s:|-]+\|/.test(text);
}

function hasFaqHeading(text: string): boolean {
  return /##\s+.*s[ıi]k sorulan/i.test(text);
}

async function rest(
  path: string,
  init: RequestInit = {},
  key = SERVICE_KEY,
): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
  key = SERVICE_KEY,
): Promise<unknown> {
  return rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args ?? {}) }, key);
}

async function loadSettings(): Promise<Settings | null> {
  const rows = (await rest('blog_ai_settings?select=*&id=eq.true')) as Settings[] | null;
  return rows?.[0] ?? null;
}

async function loadSystemPrompt(): Promise<string> {
  try {
    const rows = (await rest(
      'app_settings?select=key,value&key=eq.blog.ai_system_prompt',
    )) as { key: string; value: unknown }[] | null;
    const value = rows?.[0]?.value;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

/** Wikipedia (tr) üzerinden konuya dair doğrulanabilir bağlam toplar. */
async function research(topic: string): Promise<string> {
  try {
    const search = topic
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 120);
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
    const timer = setTimeout(() => controller.abort(), 12_000);
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

async function deepseek(
  messages: { role: string; content: string }[],
  model: string,
  maxTokens: number,
  timeoutMs: number,
  jsonMode = true,
): Promise<{ content: string; tokensIn: number; tokensOut: number; finishReason: string }> {
  if (!DEEPSEEK_KEY) throw new Error('deepseek_key_missing');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages,
        temperature: 0.85,
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
        // Ham metin yeterli.
      }
      throw new Error(`deepseek_${response.status}: ${detail}`);
    }
    const payload = JSON.parse(text);
    const finishReason = asString(payload?.choices?.[0]?.finish_reason, 'unknown');
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('deepseek_empty_response');
    }
    return {
      content,
      tokensIn: Number(payload?.usage?.prompt_tokens ?? 0),
      tokensOut: Number(payload?.usage?.completion_tokens ?? 0),
      finishReason,
    };
  } finally {
    clearTimeout(timer);
  }
}

function styleRules(): string {
  return [
    'Türkçe yaz; Türkiye Türkçesinin doğal akışını kullan. Çeviri kokan cümleler kurma.',
    'Trabzon’a özgü somut ayrıntı kullan; genel geçer turizm cümleleri ve boş övgüler yazma.',
    'Uydurma istatistik, uydurma fiyat, uydurma mekân/işletme adı, uydurma hat numarası üretme.',
    'Sadece sana verilen araştırma notlarındaki sayıları kullan. Notlarda yoksa sayı verme; “yaklaşık” de ve doğrulama öner.',
    'Metin içinde yapay zekâ, editör, “uydurma bilgi yok” gibi meta açıklamalar yapma; doğrudan okuyucuya seslen.',
    'Girişte “bu yazıda şunu vermiyoruz” türünden açıklamalar yapma; konuya doğrudan gir.',
    'Kısa paragraflar, açıklayıcı H2/H3 başlıklar, en az bir markdown tablosu ve en az bir madde listesi kullan.',
    'Metni H1 ile başlatma; başlık ayrı alanda dönecek.',
    'Okuyucuya gerçek fayda ver: kim için, ne zaman, nasıl, ne kadar, nelere dikkat edilmeli sorularını yanıtla.',
    'Sonuç bölümünde net, uygulanabilir bir eylem planı ver.',
  ].join('\n');
}

function parseArticleText(raw: string): { title: string; excerpt: string; body: string } {
  let text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  if (fence) text = fence[1].trim();

  const titleMatch = text.match(/^\s*TITLE:\s*(.+)$/im);
  const excerptMatch = text.match(/^\s*EXCERPT:\s*(.+)$/im);
  const clean = (value: string | undefined) =>
    asString(value).replace(/^["“]|["”]$/g, '').trim();

  const body = text
    .replace(/^\s*TITLE:.*$/im, '')
    .replace(/^\s*EXCERPT:.*$/im, '')
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  return {
    title: clean(titleMatch?.[1]).slice(0, 200),
    excerpt: clean(excerptMatch?.[1]).slice(0, 600),
    body,
  };
}

async function generateArticle(
  topic: Topic,
  settings: Settings,
  systemPrompt: string,
): Promise<{ article: ArticleResult; tokensIn: number; tokensOut: number }> {
  const context = await research(topic.topic);
  const keywords = (topic.keywords ?? []).join(', ');
  const targetWords = Math.min(Math.max(settings.target_words || 1500, 1100), 2200);
  const system = `${systemPrompt || 'Sen Trabzone için çalışan deneyimli bir yerel içerik editörüsün.'}\n\n${styleRules()}`;

  const articlePrompt = `Trabzon hakkında uzun biçimli, gerçek bilgiye dayanan bir blog yazısı yaz.

Konu: ${topic.topic}
Kategori: ${topic.category}
Hedef okuyucu: ${topic.audience ?? 'Trabzon’da yaşayanlar ve Trabzon’a taşınmayı düşünenler'}
Anahtar kelimeler: ${keywords || 'konuya uygun doğal aramalar'}
${topic.notes ? `Editör notları (mutlaka uy): ${topic.notes}` : ''}

Araştırma notları (yalnızca buradaki sayıları kullanabilirsin):
${context || 'Somut sayısal veri yok. Bu durumda fiyat/süre gibi bilgilerde sayı verme, “yaklaşık” ifadesi kullan ve doğrulama öner.'}

Yapı kuralları:
- En az 8 adet H2 bölümü; gerektiğinde H3 alt başlıkları.
- Girişte okuyucunun neden bu yazıyı okuması gerektiğini somut biçimde anlat.
- En az bir karşılaştırma tablosu (markdown).
- En az iki madde listesi.
- "Pratik ipuçları" ve "Sık yapılan hatalar" bölümleri.
- Sonunda "Sık sorulan sorular" başlığı altında 5 soru-cevap (soru kalın, cevap kısa paragraf).
- Hedef uzunluk: en az ${targetWords} kelime. Kısa yazma; her bölümü örnek ve ayrıntıyla derinleştir.

Yanıt biçimi (çok önemli):
- JSON kullanma, düz metin döndür.
- İlk satır: TITLE: <60-90 karakterlik, abartısız ama merak uyandıran başlık>
- İkinci satır: EXCERPT: <150-300 karakterlik özet>
- Üçüncü satırdan itibaren yalnızca markdown gövde.`;

  const articleResponse = await deepseek(
    [
      { role: 'system', content: system },
      { role: 'user', content: articlePrompt },
    ],
    settings.model,
    8192,
    95_000,
    false,
  );

  let tokensIn = articleResponse.tokensIn;
  let tokensOut = articleResponse.tokensOut;
  let parsed = parseArticleText(articleResponse.content);

  // Model bazen hedefin altında kalıyor: aynı yapıyı koruyarak genişletme turu.
  if (countWords(parsed.body) < 1000 && parsed.body.length > 500) {
    const expandPrompt = `Aşağıdaki blog yazısı hedef uzunluğun altında kaldı. Aynı başlıkları ve sırayı koruyarak her bölümü genişlet.

Kurallar:
- Yeni bilgi uydurma; editör notlarına ve genel doğrulanabilir bilgilere bağlı kal.
- Her bölüme somut örnek, kontrol listesi veya pratik ayrıntı ekle.
- En az ${targetWords} kelime olsun.
- JSON kullanma; düz markdown döndür. İlk satırda TITLE: ..., ikinci satırda EXCERPT: ... yaz.

Konu: ${topic.topic}
${topic.notes ? `Editör notları: ${topic.notes}` : ''}

Mevcut yazı:
${parsed.body.slice(0, 24_000)}`;

    const expandedResponse = await deepseek(
      [
        { role: 'system', content: system },
        { role: 'user', content: expandPrompt },
      ],
      settings.model,
      8192,
      80_000,
      false,
    );
    tokensIn += expandedResponse.tokensIn;
    tokensOut += expandedResponse.tokensOut;

    const expanded = parseArticleText(expandedResponse.content);
    if (countWords(expanded.body) > countWords(parsed.body)) {
      parsed = {
        title: expanded.title || parsed.title,
        excerpt: expanded.excerpt || parsed.excerpt,
        body: expanded.body,
      };
    }
  }

  const body = parsed.body;
  const title = parsed.title || topic.topic;
  const words = countWords(body);
  if (words < 900) {
    throw new Error(`article_too_short:${words}w/${body.length}c/${articleResponse.finishReason}`);
  }
  if (countH2(body) < 5) throw new Error(`article_too_few_sections:${countH2(body)}`);

  // SEO + SSS ayrı çağrıda: tek dev JSON isteği token limitine takılıyor.
  const seoPrompt = `Aşağıdaki blog yazısı için SEO meta verileri ve sık sorulan sorular üret.

Başlık: ${title}
Kategori: ${topic.category}
Anahtar kelimeler: ${keywords || 'yok'}

Gövde:
${body.slice(0, 20_000)}

Kurallar:
- slug: Türkçe karakter içermeyen, küçük harfli, 3-8 kelimelik, tire ile ayrılmış URL parçası.
- seo_title: en fazla 60 karakter, tıklanabilir ama clickbait olmayan.
- seo_description: 140-160 karakter, arama niyetini yanıtlayan.
- keywords: 6-10 adet kısa ve uzun kuyruk arama.
- tags: 3-6 adet etiket.
- faq: 5-6 adet soru-cevap; cevaplar 1-3 cümle ve yazıdaki bilgilerle tutarlı olsun. Uydurma veri kullanma.

Yanıtı yalnızca şu JSON nesnesi olarak ver:
{"slug":"...","seo_title":"...","seo_description":"...","keywords":["..."],"tags":["..."],"faq":[{"question":"...","answer":"..."}]}`;

  const seoResponse = await deepseek(
    [
      { role: 'system', content: 'Sen teknik SEO ve Türkçe içerik editörlüğü konusunda uzmansın. Yalnızca geçerli JSON döndür.' },
      { role: 'user', content: seoPrompt },
    ],
    settings.model,
    2600,
    45_000,
  );

  const parsedSeo = parseJsonObject(seoResponse.content);
  const faq = normalizeFaq(parsedSeo.faq, 6);

  return {
    article: {
      title: title.slice(0, 200),
      excerpt: parsed.excerpt || stripMarkdown(body).slice(0, 240),
      body_markdown: body.trim(),
      faq,
      seo_title: asString(parsedSeo.seo_title, title).slice(0, 200),
      seo_description: asString(parsedSeo.seo_description).slice(0, 400) || parsed.excerpt.slice(0, 400),
      keywords: asStringArray(parsedSeo.keywords, 10),
      tags: asStringArray(parsedSeo.tags, 6),
    },
    tokensIn: tokensIn + seoResponse.tokensIn,
    tokensOut: tokensOut + seoResponse.tokensOut,
  };
}

/** Fotoğrafı ve SSS bölümünü gövdeye yerleştirir. */
function enrichBody(article: ArticleResult, topic: Topic): string {
  let body = article.body_markdown.trim();

  // Modelin başlık olarak eklediği H1 varsa kaldır (başlık ayrı alanda).
  body = body.replace(/^#\s+[^\n]+\n+/, '');

  if (topic.image_url && !body.includes('![')) {
    const headingMatches = [...body.matchAll(/\n## /g)];
    const insertAt = headingMatches.length >= 3 ? headingMatches[2].index ?? -1 : -1;
    const image = `\n\n![${topic.image_alt ?? topic.topic}](${topic.image_url})\n\n`;
    if (insertAt > 0) {
      body = body.slice(0, insertAt) + image + body.slice(insertAt + 1);
    } else {
      body = `${body}${image}`;
    }
  }

  if (!hasFaqHeading(body) && article.faq.length > 0) {
    const faqBlock = article.faq
      .map((item) => `### ${item.question}\n\n${item.answer}`)
      .join('\n\n');
    body = `${body}\n\n## Sık sorulan sorular\n\n${faqBlock}`;
  }

  const note = [
    '## Editör notu',
    '',
    'Bu rehberdeki fiyat, saat ve ulaşım bilgileri yayın tarihine göre yaklaşıktır; ' +
      'gitmeden veya karar vermeden önce ilgili kurumun resmi kanalından doğrulayın. ' +
      'Yazıda yer alan fotoğraflar Wikimedia Commons arşivinden, lisansına uygun biçimde kullanılmıştır.',
  ].join('\n');

  if (!/##\s+Editör notu/i.test(body)) {
    body = `${body}\n\n${note}`;
  }

  return body.trim();
}

async function uniqueSlug(base: string): Promise<string> {
  const clean = base || `trabzon-${Date.now()}`;
  const rows = (await rest(
    `blog_posts?select=slug&slug=like.${encodeURIComponent(clean)}*`,
  )) as { slug: string }[] | null;
  const taken = new Set((rows ?? []).map((row) => row.slug));
  if (!taken.has(clean)) return clean;
  for (let index = 2; index < 20; index += 1) {
    const candidate = `${clean}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${clean}-${Date.now().toString(36)}`;
}

async function publish(
  article: ArticleResult,
  topic: Topic,
  settings: Settings,
  body: string,
): Promise<{ id: string; slug: string }> {
  const words = countWords(body);
  const slug = await uniqueSlug(slugify(article.title) || slugify(topic.topic));
  const nowIso = new Date().toISOString();

  const rows = (await rest('blog_posts?select=id,slug,version', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      {
        slug,
        title: article.title,
        excerpt: article.excerpt,
        body_markdown: body,
        cover_image_url: topic.image_url,
        cover_image_alt: topic.image_alt,
        category: topic.category,
        tags: article.tags.length ? article.tags : (topic.keywords ?? []).slice(0, 4),
        seo_title: article.seo_title || article.title,
        seo_description: article.seo_description || article.excerpt,
        keywords: article.keywords.length ? article.keywords : topic.keywords ?? [],
        faq: article.faq,
        author_name: settings.author_name || 'trabzonapp',
        status: 'published',
        is_featured: false,
        reading_minutes: Math.max(1, Math.ceil(words / 200)),
        word_count: words,
        ai_generated: true,
        ai_model: settings.model,
        version: 1,
        published_at: nowIso,
        updated_at: nowIso,
      },
    ]),
  })) as { id: string; slug: string; version: number }[];

  const saved = rows?.[0];
  if (!saved) throw new Error('insert_failed');

  await rest('blog_post_versions', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify([
      {
        post_id: saved.id,
        version: saved.version ?? 1,
        title: article.title,
        body_markdown: body,
        seo_title: article.seo_title || article.title,
        seo_description: article.seo_description || article.excerpt,
        status: 'published',
      },
    ]),
  });

  return { id: saved.id, slug: saved.slug };
}

async function logRun(entry: Record<string, unknown>): Promise<void> {
  try {
    await rest('blog_ai_runs', {
      method: 'POST',
      body: JSON.stringify([
        {
          action: 'auto_article',
          created_at: new Date().toISOString(),
          ...entry,
        },
      ]),
    });
  } catch {
    // Günlük yazımı başarısız olsa da yazı yayınlanmış olabilir.
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { ok: false, error: 'env_missing' });
  }

  const started = Date.now();
  const token = (request.headers.get('x-blog-token') ?? '').trim();
  if (!token) {
    return json(401, { ok: false, error: 'token_required' });
  }

  let authorized = false;
  try {
    authorized = (await rpc('blog_ai_token_ok', { p_token: token }, ANON_KEY)) === true;
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  let body: { count?: number; dry_run?: boolean; trigger?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const dryRun = body.dry_run === true;
  const requested = Math.min(Math.max(Number(body.count) || 1, 1), 2);

  const settings = await loadSettings();
  if (!settings) return json(500, { ok: false, error: 'settings_missing' });
  if (!settings.enabled) return json(409, { ok: false, error: 'disabled' });

  const systemPrompt = await loadSystemPrompt();
  const published: unknown[] = [];
  const failed: unknown[] = [];
  const drafts: unknown[] = [];

  for (let index = 0; index < requested; index += 1) {
    if (Date.now() - started > 115_000) break;

    let topics: Topic[] = [];
    try {
      topics = ((await rpc('blog_ai_claim_topics', { p_count: 1 })) as Topic[]) ?? [];
    } catch (error) {
      failed.push({ step: 'claim', error: error instanceof Error ? error.message : 'claim_failed' });
      break;
    }

    const topic = topics[0];
    if (!topic) {
      failed.push({ step: 'claim', error: 'no_topics' });
      break;
    }

    const topicStarted = Date.now();
    try {
      const { article, tokensIn, tokensOut } = await generateArticle(topic, settings, systemPrompt);
      const enriched = enrichBody(article, topic);

      if (countWords(enriched) < 1000) throw new Error('article_too_short_after_enrich');

      if (dryRun) {
        drafts.push({
          topic: topic.topic,
          title: article.title,
          words: countWords(enriched),
          body_markdown: enriched,
        });
        await rpc('blog_ai_finish_topic', {
          p_id: topic.id,
          p_ok: false,
          p_post_id: null,
          p_error: 'dry_run',
        });
        continue;
      }

      const saved = await publish({ ...article, body_markdown: enriched }, topic, settings, enriched);

      await rpc('blog_ai_finish_topic', {
        p_id: topic.id,
        p_ok: true,
        p_post_id: saved.id,
        p_error: null,
      });

      await logRun({
        model: settings.model,
        prompt: `auto: ${topic.topic}`.slice(0, 1000),
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        duration_ms: Date.now() - topicStarted,
        ok: true,
        error: null,
      });

      published.push({
        id: saved.id,
        slug: saved.slug,
        title: article.title,
        words: countWords(enriched),
        reading_minutes: Math.max(1, Math.ceil(countWords(enriched) / 200)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ai_failed';
      try {
        await rpc('blog_ai_finish_topic', {
          p_id: topic.id,
          p_ok: false,
          p_post_id: null,
          p_error: message,
        });
      } catch {
        // Konu 'running' kalırsa tick 30 dakika sonra serbest bırakır.
      }
      await logRun({
        model: settings.model,
        prompt: `auto: ${topic.topic}`.slice(0, 1000),
        tokens_in: null,
        tokens_out: null,
        duration_ms: Date.now() - topicStarted,
        ok: false,
        error: message.slice(0, 400),
      });
      failed.push({ topic: topic.topic, error: message.slice(0, 300) });
    }
  }

  return json(200, {
    ok: failed.length === 0 || published.length > 0,
    dry_run: dryRun,
    published,
    failed,
    drafts,
    duration_ms: Date.now() - started,
  });
});
