import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Card, Skeleton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/theme/ThemeProvider';

import { RideHeader } from '@/features/ride/components/RideHeader';
import { useRideProfile, useRidePublicConfig } from '@/features/ride/hooks/use-ride';

const SECTIONS = [
  {
    icon: 'people-outline' as const,
    title: 'Yolculuk türü',
    body:
      'Trabzone üzerindeki yolculuklar özel araçla masraf paylaşımı modeline dayanır. Ticari yolcu taşımacılığı ayrı bir hukuki statüdür ve gerekli yetki belgeleri olmadan yapılamaz. Platform, ticari taşımacılık izni yerine geçmez.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    title: 'Doğrulama şartları',
    body:
      'Sürücüler kimlik, sürücü belgesi, araç ruhsatı ve sigorta doğrulamasını tamamlamalıdır. Yolcular da rezervasyon öncesi kimlik doğrulamasını tamamlar. Doğrulaması tamamlanmayan hesaplar ilan yayınlayamaz veya rezervasyon oluşturamaz.',
  },
  {
    icon: 'cash-outline' as const,
    title: 'Ücret ve ödeme',
    body:
      'Koltuk başına bedel sürücü tarafından belirlenir ve rezervasyon öncesinde açıkça gösterilir. Kartla tahsilat yalnızca ödeme sağlayıcısı yapılandırıldığında ve yasal koşullar sağlandığında etkinleşir. Nakit ödeme rezervasyon sırasında seçilebilir.',
  },
  {
    icon: 'calendar-outline' as const,
    title: 'İptal ve iade',
    body:
      'İptal koşulları yolculuk türüne ve kalkışa kalan süreye göre değişir. Son dakika iptallerinde uygulanacak kurallar rezervasyon öncesi gösterilir. İadeler ödeme yöntemine bağlı olarak işlenir ve yalnızca sağlayıcı onayı sonrası kesinleşir. Haksız otomatik ceza uygulanmaz; itiraz ve moderasyon süreci işletilir.',
  },
  {
    icon: 'bag-handle-outline' as const,
    title: 'Bagaj ve konfor',
    body:
      'Bagaj kapasitesi ve konfor tercihleri ilanda belirtilir. Zorunlu işaretlenen koşullar (erişilebilirlik, çocuk koltuğu, evcil hayvan kısıtı gibi) eşleştirmede korunur ve rezervasyon sonrası tek taraflı kaldırılamaz.',
  },
  {
    icon: 'lock-closed-outline' as const,
    title: 'Gizlilik ve konum',
    body:
      'Açık ilanlarda hassas adresler gösterilmez; yaklaşık konum kullanılır. Canlı konum paylaşımı yalnızca açık kullanıcı izniyle çalışır ve yolculuk bittiğinde sonlandırılır. Güvenilir kişilerle paylaşılan bağlantılar sürelidir. KVKK kapsamındaki haklarınız için destek kanallarını kullanabilirsiniz.',
  },
  {
    icon: 'alert-circle-outline' as const,
    title: 'Güvenlik',
    body:
      'Trabzone resmi acil yardım hizmeti değildir. Acil durumlarda 112 aranmalıdır. Uygulama içi SOS, güvenilir kişilere bildirim ve olay kaydı oluşturur; rota sapması tespit edildiğinde taraflara uyarı gönderilir.',
  },
];

export default function RidePolicyScreen() {
  const { theme } = useTheme();
  const profile = useRideProfile();
  const config = useRidePublicConfig();
  const policy = profile.data?.policy;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Yolculuk anlaşması"
        subtitle="Rezervasyon öncesi karşılıklı koşullar ve sürüm bilgisi"
      />

      {profile.isLoading ? (
        <Card padding={16} style={styles.gap}>
          <Skeleton height={18} width="60%" />
          <Skeleton height={12} />
          <Skeleton height={12} width="80%" />
        </Card>
      ) : (
        <Card padding={16} style={styles.gap}>
          <View style={styles.versionRow}>
            <Badge label={`Sürüm ${policy?.version ?? '—'}`} tone="primary" />
            <Badge
              label={config.data?.card_payments_enabled ? 'Kart ödemesi açık' : 'Kart ödemesi kapalı'}
              tone={config.data?.card_payments_enabled ? 'success' : 'neutral'}
            />
          </View>
          <AppText variant="title">{policy?.title ?? 'Trabzone yolculuk koşulları'}</AppText>
          <AppText variant="caption" color="textTertiary">
            Koşullar rezervasyon sırasında kabul edilir ve kabul zamanı sürüm numarasıyla birlikte
            kayıt altına alınır. Önemli değişikliklerde yeniden onay istenir.
          </AppText>
        </Card>
      )}

      {policy?.items?.length ? (
        <Card padding={15} style={styles.gap}>
          <AppText variant="title">Rezervasyon koşulları</AppText>
          {policy.items.map((item, index) => (
            <View key={`${index}-${item.slice(0, 12)}`} style={styles.bullet}>
              <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
              <AppText variant="body" color="textSecondary" style={styles.flex}>{item}</AppText>
            </View>
          ))}
        </Card>
      ) : null}

      <View style={styles.sections}>
        {SECTIONS.map((section) => (
          <Card key={section.title} padding={15} style={styles.gap}>
            <View style={styles.sectionHead}>
              <View style={[styles.mark, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name={section.icon} size={17} color={theme.colors.primaryDeep} />
              </View>
              <AppText variant="title" style={styles.flex}>{section.title}</AppText>
            </View>
            <AppText variant="body" color="textSecondary">{section.body}</AppText>
          </Card>
        ))}
      </View>

      <Card padding={13} tone="muted">
        <AppText variant="caption" color="textSecondary">
          Bu ekran platform içi yolculuk koşullarının özetidir; hukuki danışmanlık veya yasal fatura
          değildir. Zorunlu güvenlik kuralları yönetici tarafından devre dışı bırakılamaz. Üretime
          çıkmadan önce taşımacılık, ödeme hizmetleri, KVKK ve tüketici hakları yükümlülükleri
          uzman değerlendirmesinden geçirilmelidir.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 9 },
  versionRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  bullet: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  sections: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
