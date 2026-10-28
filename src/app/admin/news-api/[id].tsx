import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminPage, AdminSection } from '@/features/admin/components/AdminPage';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { NewsCategoryMappingModal } from '@/features/admin/components/news-api/NewsCategoryMappingModal';
import { NewsDeletionModal } from '@/features/admin/components/news-api/NewsDeletionModal';
import { NewsFieldMappingModal } from '@/features/admin/components/news-api/NewsFieldMappingModal';
import { NewsFiltersModal } from '@/features/admin/components/news-api/NewsFiltersModal';
import { NewsItemsPanel } from '@/features/admin/components/news-api/NewsItemsPanel';
import { NewsPermissionsModal } from '@/features/admin/components/news-api/NewsPermissionsModal';
import { NewsProfileModal } from '@/features/admin/components/news-api/NewsProfileModal';
import { NewsSourceForm } from '@/features/admin/components/news-api/NewsSourceForm';
import { NewsTestPanel } from '@/features/admin/components/news-api/NewsTestPanel';
import {
  CONNECTOR_LABELS,
  EmptyHint,
  HealthBadge,
  InfoRow,
  LICENSE_LABELS,
  LicenseBadge,
  MODE_LABELS,
  StatusBadge,
  newsApiStyles,
} from '@/features/admin/components/news-api/shared';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import {
  useNewsApiCatalog,
  useNewsApiConnection,
  useNewsApiDeletionJobs,
  useNewsApiRunRequest,
  useNewsApiSetAutoPublish,
  useNewsApiSetPublishMode,
  useNewsApiSetStatus,
  useNewsApiTest,
} from '@/features/admin/hooks/use-admin-news-api';
import type { NewsConnection } from '@/features/news-api/types';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';
import { useRouter } from '@/utils/router';

type Tab =
  | 'overview'
  | 'connection'
  | 'categories'
  | 'location'
  | 'rules'
  | 'items'
  | 'profile'
  | 'license'
  | 'stats'
  | 'errors'
  | 'deletion';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Genel Bakış' },
  { key: 'connection', label: 'API Bağlantısı' },
  { key: 'categories', label: 'Kategoriler' },
  { key: 'location', label: 'Konum Filtreleri' },
  { key: 'rules', label: 'Yayın Kuralları' },
  { key: 'items', label: 'Haberler' },
  { key: 'profile', label: 'Kaynak Profili' },
  { key: 'license', label: 'Lisans ve İzinler' },
  { key: 'stats', label: 'İstatistikler' },
  { key: 'errors', label: 'Hatalar' },
  { key: 'deletion', label: 'Silme ve Kaldırma' },
];

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: 'discovery', label: 'Yalnızca keşif' },
  { value: 'source_profile', label: 'MOD A · Kaynak profili' },
  { value: 'trabzone_digest', label: 'MOD B · Trabzone derlemesi' },
  { value: 'editor_approval', label: 'MOD C · Editör onaylı' },
];

const numberFormat = new Intl.NumberFormat('tr-TR');

export default function AdminNewsApiDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const toast = useAdminToast();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : null;

  const me = useAdminMe();
  const canManage = (me.data?.permissions ?? []).includes('news.manage');

  const detail = useNewsApiConnection(id);
  const catalog = useNewsApiCatalog();
  const deletionJobs = useNewsApiDeletionJobs(id);
  const setStatus = useNewsApiSetStatus();
  const setAutoPublish = useNewsApiSetAutoPublish();
  const setPublishMode = useNewsApiSetPublishMode();
  const runNow = useNewsApiRunRequest();
  const test = useNewsApiTest();

  const [tab, setTab] = useState<Tab>('overview');
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deletionOpen, setDeletionOpen] = useState(false);

  const connection = detail.data?.connection;
  const stats = connection?.stats;

  const changeStatus = async (status: 'active' | 'paused' | 'disabled') => {
    if (!id) return;
    try {
      await setStatus.mutateAsync({ id, status });
      toast.success(status === 'active' ? 'Kaynak açıldı.' : status === 'paused' ? 'Kaynak duraklatıldı.' : 'Kaynak kapatıldı.');
    } catch (statusError) {
      toast.error(errorMessage(statusError, 'Durum değiştirilemedi.'));
    }
  };

  const toggleAutoPublish = async (enabled: boolean) => {
    if (!id) return;
    try {
      await setAutoPublish.mutateAsync({ id, enabled });
      toast.success(enabled ? 'Otomatik yayın açıldı.' : 'Otomatik yayın kapatıldı.');
    } catch (publishError) {
      toast.error(errorMessage(publishError, 'Otomatik yayın değiştirilemedi.'));
    }
  };

  const changeMode = async (mode: string) => {
    if (!id) return;
    try {
      await setPublishMode.mutateAsync({ id, mode });
      toast.success('Yayın modu güncellendi.');
    } catch (modeError) {
      toast.error(errorMessage(modeError, 'Yayın modu değiştirilemedi. Lisans ve izinleri kontrol et.'));
    }
  };

  const requestRun = async () => {
    if (!id) return;
    try {
      await runNow.mutateAsync(id);
      toast.success('Çekim isteği kuyruğa alındı. Worker bir sonraki turda işleyecek.');
    } catch (runError) {
      toast.error(errorMessage(runError, 'Çekim isteği gönderilemedi.'));
    }
  };

  const testConnection = async () => {
    if (!id) return;
    try {
      const result = await test.mutateAsync({ connectionId: id });
      if (result.ok) toast.success(`Bağlantı başarılı · ${result.item_count} haber döndü.`);
      else toast.error(result.error ?? 'Bağlantı testi başarısız.');
    } catch (testError) {
      toast.error(errorMessage(testError, 'Test isteği gönderilemedi.'));
    }
  };

  if (!id) {
    return (
      <AdminPage title="Kaynak detayı" subtitle="Kaynak kimliği bulunamadı.">
        <EmptyHint text="Geçersiz bağlantı. Kaynak listesine dön." />
      </AdminPage>
    );
  }

  if (detail.isLoading) {
    return (
      <AdminPage title="Kaynak detayı" subtitle="Yükleniyor…">
        <ActivityIndicator />
      </AdminPage>
    );
  }

  if (detail.isError || !connection) {
    return (
      <AdminPage title="Kaynak detayı" subtitle="Kayıt okunamadı">
        <EmptyHint text={errorMessage(detail.error, 'Kaynak bulunamadı veya erişim yetkisi yok.')} icon="alert-circle-outline" />
        <Button label="Kaynak listesine dön" size="sm" variant="outline" fullWidth={false} onPress={() => router.push('/admin/news-api' as never)} />
      </AdminPage>
    );
  }

  const fields = detail.data?.field_mappings ?? [];
  const categories = detail.data?.category_mappings ?? [];
  const filters = detail.data?.filters ?? null;
  const permissions = detail.data?.permissions ?? null;
  const health = detail.data?.health ?? [];
  const runs = detail.data?.runs ?? [];

  const categoryName = (slug: string) =>
    catalog.data?.categories.find((row) => row.slug === slug)?.name ?? slug;

  const locationLabel =
    filters?.location?.mode === 'selected_districts'
      ? `Seçili ilçeler: ${(filters.location.districts ?? []).map(categoryName).join(', ') || '—'}`
      : filters?.location?.mode === 'trabzonspor'
        ? 'Sadece Trabzonspor'
        : filters?.location?.mode === 'national_trabzon'
          ? 'Trabzon bağlantılı ulusal'
          : 'Trabzon geneli';

  return (
    <AdminPage
      title={connection.name}
      subtitle={`${CONNECTOR_LABELS[connection.connector_kind] ?? connection.connector_kind} · ${connection.feed_url}`}
      actions={
        <>
          <Button
            label={connection.status === 'active' ? 'Duraklat' : 'Aç'}
            size="sm"
            variant={connection.status === 'active' ? 'outline' : 'secondary'}
            fullWidth={false}
            disabled={!canManage || connection.status === 'deleting'}
            loading={setStatus.isPending}
            onPress={() => void changeStatus(connection.status === 'active' ? 'paused' : 'active')}
          />
          <Button
            label="Hemen Çalıştır"
            size="sm"
            variant="outline"
            fullWidth={false}
            disabled={!canManage || connection.status === 'disabled' || connection.status === 'deleting'}
            loading={runNow.isPending}
            onPress={() => void requestRun()}
          />
          <Button
            label="Test Et"
            size="sm"
            variant="ghost"
            fullWidth={false}
            disabled={!canManage}
            loading={test.isPending}
            onPress={() => void testConnection()}
          />
          <Button
            label="Kaynağı Sil"
            size="sm"
            variant="danger"
            fullWidth={false}
            disabled={!canManage || connection.status === 'deleting'}
            onPress={() => setDeletionOpen(true)}
          />
        </>
      }
      refreshing={detail.isFetching}
      onRefresh={() => {
        void detail.refetch();
        void deletionJobs.refetch();
      }}
    >
      <View style={[styles.tabs, { borderColor: theme.colors.border }]}>
        {TABS.map((row) => {
          const active = row.key === tab;
          return (
            <View
              key={row.key}
              style={[
                styles.tab,
                {
                  borderBottomColor: active ? theme.colors.primary : 'transparent',
                },
              ]}
            >
              <Button
                label={row.label}
                size="sm"
                variant={active ? 'secondary' : 'ghost'}
                fullWidth={false}
                onPress={() => setTab(row.key)}
                style={styles.tabButton}
              />
            </View>
          );
        })}
      </View>

      {tab === 'overview' ? (
        <>
          <StatGrid>
            <StatCard label="Toplam haber" value={numberFormat.format(stats?.items_total ?? 0)} icon="download-outline" />
            <StatCard
              label="Yayında"
              value={numberFormat.format(stats?.items_published ?? 0)}
              tone="success"
              icon="paper-plane-outline"
              hint={`Taslak: ${numberFormat.format(stats?.drafts_total ?? 0)}`}
            />
            <StatCard label="İnceleme bekleyen" value={numberFormat.format(stats?.items_pending ?? 0)} tone="warning" icon="time-outline" />
            <StatCard label="Engellenen" value={numberFormat.format(stats?.items_blocked ?? 0)} tone="danger" icon="shield-outline" />
            <StatCard label="Tekrar" value={numberFormat.format(stats?.items_duplicate ?? 0)} icon="copy-outline" />
            <StatCard label="Sitemap URL" value={numberFormat.format(stats?.sitemap_urls ?? 0)} icon="map-outline" />
            <StatCard
              label="Son 24 saat"
              value={`${numberFormat.format(stats?.items_24h ?? 0)} / ${numberFormat.format(stats?.published_24h ?? 0)}`}
              icon="pulse-outline"
              hint="çekilen / yayımlanan"
            />
            <StatCard
              label="Ort. yanıt"
              value={stats?.last_run?.response_ms != null ? `${stats.last_run.response_ms} ms` : '—'}
              icon="speedometer-outline"
              hint={stats?.last_run?.finished_at ? formatDateTimeTr(stats.last_run.finished_at) : 'Kayıt yok'}
            />
          </StatGrid>

          <AdminSection title="Durum ve yayın kontrolü" subtitle="Aç/kapat, otomatik yayın ve mod yönetimi anında uygulanır.">
            <View style={newsApiStyles.row}>
              <StatusBadge status={connection.status} />
              <HealthBadge health={connection.health_status} />
              <LicenseBadge status={connection.license_status} />
              {connection.auto_publish_enabled ? <Badge label="Otomatik yayın açık" tone="success" /> : <Badge label="Otomatik yayın kapalı" tone="neutral" />}
              {connection.last_test_ok == null ? (
                <Badge label="Test edilmedi" tone="warning" />
              ) : connection.last_test_ok ? (
                <Badge label="Son test başarılı" tone="success" />
              ) : (
                <Badge label="Son test başarısız" tone="danger" />
              )}
            </View>


            <View style={newsApiStyles.row}>
              <Button
                label={connection.auto_publish_enabled ? 'Otomatik yayını kapat' : 'Otomatik yayını aç'}
                size="sm"
                variant="outline"
                fullWidth={false}
                disabled={!canManage || connection.status !== 'active'}
                loading={setAutoPublish.isPending}
                onPress={() => void toggleAutoPublish(!connection.auto_publish_enabled)}
              />
              <Button
                label="Kaynağı kapat"
                size="sm"
                variant="ghost"
                fullWidth={false}
                disabled={!canManage || connection.status === 'disabled'}
                onPress={() => void changeStatus('disabled')}
              />
            </View>

            <View style={newsApiStyles.gapSm}>
              <AppText variant="label">Yayın modu</AppText>
              <View style={newsApiStyles.chips}>
                {MODE_OPTIONS.map((option) => {
                  const active = connection.publish_mode === option.value;
                  return (
                    <Button
                      key={option.value}
                      label={MODE_LABELS[option.value as keyof typeof MODE_LABELS] ?? option.label}
                      size="sm"
                      variant={active ? 'secondary' : 'ghost'}
                      fullWidth={false}
                      disabled={!canManage}
                      loading={active ? false : setPublishMode.isPending}
                      onPress={() => void changeMode(option.value)}
                    />
                  );
                })}
              </View>
              <AppText variant="caption" color="textTertiary">
                Lisans ve izin kapısı: {connection.license_status === 'prohibited' ? 'yayın izni yok' : LICENSE_LABELS[connection.license_status]}
                {' · '}
                {permissions?.can_republish_text ? 'tam metin izni' : 'tam metin izni yok'}
                {' · '}
                {permissions?.can_republish_summary ? 'özet izni' : 'özet izni yok'}
              </AppText>
            </View>

            <View>
              <InfoRow label="Son başarılı çağrı" value={connection.last_success_at ? formatDateTimeTr(connection.last_success_at) : '—'} />
              <InfoRow label="Son kontrol" value={connection.last_checked_at ? formatDateTimeTr(connection.last_checked_at) : '—'} />
              <InfoRow label="Son haber" value={connection.last_item_at ? formatDateTimeTr(connection.last_item_at) : '—'} />
              <InfoRow label="HTTP durumu" value={connection.last_http_status ?? '—'} />
              <InfoRow label="Günlük istek" value={`${connection.requests_today} / ${connection.daily_request_budget}`} />
              <InfoRow label="Rate limit" value={connection.rate_limited_until ? formatDateTimeTr(connection.rate_limited_until) : 'Yok'} />
              <InfoRow label="Otomatik kapandı" value={connection.auto_disabled_reason ?? '—'} />
              <InfoRow label="Yayıncı profili" value={connection.profile?.display_name ?? connection.publisher_profile_id ?? 'Bağlı değil'} />
            </View>

            {connection.last_error ? (
              <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
                <AppText variant="caption" color="danger">
                  {connection.last_error}
                </AppText>
              </View>
            ) : null}
          </AdminSection>

          <AdminSection title="Yayıncı profili ve lisans" subtitle="MOD A için kaynak profili, MOD B/C için lisans izinleri.">
            <InfoRow label="Profil" value={connection.profile?.display_name ?? 'Tanımlı değil'} />
            <InfoRow label="Profil durumu" value={connection.profile?.status ?? '—'} />
            <InfoRow label="Doğrulama" value={connection.profile?.verified ? 'Doğrulanmış' : 'Doğrulanmamış'} />
            <InfoRow label="Lisans" value={LICENSE_LABELS[connection.license_status]} />
            <InfoRow label="Atıf" value={permissions?.attribution_text ?? '—'} />
            <View style={newsApiStyles.row}>
              <Button label="Profili düzenle" size="sm" variant="outline" fullWidth={false} onPress={() => setProfileOpen(true)} />
              <Button label="Lisans ve izinler" size="sm" variant="outline" fullWidth={false} onPress={() => setPermissionsOpen(true)} />
            </View>
          </AdminSection>
        </>
      ) : null}

      {tab === 'connection' ? (
        <>
          <AdminSection title="Bağlantı parametreleri" subtitle="Adapter alanları, kimlik doğrulama, tarife ve kota.">
            <NewsSourceForm connection={connection} canManage={canManage} />
          </AdminSection>
          <AdminSection title="Bağlantı testi" subtitle="Gerçek sunucu isteği; SSRF, süre ve boyut sınırı uygulanır.">
            <NewsTestPanel connectionId={connection.id} lastResult={connection.last_test_detail ?? null} />
          </AdminSection>
        </>
      ) : null}

      {tab === 'categories' ? (
        <AdminSection
          title="Kategori eşleştirme"
          subtitle="Kaynak kategorileri Trabzone kategorilerine bağlanır; eşleşmeyenler AI ile sınıflandırılır."
          action={
            <Button label="Eşleştirmeyi düzenle" size="sm" variant="outline" fullWidth={false} onPress={() => setCategoriesOpen(true)} />
          }
        >
          {categories.length === 0 ? (
            <EmptyHint text="Kategori eşleştirmesi yok. AI sınıflandırması kullanılacak." />
          ) : (
            <View style={[styles.table, { borderColor: theme.colors.border }]}>
              {categories.map((row) => (
                <View key={row.source_category} style={[styles.tableRow, { borderBottomColor: theme.colors.divider }]}>
                  <AppText variant="caption" style={styles.colWide}>
                    {row.source_category}
                  </AppText>
                  <Ionicons name="arrow-forward" size={13} color={theme.colors.textTertiary} />
                  <AppText variant="caption" color="textSecondary" style={styles.colWide}>
                    {categoryName(row.target_slug)}
                  </AppText>
                  {row.is_auto ? <Badge label="otomatik" tone="neutral" /> : null}
                </View>
              ))}
            </View>
          )}

          <AppText variant="label">Çekilecek kategoriler</AppText>
          {filters?.categories?.length ? (
            <View style={newsApiStyles.chips}>
              {filters.categories.map((slug) => (
                <Badge key={slug} label={categoryName(slug)} tone="primary" />
              ))}
            </View>
          ) : (
            <AppText variant="caption" color="textTertiary">
              Kategori seçilmedi; Trabzon bağlantılı tüm kategoriler değerlendirilir.
            </AppText>
          )}
        </AdminSection>
      ) : null}

      {tab === 'location' ? (
        <AdminSection
          title="Konum filtreleri"
          subtitle="Trabzon ve 18 ilçe; kaynak il filtresi desteklemiyorsa sınıflandırma motoru kullanılır."
          action={<Button label="Filtreleri düzenle" size="sm" variant="outline" fullWidth={false} onPress={() => setFiltersOpen(true)} />}
        >
          <InfoRow label="Konum modu" value={locationLabel} />
          <InfoRow label="Tarih penceresi" value={`${filters?.date_window_hours ?? 72} saat`} />
          <InfoRow label="Haber türü" value={filters?.news_types?.length ? filters.news_types.join(', ') : 'Tümü'} />
          <InfoRow label="Yalnız görselli" value={filters?.content?.has_image === true ? 'Evet' : 'Hayır'} />
          <InfoRow label="Yalnız videolu" value={filters?.content?.has_video === true ? 'Evet' : 'Hayır'} />
          <InfoRow
            label="Dahil kelimeler"
            value={Array.isArray(filters?.content?.include_keywords) ? (filters?.content?.include_keywords as string[]).join(', ') : '—'}
          />
          <InfoRow
            label="Hariç kelimeler"
            value={Array.isArray(filters?.content?.exclude_keywords) ? (filters?.content?.exclude_keywords as string[]).join(', ') : '—'}
          />
        </AdminSection>
      ) : null}

      {tab === 'rules' ? (
        <>
          <AdminSection title="Yayın kuralları" subtitle="Mod seçimi yalnızca lisans izni varsa kaydedilir.">
            <InfoRow label="Yayın modu" value={MODE_LABELS[connection.publish_mode]} />
            <InfoRow label="Otomatik yayın" value={connection.auto_publish_enabled ? 'Açık' : 'Kapalı'} />
            <InfoRow label="Min. yayın aralığı" value={`${connection.min_publish_interval_seconds} saniye`} />
            <InfoRow label="Kontrol sıklığı" value={`${connection.poll_interval_minutes} dakika`} />
            <InfoRow label="Çalışma başına haber" value={String(connection.max_items_per_run)} />
            <InfoRow label="AI sınıflandırma" value={connection.ai_classification ? 'Açık' : 'Kapalı'} />
            <InfoRow label="Atıf zorunlu" value={permissions?.attribution_required ? 'Evet' : 'Hayır'} />
            <View style={newsApiStyles.row}>
              <Button label="Otomatik yayını değiştir" size="sm" variant="outline" fullWidth={false} onPress={() => void toggleAutoPublish(!connection.auto_publish_enabled)} />
              <Button label="İzinleri düzenle" size="sm" variant="ghost" fullWidth={false} onPress={() => setPermissionsOpen(true)} />
            </View>
          </AdminSection>

          <AdminSection title="Alan eşleştirme" subtitle="Başlık ve URL zorunlu; kaynak etkinleştirme kapısı bunu doğrular.">
            {fields.length === 0 ? (
              <EmptyHint text="Alan eşleştirmesi yok. Test çalıştırıp alanları eşleştir." />
            ) : (
              <View style={[styles.table, { borderColor: theme.colors.border }]}>
                {fields.map((row) => (
                  <View key={row.field_key} style={[styles.tableRow, { borderBottomColor: theme.colors.divider }]}>
                    <AppText variant="caption" style={styles.colWide}>
                      {row.field_key}
                    </AppText>
                    <AppText variant="caption" color="textSecondary" style={styles.colWide}>
                      {row.source_path}
                    </AppText>
                    <Badge label={row.transform} tone="neutral" />
                  </View>
                ))}
              </View>
            )}
            <Button label="Alan eşleştirmesini düzenle" size="sm" variant="outline" fullWidth={false} onPress={() => setFieldsOpen(true)} />
          </AdminSection>
        </>
      ) : null}

      {tab === 'items' ? (
        <AdminSection title="Kaynaktan gelen haberler" subtitle="Tek haberi kaldır, yayınla veya detayı incele.">
          <NewsItemsPanel
            connectionId={connection.id}
            canManage={canManage}
            canPublish={canManage && connection.publish_mode !== 'discovery'}
          />
        </AdminSection>
      ) : null}

      {tab === 'profile' ? (
        <AdminSection
          title="Kaynak profili"
          subtitle="MOD A kaynak yayını bu profil üzerinden paylaşılır."
          action={<Button label="Profili düzenle" size="sm" variant="outline" fullWidth={false} onPress={() => setProfileOpen(true)} />}
        >
          {connection.profile ? (
            <>
              <InfoRow label="Görünen ad" value={connection.profile.display_name} />
              <InfoRow label="Kullanıcı adı" value={connection.profile.username ? `@${connection.profile.username}` : '—'} />
              <InfoRow label="Açıklama" value={connection.profile.description ?? '—'} />
              <InfoRow label="Site" value={connection.profile.website ?? '—'} />
              <InfoRow label="Durum" value={connection.profile.status} />
              <InfoRow label="Doğrulama" value={connection.profile.verified ? 'Doğrulanmış' : 'Doğrulanmamış'} />
              <InfoRow label="Doğrulama notu" value={connection.profile.verification_note ?? '—'} />
            </>
          ) : (
            <EmptyHint text="Kaynak profili henüz oluşturulmadı. Otomatik yayın için profil gerekir." />
          )}
        </AdminSection>
      ) : null}

      {tab === 'license' ? (
        <AdminSection
          title="Lisans ve yayın izinleri"
          subtitle="Kaynak listesinde olmak yayın izni değildir; her hak ayrı kaydedilir."
          action={<Button label="İzinleri düzenle" size="sm" variant="outline" fullWidth={false} onPress={() => setPermissionsOpen(true)} />}
        >
          <InfoRow label="Lisans durumu" value={<LicenseBadge status={connection.license_status} />} />
          <InfoRow label="Lisans notu" value={connection.license_note ?? '—'} />
          <InfoRow label="Tam metin" value={permissions?.can_republish_text ? 'İzinli' : 'İzinsiz'} />
          <InfoRow label="Özet" value={permissions?.can_republish_summary ? 'İzinli' : 'İzinsiz'} />
          <InfoRow label="Görsel" value={permissions?.can_use_images ? 'İzinli' : 'İzinsiz'} />
          <InfoRow label="Logo" value={permissions?.can_use_logo ? 'İzinli' : 'İzinsiz'} />
          <InfoRow label="Video" value={permissions?.can_use_video ? 'İzinli' : 'İzinsiz'} />
          <InfoRow label="Atıf" value={permissions?.attribution_required ? permissions.attribution_text ?? 'Zorunlu' : 'Zorunlu değil'} />
          <InfoRow label="Şartlar" value={permissions?.terms_url ?? '—'} />
          <InfoRow label="Kanıt" value={permissions?.evidence_url ?? '—'} />
          <InfoRow label="Doğrulama" value={permissions?.verified_at ? formatDateTimeTr(permissions.verified_at) : '—'} />
        </AdminSection>
      ) : null}

      {tab === 'stats' ? (
        <AdminSection title="Çalışma geçmişi" subtitle="Son worker turları ve sonuçları.">
          {runs.length === 0 ? (
            <EmptyHint text="Henüz çalışma kaydı yok." />
          ) : (
            <View style={[styles.table, { borderColor: theme.colors.border }]}>
              <View style={[styles.tableHead, { borderBottomColor: theme.colors.divider }]}>
                <AppText variant="caption" color="textTertiary" style={styles.colWide}>
                  Başlangıç
                </AppText>
                <AppText variant="caption" color="textTertiary" style={styles.colWide}>
                  Sonuç
                </AppText>
                <AppText variant="caption" color="textTertiary" style={styles.colWide}>
                  Görülen / yeni / yayın
                </AppText>
              </View>
              {runs.map((run) => (
                <View key={run.id} style={[styles.tableRow, { borderBottomColor: theme.colors.divider }]}>
                  <AppText variant="caption" style={styles.colWide}>
                    {run.started_at ? formatDateTimeTr(run.started_at) : '—'}
                  </AppText>
                  <View style={styles.colWide}>
                    <Badge
                      label={run.status}
                      tone={run.status === 'ok' || run.status === 'completed' ? 'success' : run.status === 'error' || run.status === 'failed' ? 'danger' : 'neutral'}
                    />
                    {run.error ? (
                      <AppText variant="caption" color="danger" numberOfLines={2}>
                        {run.error}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textSecondary" style={styles.colWide}>
                    {run.items_seen} / {run.items_new} / {run.items_published}
                  </AppText>
                </View>
              ))}
            </View>
          )}
        </AdminSection>
      ) : null}

      {tab === 'errors' ? (
        <AdminSection title="Bağlantı sağlığı" subtitle="Son kontrol kayıtları ve hata nedenleri.">
          {health.length === 0 ? (
            <EmptyHint text="Sağlık kaydı yok." />
          ) : (
            <View style={[styles.table, { borderColor: theme.colors.border }]}>
              {health.map((row) => (
                <View key={row.id} style={[styles.tableRow, { borderBottomColor: theme.colors.divider }]}>
                  <AppText variant="caption" style={styles.colWide}>
                    {formatDateTimeTr(row.checked_at)}
                  </AppText>
                  <HealthBadge health={row.ok ? 'ok' : 'error'} />
                  <AppText variant="caption" color="textSecondary" style={styles.colWide}>
                    HTTP {row.http_status ?? '—'} · {row.response_ms ?? 0} ms · {row.item_count ?? 0} haber
                  </AppText>
                  {row.error ? (
                    <AppText variant="caption" color="danger" style={styles.colWide} numberOfLines={2}>
                      {row.error}
                    </AppText>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </AdminSection>
      ) : null}

      {tab === 'deletion' ? (
        <AdminSection
          title="Silme ve kaldırma"
          subtitle="Yalnızca bu kaynağa münhasır içerikler kaldırılır; ortak haberler ve kullanıcı verileri korunur."
          action={
            <Button
              label="Kaynağı Sil"
              size="sm"
              variant="danger"
              fullWidth={false}
              disabled={!canManage}
              onPress={() => setDeletionOpen(true)}
            />
          }
        >
          <View style={newsApiStyles.statGrid}>
            <View style={styles.smallStat}>
              <AppText variant="title">{numberFormat.format(stats?.items_total ?? 0)}</AppText>
              <AppText variant="caption" color="textSecondary">
                Toplam haber
              </AppText>
            </View>
            <View style={styles.smallStat}>
              <AppText variant="title">{numberFormat.format(stats?.items_published ?? 0)}</AppText>
              <AppText variant="caption" color="textSecondary">
                Yayında
              </AppText>
            </View>
            <View style={styles.smallStat}>
              <AppText variant="title">{numberFormat.format(stats?.items_pending ?? 0)}</AppText>
              <AppText variant="caption" color="textSecondary">
                Taslak / bekleyen
              </AppText>
            </View>
            <View style={styles.smallStat}>
              <AppText variant="title">{numberFormat.format(stats?.sitemap_urls ?? 0)}</AppText>
              <AppText variant="caption" color="textSecondary">
                Sitemap URL
              </AppText>
            </View>
          </View>

          <AppText variant="label">Geçmiş işlemler</AppText>
          {(deletionJobs.data?.items ?? []).length === 0 ? (
            <EmptyHint text="Bu kaynak için silme işi yok." />
          ) : (
            <View style={[styles.table, { borderColor: theme.colors.border }]}>
              {(deletionJobs.data?.items ?? []).map((job) => (
                <View key={job.id} style={[styles.tableRow, { borderBottomColor: theme.colors.divider }]}>
                  <AppText variant="caption" style={styles.colWide}>
                    {formatDateTimeTr(job.requested_at)}
                  </AppText>
                  <Badge label={job.scope} tone="neutral" />
                  <Badge
                    label={job.status}
                    tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : 'warning'}
                  />
                  <AppText variant="caption" color="textTertiary">
                    {numberFormat.format(job.counts.items_total)} haber · {numberFormat.format(job.counts.sitemap_urls)} URL
                  </AppText>
                </View>
              ))}
            </View>
          )}

          <AppText variant="caption" color="textTertiary">
            Silme işlemi tamamlanana kadar “tüm veriler silindi” gösterilmez. Sitemap’ten kaldırma sonraki yayında
            doğrulanır; Google indeksinden kaldırma ayrı bir süreçtir.
          </AppText>
        </AdminSection>
      ) : null}

      {detail.data ? (
        <>
          <NewsFieldMappingModal
            visible={fieldsOpen}
            connectionId={connection.id}
            connectionName={connection.name}
            mappings={fields}
            detectedFields={connection.last_test_detail?.fields ?? []}
            onClose={() => setFieldsOpen(false)}
          />

          <NewsCategoryMappingModal
            visible={categoriesOpen}
            connectionId={connection.id}
            connectionName={connection.name}
            mappings={categories}
            categories={catalog.data?.categories ?? []}
            onClose={() => setCategoriesOpen(false)}
          />

          <NewsFiltersModal
            visible={filtersOpen}
            connectionId={connection.id}
            connectionName={connection.name}
            filters={filters}
            categories={catalog.data?.categories ?? []}
            districts={catalog.data?.districts ?? []}
            onClose={() => setFiltersOpen(false)}
          />

          <NewsPermissionsModal
            visible={permissionsOpen}
            connectionId={connection.id}
            connectionName={connection.name}
            permissions={permissions}
            licenseStatus={connection.license_status}
            licenseNote={connection.license_note}
            onClose={() => setPermissionsOpen(false)}
          />

          <NewsProfileModal
            visible={profileOpen}
            connection={connection}
            profile={connection.profile}
            onClose={() => setProfileOpen(false)}
          />

          <NewsDeletionModal
            visible={deletionOpen}
            connectionId={connection.id}
            connectionName={connection.name}
            canDelete={canManage}
            onClose={() => setDeletionOpen(false)}
            onCompleted={() => {
              void detail.refetch();
              void deletionJobs.refetch();
            }}
          />
        </>
      ) : null}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 2 },
  tab: { borderBottomWidth: 2 },
  tabButton: { minHeight: 34, paddingHorizontal: 10 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 11, gap: 0 },
  tableHead: { flexDirection: 'row', gap: 10, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  tableRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  colWide: { flex: 1, minWidth: 130 },
  errorBox: { borderRadius: 10, padding: 10 },
  smallStat: { minWidth: 110, gap: 2 },
});
