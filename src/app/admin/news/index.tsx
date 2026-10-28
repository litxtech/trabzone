import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { NewsReviewModal } from '@/features/admin/components/news/NewsReviewModal';
import {
  useAdminNewsCosts,
  useAdminNewsDiagnostics,
  useAdminNewsErrors,
  useAdminNewsOverview,
  useAdminNewsPublisherBind,
  useAdminNewsReview,
  useAdminNewsReviewDetail,
  useAdminNewsRunNow,
  useAdminNewsRuns,
  useAdminNewsSettings,
  useAdminNewsSettingsSave,
  useAdminNewsSourceToggle,
  useAdminNewsSources,
} from '@/features/admin/hooks/use-admin-news';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import type {
  NewsQueueState,
  NewsReviewItem,
  NewsRun,
  NewsSettings,
  NewsSettingsProgress,
  NewsSource,
  NewsSourceKind,
} from '@/features/news/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

type Tab = 'panel' | 'review' | 'settings' | 'sources' | 'costs';

const TABS: { key: Tab; label: string; icon: ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'panel', label: 'Kontrol Paneli', icon: 'grid-outline' },
  { key: 'review', label: 'Haber İnceleme', icon: 'shield-checkmark-outline' },
  { key: 'settings', label: 'Otomasyon Ayarları', icon: 'options-outline' },
  { key: 'sources', label: 'Kaynak ve Lisans', icon: 'library-outline' },
  { key: 'costs', label: 'Maliyet ve Günlük', icon: 'analytics-outline' },
];

const number = new Intl.NumberFormat('tr-TR');

function usd(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `$${Number(value).toFixed(digits)}`;
}

function riskTone(risk: string): 'success' | 'warning' | 'danger' {
  if (risk === 'A') return 'success';
  if (risk === 'B') return 'warning';
  return 'danger';
}

const REASON_LABELS: Record<string, string> = {
  high_risk: 'Yüksek risk',
  insufficient_independent_sources: 'Bağımsız kaynak az',
  verification_failed: 'Doğrulama geçmedi',
  source_conflict: 'Kaynak çelişkisi',
  event_date_missing: 'Tarih yok',
  media_missing: 'Görsel yok',
  media_placeholder: 'Kategori görseli',
  quality_too_low: 'Kalite düşük',
  trabzon_link_missing: 'Trabzon bağlantısı kanıtsız',
  quota_exhausted: 'Kota dolu',
  publish_deferred: 'Yayın penceresi dışı',
  auto_publish_disabled: 'Otomatik yayın kapalı',
};

type SettingsForm = {
  enabled: boolean;
  auto_publish_enabled: boolean;
  dry_run: boolean;
  notify_enabled: boolean;
  publisher_username: string;
  fast_model: string;
  reasoning_model: string;
  scan_interval_minutes: string;
  daily_auto_limit: string;
  max_events_per_run: string;
  max_searches_per_run: string;
  max_article_age_hours: string;
  min_quality_score: string;
  duplicate_title_threshold: string;
  min_media_match: string;
  publish_window_start: string;
  publish_window_end: string;
  auto_min_gap_minutes: string;
  daily_budget_usd: string;
  monthly_budget_usd: string;
  notify_daily_cap: string;
  notify_quiet_start: string;
  notify_quiet_end: string;
};

function formFromSettings(settings: NewsSettings): SettingsForm {
  return {
    enabled: settings.enabled,
    auto_publish_enabled: settings.auto_publish_enabled,
    dry_run: settings.dry_run,
    notify_enabled: settings.notify_enabled,
    publisher_username: settings.publisher_username,
    fast_model: settings.fast_model,
    reasoning_model: settings.reasoning_model,
    scan_interval_minutes: String(settings.scan_interval_minutes),
    daily_auto_limit: String(settings.daily_auto_limit),
    max_events_per_run: String(settings.max_events_per_run),
    max_searches_per_run: String(settings.max_searches_per_run),
    max_article_age_hours: String(settings.max_article_age_hours),
    min_quality_score: String(settings.min_quality_score),
    duplicate_title_threshold: String(settings.duplicate_title_threshold),
    min_media_match: String(settings.min_media_match),
    publish_window_start: String(settings.publish_window_start),
    publish_window_end: String(settings.publish_window_end),
    auto_min_gap_minutes: String(settings.auto_min_gap_minutes),
    daily_budget_usd: String(settings.daily_budget_usd),
    monthly_budget_usd: String(settings.monthly_budget_usd),
    notify_daily_cap: String(settings.notify_daily_cap),
    notify_quiet_start: String(settings.notify_quiet_start),
    notify_quiet_end: String(settings.notify_quiet_end),
  };
}

function intValue(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decimalValue(value: string, fallback: number): number {
  const parsed = Number(value.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPayload(form: SettingsForm, settings: NewsSettings): NewsSettingsProgress {
  return {
    enabled: form.enabled,
    auto_publish_enabled: form.auto_publish_enabled,
    dry_run: form.dry_run,
    notify_enabled: form.notify_enabled,
    publisher_username: form.publisher_username.trim() || 'trabzonehaber',
    fast_model: form.fast_model.trim() || settings.fast_model,
    reasoning_model: form.reasoning_model.trim() || settings.reasoning_model,
    scan_interval_minutes: intValue(form.scan_interval_minutes, settings.scan_interval_minutes),
    daily_auto_limit: intValue(form.daily_auto_limit, settings.daily_auto_limit),
    max_events_per_run: intValue(form.max_events_per_run, settings.max_events_per_run),
    max_searches_per_run: intValue(form.max_searches_per_run, settings.max_searches_per_run),
    max_article_age_hours: intValue(form.max_article_age_hours, settings.max_article_age_hours),
    min_quality_score: decimalValue(form.min_quality_score, settings.min_quality_score),
    duplicate_title_threshold: decimalValue(
      form.duplicate_title_threshold,
      settings.duplicate_title_threshold,
    ),
    min_media_match: decimalValue(form.min_media_match, settings.min_media_match),
    publish_window_start: intValue(form.publish_window_start, settings.publish_window_start),
    publish_window_end: intValue(form.publish_window_end, settings.publish_window_end),
    auto_min_gap_minutes: intValue(form.auto_min_gap_minutes, settings.auto_min_gap_minutes),
    daily_budget_usd: decimalValue(form.daily_budget_usd, settings.daily_budget_usd),
    monthly_budget_usd: decimalValue(form.monthly_budget_usd, settings.monthly_budget_usd),
    notify_daily_cap: intValue(form.notify_daily_cap, settings.notify_daily_cap),
    notify_quiet_start: intValue(form.notify_quiet_start, settings.notify_quiet_start),
    notify_quiet_end: intValue(form.notify_quiet_end, settings.notify_quiet_end),
  };
}

export default function AdminNewsScreen() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const toast = useAdminToast();
  const me = useAdminMe();
  const canManage = (me.data?.permissions ?? []).includes('news.manage');

  const [tab, setTab] = useState<Tab>('panel');
  const [reviewState, setReviewState] = useState<NewsQueueState>('pending');
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [selected, setSelected] = useState<NewsReviewItem | null>(null);
  const [confirmAction, setConfirmAction] = useState<'run' | 'diagnostics' | 'bind' | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | NewsSourceKind>('all');

  const overview = useAdminNewsOverview();
  const runs = useAdminNewsRuns(12);
  const settings = useAdminNewsSettings();
  const review = useAdminNewsReview(reviewState, limit, offset);
  const detail = useAdminNewsReviewDetail(selected?.event_id ?? null);
  const sources = useAdminNewsSources();
  const costs = useAdminNewsCosts();
  const errors = useAdminNewsErrors(20);

  const runNow = useAdminNewsRunNow();
  const saveSettings = useAdminNewsSettingsSave();
  const diagnostics = useAdminNewsDiagnostics();
  const bindPublisher = useAdminNewsPublisherBind();
  const toggleSource = useAdminNewsSourceToggle();

  useEffect(() => {
    if (settings.data && !form) {
      setForm(formFromSettings(settings.data));
    }
  }, [settings.data, form]);

  const stats = overview.data;
  const filteredSources = useMemo(() => {
    const items = sources.data?.items ?? [];
    return sourceFilter === 'all' ? items : items.filter((item) => item.kind === sourceFilter);
  }, [sources.data, sourceFilter]);

  const runSelected = async () => {
    try {
      await runNow.mutateAsync();
      toast.success('Tarama tetiklendi. Sonuçlar birkaç dakika içinde güncellenir.');
      setConfirmAction(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tarama başlatılamadı.');
    }
  };

  const runDiagnostics = async () => {
    try {
      await diagnostics.mutateAsync();
      toast.success('DeepSeek bağlantı tanılaması tamamlandı.');
      setConfirmAction(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tanılama çalıştırılamadı.');
    }
  };

  const bind = async () => {
    if (!form) return;
    try {
      await bindPublisher.mutateAsync(form.publisher_username);
      toast.success('Trabzone Haber yayıncı hesabı bağlandı.');
      setConfirmAction(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Yayıncı bağlanamadı.');
    }
  };

  const save = async () => {
    if (!form || !settings.data) return;
    try {
      await saveSettings.mutateAsync({ payload: toPayload(form, settings.data) });
      toast.success('Otomasyon ayarları kaydedildi.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ayarlar kaydedilemedi.');
    }
  };

  const toggle = async (source: NewsSource) => {
    try {
      await toggleSource.mutateAsync({ id: source.id, active: !source.active });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kaynak güncellenemedi.');
    }
  };

  return (
    <AdminPage
      title="AI Haber Merkezi"
      subtitle="DeepSeek destekli Trabzon haber araştırması, doğrulama, lisanslı görsel ve otomatik yayın."
      refreshing={
        overview.isRefetching || review.isRefetching || settings.isRefetching || sources.isRefetching
      }
      onRefresh={() => {
        void overview.refetch();
        void review.refetch();
        void settings.refetch();
        void sources.refetch();
        void costs.refetch();
      }}
      actions={
        <>
          <Button
            label="Şimdi çalıştır"
            size="sm"
            fullWidth={false}
            leftIcon={<Ionicons name="play" size={14} color="#fff" />}
            loading={runNow.isPending}
            disabled={!canManage}
            onPress={() => setConfirmAction('run')}
          />
          <Button
            label="Tanıla"
            size="sm"
            variant="secondary"
            fullWidth={false}
            leftIcon={<Ionicons name="pulse" size={14} color={theme.colors.text} />}
            loading={diagnostics.isPending}
            disabled={!canManage}
            onPress={() => setConfirmAction('diagnostics')}
          />
        </>
      }
    >
      <FilterChips
        options={TABS.map((item) => ({ key: item.key, label: item.label }))}
        value={tab}
        onChange={(next) => setTab(next)}
      />

      {tab === 'panel' ? (
        <View style={styles.stack}>
          <StatGrid>
            <StatCard label="Bugün bulunan sonuç" value={number.format(stats?.counts.found_today ?? 0)} icon="search-outline" hint="Taranan ve kaydedilen kaynak" />
            <StatCard label="Bugün doğrulanan olay" value={number.format(stats?.counts.verified_today ?? 0)} icon="shield-checkmark-outline" tone="success" />
            <StatCard label="Bugün otomatik yayımlanan" value={number.format(stats?.counts.published_today ?? 0)} icon="newspaper-outline" tone="accent" hint={`Manuel dahil: ${number.format(stats?.counts.published_today_all ?? 0)}`} />
            <StatCard label="Kalan otomatik kota" value={`${number.format(stats?.quota.remaining ?? 0)} / ${number.format(stats?.quota.auto_limit ?? 12)}`} icon="speedometer-outline" tone="warning" hint="Europe/Istanbul 00:00'da sıfırlanır" />
            <StatCard label="İnceleme bekleyen" value={number.format(stats?.counts.pending_review ?? 0)} icon="mail-unread-outline" tone="warning" />
            <StatCard label="Görseli eksik" value={number.format(stats?.counts.media_missing ?? 0)} icon="image-outline" />
            <StatCard label="Bugünkü maliyet" value={usd(stats?.costs.today_usd)} icon="card-outline" hint={`Aylık: ${usd(stats?.costs.month_usd, 2)}`} />
            <StatCard label="Hata (24 saat)" value={number.format(stats?.counts.errors_24h ?? 0)} icon="warning-outline" tone={(stats?.counts.errors_24h ?? 0) > 0 ? 'danger' : 'success'} />
          </StatGrid>

          <AdminSection
            title="Otomasyon durumu"
            subtitle="Sunucu tarafı pg_cron + Supabase Edge Function; panel kapalıyken de çalışır."
            action={<Badge label={stats?.enabled ? 'Aktif' : 'Kapalı'} tone={stats?.enabled ? 'success' : 'neutral'} />}
          >
            <View style={styles.infoGrid}>
              <InfoRow label="Otomatik yayın" value={stats?.auto_publish_enabled ? 'Açık' : 'Kapalı'} tone={stats?.auto_publish_enabled ? 'success' : 'neutral'} />
              <InfoRow label="Deneme modu" value={stats?.dry_run ? 'Açık (yayın yok)' : 'Kapalı'} tone={stats?.dry_run ? 'warning' : 'neutral'} />
              <InfoRow label="Tarama periyodu" value={`${stats?.scan_interval_minutes ?? 15} dakika`} />
              <InfoRow label="Son tarama" value={stats?.last_run ? formatDateTimeTr(stats.last_run.started_at) : 'Henüz yok'} />
              <InfoRow label="Sonraki tarama" value={stats?.next_run_at ? formatDateTimeTr(stats.next_run_at) : 'Çalışıyor'} />
              <InfoRow label="Yayıncı" value={stats?.publisher ? `${stats.publisher.display_name ?? stats.publisher.username} (@${stats.publisher.username})` : 'Bağlı değil'} tone={stats?.publisher ? 'success' : 'danger'} />
              <InfoRow label="Günlük bütçe" value={`${usd(stats?.budget.today_usd)} / ${usd(stats?.budget.daily_limit_usd, 2)}`} tone={stats?.budget.daily_exhausted ? 'danger' : 'neutral'} />
              <InfoRow label="Aylık bütçe" value={`${usd(stats?.budget.month_usd, 2)} / ${usd(stats?.budget.monthly_limit_usd, 2)}`} tone={stats?.budget.monthly_exhausted ? 'danger' : 'neutral'} />
            </View>
            {stats?.budget.exhausted ? (
              <View style={[styles.alert, { backgroundColor: theme.colors.dangerSoft }]}>
                <AppText variant="caption" color="danger">
                  Bütçe sınırı doldu; ücretli DeepSeek çağrıları durduruldu. Ayarlardan bütçeyi artırmadan otomasyon devam etmez.
                </AppText>
              </View>
            ) : null}
          </AdminSection>

          <AdminSection
            title="DeepSeek bağlantısı"
            subtitle="Anahtar yalnızca sunucuda tutulur; panelde açık metin gösterilmez."
            action={
              <Badge
                label={stats?.diagnostics?.chat_ok ? 'Bağlantı sağlıklı' : 'Tanılama gerekli'}
                tone={stats?.diagnostics?.chat_ok ? 'success' : 'warning'}
              />
            }
          >
            <View style={styles.infoGrid}>
              <InfoRow label="Sohbet modeli" value={stats?.diagnostics?.chat_ok ? 'Çalışıyor' : 'Bilinmiyor'} tone={stats?.diagnostics?.chat_ok ? 'success' : 'neutral'} />
              <InfoRow label="Web arama" value={stats?.diagnostics?.search_ok ? 'Çalışıyor' : 'Bilinmiyor'} tone={stats?.diagnostics?.search_ok ? 'success' : 'neutral'} />
              <InfoRow label="Sayfa getirme" value={stats?.diagnostics?.fetch_ok ? 'Çalışıyor' : 'Bilinmiyor'} tone={stats?.diagnostics?.fetch_ok ? 'success' : 'neutral'} />
              <InfoRow label="Kredi" value={stats?.diagnostics?.balance?.total_balance ? `${stats.diagnostics.balance.total_balance} ${stats.diagnostics.balance.currency ?? ''}` : '—'} />
              <InfoRow label="Son kontrol" value={stats?.diagnostics?.checked_at ? formatDateTimeTr(stats.diagnostics.checked_at) : 'Yapılmadı'} />
              <InfoRow label="Modeller" value={(stats?.diagnostics?.models ?? []).slice(0, 3).join(', ') || '—'} />
            </View>
            {stats?.diagnostics?.search_error ? (
              <AppText variant="caption" color="danger">
                Arama: {stats.diagnostics.search_error}
              </AppText>
            ) : null}
            {stats?.diagnostics?.fetch_error ? (
              <AppText variant="caption" color="danger">
                Fetch: {stats.diagnostics.fetch_error}
              </AppText>
            ) : null}
          </AdminSection>

          <AdminSection title="Son çalışmalar" subtitle={`${runs.data?.items.length ?? 0} kayıt`}>
            {(runs.data?.items ?? []).slice(0, 6).map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
            {!runs.data?.items.length ? (
              <AppText variant="caption" color="textTertiary">
                Henüz çalışma kaydı yok.
              </AppText>
            ) : null}
          </AdminSection>

          {(errors.data?.items ?? []).length ? (
            <AdminSection title="Son hatalar" subtitle="Ücretli çağrılar durdurulmaz; hata kaydı incelenmeli">
              {errors.data!.items.slice(0, 5).map((item) => (
                <View key={item.id} style={[styles.rowCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                  <Badge label={item.stage} tone="danger" />
                  <View style={styles.flex}>
                    <AppText variant="caption" numberOfLines={2}>
                      {item.code}: {item.message}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {formatDateTimeTr(item.created_at)}
                    </AppText>
                  </View>
                </View>
              ))}
            </AdminSection>
          ) : null}
        </View>
      ) : null}

      {tab === 'review' ? (
        <View style={styles.stack}>
          <FilterChips
            options={[
              { key: 'pending', label: 'Bekleyen' },
              { key: 'approved', label: 'Onaylanan' },
              { key: 'rejected', label: 'Reddedilen' },
              { key: 'deferred', label: 'Ertelenen' },
              { key: 'archived', label: 'Arşiv' },
              { key: 'all', label: 'Tümü' },
            ]}
            value={reviewState}
            onChange={(next) => {
              setReviewState(next);
              setOffset(0);
            }}
          />
          <AdminSection
            title="Manuel inceleme kuyruğu"
            subtitle="Risk B ve C haberler otomatik yayımlanmaz; kaynak ve lisans burada denetlenir."
            action={<Badge label={`${number.format(review.data?.total ?? 0)} kayıt`} tone="neutral" />}
          >
            {(review.data?.items ?? []).length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Bu filtrede haber yok.
              </AppText>
            ) : (
              <View style={styles.listGap}>
                {review.data!.items.map((item) => (
                  <Pressable
                    key={item.queue_id}
                    accessibilityRole="button"
                    onPress={() => setSelected(item)}
                    style={[
                      styles.rowCard,
                      {
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surface,
                        borderRadius: theme.radius.md,
                      },
                    ]}
                  >
                    <View style={styles.flex}>
                      <View style={styles.chips}>
                        <Badge label={`Risk ${item.risk_level}`} tone={riskTone(item.risk_level)} />
                        <Badge label={item.category_name ?? 'Kategori yok'} tone="neutral" />
                        {item.district ? <Badge label={item.district} tone="neutral" /> : null}
                        {item.media_placeholder ? <Badge label="Kategori görseli" tone="warning" /> : null}
                        {item.published_post_id ? <Badge label="Yayında" tone="success" /> : null}
                      </View>
                      <AppText variant="title" numberOfLines={2}>
                        {item.title}
                      </AppText>
                      <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                        {item.spot || 'Spot yok'}
                      </AppText>
                      <View style={styles.chips}>
                        {(item.reasons ?? []).slice(0, 4).map((reason) => (
                          <Badge key={reason} label={REASON_LABELS[reason] ?? reason} tone="warning" />
                        ))}
                      </View>
                      <AppText variant="caption" color="textTertiary">
                        Bağımsız kaynak: {item.independent_sources} · Kalite:{' '}
                        {item.quality_score != null ? `${Math.round(item.quality_score * 100)}%` : '—'} ·{' '}
                        {formatDateTimeTr(item.created_at)}
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
                  </Pressable>
                ))}
              </View>
            )}
            <Pager total={review.data?.total ?? 0} limit={limit} offset={offset} onChange={setOffset} />
          </AdminSection>
        </View>
      ) : null}

      {tab === 'settings' ? (
        <View style={styles.stack}>
          {!form || !settings.data ? (
            <AdminSection title="Otomasyon ayarları" subtitle="Yükleniyor…">
              <AppText variant="caption" color="textTertiary">
                Ayarlar getiriliyor.
              </AppText>
            </AdminSection>
          ) : (
            <>
              <AdminSection
                title="Çalışma modu"
                subtitle="Varsayılan: 15 dakikada bir, günde en fazla 12 otomatik haber."
                action={
                  <Button
                    label="Kaydet"
                    size="sm"
                    fullWidth={false}
                    loading={saveSettings.isPending}
                    disabled={!canManage}
                    onPress={() => void save()}
                  />
                }
              >
                <ToggleRow
                  label="Otomasyonu aç"
                  hint="Kapalıyken cron yeni tarama başlatmaz."
                  value={form.enabled}
                  onChange={(next) => setForm({ ...form, enabled: next })}
                />
                <ToggleRow
                  label="Otomatik yayın"
                  hint="Yalnızca risk A + tüm doğrulama koşulları geçerse yayımlanır."
                  value={form.auto_publish_enabled}
                  onChange={(next) => setForm({ ...form, auto_publish_enabled: next })}
                />
                <ToggleRow
                  label="Deneme modu (dry run)"
                  hint="Açıkken içerik hazırlanır ama sosyal gönderi oluşturulmaz."
                  value={form.dry_run}
                  onChange={(next) => setForm({ ...form, dry_run: next })}
                />
                <ToggleRow
                  label="Takipçi bildirimleri"
                  hint="Sıklık ve sessiz saat kurallarına uyar."
                  value={form.notify_enabled}
                  onChange={(next) => setForm({ ...form, notify_enabled: next })}
                />
                <View style={[styles.alert, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <AppText variant="caption" color="textTertiary">
                    Risk C haberler hiçbir ayarla otomatik yayımlanmaz. Bu eşik sunucuda sabittir.
                  </AppText>
                </View>
              </AdminSection>

              <AdminSection title="Tarama ve yayın kuralları" subtitle="Sayısal sınırlar sunucuda doğrulanır">
                <View style={styles.formGrid}>
                  <FormField label="Tarama periyodu (dk)" value={form.scan_interval_minutes} onChange={(value) => setForm({ ...form, scan_interval_minutes: value })} />
                  <FormField label="Günlük otomatik limit" value={form.daily_auto_limit} onChange={(value) => setForm({ ...form, daily_auto_limit: value })} />
                  <FormField label="Tur başına en fazla olay" value={form.max_events_per_run} onChange={(value) => setForm({ ...form, max_events_per_run: value })} />
                  <FormField label="Tur başına arama" value={form.max_searches_per_run} onChange={(value) => setForm({ ...form, max_searches_per_run: value })} />
                  <FormField label="Maksimum haber yaşı (saat)" value={form.max_article_age_hours} onChange={(value) => setForm({ ...form, max_article_age_hours: value })} />
                  <FormField label="Min. kalite (0-1)" value={form.min_quality_score} onChange={(value) => setForm({ ...form, min_quality_score: value })} />
                  <FormField label="Tekrar eşiği (0-1)" value={form.duplicate_title_threshold} onChange={(value) => setForm({ ...form, duplicate_title_threshold: value })} />
                  <FormField label="Min. görsel eşleşmesi (0-1)" value={form.min_media_match} onChange={(value) => setForm({ ...form, min_media_match: value })} />
                  <FormField label="Yayın penceresi başlangıç (0-23)" value={form.publish_window_start} onChange={(value) => setForm({ ...form, publish_window_start: value })} />
                  <FormField label="Yayın penceresi bitiş (0-23)" value={form.publish_window_end} onChange={(value) => setForm({ ...form, publish_window_end: value })} />
                  <FormField label="Otomatik yayın arası (dk)" value={form.auto_min_gap_minutes} onChange={(value) => setForm({ ...form, auto_min_gap_minutes: value })} />
                  <FormField label="Bildirim günlük üst sınır" value={form.notify_daily_cap} onChange={(value) => setForm({ ...form, notify_daily_cap: value })} />
                  <FormField label="Sessiz saat başlangıç" value={form.notify_quiet_start} onChange={(value) => setForm({ ...form, notify_quiet_start: value })} />
                  <FormField label="Sessiz saat bitiş" value={form.notify_quiet_end} onChange={(value) => setForm({ ...form, notify_quiet_end: value })} />
                  <FormField label="Günlük DeepSeek bütçesi ($)" value={form.daily_budget_usd} onChange={(value) => setForm({ ...form, daily_budget_usd: value })} />
                  <FormField label="Aylık DeepSeek bütçesi ($)" value={form.monthly_budget_usd} onChange={(value) => setForm({ ...form, monthly_budget_usd: value })} />
                </View>
              </AdminSection>

              <AdminSection title="Derin model ve yayıncı" subtitle="API anahtarı panelde tutulmaz">
                <View style={styles.formGrid}>
                  <FormField label="Hızlı model" value={form.fast_model} onChange={(value) => setForm({ ...form, fast_model: value })} />
                  <FormField label="Doğrulama / yazım modeli" value={form.reasoning_model} onChange={(value) => setForm({ ...form, reasoning_model: value })} />
                  <FormField label="Yayıncı kullanıcı adı" value={form.publisher_username} onChange={(value) => setForm({ ...form, publisher_username: value })} />
                </View>
                <View style={styles.chips}>
                  <Button
                    label="Yayıncıyı doğrula ve bağla"
                    size="sm"
                    variant="secondary"
                    fullWidth={false}
                    disabled={!canManage}
                    onPress={() => setConfirmAction('bind')}
                  />
                  <Button
                    label="Ayarları kaydet"
                    size="sm"
                    fullWidth={false}
                    loading={saveSettings.isPending}
                    disabled={!canManage}
                    onPress={() => void save()}
                  />
                </View>
                <AppText variant="caption" color="textTertiary">
                  Son kayıt: {settings.data.last_tick_at ? formatDateTimeTr(settings.data.last_tick_at) : '—'} · Sonraki: {settings.data.next_run_at ? formatDateTimeTr(settings.data.next_run_at) : '—'}
                </AppText>
              </AdminSection>
            </>
          )}
        </View>
      ) : null}

      {tab === 'sources' ? (
        <View style={styles.stack}>
          <AdminSection
            title="Kaynak güvenilirliği"
            subtitle="Resmî kaynaklar birincil; iki sitenin aynı ajans metni bağımsız doğrulama sayılmaz."
            action={<Badge label={`${number.format(sources.data?.items.length ?? 0)} kaynak`} tone="neutral" />}
          >
            <FilterChips
              options={[
                { key: 'all', label: 'Tümü' },
                { key: 'official', label: 'Resmî' },
                { key: 'trusted_media', label: 'Güvenilir medya' },
                { key: 'low_trust', label: 'Düşük güven' },
                { key: 'unknown', label: 'Belirsiz' },
              ] as { key: 'all' | NewsSourceKind; label: string }[]}
              value={sourceFilter}
              onChange={(next) => setSourceFilter(next)}
            />
            <View style={styles.listGap}>
              {filteredSources.map((source) => (
                <View
                  key={source.id}
                  style={[styles.rowCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
                >
                  <View style={styles.flex}>
                    <View style={styles.chips}>
                      <Badge
                        label={source.kind === 'official' ? 'Resmî' : source.kind === 'trusted_media' ? 'Medya' : source.kind}
                        tone={source.kind === 'official' ? 'success' : source.kind === 'trusted_media' ? 'neutral' : 'warning'}
                      />
                      <Badge label={source.active ? 'Aktif' : 'Pasif'} tone={source.active ? 'success' : 'neutral'} />
                      <Badge label={`Güven ${Math.round(source.reliability * 100)}%`} tone="neutral" />
                    </View>
                    <AppText variant="label">{source.name}</AppText>
                    <AppText variant="caption" color="textTertiary">
                      {source.domain}
                      {source.media_license_code ? ` · lisans: ${source.media_license_code}` : ' · medya lisansı tanımsız'}
                      {source.feed_url ? ' · RSS/API tanımlı' : ''}
                    </AppText>
                    {source.notes_tr ? (
                      <AppText variant="caption" color="textSecondary">
                        {source.notes_tr}
                      </AppText>
                    ) : null}
                    {source.last_error ? (
                      <AppText variant="caption" color="danger">
                        Son hata: {source.last_error}
                      </AppText>
                    ) : null}
                  </View>
                  <Button
                    label={source.active ? 'Devre dışı' : 'Etkinleştir'}
                    size="sm"
                    variant={source.active ? 'outline' : 'secondary'}
                    fullWidth={false}
                    disabled={!canManage}
                    onPress={() => void toggle(source)}
                  />
                </View>
              ))}
            </View>
          </AdminSection>

          <AdminSection title="Medya lisans kütüphanesi" subtitle="Lisanssız görseller otomatik kabul edilmez">
            <View style={styles.listGap}>
              {(sources.data?.licenses ?? []).map((license) => (
                <View
                  key={license.code}
                  style={[styles.rowCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
                >
                  <View style={styles.flex}>
                    <View style={styles.chips}>
                      <Badge label={license.code} tone="accent" />
                      <Badge label={license.is_usable ? 'Kullanılabilir' : 'Kullanılamaz'} tone={license.is_usable ? 'success' : 'danger'} />
                      {license.commercial_use ? <Badge label="Ticari" tone="neutral" /> : null}
                      {license.attribution_required ? <Badge label="Atıf gerekli" tone="warning" /> : null}
                    </View>
                    <AppText variant="label">{license.name_tr}</AppText>
                    <AppText variant="caption" color="textSecondary">
                      {license.notes_tr || 'Not yok'}
                    </AppText>
                    {license.license_url ? (
                      <AppText variant="caption" color="textTertiary">
                        {license.license_url}
                      </AppText>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </AdminSection>

          <AdminSection
            title="Son kullanılan görseller"
            subtitle="Hangi görsel, hangi haberde, hangi lisansla kullanıldı?"
          >
            {(sources.data?.assets ?? []).length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Henüz görsel kaydı yok.
              </AppText>
            ) : (
              <View style={styles.listGap}>
                {(sources.data?.assets ?? []).slice(0, 12).map((asset) => (
                  <View
                    key={asset.id}
                    style={[styles.rowCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
                  >
                    <View style={styles.flex}>
                      <View style={styles.chips}>
                        <Badge
                          label={asset.is_placeholder ? 'Kategori tasarımı' : 'Gerçek fotoğraf'}
                          tone={asset.is_placeholder ? 'warning' : 'success'}
                        />
                        <Badge label={asset.license_code} tone={asset.removed_at ? 'danger' : 'neutral'} />
                        {asset.event_match_score != null ? (
                          <Badge label={`Eşleşme ${Number(asset.event_match_score).toFixed(2)}`} tone="neutral" />
                        ) : null}
                      </View>
                      <AppText variant="label" numberOfLines={2}>
                        {asset.event_title || 'Haber başlığı yok'}
                      </AppText>
                      <AppText variant="caption" color="textSecondary">
                        {asset.credit || asset.creator || 'Kredi bilgisi yok'}
                      </AppText>
                      {asset.license_reference ? (
                        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                          Lisans: {asset.license_reference}
                        </AppText>
                      ) : null}
                      {asset.removed_at ? (
                        <AppText variant="caption" color="danger">
                          Kaldırıldı: {asset.removal_reason || 'gerekçe yok'}
                        </AppText>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </AdminSection>
        </View>
      ) : null}

      {tab === 'costs' ? (
        <View style={styles.stack}>
          <StatGrid>
            <StatCard label="Bugünkü maliyet" value={usd(costs.data?.today.cost_usd)} icon="card-outline" hint="Gerçek token/kullanım tahmini" />
            <StatCard label="Aylık maliyet" value={usd(costs.data?.month.cost_usd, 2)} icon="calendar-outline" />
            <StatCard label="Haber başına" value={usd(costs.data?.cost_per_post_usd ?? null, 4)} icon="newspaper-outline" tone="accent" hint={`${number.format(costs.data?.published_month ?? 0)} yayın`} />
            <StatCard label="Bugün arama / fetch" value={`${number.format(costs.data?.today.search_calls ?? 0)} / ${number.format(costs.data?.today.fetch_calls ?? 0)}`} icon="search-outline" />
            <StatCard label="Model çağrısı (bugün)" value={number.format(costs.data?.today.model_calls ?? 0)} icon="sparkles-outline" />
            <StatCard label="Token (giriş/çıkış)" value={`${number.format(costs.data?.today.tokens_in ?? 0)} / ${number.format(costs.data?.today.tokens_out ?? 0)}`} icon="code-outline" />
          </StatGrid>

          <AdminSection title="Maliyet notu" subtitle="Fatura tutarı değil, ayarlardaki birim fiyatla hesaplanan tahmindir">
            <AppText variant="caption" color="textSecondary">
              {costs.data?.note ?? 'Maliyet verisi yükleniyor.'}
            </AppText>
            <View style={styles.infoGrid}>
              <InfoRow label="Günlük bütçe" value={`${usd(costs.data?.budget.today_usd)} / ${usd(costs.data?.budget.daily_limit_usd, 2)}`} tone={costs.data?.budget.daily_exhausted ? 'danger' : 'neutral'} />
              <InfoRow label="Aylık bütçe" value={`${usd(costs.data?.budget.month_usd, 2)} / ${usd(costs.data?.budget.monthly_limit_usd, 2)}`} tone={costs.data?.budget.monthly_exhausted ? 'danger' : 'neutral'} />
              <InfoRow label="Bütçe durumu" value={costs.data?.budget.exhausted ? 'Durduruldu' : 'Uygun'} tone={costs.data?.budget.exhausted ? 'danger' : 'success'} />
            </View>
          </AdminSection>

          <AdminSection title="Çalışma ve maliyet geçmişi" subtitle="Son 12 tarama">
            {(runs.data?.items ?? []).map((run) => (
              <RunRow key={run.id} run={run} detailed />
            ))}
          </AdminSection>

          <AdminSection title="Hata günlüğü" subtitle="Son 20 kayıt">
            {(errors.data?.items ?? []).length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Hata kaydı yok.
              </AppText>
            ) : (
              errors.data!.items.map((item) => (
                <View key={item.id} style={[styles.rowCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                  <Badge label={item.stage} tone="danger" />
                  <View style={styles.flex}>
                    <AppText variant="caption">
                      {item.code}: {item.message}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {formatDateTimeTr(item.created_at)}
                    </AppText>
                  </View>
                </View>
              ))
            )}
          </AdminSection>
        </View>
      ) : null}

      <NewsReviewModal
        visible={selected !== null}
        eventId={selected?.event_id ?? null}
        detail={detail.data}
        loading={detail.isLoading && selected !== null}
        onClose={() => setSelected(null)}
      />

      <ReasonDialog
        visible={confirmAction !== null}
        title={
          confirmAction === 'run'
            ? 'AI taramasını şimdi başlat'
            : confirmAction === 'diagnostics'
              ? 'DeepSeek tanılaması çalıştır'
              : 'Yayıncı hesabını bağla'
        }
        description={
          confirmAction === 'run'
            ? 'Bu işlem DeepSeek arama, fetch ve model çağrıları yapar; bütçeden harcama düşer. Günlük kota ve kilit kuralları yine uygulanır.'
            : confirmAction === 'diagnostics'
              ? 'Model listesi, web arama, sayfa getirme ve kredi bilgisi canlı olarak sınanır. Küçük bir ücret oluşabilir.'
              : 'Trabzone Haber profili AI yayıncısı olarak bağlanır. İkinci bir profil oluşturulmaz.'
        }
        confirmLabel={confirmAction === 'run' ? 'Taramayı başlat' : confirmAction === 'diagnostics' ? 'Tanılamayı çalıştır' : 'Bağla'}
        requireReason={false}
        loading={runNow.isPending || diagnostics.isPending || bindPublisher.isPending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction === 'run') void runSelected();
          else if (confirmAction === 'diagnostics') void runDiagnostics();
          else if (confirmAction === 'bind') void bind();
        }}
      />

      <View style={styles.footerNote}>
        <Ionicons name="information-circle-outline" size={14} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          {compact ? 'AI haberleri Trabzone Haber hesabında normal sosyal gönderi olarak yayımlanır.' : 'AI haberleri Trabzone Haber hesabında normal sosyal gönderi olarak yayımlanır; kaynaklar, lisans ve son kontrol bilgisi her kartta gösterilir.'}
        </AppText>
      </View>
    </AdminPage>
  );
}

function InfoRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const { theme } = useTheme();
  const color =
    tone === 'success'
      ? theme.colors.success
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'danger'
          ? theme.colors.danger
          : theme.colors.text;
  return (
    <View style={[styles.infoRow, { borderColor: theme.colors.divider }]}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="caption" style={{ color, fontWeight: '700' }} numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.toggleRow, { borderColor: theme.colors.divider }]}>
      <View style={styles.flex}>
        <AppText variant="label">{label}</AppText>
        {hint ? (
          <AppText variant="caption" color="textTertiary">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
        thumbColor={value ? theme.colors.primary : theme.colors.textTertiary}
      />
    </View>
  );
}

function FormField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={onChange}
      keyboardType="numbers-and-punctuation"
      containerStyle={styles.formField}
    />
  );
}

function RunRow({ run, detailed = false }: { run: NewsRun; detailed?: boolean }) {
  const { theme } = useTheme();
  const stats = run.stats ?? {};
  return (
    <View style={[styles.rowCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
      <Badge
        label={run.status}
        tone={
          run.status === 'completed'
            ? 'success'
            : run.status === 'failed'
              ? 'danger'
              : run.status === 'running'
                ? 'warning'
                : 'neutral'
        }
      />
      <View style={styles.flex}>
        <AppText variant="caption">
          {formatDateTimeTr(run.started_at)} · {run.trigger}
          {run.finished_at ? ` · ${formatDateTimeTr(run.finished_at)}` : ''}
        </AppText>
        <AppText variant="caption" color="textTertiary">
          Sonuç {number.format(Number(stats.search_results ?? 0))} · Yeni olay{' '}
          {number.format(Number(stats.events ?? 0))} · Doğrulanan {number.format(Number(stats.verified ?? 0))} ·
          Yayımlanan {number.format(Number(stats.published ?? 0))} · Kuyruk{' '}
          {number.format(Number(stats.queued ?? 0))} · Hata {number.format(Number(stats.errors ?? 0))}
          {detailed ? ` · Arama ${number.format(Number(stats.searches ?? 0))}` : ''}
        </AppText>
        {run.error ? (
          <AppText variant="caption" color="danger" numberOfLines={2}>
            {run.error}
          </AppText>
        ) : null}
      </View>
      <AppText variant="caption" color="textSecondary">
        {usd(run.cost_usd)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  flex: { flex: 1 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoRow: { minWidth: 200, flexGrow: 1, flexBasis: 220, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 3 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 11 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  listGap: { gap: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  formField: { minWidth: 210, flexGrow: 1, flexBasis: 240 },
  footerNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
});
