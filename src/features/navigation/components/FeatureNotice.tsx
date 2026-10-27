import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, IconButton, Screen } from '@/components/ui';
import { useDrawer } from '@/features/navigation/drawer-context';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  headerTitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
  bullets?: string[];
};

/**
 * Veri modeli henuz hazir olmayan bolumler icin durust bilgilendirme ekrani.
 * Sahte icerik/buton yok: yalnizca gercekten calisan destek akisina yonlendirir.
 */
export function FeatureNotice({ headerTitle, icon, title, description, bullets }: Props) {
  const { theme } = useTheme();
  const router = useRouter();
  const { open } = useDrawer();

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <View style={styles.header}>
        <IconButton
          name="menu"
          accessibilityLabel="Menüyü aç"
          variant="surface"
          size={20}
          onPress={() => open('main')}
        />
        <AppText variant="h3">{headerTitle}</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.xxl },
          ]}
        >
          <Ionicons name={icon} size={34} color={theme.colors.primaryDeep} />
        </View>

        <AppText variant="h2" align="center">
          {title}
        </AppText>
        <AppText variant="body" color="textSecondary" align="center" style={styles.description}>
          {description}
        </AppText>

        {bullets && bullets.length > 0 ? (
          <View
            style={[
              styles.list,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            {bullets.map((bullet) => (
              <View key={bullet} style={styles.bulletRow}>
                <Ionicons name="checkmark" size={16} color={theme.colors.success} />
                <AppText variant="body" color="textSecondary" style={styles.bulletText}>
                  {bullet}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label="Destek ekibine yaz"
            variant="primary"
            size="md"
            onPress={() => router.push('/support/create' as never)}
          />
          <Button
            label="Akışa dön"
            variant="ghost"
            size="md"
            onPress={() => router.navigate('/feed')}
          />
        </View>

        <AppText variant="caption" color="textTertiary" align="center">
          Bu bölüm henüz yayında değil; hazır olduğunda burada açılacak.
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerSpacer: { width: 44 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 10 },
  iconWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  description: { maxWidth: 340 },
  list: {
    width: '100%',
    marginTop: 8,
    padding: 14,
    gap: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { flex: 1 },
  actions: { width: '100%', gap: 8, marginTop: 14 },
});
