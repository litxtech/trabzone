import { Ionicons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Logo, Wordmark } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Web giriş/kayıt sayfalarının ortak iki sütunlu çerçevesi. Mobilde tek
 * sütuna iner; sol taraftaki tanıtım paneli küçük ekranlarda gizlenir.
 *
 * Form paneli tema renklerini kullanır: sistem koyu temadaysa metin/input
 * renkleri de koyu temadan gelir, böylece açık zemin üzerinde okunamayan
 * beyaz yazı oluşmaz.
 */
export function WebAuthLayout({
  children,
  eyebrow,
  title,
  subtitle,
  footer,
}: PropsWithChildren<{
  eyebrow: string;
  title: string;
  subtitle: string;
  footer?: React.ReactNode;
}>) {
  const { width } = useWindowDimensions();
  const { theme } = useTheme();
  const desktop = width >= 980;

  return (
    <View style={styles.root}>
      {desktop ? (
        <View style={styles.brandPanel}>
          <View style={styles.glowOne} />
          <View style={styles.glowTwo} />
          <View style={styles.brandInner}>
            <Link href={'/' as Href} asChild>
              <View accessibilityRole="link" style={styles.brandRow}>
                <Logo size={44} />
                <View>
                  <Wordmark size={21} color="#FFFFFF" accentColor="#A78BFA" />
                  <AppText variant="caption" color="#8EA6D8">
                    Bir Şehirden Daha Fazlası.
                  </AppText>
                </View>
              </View>
            </Link>

            <View style={styles.brandCopy}>
              <View style={styles.brandPill}>
                <Ionicons name="sparkles-outline" size={13} color="#C4B5FD" />
                <AppText variant="caption" color="#C4B5FD">
                  TRABZON&apos;UN DİJİTAL MERKEZİ
                </AppText>
              </View>
              <AppText variant="h1" color="#FFFFFF" style={styles.brandTitle}>
                Şehir seninle{'\n'}daha canlı.
              </AppText>
              <AppText variant="body" color="#A9BDE2" style={styles.brandText}>
                Paylaş, keşfet, yeni insanlarla tanış. Trabzone hesabın web, iOS ve Android
                arasında ortaktır.
              </AppText>
            </View>

            <View style={styles.brandCards}>
              <View style={styles.brandCard}>
                <Ionicons name="people-outline" size={18} color="#A8BEE8" />
                <View style={styles.flex}>
                  <AppText variant="caption" color="#FFFFFF">
                    Sosyal akış ve Reels
                  </AppText>
                  <AppText variant="caption" color="#8494B4">
                    Şehirle bağlantıda kal
                  </AppText>
                </View>
              </View>
              <View style={styles.brandCard}>
                <Ionicons name="storefront-outline" size={18} color="#A8BEE8" />
                <View style={styles.flex}>
                  <AppText variant="caption" color="#FFFFFF">
                    Marketplace ve Emlak
                  </AppText>
                  <AppText variant="caption" color="#8494B4">
                    Keşfet, ilan ver, iletişime geç
                  </AppText>
                </View>
              </View>
              <View style={styles.brandCard}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#A8BEE8" />
                <View style={styles.flex}>
                  <AppText variant="caption" color="#FFFFFF">
                    Güvenli topluluk
                  </AppText>
                  <AppText variant="caption" color="#8494B4">
                    Moderasyon ve çocuk güvenliği
                  </AppText>
                </View>
              </View>
            </View>

            <View style={styles.brandFooter}>
              <AppText variant="caption" color="#5E739D">
                © {new Date().getFullYear()} Trabzone
              </AppText>
              <View style={styles.legalLinks}>
                <Link href={'/terms' as Href} asChild>
                  <AppText variant="caption" color="#8494B4">
                    Kullanım Koşulları
                  </AppText>
                </Link>
                <Link href={'/privacy' as Href} asChild>
                  <AppText variant="caption" color="#8494B4">
                    Gizlilik
                  </AppText>
                </Link>
                <Link href={'/child-safety' as Href} asChild>
                  <AppText variant="caption" color="#8494B4">
                    Çocuk Güvenliği
                  </AppText>
                </Link>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.formPanel,
          !desktop ? styles.formPanelMobile : null,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <View style={[styles.formInner, desktop ? styles.formInnerDesktop : null]}>
          {!desktop ? (
            <Link href={'/' as Href} asChild>
              <View accessibilityRole="link" style={styles.mobileBrand}>
                <Logo size={38} />
                <Wordmark
                  size={19}
                  color={theme.colors.text}
                  accentColor={theme.colors.accentBright}
                />
              </View>
            </Link>
          ) : null}

          <View style={styles.formHead}>
            <AppText variant="caption" color="primary" style={styles.eyebrow}>
              {eyebrow}
            </AppText>
            <AppText variant="h1">{title}</AppText>
            <AppText variant="body" color="textSecondary">
              {subtitle}
            </AppText>
          </View>

          {children}

          {footer}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', minHeight: '100%' },
  flex: { flex: 1 },
  brandPanel: {
    flex: 1,
    backgroundColor: '#07152E',
    overflow: 'hidden',
    paddingHorizontal: 48,
    paddingVertical: 40,
  },
  glowOne: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: 'rgba(37,99,235,0.20)',
    top: -140,
    right: -120,
  },
  glowTwo: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(124,58,237,0.16)',
    bottom: -120,
    left: -80,
  },
  brandInner: { flex: 1, maxWidth: 560, width: '100%', alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandCopy: { marginTop: 'auto', marginBottom: 28, gap: 12 },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  brandTitle: { lineHeight: 52 },
  brandText: { lineHeight: 24, maxWidth: 460 },
  brandCards: { gap: 8, marginBottom: 28 },
  brandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  brandFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingTop: 16,
  },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  formPanel: { flex: 1, backgroundColor: '#F7F9FD', justifyContent: 'center', padding: 32 },
  formPanelMobile: { padding: 20, paddingTop: 30 },
  formInner: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 20 },
  formInnerDesktop: { paddingVertical: 24 },
  mobileBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  formHead: { gap: 8 },
  eyebrow: { letterSpacing: 1.4 },
});
