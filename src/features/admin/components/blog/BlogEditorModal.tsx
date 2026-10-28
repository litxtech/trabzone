import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
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
import { useAdminBlogAiSettings, useAdminBlogPost, useAdminBlogSave, useBlogAi } from '@/features/admin/hooks/use-admin-blog';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { MarkdownView } from '@/features/blog/components/MarkdownView';
import type {
  AdminBlogPost,
  AdminBlogStatus,
  AiArticleResult,
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

const CATEGORIES = ['Gezi', 'Ulaşım', 'Emlak', 'Doğa', 'Yemek', 'Yaşam', 'Alışveriş', 'Spor', 'Kültür'];

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
  const compact = width < 900;
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
  const [aiAudience, setAiAudience] = useState('Trabzon’u gezecek veya Trabzon’da yaşayacak yetişkinler');
  const [aiTone, setAiTone] = useState('samimi, net, abartısız');
  const [aiWords, setAiWords] = useState('1800');
  const [aiNotes, setAiNotes] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (postId && detail.data) {
      setDraft(toDraft(detail.data));
      setAiTopic(detail.data.title);
    } else if (!postId) {
      setDraft(EMPTY);
      setAiTopic('');
    }
    setPreview(false);
    setAiError(null);
    setFormError(null);
    setTitles([]);
    setOutline('');
  }, [detail.data, postId, visible]);

  const words = useMemo(() => wordCount(draft.body), [draft.body]);
  const ready = !postId || Boolean(detail.data);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

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

  const runSeo = async (title: string, body: string, source: Record<string, unknown>) => {
    const result = (await ai.mutateAsync({
      action: 'seo',
      title,
      body_markdown: body,
      category: draft.category,
      keywords: splitList(draft.tagsText),
    })) as unknown as AiSeoResult;
    setDraft((current) => ({
      ...current,
      slug: result.slug || current.slug || slugify(title),
      seoTitle: result.seo_title || current.seoTitle,
      seoDescription: result.seo_description || current.seoDescription,
      keywordsText: result.keywords?.length ? result.keywords.join(', ') : current.keywordsText,
      tagsText: result.tags?.length ? result.tags.join(', ') : current.tagsText,
      faq: result.faq?.length ? result.faq : current.faq,
      aiModel: typeof source.model === 'string' ? source.model : current.aiModel,
    }));
  };

  const runAi = async (kind: 'article' | 'seo' | 'improve' | 'title' | 'faq' | 'outline') => {
    if (aiSettings.data && !aiSettings.data.enabled) {
      setAiError('AI yazma özelliği kapalı. AI ayarlarından açabilirsin.');
      return;
    }
    if ((kind === 'seo' || kind === 'improve' || kind === 'faq') && !draft.body.trim()) {
      setAiError('Önce bir gövde metni gir veya AI ile yazdır.');
      return;
    }
    setAiBusy(kind);
    setAiError(null);
    try {
      if (kind === 'article') {
        const result = (await ai.mutateAsync({
          action: 'article',
          topic: aiTopic.trim() || draft.title.trim(),
          category: draft.category,
          audience: aiAudience,
          tone: aiTone,
          targetWords: Number(aiWords) || 1800,
          notes: aiNotes,
          keywords: splitList(draft.tagsText),
        })) as unknown as AiArticleResult;
        setDraft((current) => ({
          ...current,
          title: result.title || current.title,
          excerpt: result.excerpt || current.excerpt,
          body: result.body_markdown,
          aiGenerated: true,
        }));
        await runSeo(result.title || draft.title, result.body_markdown, result as unknown as Record<string, unknown>);
        toast.success('AI yazısı ve SEO meta verileri hazır. Kaydetmeden önce gözden geçir.');
        return;
      }

      if (kind === 'seo') {
        const result = (await ai.mutateAsync({
          action: 'seo',
          title: draft.title,
          body_markdown: draft.body,
          category: draft.category,
          keywords: splitList(draft.tagsText),
        })) as unknown as AiSeoResult;
        setDraft((current) => ({
          ...current,
          slug: result.slug || current.slug,
          seoTitle: result.seo_title || current.seoTitle,
          seoDescription: result.seo_description || current.seoDescription,
          keywordsText: result.keywords?.length ? result.keywords.join(', ') : current.keywordsText,
          tagsText: result.tags?.length ? result.tags.join(', ') : current.tagsText,
          faq: result.faq?.length ? result.faq : current.faq,
        }));
        toast.success('SEO başlığı, açıklama, anahtar kelimeler ve SSS güncellendi.');
        return;
      }

      if (kind === 'improve') {
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
        return;
      }

      if (kind === 'title') {
        const result = await ai.mutateAsync({ action: 'title', topic: aiTopic || draft.title, count: 8 });
        const list = Array.isArray(result.titles) ? (result.titles as string[]) : [];
        setTitles(list);
        return;
      }

      if (kind === 'faq') {
        const result = await ai.mutateAsync({
          action: 'faq',
          title: draft.title,
          body_markdown: draft.body,
        });
        const faq = Array.isArray(result.faq) ? (result.faq as BlogFaq[]) : [];
        setDraft((current) => ({ ...current, faq }));
        toast.success('SSS önerileri eklendi.');
        return;
      }

      const result = await ai.mutateAsync({
        action: 'outline',
        topic: aiTopic || draft.title,
        category: draft.category,
        audience: aiAudience,
        targetWords: Number(aiWords) || 1800,
        notes: aiNotes,
      });
      setOutline(typeof result.content === 'string' ? result.content : '');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI işlemi tamamlanamadı.');
    } finally {
      setAiBusy(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              maxWidth: compact ? '100%' : 1180,
            },
          ]}
        >
          <View style={[styles.header, { borderColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="h2">{postId ? 'Blog yazısını düzenle' : 'Yeni blog yazısı'}</AppText>
              <AppText variant="caption" color="textTertiary">
                {postId ? `Sürüm ${detail.data?.version ?? '—'} · ${detail.data?.word_count ?? 0} kelime` : 'Taslak olarak başla, hazır olunca yayınla'}
              </AppText>
            </View>
            <Badge
              label={draft.status === 'published' ? 'Yayında' : draft.status === 'draft' ? 'Taslak' : 'Arşiv'}
              tone={draft.status === 'published' ? 'success' : draft.status === 'draft' ? 'warning' : 'neutral'}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={styles.close}>
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
              contentContainerStyle={[styles.content, compact && styles.contentCompact]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.mainColumn}>
                <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                  <AppText variant="title">İçerik</AppText>
                  <TextField
                    label="Başlık"
                    value={draft.title}
                    onChangeText={(value) => set('title', value)}
                    placeholder="Örn. Trabzon'da 2 Günde Ne Yapılır? Mahalle Mahalle Rota"
                    maxLength={200}
                  />
                  <View style={styles.row}>
                    <TextField
                      label="URL adresi (slug)"
                      value={draft.slug}
                      onChangeText={(value) => set('slug', value)}
                      placeholder="boş bırakılırsa başlıktan üretilir"
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
                            borderColor: draft.category === category ? theme.colors.primary : theme.colors.border,
                            backgroundColor: draft.category === category ? theme.colors.primarySoft : 'transparent',
                          },
                        ]}
                      >
                        <AppText variant="caption" color={draft.category === category ? 'primaryDeep' : 'textSecondary'}>
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
                    <View style={styles.bodyTools}>
                      <AppText variant="caption" color={words < 300 ? 'warning' : 'success'}>
                        {words} kelime · ~{Math.max(1, Math.ceil(words / 200))} dk
                      </AppText>
                      <Pressable onPress={() => setPreview((value) => !value)} style={styles.linkButton}>
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
                      placeholder={'## Bölüm başlığı\n\nParagraf…\n\n- Madde 1\n- Madde 2\n\n| Karşılaştırma | Not |\n| --- | --- |\n| Örnek | Değer |'}
                      multiline
                      style={styles.bodyInput}
                      textAlignVertical="top"
                    />
                  )}
                </View>

                <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                  <AppText variant="title">SEO ve meta</AppText>
                  <TextField
                    label="SEO başlığı"
                    value={draft.seoTitle}
                    onChangeText={(value) => set('seoTitle', value)}
                    placeholder="60 karakteri geçmeyen arama başlığı"
                    maxLength={200}
                  />
                  <TextField
                    label="SEO açıklaması"
                    value={draft.seoDescription}
                    onChangeText={(value) => set('seoDescription', value)}
                    placeholder="140-160 karakterlik açıklama"
                    multiline
                    maxLength={400}
                    style={styles.seoInput}
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
                  <TextField
                    label="Yazar"
                    value={draft.author}
                    onChangeText={(value) => set('author', value)}
                  />
                </View>

                <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                  <View style={styles.rowBetween}>
                    <AppText variant="title">Sık sorulan sorular</AppText>
                    <Button
                      label="Soru ekle"
                      size="sm"
                      variant="secondary"
                      fullWidth={false}
                      onPress={() => set('faq', [...draft.faq, { question: '', answer: '' }])}
                    />
                  </View>
                  <AppText variant="caption" color="textTertiary">
                    Bu sorular sayfada açılır kapanır liste olarak gösterilir ve FAQPage yapısal
                    verisine eklenir. Gövdede ayrıca "Sık sorulan sorular" başlığı varsa tekrar
                    gösterilmez.
                  </AppText>
                  {draft.faq.map((item, index) => (
                    <View key={`faq-${index}`} style={[styles.faqRow, { borderColor: theme.colors.border }]}>
                      <View style={styles.flex}>
                        <TextField
                          label={`Soru ${index + 1}`}
                          value={item.question}
                          onChangeText={(value) => {
                            const next = [...draft.faq];
                            next[index] = { question: value, answer: next[index]?.answer ?? '' };
                            set('faq', next);
                          }}
                          placeholder="Trabzon'da kaç gün kalınmalı?"
                        />
                        <TextField
                          label="Cevap"
                          value={item.answer}
                          onChangeText={(value) => {
                            const next = [...draft.faq];
                            next[index] = { question: next[index]?.question ?? '', answer: value };
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
                        onPress={() => set('faq', draft.faq.filter((_, itemIndex) => itemIndex !== index))}
                        style={styles.remove}
                      >
                        <Ionicons name="trash-outline" size={17} color={theme.colors.danger} />
                      </Pressable>
                    </View>
                  ))}
                  {draft.faq.length === 0 ? (
                    <AppText variant="caption" color="textTertiary">
                      Henüz soru yok. AI panelinden "SSS üret" ile öneri alabilirsin.
                    </AppText>
                  ) : null}
                </View>

                <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                  <AppText variant="title">Yayın ayarları</AppText>
                  <View style={styles.chips}>
                    {(['draft', 'published', 'archived'] as AdminBlogStatus[]).map((status) => (
                      <Pressable
                        key={status}
                        onPress={() => set('status', status)}
                        style={[
                          styles.chip,
                          {
                            borderColor: draft.status === status ? theme.colors.primary : theme.colors.border,
                            backgroundColor: draft.status === status ? theme.colors.primarySoft : 'transparent',
                          },
                        ]}
                      >
                        <AppText variant="caption" color={draft.status === status ? 'primaryDeep' : 'textSecondary'}>
                          {status === 'draft' ? 'Taslak' : status === 'published' ? 'Yayında' : 'Arşiv'}
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
                      trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
                      thumbColor={theme.colors.surface}
                    />
                  </View>
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
                  {draft.aiGenerated ? (
                    <View style={styles.aiNote}>
                      <Ionicons name="sparkles" size={14} color={theme.colors.accent} />
                      <AppText variant="caption" color="textSecondary">
                        Bu yazı AI ile üretildi{draft.aiModel ? ` · ${draft.aiModel}` : ''}. Yayınlamadan
                        önce yerel bilgileri doğrula.
                      </AppText>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={[styles.sideColumn, compact && styles.sideColumnCompact]}>
                <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                  <View style={styles.rowBetween}>
                    <View style={styles.flex}>
                      <AppText variant="title">AI yazma</AppText>
                      <AppText variant="caption" color="textTertiary">
                        DeepSeek · {aiSettings.data?.model ?? 'deepseek-chat'}
                      </AppText>
                    </View>
                    <Badge
                      label={aiSettings.data?.enabled ? 'Açık' : 'Kapalı'}
                      tone={aiSettings.data?.enabled ? 'success' : 'neutral'}
                    />
                  </View>
                  <TextField
                    label="Konu / ana fikir"
                    value={aiTopic}
                    onChangeText={setAiTopic}
                    placeholder="Örn. Trabzon'da yağmurlu günde yapılacaklar"
                    multiline
                    style={styles.aiTopic}
                  />
                  <TextField
                    label="Hedef okuyucu"
                    value={aiAudience}
                    onChangeText={setAiAudience}
                    multiline
                  />
                  <View style={styles.row}>
                    <TextField label="Ton" value={aiTone} onChangeText={setAiTone} containerStyle={styles.flex} />
                    <TextField
                      label="Hedef kelime"
                      value={aiWords}
                      onChangeText={setAiWords}
                      keyboardType="number-pad"
                      containerStyle={styles.flex}
                    />
                  </View>
                  <TextField
                    label="Editör notları"
                    value={aiNotes}
                    onChangeText={setAiNotes}
                    placeholder="Eklemek istediğin açı, mekân, karşılaştırma…"
                    multiline
                    style={styles.notesInput}
                  />
                  <Button
                    label="AI ile yaz ve SEO üret"
                    leftIcon={<Ionicons name="sparkles" size={16} color={theme.colors.onPrimary} />}
                    loading={aiBusy === 'article'}
                    disabled={Boolean(aiBusy) || !canManage}
                    onPress={() => void runAi('article')}
                  />
                  <View style={styles.aiGrid}>
                    <Button
                      label="SEO üret"
                      size="sm"
                      variant="secondary"
                      loading={aiBusy === 'seo'}
                      disabled={Boolean(aiBusy)}
                      onPress={() => void runAi('seo')}
                    />
                    <Button
                      label="Başlık öner"
                      size="sm"
                      variant="secondary"
                      loading={aiBusy === 'title'}
                      disabled={Boolean(aiBusy)}
                      onPress={() => void runAi('title')}
                    />
                    <Button
                      label="SSS üret"
                      size="sm"
                      variant="secondary"
                      loading={aiBusy === 'faq'}
                      disabled={Boolean(aiBusy)}
                      onPress={() => void runAi('faq')}
                    />
                    <Button
                      label="Taslak çıkar"
                      size="sm"
                      variant="secondary"
                      loading={aiBusy === 'outline'}
                      disabled={Boolean(aiBusy)}
                      onPress={() => void runAi('outline')}
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
                    loading={aiBusy === 'improve'}
                    disabled={Boolean(aiBusy) || !draft.body}
                    onPress={() => void runAi('improve')}
                  />
                  {aiBusy ? (
                    <View style={styles.aiProgress}>
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                      <AppText variant="caption" color="textSecondary">
                        DeepSeek yazıyor… Uzun yazılarda 30-60 saniye sürebilir.
                      </AppText>
                    </View>
                  ) : null}
                  {aiError ? (
                    <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
                      <AppText variant="caption" color="danger">
                        {aiError}
                      </AppText>
                    </View>
                  ) : null}
                  {titles.length > 0 ? (
                    <View style={styles.suggestions}>
                      <AppText variant="label" color="textSecondary">
                        Başlık önerileri
                      </AppText>
                      {titles.map((title) => (
                        <Pressable
                          key={title}
                          onPress={() => set('title', title)}
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

                <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
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
            </ScrollView>
          )}

          <View style={[styles.footer, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
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
  sheet: { width: '100%', height: '94%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  close: { padding: 6 },
  scroll: { flex: 1 },
  content: { flexDirection: 'row', gap: 16, padding: 18, alignItems: 'flex-start' },
  contentCompact: { flexDirection: 'column' },
  mainColumn: { flex: 1, gap: 14, minWidth: 0 },
  sideColumn: { width: 350, gap: 14 },
  sideColumnCompact: { width: '100%' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 15, gap: 11 },
  row: { flexDirection: 'row', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  excerptInput: { minHeight: 84 },
  bodyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  bodyTools: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bodyInput: { minHeight: 430 },
  preview: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 8 },
  seoInput: { minHeight: 80 },
  faqRow: { flexDirection: 'row', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11, alignItems: 'flex-start' },
  faqInput: { minHeight: 70 },
  remove: { padding: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiNote: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(124,77,255,0.08)', padding: 9, borderRadius: 9 },
  aiTopic: { minHeight: 70 },
  notesInput: { minHeight: 66 },
  aiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  aiProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorBox: { padding: 9, borderRadius: 9 },
  suggestions: { gap: 7 },
  suggestion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, padding: 9 },
  outline: { lineHeight: 19 },
  versionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
});

