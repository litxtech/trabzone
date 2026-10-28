import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

import { useNewsApiSaveSettings, useNewsApiSettings } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import type { NewsSettings } from '@/features/news-api/types';

import { NewsModalShell } from './NewsModalShell';
import { EmptyHint, InfoRow, ToggleRow, newsApiStyles } from './shared';

function formFromSettings(settings: NewsSettings) {
  return {
    enabled: settings.enabled,
    aiEnabled: settings.ai_enabled,
    mediaDownload: settings.media_download_enabled,
    workerUrl: settings.worker_url ?? '',
    interval: String(settings.dispatch_interval_minutes),
    budget: String(settings.ai_daily_budget),
  };
}

export function NewsSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const settings = useNewsApiSettings();
  const save = useNewsApiSaveSettings();
  const [form, setForm] = useState<ReturnType<typeof formFromSettings> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sunucudan gelen güncel ayarları forma yansıt.
  const data = settings.data;
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible) {
      setForm(null);
      setError(null);
      return;
    }
    if (settings.data) setForm(formFromSettings(settings.data));
  }, [visible, settings.data]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const current = form ?? (data ? formFromSettings(data) : null);
  const update = (patch: Partial<ReturnType<typeof formFromSettings>>) => {
    if (!current) return;
    setForm({ ...current, ...patch });
  };

  const submit = async () => {
    if (!current) return;
    setError(null);
    try {
      await save.mutateAsync({
        enabled: current.enabled,
        ai_enabled: current.aiEnabled,
        media_download_enabled: current.mediaDownload,
        worker_url: current.workerUrl.trim() || null,
        dispatch_interval_minutes: Number(current.interval) || 15,
        ai_daily_budget: Number(current.budget) || 20,
      });
      toast.success('Haber API merkezi ayarları kaydedildi.');
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Ayarlar kaydedilemedi.'));
    }
  };

  return (
    <NewsModalShell
      visible={visible}
      title="Haber API Merkezi Ayarları"
      subtitle="Worker, otomasyon ve AI bütçesi"
      onClose={onClose}
      footer={
        <>
          <Button label="Vazgeç" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
          <Button label="Ayarları kaydet" size="sm" fullWidth={false} loading={save.isPending} disabled={!current} onPress={() => void submit()} />
        </>
      }
    >
      {settings.isLoading || !current || !data ? (
        <ActivityIndicator />
      ) : (
        <>
          <View style={newsApiStyles.statGrid}>
            <View style={[styles.box, { borderColor: theme.colors.border }]}>
              <AppText variant="title">{new Intl.NumberFormat('tr-TR').format(data.active_sources)}</AppText>
              <AppText variant="caption" color="textSecondary">
                Aktif kaynak
              </AppText>
            </View>
            <View style={[styles.box, { borderColor: theme.colors.border }]}>
              <AppText variant="title">{new Intl.NumberFormat('tr-TR').format(data.queue_pending)}</AppText>
              <AppText variant="caption" color="textSecondary">
                Yayın kuyruğu
              </AppText>
            </View>
            <View style={[styles.box, { borderColor: theme.colors.border }]}>
              <AppText variant="title">{new Intl.NumberFormat('tr-TR').format(data.queue_blocked)}</AppText>
              <AppText variant="caption" color="textSecondary">
                Son 24s engellenen
              </AppText>
            </View>
          </View>

          <ToggleRow
            title="Haber API merkezi etkin"
            description="Kapatıldığında zamanlanmış çekim ve otomatik yayın turu çalışmaz."
            value={current.enabled}
            onValueChange={(value) => update({ enabled: value })}
          />
          <ToggleRow
            title="AI sınıflandırma etkin"
            description="DeepSeek ile kategori, ilçe ve hassas içerik kontrolü yapılır."
            value={current.aiEnabled}
            onValueChange={(value) => update({ aiEnabled: value })}
          />
          <ToggleRow
            title="Görselleri indir"
            description="Yayınlanacak haberlerin görselleri `posts` deposuna alınır; lisansı olmayan medya kullanılmaz."
            value={current.mediaDownload}
            onValueChange={(value) => update({ mediaDownload: value })}
          />

          <TextField
            label="Worker adresi"
            value={current.workerUrl}
            onChangeText={(value) => update({ workerUrl: value })}
            autoCapitalize="none"
            placeholder="https://<proje>.supabase.co/functions/v1/news-api-worker"
            hint="Boş bırakılırsa varsayılan Supabase Edge Function adresi kullanılır."
          />
          <TextField
            label="Dağıtım aralığı (dakika)"
            value={current.interval}
            onChangeText={(value) => update({ interval: value })}
            keyboardType="number-pad"
          />
          <TextField
            label="Günlük AI bütçesi (çağrı)"
            value={current.budget}
            onChangeText={(value) => update({ budget: value })}
            keyboardType="number-pad"
          />

          <View>
            <InfoRow label="Worker gizli anahtarı" value={data.worker_secret ? 'Tanımlı' : 'Tanımlı değil'} />
            <InfoRow label="Son tur" value={data.last_tick_at ? formatDateTimeTr(data.last_tick_at) : '—'} />
            <InfoRow label="Sonraki tur" value={data.next_run_at ? formatDateTimeTr(data.next_run_at) : '—'} />
          </View>

          {!data.worker_secret ? (
            <EmptyHint
              text="Vault içinde `ai_news_cron_secret` bulunamadı. Zamanlanmış turlar için bu secret tanımlanmalı."
              icon="key-outline"
            />
          ) : null}

          {error ? (
            <AppText variant="caption" color="danger">
              {error}
            </AppText>
          ) : null}
        </>
      )}
    </NewsModalShell>
  );
}

const styles = StyleSheet.create({
  box: { flexGrow: 1, flexBasis: 130, minWidth: 110, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 2 },
});
