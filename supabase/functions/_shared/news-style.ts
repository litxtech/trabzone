// Haber metinleri için ortak yazım kuralları ve temizlik.
//
// Model çıktısında iki tür gürültü okuyucuya ulaşıyordu:
//   * Künye satırları: muhabir/editör/ajans adı, "TRABZON (İHA) –" girişleri,
//     yayın/güncelleme saatleri. Künye sayfanın altında ayrıca gösterilir.
//   * Modelin kendi kendine konuşması: "kaynakta belirtilmemiştir",
//     "doğrulanmamış ayrıntı eklenmemiştir", "sonuç olarak" gibi cümleler.
//
// İstemcideki `src/features/news/news-text.ts` aynı temizliği eski haberlere
// uygular; desenler değişirse orası da güncellenmelidir.

export const NEWS_STYLE_RULES = `YAZIM ÜSLUBU:
- Haberi doğrudan, yerel bir muhabirin kaleminden anlat. Metin bir insanın yazdığı gibi okunmalı.
- Kaynaklar, metin, doğrulama veya yazım süreci hakkında tek kelime yazma. "Kaynakta belirtilmemiştir",
  "bilgi verilmemiştir", "metinde yer almıyor", "doğrulanmış bilgilere göre", "kaynağa göre" gibi
  cümleler KURMA. Bilinmeyen bir ayrıntıya hiç değinme; eksikliği açıklama.
- Kaynak sayfanın arayüzünü ASLA tarif etme. Site menüsü, bölüm/ilçe listesi, çerez bildirimi,
  RSS bağlantıları, künye, telif bilgisi, sosyal medya paylaşım düğmeleri, yazı boyutu ayarları,
  "A- / A+" düğmeleri, puan durumu, hava durumu, nöbetçi eczane, namaz vakitleri, trafik haritası
  gibi yan panel araçları haberin konusu değildir; metne girmez.
- "Sayfada", "sitede", "menüde", "kaynak sitede" gibi ifadelerle başlayan arayüz anlatımı yasak.
  Haber yalnızca olayın kendisini, kişileri, kurumları ve doğrulanmış ayrıntıları anlatır.
- Sayfanın kendisi hakkında bilgi vermek yerine, sayfada yer alan gerçek olayı aktar. Olayla
  ilgili doğrulanmış bilgi yoksa haber yazma; sayfa yapısını anlatan dolgu metin üretme.
- Haber sitelerinin ve ajansların adını anma. Resmî kurum ve kişilerin açıklamalarını kurum/kişi adıyla aktar.
- Muhabir, editör, ajans, fotoğraf/kamera künyesi, yayın veya güncelleme saati, okunma sayısı,
  "Haber Merkezi" ve "TRABZON (İHA) –" gibi şehir-ajans girişlerini metne koyma. Künye ayrıca gösterilir.
- "Sonuç olarak", "Özetle", "Kısacası", "merakla bekleniyor", "büyük önem taşıyor", "önemli bir adım",
  "gelişmeler takip ediliyor" gibi kalıp ve yapay kapanış cümleleri kullanma. Son paragraf somut bir bilgiyle bitsin.
- Cümleler sade ve akıcı olsun; ardışık cümleleri aynı kalıpla başlatma.
- Okuyucuya hitap etme, soru sorma, yorum veya değerlendirme ekleme.`;

const AGENCY =
  '(?:İHA|IHA|DHA|AA|ANKA|İLKHA|ILKHA|HABER MERKEZİ|Haber Merkezi|Anadolu Ajansı|İhlas Haber Ajansı|Demirören Haber Ajansı)';

const CREDIT_LINES: RegExp[] = [
  /^(?:haber|muhabir|editör|editor|yazan|yazar|foto(?:ğraf)?(?:lar)?|görüntü|kamera|video|kaynak(?:lar)?|ajans|güncelleme|güncellenme|son güncelleme|yayınlanma|yayın tarihi|giriş tarihi|okunma|haber kodu)\s*[:|–—-]/i,
  new RegExp(`^${AGENCY}\\.?$`, 'i'),
  new RegExp(`^[\\p{L}.'’ ]{2,40}\\s*[/|–—-]\\s*${AGENCY}\\.?$`, 'iu'),
  /^[\d\s./:,–—-]+$/,
  /^(?:abone ol|takip et|paylaş|yorum yap|google news|haberin devamı|detaylar haberimizde|ilgili haber)/i,
];

const DATELINE_CAPS = new RegExp(
  `^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ'’ ]{2,30}\\s*(?:\\(${AGENCY}\\))?\\s*[–—-]\\s+`,
  'u',
);
const DATELINE_AGENCY = new RegExp(`^[\\p{L}'’ ]{3,30}\\s*\\(${AGENCY}\\)\\s*[–—-]?\\s*`, 'u');
const INLINE_AGENCY = new RegExp(`\\s*\\(${AGENCY}\\)`, 'g');

const SOURCE_REF =
  /(kaynak(?:ta|larda|lar(?:ı|i)n(?:da|de)|\s+metin\w*|\s+haber\w*)(?=[\s,.;:!?]|$)|haber metn\w*|metinde|metin içinde|verilen bilgi\w*|mevcut bilgi\w*|doğrulanmış bilgi\w*|doğrulanmamış|teyit edilmemiş)/i;
const SOURCE_NEGATION =
  /(belirtilme|belirtilmiyor|yer alm(?:amakta|ıyor|amış)|bulunm(?:amakta|uyor|amış)|geçm(?:iyor|emekte|emiş)|verilme|verilmiyor|paylaşılma|açıklanma|eklenme|kullanılma|yer verilme|bilgi yok|ulaşılama)/i;

const META_SENTENCES: RegExp[] = [
  /(yapay zek[aâ]|\bAI\b|dil modeli|bu (?:haber )?metn|bu metin|bu haber,? .{0,60}(?:hazırlan|derlen|yazıl|oluşturul))/i,
  /(ek bilgi|ayrıntılı bilgi|detaylı bilgi|daha fazla bilgi) (?:bulunmamaktadır|yer almamaktadır|mevcut değil)/i,
  /(detaylar haberimizde|haberin devamı|gelişmeler(?:i)? (?:yakından )?takip ediliyor|gelişmeleri takip etmeye devam)/i,
];

// Kaynak sayfanın arayüzünü anlatan cümleler haber değildir: menü/bölüm
// listeleri, çerez bildirimi, RSS/künye/telif satırları, paylaşım ve yazı
// boyutu düğmeleri. Bu cümleler yayımlanan metne sızarsa haber okunmaz hâle
// geliyordu; burada ayıklanır.
const CHROME_TERMS =
  /(\bRSS\b|çerez|künye|telif hakk|yazı boyut|A- ?\/? ?A\+|paylaşım (?:seçenekleri|bağlantıları)|sosyal medya (?:bağlantıları|hesapları)|haber arşivi|manşetler|puan durumu|fikstür|nöbetçi eczane|namaz vakitleri|trafik yoğunluk|hava durumu|üyelik girişi)/i;
const CHROME_TERMS_GLOBAL = new RegExp(CHROME_TERMS.source, 'gi');
const CHROME_VERBS =
  /(bulunuyor|bulunmakta|yer alıyor|yer almaktadır|sunuluyor|sunulmakta|listeleniyor|sıralanıyor|okuyucuya (?:sunul|ulaş)|görüntüleniyor|gösteriliyor|eklenmiş)/i;
const CHROME_SITE_SUBJECT =
  /(sayfada|sitede|sitenin|kaynakta|kaynak sitede|menüde|menüsünde|akışta|alt bölümünde|üst bölümünde|bölümlerinin yanı sıra|gibi bağlantılar)/i;
const CHROME_NOT_NEWS: RegExp[] = [
  new RegExp(`^${CHROME_SITE_SUBJECT.source}.{0,260}${CHROME_VERBS.source}`, 'iu'),
  new RegExp(`${CHROME_TERMS.source}.{0,220}${CHROME_VERBS.source}`, 'iu'),
  // Menü/bölüm/ilçe listelerinin sayıldığı cümleler.
  /(bölüm|bölümler|başlık|başlıklar|ilçe başlıkları|kategoriler|menü).{0,90}(sıralan|listelen|yer alıyor|yer almaktadır)/iu,
];

const CLICHE_SENTENCES =
  /(merakla bekleniyor|büyük önem taşı|önemli bir adım|dikkatleri üzerine çek|gözler .{0,40}çevril|önümüzdeki günlerde netlik kazan)/i;

const FILLER_PREFIX =
  /^(?:sonuç olarak|özetle|kısacası|özetlemek gerekirse|tüm bunlarla birlikte|son olarak|bilindiği üzere|belirtmek gerekir ki|kaynakta(?:n)? (?:belirtildiğine|aktarıldığına) göre|kaynağa göre|kaynak metne göre|haberde belirtildiğine göre|doğrulanmış bilgilere göre)\s*,?\s*/i;

const DROP_HEADINGS = /^(?:künye|kaynak(?:lar|ça)?|editör notu|not|bilgi notu)$/i;

function isCreditLine(line: string): boolean {
  return line.length <= 160 && CREDIT_LINES.some((pattern) => pattern.test(line));
}

function stripCredits(line: string): string {
  return line.replace(DATELINE_AGENCY, '').replace(DATELINE_CAPS, '').replace(INLINE_AGENCY, '');
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1) : text;
}

function splitSentences(text: string): string[] {
  return (text.match(/[^]+?(?:[.!?…]+["”’»)]*(?=\s|$)|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isMetaSentence(sentence: string): boolean {
  if (SOURCE_REF.test(sentence) && SOURCE_NEGATION.test(sentence)) return true;
  if (META_SENTENCES.some((pattern) => pattern.test(sentence))) return true;
  if (isChromeSentence(sentence)) return true;
  const quoted = /["“”«»]/.test(sentence);
  return !quoted && sentence.length < 180 && CLICHE_SENTENCES.test(sentence);
}

function polishLine(line: string): string {
  const prefix = line.match(/^([-*+]\s+)/)?.[1] ?? '';
  const content = line.slice(prefix.length);
  const kept = splitSentences(content)
    .filter((sentence) => !isMetaSentence(sentence))
    .map((sentence) => {
      const stripped = sentence.replace(FILLER_PREFIX, '');
      return stripped === sentence ? sentence : capitalize(stripped);
    });
  return kept.length ? prefix + kept.join(' ') : '';
}

function cleanText(text: string, sentences: boolean): string {
  const blocks = (text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !isCreditLine(line))
        .map((line) => {
          if (/^#{1,3}\s/.test(line)) return line;
          const stripped = stripCredits(line).trim();
          return sentences ? polishLine(stripped) : stripped;
        })
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean);

  const result: string[] = [];
  for (const block of blocks) {
    const heading = block.match(/^#{1,3}\s+(.+)$/);
    if (heading && DROP_HEADINGS.test((heading[1] ?? '').trim().replace(/[:.]$/, ''))) continue;
    // Arkasından paragraf gelmeyen alt başlık bırakılmaz.
    const previous = result[result.length - 1];
    if (heading && previous && /^#{1,3}\s/.test(previous)) result.pop();
    result.push(block);
  }
  while (result.length && /^#{1,3}\s/.test(result[result.length - 1])) result.pop();
  return result.join('\n\n').trim();
}

/** Kaynak malzemeden künye satırlarını ve ajans etiketlerini ayıklar. */
export function stripSourceCredits(text: string): string {
  return cleanText(text, false);
}

/**
 * Model çıktısını yayına hazırlar: künye satırları, ajans girişleri, kaynak
 * hakkında konuşan cümleler ve kalıp kapanışlar çıkarılır. Temizlik metnin
 * büyük bölümünü götürürse yalnızca künye temizliği uygulanır.
 */
export function polishNewsText(text: string): string {
  const original = (text ?? '').trim();
  if (!original) return original;
  const creditsOnly = cleanText(original, false);
  const polished = cleanText(original, true);
  return polished.length >= creditsOnly.length * 0.6 ? polished : creditsOnly;
}

/**
 * Metnin ne kadarının kaynak sayfanın arayüzünü anlattığını ölçer (0..1).
 *
 * Haber üretimi kaynak sayfanın tam metnini kullanabildiği için menü, çerez
 * bildirimi, RSS/künye/telif satırları ve yazı boyutu düğmeleri "haber" gibi
 * yazılabiliyordu. Bu ölçüm, böyle metinlerin taslak aşamasında reddedilmesini
 * sağlar.
 */
export function pageChromeRatio(text: string): number {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length < 400) return 0;
  return countChromeSentences(normalized).ratio;
}

/** Arayüz anlatımı baskın gelen kaynak/üretilmiş metinler haber sayılmaz. */
export function isPageChromeHeavy(text: string, threshold = 0.3): boolean {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length < 600) return false;
  const { chrome, total } = countChromeSentences(normalized);
  return total >= 4 && chrome >= 3 && chrome / total >= threshold;
}

function isChromeSentence(sentence: string): boolean {
  if (CHROME_NOT_NEWS.some((pattern) => pattern.test(sentence))) return true;
  const terms = sentence.match(CHROME_TERMS_GLOBAL)?.length ?? 0;
  if (terms === 0) return false;
  if (CHROME_VERBS.test(sentence)) return true;
  return terms >= 2;
}

function countChromeSentences(text: string): { chrome: number; total: number; ratio: number } {
  const sentences = splitSentences(text);
  const chrome = sentences.filter(isChromeSentence).length;
  const total = sentences.length;
  return { chrome, total, ratio: total === 0 ? 0 : chrome / total };
}
