import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useSendPushTest } from '@/features/notifications/hooks/use-notification-prefs';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAdminPharmacyOverview,
  useDispatchAdminPharmacyNotifications,
  usePreviewAdminPharmacyNotification,
} from '../hooks/use-pharmacy';
import type {
  PharmacyNotificationDispatchResult,
  PharmacyNotificationPreview,
} from '../types';
import { adminPharmacyStyles, EmptyHint, Pill, RowCard } from './shared';

export function PharmacyNotificationsTab({ canNotify }: { canNotify: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const overview = useAdminPharmacyOverview();
  const preview = usePreviewAdminPharmacyNotification();
  const dispatch = useDispatchAdminPharmacyNotifications();
  const test = useSendPushTest();
  const [district, setDistrict] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [notice, setNotice] = useState<PharmacyNotificationPreview | null>(null);
  const [result, setResult] = useState<PharmacyNotificationDispatchResult | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  async function runPreview() {
    try {
      const data = await preview.mutateAsync({
        district,
        neighborhood: neighborhood.trim() || null,
      });
      setNotice(data);
      setResult(null);
      if (!data.sendable) {
        toast.info(
          data.stale
            ? 'Veri tazelik eşiğini aştı; bildirim gönderilemez.'
            : data.notice_count === 0
              ? 'Bu bölge için doğrulanmış nöbet kaydı yok.'
              : 'Önizleme hazır ancak gönderim koşulları sağlanmıyor.',
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Önizleme oluşturulamadı.');
    }
  }

  /**
   * Yalnızca yöneticinin kendi cihazlarına giden test bildirimi. Gerçek
   * duyuruyla aynı kanalı (Android: "Nöbetçi eczane") ve aynı yolu kullanır;
   * uygulama kapalıyken teslimatı doğrulamak için kullanılır.
   */
  async function runTest() {
    try {
      const data = await test.mutateAsync('pharmacy');
      if (data.ok) {
        toast.success(
          `Test bildirimi kuyruğa girdi · ${data.devices ?? 0} cihaz. Uygulamayı arka plana alıp bekleyin.`,
        );
      } else {
        toast.error('Bu hesaba kayıtlı etkin cihaz yok. Telefonda bildirim iznini açın.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test bildirimi gönderilemedi.');
    }
  }

  async function runDispatch(dryRun: boolean) {
    try {
      const data = await dispatch.mutateAsync({ dryRun });
      setResult(data);
      setConfirmSend(false);
      toast.success(
        dryRun
          ? `Deneme gönderimi: ${data.eligible} uygun abone, ${data.sent} gönderim simüle edildi.`
          : `Gönderim tamamlandı: ${data.sent} bildirim, ${data.skipped} atlandı.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bildirim gönderilemedi.');
    }
  }

  return (
    <View style={adminPharmacyStyles.stack}>
      <AdminSection
        title="Nöbet bildirimleri"
        subtitle="İlçe ve mahalle bazlı abonelere günlük nöbet duyurusu"
      >
        <View style={adminPharmacyStyles.inline}>
          <Pill
            icon="people-outline"
            label={`${overview.data?.notifications.subscribers ?? 0} abone`}
          />
          <Pill
            icon="paper-plane-outline"
            label={`Bugün gönderilen: ${overview.data?.notifications.sent_today ?? 0}`}
          />
          <Pill
            icon={
              overview.data?.notifications.global_enabled
                ? 'checkmark-circle-outline'
                : 'close-circle-outline'
            }
            label={
              overview.data?.notifications.global_enabled
                ? 'Eczane bildirimleri açık'
                : 'Eczane bildirimleri kapalı'
            }
            tone={overview.data?.notifications.global_enabled ? 'success' : 'danger'}
          />
        </View>
        <AppText variant="caption" color="textTertiary">
          Günlük özet dışında sürekli bildirim gönderilmez. Aynı nöbet için tekrar gönderim
          engellenir; eczane adı yalnızca o tarihe ait doğrulanmış kayıtla eşleştiğinde kullanılır.
        </AppText>
      </AdminSection>

      <AdminSection title="Duyuru önizleme" subtitle="Gönderim öncesi metin ve uygunluk kontrolü">
        <View style={adminPharmacyStyles.formRow}>
          <TextField
            label="İlçe (boş = tüm Trabzon)"
            value={district ?? ''}
            onChangeText={(value) => setDistrict(value.trim() || null)}
            placeholder="Ortahisar"
            containerStyle={adminPharmacyStyles.grow}
          />
          <TextField
            label="Mahalle (isteğe bağlı)"
            value={neighborhood}
            onChangeText={setNeighborhood}
            placeholder="Kalkınma"
            containerStyle={adminPharmacyStyles.grow}
          />
        </View>
        <Button
          label="Önizlemeyi oluştur"
          size="sm"
          fullWidth={false}
          loading={preview.isPending}
          onPress={() => void runPreview()}
        />
        {notice ? (
          <View
            style={[
              styles.notice,
              {
                borderColor: notice.sendable ? theme.colors.success : theme.colors.warning,
                backgroundColor: theme.colors.surface,
              },
            ]}
          >
            <View style={adminPharmacyStyles.inline}>
              <Badge
                label={notice.sendable ? 'Gönderilebilir' : 'Gönderilemez'}
                tone={notice.sendable ? 'success' : 'warning'}
              />
              {notice.stale ? <Badge label="Veri eski" tone="danger" /> : null}
              {notice.already_sent > 0 ? (
                <Badge label={`${notice.already_sent} kez gönderildi`} tone="warning" />
              ) : null}
            </View>
            <AppText variant="bodyStrong">{notice.title}</AppText>
            <AppText variant="body" color="textSecondary">
              {notice.body}
            </AppText>
            <View style={adminPharmacyStyles.inline}>
              <Pill icon="calendar-outline" label={notice.date} />
              <Pill icon="people-outline" label={`${notice.eligible_subscribers} uygun abone`} />
              <Pill icon="moon-outline" label={`${notice.notice_count} nöbet kaydı`} />
              {notice.district ? <Pill icon="location-outline" label={notice.district} /> : null}
              {notice.neighborhood ? <Pill label={notice.neighborhood} /> : null}
            </View>
          </View>
        ) : null}
      </AdminSection>

      <AdminSection
        title="Gönderim"
        subtitle="Önce deneme gönderimi yapın; gerçek gönderim yalnızca doğrulanmış veriyle çalışır"
      >
        <View style={adminPharmacyStyles.inline}>
          <Button
            label="Bana test bildirimi gönder"
            size="sm"
            variant="outline"
            fullWidth={false}
            loading={test.isPending}
            onPress={() => void runTest()}
          />
          <Button
            label="Deneme gönderimi"
            size="sm"
            variant="secondary"
            fullWidth={false}
            loading={dispatch.isPending}
            disabled={!canNotify}
            onPress={() => void runDispatch(true)}
          />
          <Button
            label="Gerçek gönderim"
            size="sm"
            variant="danger"
            fullWidth={false}
            disabled={!canNotify}
            onPress={() => setConfirmSend(true)}
          />
        </View>
        {!canNotify ? (
          <AppText variant="caption" color="warning">
            Bildirim göndermek için pharmacy.notify izni gerekir.
          </AppText>
        ) : null}
        {result ? (
          <View style={adminPharmacyStyles.stack}>
            <View style={adminPharmacyStyles.inline}>
              <Badge label={result.dry_run ? 'Deneme' : 'Gerçek gönderim'} tone="primary" />
              <Pill icon="people-outline" label={`${result.eligible} uygun`} />
              <Pill icon="paper-plane-outline" label={`${result.sent} gönderildi`} tone="success" />
              <Pill
                icon="remove-circle-outline"
                label={`${result.skipped} atlandı`}
                tone={result.skipped > 0 ? 'warning' : 'neutral'}
              />
            </View>
            {result.samples.length === 0 ? (
              <EmptyHint icon="mail-outline" title="Örnek gönderim yok" />
            ) : (
              result.samples.map((sample) => (
                <RowCard
                  key={`${sample.user_id}-${sample.title}`}
                  title={sample.title}
                  subtitle={sample.body}
                  meta={
                    <>
                      <Pill
                        label={`${sample.district ?? 'İlçe yok'}${
                          sample.neighborhood ? ` · ${sample.neighborhood}` : ''
                        }`}
                      />
                      <Pill icon="navigate-outline" label={sample.route} />
                    </>
                  }
                />
              ))
            )}
          </View>
        ) : null}
      </AdminSection>

      <ReasonDialog
        visible={confirmSend}
        title="Gerçek bildirim gönderilsin mi?"
        description="Uygun abonelere günlük nöbet bildirimi gönderilecek. Veri eskiyse gönderim sunucu tarafında engellenir."
        confirmLabel="Gönder"
        destructive
        requireReason={false}
        loading={dispatch.isPending}
        onCancel={() => setConfirmSend(false)}
        onConfirm={() => void runDispatch(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { padding: 12, gap: 8, borderWidth: 1, borderRadius: 12 },
});
