import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { AdminQueryState } from '@/features/explore/admin/AdminExploreShared';
import { formatDateTime, Pill, RowCard } from '@/features/pharmacy/admin/shared';

import { formatMagnitude } from '../utils/format';
import { adminApi, useAdminNotifications, useAdminPushFailures, useEarthquakeAdminMutation } from './api';
import { SKIP_REASONS, STATUS_LABELS, useReasonAction } from './ui';

type StatusFilter = 'all' | 'pending' | 'fanning_out' | 'completed' | 'skipped' | 'failed' | 'cancelled';

export function NotificationsTab({ canNotify }: { canNotify: boolean }) {
  const toast = useAdminToast();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [offset, setOffset] = useState(0);
  const [note, setNote] = useState('');
  const list = useAdminNotifications(status === 'all' ? null : status, offset, true);
  const failures = useAdminPushFailures(canNotify);
  const retry = useEarthquakeAdminMutation(adminApi.retryFailed);
  const testPush = useEarthquakeAdminMutation(adminApi.testPush);
  const { ask, dialog } = useReasonAction();

  return (
    <View style={{ gap: 14 }}>
      {canNotify ? (
        <AdminSection
          title="TEST bildirimi"
          subtitle="Yalnızca sizin kayıtlı cihazlarınıza ve uygulama içi kutunuza gider; “TEST” olarak etiketlenir ve hiçbir deprem kaydına bağlanmaz."
        >
          <TextField label="Not (isteğe bağlı)" value={note} onChangeText={setNote} maxLength={120} />
          <Button
            label="Bana TEST bildirimi gönder"
            size="sm"
            variant="outline"
            fullWidth={false}
            loading={testPush.isPending}
            onPress={() =>
              testPush.mutate(
                { note: note.trim() || null },
                {
                  onSuccess: (result) =>
                    toast.success(
                      result.devices > 0
                        ? `TEST bildirimi ${result.devices} cihazınıza kuyruğa alındı.`
                        : 'Kayıtlı push cihazınız yok; TEST yalnızca uygulama içi kutunuza düştü.',
                    ),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          />
        </AdminSection>
      ) : null}

      <AdminSection
        title="Bildirim kuyruğu"
        action={
          canNotify ? (
            <Button
              label="Başarısızları yeniden dene"
              size="sm"
              variant="outline"
              fullWidth={false}
              onPress={() =>
                ask({
                  title: 'Başarısız push gönderimleri yeniden denensin mi?',
                  description: 'Yalnızca geçerlilik süresi dolmamış ve token’ı geçerli cihazlar yeniden kuyruğa alınır.',
                  run: async (reason) => {
                    const result = await retry.mutateAsync({ eventId: null, reason });
                    toast.info(`${result.requeued} gönderim yeniden kuyruğa alındı.`);
                    return result;
                  },
                })
              }
            />
          ) : null
        }
      >
        <FilterChips
          options={(['all', 'pending', 'fanning_out', 'completed', 'skipped', 'failed', 'cancelled'] as const).map((key) => ({
            key,
            label: key === 'all' ? 'Tümü' : STATUS_LABELS[key] ?? key,
          }))}
          value={status}
          onChange={(value) => {
            setStatus(value as StatusFilter);
            setOffset(0);
          }}
        />
        <AdminQueryState loading={list.isLoading} error={list.isError ? list.error.message : null} onRetry={() => void list.refetch()}>
          {(list.data?.items ?? []).length === 0 ? (
            <AppText variant="caption" color="textSecondary">
              Kayıt yok.
            </AppText>
          ) : null}
          {(list.data?.items ?? []).map((item) => (
            <RowCard
              key={item.id}
              title={item.title ?? (item.type === 'test' ? 'TEST' : 'Deprem bildirimi')}
              subtitle={`${formatDateTime(item.created_at)}${item.event ? ` · ${item.event.canonical_id} · ${formatMagnitude(item.event.magnitude, item.event.magnitude_type)} · ${item.event.location ?? ''}` : ''}`}
              meta={`${item.body ?? ''}\nAlıcı ${item.recipients} · uygulama içi ${item.in_app} · push kuyruğu ${item.push_queued} · sessiz saat ${item.push_suppressed}${
                item.push ? ` · gönderilen ${item.push.sent + item.push.delivered} · teslim ${item.push.delivered} · başarısız ${item.push.failed} · geçersiz ${item.push.invalid} · süresi dolan ${item.push.expired} · bekleyen ${item.push.pending}` : ''
              }${item.skip_reason ? ` · Atlama nedeni: ${SKIP_REASONS[item.skip_reason] ?? item.skip_reason}` : ''}`}
              badges={
                <>
                  <Pill label={item.type === 'test' ? 'TEST' : item.type === 'revision' ? 'Güncelleme' : 'Yeni'} tone={item.type === 'test' ? 'warning' : 'neutral'} />
                  <Pill label={STATUS_LABELS[item.status] ?? item.status} tone={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'danger' : 'neutral'} />
                  {item.priority === 'high' ? <Pill label="Önemli" tone="warning" /> : null}
                </>
              }
            />
          ))}
          <Pager total={list.data?.total ?? 0} limit={20} offset={offset} onChange={setOffset} />
        </AdminQueryState>
      </AdminSection>

      {canNotify ? (
        <AdminSection title="Başarısız push gönderimleri">
          <AdminQueryState loading={failures.isLoading} error={failures.isError ? failures.error.message : null} onRetry={() => void failures.refetch()}>
            {(failures.data?.items ?? []).length === 0 ? (
              <AppText variant="caption" color="textSecondary">
                Başarısız gönderim yok.
              </AppText>
            ) : (
              (failures.data?.items ?? []).map((item) => (
                <AppText key={item.id} variant="caption" color="textSecondary">
                  {formatDateTime(item.created_at)} · {item.platform ?? '—'} · {STATUS_LABELS[item.status] ?? item.status} · deneme {item.retry_count} ·{' '}
                  {item.error ?? ''} {item.message ?? ''}
                </AppText>
              ))
            )}
          </AdminQueryState>
        </AdminSection>
      ) : null}
      {dialog}
    </View>
  );
}
