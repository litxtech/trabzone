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
import { useTheme } from '@/theme/ThemeProvider';

import { flatStyle } from '../link-style';

const NAV_ITEMS = [
  { label: 'Ana Sayfa', href: '/' },
  { label: 'Keşfet', href: '/#kesfet' },
  { label: 'Reels', href: '/#reels' },
  { label: 'Marketplace', href: '/#marketplace' },
  { label: 'Harita', href: '/#harita' },
  { label: 'Hakkımızda', href: '/about' },
  { label: 'Destek', href: '/support' },
] as const;

/**
 * Web'de tıklanabilir yüzeylerde imleç `pointer` olmalı; aksi halde buton
 * etkileşimli görünmediği için kullanıcı tıklamayı denemiyor.
 */
const WEB_POINTER =
  Platform.OS === 'web' ? ({ cursor: 'pointer' } as unknown as object) : null;

/** Dokunmatik hedefleri en az 44px'e çıkarır; küçük ikonlar için kullanılır. */
const ICON_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** Çok dar ekranlarda ikincil kontrolleri gizlemek için (yalnızca web). */
const MICRO_HIDDEN =
  Platform.OS === 'web' ? ({ display: 'none' } as unknown as object) : ({ width: 0, height: 0, opacity: 0 } as const);

/**
 * expo-router `Link asChild` kullanıldığında stil, bağlantı öğesine `Link`
 * üzerinden geçirilmelidir; çocuk `Pressable`'ın `style` prop'u eziliyor.
 * `flatStyle` dizileri düz nesneye çevirir (bkz. `../link-style`).
 */
const linkStyle = flatStyle;

function isActive(pathname: string, href: string) {
  // Bölüm (hash) bağlantıları aynı sayfada farklı bölümlere gider; hepsini
  // "aktif" göstermek menüyü yanıltıcı kılıyordu.
  if (href.includes('#')) {
    return false;
  }
  const target = href.split('#')[0] || '/';
  if (target === '/') {
    return pathname === '/';
  }
  return pathname === target || pathname.startsWith(`${target}/`);
}

function NavLink({ label, href, onPress }: { label: string; href: string; onPress?: () => void }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link href={href as Href} asChild style={linkStyle(styles.navLink)} onPress={onPress}>
      <Pressable accessibilityRole="link" accessibilityLabel={label} style={styles.navLink}>
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
  // Dar ekranlarda marka ve buton topluluğu başlık içine sığmıyordu; bu yüzden
  // hamburger butonu sağ boşluğun dışına taşıyordu.
  const compactHeader = width < 430;
  const microHeader = width < 360;
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
  // Koyu temada `primaryDeep` açık bir maviye denk geliyor; üzerine beyaz yazı
  // konduğunda kontrast düşüyordu. Bu yüzden CTA zemini şemaya göre seçilir.
  const drawerCtaBg = scheme === 'dark' ? theme.colors.primary : theme.colors.primaryDeep;

  const closeMenu = () => setMenuOpen(false);

  // Menü açılırken dil açılır penceresi açık kalırsa butonların üzerine biner
  // ve tıklamaları yutar; bu yüzden her açılışta kapatılır.
  const openMenu = () => {
    setLangOpen(false);
    setMenuOpen(true);
  };

  const toggleLang = () => setLangOpen((value) => !value);

  return (
    <>
      <View style={styles.headerWrap} pointerEvents="box-none">
        <View style={[styles.header, desktop ? styles.headerDesktop : styles.headerMobile]}>
          <Link href={'/' as Href} asChild style={linkStyle(styles.brand)}>
            <Pressable accessibilityRole="link" accessibilityLabel="Trabzone ana sayfa" style={styles.brand}>
              <Logo size={34} />
              <Wordmark size={compactHeader ? 16 : 19} color="#FFFFFF" accentColor="#A78BFA" />
            </Pressable>
          </Link>

          {desktop ? (
            <View style={styles.nav}>
              {navItems.map((item) => (
                <NavLink key={item.href} label={item.label} href={item.href} />
              ))}
            </View>
          ) : (
            // Mobilde gezinme bağlantıları çekmecede; masaüstündeki `nav`
            // boşluğunun yerini bu esnek boşluk alır ve aksiyonları sağa yaslar.
            <View style={styles.headerSpacer} />
          )}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dil seçimi"
              hitSlop={ICON_HIT_SLOP}
              onPress={toggleLang}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <AppText variant="caption" color="#DCE6FF" style={styles.langText}>
                TR
              </AppText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={scheme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
              hitSlop={ICON_HIT_SLOP}
              onPress={() => setMode(scheme === 'dark' ? 'light' : 'dark')}
              style={({ pressed }) => [
                styles.iconButton,
                microHeader ? styles.hiddenOnMicro : null,
                { opacity: pressed ? 0.6 : 1 },
              ]}
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
                  accessibilityLabel={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
                  accessibilityState={{ expanded: menuOpen }}
                  hitSlop={ICON_HIT_SLOP}
                  onPress={menuOpen ? closeMenu : openMenu}
                  style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name={menuOpen ? 'close' : 'menu'} size={22} color="#FFFFFF" />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {langOpen ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dil menüsünü kapat"
              style={styles.langDismiss}
              onPress={() => setLangOpen(false)}
            />
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
          </>
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
          {/* Zemin rengi temadan gelmeli: sabit beyaz zemin koyu temada
              metinleri (açık renk) okunamaz hale getiriyordu. */}
          <Animated.View
            style={[
              styles.drawer,
              {
                width: drawerWidth,
                backgroundColor: theme.colors.surface,
                shadowColor: theme.colors.shadow,
              },
              drawerStyle,
            ]}
          >
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

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.drawerBody}
            >
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href as Href}
                    asChild
                    onPress={closeMenu}
                    style={linkStyle([
                      styles.drawerRow,
                      { backgroundColor: active ? theme.colors.primarySoft : 'transparent' },
                    ])}
                  >
                    <Pressable
                      accessibilityRole="link"
                      style={flatStyle([
                        styles.drawerRow,
                        { backgroundColor: active ? theme.colors.primarySoft : 'transparent' },
                      ])}
                    >
                      <AppText
                        variant="bodyStrong"
                        color={active && scheme === 'light' ? 'primaryDeep' : 'text'}
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

              <View style={styles.drawerActions}>
                {authenticated ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        closeMenu();
                        router.push('/feed' as Href);
                      }}
                      style={({ pressed }) => [
                        styles.drawerCta,
                        { backgroundColor: drawerCtaBg, opacity: pressed ? 0.85 : 1 },
                      ]}
                    >
                      <AppText variant="bodyStrong" color="onPrimary">
                        Uygulamaya Git
                      </AppText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        closeMenu();
                        router.push('/settings' as Href);
                      }}
                      style={({ pressed }) => [
                        styles.drawerSecondary,
                        { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <AppText variant="body" color="text">
                        Hesap Ayarları
                      </AppText>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        closeMenu();
                        router.push('/register' as Href);
                      }}
                      style={({ pressed }) => [
                        styles.drawerCta,
                        { backgroundColor: drawerCtaBg, opacity: pressed ? 0.85 : 1 },
                      ]}
                    >
                      <AppText variant="bodyStrong" color="onPrimary">
                        Hemen Katıl
                      </AppText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        closeMenu();
                        router.push('/login' as Href);
                      }}
                      style={({ pressed }) => [
                        styles.drawerSecondary,
                        { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <AppText variant="body" color="text">
                        Giriş Yap
                      </AppText>
                    </Pressable>
                  </>
                )}
              </View>

              <View style={[styles.drawerDivider, { backgroundColor: theme.colors.divider }]} />

              <View style={styles.drawerLegal}>
                {[
                  { label: 'Kullanım Koşulları', href: '/terms' },
                  { label: 'Gizlilik', href: '/privacy' },
                  { label: 'KVKK', href: '/kvkk' },
                  { label: 'Çocuk Güvenliği', href: '/child-safety' },
                  { label: 'Hesap Silme', href: '/delete-account' },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href as Href}
                    asChild
                    onPress={closeMenu}
                    style={linkStyle(styles.drawerLegalLink)}
                  >
                    <Pressable accessibilityRole="link" style={styles.drawerLegalLink}>
                      <AppText variant="caption" color="textSecondary">
                        {link.label}
                      </AppText>
                    </Pressable>
                  </Link>
                ))}
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
  headerDesktop: { paddingHorizontal: 28, minHeight: 72, gap: 18 },
  headerMobile: { paddingHorizontal: 16, minHeight: 62, gap: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1, ...(WEB_POINTER ?? {}) },
  nav: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 15 },
  navLink: { paddingVertical: 10, paddingHorizontal: 4, ...(WEB_POINTER ?? {}) },
  navLabel: { fontSize: 12.5, letterSpacing: 0.1 },
  navLabelActive: { fontFamily: undefined },
  headerSpacer: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  hiddenOnMicro: MICRO_HIDDEN,
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(160, 185, 240, 0.2)',
    ...(WEB_POINTER ?? {}),
  },
  langText: { fontSize: 11, letterSpacing: 0.6 },
  ghostButton: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12,
    ...(WEB_POINTER ?? {}),
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 38,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 15,
    ...(WEB_POINTER ?? {}),
  },
  loginLabel: { fontSize: 12.5 },
  loginCompact: {
    minHeight: 36,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    ...(WEB_POINTER ?? {}),
  },
  menuButton: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(160, 185, 240, 0.24)',
    ...(WEB_POINTER ?? {}),
  },
  langDismiss: {
    ...(Platform.OS === 'web'
      ? ({ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0 } as unknown as object)
      : { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }),
    zIndex: 55,
  },
  langPopover: {
    position: 'absolute',
    right: 18,
    top: 66,
    minWidth: 170,
    padding: 12,
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#0D1526',
    borderWidth: 1,
    borderColor: 'rgba(140, 170, 235, 0.24)',
    zIndex: 56,
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
    borderTopLeftRadius: 22,
    borderBottomLeftRadius: 22,
    paddingTop: 18,
    paddingBottom: 12,
    paddingHorizontal: 18,
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
  drawerClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    ...(WEB_POINTER ?? {}),
  },
  drawerBody: { gap: 4, paddingBottom: 28 },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    ...(WEB_POINTER ?? {}),
  },
  drawerDivider: { height: 1, marginVertical: 14 },
  drawerActions: { gap: 10 },
  drawerCta: {
    borderRadius: 14,
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    // Çerçevesiz buton, çerçeveli ikincil butonla aynı toplam yüksekliğe
    // ulaşsın diye saydam çerçeve kullanılır.
    borderWidth: 1,
    borderColor: 'transparent',
    ...(WEB_POINTER ?? {}),
  },
  drawerSecondary: {
    borderRadius: 14,
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    ...(WEB_POINTER ?? {}),
  },
  drawerLegal: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  drawerLegalLink: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    ...(WEB_POINTER ?? {}),
  },
});
