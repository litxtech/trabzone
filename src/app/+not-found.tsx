import { Ionicons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useWebMeta } from '@/features/web/use-web-meta';
import { PublicShell } from '@/features/web/components/PublicShell';
import { useTheme } from '@/theme/ThemeProvider';

export default function NotFoundScreen() {
  const { theme } = useTheme();

  useWebMeta({
    title: 'Sayfa bulunamadı · Trabzone',
    description: 'Aradığınız sayfa taşınmış veya kaldırılmış olabilir.',
    path: '/404',
    noIndex: true,
  });

  return (
    <PublicShell title="Sayfa bulunamadı" fallbackHref="/feed">
      <View style={styles.body}>
        <View
          style={[
            styles.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="compass-outline" size={26} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="display" align="center" style={styles.title}>
            Sayfa bulunamadı
          </AppText>
          <AppText variant="body" color="textSecondary" align="center" style={styles.copy}>
            Aradığınız sayfa taşınmış, adı değişmiş veya kaldırılmış olabilir. Ana sayfadan devam
            edebilir veya destek merkezini kullanabilirsiniz.
          </AppText>
          <View style={styles.actions}>
            <Link href={'/' as Href} asChild>
              <Pressable
                style={({ pressed }) => [
                  styles.primary,
                  { backgroundColor: theme.colors.primaryDeep, opacity: pressed ? 0.82 : 1 },
                ]}
              >
                <Ionicons name="home-outline" size={16} color={theme.colors.onPrimary} />
                <AppText variant="bodyStrong" color="onPrimary">
                  Ana sayfa
                </AppText>
              </Pressable>
            </Link>
            <Link href={'/support' as Href} asChild>
              <Pressable
                style={({ pressed }) => [
                  styles.secondary,
                  { borderColor: theme.colors.border, opacity: pressed ? 0.82 : 1 },
                ]}
              >
                <Ionicons name="help-buoy-outline" size={16} color={theme.colors.primaryDeep} />
                <AppText variant="bodyStrong" color="primaryDeep">
                  Destek merkezi
                </AppText>
              </Pressable>
            </Link>
          </View>
        </View>
      </View>
    </PublicShell>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    marginVertical: 48,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 30, lineHeight: 38 },
  copy: { maxWidth: 440, lineHeight: 24 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
    justifyContent: 'center',
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
});
