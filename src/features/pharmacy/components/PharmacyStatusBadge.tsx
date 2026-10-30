import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { PharmacyState } from '../types';
import { describePharmacyState, type StatusTone } from '../utils/status';

type TonePalette = {
  foreground: string;
  background: string;
  border: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

function tonePalette(tone: StatusTone, colors: ReturnType<typeof useTheme>['theme']['colors']): TonePalette {
  switch (tone) {
    case 'duty':
      return {
        foreground: colors.success,
        background: colors.successSoft,
        border: `${colors.success}33`,
        icon: 'moon',
      };
    case 'today':
      return {
        foreground: colors.primaryDeep,
        background: colors.primarySoft,
        border: `${colors.primary}33`,
        icon: 'time-outline',
      };
    case 'open':
      return {
        foreground: colors.success,
        background: colors.successSoft,
        border: `${colors.success}26`,
        icon: 'checkmark-circle-outline',
      };
    case 'closed':
      return {
        foreground: colors.warning,
        background: colors.warningSoft,
        border: `${colors.warning}33`,
        icon: 'moon-outline',
      };
    default:
      return {
        foreground: colors.textTertiary,
        background: colors.surfaceMuted,
        border: colors.border,
        icon: 'help-circle-outline',
      };
  }
}

/**
 * Nöbet/çalışma durumu rozeti. Durum sunucuda Europe/Istanbul saatine göre
 * hesaplanır; burada yalnızca etiketlenir. Durum bilinmiyorsa "Nöbette"
 * denmez.
 */
export function PharmacyStatusBadge({
  state,
  compact = false,
}: {
  state: PharmacyState | null | undefined;
  compact?: boolean;
}) {
  const { theme } = useTheme();
  const view = describePharmacyState(state);
  const palette = tonePalette(view.tone, theme.colors);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Durum: ${view.label}`}
      style={[
        styles.badge,
        compact && styles.badgeCompact,
        { backgroundColor: palette.background, borderColor: 'transparent' },
      ]}
    >
      <Ionicons name={palette.icon} size={compact ? 11 : 12} color={palette.foreground} />
      <AppText
        variant="caption"
        style={{ color: palette.foreground, fontWeight: '600' }}
        numberOfLines={1}
      >
        {view.label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  badgeCompact: { paddingHorizontal: 7, paddingVertical: 2 },
});
