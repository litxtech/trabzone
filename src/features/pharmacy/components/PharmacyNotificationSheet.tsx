import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton, SelectSheet, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import type { PharmacyNotificationPrefs } from '../types';
import {
  usePharmacyNotificationPrefs,
  useSavePharmacyNotificationPrefs,
} from '../hooks/use-pharmacy';

const HOURS = Array.from({ length: 17 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`);

/**
 * Bölge bazlı nöbet bildirimi aboneliği.
 *
 * • Varsayılan kapalıdır; kullanıcı açmadan bildirim gönderilmez.
 * • En az bir ilçe seçilmeden abonelik kurulmaz (sunucu da reddeder).
 * • Birden çok ilçe seçilebilir; mahalle yalnızca tek ilçe seçiliyken geçerlidir.
 * • Aynı gün için tek bildirim gönderilir; seçili ilçeler tek bildirimde birleşir.
 *
 * Form, kayıtlı tercihler yüklendiğinde yeni anahtarla kurulur; effect içinde
 * setState çağrılmaz.
 */
export function PharmacyNotificationSheet({
  visible,
  onClose,
  districts,
  defaultDistrict,
}: {
  visible: boolean;
  onClose: () => void;
  districts: string[];
  defaultDistrict?: string | null;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const prefs = usePharmacyNotificationPrefs(visible);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bildirim penceresini kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.sheet,
            theme.shadows.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: Math.max(insets.bottom, 14),
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={styles.head}>
            <View style={styles.flex}>
              <AppText variant="h3">Nöbet bildirimleri</AppText>
              <AppText variant="caption" color="textTertiary">
                Yalnızca seçtiğin ilçeler için, günde en fazla bir kez
              </AppText>
            </View>
            <IconButton name="close" accessibilityLabel="Kapat" size={18} onPress={onClose} />
          </View>

          {prefs.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : visible ? (
            <NotificationForm
              key={prefs.data?.updated_at ?? 'new'}
              initial={prefs.data ?? null}
              districts={districts}
              defaultDistrict={defaultDistrict ?? null}
              onClose={onClose}
            />
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

function NotificationForm({
  initial,
  districts,
  defaultDistrict,
  onClose,
}: {
  initial: PharmacyNotificationPrefs | null;
  districts: string[];
  defaultDistrict: string | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const save = useSavePharmacyNotificationPrefs();

  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [selected, setSelected] = useState<string[]>(() => {
    if (initial?.enabled && initial.districts?.length) {
      return initial.districts;
    }
    return defaultDistrict ? [defaultDistrict] : [];
  });
  const [neighborhood, setNeighborhood] = useState(initial?.neighborhood ?? '');
  const [hour, setHour] = useState(`${String(initial?.notify_hour ?? 9).padStart(2, '0')}:00`);
  const [hourPicker, setHourPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const globalEnabled = initial?.global_enabled ?? true;
  const busy = save.isPending;
  const singleDistrict = selected.length === 1;

  const canSave = useMemo(() => {
    if (!enabled) {
      return true;
    }
    return selected.length > 0;
  }, [selected.length, enabled]);

  const toggleDistrict = (name: string) => {
    haptics.selection();
    setError(null);
    setSelected((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  };

  const submit = () => {
    setError(null);
    if (enabled && selected.length === 0) {
      setError('Bildirim almak için en az bir ilçe seçmelisin.');
      return;
    }
    const notifyHour = Number(hour.slice(0, 2));
    save.mutate(
      {
        enabled,
        districts: selected,
        neighborhood: enabled && singleDistrict && neighborhood.trim() ? neighborhood.trim() : null,
        notifyHour: Number.isFinite(notifyHour) ? notifyHour : 9,
      },
      {
        onSuccess: () => {
          haptics.success();
          onClose();
        },
        onError: (mutationError) => setError(mutationError.message || 'Tercih kaydedilemedi.'),
      },
    );
  };

  return (
    <>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
      >
        {!globalEnabled ? (
          <View
            style={[
              styles.info,
              { backgroundColor: theme.colors.warningSoft, borderColor: `${theme.colors.warning}33` },
            ]}
          >
            <Ionicons name="information-circle-outline" size={15} color={theme.colors.warning} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              Eczane nöbet bildirimleri şu anda yönetici tarafından kapalı. Tercihini
              kaydedebilirsin; bildirimler açıldığında uygulanır.
            </AppText>
          </View>
        ) : null}

        <View style={[styles.row, { borderColor: theme.colors.border }]}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Günlük nöbet bildirimi</AppText>
            <AppText variant="caption" color="textTertiary">
              Doğrulanmış kayıt yoksa eczane adı içeren bildirim gönderilmez.
            </AppText>
          </View>
          <Switch
            value={enabled}
            accessibilityLabel="Günlük nöbet bildirimini aç"
            onValueChange={(next) => {
              haptics.selection();
              setEnabled(next);
            }}
            trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={styles.districtBlock}>
          <View style={styles.districtHead}>
            <AppText variant="bodyStrong">İlçeler</AppText>
            <AppText variant="caption" color="textTertiary">
              {selected.length ? `${selected.length} ilçe seçili` : 'Birden çok ilçe seçebilirsin'}
            </AppText>
          </View>
          <View style={styles.districtGrid}>
            {districts.map((name) => {
              const active = selected.includes(name);
              return (
                <Pressable
                  key={name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${name} ilçesi için bildirim`}
                  onPress={() => toggleDistrict(name)}
                  style={[
                    styles.districtChip,
                    {
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  {active ? (
                    <Ionicons name="notifications" size={12} color={theme.colors.primaryDeep} />
                  ) : null}
                  <AppText
                    variant="caption"
                    style={{
                      color: active ? theme.colors.primaryDeep : theme.colors.textSecondary,
                      fontWeight: active ? '700' : '600',
                    }}
                  >
                    {name}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {singleDistrict ? (
          <TextField
            label="Mahalle (isteğe bağlı)"
            placeholder="Örn. Kalkınma"
            value={neighborhood}
            onChangeText={setNeighborhood}
            leftIcon="home-outline"
            hint="Mahalle yalnızca tek ilçe seçiliyken kullanılır ve eczane kayıtlarıyla eşleşmeli."
            maxLength={80}
            editable={enabled}
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bildirim saatini seç"
          onPress={() => setHourPicker(true)}
          style={[
            styles.field,
            { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="time-outline" size={18} color={theme.colors.textTertiary} />
          <View style={styles.flex}>
            <AppText variant="caption" color="textTertiary">
              Bildirim saati
            </AppText>
            <AppText variant="body">{hour}</AppText>
          </View>
          <Ionicons name="chevron-down" size={16} color={theme.colors.textTertiary} />
        </Pressable>

        <View
          style={[
            styles.note,
            { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Bildirimler nöbet listesinden otomatik üretilir. Kaynak güncellenmediyse veya kayıt
            yoksa bildirim gönderilmez; aynı nöbet için tekrar eden bildirim engellenir.
          </AppText>
        </View>

        {error ? (
          <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={styles.flex}>
              {error}
            </AppText>
          </View>
        ) : null}

        <Button label="Tercihi kaydet" onPress={submit} loading={busy} disabled={!canSave} />
      </ScrollView>

      <SelectSheet
        visible={hourPicker}
        title="Bildirim saati"
        options={HOURS}
        value={hour}
        onSelect={(value) => {
          setHour(value);
          setHourPicker(false);
        }}
        onClose={() => setHourPicker(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 8 },
  grabber: { width: 40, height: 4, borderRadius: 999, alignSelf: 'center', marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1 },
  body: { gap: 12, paddingTop: 10, paddingBottom: 6 },
  loading: { paddingVertical: 40, alignItems: 'center' },
  info: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: {
    flexDirection: 'row',
    gap: 8,
    padding: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  error: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 12 },
  districtBlock: { gap: 8 },
  districtHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  districtGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  districtChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    minHeight: 32,
  },
});
