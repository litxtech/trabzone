import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/ui';
import { usePharmacyBootstrap } from '@/features/pharmacy/hooks/use-pharmacy';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * `/nobetci-eczaneler/<ilçe>` deep link'i.
 *
 * Web'de sunucu tarafında işlenen ilçe sayfası açılır; uygulama içinde ise
 * ilçe slug'ı sunucudan gelen gerçek ilçe adıyla eşleştirilip eczane dizinine
 * yönlendirilir. Eşleşme yoksa yanlış ilçe filtresi uygulanmaz: tüm nöbetçi
 * eczaneler listelenir.
 */
export default function DutyDistrictRedirect() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ district?: string }>();
  const bootstrap = usePharmacyBootstrap();

  const slug = (params.district ?? '').trim().toLocaleLowerCase('tr-TR');
  const districts = bootstrap.data?.districts ?? [];
  const match = districts.find(
    (entry) => String(entry.slug).toLocaleLowerCase('tr-TR') === slug,
  );

  if (bootstrap.isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Redirect
      href={{
        pathname: '/eczaneler',
        params: match ? { district: match.name, mode: 'duty_today' } : { mode: 'duty_today' },
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
});
