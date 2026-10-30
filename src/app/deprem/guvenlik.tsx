import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { EqPage } from '@/features/earthquake/components/EqPage';
import { InfoNote } from '@/features/earthquake/components/parts';
import { openUrl } from '@/features/in-app-browser';
import { useWebMeta } from '@/features/web/use-web-meta';
import { useTheme } from '@/theme/ThemeProvider';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * İçerik uygulamaya gömülüdür (ağ gerektirmez); bağlantı yokken de okunur.
 * Metinler AFAD'ın kamuya açık deprem bilinçlendirme önerilerine dayanır.
 */
const SECTIONS: { title: string; icon: IconName; items: string[] }[] = [
  {
    title: 'Deprem sırasında',
    icon: 'alert-circle-outline',
    items: [
      'Çök – Kapan – Tutun: Sağlam bir masa veya mobilyanın yanına çökün, başınızı ve boynunuzu kollarınızla koruyun, sarsıntı bitene kadar tutunun.',
      'Pencere, cam, dolap ve devrilebilecek eşyalardan uzak durun.',
      'Asansörü kullanmayın; merdivenlere veya balkona koşmayın.',
      'Dışarıdaysanız binalardan, direklerden, ağaçlardan ve elektrik hatlarından uzak, açık bir alana geçin.',
      'Araçtaysanız güvenli bir yerde durun; köprü, tünel ve üst geçitlerden uzak kalın, sarsıntı geçene kadar araçta bekleyin.',
      'Kıyıdaysanız ve güçlü bir sarsıntı hissettiyseniz kıyıdan uzaklaşıp yüksek bir yere çıkın; resmî duyuruları takip edin.',
    ],
  },
  {
    title: 'Deprem sonrasında',
    icon: 'medkit-outline',
    items: [
      'Önce kendinizi, sonra çevrenizdekileri yaralanmaya karşı kontrol edin.',
      'Gaz, elektrik ve su vanalarını kapatın; kibrit veya çakmak yakmayın.',
      'Hasarlı binalara girmeyin; artçı sarsıntılara hazırlıklı olun.',
      'Telefonu yalnızca acil durumlar için kullanın; mümkünse kısa mesaj tercih edin.',
      'Bilgiyi resmî kaynaklardan (AFAD, valilik, belediye) alın; doğrulanmamış haberleri yaymayın.',
      'Gerekirse bölgenizdeki acil durum toplanma alanına gidin.',
    ],
  },
  {
    title: 'Enkaz altında kalırsanız',
    icon: 'hand-left-outline',
    items: [
      'Sakin olmaya çalışın; tozu kaldırmamak için gereksiz hareket etmeyin.',
      'Ağzınızı ve burnunuzu bir bezle kapatın.',
      'Yerinizi bildirmek için borulara veya duvara vurun, düdük kullanın; bağırmayı son çare olarak saklayın.',
    ],
  },
  {
    title: 'Önceden hazırlık',
    icon: 'briefcase-outline',
    items: [
      'Afet ve acil durum çantası hazırlayın: su, dayanıklı gıda, ilk yardım malzemesi, el feneri, yedek pil, düdük, düzenli kullanılan ilaçlar ve önemli belgelerin kopyaları.',
      'Dolap, kitaplık ve ağır eşyaları duvara sabitleyin.',
      'Aile afet planı yapın: buluşma noktası ve şehir dışından bir iletişim kişisi belirleyin.',
      'Evinize ve iş yerinize en yakın acil durum toplanma alanını önceden öğrenin.',
    ],
  },
];

const LINKS: { label: string; hint: string; url: string; icon: IconName }[] = [
  { label: '112 Acil Çağrı Merkezi', hint: 'Acil durumda arayın', url: 'tel:112', icon: 'call-outline' },
  {
    label: 'Toplanma alanını sorgula',
    hint: 'e-Devlet · Acil Durum Toplanma Alanı Sorgulama',
    url: 'https://www.turkiye.gov.tr/afet-ve-acil-durum-yonetimi-acil-durum-toplanma-alani-sorgulama',
    icon: 'map-outline',
  },
  { label: 'AFAD', hint: 'Resmî duyurular ve afet bilinçlendirme', url: 'https://www.afad.gov.tr', icon: 'globe-outline' },
];

export default function EarthquakeSafetyScreen() {
  const { theme } = useTheme();

  useWebMeta({
    title: 'Depremde Ne Yapmalıyım? | Trabzone Deprem Merkezi',
    description:
      'Deprem öncesi, sırası ve sonrası için temel güvenlik önerileri: Çök–Kapan–Tutun, toplanma alanı sorgulama ve 112.',
    path: '/deprem/guvenlik',
  });

  return (
    <EqPage title="Depremde Ne Yapmalıyım?" subtitle="AFAD önerilerine dayalı temel bilgiler">
      <View style={styles.links}>
        {LINKS.map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            accessibilityLabel={`${link.label}. ${link.hint}`}
            onPress={() => void openUrl(link.url, { title: link.label })}
            style={({ pressed }) => [
              styles.link,
              {
                backgroundColor: link.url === 'tel:112' ? theme.colors.dangerSoft : theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons name={link.icon} size={20} color={link.url === 'tel:112' ? theme.colors.danger : theme.colors.primary} />
            <View style={styles.flex}>
              <AppText variant="bodyStrong">{link.label}</AppText>
              <AppText variant="caption" color="textSecondary">
                {link.hint}
              </AppText>
            </View>
            <Ionicons name="open-outline" size={16} color={theme.colors.textTertiary} />
          </Pressable>
        ))}
      </View>

      {SECTIONS.map((section) => (
        <View
          key={section.title}
          style={[styles.section, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg }]}
        >
          <View style={styles.sectionHead}>
            <Ionicons name={section.icon} size={20} color={theme.colors.primary} />
            <AppText variant="title" accessibilityRole="header">
              {section.title}
            </AppText>
          </View>
          {section.items.map((item) => (
            <View key={item} style={styles.item}>
              <View style={[styles.bullet, { backgroundColor: theme.colors.primary }]} />
              <AppText variant="body" style={styles.flex}>
                {item}
              </AppText>
            </View>
          ))}
        </View>
      ))}

      <InfoNote>
        Bu sayfa genel bilgilendirme amaçlıdır ve bağlantı olmadan da açılır. Güncel ve resmî yönlendirmeler için AFAD’ı ve
        yerel yetkilileri takip edin. Trabzone deprem tahmini yapmaz ve resmî erken uyarı hizmeti değildir.
      </InfoNote>
    </EqPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  links: { gap: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  section: { padding: 14, gap: 10, borderWidth: StyleSheet.hairlineWidth },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
});
