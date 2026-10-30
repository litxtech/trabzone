import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import {
  useAdminBlogAiSettings,
  useAdminBlogPost,
  useAdminBlogSave,
  useBlogAi,
} from '@/features/admin/hooks/use-admin-blog';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { MarkdownView } from '@/features/blog/components/MarkdownView';
import type {
  AdminBlogPost,
  AdminBlogStatus,
  AiFullResult,
  AiSeoResult,
  BlogFaq,
} from '@/features/blog/types';
import { useTheme } from '@/theme/ThemeProvider';

type Draft = {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  category: string;
  tagsText: string;
  keywordsText: string;
  seoTitle: string;
  seoDescription: string;
  coverUrl: string;
  coverAlt: string;
  author: string;
  status: AdminBlogStatus;
  featured: boolean;
  publishAt: string;
  reason: string;
  faq: BlogFaq[];
  aiGenerated: boolean;
  aiModel: string | null;
};

const EMPTY: Draft = {
  title: '',
  slug: '',
  excerpt: '',
  body: '',
  category: 'Gezi',
  tagsText: '',
  keywordsText: '',
  seoTitle: '',
  seoDescription: '',
  coverUrl: '',
  coverAlt: '',
  author: 'Trabzone Editör',
  status: 'draft',
  featured: false,
  publishAt: '',
  reason: '',
  faq: [],
  aiGenerated: false,
  aiModel: null,
};

const CATEGORIES = [
  'Gezi',
  'Ulaşım',
  'Emlak',
  'Doğa',
  'Yemek',
  'Yaşam',
  'Alışveriş',
  'Spor',
  'Kültür',
  'Şehir',
  'Eğitim',
  'Etkinlik',
  'Tarih',
  'Aile',
  'Kariyer',
];

const DEFAULT_AUDIENCE = 'Trabzon’u gezecek veya Trabzon’da yaşayacak yetişkinler';
const DEFAULT_TONE = 'samimi, net, abartısız';

function toDraft(post: AdminBlogPost): Draft {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body: post.body_markdown,
    category: post.category,
    tagsText: post.tags.join(', '),
    keywordsText: post.keywords.join(', '),
    seoTitle: post.seo_title ?? '',
    seoDescription: post.seo_description ?? '',
    coverUrl: post.cover_image_url ?? '',
    coverAlt: post.cover_image_alt ?? '',
    author: post.author_name,
    status: post.status,
    featured: post.is_featured,
    publishAt: post.published_at ? post.published_at.slice(0, 16) : '',
    reason: '',
    faq: post.faq ?? [],
    aiGenerated: post.ai_generated,
    aiModel: post.ai_model,
  };
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function wordCount(body: string): number {
  return body.trim() ? body.trim().split(/\s+/).filter(Boolean).length : 0;
}

function slugify(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110);
}

/** AI'nın doldurduğu alanları kullanıcıya rozet olarak gösterir. */
function filledFields(result: AiFullResult): string[] {
  const fields: string[] = [];
  if (result.title) fields.push('Başlık');
  if (result.slug) fields.push('URL');
  if (result.excerpt) fields.push('Özet');
  if (result.body_markdown) fields.push('Gövde');
  if (result.seo_title) fields.push('SEO başlığı');
  if (result.seo_description) fields.push('SEO açıklaması');
  if (result.keywords?.length) fields.push('Anahtar kelimeler');
  if (result.tags?.length) fields.push('Etiketler');
  if (result.faq?.length) fields.push('SSS');
  if (result.category) fields.push('Kategori');
  if (result.cover_image_alt) fields.push('Kapak alt metni');
  return fields;
}

export function BlogEditorModal({
  visible,
  postId,
  canManage,
  onClose,
  onSaved,
}: {
  visible: boolean;
  postId: string | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: (post: AdminBlogPost) => void;
}) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 980;
  const toast = useAdminToast();
  const detail = useAdminBlogPost(postId);
  const save = useAdminBlogSave();
  const ai = useBlogAi();
  const aiSettings = useAdminBlogAiSettings();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [preview, setPreview] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [outline, setOutline] = useState('');
  const [aiTopic, setAiTopic] = useState('');
  const [aiAudience, setAiAudience] = useState(DEFAULT_AUDIENCE);
  const [aiTone, setAiTone] = useState(DEFAULT_TONE);
  const [aiWords, setAiWords] = useState('1600');
  const [aiNotes, setAiNotes] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [filled, setFilled] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<{ words: number; seconds: number; model: string } | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const aiLock = useRef(false);

  // Modal açıldığında ya da yazı verisi geldiğinde taslak render sırasında
  // senkronlanır; effect içinde setState çağrısı yapılmaz.
  const sourcePost = detail.data ?? null;
  const [synced, setSynced] = useState<{
    visible: boolean;
    postId: string | null;
    source: typeof sourcePost;
  }>({ visible: false, postId: null, source: null });
  if (synced.visible !== visible || synced.postId !== postId || synced.source !== sourcePost) {
    setSynced({ visible, postId, source: sourcePost });
    if (visible) {
      if (postId && sourcePost) {
        setDraft(toDraft(sourcePost));
        setAiTopic(sourcePost.title);
        setShowFaq((sourcePost.faq ?? []).length > 0);
      } else if (!postId) {
        setDraft(EMPTY);
        setAiTopic('');
        setShowFaq(false);
      }
      setPreview(false);
      setAiError(null);
      setFormError(null);
      setTitles([]);
      setOutline('');
      setFilled([]);
      setLastRun(null);
      setShowAdvanced(false);
      setShowTools(false);
      setShowPublish(false);
      setAiAudience(DEFAULT_AUDIENCE);
      setAiTone(DEFAULT_TONE);
      setAiWords('1600');
      setAiNotes('');
      setAiInstructions('');
    }
  }

  const words = useMemo(() => wordCount(draft.body), [draft.body]);
  const ready = !postId || Boolean(detail.data);
  const aiReady = aiSettings.data?.enabled !== false;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /** Başlık yazılırken slug yalnızca yeni yazıda ve otomatik üretilmişse güncellenir. */
  const changeTitle = (value: string) => {
    setDraft((current) => {
      const slugIsAuto = !current.slug || (!postId && current.slug === slugify(current.title));
      return {
        ...current,
        title: value,
        slug: slugIsAuto ? slugify(value) : current.slug,
      };
    });
  };

  const validate = (status: AdminBlogStatus): string | null => {
    if (draft.title.trim().length < 8) return 'Başlık en az 8 karakter olmalı.';
    if (draft.body.trim().length < 120) return 'Gövde en az 120 karakter olmalı.';
    if (draft.excerpt.length > 600) return 'Özet en fazla 600 karakter olabilir.';
    if (status === 'archived' && draft.reason.trim().length < 3) {
      return 'Arşivlemek için en az 3 karakterlik gerekçe yaz.';
    }
    return null;
  };

  const persist = async (status: AdminBlogStatus) => {
    const next = { ...draft, status };
    setDraft(next);
    const validation = validate(status);
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError(null);
    let publishAt: string | null = null;
    if (next.publishAt.trim()) {
      const parsed = new Date(next.publishAt);
      if (Number.isNaN(parsed.getTime())) {
        setFormError('Yayın tarihi geçersiz. Örn. 2026-11-01T10:00');
        return;
      }
      publishAt = parsed.toISOString();
    }
    try {
      const saved = await save.mutateAsync({
        id: postId,
        slug: next.slug.trim() || slugify(next.title),
        title: next.title.trim(),
        excerpt: next.excerpt.trim(),
        body_markdown: next.body,
        cover_image_url: next.coverUrl.trim() || null,
        cover_image_alt: next.coverAlt.trim() || null,
        category: next.category.trim() || 'Genel',
        tags: splitList(next.tagsText),
        seo_title: next.seoTitle.trim() || null,
        seo_description: next.seoDescription.trim() || null,
        keywords: splitList(next.keywordsText),
        faq: next.faq.filter((item) => item.question.trim() && item.answer.trim()),
        author_name: next.author.trim() || 'Trabzone Editör',
        status,
        is_featured: next.featured,
        publish_at: publishAt,
        ai_generated: next.aiGenerated,
        ai_model: next.aiModel,
        reason: next.reason.trim() || null,
      });
      toast.success(
        status === 'published'
          ? 'Yazı yayınlandı ve web sitesinde görünür.'
          : status === 'archived'
            ? 'Yazı arşivlendi.'
            : 'Taslak kaydedildi.',
      );
      onSaved(saved);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kayıt tamamlanamadı.');
    }
  };

  const applySeo = (result: AiSeoResult, fallbackTitle: string) => {
    setDraft((current) => ({
      ...current,
      // Yayındaki bir yazının adresini kazara değiştirmemek için mevcut slug korunur.
      slug: postId ? current.slug : result.slug || current.slug || slugify(fallbackTitle),
      seoTitle: result.seo_title || current.seoTitle,
      seoDescription: result.seo_description || current.seoDescription,
      keywordsText: result.keywords?.length ? result.keywords.join(', ') : current.keywordsText,
      tagsText: result.tags?.length ? result.tags.join(', ') : current.tagsText,
      faq: result.faq?.length ? result.faq : current.faq,
      category: result.category?.trim() || current.category,
      coverAlt: result.cover_image_alt?.trim() || current.coverAlt,
    }));
    if (result.faq?.length) setShowFaq(true);
  };

  const begin = (kind: string): boolean => {
    if (aiLock.current) return false;
    if (!aiReady) {
      setAiError('AI yazma özelliği kapalı. AI ayarlarından açabilirsin.');
      return false;
    }
    aiLock.current = true;
    setAiBusy(kind);
    setAiError(null);
    return true;
  };

  const end = () => {
    aiLock.current = false;
    setAiBusy(null);
  };

  /** Tek tıkla yazı + tüm SEO alanlarını üretir. */
  const runFull = async () => {
    const topic = aiTopic.trim() || draft.title.trim();
    if (!topic) {
      setAiError(
        'Önce ne yazmak istediğini kısaca yaz. Örn. “Trabzon’da yağmurlu günde yapılacaklar”.',
      );
      return;
    }
    if (!begin('full')) return;
    const startedAt = Date.now();
    try {
      const result = (await ai.mutateAsync({
        action: 'full',
        topic,
        category: draft.category,
        audience: aiAudience,
        tone: aiTone,
        targetWords: Number(aiWords) || 1600,
        notes: aiNotes,
        keywords: splitList(draft.keywordsText),
      })) as unknown as AiFullResult;

      if (!result.body_markdown || result.body_markdown.trim().length < 200) {
        throw new Error('AI boş gövde döndürdü. Tekrar dene.');
      }

      setDraft((current) => ({
        ...current,
        title: result.title || current.title,
        slug: postId ? current.slug : result.slug || slugify(result.title || topic),
        excerpt: result.excerpt || current.excerpt,
        body: result.body_markdown,
        seoTitle: result.seo_title || current.seoTitle,
        seoDescription: result.seo_description || current.seoDescription,
        keywordsText: result.keywords?.length ? result.keywords.join(', ') : current.keywordsText,
        tagsText: result.tags?.length ? result.tags.join(', ') : current.tagsText,
        faq: result.faq?.length ? result.faq : current.faq,
        category: result.category?.trim() || current.category,
        coverAlt: result.cover_image_alt?.trim() || current.coverAlt,
        aiGenerated: true,
        aiModel: result.model ?? current.aiModel,
      }));
      if (result.faq?.length) setShowFaq(true);
      setFilled(filledFields(result));
      setLastRun({
        words: wordCount(result.body_markdown),
        seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        model: result.model ?? aiSettings.data?.model ?? 'deepseek-chat',
      });
      setPreview(false);
      toast.success('Yazı ve tüm SEO alanları dolduruldu. Yayınlamadan önce gözden geçir.');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI işlemi tamamlanamadı.');
    } finally {
      end();
    }
  };

  /** Var olan gövdeye göre SEO ve meta alanlarını yeniler. */
  const runSeo = async () => {
    if (draft.body.trim().length < 120) {
      setAiError('Önce bir gövde metni gir veya AI ile yazdır.');
      return;
    }
    if (!begin('seo')) return;
    try {
      const result = (await ai.mutateAsync({
        action: 'seo',
        title: draft.title,
        body_markdown: draft.body,
        category: draft.category,
        keywords: splitList(draft.keywordsText),
      })) as unknown as AiSeoResult;
      applySeo(result, draft.title);
      toast.success('SEO başlığı, açıklama, URL, anahtar kelimeler ve SSS güncellendi.');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI işlemi tamamlanamadı.');
    } finally {
      end();
    }
  };

  const runImprove = async () => {
    if (!draft.body.trim()) {
      setAiError('Önce bir gövde metni gir veya AI ile yazdır.');
      return;
    }
    if (!begin('improve')) return;
    try {
      const result = await ai.mutateAsync({
        action: 'improve',
        title: draft.title,
        body_markdown: draft.body,
        instructions: aiInstructions,
      });
      const body = typeof result.body_markdown === 'string' ? result.body_markdown : '';
      if (!body) throw new Error('AI boş içerik döndürdü.');
      setDraft((current) => ({ ...current, body, aiGenerated: true }));
      toast.success('Gövde iyileştirildi. Kaydetmeden önce kontrol et.');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI işlemi tamamlanamadı.');
    } finally {
      end();
    }
  };

  const runTitles = async () => {
    const topic = aiTopic.trim() || draft.title.trim();
    if (!topic) {
      setAiError('Başlık önerisi için önce bir konu yaz.');
      return;
    }
    if (!begin('title')) return;
    try {
      const result = await ai.mutateAsync({ action: 'title', topic, count: 8 });
      const list = Array.isArray(result.titles) ? (result.titles as string[]) : [];
      setTitles(list);
      if (list.length === 0) setAiError('Başlık önerisi üretilemedi. Tekrar dene.');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI işlemi tamamlanamadı.');
    } finally {
      end();
    }
  };

  const runFaq = async () => {
    if (!draft.body.trim()) {
      setAiError('SSS için önce bir gövde metni gir.');
      return;
    }
    if (!begin('faq')) return;
    try {
      const result = await ai.mutateAsync({
        action: 'faq',
        title: draft.title,
        body_markdown: draft.body,
      });
      const faq = Array.isArray(result.faq) ? (result.faq as BlogFaq[]) : [];
      setDraft((current) => ({ ...current, faq }));
      setShowFaq(true);
      toast.success('SSS önerileri eklendi.');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI işlemi tamamlanamadı.');
    } finally {
      end();
    }
  };

  const runOutline = async () => {
    const topic = aiTopic.trim() || draft.title.trim();
    if (!topic) {
      setAiError('Taslak için önce bir konu yaz.');
      return;
    }
    if (!begin('outline')) return;
    try {
      const result = await ai.mutateAsync({
        action: 'outline',
        topic,
        category: draft.category,
        audience: aiAudience,
        targetWords: Number(aiWords) || 1600,
        notes: aiNotes,
      });
      setOutline(typeof result.content === 'string' ? result.content : '');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI işlemi tamamlanamadı.');
    } finally {
      end();
    }
  };

  const seoChecks = [
    {
      label: 'SEO başlığı',
      ok: draft.seoTitle.length >= 25 && draft.seoTitle.length <= 60,
      hint: `${draft.seoTitle.length}/60`,
    },
    {
      label: 'SEO açıklaması',
      ok: draft.seoDescription.length >= 120 && draft.seoDescription.length <= 160,
      hint: `${draft.seoDescription.length}/160`,
    },
    { label: 'URL', ok: draft.slug.trim().length > 2, hint: draft.slug ? 'hazır' : 'boş' },
    {
      label: 'Anahtar kelime',
      ok: splitList(draft.keywordsText).length >= 3,
      hint: `${splitList(draft.keywordsText).length} adet`,
    },
    { label: 'İçerik', ok: words >= 600, hint: `${words} kelime` },
    { label: 'SSS', ok: draft.faq.length >= 3, hint: `${draft.faq.length} soru` },
  ];

  const aiProgressLabel =
    aiBusy === 'full'
      ? 'DeepSeek yazıyı ve tüm SEO alanlarını hazırlıyor… 30-90 saniye sürebilir.'
      : aiBusy === 'seo'
        ? 'SEO alanları yenileniyor…'
        : aiBusy === 'improve'
          ? 'Gövde iyileştiriliyor…'
          : aiBusy === 'title'
            ? 'Başlık önerileri hazırlanıyor…'
            : aiBusy === 'faq'
              ? 'SSS hazırlanıyor…'
              : 'Taslak çıkarılıyor…';

  const aiStudio = (
    <View
      style={[
        styles.aiStudio,
        {
          borderColor: aiReady ? theme.colors.primary : theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      <View style={styles.aiStudioHead}>
        <View
          style={[
            styles.aiIcon,
            { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md },
          ]}
        >
          <Ionicons name="sparkles" size={20} color={theme.colors.primaryDeep} />
        </View>
        <View style={styles.flex}>
          <AppText variant="title">AI Stüdyo</AppText>
          <AppText variant="caption" color="textTertiary">
            Konuyu yaz; DeepSeek yazıyı ve tüm SEO alanlarını tek seferde doldurur.
          </AppText>
        </View>
        <Badge label={aiReady ? 'Hazır' : 'Kapalı'} tone={aiReady ? 'success' : 'neutral'} />
        <Badge label={aiSettings.data?.model ?? 'deepseek-chat'} tone="accent" />
      </View>

      <View style={[styles.aiPromptRow, compact && styles.aiPromptRowCompact]}>
        <TextField
          value={aiTopic}
          onChangeText={setAiTopic}
          placeholder="Ne yazmak istiyorsun? Örn. Trabzon’da yağmurlu günde yapılacaklar"
          multiline
          style={styles.aiTopic}
          containerStyle={styles.flex}
        />
        <Button
          label="Yaz ve tüm alanları doldur"
          leftIcon={<Ionicons name="sparkles" size={16} color={theme.colors.onPrimary} />}
          loading={aiBusy === 'full'}
          disabled={Boolean(aiBusy) || !canManage || !aiReady}
          fullWidth={compact}
          onPress={() => void runFull()}
          style={compact ? styles.aiButtonCompact : styles.aiButton}
        />
      </View>

      <View style={styles.aiOptions}>
        <View style={styles.chips}>
          {CATEGORIES.slice(0, 9).map((category) => (
            <Pressable
              key={`ai-${category}`}
              onPress={() => set('category', category)}
              style={[
                styles.chip,
                {
                  borderColor:
                    draft.category === category ? theme.colors.primary : theme.colors.border,
                  backgroundColor:
                    draft.category === category ? theme.colors.primarySoft : 'transparent',
                },
              ]}
            >
              <AppText
                variant="caption"
                color={draft.category === category ? 'primaryDeep' : 'textSecondary'}
              >
                {category}
              </AppText>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => setShowAdvanced((value) => !value)} style={styles.linkButton}>
          <Ionicons
            name={showAdvanced ? 'chevron-up' : 'options-outline'}
            size={14}
            color={theme.colors.primary}
          />
          <AppText variant="caption" color="primary">
            {showAdvanced ? 'Gelişmiş ayarları kapat' : 'Gelişmiş ayarlar'}
          </AppText>
        </Pressable>
      </View>

      {showAdvanced ? (
        <View style={styles.aiAdvanced}>
          <View style={[styles.row, compact && styles.rowCompact]}>
            <TextField
              label="Hedef okuyucu"
              value={aiAudience}
              onChangeText={setAiAudience}
              containerStyle={styles.flex}
            />
            <TextField
              label="Ton"
              value={aiTone}
              onChangeText={setAiTone}
              containerStyle={styles.flex}
            />
            <TextField
              label="Hedef kelime"
              value={aiWords}
              onChangeText={setAiWords}
              keyboardType="number-pad"
              containerStyle={styles.wordsField}
            />
          </View>
          <TextField
            label="Editör notları (opsiyonel)"
            value={aiNotes}
            onChangeText={setAiNotes}
            placeholder="Eklemek istediğin açı, mekân, karşılaştırma…"
            multiline
            style={styles.notesInput}
          />
        </View>
      ) : null}

      {aiBusy ? (
        <View style={styles.aiProgress}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <AppText variant="caption" color="textSecondary">
            {aiProgressLabel}
          </AppText>
        </View>
      ) : null}

      {aiError ? (
        <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="alert-circle" size={15} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            {aiError}
          </AppText>
        </View>
      ) : null}

      {filled.length > 0 ? (
        <View style={[styles.doneBox, { borderColor: theme.colors.successSoft }]}>
          <View style={styles.doneHead}>
            <Ionicons name="checkmark-circle" size={15} color={theme.colors.success} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {lastRun
                ? `${lastRun.words} kelime · ~${lastRun.seconds} sn · ${lastRun.model}`
                : 'Alanlar dolduruldu.'}
            </AppText>
          </View>
          <View style={styles.chips}>
            {filled.map((field) => (
              <Badge key={field} label={field} tone="success" />
            ))}
          </View>
        </View>
      ) : null}

      <Pressable onPress={() => setShowTools((value) => !value)} style={styles.toolsToggle}>
        <AppText variant="caption" color="textSecondary">
          Diğer AI araçları
        </AppText>
        <Ionicons
          name={showTools ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={theme.colors.textTertiary}
        />
      </Pressable>

      {showTools ? (
        <View style={styles.tools}>
          <View style={styles.aiGrid}>
            <Button
              label="SEO'yu yenile"
              size="sm"
              variant="secondary"
              fullWidth={false}
              loading={aiBusy === 'seo'}
              disabled={Boolean(aiBusy)}
              onPress={() => void runSeo()}
            />
            <Button
              label="SSS üret"
              size="sm"
              variant="secondary"
              fullWidth={false}
              loading={aiBusy === 'faq'}
              disabled={Boolean(aiBusy)}
              onPress={() => void runFaq()}
            />
            <Button
              label="Başlık öner"
              size="sm"
              variant="secondary"
              fullWidth={false}
              loading={aiBusy === 'title'}
              disabled={Boolean(aiBusy)}
              onPress={() => void runTitles()}
            />
            <Button
              label="Taslak çıkar"
              size="sm"
              variant="secondary"
              fullWidth={false}
              loading={aiBusy === 'outline'}
              disabled={Boolean(aiBusy)}
              onPress={() => void runOutline()}
            />
          </View>
          <TextField
            label="İyileştirme talimatı (opsiyonel)"
            value={aiInstructions}
            onChangeText={setAiInstructions}
            placeholder="Örn. Ulaşım bölümünü genişlet, fiyat vermeden anlat"
            multiline
            style={styles.notesInput}
          />
          <Button
            label="Mevcut gövdeyi iyileştir"
            size="sm"
            variant="outline"
            fullWidth={false}
            loading={aiBusy === 'improve'}
            disabled={Boolean(aiBusy) || !draft.body}
            onPress={() => void runImprove()}
          />
          {titles.length > 0 ? (
            <View style={styles.suggestions}>
              <AppText variant="label" color="textSecondary">
                Başlık önerileri
              </AppText>
              {titles.map((title) => (
                <Pressable
                  key={title}
                  onPress={() => changeTitle(title)}
                  style={[styles.suggestion, { borderColor: theme.colors.border }]}
                >
                  <AppText variant="caption" color="textSecondary">
                    {title}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ) : null}
          {outline ? (
            <View style={styles.suggestions}>
              <AppText variant="label" color="textSecondary">
                Taslak
              </AppText>
              <AppText variant="caption" color="textSecondary" style={styles.outline}>
                {outline}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              maxWidth: compact ? '100%' : 1240,
            },
          ]}
        >
          <View style={[styles.header, { borderColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="h2">
                {postId ? 'Blog yazısını düzenle' : 'Yeni blog yazısı'}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {postId
                  ? `Sürüm ${detail.data?.version ?? '—'} · ${detail.data?.word_count ?? 0} kelime`
                  : 'Konuyu yaz, AI ile doldur, gözden geçir ve yayınla'}
              </AppText>
            </View>
            <Badge
              label={
                draft.status === 'published'
                  ? 'Yayında'
                  : draft.status === 'draft'
                    ? 'Taslak'
                    : 'Arşiv'
              }
              tone={
                draft.status === 'published'
                  ? 'success'
                  : draft.status === 'draft'
                    ? 'warning'
                    : 'neutral'
              }
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          {!ready ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
              <AppText variant="caption" color="textTertiary">
                Yazı yükleniyor…
              </AppText>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.stack}>
                {aiStudio}

                <View style={[styles.columns, compact && styles.columnsCompact]}>
                  <View style={styles.mainColumn}>
                    <View
                      style={[
                        styles.card,
                        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                      ]}
                    >
                      <View style={styles.rowBetween}>
                        <AppText variant="title">İçerik</AppText>
                        <AppText variant="caption" color={words < 300 ? 'warning' : 'success'}>
                          {words} kelime · ~{Math.max(1, Math.ceil(words / 200))} dk
                        </AppText>
                      </View>
                      <TextField
                        label="Başlık"
                        value={draft.title}
                        onChangeText={changeTitle}
                        placeholder="Örn. Trabzon'da 2 Günde Ne Yapılır? Mahalle Mahalle Rota"
                        maxLength={200}
                      />
                      <View style={[styles.row, compact && styles.rowCompact]}>
                        <TextField
                          label="URL adresi (slug)"
                          value={draft.slug}
                          onChangeText={(value) => set('slug', value)}
                          placeholder="otomatik üretilir"
                          containerStyle={styles.flex}
                          autoCapitalize="none"
                        />
                        <TextField
                          label="Kategori"
                          value={draft.category}
                          onChangeText={(value) => set('category', value)}
                          placeholder="Gezi"
                          containerStyle={styles.flex}
                        />
                      </View>
                      <View style={styles.chips}>
                        {CATEGORIES.map((category) => (
                          <Pressable
                            key={category}
                            onPress={() => set('category', category)}
                            style={[
                              styles.chip,
                              {
                                borderColor:
                                  draft.category === category
                                    ? theme.colors.primary
                                    : theme.colors.border,
                                backgroundColor:
                                  draft.category === category
                                    ? theme.colors.primarySoft
                                    : 'transparent',
                              },
                            ]}
                          >
                            <AppText
                              variant="caption"
                              color={draft.category === category ? 'primaryDeep' : 'textSecondary'}
                            >
                              {category}
                            </AppText>
                          </Pressable>
                        ))}
                      </View>
                      <TextField
                        label="Özet"
                        value={draft.excerpt}
                        onChangeText={(value) => set('excerpt', value)}
                        placeholder="Arama sonuçlarında ve kartlarda görünecek 140-300 karakterlik özet"
                        multiline
                        maxLength={600}
                        style={styles.excerptInput}
                      />
                      <View style={styles.bodyHead}>
                        <AppText variant="label" color="textSecondary">
                          Gövde (Markdown)
                        </AppText>
                        <Pressable
                          onPress={() => setPreview((value) => !value)}
                          style={styles.linkButton}
                        >
                          <Ionicons
                            name={preview ? 'create-outline' : 'eye-outline'}
                            size={14}
                            color={theme.colors.primary}
                          />
                          <AppText variant="caption" color="primary">
                            {preview ? 'Düzenle' : 'Önizle'}
                          </AppText>
                        </Pressable>
                      </View>
                      {preview ? (
                        <View style={[styles.preview, { borderColor: theme.colors.border }]}>
                          <AppText variant="h2">{draft.title || 'Başlık önizlemesi'}</AppText>
                          {draft.excerpt ? (
                            <AppText variant="body" color="textSecondary">
                              {draft.excerpt}
                            </AppText>
                          ) : null}
                          <MarkdownView markdown={draft.body || '_Gövde henüz boş._'} />
                        </View>
                      ) : (
                        <TextField
                          value={draft.body}
                          onChangeText={(value) => set('body', value)}
                          placeholder={
                            '## Bölüm başlığı\n\nParagraf…\n\n- Madde 1\n- Madde 2\n\n| Karşılaştırma | Not |\n| --- | --- |\n| Örnek | Değer |'
                          }
                          multiline
                          style={styles.bodyInput}
                          textAlignVertical="top"
                        />
                      )}
                    </View>

                    <View
                      style={[
                        styles.card,
                        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                      ]}
                    >
                      <View style={styles.rowBetween}>
                        <AppText variant="title">SEO ve meta</AppText>
                        <View style={styles.chips}>
                          {seoChecks.map((check) => (
                            <Badge
                              key={check.label}
                              label={`${check.ok ? '✓' : '!'} ${check.label} · ${check.hint}`}
                              tone={check.ok ? 'success' : 'warning'}
                            />
                          ))}
                        </View>
                      </View>
                      <TextField
                        label="SEO başlığı"
                        value={draft.seoTitle}
                        onChangeText={(value) => set('seoTitle', value)}
                        placeholder="60 karakteri geçmeyen arama başlığı"
                        maxLength={200}
                        hint={`${draft.seoTitle.length}/60 karakter`}
                        hintTone={
                          draft.seoTitle.length === 0
                            ? 'neutral'
                            : draft.seoTitle.length <= 60
                              ? 'success'
                              : 'danger'
                        }
                      />
                      <TextField
                        label="SEO açıklaması"
                        value={draft.seoDescription}
                        onChangeText={(value) => set('seoDescription', value)}
                        placeholder="140-160 karakterlik açıklama"
                        multiline
                        maxLength={400}
                        style={styles.seoInput}
                        hint={`${draft.seoDescription.length}/160 karakter`}
                        hintTone={
                          draft.seoDescription.length === 0
                            ? 'neutral'
                            : draft.seoDescription.length >= 120 &&
                                draft.seoDescription.length <= 160
                              ? 'success'
                              : 'danger'
                        }
                      />
                      <TextField
                        label="Anahtar kelimeler (virgülle)"
                        value={draft.keywordsText}
                        onChangeText={(value) => set('keywordsText', value)}
                        placeholder="trabzon gezi rehberi, trabzon 2 gün, uzungöl"
                      />
                      <TextField
                        label="Etiketler (virgülle)"
                        value={draft.tagsText}
                        onChangeText={(value) => set('tagsText', value)}
                        placeholder="gezi, rota, uzungöl"
                      />
                      <TextField
                        label="Kapak görseli URL"
                        value={draft.coverUrl}
                        onChangeText={(value) => set('coverUrl', value)}
                        placeholder="https://…"
                        autoCapitalize="none"
                      />
                      <TextField
                        label="Kapak görseli alt metni"
                        value={draft.coverAlt}
                        onChangeText={(value) => set('coverAlt', value)}
                        placeholder="Görselin ne gösterdiğini kısa ve somut anlat"
                      />
                    </View>

                    <View
                      style={[
                        styles.card,
                        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                      ]}
                    >
                      <Pressable
                        onPress={() => setShowFaq((value) => !value)}
                        style={styles.rowBetween}
                      >
                        <View style={styles.flex}>
                          <AppText variant="title">Sık sorulan sorular</AppText>
                          <AppText variant="caption" color="textTertiary">
                            {draft.faq.length > 0
                              ? `${draft.faq.length} soru · FAQPage yapısal verisine eklenir`
                              : 'Yayında açılır kapanır liste olarak gösterilir'}
                          </AppText>
                        </View>
                        <Ionicons
                          name={showFaq ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={theme.colors.textTertiary}
                        />
                      </Pressable>
                      {showFaq ? (
                        <>
                          <Button
                            label="Soru ekle"
                            size="sm"
                            variant="secondary"
                            fullWidth={false}
                            onPress={() => set('faq', [...draft.faq, { question: '', answer: '' }])}
                          />
                          {draft.faq.map((item, index) => (
                            <View
                              key={`faq-${index}`}
                              style={[styles.faqRow, { borderColor: theme.colors.border }]}
                            >
                              <View style={styles.flex}>
                                <TextField
                                  label={`Soru ${index + 1}`}
                                  value={item.question}
                                  onChangeText={(value) => {
                                    const next = [...draft.faq];
                                    next[index] = {
                                      question: value,
                                      answer: next[index]?.answer ?? '',
                                    };
                                    set('faq', next);
                                  }}
                                  placeholder="Trabzon'da kaç gün kalınmalı?"
                                />
                                <TextField
                                  label="Cevap"
                                  value={item.answer}
                                  onChangeText={(value) => {
                                    const next = [...draft.faq];
                                    next[index] = {
                                      question: next[index]?.question ?? '',
                                      answer: value,
                                    };
                                    set('faq', next);
                                  }}
                                  placeholder="Kısa ve net cevap"
                                  multiline
                                  style={styles.faqInput}
                                />
                              </View>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Soruyu kaldır"
                                onPress={() =>
                                  set(
                                    'faq',
                                    draft.faq.filter((_, itemIndex) => itemIndex !== index),
                                  )
                                }
                                style={styles.remove}
                              >
                                <Ionicons
                                  name="trash-outline"
                                  size={17}
                                  color={theme.colors.danger}
                                />
                              </Pressable>
                            </View>
                          ))}
                          {draft.faq.length === 0 ? (
                            <AppText variant="caption" color="textTertiary">
                              Henüz soru yok. AI Stüdyo’dan “SSS üret” ile öneri alabilirsin.
                            </AppText>
                          ) : null}
                        </>
                      ) : null}
                    </View>
                  </View>

                  <View style={[styles.sideColumn, compact && styles.sideColumnCompact]}>
                    <View
                      style={[
                        styles.card,
                        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                      ]}
                    >
                      <View style={styles.rowBetween}>
                        <AppText variant="title">Yayın</AppText>
                        <Badge
                          label={
                            draft.status === 'published'
                              ? 'Yayında'
                              : draft.status === 'draft'
                                ? 'Taslak'
                                : 'Arşiv'
                          }
                          tone={
                            draft.status === 'published'
                              ? 'success'
                              : draft.status === 'draft'
                                ? 'warning'
                                : 'neutral'
                          }
                        />
                      </View>
                      <View style={styles.chips}>
                        {(['draft', 'published', 'archived'] as AdminBlogStatus[]).map((status) => (
                          <Pressable
                            key={status}
                            onPress={() => set('status', status)}
                            style={[
                              styles.chip,
                              {
                                borderColor:
                                  draft.status === status
                                    ? theme.colors.primary
                                    : theme.colors.border,
                                backgroundColor:
                                  draft.status === status
                                    ? theme.colors.primarySoft
                                    : 'transparent',
                              },
                            ]}
                          >
                            <AppText
                              variant="caption"
                              color={draft.status === status ? 'primaryDeep' : 'textSecondary'}
                            >
                              {status === 'draft'
                                ? 'Taslak'
                                : status === 'published'
                                  ? 'Yayında'
                                  : 'Arşiv'}
                            </AppText>
                          </Pressable>
                        ))}
                      </View>
                      <View style={styles.switchRow}>
                        <View style={styles.flex}>
                          <AppText variant="label" color="textSecondary">
                            Öne çıkan yazı
                          </AppText>
                          <AppText variant="caption" color="textTertiary">
                            Blog dizininin üstünde büyük kart olarak gösterilir.
                          </AppText>
                        </View>
                        <Switch
                          value={draft.featured}
                          onValueChange={(value) => set('featured', value)}
                          trackColor={{
                            true: theme.colors.primary,
                            false: theme.colors.borderStrong,
                          }}
                          thumbColor={theme.colors.surface}
                        />
                      </View>
                      <TextField
                        label="Yazar"
                        value={draft.author}
                        onChangeText={(value) => set('author', value)}
                      />
                      <Pressable
                        onPress={() => setShowPublish((value) => !value)}
                        style={styles.linkButton}
                      >
                        <Ionicons
                          name={showPublish ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color={theme.colors.primary}
                        />
                        <AppText variant="caption" color="primary">
                          {showPublish ? 'Zamanlama ve gerekçeyi kapat' : 'Zamanlama ve gerekçe'}
                        </AppText>
                      </Pressable>
                      {showPublish ? (
                        <>
                          <TextField
                            label="Yayın tarihi (opsiyonel)"
                            value={draft.publishAt}
                            onChangeText={(value) => set('publishAt', value)}
                            placeholder="2026-11-01T10:00 — boşsa hemen yayınlanır"
                            autoCapitalize="none"
                            hint="İleri bir tarih verirsen yazı o tarihe kadar sitede görünmez."
                          />
                          <TextField
                            label="İşlem gerekçesi (arşiv/silme için)"
                            value={draft.reason}
                            onChangeText={(value) => set('reason', value)}
                            placeholder="Denetim kaydına yazılacak kısa gerekçe"
                            maxLength={400}
                          />
                        </>
                      ) : null}
                      {draft.aiGenerated ? (
                        <View style={styles.aiNote}>
                          <Ionicons name="sparkles" size={14} color={theme.colors.accent} />
                          <AppText variant="caption" color="textSecondary" style={styles.flex}>
                            Bu yazı AI ile üretildi{draft.aiModel ? ` · ${draft.aiModel}` : ''}.
                            Yayınlamadan önce yerel bilgileri doğrula.
                          </AppText>
                        </View>
                      ) : null}
                    </View>

                    <View
                      style={[
                        styles.card,
                        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                      ]}
                    >
                      <AppText variant="title">Sürüm geçmişi</AppText>
                      {(detail.data?.versions ?? []).slice(0, 8).map((version) => (
                        <View key={version.version} style={styles.versionRow}>
                          <AppText variant="caption" color="textSecondary">
                            v{version.version} · {version.status}
                          </AppText>
                          <AppText variant="caption" color="textTertiary">
                            {version.created_at.slice(0, 16).replace('T', ' ')}
                          </AppText>
                        </View>
                      ))}
                      {(detail.data?.versions ?? []).length === 0 ? (
                        <AppText variant="caption" color="textTertiary">
                          İlk kayıttan sonra sürümler burada listelenir.
                        </AppText>
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>
            </ScrollView>
          )}

          <View
            style={[
              styles.footer,
              { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface },
            ]}
          >
            {formError ? (
              <AppText variant="caption" color="danger" style={styles.flex}>
                {formError}
              </AppText>
            ) : (
              <AppText variant="caption" color="textTertiary" style={styles.flex}>
                {draft.status === 'published'
                  ? 'Kaydedince değişiklikler yayındaki sayfaya yansır.'
                  : 'Yayınla dediğinde yazı anında web sitesinde görünür.'}
              </AppText>
            )}
            <Button label="Vazgeç" variant="ghost" size="sm" fullWidth={false} onPress={onClose} />
            <Button
              label="Taslak kaydet"
              variant="secondary"
              size="sm"
              fullWidth={false}
              loading={save.isPending && draft.status === 'draft'}
              disabled={save.isPending || !canManage}
              onPress={() => void persist('draft')}
            />
            <Button
              label={draft.status === 'published' ? 'Güncelle' : 'Yayınla'}
              size="sm"
              fullWidth={false}
              loading={save.isPending && draft.status === 'published'}
              disabled={save.isPending || !canManage}
              leftIcon={<Ionicons name="send" size={14} color={theme.colors.onPrimary} />}
              onPress={() => void persist('published')}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  sheet: {
    width: '100%',
    height: '95%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  close: { padding: 6 },
  scroll: { flex: 1 },
  content: { padding: 18 },
  stack: { gap: 14 },
  columns: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  columnsCompact: { flexDirection: 'column' },
  mainColumn: { flex: 1, gap: 14, minWidth: 0, alignSelf: 'stretch' },
  sideColumn: { width: 340, gap: 14 },
  sideColumnCompact: { width: '100%' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 15, gap: 11 },
  row: { flexDirection: 'row', gap: 10 },
  rowCompact: { flexDirection: 'column' },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  flex: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  excerptInput: { minHeight: 84 },
  bodyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  bodyInput: { minHeight: 420 },
  preview: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 8 },
  seoInput: { minHeight: 80 },
  faqRow: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 11,
    alignItems: 'flex-start',
  },
  faqInput: { minHeight: 70 },
  remove: { padding: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(124,77,255,0.08)',
    padding: 9,
    borderRadius: 9,
  },
  versionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },

  // AI Stüdyo
  aiStudio: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 13 },
  aiStudioHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  aiIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  aiPromptRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  aiPromptRowCompact: { flexDirection: 'column', alignItems: 'stretch' },
  aiTopic: { minHeight: 76 },
  aiButton: { width: 260, marginBottom: 2 },
  aiButtonCompact: { marginTop: 2 },
  aiOptions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  aiAdvanced: { gap: 10 },
  wordsField: { width: 130 },
  notesInput: { minHeight: 66 },
  aiProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 9 },
  doneBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 7 },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingTop: 4,
  },
  tools: { gap: 10 },
  aiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  suggestions: { gap: 7 },
  suggestion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, padding: 9 },
  outline: { lineHeight: 19 },
});
