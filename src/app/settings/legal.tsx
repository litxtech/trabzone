import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, IconButton, Screen } from '@/components/ui';
import { PUBLIC_LEGAL_PAGES, type LegalCatalogItem } from '@/features/legal/catalog';
import { useRouter, type Href } from '@/utils/router';
import { useTheme } from '@/theme/ThemeProvider';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  terms: 'reader-outline',
  privacy: 'lock-closed-outline',
  kvkk: 'shield-checkmark-outline',
  'data-protection': 'server-outline',
  cookies: 'ellipse-outline',
  'child-safety': 'shield-half-outline',
  'community-guidelines': 'people-outline',
  'account-deletion': 'trash-outline',
  'marketplace-rules': 'storefront-outline',
  'real-estate-rules': 'home-outline',
  'vehicle-rules': 'car-outline',
};

type Destination = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  href: Href;
};

const DESTINATIONS: Destination[] = [
  {
    icon: 'help-buoy-outline',
    label: 'Destek merkezi',
    description: 'Canlı destek, yardım makaleleri ve talep oluşturma.',
    href: '/support',
  },
  {
    icon: 'clipboard-outline',
    label: 'Başvurularım',
    description: 'Destek taleplerinizin ve başvurularınızın durumu.',
    href: '/support/my-requests',
  },
  {
    icon: 'mail-unread-outline',
    label: 'Veri talepleri',
    description: 'KVKK kapsamında erişim, düzeltme, silme ve itiraz başvurusu.',
    href: '/data-requests',
  },
  {
    icon: 'trash-outline',
    label: 'Hesabımı sil',
    description: 'Hesabınızı ve saklanması zorunlu olmayan verilerinizi kalıcı olarak silin.',
    href: '/delete-account',
  },
  {
    icon: 'at-outline',
    label: 'İletişim',
    description: 'Resmî iletişim kanalları ve hukuki bildirim adresleri.',
    href: '/contact',
  },
];

export default function LegalSettingsScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const openPolicy = (item: LegalCatalogItem) => {
    router.push({ pathname: '/policy/[slug]', params: { slug: item.slug } });
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
        <AppText variant="h3">Hakkında ve Hukuki Belgeler</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <AppText variant="body" color="textSecondary" style={styles.intro}>
        Trabzone’u kullanırken geçerli olan sözleşmeler, veri işleme aydınlatmaları ve topluluk
        kuralları. Metinler sunucuda sürümlenir; uygulama her zaman yayındaki güncel sürümü
        gösterir.
      </AppText>

      {(['Sözleşmeler', 'Veri ve Gizlilik', 'Güvenlik', 'Platform Kuralları'] as const).map(
        (category) => {
          const items = PUBLIC_LEGAL_PAGES.filter((item) => item.category === category);
          if (items.length === 0) {
            return null;
          }
          return (
            <View key={category} style={styles.section}>
              <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
                {category.toLocaleUpperCase('tr-TR')}
              </AppText>
              <Card padding={0}>
                {items.map((item, index) => (
                  <View key={item.slug}>
                    {index > 0 ? <Divider /> : null}
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={item.title}
                      onPress={() => openPolicy(item)}
                      style={({ pressed }) => [
                        styles.row,
                        { opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <View style={[styles.iconWrap, { backgroundColor: theme.colors.primarySoft }]}>
                        <Ionicons
                          name={ICONS[item.slug] ?? 'document-text-outline'}
                          size={18}
                          color={theme.colors.primary}
                        />
                      </View>
                      <View style={styles.rowText}>
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {item.title}
                        </AppText>
                        <AppText variant="caption" color="textSecondary">
                          {item.description}
                        </AppText>
                      </View>
                      <Ionicons name="chevron-forward" size={17} color={theme.colors.textTertiary} />
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          );
        },
      )}

      <View style={styles.section}>
        <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
          HESAP VE DESTEK
        </AppText>
        <Card padding={0}>
          {DESTINATIONS.map((item, index) => (
            <View key={`${item.label}-${index}`}>
              {index > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={item.label}
                onPress={() => router.push(item.href)}
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name={item.icon} size={18} color={theme.colors.primary} />
                </View>
                <View style={styles.rowText}>
                  <AppText variant="bodyStrong">{item.label}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {item.description}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={17} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          ))}
        </Card>
      </View>

      <AppText variant="caption" color="textTertiary" style={styles.footer}>
        Yayınlanan her sürüm değiştirilemez biçimde arşivlenir. Bir belgenin güncel sürümünü
        uygulama içinden her zaman görüntüleyebilirsiniz.
      </AppText>
    </Screen>
  );
}

function Divider() {
  const { theme } = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
  },
  headerSpacer: { width: 40 },
  intro: { marginTop: 8, marginBottom: 18, lineHeight: 21 },
  section: { marginBottom: 20 },
  sectionTitle: { marginBottom: 8, letterSpacing: 0.8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  footer: { marginTop: 4, marginBottom: 24, lineHeight: 18 },
});
