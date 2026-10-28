import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, IconButton, Screen, Wordmark } from '@/components/ui';
import { APP_ICON_OPTIONS } from '@/features/appearance/constants/app-icons';
import { useAppIcon } from '@/features/appearance/hooks/use-app-icon';
import { useSettingsStore, type ThemeMode } from '@/stores/settings-store';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type Option = {
  mode: ThemeMode;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

const OPTIONS: Option[] = [
  {
    mode: 'system',
    label: 'Sistem',
    description: 'Cihazının görünüm ayarını takip et',
    icon: 'phone-portrait-outline',
  },
  { mode: 'light', label: 'Açık', description: 'Her zaman aydınlık tema', icon: 'sunny-outline' },
  { mode: 'dark', label: 'Koyu', description: 'Her zaman karanlık tema', icon: 'moon-outline' },
];

export default function AppearanceScreen() {
  const { theme, mode, setMode, scheme } = useTheme();
  const router = useRouter();
  const hapticsEnabled = useSettingsStore((state) => state.hapticsEnabled);
  const setHapticsEnabled = useSettingsStore((state) => state.setHapticsEnabled);

  const { icon, supported, setIcon, isSaving } = useAppIcon();
  const [iconError, setIconError] = useState<string | null>(null);

  const chooseIcon = async (next: (typeof APP_ICON_OPTIONS)[number]) => {
    if (!supported) {
      return;
    }
    setIconError(null);
    try {
      await setIcon(next.id);
      haptics.success();
    } catch (error) {
      haptics.error();
      setIconError(
        error instanceof Error ? error.message : 'Uygulama simgesi değiştirilemedi.',
      );
    }
  };

  const explainUnsupported = () => {
    Alert.alert(
      'Uygulama simgesi',
      'Simge değiştirme, mağaza/geliştirme derlemesinde kullanılabilir. Bu önizleme sürümünde native simge servisi bulunmuyor.',
    );
  };

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <AppText variant="h3">Görünüm</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <Card style={styles.preview}>
        <View style={styles.previewHeader}>
          <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
          <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} />
          <View style={[styles.dot, { backgroundColor: theme.colors.success }]} />
          <AppText variant="caption" color="textTertiary" style={styles.previewLabel}>
            {scheme === 'dark' ? 'Koyu tema' : 'Açık tema'}
          </AppText>
        </View>

        <Wordmark size={18} />
        <AppText variant="body" color="textSecondary">
          Renkler, yazı tipleri ve yüzeyler tema ile birlikte anında güncellenir.
        </AppText>

        <View style={styles.previewButtons}>
          <View style={[styles.previewButton, { backgroundColor: theme.colors.primary }]}>
            <AppText variant="label" color="onPrimary">
              Birincil
            </AppText>
          </View>
          <View
            style={[
              styles.previewButton,
              { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
            ]}
          >
            <AppText variant="label">Yüzey</AppText>
          </View>
        </View>
      </Card>

      <View style={styles.section}>
        <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
          TEMA
        </AppText>
        <Card padding={0}>
          {OPTIONS.map((option, index) => {
            const selected = mode === option.mode;
            return (
              <Pressable
                key={option.mode}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                onPress={() => {
                  haptics.selection();
                  setMode(option.mode);
                }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.divider,
                    backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                  },
                ]}
              >
                <View
                  style={[
                    styles.optionIcon,
                    {
                      backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <Ionicons
                    name={option.icon}
                    size={18}
                    color={selected ? theme.colors.primaryDeep : theme.colors.textSecondary}
                  />
                </View>

                <View style={styles.optionText}>
                  <AppText variant="bodyStrong">{option.label}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {option.description}
                  </AppText>
                </View>

                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
                      backgroundColor: selected ? theme.colors.primary : 'transparent',
                    },
                  ]}
                >
                  {selected ? (
                    <Ionicons name="checkmark" size={13} color={theme.colors.onPrimary} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
          ETKİLEŞİM
        </AppText>
        <Card padding={0}>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: hapticsEnabled }}
            accessibilityLabel="Dokunma titreşimi"
            onPress={() => {
              haptics.selection();
              setHapticsEnabled(!hapticsEnabled);
            }}
            style={({ pressed }) => [
              styles.option,
              { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' },
            ]}
          >
            <View style={[styles.optionIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="pulse-outline" size={18} color={theme.colors.textSecondary} />
            </View>
            <View style={styles.optionText}>
              <AppText variant="bodyStrong">Dokunma titreşimi</AppText>
              <AppText variant="caption" color="textSecondary">
                Butonlar ve menülerde hafif geri bildirim
              </AppText>
            </View>
            <View
              style={[
                styles.switchTrack,
                {
                  backgroundColor: hapticsEnabled ? theme.colors.primary : theme.colors.borderStrong,
                },
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  {
                    backgroundColor: theme.colors.onPrimary,
                    transform: [{ translateX: hapticsEnabled ? 16 : 0 }],
                  },
                ]}
              />
            </View>
          </Pressable>
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
          UYGULAMA SİMGESİ
        </AppText>
        <Card padding={0}>
          {APP_ICON_OPTIONS.map((option, index) => {
            const selected = icon === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !supported }}
                accessibilityLabel={`${option.label} simgesi`}
                disabled={!supported || isSaving}
                onPress={() => {
                  if (!supported) {
                    explainUnsupported();
                    return;
                  }
                  void chooseIcon(option);
                }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.divider,
                    backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                    opacity: supported ? 1 : 0.7,
                  },
                ]}
              >
                <Image
                  source={option.source}
                  style={[styles.iconPreview, { borderColor: theme.colors.border }]}
                  contentFit="cover"
                  transition={150}
                />
                <View style={styles.optionText}>
                  <AppText variant="bodyStrong">{option.label}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {option.description}
                  </AppText>
                </View>

                {isSaving && selected ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
                        backgroundColor: selected ? theme.colors.primary : 'transparent',
                      },
                    ]}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={13} color={theme.colors.onPrimary} />
                    ) : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </Card>

        {!supported ? (
          <View
            style={[
              styles.infoNote,
              { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm },
            ]}
          >
            <Ionicons name="information-circle-outline" size={15} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary" style={styles.noteText}>
              Simge değiştirme native bir özellik olduğu için mağaza/geliştirme derlemesinde
              kullanılabilir. Seçtiğin simge hesabına kaydedilir ve destekleyen cihazda uygulanır.
            </AppText>
          </View>
        ) : null}

        {iconError ? (
          <AppText variant="caption" color="danger" style={styles.iconError}>
            {iconError}
          </AppText>
        ) : null}
      </View>

      <AppText variant="caption" color="textTertiary" align="center" style={styles.footer}>
        Tema ve titreşim tercihleri bu cihazda, uygulama simgesi ise hesabında saklanır.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 16,
  },
  headerSpacer: { width: 44 },
  preview: { gap: 6 },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  previewLabel: { marginLeft: 'auto' },
  previewButtons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  previewButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  section: { marginTop: 20, gap: 8 },
  sectionTitle: { paddingHorizontal: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 58,
  },
  optionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchTrack: {
    width: 42,
    height: 26,
    borderRadius: 13,
    padding: 3,
    justifyContent: 'center',
  },
  switchThumb: { width: 20, height: 20, borderRadius: 10 },
  iconPreview: { width: 44, height: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 11,
  },
  noteText: { flex: 1 },
  iconError: { paddingHorizontal: 4 },
  footer: { marginTop: 20 },
});
