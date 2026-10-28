import { Ionicons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText, Logo, Wordmark } from '@/components/ui';

import { openCookieSettings } from '../cookie-consent';
import { useWebsiteContent } from '@/features/web-content/hooks/use-web-content';

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Trabzone',
    links: [
      { label: 'Hakkımızda', href: '/about' },
      { label: 'Uygulamayı Keşfet', href: '/#kesfet' },
      { label: 'Marketplace', href: '/marketplace' },
      { label: 'Emlak', href: '/marketplace/real-estate' },
      { label: 'İşletmeler', href: '/marketplace/places' },
      { label: 'Harita', href: '/map' },
    ],
  },
  {
    title: 'Destek',
    links: [
      { label: 'Yardım Merkezi', href: '/support' },
      { label: 'Canlı Destek', href: '/support/live' },
      { label: 'İletişim', href: '/contact' },
      { label: 'Destek Talepleri', href: '/support/my-requests' },
      { label: 'Hesap Silme', href: '/delete-account' },
    ],
  },
  {
    title: 'Hukuki',
    links: [
      { label: 'Kullanım Koşulları', href: '/terms' },
      { label: 'Gizlilik Politikası', href: '/privacy' },
      { label: 'Çocuk Koruma Politikası', href: '/child-safety' },
      { label: 'Veri Koruma Politikası', href: '/data-protection' },
      { label: 'KVKK Aydınlatma', href: '/kvkk' },
      { label: 'Topluluk Kuralları', href: '/community-guidelines' },
      { label: 'Çerez Politikası', href: '/cookies' },
    ],
  },
];

function FooterLink({ label, href }: { label: string; href: string }) {
  return (
    <Link href={href as Href} asChild>
      <Pressable
        accessibilityRole="link"
        style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
      >
        <AppText variant="caption" color="#93A4C7">
          {label}
        </AppText>
      </Pressable>
    </Link>
  );
}

export function WebFooter() {
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { data } = useWebsiteContent();
  const apps = data?.settings?.apps ?? {};
  const ios = typeof apps.ios_url === 'string' && apps.ios_url.length > 0 ? apps.ios_url : null;
  const android =
    typeof apps.android_url === 'string' && apps.android_url.length > 0 ? apps.android_url : null;
  const year = new Date().getFullYear();
  const operator =
    typeof data?.settings?.legal?.operator_name === 'string'
      ? data.settings.legal.operator_name
      : 'Trabzone';

  return (
    <View style={styles.root}>
      <View style={[styles.inner, desktop ? styles.innerDesktop : styles.innerMobile]}>
        <View style={[styles.brandColumn, desktop ? styles.brandDesktop : null]}>
          <View style={styles.brandRow}>
            <Logo size={40} />
            <View style={styles.flex}>
              <Wordmark size={19} color="#FFFFFF" accentColor="#A78BFA" />
              <AppText variant="caption" color="#8494B4">
                Bir Şehirden Daha Fazlası.
              </AppText>
            </View>
          </View>
          <AppText variant="caption" color="#8494B4" style={styles.brandCopy}>
            Trabzon&apos;un dijital buluşma noktası. Paylaş, keşfet ve şehirle bağlantıda kal.
          </AppText>

          <View style={styles.storeRow}>
            {ios ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  if (Platform.OS === 'web') {
                    window.open(ios, '_blank', 'noopener,noreferrer');
                  }
                }}
                style={styles.storeButton}
              >
                <Ionicons name="logo-apple" size={18} color="#FFFFFF" />
                <View>
                  <AppText variant="caption" color="#8494B4" style={styles.storeHint}>
                    App Store
                  </AppText>
                  <AppText variant="caption" color="#FFFFFF">
                    İndir
                  </AppText>
                </View>
              </Pressable>
            ) : (
              <View style={[styles.storeButton, styles.storeDisabled]}>
                <Ionicons name="logo-apple" size={18} color="#7C8AA6" />
                <View>
                  <AppText variant="caption" color="#7C8AA6" style={styles.storeHint}>
                    App Store
                  </AppText>
                  <AppText variant="caption" color="#7C8AA6">
                    Yakında
                  </AppText>
                </View>
              </View>
            )}

            {android ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  if (Platform.OS === 'web') {
                    window.open(android, '_blank', 'noopener,noreferrer');
                  }
                }}
                style={styles.storeButton}
              >
                <Ionicons name="logo-google-playstore" size={18} color="#FFFFFF" />
                <View>
                  <AppText variant="caption" color="#8494B4" style={styles.storeHint}>
                    Google Play
                  </AppText>
                  <AppText variant="caption" color="#FFFFFF">
                    İndir
                  </AppText>
                </View>
              </Pressable>
            ) : (
              <View style={[styles.storeButton, styles.storeDisabled]}>
                <Ionicons name="logo-google-playstore" size={18} color="#7C8AA6" />
                <View>
                  <AppText variant="caption" color="#7C8AA6" style={styles.storeHint}>
                    Google Play
                  </AppText>
                  <AppText variant="caption" color="#7C8AA6">
                    Yakında
                  </AppText>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={[styles.columns, desktop ? styles.columnsDesktop : styles.columnsMobile]}>
          {COLUMNS.map((column) => (
            <View key={column.title} style={styles.column}>
              <AppText variant="bodyStrong" color="#FFFFFF">
                {column.title}
              </AppText>
              <View style={styles.linkList}>
                {column.links.map((link) => (
                  <FooterLink key={`${column.title}-${link.href}`} label={link.label} href={link.href} />
                ))}
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.bottomInner}>
          <AppText variant="caption" color="#7686A6">
            © {year} {operator}. Tüm hakları saklıdır.
          </AppText>
          <View style={styles.bottomActions}>
            <Pressable accessibilityRole="button" onPress={openCookieSettings}>
              <AppText variant="caption" color="#93A4C7">
                Çerez Ayarları
              </AppText>
            </Pressable>
            <FooterLink label="Gizlilik" href="/privacy" />
            <FooterLink label="KVKK" href="/kvkk" />
          </View>
        </View>
        <AppText variant="caption" color="#5F6E8C" style={styles.disclaimer}>
          Trabzone bir sosyal keşif ve ilan platformudur. Marketplace üzerinden yapılan işlemlerde
          ödeme altyapısı etkin değildir; taraflar işlem öncesi gerekli kontrolleri yapmalıdır.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    backgroundColor: '#060B15',
    borderTopWidth: 1,
    borderTopColor: 'rgba(120, 150, 220, 0.16)',
  },
  inner: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    gap: 30,
  },
  innerDesktop: { flexDirection: 'row', paddingHorizontal: 28, paddingVertical: 42 },
  innerMobile: { paddingHorizontal: 20, paddingVertical: 32 },
  brandColumn: { gap: 13 },
  brandDesktop: { width: 330 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandCopy: { maxWidth: 320, lineHeight: 18 },
  storeRow: { flexDirection: 'row', gap: 9, flexWrap: 'wrap' },
  storeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(140, 170, 235, 0.24)',
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  storeDisabled: { opacity: 0.62 },
  storeHint: { fontSize: 9, letterSpacing: 0.3 },
  columns: { flex: 1, gap: 22 },
  columnsDesktop: { flexDirection: 'row', justifyContent: 'space-between' },
  columnsMobile: { flexDirection: 'row', flexWrap: 'wrap' },
  column: { minWidth: 140, gap: 11 },
  linkList: { gap: 7 },
  link: { paddingVertical: 2 },
  bottom: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(120, 150, 220, 0.12)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 7,
  },
  bottomInner: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  bottomActions: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  disclaimer: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
    lineHeight: 17,
  },
});
