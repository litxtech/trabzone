import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

import { useNewsApiSaveSettings, useNewsApiSetAutoPublishAll, useNewsApiSettings } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import type { NewsSettings } from '@/features/news-api/types';

import { NewsModalShell } from './NewsModalShell';
import { EmptyHint, InfoRow, ToggleRow, newsApiStyles } from './shared';

function formFromSettings(settings: NewsSettings) {
  return {
    enabled: settings.enabled,
    aiEnabled: settings.ai_enabled,
    mediaDownload: settings.media_download_enabled,
    mediaGallery: settings.media_gallery_enabled !== false,
    videoCapture: settings.video_capture_enabled !== false,
    maxImages: String(settings.max_gallery_images ?? 10),
    maxVideoMb: String(settings.max_video_mb ?? 40),
    strictAi: settings.strict_ai_gate === true,
    strictRisk: settings.strict_risk_gate === true,
    strictChrome: settings.strict_page_chrome_gate === true,
    pauseAfter: String(settings.auto_pause_failures ?? 10),
    mediaPermission: settings.media_publish_requires_permission === true,
    videoPermission: settings.video_publish_requires_permission === true,
    permissionGate: settings.auto_publish_requires_permission === true,
    licenseGate: settings.auto_publish_requires_license === true,
    discoveryPublish: settings.allow_discovery_publish !== false,
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
  const autoPublishAll = useNewsApiSetAutoPublishAll();
  const [form, setForm] = useState<ReturnType<typeof formFromSettings> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleAutoPublishAll = async (enabled: boolean) => {
    setError(null);
    try {
      await autoPublishAll.mutateAsync({ enabled, includeAi: true });
      toast.success(
        enabled
          ? 'Onaysız yayın açıldı: kaynaklar ve AI haberleri kendiliğinden yayımlanacak.'
          : 'Onaysız yayın kapatıldı: yeni haberler inceleme kuyruğunda bekleyecek.',
      );
    } catch (toggleError) {
      setError(errorMessage(toggleError, 'Onaysız yayın anahtarı değiştirilemedi.'));
    }
  };

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
        media_gallery_enabled: current.mediaGallery,
        video_capture_enabled: current.videoCapture,
        max_gallery_images: Number(current.maxImages) || 10,
        max_video_mb: Number(current.maxVideoMb) || 40,
        strict_ai_gate: current.strictAi,
        strict_risk_gate: current.strictRisk,
        strict_page_chrome_gate: current.strictChrome,
        auto_pause_failures: Number(current.pauseAfter) || 10,
        media_publish_requires_permission: current.mediaPermission,
        video_publish_requires_permission: current.videoPermission,
        auto_publish_requires_permission: current.permissionGate,
        auto_publish_requires_license: current.licenseGate,
        allow_discovery_publish: current.discoveryPublish,
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
            title="Onaysız yayın (tüm kaynaklar)"
            description={
              data.auto_publish_all
                ? `Açık: ${data.sources_auto_publish}/${data.sources_auto_total} kaynak ve AI haberleri editör onayı beklemeden yayımlanıyor. Kapatmak için dokun.`
                : `Kapalı: haberler inceleme kuyruğunda bekler. ${data.sources_auto_publish}/${data.sources_auto_total} kaynakta otomatik yayın açık.`
            }
            value={data.auto_publish_all}
            disabled={autoPublishAll.isPending}
            onValueChange={(value) => void toggleAutoPublishAll(value)}
          />
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
            description="Haberlerin görselleri `posts` deposuna alınır. Kapalıyken hiçbir görsel veya video indirilmez."
            value={current.mediaDownload}
            onValueChange={(value) => update({ mediaDownload: value })}
          />
          <ToggleRow
            title="Tam medya galerisi"
            description="Haber sayfasında yayımlanan tüm görseller (OG, JSON-LD, galeri, srcset) sırayla çekilip gönderiye eklenir."
            value={current.mediaGallery}
            onValueChange={(value) => update({ mediaGallery: value })}
          />
          <ToggleRow
            title="Videoları çek"
            description="Haber sayfasındaki doğrudan video dosyaları indirilir; YouTube/Vimeo bağlantıları gönderi metnine eklenir."
            value={current.videoCapture}
            onValueChange={(value) => update({ videoCapture: value })}
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Galeri görsel sınırı"
                value={current.maxImages}
                onChangeText={(value) => update({ maxImages: value })}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Video sınırı (MB)"
                value={current.maxVideoMb}
                onChangeText={(value) => update({ maxVideoMb: value })}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <ToggleRow
            title="Sıkı AI kapısı"
            description="Açıkken AI'nın uygun bulmadığı haberler engellenir. Kapalıyken yalnızca uyarı notu olarak kaydedilir ve haber yayımlanır."
            value={current.strictAi}
            onValueChange={(value) => update({ strictAi: value })}
          />
          <ToggleRow
            title="Sıkı risk kapısı"
            description="Açıkken risk C sınıfı haberler engellenir. Kapalıyken haber uyarı notuyla yayımlanır."
            value={current.strictRisk}
            onValueChange={(value) => update({ strictRisk: value })}
          />
          <ToggleRow
            title="Sıkı sayfa arayüzü kapısı"
            description="Açıkken menü/çerez/künye metni taşıyan sayfalar engellenir. Kapalıyken içerik yine yayımlanır."
            value={current.strictChrome}
            onValueChange={(value) => update({ strictChrome: value })}
          />
          <ToggleRow
            title="Yayın için lisans zorunlu"
            description="Kapalıyken yalnızca açıkça yasaklı (prohibited) kaynaklar durdurulur; diğer lisans durumları yayımlanır."
            value={current.licenseGate}
            onValueChange={(value) => update({ licenseGate: value })}
          />
          <ToggleRow
            title="Yayın için izin zorunlu"
            description="Kapalıyken kaynak izin bayrakları yayını engellemez. Açıkken metin/özet izni aranır."
            value={current.permissionGate}
            onValueChange={(value) => update({ permissionGate: value })}
          />
          <ToggleRow
            title="Keşif modunda yayınla"
            description="Açıkken keşif modundaki kaynaklar da otomatik yayımlanır."
            value={current.discoveryPublish}
            onValueChange={(value) => update({ discoveryPublish: value })}
          />
          <ToggleRow
            title="Görseller için ayrı izin ara"
            description="Açıkken yalnızca görsel kullanım izni olan kaynakların fotoğrafları gönderiye eklenir."
            value={current.mediaPermission}
            onValueChange={(value) => update({ mediaPermission: value })}
          />
          <ToggleRow
            title="Videolar için ayrı izin ara"
            description="Açıkken yalnızca video kullanım izni olan kaynakların videoları paylaşılır."
            value={current.videoPermission}
            onValueChange={(value) => update({ videoPermission: value })}
          />
          <TextField
            label="Otomatik duraklatma eşiği"
            hint="Art arda bu kadar hata olursa kaynak yeni tur için duraklatılır. 0 yazılırsa hiç duraklatılmaz."
            value={current.pauseAfter}
            onChangeText={(value) => update({ pauseAfter: value })}
            keyboardType="number-pad"
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
  row: { flexDirection: 'row', gap: 12 },
});
