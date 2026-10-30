import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminNewsAssist,
  useAdminNewsHighRiskPublish,
  useAdminNewsReviewAction,
  useAdminNewsRetract,
} from '@/features/admin/hooks/use-admin-news';
import { openUrl } from '@/features/in-app-browser';
import type { NewsReviewDetail } from '@/features/news/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

type EditorDraft = {
  title: string;
  spot: string;
  body: string;
  social_copy: string;
  seo_title: string;
  seo_description: string;
  category_slug: string;
  district: string;
  event_date: string;
};

const EMPTY: EditorDraft = {
  title: '',
  spot: '',
  body: '',
  social_copy: '',
  seo_title: '',
  seo_description: '',
  category_slug: '',
  district: '',
  event_date: '',
};

function fromDetail(detail: NewsReviewDetail): EditorDraft {
  const draft = detail.draft;
  return {
    title: draft?.title ?? detail.event.title,
    spot: draft?.spot ?? '',
    body: draft?.body ?? '',
    social_copy: draft?.social_copy ?? '',
    seo_title: '',
    seo_description: '',
    category_slug: detail.event.category_slug ?? '',
    district: detail.event.district ?? '',
    event_date: detail.event.event_date ?? '',
  };
}

function riskTone(risk: string): 'success' | 'warning' | 'danger' {
  if (risk === 'A') return 'success';
  if (risk === 'B') return 'warning';
  return 'danger';
}

const REASON_LABELS: Record<string, string> = {
  high_risk: 'Yüksek risk sınıfı',
  insufficient_independent_sources: 'Yeterli bağımsız kaynak yok',
  verification_failed: 'Doğrulama geçmedi',
  source_conflict: 'Kaynaklar çelişiyor',
  event_date_missing: 'Olay tarihi yok',
  media_missing: 'Görsel yok',
  media_placeholder: 'Yalnızca kategori görseli var',
  media_license_unverified: 'Görsel lisansı doğrulanamadı',
  quality_too_low: 'Metin kalite eşiği altında',
  trabzon_link_missing: 'Trabzon bağlantısı kanıtlanmadı',
  quota_exhausted: 'Günlük kota dolu',
  publish_deferred: 'Yayın penceresi dışında',
  auto_publish_disabled: 'Otomatik yayın kapalı',
  dry_run: 'Deneme modu açık',
};

export function NewsReviewModal({
  visible,
  eventId,
  detail,
  loading,
  onClose,
}: {
  visible: boolean;
  eventId: string | null;
  detail: NewsReviewDetail | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 860;
  const toast = useAdminToast();

  const [draftEdits, setDraftEdits] = useState<{ eventId: string; draft: EditorDraft } | null>(null);
  const [suggestionState, setSuggestionState] = useState<{
    eventId: string;
    value: Record<string, unknown> | null;
  } | null>(null);
  const [reasonAction, setReasonAction] = useState<
    'reject' | 'archive' | 'retract' | 'high_risk' | null
  >(null);

  // Sunucu verisi değiştiğinde form türetilir; yalnızca editör düzenlemeleri
  // ayrı tutulur. Böylece effect içinde setState çağrılmaz ve başka bir olaya
  // geçildiğinde eski taslak yanlışlıkla taşınmaz.
  const draft =
    draftEdits && draftEdits.eventId === (eventId ?? '')
      ? draftEdits.draft
      : detail
        ? fromDetail(detail)
        : EMPTY;
  const suggestion =
    suggestionState && suggestionState.eventId === (eventId ?? '')
      ? suggestionState.value
      : null;
  const setDraft = useCallback(
    (next: EditorDraft | ((current: EditorDraft) => EditorDraft)) => {
      setDraftEdits((current) => {
        const base =
          current && current.eventId === (eventId ?? '')
            ? current.draft
            : detail
              ? fromDetail(detail)
              : EMPTY;
        return {
          eventId: eventId ?? '',
          draft: typeof next === 'function' ? next(base) : next,
        };
      });
    },
    [detail, eventId],
  );
  const setSuggestion = useCallback(
    (value: Record<string, unknown> | null) => {
      setSuggestionState({ eventId: eventId ?? '', value });
    },
    [eventId],
  );

  const action = useAdminNewsReviewAction();
  const retract = useAdminNewsRetract();
  const highRisk = useAdminNewsHighRiskPublish();
  const assist = useAdminNewsAssist();

  const busy =
    action.isPending || retract.isPending || highRisk.isPending || assist.isPending || loading;

  const runAction = async (
    kind: 'approve' | 'edit_approve' | 'defer' | 'remove_media',
    success: string,
  ) => {
    if (!eventId) return;
    try {
      await action.mutateAsync({
        eventId,
        action: kind,
        payload:
          kind === 'edit_approve'
            ? {
                title: draft.title,
                spot: draft.spot,
                body: draft.body,
                social_copy: draft.social_copy,
                category_slug: draft.category_slug || undefined,
                district: draft.district || null,
                event_date: draft.event_date || null,
              }
            : kind === 'defer'
              ? {}
              : {},
        reason: kind === 'defer' ? 'Editör daha sonra inceleyecek' : null,
      });
      toast.success(success);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    }
  };

  const [assistConflicts, setAssistConflicts] = useState<string[]>([]);

  const runAssist = async (
    assistAction:
      | 'rewrite'
      | 'recheck_sources'
      | 'find_photo'
      | 'improve_title'
      | 'simplify'
      | 'proofread'
      | 'check_conflicts'
      | 'social_copy'
      | 'expand'
      | 'prepare_spot'
      | 'check_quality',
  ) => {
    if (!eventId) return;
    try {
      const result = await assist.mutateAsync({ action: assistAction, eventId });
      if (assistAction === 'recheck_sources') {
        toast.success(`Kaynak taraması tamamlandı (${Number(result.added ?? 0)} yeni kayıt).`);
      } else if (assistAction === 'find_photo') {
        if (result.found === true) {
          toast.success(`Lisanslı fotoğraf bulundu (${String(result.license_code ?? '')}).`);
        } else {
          toast.success('Olayla eşleşen lisanslı fotoğraf bulunamadı; kategori görseli korunuyor.');
        }
      } else if (assistAction === 'expand') {
        const next = (result.suggestion ?? null) as Record<string, unknown> | null;
        if (!next) {
          toast.error(
            String(
              result.message ??
                'Yeni doğrulanmış kaynak bilgisi bulunamadı; metin genişletilmedi.',
            ),
          );
        } else {
          setSuggestion(next);
          toast.success(
            `Yeni kaynaklarla genişletildi (${Number(result.added_source_count ?? 0)} kaynak). Öneriyi uygula.`,
          );
        }
      } else if (assistAction === 'check_quality') {
        const unsupported = Array.isArray(result.unsupported) ? result.unsupported.length : 0;
        const quality = Number(result.quality ?? 0);
        toast.success(
          `Kalite: ${Math.round(quality * 100)}/100 · ${unsupported} doğrulanamayan iddia.`,
        );
      } else if (assistAction === 'check_conflicts') {
        const suggestion = (result.suggestion ?? {}) as Record<string, unknown>;
        const conflicts = Array.isArray(suggestion.conflicts)
          ? suggestion.conflicts.map((item) => String(item))
          : [];
        setAssistConflicts(conflicts);
        toast.success(
          conflicts.length === 0
            ? 'Kaynaklar arasında çelişki bulunmadı.'
            : `${conflicts.length} olası çelişki bulundu.`,
        );
      } else {
        const next = (result.suggestion ?? null) as Record<string, unknown> | null;
        setSuggestion(next);
        toast.success('AI önerisi hazır. Uygulamak için “Öneriyi uygula”ya bas.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI işlemi tamamlanamadı.');
    }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    const read = (key: string) => (typeof suggestion[key] === 'string' ? (suggestion[key] as string) : '');
    setDraft((current) => ({
      ...current,
      title: read('title') || current.title,
      spot: read('spot') || current.spot,
      body: read('body') || current.body,
      social_copy: read('social_copy') || current.social_copy,
      seo_title: read('seo_title') || current.seo_title,
      seo_description: read('seo_description') || current.seo_description,
    }));
    setSuggestion(null);
    toast.success('AI önerisi taslağa uygulandı. Yayından önce metni oku.');
  };

  const confirmReason = async ({ reason }: { reason: string }) => {
    if (!eventId || !reasonAction) return;
    try {
      if (reasonAction === 'retract') {
        await retract.mutateAsync({ eventId, reason });
        toast.success('Haber yayından kaldırıldı ve gönderi gizlendi.');
      } else if (reasonAction === 'high_risk') {
        await highRisk.mutateAsync({ eventId, reason });
        toast.success('Haber hukuki denetim gerekçesiyle yayımlandı.');
      } else {
        await action.mutateAsync({ eventId, action: reasonAction, reason });
        toast.success(reasonAction === 'reject' ? 'Haber reddedildi.' : 'Haber arşivlendi.');
      }
      setReasonAction(null);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    }
  };

  const event = detail?.event;
  const highRiskEvent = event?.risk_level === 'C';
  const publication = detail?.publication;
  const isPublished = Boolean(publication && !publication.retracted_at);

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.border,
                maxWidth: compact ? '100%' : 1120,
              },
            ]}
          >
            <View style={[styles.header, { borderColor: theme.colors.divider }]}>
              <View style={styles.flex}>
                <AppText variant="h2">AI haber incelemesi</AppText>
                <AppText variant="caption" color="textTertiary">
                  {event ? `${event.category_slug} · ${event.district ?? 'Trabzon geneli'} · ${formatDateTimeTr(event.created_at)}` : 'Yükleniyor…'}
                </AppText>
              </View>
              {event ? <Badge label={`Risk ${event.risk_level}`} tone={riskTone(event.risk_level)} /> : null}
              {detail?.queue?.state ? <Badge label={detail.queue.state} tone="neutral" /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={styles.close}>
                <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            {loading || !detail || !event ? (
              <View style={styles.center}>
                <ActivityIndicator color={theme.colors.primary} />
                <AppText variant="caption" color="textTertiary">
                  İnceleme kaydı yükleniyor…
                </AppText>
              </View>
            ) : (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.content, compact && styles.contentCompact]}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.mainColumn}>
                  {highRiskEvent ? (
                    <View style={[styles.alert, { backgroundColor: theme.colors.dangerSoft }]}>
                      <Ionicons name="shield-half" size={16} color={theme.colors.danger} />
                      <AppText variant="caption" color="danger" style={styles.flex}>
                        Yüksek risk (C): otomatik yayın kapalı. Yayın için hukuki/editoryal denetim
                        gerekçesi zorunlu; risk seviyesi düşürülemez.
                      </AppText>
                    </View>
                  ) : null}

                  <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                    <AppText variant="label" color="textSecondary">
                      Otomatik yayın engelleri
                    </AppText>
                    <View style={styles.chips}>
                      {(event.auto_block_reasons ?? []).length === 0 ? (
                        <Badge label="Engel yok" tone="success" />
                      ) : (
                        event.auto_block_reasons.map((reason) => (
                          <Badge key={reason} label={REASON_LABELS[reason] ?? reason} tone="warning" />
                        ))
                      )}
                      {event.conflict ? <Badge label="Kaynak çelişkisi" tone="danger" /> : null}
                    </View>
                    <AppText variant="caption" color="textTertiary">
                      Bağımsız kaynak: {event.independent_sources} · Birincil resmî kaynak:{' '}
                      {event.primary_source ? 'var' : 'yok'} · Olay tarihi:{' '}
                      {event.event_date ? formatDateTimeTr(event.event_date) : 'belirtilmemiş'}
                    </AppText>
                  </View>

                  <TextField
                    label="Başlık"
                    value={draft.title}
                    onChangeText={(value) => setDraft((current) => ({ ...current, title: value }))}
                    maxLength={180}
                  />
                  <TextField
                    label="Spot"
                    value={draft.spot}
                    onChangeText={(value) => setDraft((current) => ({ ...current, spot: value }))}
                    multiline
                    maxLength={400}
                    containerStyle={styles.spotInput}
                  />
                  <TextField
                    label="Haber metni"
                    value={draft.body}
                    onChangeText={(value) => setDraft((current) => ({ ...current, body: value }))}
                    multiline
                    containerStyle={styles.bodyInput}
                    hint="Kaynakta olmayan bilgi ekleme. Düzenleme yeni sürüm olarak kaydedilir."
                  />
                  <View style={styles.twoCol}>
                    <TextField
                      label="Kategori (slug)"
                      value={draft.category_slug}
                      onChangeText={(value) => setDraft((current) => ({ ...current, category_slug: value }))}
                      containerStyle={styles.flex}
                    />
                    <TextField
                      label="İlçe"
                      value={draft.district}
                      onChangeText={(value) => setDraft((current) => ({ ...current, district: value }))}
                      containerStyle={styles.flex}
                    />
                    <TextField
                      label="Olay tarihi (YYYY-MM-DD)"
                      value={draft.event_date}
                      onChangeText={(value) => setDraft((current) => ({ ...current, event_date: value }))}
                      containerStyle={styles.flex}
                    />
                  </View>
                  <TextField
                    label="Sosyal paylaşım metni"
                    value={draft.social_copy}
                    onChangeText={(value) => setDraft((current) => ({ ...current, social_copy: value }))}
                    multiline
                    containerStyle={styles.smallInput}
                  />
                  <View style={styles.twoCol}>
                    <TextField
                      label="SEO başlığı"
                      value={draft.seo_title}
                      onChangeText={(value) => setDraft((current) => ({ ...current, seo_title: value }))}
                      containerStyle={styles.flex}
                      maxLength={70}
                    />
                    <TextField
                      label="SEO açıklaması"
                      value={draft.seo_description}
                      onChangeText={(value) => setDraft((current) => ({ ...current, seo_description: value }))}
                      containerStyle={styles.flex}
                      maxLength={180}
                    />
                  </View>

                  <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                    <AppText variant="label" color="textSecondary">
                      AI editör yardımı
                    </AppText>
                    <View style={styles.chips}>
                      <Button label="Başlığı iyileştir" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('improve_title')} />
                      <Button label="Metni sadeleştir" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('simplify')} />
                      <Button label="Yazımı düzelt" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('proofread')} />
                      <Button label="Metni iyileştir" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('rewrite')} />
                      <Button label="Kaynaklarla genişlet" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('expand')} />
                      <Button label="Spot hazırla" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('prepare_spot')} />
                      <Button label="Kalite kontrolü" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('check_quality')} />
                      <Button label="Kaynakları kontrol et" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('recheck_sources')} />
                      <Button label="Çelişkileri incele" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('check_conflicts')} />
                      <Button label="Sosyal metin hazırla" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('social_copy')} />
                      <Button label="Gerçek fotoğraf ara" size="sm" variant="secondary" fullWidth={false} loading={assist.isPending} onPress={() => void runAssist('find_photo')} />
                    </View>
                    {assistConflicts.length ? (
                      <View style={[styles.suggestion, { borderColor: theme.colors.danger }]}>
                        <AppText variant="caption" color="danger">
                          Olası çelişkiler:
                        </AppText>
                        {assistConflicts.map((conflict, index) => (
                          <AppText key={`${index}-${conflict.slice(0, 12)}`} variant="caption" color="textSecondary">
                            • {conflict}
                          </AppText>
                        ))}
                      </View>
                    ) : null}
                    {suggestion ? (
                      <View style={[styles.suggestion, { borderColor: theme.colors.border }]}>
                        <AppText variant="caption" color="textSecondary">
                          Öneri: {String(suggestion.title ?? '')}
                        </AppText>
                        <Button label="Öneriyi uygula" size="sm" fullWidth={false} onPress={applySuggestion} />
                      </View>
                    ) : (
                      <AppText variant="caption" color="textTertiary">
                        AI yalnızca kayıtlı kaynaklara dayanır; doğrulama ve kaynak kayıtları korunur.
                      </AppText>
                    )}
                  </View>
                </View>

                <View style={[styles.sideColumn, compact && styles.sideColumnCompact]}>
                  <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                    <AppText variant="label" color="textSecondary">
                      Doğrulama geçmişi
                    </AppText>
                    {(detail.verification ?? []).length === 0 ? (
                      <AppText variant="caption" color="textTertiary">
                        Doğrulama kaydı yok.
                      </AppText>
                    ) : (
                      detail.verification.map((item) => (
                        <View key={item.created_at} style={styles.stack}>
                          <View style={styles.rowBetween}>
                            <Badge label={item.passed ? 'Geçti' : 'Geçmedi'} tone={item.passed ? 'success' : 'danger'} />
                            <Badge label={`Risk ${item.risk_level}`} tone={riskTone(item.risk_level)} />
                          </View>
                          <AppText variant="caption" color="textSecondary">
                            {item.checks.notes || 'Not yok'}
                          </AppText>
                          {item.conflicts.length ? (
                            <AppText variant="caption" color="danger">
                              Çelişki: {item.conflicts.join('; ')}
                            </AppText>
                          ) : null}
                          <AppText variant="caption" color="textTertiary">
                            {item.model ?? 'model yok'} · {formatDateTimeTr(item.created_at)}
                          </AppText>
                        </View>
                      ))
                    )}
                  </View>

                  <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                    <AppText variant="label" color="textSecondary">
                      Kaynaklar ({detail.evidence.length})
                    </AppText>
                    {(detail.evidence ?? []).slice(0, 8).map((item) => (
                      <Pressable
                        key={`${item.url}-${item.retrieved_at}`}
                        accessibilityRole="link"
                        onPress={() => void openUrl(item.url)}
                        style={styles.sourceRow}
                      >
                        <Ionicons name="link-outline" size={13} color={theme.colors.textTertiary} />
                        <View style={styles.flex}>
                          <AppText variant="caption" numberOfLines={2}>
                            {item.title || item.url}
                          </AppText>
                          <AppText variant="caption" color="textTertiary">
                            {item.domain} · {item.kind === 'official' ? 'resmî' : item.kind}
                            {item.is_primary ? ' · ana kaynak' : ''}
                          </AppText>
                        </View>
                      </Pressable>
                    ))}
                  </View>

                  <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                    <AppText variant="label" color="textSecondary">
                      Görsel ve lisans
                    </AppText>
                    {(detail.media ?? []).length === 0 ? (
                      <AppText variant="caption" color="textTertiary">
                        Görsel kaydı yok. Yayında kategori tasarımı kullanılabilir.
                      </AppText>
                    ) : (
                      detail.media.map((item) => (
                        <View key={item.id} style={styles.stack}>
                          <View style={styles.chips}>
                            <Badge label={item.is_placeholder ? 'Kategori tasarımı' : 'Gerçek fotoğraf'} tone={item.is_placeholder ? 'neutral' : 'success'} />
                            <Badge label={item.status} tone="neutral" />
                          </View>
                          <AppText variant="caption" color="textSecondary">
                            Lisans: {item.license_name || item.license_code || 'doğrulanmadı'}
                          </AppText>
                          <AppText variant="caption" color="textTertiary">
                            Olay eşleşmesi: {item.event_match_score != null ? `${Math.round(item.event_match_score * 100)}%` : '—'}
                            {item.source_url ? ` · ${item.source_url}` : ''}
                          </AppText>
                          {item.reject_reason ? (
                            <AppText variant="caption" color="danger">
                              {item.reject_reason}
                            </AppText>
                          ) : null}
                        </View>
                      ))
                    )}
                    {detail.media.some((item) => item.status === 'approved' || item.status === 'published') ? (
                      <Button
                        label="Görseli kaldır"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        loading={busy}
                        onPress={() => void runAction('remove_media', 'Görsel kaldırıldı.')}
                      />
                    ) : null}
                  </View>

                  {publication ? (
                    <View style={[styles.card, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                      <AppText variant="label" color="textSecondary">
                        Yayın
                      </AppText>
                      <AppText variant="caption" color="textSecondary">
                        {publication.retracted_at ? 'Geri çekildi' : 'Yayında'} · {publication.mode} ·{' '}
                        {formatDateTimeTr(publication.published_at)}
                      </AppText>
                      {publication.retract_reason ? (
                        <AppText variant="caption" color="danger">
                          {publication.retract_reason}
                        </AppText>
                      ) : null}
                      {isPublished ? (
                        <Button
                          label="Yayından kaldır"
                          size="sm"
                          variant="danger"
                          fullWidth={false}
                          loading={busy}
                          onPress={() => setReasonAction('retract')}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            )}

            {detail && event ? (
              <View style={[styles.footer, { borderColor: theme.colors.divider }]}>
                <Button label="Kapat" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
                <View style={styles.flex} />
                <Button
                  label="Reddet"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  disabled={busy}
                  onPress={() => setReasonAction('reject')}
                />
                <Button
                  label="Ertele"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  disabled={busy}
                  onPress={() => void runAction('defer', 'Haber daha sonra incelenmek üzere ertelendi.')}
                />
                <Button
                  label="Arşivle"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  disabled={busy}
                  onPress={() => setReasonAction('archive')}
                />
                {highRiskEvent ? (
                  <Button
                    label="Hukuki onayla yayımla"
                    size="sm"
                    variant="danger"
                    fullWidth={false}
                    disabled={busy}
                    onPress={() => setReasonAction('high_risk')}
                  />
                ) : (
                  <>
                    <Button
                      label="Düzenleyerek yayımla"
                      size="sm"
                      variant="secondary"
                      fullWidth={false}
                      loading={busy}
                      onPress={() => void runAction('edit_approve', 'Haber düzenlenerek yayımlandı.')}
                    />
                    <Button
                      label="Onayla ve yayımla"
                      size="sm"
                      variant="primary"
                      fullWidth={false}
                      loading={busy}
                      onPress={() => void runAction('approve', 'Haber yayımlandı.')}
                    />
                  </>
                )}
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <ReasonDialog
        visible={reasonAction !== null}
        title={
          reasonAction === 'high_risk'
            ? 'Yüksek riskli haberi yayımla'
            : reasonAction === 'retract'
              ? 'Haberi yayından kaldır'
              : reasonAction === 'archive'
                ? 'Haberi arşivle'
                : 'Haberi reddet'
        }
        description={
          reasonAction === 'high_risk'
            ? 'Hukuki/editoryal denetimin tamamlandığını ve yayının sorumluluğunu kabul ettiğini en az 10 karakterle açıkla. Bu işlem audit log’a yazılır.'
            : 'Gerekçe denetim kaydına yazılır ve kullanıcıya gösterilmez.'
        }
        confirmLabel={reasonAction === 'high_risk' ? 'Denetim tamam, yayımla' : 'Onayla'}
        destructive={reasonAction === 'retract' || reasonAction === 'reject' || reasonAction === 'high_risk'}
        requireReason
        loading={busy}
        onCancel={() => setReasonAction(null)}
        onConfirm={(input) => void confirmReason(input)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  sheet: { width: '100%', height: '94%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  close: { padding: 6 },
  scroll: { flex: 1 },
  content: { flexDirection: 'row', gap: 16, padding: 16, alignItems: 'flex-start' },
  contentCompact: { flexDirection: 'column' },
  mainColumn: { flex: 1, gap: 12, minWidth: 0 },
  sideColumn: { width: 340, gap: 12 },
  sideColumnCompact: { width: '100%' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 9 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 11 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  twoCol: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  flex: { flex: 1 },
  stack: { gap: 5, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(120,130,150,0.18)' },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 5 },
  suggestion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 8 },
  spotInput: { minHeight: 92 },
  bodyInput: { minHeight: 340 },
  smallInput: { minHeight: 72 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
