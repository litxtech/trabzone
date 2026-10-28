import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useNewsApiDeletionJob,
  useNewsApiDeletionPreview,
  useNewsApiRunDeletion,
  useNewsApiStartDeletion,
} from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import { formatDateTimeTr } from '@/utils/date';

import { NewsModalShell } from './NewsModalShell';
import { ChipSelect, EmptyHint, InfoRow, newsApiStyles, StatBox } from './shared';

type Scope = 'disable_only' | 'remove_content' | 'purge';

const SCOPES: { value: Scope; label: string; description: string }[] = [
  {
    value: 'disable_only',
    label: 'Kaynağı kapat',
    description: 'Yeni akış durur. Yayımlanmış haberler, medya ve sitemap kayıtları korunur.',
  },
  {
    value: 'remove_content',
    label: 'Kaynağı ve haberlerini kaldır',
    description:
      'Kaynak devre dışı kalır; yalnızca bu kaynağa münhasır haberler yayından ve sitemap’ten kaldırılır. Ortak haberler korunur.',
  },
  {
    value: 'purge',
    label: 'Kaynağı tamamen sil',
    description:
      'Bağlantı, yapılandırma ve münhasır haberler kaldırılır; kuyruk görevleri iptal edilir, medya temizlenir. Geri alınamaz.',
  },
];

export function NewsDeletionModal({
  visible,
  connectionId,
  connectionName,
  canDelete,
  onClose,
  onCompleted,
}: {
  visible: boolean;
  connectionId: string;
  connectionName: string;
  canDelete: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const preview = useNewsApiDeletionPreview(connectionId, visible);
  const start = useNewsApiStartDeletion();
  const run = useNewsApiRunDeletion();

  const [scope, setScope] = useState<Scope>('disable_only');
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useNewsApiDeletionJob(jobId);

  const counts = preview.data;
  const requiresName = scope !== 'disable_only';
  const confirmationOk = !requiresName || confirmName.trim() === connectionName;
  const jobStatus = job.data?.job.status;
  const mediaPending = job.data?.media_cleanup?.pending ?? 0;
  const mediaFailed = job.data?.media_cleanup?.failed ?? 0;
  const mediaDone = job.data?.media_cleanup?.done ?? 0;
  const working = jobStatus === 'queued' || jobStatus === 'running' || mediaPending > 0;
  const jobBadge =
    mediaFailed > 0
      ? { label: 'Medya temizliği hatası', tone: 'danger' as const }
      : jobStatus === 'completed'
        ? mediaPending > 0
          ? { label: 'Medya temizleniyor', tone: 'warning' as const }
          : { label: 'Tamamlandı', tone: 'success' as const }
        : jobStatus === 'failed'
          ? { label: 'Başarısız', tone: 'danger' as const }
          : { label: working ? 'Sürüyor' : (jobStatus ?? 'Kuyrukta'), tone: 'warning' as const };

  const submit = async () => {
    if (!canDelete) {
      setError('Kaynak silme yalnızca `news.manage` yetkili yöneticide çalışır.');
      return;
    }
    if (!confirmationOk) {
      setError('Onay için kaynak adını tam olarak yaz.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('İşlem gerekçesi en az 3 karakter olmalı.');
      return;
    }
    setError(null);
    try {
      const created = await start.mutateAsync({
        id: connectionId,
        scope,
        confirmName: confirmName.trim(),
        reason: reason.trim(),
      });
      setJobId(created.id);
      toast.success('Silme işi kuyruğa alındı ve ilk tur çalıştırıldı.');
      onCompleted?.();
    } catch (startError) {
      setError(errorMessage(startError, 'Silme işi başlatılamadı.'));
    }
  };

  const continueJob = async () => {
    if (!jobId) return;
    try {
      await run.mutateAsync(jobId);
      toast.info('Silme işi bir sonraki tur için tetiklendi.');
      onCompleted?.();
    } catch (runError) {
      setError(errorMessage(runError, 'Silme işi sürdürülemedi.'));
    }
  };

  return (
    <NewsModalShell
      visible={visible}
      title="Kaynağı Sil / Kaldır"
      subtitle={`${connectionName} · işlem audit log’a kaydedilir`}
      onClose={onClose}
      footer={
        jobId ? (
          <>
            <Button label="Kapat" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
            <Button
              label={working ? 'İşlem sürüyor…' : 'Sonraki turu çalıştır'}
              size="sm"
              fullWidth={false}
              loading={run.isPending || working}
              disabled={working || jobStatus === 'completed'}
              onPress={() => void continueJob()}
            />
          </>
        ) : (
          <>
            <Button label="Vazgeç" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
            <Button
              label={scope === 'disable_only' ? 'Kaynağı kapat' : 'Silme işlemini başlat'}
              size="sm"
              variant={scope === 'disable_only' ? 'primary' : 'danger'}
              fullWidth={false}
              loading={start.isPending}
              disabled={!canDelete || !confirmationOk || reason.trim().length < 3}
              onPress={() => void submit()}
            />
          </>
        )
      }
    >
      {preview.isLoading ? (
        <ActivityIndicator />
      ) : counts ? (
        <>
          <View style={newsApiStyles.statGrid}>
            <StatBox label="Toplam haber" value={counts.items_total} />
            <StatBox label="Yayında" value={counts.items_published} />
            <StatBox label="Taslak / bekleyen" value={counts.items_pending} />
            <StatBox label="Kaynağa münhasır gönderi" value={counts.posts_exclusive} />
          </View>
          <View style={newsApiStyles.statGrid}>
            <StatBox label="Ortak doğrulanmış gönderi" value={counts.posts_shared} hint="Korunur" />
            <StatBox label="Medya dosyası" value={counts.media_count} />
            <StatBox label="Sitemap URL" value={counts.sitemap_urls} />
            <StatBox label="Kaynak profili" value={counts.profile_bound ? 'Bağlı' : 'Yok'} hint={counts.profile_shared ? 'Paylaşımlı' : undefined} />
          </View>

          <View style={[styles.note, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}>
            <AppText variant="caption" color="textSecondary">
              Çok kaynaklı haberler tek kaynağın kaldırılmasıyla silinmez; kalan kaynaklarla yayın uygunluğu yeniden
              değerlendirilir. Kullanıcıların kendi gönderileri ve yorumları etkilenmez.
            </AppText>
          </View>
        </>
      ) : (
        <EmptyHint text="Silme önizlemesi alınamadı." icon="alert-circle-outline" />
      )}

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">İşlem türü</AppText>
        <ChipSelect options={SCOPES.map((row) => ({ value: row.value, label: row.label }))} value={scope} onChange={setScope} />
        <AppText variant="caption" color={scope === 'purge' ? 'danger' : 'textTertiary'}>
          {SCOPES.find((row) => row.value === scope)?.description}
        </AppText>
      </View>

      {requiresName ? (
        <TextField
          label={`Onay için kaynak adını yaz: ${connectionName}`}
          value={confirmName}
          onChangeText={setConfirmName}
          autoCapitalize="none"
          placeholder={connectionName}
          error={confirmName.length > 0 && !confirmationOk ? 'Ad eşleşmiyor.' : null}
        />
      ) : null}

      <TextField
        label="İşlem gerekçesi"
        value={reason}
        onChangeText={setReason}
        multiline
        style={styles.multiline}
        placeholder="Örn. Lisans sözleşmesi sona erdi"
      />

      {jobId ? (
        <View style={[styles.jobBox, { borderColor: theme.colors.border }]}>
          <View style={newsApiStyles.row}>
            <AppText variant="label">Silme işi</AppText>
            <Badge label={jobBadge.label} tone={jobBadge.tone} />
          </View>
          <InfoRow label="İş no" value={job.data?.job.id ?? jobId} />
          <InfoRow label="Kapsam" value={SCOPES.find((row) => row.value === (job.data?.job.scope ?? scope))?.label ?? scope} />
          <InfoRow
            label="İlerleme"
            value={`${job.data?.job.progress.processed ?? 0} işlendi · ${job.data?.job.progress.remaining ?? 0} kaldı`}
          />
          {job.data?.media_cleanup ? (
            <InfoRow
              label="Medya temizliği"
              value={`${mediaDone} tamam · ${mediaPending} bekliyor · ${mediaFailed} hatalı`}
            />
          ) : null}
          <InfoRow label="Başlangıç" value={job.data?.job.started_at ? formatDateTimeTr(job.data.job.started_at) : '—'} />
          <InfoRow label="Bitiş" value={job.data?.job.finished_at ? formatDateTimeTr(job.data.job.finished_at) : '—'} />
          {job.data?.job.error ? (
            <AppText variant="caption" color="danger">
              {job.data.job.error}
            </AppText>
          ) : null}
          <AppText variant="caption" color="textTertiary">
            {jobStatus === 'completed'
              ? mediaPending > 0
                ? 'İçerik yayından kaldırıldı; Storage medya temizliği worker tarafından sürdürülüyor.'
                : mediaFailed > 0
                  ? 'İçerik kaldırıldı ancak bazı medya dosyaları silinemedi; worker yeniden deneyecek.'
                  : 'İşlem tamamlandı. Sitemap ve içerik durumu bir sonraki yayın turunda doğrulanır; Google indeksinden kaldırma ayrı bir süreçtir.'
              : 'İşlem tamamlanmadan "tüm veriler silindi" denmez. Kalan turlar arka planda sürdürülebilir.'}
          </AppText>
        </View>
      ) : null}

      {!canDelete ? (
        <AppText variant="caption" color="danger">
          Bu hesabın `news.manage` yetkisi yok; silme işlemi başlatılamaz.
        </AppText>
      ) : null}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </NewsModalShell>
  );
}

const styles = StyleSheet.create({
  note: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11 },
  multiline: { minHeight: 72 },
  jobBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 6 },
});
