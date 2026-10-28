import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useNewsApiPublishers,
  useNewsApiSaveAdapter,
  useNewsApiSaveCategoryMappings,
  useNewsApiSaveConnection,
  useNewsApiSaveCredentials,
  useNewsApiSaveFilters,
  useNewsApiSaveMappings,
  useNewsApiSavePermissions,
  useNewsApiSaveProfile,
  useNewsApiSetAutoPublish,
  useNewsApiSetPublishMode,
  useNewsApiSetStatus,
  useNewsApiTest,
} from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import type {
  NewsCatalog,
  NewsConnection,
  NewsConnectorKind,
  NewsFieldMapping,
  NewsLicenseStatus,
  NewsPublishMode,
  NewsTemplate,
  NewsTestResult,
} from '@/features/news-api/types';

import { NewsModalShell } from './NewsModalShell';
import { NewsTestResultView } from './NewsTestPanel';
import {
  ChipSelect,
  CONNECTOR_LABELS,
  EmptyHint,
  FormRow,
  LICENSE_LABELS,
  MODE_LABELS,
  ToggleRow,
  newsApiStyles,
} from './shared';

const STEPS = [
  'Kaynak türü',
  'Bağlantı',
  'Test',
  'Alanlar',
  'Kategoriler',
  'Lisans ve yayın',
  'Etkinleştir',
] as const;

const AUTH_KINDS = [
  { value: 'none', label: 'Anahtar yok' },
  { value: 'header_key', label: 'Başlıkta anahtar' },
  { value: 'query_key', label: 'Sorguda anahtar' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Kullanıcı adı + şifre' },
];

const PAGINATION = [
  { value: 'auto', label: 'Otomatik' },
  { value: 'none', label: 'Yok' },
  { value: 'page', label: 'Sayfa' },
  { value: 'next_url', label: 'Sonraki URL' },
  { value: 'cursor', label: 'Cursor' },
];

const LOCATION_MODES = [
  { value: 'trabzon_all', label: 'Trabzon geneli' },
  { value: 'selected_districts', label: 'Seçili ilçeler' },
  { value: 'trabzonspor', label: 'Sadece Trabzonspor' },
  { value: 'national_trabzon', label: 'Trabzon bağlantılı ulusal' },
];

const MAPPING_FIELDS: { key: string; label: string }[] = [
  { key: 'external_id', label: 'Haber ID' },
  { key: 'title', label: 'Başlık *' },
  { key: 'summary', label: 'Özet' },
  { key: 'body', label: 'Metin' },
  { key: 'url', label: 'URL *' },
  { key: 'published_at', label: 'Yayın tarihi' },
  { key: 'image_url', label: 'Görsel' },
  { key: 'author', label: 'Yazar' },
  { key: 'category', label: 'Kategori' },
  { key: 'district', label: 'İlçe' },
  { key: 'tags', label: 'Etiketler' },
];

const ALIASES: Record<string, string[]> = {
  external_id: ['id', 'guid', 'external_id', 'haber_id', 'uuid'],
  title: ['title', 'headline', 'baslik', 'başlık', 'name'],
  summary: ['summary', 'description', 'spot', 'ozet', 'özet', 'excerpt'],
  body: ['body', 'content', 'text', 'icerik', 'içerik', 'full_text'],
  url: ['url', 'link', 'permalink', 'canonical_url', 'web_url', 'href'],
  published_at: ['published_at', 'pubdate', 'published', 'date', 'date_published', 'yayin_tarihi', 'created_at'],
  image_url: ['image', 'image_url', 'thumbnail', 'media', 'gorsel', 'resim'],
  author: ['author', 'creator', 'byline', 'yazar'],
  category: ['category', 'categories', 'section', 'kategori'],
  district: ['district', 'ilce', 'ilçe'],
  tags: ['tags', 'keywords', 'etiketler'],
};

function segment(path: string) {
  return path.split('.').pop()?.replace(/\[\d+\]/g, '').replace(/[_-]/g, '').toLowerCase() ?? '';
}

function guessMappings(fields: string[]): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = {};
  for (const [key, aliases] of Object.entries(ALIASES)) {
    const match = fields
      .map((path) => {
        const index = aliases.findIndex((alias) => segment(path) === alias.replace(/[_-]/g, '').toLowerCase());
        return { path, score: index === -1 ? 99 : index };
      })
      .filter((row) => row.score < 99 && !used.has(row.path))
      .sort((a, b) => a.score - b.score || a.path.split('.').length - b.path.split('.').length)[0];
    if (match) {
      result[key] = match.path;
      used.add(match.path);
    }
  }
  return result;
}

function templateLabel(template: NewsTemplate) {
  return template.is_verified ? `${template.name} · doğrulanmış` : template.name;
}

export function NewsWizardModal({
  visible,
  catalog,
  onClose,
  onCreated,
}: {
  visible: boolean;
  catalog: NewsCatalog;
  onClose: () => void;
  onCreated?: (connection: NewsConnection) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();

  const create = useNewsApiSaveConnection();
  const saveAdapter = useNewsApiSaveAdapter();
  const saveCredentials = useNewsApiSaveCredentials();
  const saveMappings = useNewsApiSaveMappings();
  const saveCategories = useNewsApiSaveCategoryMappings();
  const saveFilters = useNewsApiSaveFilters();
  const savePermissions = useNewsApiSavePermissions();
  const saveProfile = useNewsApiSaveProfile();
  const setModeMutation = useNewsApiSetPublishMode();
  const setStatus = useNewsApiSetStatus();
  const setAutoPublish = useNewsApiSetAutoPublish();
  const test = useNewsApiTest();

  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<NewsTemplate | null>(null);
  const [connector, setConnector] = useState<NewsConnectorKind>('rss');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [homepage, setHomepage] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [httpMethod, setHttpMethod] = useState('GET');
  const [authKind, setAuthKind] = useState('none');
  const [headerName, setHeaderName] = useState('');
  const [queryParam, setQueryParam] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [paramsText, setParamsText] = useState('{"il":"61"}');
  const [timezone, setTimezone] = useState('Europe/Istanbul');
  const [pollInterval, setPollInterval] = useState('30');
  const [itemsPath, setItemsPath] = useState('');
  const [pagination, setPagination] = useState('auto');
  const [paginationParam, setPaginationParam] = useState('page');
  const [sinceParam, setSinceParam] = useState('');
  const [result, setResult] = useState<NewsTestResult | null>(null);
  const [mappingValues, setMappingValues] = useState<Record<string, string>>({});
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [locationMode, setLocationMode] = useState('trabzon_all');
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [newsTypes, setNewsTypes] = useState<string[]>([]);
  const [hasImage, setHasImage] = useState(false);
  const [license, setLicense] = useState<NewsLicenseStatus>('unverified');
  const [licenseNote, setLicenseNote] = useState('');
  const [canText, setCanText] = useState(false);
  const [canSummary, setCanSummary] = useState(false);
  const [canImages, setCanImages] = useState(false);
  const [attribution, setAttribution] = useState('');
  const [mode, setPublishMode] = useState<NewsPublishMode>('discovery');
  const [publisherSearch, setPublisherSearch] = useState('');
  const [publisherId, setPublisherId] = useState<string | null>(null);
  const [autoPublish, setAutoPublishState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedConnection, setSavedConnection] = useState<NewsConnection | null>(null);

  const publishers = useNewsApiPublishers(publisherSearch, visible);
  const selectedPublisher = (publishers.data?.items ?? []).find((row) => row.id === publisherId);
  const districts = catalog.districts;

  const publishModeOptions = useMemo(
    () => catalog.publish_modes.map((row) => ({ value: row.value, label: MODE_LABELS[row.value] ?? row.label })),
    [catalog.publish_modes],
  );

  const reset = () => {
    setStep(0);
    setTemplate(null);
    setConnector('rss');
    setName('');
    setDescription('');
    setHomepage('');
    setFeedUrl('');
    setAuthKind('none');
    setSecret('');
    setResult(null);
    setMappingValues({});
    setSelectedCategories([]);
    setSelectedDistricts([]);
    setLocationMode('trabzon_all');
    setLicense('unverified');
    setLicenseNote('');
    setCanText(false);
    setCanSummary(false);
    setCanImages(false);
    setPublishMode('discovery');
    setPublisherId(null);
    setAutoPublishState(false);
    setError(null);
    setSavedConnection(null);
  };

  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const pickTemplate = (row: NewsTemplate | null) => {
    setTemplate(row);
    if (!row) return;
    setConnector(row.connector_kind);
    setFeedUrl(row.feed_url ?? '');
    setHomepage(row.homepage_url ?? '');
    setName(row.name);
    setLicenseNote(row.license_note ?? '');
    setSelectedCategories(row.default_categories ?? []);
  };

  const testConfig = () => {
    let params: Record<string, unknown> = {};
    try {
      params = paramsText.trim() ? (JSON.parse(paramsText) as Record<string, unknown>) : {};
    } catch {
      setError('Varsayılan parametreler geçerli JSON olmalı. Örnek: {"il":"61"}');
      return;
    }
    setError(null);
    void (async () => {
      try {
        const output = await test.mutateAsync({
          config: {
            feed_url: feedUrl.trim(),
            name: name.trim(),
            connector_kind: connector,
            http_method: httpMethod,
            auth_kind: authKind,
            auth_header_name: headerName.trim() || null,
            auth_query_param: queryParam.trim() || null,
            secret: secret.trim() || null,
            items_path: itemsPath.trim() || null,
            default_params: params,
          },
        });
        setResult(output);
        setMappingValues(guessMappings(output.fields));
      } catch (testError) {
        setError(errorMessage(testError, 'Bağlantı testi başarısız.'));
      }
    })();
  };

  const canNext = () => {
    if (step === 0) return Boolean(feedUrl.trim() || template);
    if (step === 1) return name.trim().length >= 2 && /^https:\/\//i.test(feedUrl.trim());
    if (step === 2) return result?.ok === true;
    if (step === 3) return Boolean(mappingValues.title?.trim() && mappingValues.url?.trim());
    if (step === 5) {
      if (mode === 'source_profile' && !canText) return false;
      if (mode === 'trabzone_digest' && !canSummary) return false;
      if (mode === 'editor_approval' && !canSummary && !canText) return false;
      return true;
    }
    return true;
  };

  const next = () => {
    if (!canNext()) {
      if (step === 2) setError('Etkinleştirmeden önce bağlantı testi başarılı olmalı.');
      else if (step === 3) setError('Başlık ve URL alanları zorunludur.');
      else if (step === 1) setError('Kaynak adı en az 2 karakter ve HTTPS feed adresi gerekli.');
      else if (step === 5) setError('Seçilen yayın modu için gerekli yayın hakkını işaretle.');
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const activate = async () => {
    setError(null);
    setSaving(true);
    try {
      let params: Record<string, unknown> = {};
      try {
        params = paramsText.trim() ? (JSON.parse(paramsText) as Record<string, unknown>) : {};
      } catch {
        params = {};
      }

      const created = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        homepage_url: homepage.trim() || null,
        feed_url: feedUrl.trim(),
        template_code: template?.code ?? null,
        connector_kind: connector,
        http_method: httpMethod,
        auth_kind: authKind,
        auth_header_name: authKind === 'header_key' ? headerName.trim() || null : null,
        auth_query_param: authKind === 'query_key' ? queryParam.trim() || null : null,
        auth_username: authKind === 'basic' ? username.trim() || null : null,
        default_params: params,
        timezone: timezone.trim() || 'Europe/Istanbul',
        poll_interval_minutes: Number(pollInterval) || 30,
        license_status: license,
        license_note: licenseNote.trim() || null,
        publisher_profile_id: publisherId,
        notes: description.trim() || null,
      });

      await saveAdapter.mutateAsync({
        id: created.id,
        items_path: itemsPath.trim() || null,
        pagination_kind: pagination,
        pagination_param: pagination === 'page' || pagination === 'cursor' ? paginationParam.trim() || null : null,
        since_param: sinceParam.trim() || null,
        auth_username: authKind === 'basic' ? username.trim() || null : null,
      });

      if (secret.trim().length >= 4 && authKind !== 'none') {
        await saveCredentials.mutateAsync({
          id: created.id,
          secret: secret.trim(),
          authKind,
          headerName: headerName.trim() || null,
          queryParam: queryParam.trim() || null,
          username: username.trim() || null,
        });
      }

      const mappingRows: NewsFieldMapping[] = MAPPING_FIELDS.filter((field) => mappingValues[field.key]?.trim()).map(
        (field) => ({
          field_key: field.key,
          source_path: (mappingValues[field.key] ?? '').trim(),
          transform: field.key === 'published_at' ? 'none' : field.key === 'image_url' ? 'absolute_url' : 'none',
          is_auto: true,
        }),
      );
      await saveMappings.mutateAsync({ id: created.id, rows: mappingRows });

      if (template?.default_categories?.length) {
        await saveCategories.mutateAsync({
          id: created.id,
          rows: template.default_categories
            .filter((slug) => selectedCategories.includes(slug))
            .map((slug) => ({ source_category: slug, target_slug: slug, is_auto: true })),
        });
      }

      await saveFilters.mutateAsync({
        id: created.id,
        categories: selectedCategories,
        newsTypes,
        location: {
          mode: locationMode,
          districts: locationMode === 'selected_districts' ? selectedDistricts : [],
        },
        content: { has_image: hasImage },
        dateWindowHours: 72,
      });

      await savePermissions.mutateAsync({
        id: created.id,
        payload: {
          license_status: license,
          license_note: licenseNote.trim() || null,
          can_republish_text: canText,
          can_republish_summary: canSummary,
          can_use_images: canImages,
          can_use_logo: false,
          can_use_video: false,
          attribution_required: true,
          attribution_text: attribution.trim() || homepage.trim() || null,
          terms_url: (template?.rights_url ?? homepage.trim()) || null,
          evidence_url: null,
        },
      });

      await setModeMutation.mutateAsync({ id: created.id, mode });

      if (publisherId) {
        await saveProfile.mutateAsync({
          id: created.id,
          payload: {
            profile_id: publisherId,
            display_name: name.trim(),
            username: selectedPublisher?.username ?? null,
            website: homepage.trim() || null,
            description: description.trim() || null,
            status: 'active',
            verified: false,
            verification_note: null,
          },
        });
      }

      // Testi bağlantı kimliğiyle tekrar çalıştır: `last_test_ok` yalnızca bu
      // şekilde kalıcı olur ve kaynak etkinleştirme kapısı açılır.
      const verified = await test.mutateAsync({ connectionId: created.id });
      if (!verified.ok) {
        throw new Error(verified.error ?? 'Bağlantı doğrulanamadı.');
      }

      if (autoPublish && mode !== 'discovery' && publisherId) {
        await setAutoPublish.mutateAsync({ id: created.id, enabled: true });
      }

      const activated = await setStatus.mutateAsync({ id: created.id, status: 'active' });
      setSavedConnection(activated);
      toast.success('Kaynak etkinleştirildi. Haberler kontrol aralığında otomatik alınacak.');
      onCreated?.(activated);
    } catch (activateError) {
      setError(errorMessage(activateError, 'Kaynak etkinleştirilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <NewsModalShell
      visible={visible}
      title="Yeni Haber Kaynağı Ekle"
      subtitle={`Adım ${step + 1} / ${STEPS.length} · ${STEPS[step]}`}
      onClose={close}
      width={980}
      footer={
        savedConnection ? (
          <Button label="Kapat" size="sm" fullWidth={false} onPress={close} />
        ) : (
          <>
            <Button
              label="Geri"
              size="sm"
              variant="ghost"
              fullWidth={false}
              disabled={step === 0 || saving}
              onPress={() => setStep((current) => Math.max(current - 1, 0))}
            />
            {step < STEPS.length - 1 ? (
              <Button label="Devam" size="sm" fullWidth={false} disabled={saving} onPress={next} />
            ) : (
              <Button
                label="Kaynağı etkinleştir"
                size="sm"
                fullWidth={false}
                loading={saving}
                onPress={() => void activate()}
              />
            )}
          </>
        )
      }
    >
      <View style={styles.steps}>
        {STEPS.map((label, index) => (
          <View
            key={label}
            style={[
              styles.step,
              {
                borderColor: index === step ? theme.colors.primary : theme.colors.border,
                backgroundColor: index === step ? theme.colors.primarySoft : theme.colors.surface,
              },
            ]}
          >
            <AppText variant="caption" color={index === step ? 'primaryDeep' : 'textTertiary'}>
              {index + 1}. {label}
            </AppText>
          </View>
        ))}
      </View>

      {savedConnection ? (
        <View style={[styles.success, { borderColor: theme.colors.success, backgroundColor: theme.colors.successSoft }]}>
          <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
          <View style={newsApiStyles.flex}>
            <AppText variant="title">Kaynak etkinleştirildi</AppText>
            <AppText variant="caption" color="textSecondary">
              {savedConnection.name} · durum: açık · kontrol: {savedConnection.poll_interval_minutes} dakika
            </AppText>
            <AppText variant="caption" color="textTertiary">
              İlk çekim bir sonraki worker turunda çalışır. Kaynağa özel haberleri detay sayfasından izleyebilirsin.
            </AppText>
          </View>
        </View>
      ) : step === 0 ? (
        <>
          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Doğrulanmış sağlayıcı şablonları</AppText>
            <View style={styles.templateGrid}>
              {catalog.templates.map((row) => {
                const active = template?.code === row.code;
                return (
                  <Pressable
                    key={row.code}
                    accessibilityRole="button"
                    onPress={() => pickTemplate(row)}
                    style={[
                      styles.template,
                      {
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                      },
                    ]}
                  >
                    <View style={newsApiStyles.row}>
                      <AppText variant="label">{templateLabel(row)}</AppText>
                      {row.is_verified ? <Badge label="Doğrulanmış" tone="success" /> : null}
                    </View>
                    <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                      {row.feed_url ?? 'Bağlantı adresi şablonu'}
                    </AppText>
                    <Badge label={CONNECTOR_LABELS[row.connector_kind] ?? row.connector_kind} tone="neutral" />
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setTemplate(null);
                  setFeedUrl('');
                  setHomepage('');
                  setName('');
                }}
                style={[
                  styles.template,
                  {
                    borderColor: template === null ? theme.colors.primary : theme.colors.border,
                    backgroundColor: template === null ? theme.colors.primarySoft : theme.colors.surface,
                  },
                ]}
              >
                <AppText variant="label">Sıfırdan başla</AppText>
                <AppText variant="caption" color="textTertiary">
                  Kendi RSS / Atom / XML / JSON / REST API bağlantını tanımla.
                </AppText>
              </Pressable>
            </View>
          </View>

          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Kaynak türü</AppText>
            <ChipSelect
              options={catalog.connector_kinds.map((row) => ({ value: row.value, label: row.label }))}
              value={connector}
              onChange={setConnector}
            />
          </View>

          <EmptyHint
            text="Bilinmeyen formatlar sıfır yapılandırmayla çalışmaz. Özel kimlik doğrulama, imzalı istek veya GraphQL için adapter gerekir; panel bunu açıkça gösterir."
            icon="information-circle-outline"
          />
        </>
      ) : step === 1 ? (
        <>
          <FormRow>
            <TextField label="Kaynak adı" value={name} onChangeText={setName} containerStyle={styles.grow} />
            <TextField
              label="Resmî site"
              value={homepage}
              onChangeText={setHomepage}
              autoCapitalize="none"
              containerStyle={styles.grow}
              placeholder="https://..."
            />
          </FormRow>
          <TextField
            label="Feed / API adresi"
            value={feedUrl}
            onChangeText={setFeedUrl}
            autoCapitalize="none"
            placeholder="https://ornek.com/rss"
            hint="Yalnızca HTTPS. Özel IP, localhost ve metadata adresleri sunucuda reddedilir."
          />
          <TextField label="Açıklama" value={description} onChangeText={setDescription} multiline style={styles.multiline} />

          <FormRow>
            <TextField
              label="Öğe yolu (JSON API)"
              value={itemsPath}
              onChangeText={setItemsPath}
              autoCapitalize="none"
              containerStyle={styles.grow}
              placeholder="data.items"
            />
            <TextField
              label="Varsayılan parametreler (JSON)"
              value={paramsText}
              onChangeText={setParamsText}
              autoCapitalize="none"
              containerStyle={styles.grow}
              hint='Örn. {"il":"61"}'
            />
          </FormRow>

          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">İstek yöntemi</AppText>
            <ChipSelect
              options={[
                { value: 'GET', label: 'GET' },
                { value: 'POST', label: 'POST' },
              ]}
              value={httpMethod}
              onChange={setHttpMethod}
            />
          </View>

          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Kimlik doğrulama</AppText>
            <ChipSelect options={AUTH_KINDS} value={authKind} onChange={setAuthKind} />
          </View>

          {authKind !== 'none' ? (
            <FormRow>
              {authKind === 'header_key' ? (
                <TextField label="Başlık adı" value={headerName} onChangeText={setHeaderName} containerStyle={styles.grow} placeholder="X-API-Key" />
              ) : null}
              {authKind === 'query_key' ? (
                <TextField label="Sorgu parametresi" value={queryParam} onChangeText={setQueryParam} containerStyle={styles.grow} placeholder="api_key" />
              ) : null}
              {authKind === 'basic' ? (
                <TextField label="Kullanıcı adı" value={username} onChangeText={setUsername} containerStyle={styles.grow} />
              ) : null}
              <TextField
                label="API anahtarı / token"
                value={secret}
                onChangeText={setSecret}
                secure
                autoCapitalize="none"
                containerStyle={styles.grow}
                hint="Vault'ta şifreli saklanır; istemciye geri gönderilmez."
              />
            </FormRow>
          ) : null}

          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Sayfalama</AppText>
            <ChipSelect options={PAGINATION} value={pagination} onChange={setPagination} />
          </View>
          {pagination === 'page' || pagination === 'cursor' ? (
            <TextField label="Sayfalama parametresi" value={paginationParam} onChangeText={setPaginationParam} />
          ) : null}

          <FormRow>
            <TextField label="Zaman dilimi" value={timezone} onChangeText={setTimezone} containerStyle={styles.grow} />
            <TextField
              label="Kontrol sıklığı (dk)"
              value={pollInterval}
              onChangeText={setPollInterval}
              keyboardType="number-pad"
              containerStyle={styles.grow}
              hint="5–1440"
            />
            <TextField
              label="Tarih filtresi parametresi"
              value={sinceParam}
              onChangeText={setSinceParam}
              containerStyle={styles.grow}
              placeholder="since"
            />
          </FormRow>
        </>
      ) : step === 2 ? (
        <>
          <View style={newsApiStyles.row}>
            <Button
              label={test.isPending ? 'Test ediliyor…' : 'Bağlantıyı Test Et'}
              size="sm"
              fullWidth={false}
              loading={test.isPending}
              onPress={testConfig}
            />
            <AppText variant="caption" color="textTertiary" style={newsApiStyles.flex}>
              Test sunucudan yapılır; SSRF, boyut, süre ve XML güvenliği uygulanır. Test sırasında hiçbir haber
              yayımlanmaz.
            </AppText>
          </View>
          {test.isPending ? (
            <ActivityIndicator />
          ) : result ? (
            <NewsTestResultView result={result} />
          ) : (
            <EmptyHint text="Bağlantıyı test et. Başarılı test olmadan kaynak etkinleştirilemez." />
          )}
        </>
      ) : step === 3 ? (
        <>
          <AppText variant="caption" color="textSecondary">
            Test yanıtındaki alanlardan otomatik eşleştirme yapıldı. Gerekirse yolları düzelt. Başlık ve URL zorunlu.
          </AppText>
          <View style={newsApiStyles.row}>
            <Button
              label="Otomatik eşleştir"
              size="sm"
              variant="outline"
              fullWidth={false}
              onPress={() => setMappingValues(guessMappings(result?.fields ?? []))}
            />
            <AppText variant="caption" color="textTertiary">
              {result?.fields.length ?? 0} alan algılandı
            </AppText>
          </View>
          {MAPPING_FIELDS.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              value={mappingValues[field.key] ?? ''}
              onChangeText={(value) => setMappingValues((current) => ({ ...current, [field.key]: value }))}
              autoCapitalize="none"
              placeholder="alan.yolu"
            />
          ))}
          {result && result.fields.length > 0 ? (
            <View style={[styles.fieldBox, { borderColor: theme.colors.border }]}>
              <AppText variant="caption" color="textTertiary">
                Algılanan alanlar: {result.fields.slice(0, 30).join(' · ')}
              </AppText>
            </View>
          ) : null}
        </>
      ) : step === 4 ? (
        <>
          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Hangi kategoriler çekilsin?</AppText>
            <ChipSelect
              options={catalog.categories.map((row) => ({ value: row.slug, label: row.name }))}
              multiple
              values={selectedCategories}
              onToggle={(value) =>
                setSelectedCategories((current) =>
                  current.includes(value) ? current.filter((row) => row !== value) : [...current, value],
                )
              }
            />
          </View>

          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Haber türü</AppText>
            <ChipSelect
              options={[
                { value: 'breaking', label: 'Son dakika' },
                { value: 'trabzon', label: 'Trabzon gündemi' },
                { value: 'trabzonspor', label: 'Trabzonspor' },
                { value: 'economy', label: 'Ekonomi' },
                { value: 'public_notice', label: 'Kamu duyuruları' },
              ]}
              multiple
              values={newsTypes}
              onToggle={(value) =>
                setNewsTypes((current) => (current.includes(value) ? current.filter((row) => row !== value) : [...current, value]))
              }
            />
          </View>

          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Konum</AppText>
            <ChipSelect options={LOCATION_MODES} value={locationMode} onChange={setLocationMode} />
            {locationMode === 'selected_districts' ? (
              <ChipSelect
                options={districts.map((row) => ({ value: row.slug, label: row.name }))}
                multiple
                values={selectedDistricts}
                onToggle={(value) =>
                  setSelectedDistricts((current) =>
                    current.includes(value) ? current.filter((row) => row !== value) : [...current, value],
                  )
                }
              />
            ) : null}
          </View>

          <ToggleRow title="Yalnız görselli haberler" value={hasImage} onValueChange={setHasImage} />
        </>
      ) : step === 5 ? (
        <>
          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Kaynak lisans durumu</AppText>
            <ChipSelect
              options={catalog.license_statuses.map((row) => ({ value: row.value, label: LICENSE_LABELS[row.value] ?? row.label }))}
              value={license}
              onChange={setLicense}
            />
          </View>
          <TextField label="Lisans notu" value={licenseNote} onChangeText={setLicenseNote} multiline style={styles.multiline} />
          <ToggleRow
            title="Tam metin yayın hakkı"
            description="MOD A kaynak profilinde tam metin yayını için gerekir."
            value={canText}
            onValueChange={setCanText}
          />
          <ToggleRow
            title="Özet kullanım hakkı"
            description="MOD B derleme ve editör onaylı yayın için gerekir."
            value={canSummary}
            onValueChange={setCanSummary}
          />
          <ToggleRow title="Görsel kullanım hakkı" value={canImages} onValueChange={setCanImages} />
          <TextField
            label="Atıf metni"
            value={attribution}
            onChangeText={setAttribution}
            placeholder="Kaynak: ..."
            hint="Boş bırakılırsa kaynak sitesi atıf olarak kullanılır."
          />

          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Yayın modu</AppText>
            <ChipSelect options={publishModeOptions} value={mode} onChange={setPublishMode} />
            <AppText variant="caption" color="textTertiary">
              {mode === 'discovery'
                ? 'Yalnızca keşif: haberler toplanır, yayımlanmaz.'
                : mode === 'source_profile'
                  ? 'MOD A: izin verilen içerik kaynak profilinde paylaşılır.'
                  : mode === 'trabzone_digest'
                    ? 'MOD B: Trabzone Haber derlemesi hazırlanır.'
                    : 'MOD C: taslak hazırlanır, editör onayı olmadan yayımlanmaz.'}
            </AppText>
          </View>

          <View style={newsApiStyles.gapSm}>
            <AppText variant="label">Yayıncı profili</AppText>
            <TextField
              value={publisherSearch}
              onChangeText={setPublisherSearch}
              placeholder="Trabzone profili ara"
              autoCapitalize="none"
            />
            {selectedPublisher ? (
              <View style={[styles.publisher, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft }]}>
                <AppText variant="label">
                  {selectedPublisher.display_name ?? selectedPublisher.username ?? 'Profil'}
                </AppText>
                <AppText variant="caption" color="textSecondary">
                  @{selectedPublisher.username ?? '—'}
                </AppText>
                <Button label="Kaldır" size="sm" variant="ghost" fullWidth={false} onPress={() => setPublisherId(null)} />
              </View>
            ) : (
              <EmptyHint text="Otomatik yayın için bir yayıncı profili seç. Sadece keşif modunda gerekmez." />
            )}
            <View style={styles.publisherList}>
              {(publishers.data?.items ?? [])
                .filter((row) => row.id !== publisherId)
                .slice(0, 6)
                .map((row) => (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    onPress={() => setPublisherId(row.id)}
                    style={[styles.publisherRow, { borderColor: theme.colors.border }]}
                  >
                    <AppText variant="caption" numberOfLines={1} style={newsApiStyles.flex}>
                      {row.display_name ?? row.username ?? row.id}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      @{row.username ?? '—'}
                    </AppText>
                  </Pressable>
                ))}
            </View>
          </View>

          <ToggleRow
            title="Otomatik yayını hemen aç"
            description={
              mode === 'discovery' || !publisherId
                ? 'Yayın modu keşif dışında ve yayıncı profili seçili olmalı.'
                : 'Kaynak etkinleştirildikten sonra uygun haberler otomatik yayımlanır.'
            }
            value={autoPublish}
            onValueChange={setAutoPublishState}
            disabled={mode === 'discovery' || !publisherId}
          />
        </>
      ) : (
        <>
          <View style={[styles.summary, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
            <AppText variant="label">Özet</AppText>
            <AppText variant="body">Kaynak: {name || '—'}</AppText>
            <AppText variant="caption" color="textSecondary">
              Tür: {CONNECTOR_LABELS[connector] ?? connector} · Adres: {feedUrl || '—'}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              Kategori: {selectedCategories.length > 0 ? selectedCategories.join(', ') : 'Tümü (Trabzon bağlantılı)'}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              Konum: {LOCATION_MODES.find((row) => row.value === locationMode)?.label ?? locationMode}
              {locationMode === 'selected_districts' ? ` · ${selectedDistricts.length} ilçe` : ''}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              Lisans: {LICENSE_LABELS[license]} · Mod: {MODE_LABELS[mode]} · Otomatik yayın:{' '}
              {autoPublish && mode !== 'discovery' && publisherId ? 'açık' : 'kapalı'}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              Etkinleştirme sırası: bağlantı kaydı → alan eşleştirme → filtreler → izinler → sunucu testi → durum açık.
              Test başarısız olursa kaynak açılmaz.
            </AppText>
          </View>
          {error ? (
            <AppText variant="caption" color="danger">
              {error}
            </AppText>
          ) : null}
        </>
      )}

      {error && step !== STEPS.length - 1 ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </NewsModalShell>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  step: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  template: {
    flexBasis: 260,
    flexGrow: 1,
    minWidth: 220,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 11,
  },
  grow: { flex: 1, minWidth: 200 },
  multiline: { minHeight: 72 },
  fieldBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 9 },
  success: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 13 },
  summary: { gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 13 },
  publisher: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, padding: 9 },
  publisherList: { gap: 4 },
  publisherRow: { flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7 },
});
