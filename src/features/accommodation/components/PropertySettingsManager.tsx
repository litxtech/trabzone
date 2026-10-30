import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  usePropertyDetail,
  useSavePropertySettings,
} from '../hooks/use-accommodation';
import type { PropertySettings } from '../types';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '../utils/format';
import {
  AccCard,
  InlineError,
  InfoBanner,
  KeyValueRow,
  LoadingBlock,
  StatusPill,
} from './AccommodationUI';

const SETTING_TOGGLES: {
  key: keyof Pick<PropertySettings, 'notify_new_reservation' | 'notify_cancellation' | 'notify_messages' | 'auto_checkout' | 'web_tracking'>;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  {
    key: 'notify_new_reservation',
    label: 'Yeni rezervasyon bildirimi',
    description: 'Rezervasyon oluştuğunda tesise anlık bildirim gönderilir.',
    icon: 'notifications-outline',
  },
  {
    key: 'notify_cancellation',
    label: 'İptal bildirimi',
    description: 'İptal veya no-show durumunda bildirim gönderilir.',
    icon: 'close-circle-outline',
  },
  {
    key: 'notify_messages',
    label: 'Mesaj bildirimi',
    description: 'Misafir mesaj gönderdiğinde bildirim gönderilir.',
    icon: 'chatbubble-outline',
  },
  {
    key: 'auto_checkout',
    label: 'Otomatik çıkış',
    description: 'Çıkış tarihi geçen konaklamaları otomatik çıkışa alır. Oda temizliğe otomatik düşmez.',
    icon: 'log-out-outline',
  },
  {
    key: 'web_tracking',
    label: 'Web’den takip',
    description: 'Tesis sayfası görüntüleme ve dönüşüm verileri toplanır.',
    icon: 'globe-outline',
  },
];

export function PropertySettingsManager({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const detail = usePropertyDetail(propertyId);
  const save = useSavePropertySettings(propertyId);
  const [settings, setSettings] = useState<PropertySettings>({});
  const [holdMinutes, setHoldMinutes] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (detail.data?.settings) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings(detail.data.settings);
      setHoldMinutes(String(detail.data.settings.hold_minutes ?? 30));
    }
  }, [detail.data?.settings]);

  const property = detail.data;

  const toggle = (key: keyof PropertySettings) => {
    setSaved(false);
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  };

  const submit = async () => {
    setError(null);
    const minutes = Number(holdMinutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
      setError('Geçici oda tutma süresi 5–1440 dakika arasında olmalı.');
      return;
    }
    try {
      await save.mutateAsync({ ...settings, hold_minutes: Math.round(minutes) });
      setSaved(true);
      void detail.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ayarlar kaydedilemedi.');
    }
  };

  if (detail.isLoading) return <LoadingBlock height={260} />;
  if (detail.isError || !property) {
    return (
      <InlineError
        message={detail.error instanceof Error ? detail.error.message : 'Tesis bilgileri yüklenemedi.'}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  if (!property.can_manage) {
    return <InfoBanner text="Tesis ayarlarını yalnızca sahip veya yönetici yetkisi olan kullanıcılar değiştirebilir." tone="warning" />;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Otel ayarları</AppText>
          <AppText variant="caption" color="textTertiary">{property.name}</AppText>
        </View>
        <Button label="Kaydet" size="sm" fullWidth={false} loading={save.isPending} onPress={() => void submit()} />
      </View>

      {error ? <InlineError message={error} /> : null}
      {saved ? <InfoBanner text="Ayarlar kaydedildi." tone="success" /> : null}

      <View style={styles.grid}>
        <AccCard padding={13} style={styles.card}>
          <AppText variant="bodyStrong">Tesis durumu</AppText>
          <KeyValueRow label="Tür" value={PROPERTY_TYPE_LABELS[property.property_type]} />
          <KeyValueRow
            label="Yayın durumu"
            value={
              <StatusPill
                label={PROPERTY_STATUS_LABELS[property.status]}
                color={property.status === 'published' ? theme.colors.success : theme.colors.warning}
                background={property.status === 'published' ? theme.colors.successSoft : theme.colors.warningSoft}
              />
            }
          />
          <KeyValueRow
            label="Doğrulama"
            value={
              <StatusPill
                label={VERIFICATION_STATUS_LABELS[property.verification_status]}
                color={property.verification_status === 'verified' ? theme.colors.success : theme.colors.warning}
                background={property.verification_status === 'verified' ? theme.colors.successSoft : theme.colors.warningSoft}
              />
            }
          />
          <KeyValueRow label="Trabzone komisyonu" value={`%${property.commission_rate}`} />
          <KeyValueRow label="Görüntüleme" value={String(property.view_count)} />
          <KeyValueRow label="Ortalama puan" value={`${property.rating_avg.toFixed(1)} (${property.rating_count})`} />
        </AccCard>

        <AccCard padding={13} style={styles.card}>
          <AppText variant="bodyStrong">Rezervasyon ayarları</AppText>
          <TextField
            label="Geçici oda tutma süresi (dakika)"
            value={holdMinutes}
            onChangeText={(value) => {
              setHoldMinutes(value.replace(/[^\d]/g, ''));
              setSaved(false);
            }}
            keyboardType="number-pad"
            hint="Manuel onay bekleyen rezervasyonlar için oda bu süre boyunca tutulur. Süre dolunca oda serbest kalır."
          />
          <InfoBanner text="Anında rezervasyon modu oda tipi ve fiyat planı bazında belirlenir. Farklı oda tiplerinde farklı mod kullanabilirsin." />
        </AccCard>

        <AccCard padding={13} style={[styles.card, styles.wideCard]}>
          <AppText variant="bodyStrong">Bildirim ve otomasyon</AppText>
          {SETTING_TOGGLES.map((entry) => {
            const active = Boolean(settings[entry.key]);
            return (
              <Pressable
                key={entry.key}
                accessibilityRole="switch"
                accessibilityState={{ checked: active }}
                onPress={() => toggle(entry.key)}
                style={[styles.toggleRow, { borderBottomColor: theme.colors.divider }]}
              >
                <View style={[styles.toggleIcon, { backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted }]}>
                  <Ionicons name={entry.icon} size={16} color={active ? theme.colors.primary : theme.colors.textTertiary} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="body">{entry.label}</AppText>
                  <AppText variant="caption" color="textTertiary">{entry.description}</AppText>
                </View>
                <View style={[styles.switch, { backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted }]}>
                  <View
                    style={[
                      styles.knob,
                      {
                        backgroundColor: active ? '#fff' : theme.colors.textTertiary,
                        alignSelf: active ? 'flex-end' : 'flex-start',
                      },
                    ]}
                  />
                </View>
              </Pressable>
            );
          })}
        </AccCard>

        <AccCard padding={13} style={styles.card}>
          <AppText variant="bodyStrong">İletişim ve ticari bilgiler</AppText>
          <KeyValueRow label="Telefon" value={property.phone ?? '—'} />
          <KeyValueRow label="E-posta" value={property.email ?? '—'} />
          <KeyValueRow label="Vergi dairesi" value={property.tax_office ?? '—'} />
          <KeyValueRow label="Vergi no" value={property.tax_number ?? '—'} />
          <KeyValueRow label="Fatura ünvanı" value={property.invoice_title ?? '—'} />
          <KeyValueRow label="Giriş / çıkış" value={`${property.checkin_time} / ${property.checkout_time}`} />
          <AppText variant="caption" color="textTertiary">
            Bu bilgileri değiştirmek için “Tesis bilgileri” bölümünü kullan.
          </AppText>
        </AccCard>

        <AccCard padding={13} style={styles.card}>
          <AppText variant="bodyStrong">Fiyatlandırma özeti</AppText>
          <KeyValueRow label="Oda tipi" value={String(property.counts.room_types)} />
          <KeyValueRow label="Fiziksel oda" value={String(property.counts.rooms)} />
          <KeyValueRow label="Fiyat planı" value={String(property.counts.rate_plans)} />
          <KeyValueRow label="Medya" value={String(property.counts.media)} />
          <KeyValueRow label="Belge" value={String(property.counts.documents)} />
          <KeyValueRow label="Komisyon oranı" value={`%${property.commission_rate}`} />
          <AppText variant="caption" color="textTertiary">
            Komisyon yalnızca Trabzone kaynaklı tamamlanmış konaklamalarda uygulanır.
          </AppText>
        </AccCard>
      </View>

      <InfoBanner text="Finansal kayıtlar silinmez. Hatalı işlemler ters kayıt veya yetkili düzeltme ile yönetilir. Tesis ayarları değişiklikleri denetim kaydına yazılır." />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '32%', minWidth: 265, flexGrow: 1, gap: 3 },
  wideCard: { width: '66%', minWidth: 320 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  switch: { width: 38, height: 21, borderRadius: 11, padding: 2, justifyContent: 'center' },
  knob: { width: 17, height: 17, borderRadius: 9 },
});
