import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from '@/utils/router';
import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Logo, Wordmark } from '@/components/ui';
import { useKeyboard } from '@/providers/keyboard';
import { ThemeScope } from '@/theme/ThemeProvider';

import { AuthBackdrop } from './AuthBackdrop';

type AuthScreenProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  scroll?: boolean;
  footer?: ReactNode;
};

/**
 * Giris/kayit ekranlarinin ortak premium kabugu. Tum auth akisi sistem
 * temasindan bagimsiz olarak koyu lacivert yuzeyde calisir; alanlar, hata
 * mesajlari ve baglantilar ayni tasarim dilini paylasir.
 */
export function AuthScreen(props: AuthScreenProps) {
  return (
    <ThemeScope scheme="dark">
      <AuthScreenInner {...props} />
    </ThemeScope>
  );
}

function AuthScreenInner({
  children,
  title,
  subtitle,
  showBack = true,
  scroll = true,
  footer,
}: AuthScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboard().height;
  const keyboardStyle = useAnimatedStyle(() => ({ paddingBottom: keyboardHeight.value }));

  const content = (
    <View
      style={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 },
      ]}
    >
      <View style={styles.topRow}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Geri"
            hitSlop={8}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/lobby'))}
            style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.65 : 1 }]}
          >
            <Ionicons name="chevron-back" size={21} color="#FFFFFF" />
          </Pressable>
        ) : (
          <View style={styles.backPlaceholder} />
        )}

        <View style={styles.brand}>
          <Logo size={26} />
          <Wordmark size={14} color="#EAF0FF" accentColor="#A78BFA" />
        </View>
      </View>

      {title ? (
        <View style={styles.header}>
          <AppText variant="h1" color="#FFFFFF" style={styles.title}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="body" color="#9AA7C2">
              {subtitle}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {children}
    </View>
  );

  return (
    <View style={styles.flex}>
      <StatusBar style="light" />
      <AuthBackdrop />
      <Animated.View style={[styles.flex, keyboardStyle]}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
        {footer}
      </Animated.View>
      <View pointerEvents="none" style={styles.bottomEdge} />
    </View>
  );
}

export function InlineLink({
  label,
  onPress,
  align = 'center',
}: {
  label: string;
  onPress: () => void;
  align?: 'center' | 'flex-start';
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [{ alignSelf: align, opacity: pressed ? 0.6 : 1 }]}
    >
      <AppText variant="label" color="#8FB2FF">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#05080F' },
  scrollContent: { flexGrow: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 22,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    marginLeft: -4,
  },
  backPlaceholder: { width: 40, height: 40 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  header: { gap: 8, paddingTop: 6 },
  title: { fontSize: 29, lineHeight: 35, letterSpacing: -0.7 },
  bottomEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
});
