import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { CHILD_PROTECTED_EXPLANATION, SAFETY_COMMITMENTS } from '../constants';
import { SafetySheet } from './SafetySheet';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Kendi hesabi mi? false ise ayar baglantilari gizlenir (veli/yonetici). */
  isOwner?: boolean;
};

/**
 * Cocuk Korumali Hesap bilgi merkezi. Rozete dokunuldugunda acilir; rozetin
 * kimlere gorundugu ve hesapta hangi korumalarin zorunlu oldugu burada
 * aciklanir.
 */
export function ChildSafetyInfoSheet({ visible, onClose, isOwner = true }: Props) {
  const { theme } = useTheme();
  const router = useRouter();

  return (
    <SafetySheet
      visible={visible}
      onClose={onClose}
      title="Çocuk Korumalı Hesap"
      subtitle="Güvenliğin için otomatik olarak uygulanan korumalar"
      footer={
        isOwner ? (
          <Button
            label="Güvenlik ayarlarını aç"
            leftIcon={<Ionicons name="shield-checkmark-outline" size={18} color="#FFFFFF" />}
            onPress={() => {
              onClose();
              router.push('/settings/child-safety');
            }}
          />
        ) : (
          <Button label="Anladım" variant="secondary" onPress={onClose} />
        )
      }
    >
      <View
        style={[
          styles.hero,
          { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.lg },
        ]}
      >
        <View style={[styles.heroIcon, { backgroundColor: theme.colors.surface }]}>
          <Ionicons name="shield-checkmark" size={30} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="title" color="primaryDeep">
          Hesabın 18 yaşına kadar korunuyor
        </AppText>
        <AppText variant="body" color="textSecondary">
          Trabzone, 18 yaş altındaki hesapları varsayılan olarak daha kapalı ve daha güvenli
          ayarlarla başlatır. Bu korumaları kapatamazsın; yalnızca daha sıkı hale getirebilirsin.
        </AppText>
      </View>

      <View style={styles.section}>
        <AppText variant="label" color="textTertiary">
          NELER DEĞİŞİYOR?
        </AppText>
        <View style={styles.list}>
          {CHILD_PROTECTED_EXPLANATION.map((item) => (
            <Card key={item.title} style={styles.item} elevated={false}>
              <View style={[styles.itemIcon, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name={item.icon} size={18} color={theme.colors.primaryDeep} />
              </View>
              <View style={styles.itemText}>
                <AppText variant="bodyStrong">{item.title}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {item.body}
                </AppText>
              </View>
            </Card>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="label" color="textTertiary">
          KİMLER GÖREBİLİR?
        </AppText>
        <Card tone="muted" elevated={false} style={styles.visibilityCard}>
          <View style={styles.visibilityRow}>
            <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
            <AppText variant="body" style={styles.flex}>
              Hesap sahibi (sen), arkadaşların, doğrulanmış velin ve yetkili güvenlik ekibi
            </AppText>
          </View>
          <View style={styles.visibilityRow}>
            <Ionicons name="close-circle" size={18} color={theme.colors.danger} />
            <AppText variant="body" style={styles.flex}>
              Tanımadığın kişiler ve reklamverenler göremez
            </AppText>
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="label" color="textTertiary">
          TAAHHÜTLERİMİZ
        </AppText>
        <View style={styles.list}>
          {SAFETY_COMMITMENTS.map((commitment) => (
            <View key={commitment} style={styles.commitment}>
              <Ionicons name="shield-outline" size={15} color={theme.colors.primary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                {commitment}
              </AppText>
            </View>
          ))}
        </View>
      </View>
    </SafetySheet>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 18, gap: 8, alignItems: 'flex-start' },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  section: { gap: 8, marginTop: 8 },
  list: { gap: 8 },
  item: { flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' },
  itemIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, gap: 3 },
  visibilityCard: { gap: 10, padding: 14 },
  visibilityRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  commitment: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
