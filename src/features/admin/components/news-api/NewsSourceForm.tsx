import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useNewsApiClearCredentials,
  useNewsApiSaveAdapter,
  useNewsApiSaveConnection,
  useNewsApiSaveCredentials,
} from '../../hooks/use-admin-news-api';
import type {
  NewsConnection,
  NewsConnectorKind,
  NewsTestResult,
} from '@/features/news-api/types';
import { useAdminToast } from '../AdminToast';

import { ChipSelect, FormRow, InfoRow, newsApiStyles } from './shared';

const CONNECTORS: { value: NewsConnectorKind; label: string }[] = [
  { value: 'rss', label: 'RSS 2.0' },
  { value: 'atom', label: 'Atom' },
  { value: 'xml', label: 'XML Feed' },
  { value: 'json_feed', label: 'JSON Feed' },
  { value: 'rest_json', label: 'REST JSON API' },
  { value: 'custom_api', label: 'Belgeli özel API' },
];

const AUTH_KINDS = [
  { value: 'none', label: 'Kimlik doğrulama yok' },
  { value: 'header_key', label: 'API anahtarı (başlık)' },
  { value: 'query_key', label: 'API anahtarı (sorgu)' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Kullanıcı adı + şifre' },
];

const PAGINATION = [
  { value: 'auto', label: 'Otomatik' },
  { value: 'none', label: 'Yok' },
  { value: 'page', label: 'Sayfa numarası' },
  { value: 'next_url', label: 'Sonraki URL' },
  { value: 'cursor', label: 'Cursor' },
];

function num(value: string, fallback: number) {
  const parsed = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function NewsSourceForm({
  connection,
  canManage,
  onSaved,
}: {
  connection: NewsConnection;
  canManage: boolean;
  onSaved?: (next: NewsConnection) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useNewsApiSaveConnection();
  const saveAdapter = useNewsApiSaveAdapter();
  const credentials = useNewsApiSaveCredentials();
  const clearCredentials = useNewsApiClearCredentials();

  const [name, setName] = useState(connection.name);
  const [description, setDescription] = useState(connection.description ?? '');
  const [homepage, setHomepage] = useState(connection.homepage_url ?? '');
  const [feedUrl, setFeedUrl] = useState(connection.feed_url);
  const [connector, setConnector] = useState<NewsConnectorKind>(connection.connector_kind);
  const [httpMethod, setHttpMethod] = useState(connection.http_method || 'GET');
  const [authKind, setAuthKind] = useState(connection.auth_kind || 'none');
  const [headerName, setHeaderName] = useState(connection.auth_header_name ?? '');
  const [queryParam, setQueryParam] = useState(connection.auth_query_param ?? '');
  const [username, setUsername] = useState(connection.auth_username ?? '');
  const [secret, setSecret] = useState('');
  const [itemsPath, setItemsPath] = useState(connection.items_path ?? '');
  const [paramsText, setParamsText] = useState(JSON.stringify(connection.default_params ?? {}, null, 0));
  const [pagination, setPagination] = useState(connection.pagination_kind || 'auto');
  const [paginationParam, setPaginationParam] = useState(connection.pagination_param ?? '');
  const [nextPath, setNextPath] = useState(connection.next_path ?? '');
  const [sinceParam, setSinceParam] = useState(connection.since_param ?? '');
  const [timezone, setTimezone] = useState(connection.timezone || 'Europe/Istanbul');
  const [pollInterval, setPollInterval] = useState(String(connection.poll_interval_minutes));
  const [maxItems, setMaxItems] = useState(String(connection.max_items_per_run));
  const [pageLimit, setPageLimit] = useState(String(connection.page_limit));
  const [timeoutMs, setTimeoutMs] = useState(String(connection.request_timeout_ms));
  const [maxBytes, setMaxBytes] = useState(String(connection.max_response_bytes));
  const [retryCount, setRetryCount] = useState(String(connection.retry_count));
  const [backoff, setBackoff] = useState(String(connection.backoff_seconds));
  const [budget, setBudget] = useState(String(connection.daily_request_budget));
  const [minInterval, setMinInterval] = useState(String(connection.min_publish_interval_seconds));
  const [aiClassification, setAiClassification] = useState(connection.ai_classification);
  const [notes, setNotes] = useState(connection.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [testDetail, setTestDetail] = useState<NewsTestResult | null>(connection.last_test_detail ?? null);

  // Bağlantı kaydı değiştiğinde form alanları render sırasında bir kez
  // senkronlanır; effect içinde setState çağrısı yapılmaz.
  const [syncedConnection, setSyncedConnection] = useState<NewsConnection | null>(null);
  if (syncedConnection !== connection) {
    setSyncedConnection(connection);
    setName(connection.name);
    setDescription(connection.description ?? '');
    setHomepage(connection.homepage_url ?? '');
    setFeedUrl(connection.feed_url);
    setConnector(connection.connector_kind);
    setHttpMethod(connection.http_method || 'GET');
    setAuthKind(connection.auth_kind || 'none');
    setHeaderName(connection.auth_header_name ?? '');
    setQueryParam(connection.auth_query_param ?? '');
    setUsername(connection.auth_username ?? '');
    setItemsPath(connection.items_path ?? '');
    setParamsText(JSON.stringify(connection.default_params ?? {}, null, 0));
    setPagination(connection.pagination_kind || 'auto');
    setPaginationParam(connection.pagination_param ?? '');
    setNextPath(connection.next_path ?? '');
    setSinceParam(connection.since_param ?? '');
    setTimezone(connection.timezone || 'Europe/Istanbul');
    setPollInterval(String(connection.poll_interval_minutes));
    setMaxItems(String(connection.max_items_per_run));
    setPageLimit(String(connection.page_limit));
    setTimeoutMs(String(connection.request_timeout_ms));
    setMaxBytes(String(connection.max_response_bytes));
    setRetryCount(String(connection.retry_count));
    setBackoff(String(connection.backoff_seconds));
    setBudget(String(connection.daily_request_budget));
    setMinInterval(String(connection.min_publish_interval_seconds));
    setAiClassification(connection.ai_classification);
    setNotes(connection.notes ?? '');
    setTestDetail(connection.last_test_detail ?? null);
  }

  const submit = async () => {
    setError(null);
    let params: Record<string, unknown> = {};
    try {
      params = paramsText.trim() ? (JSON.parse(paramsText) as Record<string, unknown>) : {};
    } catch {
      setError('Varsayılan parametreler geçerli bir JSON nesnesi olmalı. Örnek: {"il": "61"}');
      return;
    }
    try {
      const next = await save.mutateAsync({
        id: connection.id,
        name: name.trim(),
        description: description.trim() || null,
        homepage_url: homepage.trim() || null,
        feed_url: feedUrl.trim(),
        connector_kind: connector,
        http_method: httpMethod,
        auth_kind: authKind,
        auth_header_name: authKind === 'header_key' ? headerName.trim() || null : null,
        auth_query_param: authKind === 'query_key' ? queryParam.trim() || null : null,
        auth_username: authKind === 'basic' ? username.trim() || null : null,
        default_params: params,
        items_path: itemsPath.trim() || null,
        pagination_kind: pagination,
        pagination_param: paginationParam.trim() || null,
        next_path: nextPath.trim() || null,
        since_param: sinceParam.trim() || null,
        timezone: timezone.trim() || 'Europe/Istanbul',
        poll_interval_minutes: num(pollInterval, 30),
        max_items_per_run: num(maxItems, 20),
        page_limit: num(pageLimit, 1),
        request_timeout_ms: num(timeoutMs, 12000),
        max_response_bytes: num(maxBytes, 2097152),
        retry_count: Number(retryCount) || 0,
        backoff_seconds: num(backoff, 300),
        daily_request_budget: num(budget, 480),
        min_publish_interval_seconds: Number(minInterval) || 0,
        ai_classification: aiClassification,
        notes: notes.trim() || null,
      });
      const persisted = await saveAdapter.mutateAsync({
        id: next.id,
        items_path: itemsPath.trim() || null,
        pagination_kind: pagination,
        pagination_param: paginationParam.trim() || null,
        next_path: nextPath.trim() || null,
        since_param: sinceParam.trim() || null,
        auth_username: authKind === 'basic' ? username.trim() || null : null,
      });
      toast.success('Kaynak bağlantısı kaydedildi.');
      onSaved?.(persisted);
    } catch (saveError) {
      setError(errorMessage(saveError, 'Bağlantı kaydedilemedi.'));
    }
  };

  const saveSecret = async () => {
    if (secret.trim().length < 4) {
      setError('API anahtarı en az 4 karakter olmalı.');
      return;
    }
    setError(null);
    try {
      await credentials.mutateAsync({
        id: connection.id,
        secret: secret.trim(),
        authKind,
        headerName: headerName.trim() || null,
        queryParam: queryParam.trim() || null,
        username: username.trim() || null,
      });
      setSecret('');
      toast.success('API anahtarı Vault üzerinde şifreli olarak saklandı.');
    } catch (secretError) {
      setError(errorMessage(secretError, 'API anahtarı kaydedilemedi.'));
    }
  };

  const removeSecret = async () => {
    try {
      await clearCredentials.mutateAsync(connection.id);
      toast.success('Kayıtlı API anahtarı silindi.');
    } catch (clearError) {
      setError(errorMessage(clearError, 'API anahtarı silinemedi.'));
    }
  };

  return (
    <View style={newsApiStyles.gap}>
      <View>
        <InfoRow label="Durum" value={<Badge label={connection.status} tone="neutral" />} />
        <InfoRow label="Kimlik bilgisi" value={connection.has_credentials ? `Kayıtlı · ${connection.secret_hint ?? '••••'}` : 'Kayıtlı değil'} />
        <InfoRow label="Son test" value={connection.last_test_ok == null ? 'Hiç test edilmedi' : connection.last_test_ok ? 'Başarılı' : 'Başarısız'} />
      </View>

      <FormRow>
        <TextField label="Kaynak adı" value={name} onChangeText={setName} containerStyle={styles.flex} editable={canManage} />
        <TextField label="Resmî site" value={homepage} onChangeText={setHomepage} autoCapitalize="none" containerStyle={styles.flex} editable={canManage} placeholder="https://ornek.com" />
      </FormRow>

      <TextField
        label="Açıklama"
        value={description}
        onChangeText={setDescription}
        multiline
        style={styles.multiline}
        editable={canManage}
      />

      <TextField
        label="Feed / API adresi"
        value={feedUrl}
        onChangeText={setFeedUrl}
        autoCapitalize="none"
        editable={canManage}
        hint="Yalnızca HTTPS genel adresler kabul edilir. Özel IP, localhost ve metadata adresleri reddedilir."
      />

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label" color="textSecondary">
          Kaynak türü
        </AppText>
        <ChipSelect options={CONNECTORS} value={connector} onChange={(value) => canManage && setConnector(value)} />
      </View>

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label" color="textSecondary">
          İstek yöntemi
        </AppText>
        <ChipSelect
          options={[
            { value: 'GET', label: 'GET' },
            { value: 'POST', label: 'POST' },
          ]}
          value={httpMethod}
          onChange={(value) => canManage && setHttpMethod(value)}
        />
      </View>

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label" color="textSecondary">
          Kimlik doğrulama
        </AppText>
        <ChipSelect options={AUTH_KINDS} value={authKind} onChange={(value) => canManage && setAuthKind(value)} />
      </View>

      {authKind === 'header_key' || authKind === 'query_key' || authKind === 'basic' ? (
        <FormRow>
          {authKind === 'header_key' ? (
            <TextField label="Başlık adı" value={headerName} onChangeText={setHeaderName} placeholder="X-API-Key" containerStyle={styles.flex} editable={canManage} />
          ) : null}
          {authKind === 'query_key' ? (
            <TextField label="Sorgu parametresi" value={queryParam} onChangeText={setQueryParam} placeholder="api_key" containerStyle={styles.flex} editable={canManage} />
          ) : null}
          {authKind === 'basic' ? (
            <TextField label="Kullanıcı adı" value={username} onChangeText={setUsername} containerStyle={styles.flex} editable={canManage} />
          ) : null}
        </FormRow>
      ) : null}

      {authKind !== 'none' ? (
        <View style={[styles.secretBox, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}>
          <AppText variant="label">API anahtarı / token</AppText>
          <AppText variant="caption" color="textTertiary">
            Anahtar Supabase Vault’ta şifreli saklanır, istemciye geri gönderilmez ve kayıtlarda maskelenir.
          </AppText>
          <FormRow>
            <TextField
              label="Yeni anahtar"
              value={secret}
              onChangeText={setSecret}
              secure
              autoCapitalize="none"
              placeholder={connection.has_credentials ? 'Değiştirmek için yeni anahtar gir' : 'Anahtarı gir'}
              containerStyle={styles.flex}
              editable={canManage}
            />
            <View style={styles.secretActions}>
              <Button
                label="Anahtarı kaydet"
                size="sm"
                fullWidth={false}
                loading={credentials.isPending}
                disabled={!canManage || secret.trim().length < 4}
                onPress={() => void saveSecret()}
              />
              {connection.has_credentials ? (
                <Button
                  label="Anahtarı sil"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  loading={clearCredentials.isPending}
                  disabled={!canManage}
                  onPress={() => void removeSecret()}
                />
              ) : null}
            </View>
          </FormRow>
        </View>
      ) : null}

      <FormRow>
        <TextField label="Öğe yolu (opsiyonel)" value={itemsPath} onChangeText={setItemsPath} placeholder="data.items" containerStyle={styles.flex} editable={canManage} hint="JSON yanıtta haber dizisinin yolu." />
        <TextField label="Varsayılan parametreler (JSON)" value={paramsText} onChangeText={setParamsText} containerStyle={styles.flex} editable={canManage} hint='Örnek: {"il":"61"}' autoCapitalize="none" />
      </FormRow>

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label" color="textSecondary">
          Sayfalama
        </AppText>
        <ChipSelect options={PAGINATION} value={pagination} onChange={(value) => canManage && setPagination(value)} />
      </View>

      {pagination === 'page' || pagination === 'cursor' ? (
        <TextField label="Sayfalama parametresi" value={paginationParam} onChangeText={setPaginationParam} placeholder="page" editable={canManage} />
      ) : null}
      {pagination === 'next_url' ? (
        <TextField label="Sonraki sayfa yolu" value={nextPath} onChangeText={setNextPath} placeholder="next" editable={canManage} />
      ) : null}

      <FormRow>
        <TextField label="Zaman dilimi" value={timezone} onChangeText={setTimezone} containerStyle={styles.flex} editable={canManage} />
        <TextField label="Tarih filtresi parametresi" value={sinceParam} onChangeText={setSinceParam} containerStyle={styles.flex} editable={canManage} placeholder="since" />
      </FormRow>

      <AppText variant="label">Tarife ve kota</AppText>
      <FormRow>
        <TextField label="Kontrol sıklığı (dk)" value={pollInterval} onChangeText={setPollInterval} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="5–1440" />
        <TextField label="Çalışma başına haber" value={maxItems} onChangeText={setMaxItems} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="1–100" />
        <TextField label="Sayfa limiti" value={pageLimit} onChangeText={setPageLimit} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="1–10" />
      </FormRow>
      <FormRow>
        <TextField label="Zaman aşımı (ms)" value={timeoutMs} onChangeText={setTimeoutMs} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="2000–30000" />
        <TextField label="Maks. yanıt (bayt)" value={maxBytes} onChangeText={setMaxBytes} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="≥ 65536" />
        <TextField label="Retry sayısı" value={retryCount} onChangeText={setRetryCount} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="0–3" />
      </FormRow>
      <FormRow>
        <TextField label="Hata sonrası bekleme (sn)" value={backoff} onChangeText={setBackoff} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="30–86400" />
        <TextField label="Günlük istek bütçesi" value={budget} onChangeText={setBudget} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="10–20000" />
        <TextField label="Min. yayın aralığı (sn)" value={minInterval} onChangeText={setMinInterval} keyboardType="number-pad" containerStyle={styles.flex} editable={canManage} hint="0–86400" />
      </FormRow>

      <View style={newsApiStyles.toggleRow}>
        <View style={newsApiStyles.flex}>
          <AppText variant="label">AI sınıflandırma</AppText>
          <AppText variant="caption" color="textTertiary">
            DeepSeek ile kategori, ilçe ve hassas içerik kontrolü yapılır.
          </AppText>
        </View>
        <Button
          label={aiClassification ? 'Açık' : 'Kapalı'}
          size="sm"
          variant={aiClassification ? 'primary' : 'outline'}
          fullWidth={false}
          disabled={!canManage}
          onPress={() => setAiClassification((value) => !value)}
        />
      </View>

      <TextField label="Notlar" value={notes} onChangeText={setNotes} multiline style={styles.multiline} editable={canManage} />

      {testDetail ? (
        <View style={[styles.testNote, { borderColor: theme.colors.border }]}>
          <Ionicons
            name={testDetail.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            size={16}
            color={testDetail.ok ? theme.colors.success : theme.colors.danger}
          />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Son test: HTTP {testDetail.http_status ?? '—'} · {testDetail.item_count} haber · {testDetail.response_ms ?? 0} ms
            {testDetail.error ? ` · ${testDetail.error}` : ''}
          </AppText>
        </View>
      ) : null}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}

      {canManage ? (
        <View style={newsApiStyles.row}>
          <Button label="Bağlantıyı kaydet" size="sm" fullWidth={false} loading={save.isPending} onPress={() => void submit()} />
        </View>
      ) : (
        <AppText variant="caption" color="textTertiary">
          Bağlantıyı düzenlemek için `news.manage` yetkisi gerekir.
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 200 },
  multiline: { minHeight: 76 },
  secretBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8 },
  secretActions: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' },
  testNote: { flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
});
