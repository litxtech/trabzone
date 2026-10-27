import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
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

import { AppText, Button, Logo } from '@/components/ui';
import { env } from '@/config/env';
import { useTheme } from '@/theme/ThemeProvider';

const HIGHLIGHTS = [
  { icon: 'people-outline', title: 'Yeni insanlarla tanış', body: 'Yakınındaki kişileri keşfet.' },
  { icon: 'chatbubbles-outline', title: 'Anlık mesajlaş', body: 'Hızlı, güvenli birebir sohbet.' },
  { icon: 'videocam-outline', title: 'Sesli ve görüntülü', body: 'Kaliteli görüşmeler, tek dokunuşla.' },
] as const;

export default function LobbyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const heroOpacity = useSharedValue(0);
  const heroOffset = useSharedValue(18);
  const cardOpacity = useSharedValue(0);
  const cardOffset = useSharedValue(28);

  useEffect(() => {
    heroOpacity.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    heroOffset.value = withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) });
    cardOpacity.value = withDelay(180, withTiming(1, { duration: 520 }));
    cardOffset.value = withDelay(180, withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) }));
  }, [cardOffset, cardOpacity, heroOffset, heroOpacity]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroOffset.value }],
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardOffset.value }],
  }));

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <LinearGradient
        colors={theme.gradients.splash}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={[styles.hero, { height: Math.max(380, height * 0.52) }]}
      >
        <View style={styles.orbOne} pointerEvents="none" />
        <View style={styles.orbTwo} pointerEvents="none" />

        <ScrollView
          contentContainerStyle={styles.heroContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Animated.View style={[styles.brand, heroStyle]}>
            <Logo size={92} />
            <View style={styles.wordmark}>
              <AppText variant="display" color="#FFFFFF" style={styles.title}>
                TRABZONE
              </AppText>
              <AppText variant="caption" color="rgba(255,255,255,0.74)">
                Trabzon&apos;un dijital buluşma noktası
              </AppText>
            </View>
          </Animated.View>
        </ScrollView>
      </LinearGradient>

      <Animated.View style={[styles.sheet, { backgroundColor: theme.colors.surface }, cardStyle]}>
        <View style={[styles.handle, { backgroundColor: theme.colors.borderStrong }]} />
        <ScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

        <View style={styles.sheetHeader}>
          <AppText variant="h2">Trabzone&apos;a hoş geldin</AppText>
          <AppText variant="body" color="textSecondary">
            Şehrin nabzını tut, yeni bağlantılar kur. Hazırsan birkaç saniyede hesabını oluştur.
          </AppText>
        </View>

        <View style={styles.highlights}>
          {HIGHLIGHTS.map((item) => (
            <View key={item.title} style={styles.highlightRow}>
              <View style={[styles.highlightIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name={item.icon} size={18} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.highlightCopy}>
                <AppText variant="label">{item.title}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {item.body}
                </AppText>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Button label="Hesap Oluştur" onPress={() => router.push('/register')} haptic="press" />
          <Button
            label="Giriş Yap"
            variant="outline"
            onPress={() => router.push('/login')}
            leftIcon={<Ionicons name="log-in-outline" size={19} color={theme.colors.text} />}
          />

          {env.enableSocialAuth ? (
            <View style={styles.social}>
              <View style={styles.dividerRow}>
                <View style={[styles.line, { backgroundColor: theme.colors.divider }]} />
                <AppText variant="caption" color="textTertiary">
                  veya
                </AppText>
                <View style={[styles.line, { backgroundColor: theme.colors.divider }]} />
              </View>
              <Button
                label="Google ile devam et"
                variant="secondary"
                leftIcon={<Ionicons name="logo-google" size={18} color={theme.colors.text} />}
                onPress={() => router.push('/login')}
              />
            </View>
          ) : null}
        </View>

        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/login')}
          style={styles.terms}
        >
          <AppText variant="caption" color="textTertiary" align="center">
            Devam ederek Kullanım Koşulları ve Gizlilik Politikası&apos;nı kabul etmiş olursun.
          </AppText>
        </Pressable>

        <View style={{ height: insets.bottom + 8 }} />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  heroContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 28,
    paddingBottom: 96,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  wordmark: { gap: 4 },
  title: { fontSize: 30, letterSpacing: 3.4 },
  orbOne: {
    position: 'absolute',
    top: -90,
    right: -70,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  orbTwo: {
    position: 'absolute',
    bottom: 10,
    left: -110,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(137,93,245,0.28)',
  },
  sheet: {
    flex: 1,
    marginTop: -36,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 10,
  },
  sheetContent: {
    paddingHorizontal: 24,
    gap: 20,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
  },
  sheetHeader: { gap: 6 },
  highlights: { gap: 10 },
  highlightRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  highlightIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightCopy: { flex: 1, gap: 1 },
  actions: { gap: 10, marginTop: 2 },
  social: { gap: 10, marginTop: 2 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  terms: { paddingVertical: 4 },
});
