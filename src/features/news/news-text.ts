// Haber metninden künye satırlarını ve modelin kendi kendine konuştuğu
// cümleleri ayıklar. Yeni haberler sunucuda temizlenir; bu kopya daha önce
// yayımlanmış haberleri okuma ekranında düzeltir. Desenler
// `supabase/functions/_shared/news-style.ts` ile aynı tutulmalıdır.

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

// Kaynak sayfanın arayüzünü anlatan cümleler haber değildir. Sunucudaki
// `CHROME_*` desenleriyle aynı tutulmalıdır.
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

function isChromeSentence(sentence: string): boolean {
  if (CHROME_NOT_NEWS.some((pattern) => pattern.test(sentence))) return true;
  const terms = sentence.match(CHROME_TERMS_GLOBAL)?.length ?? 0;
  if (terms === 0) return false;
  if (CHROME_VERBS.test(sentence)) return true;
  return terms >= 2;
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
    const previous = result[result.length - 1];
    if (heading && previous && /^#{1,3}\s/.test(previous)) result.pop();
    result.push(block);
  }
  while (result.length && /^#{1,3}\s/.test(result[result.length - 1] ?? '')) result.pop();
  return result.join('\n\n').trim();
}

export function polishNewsText(text: string | null | undefined): string {
  const original = (text ?? '').trim();
  if (!original) return original;
  const creditsOnly = cleanText(original, false);
  const polished = cleanText(original, true);
  return polished.length >= creditsOnly.length * 0.6 ? polished : creditsOnly;
}
