import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Switch, View } from 'react-native';

import { AppText, Button, Card, Screen, ScreenHeader, SelectSheet } from '@/components/ui';
import { loginHref } from '@/features/auth/next-path';
import {
  useNotificationPrefs,
  useSaveNotificationPrefs,
  useSendPushTest,
} from '@/features/notifications/hooks/use-notification-prefs';
import { currentPermission, registerForPush } from '@/features/notifications/push/push-registration';
import type {
  NotificationPrefs,
  NotificationPrefsInput,
} from '@/features/notifications/services/notifications-service';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useWebMeta } from '@/features/web/use-web-meta';

type Permission = Awaited<ReturnType<typeof currentPermission>>;

const HOURS = Array.from({ length: 24 }, (_, h) => `${h.toString().padStart(2, '0')}:00`);

const PERMISSION_TEXT: Record<Permission, string> = {
  granted: 'Bu cihazda bildirim izni verildi.',
  denied:
    'Bildirim izni reddedildi. Cihaz ayarlarından Trabzone için bildirimlere izin verebilirsiniz.',
  undetermined: 'Bildirimleri açtığınızda bu cihaz için izin istenecek.',
  unsupported:
    Platform.OS === 'web'
      ? 'Web tarayıcısında anlık bildirim desteklenmiyor. Bildirimler uygulama içi bildirim geçmişinize düşer.'
      : 'Bu uygulama sürümünde anlık bildirim modülü yok. Güncel sürümü yükleyin.',
};

const KIND_ROWS: { key: keyof NotificationPrefsInput; label: string; description: string }[] = [
  { key: 'likes', label: 'Beğeniler', description: 'Gönderilerini beğenenler' },
  { key: 'comments', label: 'Yorumlar ve bahsetmeler', description: 'Yorumlar ve @bahsetmeler' },
  { key: 'follows', label: 'Yeni takipçiler', description: 'Seni takip etmeye başlayanlar' },
  { key: 'messages', label: 'Mesajlar ve gruplar', description: 'Sohbet mesajları, grup davetleri' },
  { key: 'orders', label: 'Siparişler', description: 'Pazaryeri sipariş ve ilan hareketleri' },
  { key: 'support', label: 'Destek talepleri', description: 'Destek ekibinden yanıtlar' },
];

function toInput(prefs: NotificationPrefs): NotificationPrefsInput {
  return {
    push_enabled: prefs.push_enabled,
    sound_enabled: prefs.sound_enabled,
    quiet_hours_enabled: prefs.quiet_hours_enabled,
    quiet_start_hour: prefs.quiet_start_hour,
    quiet_end_hour: prefs.quiet_end_hour,
    likes: prefs.likes,
    comments: prefs.comments,
    follows: prefs.follows,
    messages: prefs.messages,
    orders: prefs.orders,
    support: prefs.support,
  };
}

export default function NotificationSettingsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const status = useAuthStatus();

  useWebMeta({
    title: 'Bildirim ayarları | Trabzone',
    description: 'Trabzone bildirim tercihleri: push, sessiz saatler ve bildirim türleri.',
    path: '/settings/notifications',
    noIndex: true,
  });

  if (status !== 'authenticated') {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <ScreenHeader title="Bildirimler" onBack={() => router.back()} />
        <View style={styles.center}>
          {status === 'booting' ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <>
              <AppText variant="body" color="textSecondary" align="center">
                Bildirim tercihlerini yönetmek için oturum açın.
              </AppText>
              <Button label="Giriş yap" onPress={() => router.push(loginHref('/settings/notifications') as never)} />
            </>
          )}
        </View>
      </Screen>
    );
  }

  return <PrefsForm />;
}

function PrefsForm() {
  const { theme } = useTheme();
  const router = useRouter();
  const prefs = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const test = useSendPushTest();
  const [draft, setDraft] = useState<NotificationPrefsInput | null>(null);
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

  if (prefs.isLoading || !value) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <ScreenHeader title="Bildirimler" onBack={() => router.back()} />
        <View style={styles.center}>
          {prefs.isError ? (
            <>
              <AppText variant="body" color="textSecondary" align="center">
                Tercihler yüklenemedi.
              </AppText>
              <Button label="Tekrar dene" variant="outline" onPress={() => void prefs.refetch()} />
            </>
          ) : (
            <ActivityIndicator color={theme.colors.primary} />
          )}
        </View>
      </Screen>
    );
  }

  const update = (patch: Partial<NotificationPrefsInput>) => {
    setMessage(null);
    setDraft({ ...value, ...patch });
  };

  const askPermission = async (): Promise<boolean> => {
    const result = await registerForPush({ prompt: true });
    setPermission(await currentPermission());
    if (result.ok) return true;
    setMessage({
      tone: 'warn',
      text:
        result.reason === 'denied'
          ? 'Cihaz izni verilmedi. Bildirimler yalnızca uygulama içinde görünür.'
          : 'Bu cihaz kaydedilemedi. Daha sonra tekrar denenecek.',
    });
    return false;
  };

  const onTogglePush = async (next: boolean) => {
    update({ push_enabled: next });
    // Ana anahtar açılırken izin penceresi burada gösterilir.
    if (next && permission !== 'granted') await askPermission();
  };

  const submit = async () => {
    setMessage(null);
    if (value.push_enabled && permission !== 'granted') await askPermission();
    save.mutate(value, {
      onSuccess: () => {
        setDraft(null);
        setMessage({ tone: 'ok', text: 'Bildirim tercihleriniz kaydedildi.' });
      },
      onError: (error) => setMessage({ tone: 'warn', text: error.message || 'Kaydedilemedi.' }),
    });
  };

  const runTest = () => {
    setMessage(null);
    test.mutate(undefined, {
      onSuccess: (result) => {
        if (result.ok) {
          setMessage({ tone: 'ok', text: 'Test bildirimi gönderildi. Birkaç saniye içinde gelmezse izinleri kontrol edin.' });
        } else {
          setMessage({ tone: 'warn', text: 'Bu hesaba kayıtlı etkin cihaz yok. Önce bildirimlere izin verin.' });
        }
      },
      onError: (error) => setMessage({ tone: 'warn', text: error.message || 'Test gönderilemedi.' }),
    });
  };

  const devices = prefs.data?.devices ?? [];

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <ScreenHeader title="Bildirimler" subtitle="Uygulama içi ve anlık bildirimler" onBack={() => router.back()} />

      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Anlık bildirimler</AppText>
            <AppText variant="caption" color="textSecondary">
              Beğeni, yorum, mesaj ve siparişlerde bu cihaza bildirim gönderilir. Kapatırsanız bildirimler yalnızca
              uygulama içi listede görünür.
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Anlık bildirimler"
            value={value.push_enabled}
            onValueChange={(next) => void onTogglePush(next)}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          />
        </View>
      </Card>

      <View style={[styles.permission, { borderColor: theme.colors.border }]}>
        <Ionicons
          name={permission === 'granted' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
          size={18}
          color={permission === 'granted' ? theme.colors.success : theme.colors.warning}
        />
        <View style={styles.flex}>
          <AppText variant="caption" color="textSecondary">
            {PERMISSION_TEXT[permission]}
          </AppText>
          {devices.length > 0 ? (
            <AppText variant="caption" color="textTertiary">
              Kayıtlı cihaz: {devices.length} · {devices[0]?.platform === 'ios' ? 'iOS' : 'Android'}
              {devices[0]?.app_version ? ` · v${devices[0].app_version}` : ''}
            </AppText>
          ) : null}
        </View>
        {permission === 'denied' && Platform.OS !== 'web' ? (
          <Button label="Ayarlar" variant="ghost" size="sm" onPress={() => void Linking.openSettings()} />
        ) : null}
      </View>

      <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
        BİLDİRİM TÜRLERİ
      </AppText>
      <Card padding={0}>
        {KIND_ROWS.map((row, index) => (
          <View key={row.key}>
            {index > 0 ? <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} /> : null}
            <View style={styles.row}>
              <View style={styles.flex}>
                <AppText variant="body">{row.label}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {row.description}
                </AppText>
              </View>
              <Switch
                accessibilityLabel={row.label}
                value={Boolean(value[row.key])}
                onValueChange={(next) => update({ [row.key]: next } as Partial<NotificationPrefsInput>)}
                trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
              />
            </View>
          </View>
        ))}
      </Card>

      <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
        SES VE SESSİZ SAATLER
      </AppText>
      <Card padding={0}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <AppText variant="body">Bildirim sesi</AppText>
            <AppText variant="caption" color="textTertiary">
              Kapalıyken bildirimler sessiz gelir.
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Bildirim sesi"
            value={value.sound_enabled}
            onValueChange={(next) => update({ sound_enabled: next })}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          />
        </View>
        <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
        <View style={styles.row}>
          <View style={styles.flex}>
            <AppText variant="body">Sessiz saatler</AppText>
            <AppText variant="caption" color="textTertiary">
              Bu saatlerde push gönderilmez; bildirimler uygulama içi listede kalır. Güvenlik uyarıları muaftır.
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
            <Button
              label={`Başlangıç ${HOURS[value.quiet_start_hour]}`}
              variant="outline"
              size="sm"
              onPress={() => setHourPicker('start')}
            />
            <Button
              label={`Bitiş ${HOURS[value.quiet_end_hour]}`}
              variant="outline"
              size="sm"
              onPress={() => setHourPicker('end')}
            />
          </View>
        ) : null}
      </Card>

      <Button
        label="Test bildirimi gönder"
        variant="outline"
        size="sm"
        loading={test.isPending}
        onPress={runTest}
      />

      {message ? (
        <AppText
          variant="caption"
          color={message.tone === 'ok' ? 'success' : 'warning'}
          accessibilityLiveRegion="polite"
        >
          {message.text}
        </AppText>
      ) : null}

      <Button
        label="Kaydet"
        disabled={!dirty}
        loading={save.isPending}
        onPress={() => void submit()}
        fullWidth
      />

      <AppText variant="caption" color="textTertiary" style={styles.note}>
        Deprem ve Trabzonspor bildirimleri kendi ekranlarından yönetilir. Tercihler hesabınıza bağlıdır; aynı hesabı
        kullandığınız tüm cihazlarda geçerlidir.
      </AppText>

      <SelectSheet
        visible={hourPicker != null}
        title={hourPicker === 'start' ? 'Sessiz saat başlangıcı' : 'Sessiz saat bitişi'}
        options={HOURS}
        value={hourPicker === 'start' ? HOURS[value.quiet_start_hour] : HOURS[value.quiet_end_hour]}
        onSelect={(label) => {
          const hour = HOURS.indexOf(label);
          if (hour >= 0) {
            update(hourPicker === 'start' ? { quiet_start_hour: hour } : { quiet_end_hour: hour });
          }
          setHourPicker(null);
        }}
        onClose={() => setHourPicker(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { paddingVertical: 48, paddingHorizontal: 24, gap: 14, alignItems: 'center' },
  card: { marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  permission: {
    marginTop: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionTitle: { marginTop: 18, paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 50,
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 12 },
  hours: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
  note: { marginTop: 14, lineHeight: 17 },
});
