import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Screen, ScreenHeader } from '@/components/ui';
import { ContentStatsSheet } from '@/features/views/components/ContentStatsSheet';
import type { ViewContentType } from '@/features/views/types';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

const TYPES: ViewContentType[] = [
  'post',
  'reel',
  'marketplace_listing',
  'real_estate_listing',
  'place',
  'ride_offer',
  'profile',
  'blog_post',
];

/**
 * Derin bağlantıyla açılabilen içerik istatistikleri ekranı.
 * Aynı özet bileşeni modal olarak kullanır; burada tam ekran rota sağlar.
 */
export default function ContentStatsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; id?: string; title?: string }>();
  const rawType = typeof params.type === 'string' ? (params.type as ViewContentType) : 'post';
  const type = TYPES.includes(rawType) ? rawType : 'post';
  const id = typeof params.id === 'string' && params.id ? params.id : null;
  const title = typeof params.title === 'string' ? params.title : undefined;

  if (!id) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader title="İçerik istatistikleri" onBack={() => router.back()} />
        <View style={styles.empty}>
          <Ionicons name="eye-off-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="body" color="textSecondary" align="center">
            İstatistikleri gösterilecek içerik belirtilmedi.
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ContentStatsSheet
        visible
        onClose={() => router.back()}
        type={type}
        id={id}
        title={title}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: 50, alignItems: 'center', gap: 10 },
});
