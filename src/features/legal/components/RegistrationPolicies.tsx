import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { buildLegalDirectory, legalPath } from '@/features/legal/catalog';
import { useLegalDocuments } from '@/features/legal/hooks/use-legal';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter, type Href } from '@/utils/router';

/**
 * Yayındaki tüm sözleşme ve politikaların bağlantısı.
 *
 * Kayıt ekranında onay kutusunun altında, giriş ekranında ise yalnızca
 * bilgilendirme amacıyla gösterilir. Metinler sunucudan sürümlenir; panelden
 * eklenen yeni belgeler liste yenilenmeden görünür.
 */
export function PolicyLinks({ align = 'flex-start' }: { align?: 'flex-start' | 'center' }) {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: documents } = useLegalDocuments('tr');
  const items = useMemo(() => buildLegalDirectory(documents), [documents]);

  const open = (slug: string) => {
    const path = legalPath(slug);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(path, '_blank', 'noopener,noreferrer');
      return;
    }
    router.push(path as Href);
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={[styles.links, align === 'center' && styles.linksCenter]}>
      {items.map((item) => (
        <Pressable
          key={item.slug}
          accessibilityRole="link"
          accessibilityLabel={`${item.title} metnini aç`}
          hitSlop={4}
          onPress={() => open(item.slug)}
          style={({ pressed }) => [
            styles.chip,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceMuted,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <AppText variant="caption" color="primary">
            {item.shortTitle}
          </AppText>
          <Ionicons name="open-outline" size={11} color={theme.colors.primary} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Kayıt ekranındaki tek onay kutusu: hem Kullanım Koşullarını hem de
 * yayındaki diğer tüm politikaları kapsar.
 *
 * Onay yalnızca burada alınır; kayıt tamamlandığında sunucuya her belge için
 * ayrı kabul kaydı yazılır ve sonraki ekranlarda tekrar sorulmaz.
 */
export function RegistrationConsentBox({
  checked,
  onChange,
  error,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  error?: string;
}) {
  const { theme } = useTheme();

  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="Tüm sözleşme ve politikaların onayı"
        onPress={() => onChange(!checked)}
        style={styles.checkRow}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: error ? theme.colors.danger : theme.colors.borderStrong,
              backgroundColor: checked ? theme.colors.primary : 'transparent',
            },
          ]}
        >
          {checked ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
        </View>
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          Kullanım Koşullarını ve aşağıdaki tüm sözleşme, politika ve kuralları okudum; kabul
          ediyorum.
        </AppText>
      </Pressable>

      <PolicyLinks />

      <AppText variant="caption" color="textTertiary" style={styles.note}>
        Onayın kayıt sırasında bir kez alınır ve hesabına kaydedilir; girişte ve sonraki
        ekranlarda tekrar sorulmaz. Zorunlu olmayan tercihleri ayarlardan yönetebilirsin.
      </AppText>

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  linksCenter: { justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  box: { gap: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    borderRadius: 6,
  },
  note: { lineHeight: 17 },
});
