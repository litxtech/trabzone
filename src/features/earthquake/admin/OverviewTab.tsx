import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { AdminSection } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { formatDateTime, Pill, RowCard } from '@/features/pharmacy/admin/shared';
import { useTheme } from '@/theme/ThemeProvider';

import { formatAgo, formatDecimal } from '../utils/format';
import { invokeWorker, type AdminOverview } from './api';
import { HEALTH_LABELS, HEALTH_TONES, TERMS_LABELS } from './ui';

const STATE_LABELS = { live: 'Güncel', fallback: 'Yedek kaynakta', delayed: 'Gecikmeli', unavailable: 'Veri alınamıyor' } as const;

function seconds(value: number | null | undefined) {
  if (value == null) return '—';
  return value < 120 ? `${Math.round(value)} sn` : `${formatDecimal(value / 60, 1)} dk`;
}

export function OverviewTab({
  data,
  canManage,
  canNotify,
  onRefresh,
}: {
  data: AdminOverview;
  canManage: boolean;
  canNotify: boolean;
  onRefresh: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [busy, setBusy] = useState<'sync' | 'dispatch' | null>(null);

  const run = async (kind: 'sync' | 'dispatch') => {
    setBusy(kind);
    try {
      const result = await invokeWorker<{ sync?: { provider: string; ok?: boolean; received?: number; skipped?: string }[] }>(
        kind === 'sync' ? { action: 'sync', reason: 'Yönetim panelinden manuel senkron' } : { action: 'dispatch', reason: 'Yönetim panelinden kuyruk işletme' },
      );
      if (kind === 'sync') {
        const summary = (result.sync ?? [])
          .map((item) => `${item.provider.toUpperCase()}: ${item.ok ? `${item.received ?? 0} kayıt` : item.skipped ?? 'hata'}`)
          .join(' · ');
        toast.success(summary || 'Senkron tamamlandı.');
      } else {
        toast.success('Bildirim kuyruğu işletildi.');
      }
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem başarısız.');
    } finally {
      setBusy(null);
    }
  };

  const status = data.status;
  const n = data.notifications_24h;
  return (
    <View style={{ gap: 14 }}>
      <StatGrid>
        <StatCard
          label="Veri durumu"
          value={STATE_LABELS[status.state]}
          icon="pulse-outline"
          tone={status.state === 'live' ? 'success' : status.state === 'unavailable' ? 'danger' : 'warning'}
          hint={`Birincil son okuma: ${status.primary_last_success_at ? formatAgo(status.primary_last_success_at) : '—'}`}
        />
        <StatCard
          label="Son 24 saat"
          value={String(data.events.last_24h_turkey)}
          icon="earth-outline"
          hint={`150 km: ${data.events.last_24h_r150} · İl: ${data.events.last_24h_province}`}
        />
        <StatCard label="Arşiv" value={String(data.events.archive_total)} icon="archive-outline" hint={`Kaldırılan: ${data.events.removed}`} />
        <StatCard
          label="Senkron (24 sa)"
          value={`${data.sync_24h.success}/${data.sync_24h.runs}`}
          icon="sync-outline"
          tone={data.sync_24h.failed > 0 ? 'warning' : 'success'}
          hint={`Başarısız ${data.sync_24h.failed} · Ort. ${data.sync_24h.avg_latency_ms ?? '—'} ms · Reddedilen kayıt ${data.sync_24h.rejected_records}`}
        />
        <StatCard
          label="Kaynaktan ulaşma"
          value={seconds(data.ingest_latency.p50_seconds)}
          icon="timer-outline"
          hint={`Medyan · p95 ${seconds(data.ingest_latency.p95_seconds)} · ${data.ingest_latency.samples} örnek`}
        />
        <StatCard
          label="Eşleştirme / inceleme"
          value={`${data.events.pending_match} / ${data.events.under_review}`}
          icon="git-merge-outline"
          tone={data.events.pending_match + data.events.under_review > 0 ? 'warning' : 'primary'}
          hint={`Son 24 sa otomatik eşleşen kayıt: ${data.events.deduplicated_24h}`}
        />
        <StatCard
          label="Bildirim (24 sa)"
          value={String(n.events)}
          icon="notifications-outline"
          hint={`Push gönderilen ${n.push_sent} · başarısız ${n.push_failed} · geçersiz token ${n.push_invalid} · sessiz saat ${n.push_suppressed}`}
          tone={n.push_failed > 0 ? 'warning' : 'primary'}
        />
        <StatCard
          label="Abone"
          value={String(data.subscribers.enabled)}
          icon="people-outline"
          hint={`Aktif cihaz ${data.subscribers.active_devices} · Trabzon ${data.subscribers.trabzon} · İl ${data.subscribers.province} · Türkiye ${data.subscribers.turkey}`}
        />
      </StatGrid>

      <AdminSection
        title="Kaynak sağlığı"
        action={
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {canManage ? (
              <Button
                label="Şimdi senkronize et"
                size="sm"
                variant="outline"
                fullWidth={false}
                loading={busy === 'sync'}
                leftIcon={<Ionicons name="sync-outline" size={14} color={theme.colors.text} />}
                onPress={() => void run('sync')}
              />
            ) : null}
            {canNotify ? (
              <Button
                label="Bildirim kuyruğunu işlet"
                size="sm"
                variant="outline"
                fullWidth={false}
                loading={busy === 'dispatch'}
                onPress={() => void run('dispatch')}
              />
            ) : null}
          </View>
        }
      >
        {data.sources.map((source) => (
          <RowCard
            key={source.key}
            title={`${source.name}${source.is_primary ? ' · birincil' : ''}`}
            subtitle={`Son başarı: ${formatDateTime(source.last_success_at)} · Son deneme: ${formatDateTime(source.last_attempt_at)}${
              source.last_latency_ms != null ? ` · ${source.last_latency_ms} ms` : ''
            }`}
            meta={
              source.last_error_code
                ? `Son hata (${formatDateTime(source.last_error_at)}): ${source.last_error_code} ${source.last_error_message ?? ''}`
                : source.next_retry_at
                  ? `Sonraki deneme: ${formatDateTime(source.next_retry_at)}`
                  : undefined
            }
            badges={
              <>
                <Pill label={source.is_enabled ? HEALTH_LABELS[source.health] ?? source.health : 'Devre dışı'} tone={source.is_enabled ? HEALTH_TONES[source.health] : 'neutral'} />
                <Pill label={TERMS_LABELS[source.terms_status] ?? source.terms_status} tone={source.terms_status === 'verified' ? 'success' : 'warning'} />
                {source.consecutive_failures > 0 ? <Pill label={`${source.consecutive_failures} ardışık hata`} tone="danger" /> : null}
              </>
            }
          />
        ))}
        {data.sources.some((s) => s.terms_status !== 'verified') ? (
          <AppText variant="caption" color="warning">
            Üretime çıkmadan önce kaynakların otomatik sorgulama ve yeniden kullanım koşulları doğrulanmalı; gerekiyorsa izin
            alınmalıdır. Doğrulama sonrası “Kaynaklar” sekmesinden durum güncellenir.
          </AppText>
        ) : null}
      </AdminSection>

      <AdminSection title="Son senkron hataları">
        {data.recent_errors.length === 0 ? (
          <AppText variant="caption" color="textSecondary">
            Kayıtlı hata yok.
          </AppText>
        ) : (
          data.recent_errors.map((error, index) => (
            <AppText key={`${error.at}-${index}`} variant="caption" color="textSecondary">
              {formatDateTime(error.at)} · {error.provider.toUpperCase()} ({error.run_kind}) · {error.code ?? 'hata'}{' '}
              {error.message ?? ''}
            </AppText>
          ))
        )}
      </AdminSection>

      <AdminSection title="Zamanlayıcı">
        <AppText variant="caption" color="textSecondary">
          Son tetikleme: {formatDateTime(data.settings.last_tick_at)} · Son geniş tarama: {formatDateTime(data.settings.last_sweep_at)} ·
          Senkron {data.settings.sync_enabled ? `açık (${data.settings.sync_interval_seconds} sn)` : 'kapalı'} · Bildirimler{' '}
          {!data.settings.notifications_enabled ? 'kapalı' : data.settings.notifications_paused ? 'duraklatıldı' : 'açık'}
        </AppText>
      </AdminSection>
    </View>
  );
}
