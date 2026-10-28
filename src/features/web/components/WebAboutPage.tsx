import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useWebMeta } from '../use-web-meta';
import { WebFooter } from './WebFooter';
import { WebHeader } from './WebHeader';

const PILLARS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'people-outline',
    title: 'Sosyal topluluk',
    body: 'Gönderi, hikâye ve Reels paylaş; yorum yap, beğen ve yeni insanlarla tanış.',
  },
  {
    icon: 'bag-handle-outline',
    title: 'Marketplace',
    body: 'İkinci el ürün, emlak, araç ve yerel hizmet ilanlarını tek yerde keşfet.',
  },
  {
    icon: 'map-outline',
    title: 'Şehir haritası',
    body: 'Restoran, kafe, otel ve gezilecek yerleri haritada gör; yakınındaki fırsatları bul.',
  },
  {
    icon: 'chatbubbles-outline',
    title: 'Mesajlaşma ve arama',
    body: 'Birebir sohbet et, medya paylaş; sesli ve görüntülü arama başlat.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Güvenlik',
    body: 'Şikâyet, engelleme, moderasyon ve çocuk güvenliği araçları her zaman erişilebilir.',
  },
  {
    icon: 'phone-portrait-outline',
    title: 'Her cihazda',
    body: 'Web, iOS ve Android uygulamalarında aynı hesap ve aynı topluluk.',
  },
];

const VALUES = [
  'Yerel topluluğu güçlendirmek ve Trabzon’daki fırsatları görünür kılmak.',
  'Kullanıcı verisini en az toplayarak şeffaf ve güvenli bir deneyim sunmak.',
  'İçerik moderasyonunda hızlı, tutarlı ve hesap verebilir olmak.',
  'Platformu herkesin erişebileceği biçimde sade ve hızlı tutmak.',
];

function ValueRow({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.valueRow}>
      <View style={[styles.valueIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name="checkmark" size={13} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="body" color="textSecondary" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

export function WebAboutPage() {
  const { theme } = useTheme();

  useWebMeta({
    title: 'Hakkımızda · Trabzone',
    description:
      "Trabzone'un amacı, Trabzon ve çevresindeki insanları, işletmeleri ve fırsatları tek bir dijital platformda buluşturmak.",
    path: '/about',
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <WebHeader />

      <LinearGradient
        colors={['#04070E', '#081228', '#0C1730']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroInner}>
          <AppText variant="overline" color="#9DB6FF" style={styles.eyebrow}>
            HAKKIMIZDA
          </AppText>
          <AppText
            variant="display"
            color="#FFFFFF"
            style={styles.heroTitle}
            accessibilityRole="header"
          >
            Bir şehirden daha fazlası.
          </AppText>
          <AppText variant="body" color="#A9BDE2" style={styles.heroSummary}>
            Trabzone; Trabzon’un sosyal hayatını, yerel ticaretini ve şehir keşfini tek bir
            platformda birleştirir. Paylaşmak, keşfetmek ve bağlantı kurmak için tasarlandı.
          </AppText>
          <View style={styles.heroActions}>
            <Link href={'/register' as Href} asChild>
              <Pressable style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.82 : 1 }]}>
                <Ionicons name="sparkles-outline" size={16} color="#08111F" />
                <AppText variant="bodyStrong" color="#08111F">
                  Hesap oluştur
                </AppText>
              </Pressable>
            </Link>
            <Link href={'/contact' as Href} asChild>
              <Pressable style={({ pressed }) => [styles.ghostButton, { opacity: pressed ? 0.82 : 1 }]}>
                <Ionicons name="mail-outline" size={16} color="#FFFFFF" />
                <AppText variant="bodyStrong" color="#FFFFFF">
                  İletişime geç
                </AppText>
              </Pressable>
            </Link>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.body}>
        <View style={styles.section}>
          <AppText variant="h1">Trabzone nedir?</AppText>
          <AppText variant="body" color="textSecondary" style={styles.paragraph}>
            Trabzone, Trabzon merkezli bir sosyal keşif ve ilan platformudur. Kullanıcılar aynı
            hesapla sosyal akışta içerik paylaşabilir, Reels izleyebilir, marketplace ve emlak
            ilanlarını inceleyebilir, haritada yerleri keşfedebilir ve birbirleriyle mesajlaşabilir.
          </AppText>
          <AppText variant="body" color="textSecondary" style={styles.paragraph}>
            Platformun amacı, şehirdeki insanları, işletmeleri ve fırsatları tek bir dijital
            merkezde buluşturmaktır. Web, iOS ve Android uygulamaları aynı hesabı ve aynı
            topluluğu paylaşır.
          </AppText>
        </View>

        <View style={styles.section}>
          <AppText variant="h1">Neler yapabilirsin?</AppText>
          <View style={styles.grid}>
            {PILLARS.map((item) => (
              <View
                key={item.title}
                style={[
                  styles.card,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <View style={[styles.cardIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name={item.icon} size={19} color={theme.colors.primaryDeep} />
                </View>
                <AppText variant="h3">{item.title}</AppText>
                <AppText variant="body" color="textSecondary">
                  {item.body}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="h1">Değerlerimiz</AppText>
          <View style={styles.values}>
            {VALUES.map((value) => (
              <ValueRow key={value} text={value} />
            ))}
          </View>
        </View>

        <View style={styles.noteCard}>
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Trabzone bir sosyal keşif ve ilan platformudur. Marketplace üzerinden yapılan
            işlemlerde platform içi ödeme altyapısı etkin değildir; taraflar işlem öncesi gerekli
            kontrolleri yapmalıdır.
          </AppText>
        </View>
      </View>

      <WebFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  hero: { paddingVertical: 64 },
  heroInner: {
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  eyebrow: { letterSpacing: 1.3 },
  heroTitle: { fontSize: 42, lineHeight: 50, letterSpacing: -0.9 },
  heroSummary: { maxWidth: 680, fontSize: 16, lineHeight: 26 },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(170,195,245,0.3)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  body: {
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 40,
  },
  section: { gap: 14 },
  paragraph: { fontSize: 15.5, lineHeight: 26, maxWidth: 820 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    flexGrow: 1,
    flexBasis: 300,
    maxWidth: 520,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  values: { gap: 10, maxWidth: 820 },
  valueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  valueIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 1,
    borderColor: 'rgba(120,150,220,0.24)',
    borderRadius: 14,
    padding: 16,
  },
});
