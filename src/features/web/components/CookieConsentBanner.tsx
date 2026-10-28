import { Ionicons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  readCookiePreferences,
  saveCookiePreferences,
  subscribeCookieSettings,
  type CookiePreferences,
} from '../cookie-consent';

function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[
        styles.toggle,
        {
          backgroundColor: value ? theme.colors.primaryDeep : theme.colors.surfaceMuted,
          borderColor: value ? theme.colors.primaryDeep : theme.colors.border,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.knob,
          {
            backgroundColor: '#FFFFFF',
            transform: [{ translateX: value ? 18 : 2 }],
          },
        ]}
      />
    </Pressable>
  );
}

export function CookieConsentBanner() {
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<CookiePreferences | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [functional, setFunctional] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    let mounted = true;
    readCookiePreferences().then((value) => {
      if (!mounted) {
        return;
      }
      setPrefs(value);
      setFunctional(value?.functional ?? false);
      setAnalytics(value?.analytics ?? false);
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    return subscribeCookieSettings(() => {
      setFunctional(prefs?.functional ?? false);
      setAnalytics(prefs?.analytics ?? false);
      setSettingsOpen(true);
    });
  }, [prefs]);

  if (Platform.OS !== 'web' || !ready) {
    return null;
  }

  const decide = async (nextFunctional: boolean, nextAnalytics: boolean) => {
    const saved = await saveCookiePreferences({
      functional: nextFunctional,
      analytics: nextAnalytics,
    });
    setPrefs(saved);
    setFunctional(saved.functional);
    setAnalytics(saved.analytics);
    setSettingsOpen(false);
  };

  return (
    <>
      {!prefs ? (
        <View style={styles.wrap} pointerEvents="box-none">
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View style={styles.cardHead}>
              <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Çerez tercihlerin</AppText>
                <AppText variant="caption" color="textSecondary">
                  Zorunlu çerezler sitenin çalışması için gereklidir. Diğerleri yalnızca onayınla
                  etkinleşir.{' '}
                  <Link href={'/cookies' as Href} asChild>
                    <Pressable>
                      <AppText variant="caption" color="primaryDeep">
                        Çerez Politikası
                      </AppText>
                    </Pressable>
                  </Link>
                </AppText>
              </View>
            </View>

            <View style={styles.cardActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void decide(true, true)}
                style={({ pressed }) => [
                  styles.primaryAction,
                  { backgroundColor: theme.colors.primaryDeep, opacity: pressed ? 0.82 : 1 },
                ]}
              >
                <AppText variant="caption" color="onPrimary">
                  Tümünü Kabul Et
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void decide(false, false)}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  { borderColor: theme.colors.borderStrong, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <AppText variant="caption" color="text">
                  Zorunlu Olmayanları Reddet
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSettingsOpen(true)}
                style={({ pressed }) => [styles.linkAction, { opacity: pressed ? 0.65 : 1 }]}
              >
                <AppText variant="caption" color="textSecondary">
                  Tercihleri Yönet
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      <Modal
        visible={settingsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Çerez ayarlarını kapat"
            style={styles.modalBackdrop}
            onPress={() => setSettingsOpen(false)}
          />
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border },
            ]}
          >
            <View style={styles.modalHead}>
              <AppText variant="h3">Çerez Ayarları</AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                onPress={() => setSettingsOpen(false)}
              >
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.prefList} showsVerticalScrollIndicator={false}>
              <View style={styles.prefRow}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">Zorunlu çerezler</AppText>
                  <AppText variant="caption" color="textSecondary">
                    Oturum, güvenlik ve temel site işlevleri için gereklidir; kapatılamaz.
                  </AppText>
                </View>
                <Toggle value onChange={() => undefined} disabled />
              </View>

              <View style={styles.prefRow}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">İşlevsel çerezler</AppText>
                  <AppText variant="caption" color="textSecondary">
                    Dil, tema ve görünüm tercihlerini hatırlar.
                  </AppText>
                </View>
                <Toggle value={functional} onChange={setFunctional} />
              </View>

              <View style={styles.prefRow}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">Analitik çerezler</AppText>
                  <AppText variant="caption" color="textSecondary">
                    Site kullanımını toplu olarak ölçer. Bu sürümde analitik izleme etkin değildir.
                  </AppText>
                </View>
                <Toggle value={analytics} onChange={setAnalytics} />
              </View>

              <View style={styles.prefRow}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">Pazarlama çerezleri</AppText>
                  <AppText variant="caption" color="textSecondary">
                    Şu anda kullanılmamaktadır; ileride yalnızca ayrı onayla etkinleştirilir.
                  </AppText>
                </View>
                <Toggle value={false} onChange={() => undefined} disabled />
              </View>
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              onPress={() => void decide(functional, analytics)}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: theme.colors.primaryDeep, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <AppText variant="bodyStrong" color="onPrimary">
                Tercihleri Kaydet
              </AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 3 },
  wrap: {
    ...(Platform.OS === 'web'
      ? ({
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 90,
        } as unknown as object)
      : {}),
    padding: 14,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 1040,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 14px 42px rgba(0,0,0,0.22)' } as unknown as object)
      : {}),
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  primaryAction: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryAction: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  linkAction: { paddingHorizontal: 6, paddingVertical: 8 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(3, 7, 14, 0.68)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '86%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  prefList: { gap: 14, paddingVertical: 4 },
  prefRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  toggle: {
    width: 42,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
  },
  knob: { width: 18, height: 18, borderRadius: 9 },
  saveButton: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
});
