import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, type Href } from 'expo-router';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import {
  CHILD_RESPONSE_TARGET_MINUTES,
  SUPPORT_EMAIL,
  SUPPORT_RESPONSE_TARGET_HOURS,
} from '@/features/safety/constants';
import { useContactChannels } from '@/features/web-content/hooks/use-web-content';
import type { ContactChannel } from '@/features/web-content/types';
import { useTheme } from '@/theme/ThemeProvider';

import { useWebMeta } from '../use-web-meta';
import { flatStyle } from '../link-style';
import { WebFooter } from './WebFooter';
import { WebHeader } from './WebHeader';

type Channel = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action: string;
  href?: string;
  email?: string;
};

const CHANNELS: Channel[] = [
  {
    icon: 'help-buoy-outline',
    title: 'Destek merkezi',
    body: 'Sık sorulan sorular, sorun kategorileri ve destek talebi oluşturma.',
    action: 'Destek merkezine git',
    href: '/support',
  },
  {
    icon: 'folder-open-outline',
    title: 'Veri talepleri',
    body: 'Kişisel verilerine erişim, düzeltme, silme ve taşınabilirlik talepleri.',
    action: 'Talep oluştur',
    href: '/data-requests',
  },
  {
    icon: 'trash-outline',
    title: 'Hesap silme',
    body: 'Hesabını kalıcı olarak sil veya giriş yapamıyorsan silme talebi oluştur.',
    action: 'Hesap silme merkezi',
    href: '/delete-account',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Çocuk güvenliği',
    body: 'Çocuk güvenliği bildirimleri öncelikli ve gizli olarak incelenir.',
    action: 'Politikayı gör',
    href: '/child-safety',
  },
  {
    icon: 'document-text-outline',
    title: 'Hukuki metinler',
    body: 'Kullanım koşulları, gizlilik, KVKK ve topluluk kuralları.',
    action: 'Kullanım koşulları',
    href: '/terms',
  },
];

const EMAIL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  support: 'help-buoy-outline',
  privacy: 'lock-closed-outline',
  child_safety: 'shield-checkmark-outline',
  legal: 'document-text-outline',
  business: 'storefront-outline',
  other: 'mail-outline',
};

function ChannelCard({ channel }: { channel: Channel }) {
  const { theme } = useTheme();

  const content = (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={[styles.cardIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={channel.icon} size={19} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="h3">{channel.title}</AppText>
      <AppText variant="body" color="textSecondary" style={styles.flex}>
        {channel.body}
      </AppText>
      <View style={styles.cardAction}>
        <AppText variant="bodyStrong" color="primaryDeep">
          {channel.action}
        </AppText>
        <Ionicons name="arrow-forward" size={15} color={theme.colors.primaryDeep} />
      </View>
    </View>
  );

  if (channel.email) {
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${channel.title}: ${channel.email}`}
        onPress={() => {
          const url = `mailto:${channel.email}`;
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.location.assign(url);
            return;
          }
          void Linking.openURL(url).catch(() => undefined);
        }}
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <Link href={(channel.href ?? '/') as Href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${channel.title}: ${channel.action}`}
      >
        {content}
      </Pressable>
    </Link>
  );
}

export function WebContactPage() {
  const { theme } = useTheme();
  const { data: channelData } = useContactChannels();

  // Adresler admin panelindeki doğrulanmış kanal yapılandırmasından gelir.
  // Yapılandırma henüz yüklenmediyse yalnızca herkese açık destek adresi gösterilir.
  const emailChannels: ContactChannel[] =
    channelData && channelData.length > 0
      ? channelData.filter((channel) => Boolean(channel.email))
      : [
          {
            key: 'support',
            label: 'Genel Destek',
            email: SUPPORT_EMAIL,
            description: 'Hesap, uygulama ve genel sorular için destek ekibi.',
            sort_order: 10,
          },
        ];

  useWebMeta({
    title: 'İletişim · Trabzone',
    description:
      'Trabzone destek ekibine e-posta ile ulaşın, destek merkezini kullanın veya veri taleplerinizi iletin.',
    path: '/contact',
  });

  const openEmail = (email: string) => {
    const url = `mailto:${email}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.assign(url);
      return;
    }
    void Linking.openURL(url).catch(() => undefined);
  };

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
            İLETİŞİM
          </AppText>
          <AppText
            variant="display"
            color="#FFFFFF"
            style={styles.heroTitle}
            accessibilityRole="header"
          >
            Bize ulaşın.
          </AppText>
          <AppText variant="body" color="#A9BDE2" style={styles.heroSummary}>
            Sorular, sorunlar, gizlilik ve veri talepleri için doğru kanalı seç. Destek ekibimiz
            {` ${SUPPORT_RESPONSE_TARGET_HOURS} saat içinde`} yanıt vermeyi hedefler.
          </AppText>
          <View style={styles.heroPills}>
            <View style={styles.pill}>
              <Ionicons name="time-outline" size={13} color="#A8BEE8" />
              <AppText variant="caption" color="#C9D7F0">
                Hedef yanıt: {SUPPORT_RESPONSE_TARGET_HOURS} saat
              </AppText>
            </View>
            <View style={styles.pill}>
              <Ionicons name="shield-checkmark-outline" size={13} color="#A8BEE8" />
              <AppText variant="caption" color="#C9D7F0">
                Çocuk güvenliği: {CHILD_RESPONSE_TARGET_MINUTES} dk
              </AppText>
            </View>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.body}>
        <View style={styles.grid}>
          {CHANNELS.map((channel) => (
            <ChannelCard key={channel.title} channel={channel} />
          ))}
        </View>

        <View style={styles.section}>
          <AppText variant="h1">E-posta kanalları</AppText>
          <AppText variant="body" color="textSecondary" style={styles.paragraph}>
            Aşağıdaki adresler admin panelinden doğrulanmış ve etkin kanallardır. Tıklayarak
            e-posta uygulamanızda yeni bir ileti hazırlayabilirsiniz. KVKK ve veri talepleri için
            ayrıca veri talepleri merkezini kullanmanız önerilir.
          </AppText>
          <View style={styles.emailList}>
            {emailChannels.map((channel) => (
              <Pressable
                key={channel.key}
                accessibilityRole="link"
                accessibilityLabel={`${channel.label}: ${channel.email}`}
                onPress={() => openEmail(channel.email ?? '')}
                style={({ pressed }) => [
                  styles.emailRow,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <View style={[styles.cardIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons
                    name={EMAIL_ICONS[channel.key] ?? 'mail-outline'}
                    size={19}
                    color={theme.colors.primaryDeep}
                  />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{channel.label}</AppText>
                  {channel.description ? (
                    <AppText variant="caption" color="textSecondary">
                      {channel.description}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="bodyStrong" color="primaryDeep">
                  {channel.email}
                </AppText>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="h1">İşletme bilgileri</AppText>
          <AppText variant="body" color="textSecondary" style={styles.paragraph}>
            Trabzone, Litxtech tarafından işletilmektedir. Resmî yazışmalar ve destek talepleri
            {' '}
            <AppText variant="bodyStrong" color="primaryDeep">
              {SUPPORT_EMAIL}
            </AppText>{' '}
            adresi üzerinden yürütülür.
          </AppText>
          <AppText variant="body" color="textSecondary" style={styles.paragraph}>
            Acil tehlikeli durumlarda 112 veya yetkili kolluk birimlerine başvurun. Trabzone
            üzerinden yapılan bildirimler acil müdahale hizmeti değildir.
          </AppText>
        </View>

        <View style={styles.cta}>
          <Ionicons name="chatbubbles-outline" size={22} color={theme.colors.primaryDeep} />
          <View style={styles.flex}>
            <AppText variant="h3">Destek talebi oluştur</AppText>
            <AppText variant="body" color="textSecondary">
              Hesabınla giriş yaparak talep açabilir, durumunu ve yanıtları tek yerden takip
              edebilirsin.
            </AppText>
          </View>
          <Link href={'/support' as Href} asChild>
            <Pressable
              style={flatStyle([styles.ctaButton, { backgroundColor: theme.colors.primaryDeep }])}
            >
              <AppText variant="bodyStrong" color="onPrimary">
                Destek merkezi
              </AppText>
              <Ionicons name="arrow-forward" size={15} color={theme.colors.onPrimary} />
            </Pressable>
          </Link>
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
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(150,180,235,0.28)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  body: {
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 36,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
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
  cardAction: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  emailList: { gap: 10, marginTop: 4 },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexWrap: 'wrap',
  },
  section: { gap: 12 },
  paragraph: { fontSize: 15.5, lineHeight: 26, maxWidth: 820 },
  cta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(120,150,220,0.24)',
    borderRadius: 18,
    padding: 20,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
});
