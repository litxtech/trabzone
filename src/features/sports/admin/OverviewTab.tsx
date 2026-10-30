import { useState } from 'react';
import { Switch, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminSection } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useReasonAction } from '@/features/earthquake/admin/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { statusLine, matchTitle } from '../utils/format';
import { useSportsCardStore } from '../store';
import {
  invokeSportsWorker,
  useSportsAdminMutation,
  type AdminOverview,
  type SportsWorkerTest,
} from './api';
import { fmtTime, HEALTH, ListRow, Muted, sharedStyles, Tile, TileGrid } from './shared';

const JOBS: { key: string; label: string }[] = [
  { key: 'status', label: 'Kota / hesap' },
  { key: 'discover', label: 'Takım keşfi' },
  { key: 'leagues', label: 'Turnuvalar' },
  { key: 'schedule', label: 'Fikstür' },
  { key: 'fixtures', label: 'Canlı/yakın maçlar' },
  { key: 'standings', label: 'Puan durumu' },
  { key: 'squad', label: 'Kadro' },
  { key: 'teamstats', label: 'Takım istatistikleri' },
];

const SYNC_LABELS: Record<string, string> = {
  tick: 'Son zamanlayıcı çalışması',
  live: 'Canlı maç senkronu',
  prematch: 'Maç öncesi senkron',
  schedule: 'Fikstür',
  standings: 'Puan durumu',
  leagues: 'Turnuvalar',
  squad: 'Kadro',
  status: 'Kota kontrolü',
};

export function OverviewTab({
  data,
  canManage,
  canNotify,
}: {
  data: AdminOverview;
  canManage: boolean;
  canNotify: boolean;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const toast = useAdminToast();
  const { ask, dialog } = useReasonAction();
  const [test, setTest] = useState<SportsWorkerTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [jobs, setJobs] = useState<string[]>(['status', 'discover', 'leagues', 'schedule']);
  const showTest = useSportsCardStore((state) => state.showTest);
  const setShowTest = useSportsCardStore((state) => state.setShowTest);
  const run = useSportsAdminMutation((input: { jobs: string[]; reason: string }) =>
    invokeSportsWorker<{ ok: boolean; key_missing: boolean; logs: { job: string; status: string; error: string | null }[] }>({
      action: 'run',
      jobs: input.jobs,
      reason: input.reason,
    }),
  );
  const dispatch = useSportsAdminMutation((input: { reason: string }) =>
    invokeSportsWorker({ action: 'dispatch', reason: input.reason }),
  );

  const health = HEALTH[data.health] ?? { label: data.health, tone: 'neutral' as const };
  const quota = data.quota;
  const fixture = data.live ?? data.next;

  const runTest = async () => {
    setTesting(true);
    try {
      setTest(await invokeSportsWorker<SportsWorkerTest>({ action: 'test' }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test başarısız.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={sharedStyles.gap}>
      {dialog}
      <TileGrid>
        <Tile label="Veri sağlığı" value={<Badge label={health.label} tone={health.tone} />} hint={data.consecutive_failures ? `${data.consecutive_failures} ardışık hata` : undefined} />
        <Tile
          label="API anahtarı"
          value={data.configured.api_key ? 'Tanımlı' : 'Eksik'}
          tone={data.configured.api_key ? 'success' : 'danger'}
          hint="Değer hiçbir zaman gösterilmez"
        />
        <Tile
          label="Takım (API kimliği)"
          value={data.configured.team_id ? String(data.configured.team_id) : 'Doğrulanmadı'}
          tone={data.configured.team_id ? undefined : 'warning'}
          hint={data.configured.team_verified_at ? `Doğrulama: ${fmtTime(data.configured.team_verified_at)}` : undefined}
        />
        <Tile label="Sezon" value={data.configured.season ? String(data.configured.season) : '—'} />
        <Tile
          label="Günlük kota"
          value={quota.limit_day != null ? `${quota.remaining_day ?? '?'} / ${quota.limit_day}` : '—'}
          hint={`Bugün ${quota.used_today} istek${quota.plan ? ` · ${quota.plan}` : ''}`}
          tone={quota.remaining_day != null && quota.remaining_day < (quota.reserve ?? 10) ? 'danger' : undefined}
        />
        <Tile label="Senkron" value={data.configured.sync_enabled ? 'Açık' : 'Kapalı'} tone={data.configured.sync_enabled ? 'success' : 'warning'} />
      </TileGrid>

      {!data.configured.api_key ? (
        <AdminSection title="API anahtarı gerekli" subtitle="Anahtar yalnızca sunucu tarafındaki gizli değişkende saklanır.">
          <AppText variant="body">
            API-Football anahtarını Supabase Edge Function secret olarak ekle. Anahtar mobil uygulamaya, web koduna veya bu
            panele hiçbir zaman gönderilmez.
          </AppText>
          <View style={[sharedStyles.gap, { backgroundColor: theme.colors.surfaceMuted, padding: 10, borderRadius: 10 }]}>
            <AppText variant="caption" selectable style={{ fontFamily: 'monospace' }}>
              npx supabase secrets set API_FOOTBALL_KEY=&lt;anahtar&gt; --project-ref &lt;proje&gt;
            </AppText>
          </View>
          <Muted>Kaydettikten sonra zamanlayıcı bir dakika içinde takım keşfini başlatır.</Muted>
        </AdminSection>
      ) : null}

      <AdminSection title="API bağlantısı" subtitle="Test ve senkron işlemleri sunucu fonksiyonu üzerinden çalışır; her işlem denetim kaydına yazılır.">
        <View style={sharedStyles.actions}>
          <Button label="Bağlantıyı test et" size="sm" fullWidth={false} loading={testing} onPress={() => void runTest()} />
          {canNotify ? (
            <Button
              label="Bildirim kuyruğunu işle"
              size="sm"
              variant="outline"
              fullWidth={false}
              loading={dispatch.isPending}
              onPress={() =>
                ask({
                  title: 'Bildirim kuyruğunu şimdi işle',
                  description: 'Bekleyen maç bildirimleri yalnızca onay vermiş kullanıcılara dağıtılır.',
                  run: (reason) => dispatch.mutateAsync({ reason }),
                  success: 'Kuyruk işlendi.',
                })
              }
            />
          ) : null}
        </View>
        {test ? (
          <ListRow>
            {test.key_missing ? (
              <AppText variant="body" color="danger">
                API_FOOTBALL_KEY tanımlı değil.
              </AppText>
            ) : test.ok ? (
              <>
                <AppText variant="label" color="success">
                  Bağlantı başarılı · {test.latency_ms ?? '?'} ms
                </AppText>
                <Muted>
                  Plan: {test.plan ?? '—'} · Abonelik {test.active ? 'aktif' : 'pasif'}
                  {test.subscription_end ? ` · Bitiş ${fmtTime(test.subscription_end)}` : ''}
                </Muted>
                <Muted>
                  Günlük: {test.used_day ?? '?'} kullanıldı / {test.limit_day ?? '?'} · Kalan {test.remaining_day ?? '?'}
                </Muted>
              </>
            ) : (
              <AppText variant="body" color="danger">
                Bağlantı başarısız: {test.error ?? 'bilinmeyen hata'}
              </AppText>
            )}
          </ListRow>
        ) : null}

        {canManage ? (
          <View style={sharedStyles.gap}>
            <AppText variant="label">Elle senkron</AppText>
            <View style={sharedStyles.actions}>
              {JOBS.map((job) => {
                const active = jobs.includes(job.key);
                return (
                  <Button
                    key={job.key}
                    label={job.label}
                    size="sm"
                    variant={active ? 'primary' : 'outline'}
                    fullWidth={false}
                    onPress={() => setJobs((prev) => (active ? prev.filter((key) => key !== job.key) : [...prev, job.key]))}
                  />
                );
              })}
            </View>
            <Button
              label="Seçilenleri şimdi çalıştır"
              size="sm"
              fullWidth={false}
              disabled={jobs.length === 0}
              loading={run.isPending}
              onPress={() =>
                ask({
                  title: 'Senkronu elle çalıştır',
                  description: 'API kotasından düşer. Vadesi gelmiş diğer işler de aynı çalışmada yürütülür.',
                  run: async (reason) => {
                    const result = await run.mutateAsync({ jobs, reason });
                    if (result.key_missing) throw new Error('API_FOOTBALL_KEY tanımlı değil.');
                    const failed = result.logs.filter((log) => log.status === 'error');
                    if (failed.length) toast.error(`${failed.length} istek başarısız: ${failed[0]?.error ?? ''}`);
                  },
                  success: 'Senkron tamamlandı.',
                })
              }
            />
          </View>
        ) : null}
      </AdminSection>

      <AdminSection title="Maç" subtitle="Canlı veya sıradaki gerçek maç">
        {fixture ? (
          <ListRow onPress={() => router.push(`/trabzonspor/mac/${fixture.id}` as never)}>
            <AppText variant="label">{matchTitle(fixture)}</AppText>
            <Muted>
              #{fixture.id} · {statusLine(fixture)} · veri yaşı {fixture.data_age_seconds ?? '?'} sn
            </Muted>
          </ListRow>
        ) : (
          <Muted>Planlanmış maç yok.</Muted>
        )}
        <View style={sharedStyles.rowLine}>
          <Switch value={showTest} onValueChange={setShowTest} trackColor={{ true: theme.colors.primary }} />
          <View style={sharedStyles.flex}>
            <AppText variant="body">Feed’de TEST maçlarını bana göster</AppText>
            <Muted>Yalnızca bu cihazda ve yalnızca yetkili admin hesabında etkilidir; kullanıcılar TEST verisi görmez.</Muted>
          </View>
        </View>
      </AdminSection>

      <TileGrid>
        <Tile label="Sohbet (10 dk)" value={data.chat.messages_10m} hint={`${data.chat.active_users} aktif kullanıcı`} />
        <Tile label="Açık sohbet şikâyeti" value={data.chat.open_reports} tone={data.chat.open_reports ? 'warning' : undefined} />
        <Tile label="Bildirim abonesi" value={data.notifications.subscribers} />
        <Tile label="Push (24 sa)" value={data.notifications.push_sent_24h} hint={`${data.notifications.push_failed_24h} başarısız · ${data.notifications.push_pending} bekliyor`} />
        <Tile label="Maç kaydı" value={data.counts.fixtures} hint={`${data.counts.competitions} aktif turnuva`} />
        <Tile label="TEST maçı" value={data.counts.test_fixtures} tone={data.counts.test_fixtures ? 'warning' : undefined} />
      </TileGrid>

      <AdminSection title="Son senkronlar">
        {Object.entries(data.last_sync).map(([key, value]) => (
          <View key={key} style={sharedStyles.rowLine}>
            <AppText variant="caption" color="textSecondary" style={{ width: 200 }}>
              {SYNC_LABELS[key] ?? key}
            </AppText>
            <AppText variant="caption">{fmtTime(value)}</AppText>
          </View>
        ))}
      </AdminSection>

      <AdminSection title="Son hatalar">
        {data.last_error ? (
          <AppText variant="caption" color="danger" selectable>
            {fmtTime(data.last_error_at)} · {data.last_error}
          </AppText>
        ) : null}
        {data.recent_errors.length === 0 ? (
          <Muted>Kayıtlı hata yok.</Muted>
        ) : (
          data.recent_errors.map((item, index) => (
            <ListRow key={`${item.at}-${index}`}>
              <AppText variant="caption">
                {fmtTime(item.at)} · {item.job}
                {item.endpoint ? ` · /${item.endpoint}` : ''}
                {item.http_status ? ` · HTTP ${item.http_status}` : ''}
              </AppText>
              <AppText variant="caption" color="danger" selectable>
                {item.error ?? '—'}
              </AppText>
            </ListRow>
          ))
        )}
      </AdminSection>
    </View>
  );
}
