import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { AppText, Logo, Wordmark } from '@/components/ui';
import { useReduceMotion } from '@/perf/use-reduce-motion';
import { useAuthStatus } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTheme } from '@/theme/ThemeProvider';

const NAV_ITEMS = [
  { label: 'Ana Sayfa', href: '/' },
  { label: 'Keşfet', href: '/explore' },
  { label: 'Reels', href: '/reels' },
  { label: 'Marketplace', href: '/marketplace' },
  { label: 'Emlak', href: '/real-estate' },
  { label: 'İşletmeler', href: '/businesses' },
  { label: 'Harita', href: '/map' },
  { label: 'Hakkımızda', href: '/about' },
  { label: 'Destek', href: '/support' },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') {
    return pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ label, href, onPress }: { label: string; href: string; onPress?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link href={href as Href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [styles.navLink, { opacity: pressed ? 0.65 : 1 }]}
      >
        <AppText
          variant="caption"
          color={active ? '#FFFFFF' : 'rgba(226,234,255,0.72)'}
          style={[styles.navLabel, active ? styles.navLabelActive : null]}
        >
          {label}
        </AppText>
      </Pressable>
    </Link>
  );
}

export function WebHeader() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();
  const authStatus = useAuthStatus();
  const { theme, scheme, setMode } = useTheme();
  const reduceMotion = useReduceMotion();

  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const desktop = width >= 1080;
  const drawerWidth = Math.min(360, width * 0.86);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    progress.value = reduceMotion ? 1 : 0;
    if (!reduceMotion) {
      progress.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    }
  }, [menuOpen, progress, reduceMotion]);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * drawerWidth }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.55 }));

  const authenticated = authStatus === 'authenticated';
  const navItems = useMemo(() => NAV_ITEMS, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <View style={styles.headerWrap} pointerEvents="box-none">
        <View style={[styles.header, desktop ? styles.headerDesktop : styles.headerMobile]}>
          <Link href={'/' as Href} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel="Trabzone ana sayfa" style={styles.brand}>
              <Logo size={34} />
              <Wordmark size={19} color="#FFFFFF" accentColor="#A78BFA" />
            </Pressable>
          </Link>

          {desktop ? (
            <View style={styles.nav}>
              {navItems.map((item) => (
                <NavLink key={item.href} label={item.label} href={item.href} />
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dil seçimi"
              onPress={() => setLangOpen((value) => !value)}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <AppText variant="caption" color="#DCE6FF" style={styles.langText}>
                TR
              </AppText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={scheme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
              onPress={() => setMode(scheme === 'dark' ? 'light' : 'dark')}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons
                name={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'}
                size={18}
                color="#DCE6FF"
              />
            </Pressable>

            {desktop ? (
              authenticated ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/feed' as Href)}
                    style={({ pressed }) => [styles.ghostButton, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <AppText variant="caption" color="#FFFFFF">
                      Uygulamaya Git
                    </AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/settings' as Href)}
                    style={({ pressed }) => [styles.loginButton, { opacity: pressed ? 0.8 : 1 }]}
                  >
                    <Ionicons name="person-circle-outline" size={17} color="#08111F" />
                    <AppText variant="caption" color="#08111F" style={styles.loginLabel}>
                      Hesabım
                    </AppText>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/login' as Href)}
                    style={({ pressed }) => [styles.ghostButton, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <AppText variant="caption" color="#FFFFFF">
                      Giriş Yap
                    </AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/register' as Href)}
                    style={({ pressed }) => [styles.loginButton, { opacity: pressed ? 0.8 : 1 }]}
                  >
                    <Ionicons name="sparkles-outline" size={16} color="#08111F" />
                    <AppText variant="caption" color="#08111F" style={styles.loginLabel}>
                      Kayıt Ol
                    </AppText>
                  </Pressable>
                </>
              )
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(authenticated ? ('/feed' as Href) : ('/login' as Href))}
                  style={({ pressed }) => [styles.loginCompact, { opacity: pressed ? 0.8 : 1 }]}
                >
                  <AppText variant="caption" color="#08111F">
                    {authenticated ? 'Uygulama' : 'Giriş'}
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Menüyü aç"
                  onPress={() => setMenuOpen(true)}
                  style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="menu" size={22} color="#FFFFFF" />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {langOpen ? (
          <View style={styles.langPopover}>
            <View style={styles.langRow}>
              <AppText variant="caption" color="#FFFFFF">
                Türkçe
              </AppText>
              <Ionicons name="checkmark" size={15} color="#7DD3A8" />
            </View>
            <View style={[styles.langRow, { opacity: 0.5 }]}>
              <AppText variant="caption" color="#DCE6FF">
                English
              </AppText>
              <AppText variant="caption" color="#9DB6FF" style={styles.soon}>
                yakında
              </AppText>
            </View>
          </View>
        ) : null}
      </View>

      <Modal visible={menuOpen} transparent animationType="none" onRequestClose={closeMenu}>
        <View style={styles.modalRoot}>
          <Animated.View style={[styles.backdrop, backdropStyle]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Menüyü kapat"
              style={StyleSheet.absoluteFill}
              onPress={closeMenu}
            />
          </Animated.View>
          <Animated.View style={[styles.drawer, { width: drawerWidth }, drawerStyle]}>
            <View style={styles.drawerHead}>
              <View style={styles.brand}>
                <Logo size={30} />
                <Wordmark size={17} color={theme.colors.text} accentColor={theme.colors.accentBright} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Menüyü kapat"
                onPress={closeMenu}
                style={styles.drawerClose}
              >
                <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.drawerBody}>
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link key={item.href} href={item.href as Href} asChild>
                    <Pressable
                      accessibilityRole="link"
                      onPress={closeMenu}
                      style={({ pressed }) => [
                        styles.drawerRow,
                        {
                          backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                          opacity: pressed ? 0.65 : 1,
                        },
                      ]}
                    >
                      <AppText
                        variant="bodyStrong"
                        color={active ? 'primaryDeep' : 'text'}
                        style={styles.flex}
                      >
                        {item.label}
                      </AppText>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={theme.colors.textTertiary}
                      />
                    </Pressable>
                  </Link>
                );
              })}

              <View style={[styles.drawerDivider, { backgroundColor: theme.colors.divider }]} />

              {authenticated ? (
                <>
                  <Pressable
                    onPress={() => {
                      closeMenu();
                      router.push('/feed' as Href);
                    }}
                    style={[styles.drawerCta, { backgroundColor: theme.colors.primaryDeep }]}
                  >
                    <AppText variant="bodyStrong" color="onPrimary">
                      Uygulamaya Git
                    </AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      closeMenu();
                      router.push('/settings' as Href);
                    }}
                    style={[styles.drawerRow, { borderColor: theme.colors.border, borderWidth: 1 }]}
                  >
                    <AppText variant="body" color="text">
                      Hesap Ayarları
                    </AppText>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    onPress={() => {
                      closeMenu();
                      router.push('/register' as Href);
                    }}
                    style={[styles.drawerCta, { backgroundColor: theme.colors.primaryDeep }]}
                  >
                    <AppText variant="bodyStrong" color="onPrimary">
                      Hemen Katıl
                    </AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      closeMenu();
                      router.push('/login' as Href);
                    }}
                    style={[styles.drawerRow, { borderColor: theme.colors.border, borderWidth: 1 }]}
                  >
                    <AppText variant="body" color="text">
                      Giriş Yap
                    </AppText>
                  </Pressable>
                </>
              )}

              <View style={styles.drawerLegal}>
                <Link href={'/terms' as Href} asChild>
                  <Pressable onPress={closeMenu}>
                    <AppText variant="caption" color="textTertiary">
                      Kullanım Koşulları
                    </AppText>
                  </Pressable>
                </Link>
                <Link href={'/privacy' as Href} asChild>
                  <Pressable onPress={closeMenu}>
                    <AppText variant="caption" color="textTertiary">
                      Gizlilik
                    </AppText>
                  </Pressable>
                </Link>
                <Link href={'/child-safety' as Href} asChild>
                  <Pressable onPress={closeMenu}>
                    <AppText variant="caption" color="textTertiary">
                      Çocuk Güvenliği
                    </AppText>
                  </Pressable>
                </Link>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerWrap: {
    ...(Platform.OS === 'web'
      ? ({
          position: 'sticky',
          top: 0,
          zIndex: 50,
        } as unknown as object)
      : {}),
    backgroundColor: 'rgba(5, 8, 15, 0.9)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(120, 150, 220, 0.16)',
  },
  header: {
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  headerDesktop: { paddingHorizontal: 28, minHeight: 72 },
  headerMobile: { paddingHorizontal: 18, minHeight: 62 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  nav: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 },
  navLink: { paddingVertical: 8 },
  navLabel: { fontSize: 12.5, letterSpacing: 0.1 },
  navLabelActive: { fontFamily: undefined },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(160, 185, 240, 0.2)',
  },
  langText: { fontSize: 11, letterSpacing: 0.6 },
  ghostButton: { paddingHorizontal: 10, paddingVertical: 9 },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  loginLabel: { fontSize: 12.5 },
  loginCompact: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  menuButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(160, 185, 240, 0.24)',
  },
  langPopover: {
    position: 'absolute',
    right: 96,
    top: 60,
    minWidth: 160,
    padding: 10,
    gap: 8,
    borderRadius: 14,
    backgroundColor: '#0D1526',
    borderWidth: 1,
    borderColor: 'rgba(140, 170, 235, 0.24)',
  },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  soon: { fontSize: 10 },
  modalRoot: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#000000',
  },
  drawer: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderBottomLeftRadius: 22,
    paddingTop: 18,
    paddingHorizontal: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: -8, height: 0 },
    ...(Platform.OS === 'web' ? ({ boxShadow: '-8px 0 32px rgba(0,0,0,0.28)' } as unknown as object) : {}),
  },
  drawerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  drawerClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  drawerBody: { gap: 6, paddingBottom: 30 },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  drawerDivider: { height: 1, marginVertical: 10 },
  drawerCta: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  drawerLegal: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 18 },
});
