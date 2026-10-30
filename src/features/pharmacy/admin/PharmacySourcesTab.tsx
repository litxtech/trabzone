import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAdminPharmacySources,
  useTestAdminPharmacySource,
  useUpsertAdminPharmacySource,
} from '../hooks/use-pharmacy';
import type { PharmacySource, PharmacySourceTestResult } from '../types';
import {
  adminPharmacyStyles,
  EmptyHint,
  formatDateTime,
  Pill,
  RowCard,
} from './shared';

const KINDS = [
  { key: 'official_portal', label: 'Resmî portal' },
  { key: 'official_api', label: 'Resmî API' },
  { key: 'commercial_api', label: 'Ticari API' },
  { key: 'partner', label: 'Partner' },
  { key: 'manual', label: 'Manuel aktarım' },
];

export function PharmacySourcesTab({ canManage }: { canManage: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const query = useAdminPharmacySources();
  const save = useUpsertAdminPharmacySource();
  const test = useTestAdminPharmacySource();
  const [testResult, setTestResult] = useState<PharmacySourceTestResult | null>(null);

  const [form, setForm] = useState({
    key: '',
    name: '',
    kind: 'manual',
    homepageUrl: '',
    termsUrl: '',
    licenseNote: '',
    secretRef: '',
    priority: '100',
    interval: '60',
    enabled: false,
    verified: false,
    primary: false,
  });

  async function persist(source: PharmacySource | null, overrides: Record<string, unknown> = {}) {
    try {
      await save.mutateAsync({
        ...(source
          ? {
              id: source.id,
              key: source.key,
              name: source.name,
              kind: source.kind,
              homepage_url: source.homepage_url ?? '',
              terms_url: source.terms_url ?? '',
              license_note: source.license_note ?? '',
              attribution_text: source.attribution_text ?? '',
              priority: source.priority,
              sync_interval_minutes: source.sync_interval_minutes,
              enabled: source.is_enabled,
              verified_license: source.verified_license,
              is_primary: source.is_primary,
            }
          : {
              key: form.key.trim().toLowerCase(),
              name: form.name.trim() || form.key.trim(),
              kind: form.kind,
              homepage_url: form.homepageUrl.trim(),
              terms_url: form.termsUrl.trim(),
              license_note: form.licenseNote.trim(),
              api_secret_ref: form.secretRef.trim(),
              priority: Number(form.priority) || 100,
              sync_interval_minutes: Number(form.interval) || 60,
              enabled: form.enabled,
              verified_license: form.verified,
              is_primary: form.primary,
            }),
        ...overrides,
      });
      toast.success('Veri kaynağı kaydedildi.');
      setForm((prev) => ({ ...prev, key: '', name: '', licenseNote: '', secretRef: '' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kaynak kaydedilemedi.';
      toast.error(
        message.includes('secret_must_be_env_name')
          ? 'API anahtarı alanına yalnızca ortam değişkeni adı yazılmalı (örn. COLLECTAPI_KEY).'
          : message,
      );
    }
  }

  async function runTest(source: PharmacySource) {
    try {
      const result = await test.mutateAsync(source.id);
      setTestResult(result);
      if (result.ready) {
        toast.success('Kaynak yapılandırması hazır.');
      } else {
        toast.info('Kaynak hazır değil: etkin ve lisansı doğrulanmış olmalı.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bağlantı testi çalıştırılamadı.');
    }
  }

  const sources = query.data?.items ?? [];
  const logs = query.data?.logs ?? [];

  return (
    <View style={adminPharmacyStyles.stack}>
      <AdminSection
        title="API ve kaynak yönetimi"
        subtitle="Birincil ve yedek kaynaklar, lisans doğrulaması ve senkronizasyon günlükleri"
      >
        <AppText variant="caption" color="textTertiary">
          API anahtarları yalnızca sunucuda saklanır. Bu alan anahtarın kendisini değil, sunucudaki
          ortam değişkeninin adını taşır. Kamuya açık bir listenin görüntülenebilir olması otomatik
          çekme veya yeniden yayımlama izni anlamına gelmez.
        </AppText>
        {testResult ? (
          <View
            style={[
              styles.result,
              {
                borderColor: testResult.ready ? theme.colors.success : theme.colors.warning,
                backgroundColor: testResult.ready ? theme.colors.successSoft : theme.colors.warningSoft,
              },
            ]}
          >
            <AppText variant="bodyStrong">
              {testResult.key} · {testResult.ready ? 'Hazır' : 'Hazır değil'}
            </AppText>
            <View style={adminPharmacyStyles.inline}>
              {testResult.checks.map((check) => (
                <Pill
                  key={check.key}
                  icon={check.ok ? 'checkmark-circle-outline' : 'close-circle-outline'}
                  label={check.label}
                  tone={check.ok ? 'success' : 'danger'}
                />
              ))}
            </View>
            <AppText variant="caption" color="textTertiary">
              Son başarı: {formatDateTime(testResult.last_success_at)}
              {testResult.last_error ? ` · Son hata: ${testResult.last_error}` : ''}
            </AppText>
          </View>
        ) : null}
      </AdminSection>

      {query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : query.isError ? (
        <EmptyHint
          icon="cloud-offline-outline"
          title="Kaynaklar yüklenemedi"
          text={query.error instanceof Error ? query.error.message : undefined}
        />
      ) : sources.length === 0 ? (
        <EmptyHint icon="git-network-outline" title="Kayıtlı veri kaynağı yok" />
      ) : (
        <AdminSection title="Kaynaklar" subtitle={`${sources.length} kaynak`}>
          <View style={adminPharmacyStyles.stack}>
            {sources.map((source) => (
              <RowCard
                key={source.id}
                title={source.name}
                subtitle={`${source.key} · ${source.kind}`}
                badges={
                  <>
                    {source.is_primary ? <Badge label="Birincil" tone="primary" /> : null}
                    {source.is_enabled ? (
                      <Badge label="Etkin" tone="success" />
                    ) : (
                      <Badge label="Kapalı" tone="neutral" />
                    )}
                    {source.verified_license ? (
                      <Badge label="Lisans doğrulandı" tone="success" />
                    ) : (
                      <Badge label="Lisans doğrulanmadı" tone="warning" />
                    )}
                  </>
                }
                meta={
                  <>
                    <Pill icon="time-outline" label={`Son çalışma: ${formatDateTime(source.last_run_at)}`} />
                    <Pill
                      icon="checkmark-done-outline"
                      label={`Son başarı: ${formatDateTime(source.last_success_at)}`}
                      tone={source.last_success_at ? 'success' : 'warning'}
                    />
                    <Pill icon="refresh-outline" label={`Her ${source.sync_interval_minutes} dk`} />
                    {source.api_secret_ref ? (
                      <Pill icon="key-outline" label={`Env: ${source.api_secret_ref}`} />
                    ) : null}
                  </>
                }
                actions={
                  canManage ? (
                    <>
                      <Button
                        label="Bağlantıyı test et"
                        size="sm"
                        variant="secondary"
                        fullWidth={false}
                        loading={test.isPending}
                        onPress={() => void runTest(source)}
                      />
                      <Button
                        label={source.is_enabled ? 'Devre dışı bırak' : 'Etkinleştir'}
                        size="sm"
                        variant={source.is_enabled ? 'ghost' : 'primary'}
                        fullWidth={false}
                        loading={save.isPending}
                        onPress={() => void persist(source, { enabled: !source.is_enabled })}
                      />
                      <Button
                        label={source.verified_license ? 'Lisansı geri al' : 'Lisansı doğrula'}
                        size="sm"
                        variant="ghost"
                        fullWidth={false}
                        onPress={() =>
                          void persist(source, { verified_license: !source.verified_license })
                        }
                      />
                      <Button
                        label={source.is_primary ? 'Birincilliği kaldır' : 'Birincil yap'}
                        size="sm"
                        variant="ghost"
                        fullWidth={false}
                        onPress={() => void persist(source, { is_primary: !source.is_primary })}
                      />
                    </>
                  ) : null
                }
              />
            ))}
          </View>
          {sources.some((source) => source.last_error) ? (
            <View style={styles.errors}>
              <AppText variant="caption" color="danger">
                Son hatalar
              </AppText>
              {sources
                .filter((source) => source.last_error)
                .map((source) => (
                  <AppText key={source.id} variant="caption" color="textSecondary">
                    {source.key}: {source.last_error}
                  </AppText>
                ))}
            </View>
          ) : null}
        </AdminSection>
      )}

      <AdminSection title="Yeni kaynak ekle" subtitle="Anahtar alanına anahtarın kendisini yazmayın">
        <View style={adminPharmacyStyles.formRow}>
          <TextField
            label="Anahtar (key)"
            value={form.key}
            onChangeText={(value) => setForm((prev) => ({ ...prev, key: value }))}
            placeholder="collectapi"
            containerStyle={adminPharmacyStyles.grow}
            autoCapitalize="none"
          />
          <TextField
            label="Ad"
            value={form.name}
            onChangeText={(value) => setForm((prev) => ({ ...prev, name: value }))}
            placeholder="CollectAPI nöbetçi eczane"
            containerStyle={adminPharmacyStyles.grow}
          />
        </View>
        <View style={{ gap: 8 }}>
          <AppText variant="caption" color="textTertiary">
            Kaynak türü
          </AppText>
          <FilterChips
            options={KINDS.map((item) => ({ key: item.key, label: item.label }))}
            value={form.kind}
            onChange={(next) => setForm((prev) => ({ ...prev, kind: next }))}
          />
        </View>
        <View style={adminPharmacyStyles.formRow}>
          <TextField
            label="Ana sayfa"
            value={form.homepageUrl}
            onChangeText={(value) => setForm((prev) => ({ ...prev, homepageUrl: value }))}
            containerStyle={adminPharmacyStyles.grow}
            placeholder="https://…"
            autoCapitalize="none"
          />
          <TextField
            label="Kullanım koşulları"
            value={form.termsUrl}
            onChangeText={(value) => setForm((prev) => ({ ...prev, termsUrl: value }))}
            containerStyle={adminPharmacyStyles.grow}
            placeholder="https://…"
            autoCapitalize="none"
          />
        </View>
        <TextField
          label="Lisans notu"
          value={form.licenseNote}
          onChangeText={(value) => setForm((prev) => ({ ...prev, licenseNote: value }))}
          placeholder="Yeniden yayımlama izni, sözleşme no…"
          multiline
        />
        <View style={adminPharmacyStyles.formRow}>
          <TextField
            label="Ortam değişkeni adı"
            value={form.secretRef}
            onChangeText={(value) => setForm((prev) => ({ ...prev, secretRef: value }))}
            containerStyle={adminPharmacyStyles.grow}
            placeholder="COLLECTAPI_KEY"
            autoCapitalize="characters"
          />
          <TextField
            label="Öncelik"
            value={form.priority}
            onChangeText={(value) => setForm((prev) => ({ ...prev, priority: value }))}
            containerStyle={adminPharmacyStyles.grow}
            keyboardType="number-pad"
          />
          <TextField
            label="Senkron (dk)"
            value={form.interval}
            onChangeText={(value) => setForm((prev) => ({ ...prev, interval: value }))}
            containerStyle={adminPharmacyStyles.grow}
            keyboardType="number-pad"
          />
        </View>
        <View style={adminPharmacyStyles.inline}>
          <Button
            label={form.enabled ? 'Etkin' : 'Kapalı'}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => setForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
          />
          <Button
            label={form.verified ? 'Lisans doğrulandı' : 'Lisans doğrulanmadı'}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => setForm((prev) => ({ ...prev, verified: !prev.verified }))}
          />
          <Button
            label={form.primary ? 'Birincil kaynak' : 'Yedek kaynak'}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => setForm((prev) => ({ ...prev, primary: !prev.primary }))}
          />
        </View>
        <Button
          label="Kaynağı ekle"
          size="sm"
          fullWidth={false}
          loading={save.isPending}
          disabled={!canManage || form.key.trim().length < 3}
          onPress={() => void persist(null)}
        />
        {!canManage ? (
          <AppText variant="caption" color="warning">
            Kaynak eklemek için pharmacy.manage izni gerekir.
          </AppText>
        ) : null}
      </AdminSection>

      <AdminSection title="Senkronizasyon günlükleri" subtitle="Son 20 çalışma">
        {logs.length === 0 ? (
          <EmptyHint icon="documents-outline" title="Henüz senkronizasyon kaydı yok" />
        ) : (
          <View style={adminPharmacyStyles.stack}>
            {logs.map((log) => (
              <RowCard
                key={log.id}
                title={log.source_key ?? 'Kaynak silinmiş'}
                subtitle={`${log.run_kind} · ${formatDateTime(log.started_at)}${
                  log.duration_ms != null ? ` · ${log.duration_ms} ms` : ''
                }`}
                badges={
                  <Badge
                    label={log.status}
                    tone={
                      log.status === 'success'
                        ? 'success'
                        : log.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    }
                  />
                }
                meta={
                  <>
                    <Pill label={`Alınan: ${log.records_received}`} />
                    <Pill label={`Eşleşen: ${log.records_matched}`} tone="success" />
                    <Pill
                      label={`Eşleşmeyen: ${log.records_unmatched}`}
                      tone={log.records_unmatched > 0 ? 'warning' : 'neutral'}
                    />
                    <Pill
                      label={`Reddedilen: ${log.records_rejected}`}
                      tone={log.records_rejected > 0 ? 'danger' : 'neutral'}
                    />
                    <Pill label={`Yazılan: ${log.duty_written}`} />
                    <Pill
                      label={`Çelişki: ${log.conflicts}`}
                      tone={log.conflicts > 0 ? 'danger' : 'neutral'}
                    />
                  </>
                }
              />
            ))}
          </View>
        )}
      </AdminSection>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 24, alignItems: 'center' },
  result: { padding: 12, gap: 8, borderWidth: 1, borderRadius: 12 },
  errors: { gap: 4 },
});
