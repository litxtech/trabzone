import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Button, SelectSheet } from '@/components/ui';
import { loginHref } from '@/features/auth/next-path';
import { EqPage } from '@/features/earthquake/components/EqPage';
import { EmptyState, InfoNote, SectionTitle } from '@/features/earthquake/components/parts';
import { currentPermission, registerForPush } from '@/features/notifications/push/push-registration';
import { useSaveSportsPrefs, useSportsHistory, useSportsPrefs } from '@/features/sports/hooks/use-sports';
import type { SportsPrefs, SportsPrefsInput } from '@/features/sports/types';
import { relativeAge, shortDate } from '@/features/sports/utils/format';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

const HOURS = Array.from({ length: 24 }, (_, h) => `${h.toString().padStart(2, '0')}:00`);

type Permission = Awaited<ReturnType<typeof currentPermission>>;

const PERMISSION_TEXT: Record<Permission, string> = {
  granted: 'Bu cihazda bildirim izni verildi.',
  denied: 'Bildirim izni reddedildi. Cihaz ayarlarından Trabzone için bildirimlere izin verebilirsin.',
  undetermined: 'Bildirimleri açıp kaydettiğinde bu cihaz için izin istenecek.',
  unsupported:
    Platform.OS === 'web'
      ? 'Web tarayıcısında anlık bildirim desteklenmiyor. Bildirimler uygulama içi bildirim geçmişine düşer.'
      : 'Bu uygulama sürümünde anlık bildirim modülü yok. Güncel sürümü yükle.',
};

type ToggleKey = Exclude<
  keyof SportsPrefsInput,
  'enabled' | 'sound_enabled' | 'quiet_hours_enabled' | 'quiet_start_hour' | 'quiet_end_hour'
>;

const TYPES: { key: ToggleKey; label: string; hint: string }[] = [
  { key: 'reminder', label: 'Maç hatırlatması', hint: 'Başlama saatinden önce (yönetimin belirlediği süre).' },
  { key: 'lineups', label: 'İlk 11 açıklandı', hint: 'Resmi kadro sağlayıcıda yayımlandığında.' },
  { key: 'kickoff', label: 'Maç başladı', hint: 'Yalnızca sağlayıcı başlamayı doğruladığında.' },
  { key: 'goal_for', label: 'Trabzonspor golü', hint: 'VAR iptallerinde düzeltme bildirimi gelir.' },
  { key: 'goal_against', label: 'Rakip golü', hint: 'VAR iptallerinde düzeltme bildirimi gelir.' },
  { key: 'red_card', label: 'Kırmızı kart', hint: 'Her iki takım için.' },
  { key: 'half_time', label: 'İlk yarı sonucu', hint: '' },
  { key: 'full_time', label: 'Maç sonucu', hint: 'Sonuç doğrulandıktan sonra.' },
  { key: 'postponed', label: 'Erteleme / iptal', hint: 'Maç durumu değiştiğinde.' },
  { key: 'announcement', label: 'Duyurular', hint: 'Trabzone maç merkezi duyuruları.' },
];

function toInput(prefs: SportsPrefs): SportsPrefsInput {
  const { saved: _saved, system_enabled: _system, devices: _devices, ...rest } = prefs;
  return rest;
}

export default function SportsNotificationsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const status = useAuthStatus();
  const signedIn = status === 'authenticated';

  useWebMeta({
    title: 'Trabzonspor Bildirimlerim | Trabzone',
    description: 'Trabzonspor maç bildirim tercihleri.',
    path: '/trabzonspor/bildirimler',
    noIndex: true,
  });

  if (!signedIn) {
    return (
      <EqPage title="Trabzonspor Bildirimlerim" fallbackHref="/trabzonspor">
        <EmptyState
          icon="notifications-outline"
          title="Bildirimler için oturum aç"
          body="Maç bildirimleri yalnızca hesabıyla giriş yapmış ve açıkça onay vermiş kullanıcılara gönderilir."
          action={
            status === 'booting' ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <Button label="Giriş yap" onPress={() => router.push(loginHref('/trabzonspor/bildirimler'))} />
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
  const prefs = useSportsPrefs(true);
  const save = useSaveSportsPrefs();
  const history = useSportsHistory(true);
  const [draft, setDraft] = useState<SportsPrefsInput | null>(null);
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
  const dirty = draft != null || (prefs.data != null && !prefs.data.saved);
  const historyItems = useMemo(() => history.data?.pages.flatMap((page) => page.items) ?? [], [history.data]);

  if (prefs.isLoading || !value) {
    return (
      <EqPage title="Trabzonspor Bildirimlerim" fallbackHref="/trabzonspor">
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

  const update = (patch: Partial<SportsPrefsInput>) => {
    setMessage(null);
    setDraft({ ...value, ...patch });
  };

  const submit = async () => {
    setMessage(null);
    let deviceNote: string | null = null;
    if (value.enabled) {
      const result = await registerForPush({ prompt: true });
      setPermission(await currentPermission());
      if (!result.ok) {
        deviceNote =
          result.reason === 'unsupported'
            ? 'Bu cihazda anlık bildirim kullanılamıyor; bildirimler uygulama içi geçmişine düşecek.'
            : result.reason === 'denied'
              ? 'Bildirim izni verilmedi; bildirimler yalnızca uygulama içi geçmişine düşecek.'
              : 'Cihaz kaydı tamamlanamadı; daha sonra tekrar denenecek.';
      }
    }
    save.mutate(value, {
      onSuccess: () => {
        setDraft(null);
        setMessage({ tone: deviceNote ? 'warn' : 'ok', text: deviceNote ?? 'Tercihlerin kaydedildi.' });
      },
      onError: (error) => setMessage({ tone: 'warn', text: error.message || 'Kaydedilemedi.' }),
    });
  };

  const cardStyle = [
    styles.card,
    { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg },
  ];

  return (
    <EqPage title="Trabzonspor Bildirimlerim" subtitle="Hangi maç anları için bildirim alacağını seç" fallbackHref="/trabzonspor">
      {prefs.data && !prefs.data.system_enabled ? (
        <InfoNote icon="pause-circle-outline">
          Maç bildirimleri şu anda sistem genelinde duraklatıldı. Tercihlerin saklanır; gönderim yeniden başladığında uygulanır.
        </InfoNote>
      ) : null}

      <View style={cardStyle}>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Trabzonspor maç bildirimleri</AppText>
            <AppText variant="caption" color="textSecondary">
              Açıkça onay vermediğin sürece hiçbir maç bildirimi gönderilmez.
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Trabzonspor maç bildirimleri"
            value={value.enabled}
            onValueChange={(next) => update({ enabled: next })}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          />
        </View>
      </View>

      {value.enabled ? (
        <>
          <SectionTitle title="Bildirim türleri" />
          <View style={cardStyle}>
            {TYPES.map((item) => (
              <View key={item.key} style={styles.switchRow}>
                <View style={styles.flex}>
                  <AppText variant="body">{item.label}</AppText>
                  {item.hint ? (
                    <AppText variant="caption" color="textSecondary">
                      {item.hint}
                    </AppText>
                  ) : null}
                </View>
                <Switch
                  accessibilityLabel={item.label}
                  value={value[item.key]}
                  onValueChange={(next) => update({ [item.key]: next } as Partial<SportsPrefsInput>)}
                  trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
                />
              </View>
            ))}
          </View>

          <SectionTitle title="Ses ve sessiz saatler" />
          <View style={cardStyle}>
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
                  Bu saatlerde anlık bildirim gönderilmez; kayıt bildirim geçmişine düşer.
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
        </>
      ) : null}

      <InfoNote icon={permission === 'granted' ? 'phone-portrait-outline' : 'alert-circle-outline'}>
        {PERMISSION_TEXT[permission]}
        {prefs.data && prefs.data.devices > 0 ? ` Kayıtlı cihaz: ${prefs.data.devices}.` : ''}
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

      <InfoNote icon="information-circle-outline">
        Skor ve olay bildirimleri resmi veri sağlayıcısının (API-Football) yayımladığı kayıtlara dayanır ve birkaç saniye
        gecikebilir. Belirli bir maçı sessize almak için maç ekranındaki zil simgesini kullan.
      </InfoNote>

      <SectionTitle title="Bildirim geçmişi" />
      {history.isLoading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : historyItems.length === 0 ? (
        <AppText variant="caption" color="textSecondary">
          Henüz maç bildirimi almadın.
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
                name={item.is_test ? 'flask-outline' : item.type === 'correction' ? 'refresh-outline' : 'football-outline'}
                size={18}
                color={item.is_test ? theme.colors.warning : theme.colors.primary}
              />
              <View style={styles.flex}>
                <AppText variant="label" numberOfLines={1}>
                  {item.is_test ? `[TEST] ${item.title}` : item.title}
                </AppText>
                {item.body ? (
                  <AppText variant="caption" color="textSecondary" numberOfLines={3}>
                    {item.body}
                  </AppText>
                ) : null}
                <AppText variant="caption" color="textTertiary">
                  {shortDate(item.created_at)} · {relativeAge(item.created_at)}
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
