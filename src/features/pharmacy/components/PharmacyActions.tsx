import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { callPharmacy, hasCallablePhone, openDirections } from '../utils/actions';

type ActionKey = 'map' | 'call' | 'directions';

type ActionEntry = {
  key: ActionKey;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  enabled: boolean;
  primary?: boolean;
  onPress: () => void;
};

/**
 * Eczanenin üç temel eylemi: ara, yol tarifi, haritada gör.
 * Telefon veya koordinat doğrulanmamışsa düğme devre dışı kalır; sahte bir
 * yönlendirme yapılmaz.
 */
export function PharmacyActions({
  name,
  phone,
  lat,
  lng,
  onMap,
  compact = false,
}: {
  name: string;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  onMap?: () => void;
  compact?: boolean;
}) {
  const { theme } = useTheme();

  const entries: ActionEntry[] = [
    {
      key: 'call',
      label: 'Ara',
      icon: 'call-outline',
      enabled: hasCallablePhone(phone),
      primary: true,
      onPress: () => {
        haptics.tap();
        void callPharmacy(phone);
      },
    },
    {
      key: 'directions',
      label: 'Yol Tarifi',
      icon: 'navigate-outline',
      enabled: lat != null && lng != null,
      onPress: () => {
        haptics.tap();
        openDirections(lat, lng, name);
      },
    },
    {
      key: 'map',
      label: 'Harita',
      icon: 'map-outline',
      enabled: Boolean(onMap) && lat != null && lng != null,
      onPress: () => {
        haptics.tap();
        onMap?.();
      },
    },
  ];

  return (
    <View style={styles.row}>
      {entries.map((entry) => {
        const background = entry.primary
          ? theme.colors.primaryDeep
          : theme.colors.surfaceMuted;
        const foreground = entry.primary ? theme.colors.onPrimary : theme.colors.primaryDeep;
        return (
          <Pressable
            key={entry.key}
            accessibilityRole="button"
            accessibilityLabel={
              entry.enabled
                ? `${entry.label}: ${name}`
                : `${entry.label} için doğrulanmış bilgi yok`
            }
            accessibilityState={{ disabled: !entry.enabled }}
            disabled={!entry.enabled}
            onPress={entry.onPress}
            style={({ pressed }) => [
              styles.action,
              compact ? styles.actionCompact : null,
              {
                backgroundColor: background,
                borderColor: 'transparent',
                opacity: entry.enabled ? (pressed ? 0.78 : 1) : 0.4,
              },
            ]}
          >
            <Ionicons name={entry.icon} size={compact ? 13 : 14} color={foreground} />
            <AppText
              variant="caption"
              style={{ color: foreground, fontWeight: '700' }}
              numberOfLines={1}
            >
              {entry.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 7, marginTop: 2 },
  action: {
    flex: 1,
    minHeight: 40,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 6,
  },
  actionCompact: { minHeight: 36, borderRadius: 12 },
});
