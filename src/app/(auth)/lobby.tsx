import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from '@/utils/router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Logo, Wordmark } from '@/components/ui';
import { AuthBackdrop } from '@/features/auth/components/AuthBackdrop';
import { LobbyShowcase } from '@/features/auth/components/LobbyShowcase';
import { SocialAuthButtons } from '@/features/auth/components/SocialAuthButtons';
import { socialAvailability } from '@/features/auth/social-availability';
import { ThemeScope } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

export default function LobbyScreen() {
  return (
    <ThemeScope scheme="dark">
      <LobbyContent />
    </ThemeScope>
  );
}

function LobbyContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const heroProgress = useSharedValue(0);
  const actionsProgress = useSharedValue(0);

  useEffect(() => {
    heroProgress.value = withTiming(1, {
      duration: 620,
      easing: Easing.out(Easing.cubic),
    });
    actionsProgress.value = withDelay(
      120,
      withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) }),
    );
  }, [actionsProgress, heroProgress]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroProgress.value,
    transform: [{ translateY: (1 - heroProgress.value) * 14 }],
  }));

  const actionsStyle = useAnimatedStyle(() => ({
    opacity: actionsProgress.value,
    transform: [{ translateY: (1 - actionsProgress.value) * 18 }],
  }));

  const compact = height < 760;
  const heroSize = width < 360 ? 32 : compact ? 34 : 38;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <AuthBackdrop />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 14,
            paddingBottom: insets.bottom + 20,
          },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Animated.View style={heroStyle}>
          <View style={styles.brandRow}>
            <View style={styles.brandLeft}>
              <Logo size={42} />
              <View style={styles.brandCopy}>
                <Wordmark size={20} color="#FFFFFF" accentColor="#A78BFA" />
                <AppText variant="overline" color="#7F8CA6" style={styles.brandTag}>
                  SOSYAL KEŞİF
                </AppText>
              </View>
            </View>
            <View style={styles.cityChip}>
              <Ionicons name="location" size={11} color="#9DB6FF" />
              <AppText variant="overline" color="#9DB6FF" style={styles.cityText}>
                TRABZON
              </AppText>
            </View>
          </View>

          <View style={styles.heroCopy}>
            <AppText
              variant="displayXl"
              color="#FFFFFF"
              style={[styles.heroLine, { fontSize: heroSize, lineHeight: heroSize * 1.16 }]}
            >
              Yeni bağlantılar.
            </AppText>
            <AppText
              variant="displayXl"
              color="#9DB6FF"
              style={[styles.heroLine, { fontSize: heroSize, lineHeight: heroSize * 1.16 }]}
            >
              Yeni keşifler.
            </AppText>
            <AppText variant="body" color="#96A3BD" style={styles.subcopy}>
              Paylaş, keşfet, sohbet et ve kendi dünyanı oluştur.
            </AppText>
          </View>

          <LobbyShowcase />
        </Animated.View>

        <Animated.View style={[styles.actions, actionsStyle]}>
          <Button
            label="Hesap Oluştur"
            size="lg"
            haptic="press"
            onPress={() => router.push('/register')}
            rightIcon={<Ionicons name="arrow-forward" size={18} color="#FFFFFF" />}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Giriş Yap"
            onPress={() => {
              haptics.tap();
              router.push('/login');
            }}
            style={({ pressed }) => [
              styles.loginButton,
              { opacity: pressed ? 0.78 : 1, transform: [{ scale: pressed ? 0.992 : 1 }] },
            ]}
          >
            <Ionicons name="log-in-outline" size={19} color="#FFFFFF" />
            <AppText variant="bodyStrong" color="#FFFFFF" style={styles.loginLabel}>
              Giriş Yap
            </AppText>
          </Pressable>

          {socialAvailability().any ? (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <AppText variant="caption" color="#6F7C96" style={styles.dividerText}>
                  veya sosyal hesabınla devam et
                </AppText>
                <View style={styles.dividerLine} />
              </View>

              <SocialAuthButtons />
            </>
          ) : null}

          <View style={styles.legal}>
            <View style={styles.legalRow}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Kullanım Koşulları"
                hitSlop={8}
                onPress={() =>
                  router.push({ pathname: '/policy/[slug]', params: { slug: 'terms' } })
                }
              >
                <AppText variant="caption" color="#8E9BB5">
                  Kullanım Koşulları
                </AppText>
              </Pressable>
              <View style={styles.legalDot} />
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Gizlilik Politikası"
                hitSlop={8}
                onPress={() =>
                  router.push({ pathname: '/policy/[slug]', params: { slug: 'privacy' } })
                }
              >
                <AppText variant="caption" color="#8E9BB5">
                  Gizlilik Politikası
                </AppText>
              </Pressable>
            </View>
            <AppText variant="caption" color="#5E6A83" align="center" style={styles.consent}>
              Devam ederek kullanım koşullarını ve gizlilik politikasını kabul etmiş olursun.
            </AppText>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05080F' },
  content: {
    paddingHorizontal: 22,
    gap: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  brandLeft: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1 },
  brandCopy: { gap: 1 },
  brandTag: { fontSize: 9, letterSpacing: 2.2, lineHeight: 12 },
  cityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(65,105,245,0.13)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(110,154,255,0.28)',
  },
  cityText: { fontSize: 9, letterSpacing: 1.3, lineHeight: 12 },
  heroCopy: { paddingTop: 24, gap: 1 },
  heroLine: { letterSpacing: -1 },
  subcopy: { marginTop: 10, maxWidth: 330, lineHeight: 22 },
  actions: { gap: 10 },
  loginButton: {
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  loginLabel: { fontSize: 15 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 3,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.11)',
  },
  dividerText: { fontSize: 10, letterSpacing: 0.2 },
  legal: { gap: 7, paddingTop: 4 },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  legalDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#4C5870',
  },
  consent: { fontSize: 10, lineHeight: 14, paddingHorizontal: 12 },
});
