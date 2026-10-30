import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  variant?: 'compact' | 'card';
  onPress?: () => void;
};

/**
 * Çocuk Hesabı (kısıtlanmış hesap) rozeti.
 *
 * GÖRÜNÜRLÜK KURALI: Bu bileşen yalnızca hesap sahibi, hesabın arkadaşları
 * (karşılıklı takip), doğrulanmış veli ve yetkili moderasyon ekibi tarafından
 * render edilir. Yabancıya yaş bilgisi verilmez; sunucu da
 * `safety_profile_flags` üzerinden yabancıya boş nesne döndürür.
 */
export function ChildProtectedBadge({ variant = 'compact', onPress }: Props) {
  const { theme } = useTheme();

  const content =
    variant === 'compact' ? (
      <View
        style={[
          styles.compact,
          { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
        ]}
      >
        <Ionicons name="shield-checkmark" size={13} color={theme.colors.primaryDeep} />
        <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
          Çocuk Hesabı
        </AppText>
      </View>
    ) : (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
        ]}
      >
        <View style={[styles.cardIcon, { backgroundColor: theme.colors.surface }]}>
          <Ionicons name="shield-checkmark" size={22} color={theme.colors.primaryDeep} />
        </View>
        <View style={styles.cardText}>
          <AppText variant="title" color="primaryDeep">
            Çocuk Hesabı · Kısıtlanmış Hesap
          </AppText>
          <AppText variant="caption" color="textSecondary">
            Gönderilerin yalnızca arkadaşlarına görünür. Profilin gizli, tanımadığın kişiler mesaj
            atamaz; konum paylaşımı kapalıdır. Rozeti yabancılar görmez.
          </AppText>
        </View>
        <Ionicons name="information-circle-outline" size={20} color={theme.colors.primaryDeep} />
      </View>
    );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Çocuk Korumalı Hesap hakkında bilgi"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 3 },
});
