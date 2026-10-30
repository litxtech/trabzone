import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Button, SelectSheet } from '@/components/ui';
import { loginHref } from '@/features/auth/next-path';
import { EqPage } from '@/features/earthquake/components/EqPage';
import { ChipRow, EmptyState, InfoNote, SectionTitle } from '@/features/earthquake/components/parts';
import { useEarthquakeHistory, useEarthquakePrefs, useSaveEarthquakePrefs } from '@/features/earthquake/hooks/use-earthquake';
import type { EarthquakePrefs, EarthquakePrefsInput } from '@/features/earthquake/types';
import { formatAgo, formatDecimal, formatLocalDateTime } from '@/features/earthquake/utils/format';
import { currentPermission, registerForPush } from '@/features/notifications/push/push-registration';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

type Threshold = 'all' | '1' | '2' | '3' | '4' | '5' | 'off';

const THRESHOLDS: { key: Threshold; label: string }[] = [
  { key: 'all', label: 'Tüm Depremler' },
  { key: '1', label: '≥ 1,0' },
  { key: '2', label: '≥ 2,0' },
  { key: '3', label: '≥ 3,0' },
  { key: '4', label: '≥ 4,0' },
  { key: '5', label: '≥ 5,0' },
  { key: 'off', label: 'Kapalı' },
];

const HOURS = Array.from({ length: 24 }, (_, h) => `${h.toString().padStart(2, '0')}:00`);

type Permission = Awaited<ReturnType<typeof currentPermission>>;

const PERMISSION_TEXT: Record<Permission, string> = {
  granted: 'Bu cihazda bildirim izni verildi.',
  denied: 'Bildirim izni reddedildi. Cihaz ayarlarından Trabzone için bildirimlere izin verebilirsiniz.',
  undetermined: 'Bildirimleri açtığınızda bu cihaz için izin istenecek.',
  unsupported:
    Platform.OS === 'web'
      ? 'Web tarayıcısında anlık bildirim desteklenmiyor. Bildirimler uygulama içi bildirim geçmişinize düşer.'
      : 'Bu uygulama sürümünde anlık bildirim modülü yok. Güncel sürümü yükleyin.',
};

function toInput(prefs: EarthquakePrefs): EarthquakePrefsInput {
  return {
    notifications_enabled: prefs.notifications_enabled,
    region_mode: prefs.region_mode,
    radius_km: prefs.radius_km,
    notify_all_magnitudes: prefs.notify_all_magnitudes,
    minimum_magnitude: prefs.minimum_magnitude,
    sound_enabled: prefs.sound_enabled,
    quiet_hours_enabled: prefs.quiet_hours_enabled,
    quiet_start_hour: prefs.quiet_start_hour,
    quiet_end_hour: prefs.quiet_end_hour,
  };
}

export default function EarthquakeNotificationsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const status = useAuthStatus();
  const signedIn = status === 'authenticated';

  useWebMeta({
    title: 'Deprem Bildirimlerim | Trabzone',
    description: 'Trabzone Deprem Merkezi bildirim tercihleri.',
    path: '/deprem/bildirimler',
    noIndex: true,
  });

  if (!signedIn) {
    return (
      <EqPage title="Deprem Bildirimlerim">
        <EmptyState
          icon="notifications-outline"
          title="Bildirimler için oturum açın"
          body="Deprem listesini, haritayı ve ayrıntıları oturum açmadan görebilirsiniz. Bildirim almak için hesabınızla giriş yapmanız gerekir; konum izni istenmez."
          action={
            status === 'booting' ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <Button label="Giriş yap" onPress={() => router.push(loginHref('/deprem/bildirimler'))} />
            )
          }
        />
      </EqPage>
    );
  }

  return <PrefsForm />;
}

function PrefsForm() {
  const { theme } = useTheme();
  const router = useRouter();
  const prefs = useEarthquakePrefs(true);
  const save = useSaveEarthquakePrefs();
  const history = useEarthquakeHistory(true);
  const [draft, setDraft] = useState<EarthquakePrefsInput | null>(null);
  const [permission, setPermission] = useState<Permission>('undetermined');
  const [hourPicker, setHourPicker] = useState<'start' | 'end' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void currentPermission().then((value) => {
      if (alive) setPermission(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const value = draft ?? (prefs.data ? toInput(prefs.data) : null);
  const dirty = draft != null;
  const historyItems = useMemo(() => history.data?.pages.flatMap((page) => page.items) ?? [], [history.data]);

  if (prefs.isLoading || !value) {
    return (
      <EqPage title="Deprem Bildirimlerim">
        {prefs.isError ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Tercihler yüklenemedi"
            action={<Button label="Tekrar dene" variant="outline" onPress={() => void prefs.refetch()} />}
          />
        ) : (
          <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
        )}
      </EqPage>
    );
  }

  const system = prefs.data?.system;
  const update = (patch: Partial<EarthquakePrefsInput>) => {
    setMessage(null);
    setDraft({ ...value, ...patch });
  };

  const threshold: Threshold = !value.notifications_enabled
    ? 'off'
    : value.notify_all_magnitudes
      ? 'all'
      : (String(value.minimum_magnitude) as Threshold);

  const onThreshold = (key: Threshold) => {
    if (key === 'off') update({ notifications_enabled: false });
    else if (key === 'all') update({ notifications_enabled: true, notify_all_magnitudes: true });
    else update({ notifications_enabled: true, notify_all_magnitudes: false, minimum_magnitude: Number(key) as 1 | 2 | 3 | 4 | 5 });
  };

  const submit = async () => {
    setMessage(null);
    let deviceNote: string | null = null;
    if (value.notifications_enabled) {
      const result = await registerForPush({ prompt: true });
      setPermission(await currentPermission());
      if (!result.ok) {
        deviceNote =
          result.reason === 'unsupported'
            ? 'Bu cihazda anlık bildirim kullanılamıyor; kayıtlar uygulama içi bildirimlerinize düşecek.'
            : result.reason === 'denied'
              ? 'Bildirim izni verilmedi; kayıtlar yalnızca uygulama içi bildirimlerinize düşecek.'
              : 'Cihaz kaydı tamamlanamadı; daha sonra tekrar denenecek.';
      }
    }
    save.mutate(value, {
      onSuccess: () => {
        setDraft(null);
        setMessage({ tone: deviceNote ? 'warn' : 'ok', text: deviceNote ?? 'Tercihleriniz kaydedildi.' });
      },
      onError: (error) => setMessage({ tone: 'warn', text: error.message || 'Kaydedilemedi.' }),
    });
  };

  return (
    <EqPage title="Deprem Bildirimlerim" subtitle="Hangi depremler için bildirim alacağınızı seçin">
      {system && (!system.notifications_enabled || system.paused) ? (
        <InfoNote icon="pause-circle-outline">
          Deprem bildirimleri şu anda sistem genelinde duraklatıldı. Tercihleriniz saklanır; gönderim yeniden
          başladığında uygulanır.
        </InfoNote>
      ) : null}

      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg }]}>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Deprem bildirimleri</AppText>
            <AppText variant="caption" color="textSecondary">
              Yeni deprem kaydı oluştuğunda bildirim gönderilir. Kesin konumunuz kullanılmaz.
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Deprem bildirimleri"
            value={value.notifications_enabled}
            onValueChange={(next) => update({ notifications_enabled: next })}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          />
        </View>
      </View>

      <SectionTitle title="Büyüklük" />
      <ChipRow label="Bildirim büyüklük eşiği" options={THRESHOLDS} value={threshold} onChange={onThreshold} />
      {system && !system.small_enabled && (threshold === 'all' || threshold === '1') ? (
        <InfoNote>
          Şu anda {formatDecimal(system.small_threshold, 1)} altındaki depremler için anlık bildirim gönderilmiyor; bu
          kayıtlar listede görünmeye devam eder.
        </InfoNote>
      ) : null}

      <SectionTitle title="Bölge" />
      <ChipRow
        label="Bildirim bölgesi"
        options={[
          { key: 'trabzon' as const, label: 'Trabzon çevresi' },
          { key: 'province' as const, label: 'Trabzon il sınırı' },
          ...(system?.turkey_enabled ? [{ key: 'turkey' as const, label: 'Türkiye geneli' }] : []),
        ]}
        value={value.region_mode}
        onChange={(region_mode) => update({ region_mode })}
      />
      {value.region_mode === 'trabzon' ? (
        <ChipRow
          label="Trabzon merkezine uzaklık"
          options={(['50', '100', '150', '250'] as const).map((km) => ({ key: km, label: `${km} km` }))}
          value={String(value.radius_km) as '50' | '100' | '150' | '250'}
          onChange={(km) => update({ radius_km: Number(km) as 50 | 100 | 150 | 250 })}
        />
      ) : null}
      <AppText variant="caption" color="textTertiary">
        {value.region_mode === 'trabzon'
          ? `Merkez üssü Trabzon merkezine ${value.radius_km} km içindeki depremler.`
          : value.region_mode === 'province'
            ? 'Merkez üssü Trabzon il sınırı (deniz alanı dahil) içindeki depremler.'
            : 'Türkiye ve yakın çevresindeki tüm depremler. Bildirim sayısı yüksek olabilir.'}
      </AppText>

      <SectionTitle title="Ses ve sessiz saatler" />
      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg }]}>
        <View style={styles.switchRow}>
          <AppText variant="body" style={styles.flex}>
            Bildirim sesi
          </AppText>
          <Switch
            accessibilityLabel="Bildirim sesi"
            value={value.sound_enabled}
            onValueChange={(next) => update({ sound_enabled: next })}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <AppText variant="body">Sessiz saatler</AppText>
            <AppText variant="caption" color="textSecondary">
              Bu saatlerde anlık bildirim gönderilmez; kayıt bildirim geçmişinize düşer.
              {system ? ` ${formatDecimal(system.quiet_bypass_magnitude, 1)} ve üzeri depremler sessiz saatte de iletilir.` : ''}
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Sessiz saatler"
            value={value.quiet_hours_enabled}
            onValueChange={(next) => update({ quiet_hours_enabled: next })}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          />
        </View>
        {value.quiet_hours_enabled ? (
          <View style={styles.hours}>
            <Button label={`Başlangıç ${HOURS[value.quiet_start_hour]}`} variant="outline" size="sm" onPress={() => setHourPicker('start')} />
            <Button label={`Bitiş ${HOURS[value.quiet_end_hour]}`} variant="outline" size="sm" onPress={() => setHourPicker('end')} />
          </View>
        ) : null}
      </View>

      <InfoNote icon={permission === 'granted' ? 'phone-portrait-outline' : 'alert-circle-outline'}>
        {PERMISSION_TEXT[permission]}
      </InfoNote>
      {permission === 'denied' && Platform.OS !== 'web' ? (
        <Button label="Cihaz ayarlarını aç" variant="ghost" size="sm" onPress={() => void Linking.openSettings()} />
      ) : null}

      {message ? (
        <AppText variant="caption" color={message.tone === 'ok' ? 'success' : 'warning'} accessibilityLiveRegion="polite">
          {message.text}
        </AppText>
      ) : null}
      <Button label="Kaydet" disabled={!dirty} loading={save.isPending} onPress={() => void submit()} fullWidth />

      <InfoNote icon="alert-circle-outline">
        Bildirimler kaynaklarda yayımlanan kayıtlara dayanır ve gecikebilir. Trabzone deprem tahmini veya resmî erken uyarı
        hizmeti sunmaz; kritik uyarı ayrıcalığı kullanmaz.
      </InfoNote>

      <SectionTitle title="Bildirim geçmişi" />
      {history.isLoading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : historyItems.length === 0 ? (
        <AppText variant="caption" color="textSecondary">
          Henüz deprem bildirimi almadınız.
        </AppText>
      ) : (
        <View style={styles.history}>
          {historyItems.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              disabled={!item.route}
              onPress={() => item.route && router.push(item.route as never)}
              style={[styles.historyRow, { borderColor: theme.colors.border, borderRadius: theme.radius.md }]}
            >
              <Ionicons
                name={item.type === 'test' ? 'flask-outline' : item.type === 'revision' ? 'refresh-outline' : 'pulse-outline'}
                size={18}
                color={item.type === 'test' ? theme.colors.warning : theme.colors.primary}
              />
              <View style={styles.flex}>
                <AppText variant="label" numberOfLines={1}>
                  {item.title ?? 'Deprem bildirimi'}
                </AppText>
                {item.body ? (
                  <AppText variant="caption" color="textSecondary" numberOfLines={3}>
                    {item.body}
                  </AppText>
                ) : null}
                <AppText variant="caption" color="textTertiary">
                  {formatLocalDateTime(item.created_at)} · {formatAgo(item.created_at)}
                  {item.push && item.push.suppressed > 0 && item.push.sent === 0 ? ' · Sessiz saatte gönderilmedi' : ''}
                </AppText>
              </View>
            </Pressable>
          ))}
          {history.hasNextPage ? (
            <Button
              label="Daha fazla"
              variant="outline"
              size="sm"
              loading={history.isFetchingNextPage}
              onPress={() => void history.fetchNextPage()}
            />
          ) : null}
        </View>
      )}

      <SelectSheet
        visible={hourPicker != null}
        title={hourPicker === 'start' ? 'Sessiz saat başlangıcı' : 'Sessiz saat bitişi'}
        options={HOURS}
        value={hourPicker === 'start' ? HOURS[value.quiet_start_hour] : HOURS[value.quiet_end_hour]}
        onSelect={(label) => {
          const hour = HOURS.indexOf(label);
          if (hour >= 0) update(hourPicker === 'start' ? { quiet_start_hour: hour } : { quiet_end_hour: hour });
          setHourPicker(null);
        }}
        onClose={() => setHourPicker(null)}
      />
    </EqPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loader: { paddingVertical: 32 },
  card: { padding: 14, gap: 14, borderWidth: StyleSheet.hairlineWidth },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hours: { flexDirection: 'row', gap: 10 },
  history: { gap: 8 },
  historyRow: { flexDirection: 'row', gap: 10, padding: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
});
