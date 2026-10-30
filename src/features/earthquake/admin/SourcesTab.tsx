import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { AdminQueryState } from '@/features/explore/admin/AdminExploreShared';
import { openUrl } from '@/features/in-app-browser';
import { formatDateTime, Pill, RowCard } from '@/features/pharmacy/admin/shared';

import type { EarthquakeSource } from '../types';
import {
  adminApi,
  invokeWorker,
  useAdminEarthquakeSources,
  useAdminSyncLogs,
  useEarthquakeAdminMutation,
  type AdminSource,
} from './api';
import { HEALTH_LABELS, HEALTH_TONES, KeyValue, STATUS_LABELS, TERMS_LABELS, useReasonAction } from './ui';

type TestResult = {
  provider: string;
  ok: boolean;
  http_status?: number | null;
  latency_ms?: number;
  received_24h?: number;
  valid_24h?: number;
  rejected?: unknown[];
  error?: string;
  message?: string;
  sample_normalized?: unknown[];
};

export function SourcesTab({ canManage }: { canManage: boolean }) {
  const toast = useAdminToast();
  const sources = useAdminEarthquakeSources(true);
  const [provider, setProvider] = useState<'all' | EarthquakeSource>('all');
  const [status, setStatus] = useState<'all' | 'success' | 'partial' | 'failed' | 'skipped'>('all');
  const [offset, setOffset] = useState(0);
  const logs = useAdminSyncLogs(provider === 'all' ? null : provider, status === 'all' ? null : status, offset, true);
  const [testing, setTesting] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [backfillProvider, setBackfillProvider] = useState<EarthquakeSource>('afad');
  const [backfillDays, setBackfillDays] = useState('7');
  const [backfillOffset, setBackfillOffset] = useState('0');
  const updateSource = useEarthquakeAdminMutation(adminApi.updateSource);
  const { ask, dialog } = useReasonAction();

  const test = async (key: EarthquakeSource) => {
    setTesting(key);
    try {
      const result = await invokeWorker<TestResult>({ action: 'test', provider: key });
      setTests((prev) => ({ ...prev, [key]: result }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test başarısız.');
    } finally {
      setTesting(null);
    }
  };

  const sourceAction = (source: AdminSource, patch: Record<string, unknown>, title: string, description?: string) =>
    ask({
      title,
      description,
      run: (reason) => updateSource.mutateAsync({ key: source.key, patch, reason }),
      success: 'Kaynak güncellendi.',
    });

  const maxDays = backfillProvider === 'afad' ? 14 : 3650;

  return (
    <View style={{ gap: 14 }}>
      <AdminQueryState loading={sources.isLoading} error={sources.isError ? sources.error.message : null} onRetry={() => void sources.refetch()}>
        {(sources.data ?? []).map((source) => {
          const result = tests[source.key];
          return (
            <AdminSection key={source.key} title={`${source.name}${source.is_primary ? ' · birincil kaynak' : ' · ikincil kaynak'}`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Pill label={source.is_enabled ? HEALTH_LABELS[source.health] ?? source.health : 'Devre dışı'} tone={source.is_enabled ? HEALTH_TONES[source.health] : 'neutral'} />
                <Pill label={TERMS_LABELS[source.terms_status] ?? source.terms_status} tone={source.terms_status === 'verified' ? 'success' : 'warning'} />
              </View>
              <KeyValue label="API adresi" value={source.api_url} />
              <KeyValue label="Atıf" value={source.attribution} />
              <KeyValue label="Kullanım notu" value={source.terms_note ?? '—'} />
              <KeyValue
                label="Son 24 saat"
                value={`${source.usage_24h.requests} istek · ${source.usage_24h.failed} hata · ort. ${source.usage_24h.avg_latency_ms ?? '—'} ms · ${source.usage_24h.records} kayıt`}
              />
              <KeyValue
                label="Kayıtlar"
                value={`${source.records_total} kaynak kaydı · ${source.matched_total} eşleşmiş · en eski ${formatDateTime(source.oldest_record)}`}
              />
              <KeyValue label="Son başarılı okuma" value={formatDateTime(source.last_success_at)} />
              <KeyValue
                label="Son hata"
                value={source.last_error_code ? `${formatDateTime(source.last_error_at)} · ${source.last_error_code} ${source.last_error_message ?? ''}` : '—'}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button label="Bağlantıyı test et" size="sm" variant="outline" fullWidth={false} loading={testing === source.key} onPress={() => void test(source.key)} />
                {source.docs_url ? (
                  <Button label="Dokümantasyon" size="sm" variant="ghost" fullWidth={false} onPress={() => void openUrl(source.docs_url)} />
                ) : null}
                {canManage ? (
                  <>
                    <Button
                      label={source.is_enabled ? 'Devre dışı bırak' : 'Etkinleştir'}
                      size="sm"
                      variant={source.is_enabled ? 'danger' : 'secondary'}
                      fullWidth={false}
                      onPress={() =>
                        sourceAction(
                          source,
                          { is_enabled: !source.is_enabled },
                          source.is_enabled ? `${source.name} devre dışı bırakılsın mı?` : `${source.name} etkinleştirilsin mi?`,
                          'Kaynak kapatıldığında geçmiş kayıtlar silinmez; yalnızca yeni sorgular durur.',
                        )
                      }
                    />
                    {!source.is_primary ? (
                      <Button
                        label="Birincil yap"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        onPress={() =>
                          sourceAction(source, { is_primary: true }, `${source.name} birincil kaynak yapılsın mı?`, 'Eşleşen kayıtlarda gösterilen değerler bu kaynaktan gelir.')
                        }
                      />
                    ) : null}
                    {(['verified', 'pending_review', 'restricted'] as const)
                      .filter((value) => value !== source.terms_status)
                      .map((value) => (
                        <Button
                          key={value}
                          label={`Şartlar: ${TERMS_LABELS[value]}`}
                          size="sm"
                          variant="ghost"
                          fullWidth={false}
                          onPress={() =>
                            sourceAction(
                              source,
                              { terms_status: value },
                              'Kullanım şartı durumu değiştirilsin mi?',
                              'Gerekçeye izin belgesinin veya doğrulamanın referansını yazın.',
                            )
                          }
                        />
                      ))}
                  </>
                ) : null}
              </View>
              {result ? (
                <View style={{ gap: 2 }}>
                  <AppText variant="label" color={result.ok ? 'success' : 'danger'}>
                    Test {result.ok ? 'başarılı' : 'başarısız'} · HTTP {result.http_status ?? '—'} · {result.latency_ms ?? '—'} ms
                  </AppText>
                  {result.ok ? (
                    <AppText variant="caption" color="textSecondary">
                      Son 24 saatte {result.received_24h} kayıt alındı, {result.valid_24h} kayıt doğrulamayı geçti, {result.rejected?.length ?? 0} kayıt
                      reddedildi. Test kayıt yazmaz.
                    </AppText>
                  ) : (
                    <AppText variant="caption" color="textSecondary">
                      {result.error} {result.message ?? ''}
                    </AppText>
                  )}
                </View>
              ) : null}
            </AdminSection>
          );
        })}
      </AdminQueryState>

      {canManage ? (
        <AdminSection
          title="Geçmiş veri doldurma"
          subtitle="Kaynaktan geçmiş kayıtları sınırlı ve yavaş şekilde çeker. Doldurulan kayıtlar için bildirim gönderilmez."
        >
          <FilterChips
            options={[
              { key: 'afad', label: 'AFAD (en fazla 14 gün / istek)' },
              { key: 'usgs', label: 'USGS (en fazla 3650 gün / istek)' },
            ]}
            value={backfillProvider}
            onChange={(value) => setBackfillProvider(value as EarthquakeSource)}
          />
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <TextField
              label="Gün sayısı"
              keyboardType="number-pad"
              value={backfillDays}
              onChangeText={setBackfillDays}
              containerStyle={{ minWidth: 140, flex: 1 }}
              hint={`1–${maxDays}`}
            />
            <TextField
              label="Kaç gün önceden başlasın"
              keyboardType="number-pad"
              value={backfillOffset}
              onChangeText={setBackfillOffset}
              containerStyle={{ minWidth: 180, flex: 1 }}
              hint="0 = bugünden geriye"
            />
          </View>
          <Button
            label="Doldurmayı başlat"
            size="sm"
            fullWidth={false}
            onPress={() => {
              const days = Math.min(Math.max(Number.parseInt(backfillDays, 10) || 1, 1), maxDays);
              const offsetDays = Math.max(Number.parseInt(backfillOffset, 10) || 0, 0);
              ask({
                title: `${backfillProvider.toUpperCase()} için ${days} günlük geçmiş veri doldurulsun mu?`,
                description:
                  'İşlem kaynak kullanım sınırlarına uymak için yavaş ilerler ve en fazla 2 dakika sürer; kalan kısım için tekrar başlatmanız gerekebilir.',
                run: async (reason) => {
                  const result = await invokeWorker<{ results: { stopped?: string; next_offset_days?: number; ok?: boolean; received?: number }[] }>({
                    action: 'backfill',
                    provider: backfillProvider,
                    days,
                    offset_days: offsetDays,
                    reason,
                  });
                  const stopped = result.results.find((item) => item.stopped);
                  const received = result.results.reduce((sum, item) => sum + (item.received ?? 0), 0);
                  if (stopped?.next_offset_days != null) {
                    setBackfillOffset(String(stopped.next_offset_days));
                    toast.info(`${received} kayıt alındı. Süre doldu; devam için başlangıç ${stopped.next_offset_days}. güne ayarlandı.`);
                  }
                  void logs.refetch();
                  return result;
                },
                success: 'Geçmiş veri doldurma tamamlandı.',
              });
            }}
          />
        </AdminSection>
      ) : null}

      <AdminSection title="Senkron kayıtları">
        <FilterChips
          options={[
            { key: 'all', label: 'Tüm kaynaklar' },
            { key: 'afad', label: 'AFAD' },
            { key: 'usgs', label: 'USGS' },
          ]}
          value={provider}
          onChange={(value) => {
            setProvider(value as typeof provider);
            setOffset(0);
          }}
        />
        <FilterChips
          options={[
            { key: 'all', label: 'Tümü' },
            { key: 'success', label: 'Başarılı' },
            { key: 'partial', label: 'Kısmi' },
            { key: 'failed', label: 'Başarısız' },
            { key: 'skipped', label: 'Atlandı' },
          ]}
          value={status}
          onChange={(value) => {
            setStatus(value as typeof status);
            setOffset(0);
          }}
        />
        <AdminQueryState loading={logs.isLoading} error={logs.isError ? logs.error.message : null} onRetry={() => void logs.refetch()}>
          {(logs.data?.items ?? []).map((log) => (
            <RowCard
              key={log.id}
              title={`${log.provider.toUpperCase()} · ${log.run_kind} · ${STATUS_LABELS[log.status] ?? log.status}`}
              subtitle={`${formatDateTime(log.started_at)} · HTTP ${log.http_status ?? '—'} · ${log.latency_ms ?? '—'} ms · ${log.attempts} deneme`}
              meta={`Alınan ${log.records_received} · geçerli ${log.records_valid} · reddedilen ${log.records_rejected} · yeni ${log.new_events} · güncellenen ${log.updated_records} · değişmeyen ${log.unchanged_records} · eşleşen ${log.matched_records} · incelemeye ${log.review_records} · bildirim ${log.notifications_queued}${
                log.error_code ? ` · Hata: ${log.error_code} ${log.error_message ?? ''}` : ''
              }`}
              badges={<Pill label={STATUS_LABELS[log.status] ?? log.status} tone={log.status === 'success' ? 'success' : log.status === 'failed' ? 'danger' : 'warning'} />}
            />
          ))}
          <Pager total={logs.data?.total ?? 0} limit={30} offset={offset} onChange={setOffset} />
        </AdminQueryState>
      </AdminSection>
      {dialog}
    </View>
  );
}
