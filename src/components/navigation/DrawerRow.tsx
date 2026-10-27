import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

export type DrawerRowTone = 'default' | 'danger' | 'primary';

type Props = {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint?: string;
  badge?: number;
  tone?: DrawerRowTone;
  active?: boolean;
  onPress: () => void;
};

export function DrawerRow({
  icon,
  label,
  hint,
  badge = 0,
  tone = 'default',
  active = false,
  onPress,
}: Props) {
  const { theme } = useTheme();

  const iconColor =
    tone === 'danger'
      ? theme.colors.danger
      : tone === 'primary' || active
        ? theme.colors.primaryDeep
        : theme.colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: active
            ? theme.colors.primarySoft
            : pressed
              ? theme.colors.surfaceMuted
              : 'transparent',
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <View style={styles.icon}>
        <Ionicons name={icon} size={21} color={iconColor} />
      </View>

      <View style={styles.text}>
        <AppText variant="bodyStrong" color={tone === 'danger' ? 'danger' : 'text'} numberOfLines={1}>
          {label}
        </AppText>
        {hint ? (
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {hint}
          </AppText>
        ) : null}
      </View>

      {badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: theme.colors.danger }]}>
          <AppText variant="caption" color="#FFFFFF">
            {badge > 9 ? '9+' : badge}
          </AppText>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
      )}
    </Pressable>
  );
}

export function DrawerSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
          {title.toLocaleUpperCase('tr-TR')}
        </AppText>
      ) : null}
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg }}>
        {children}
      </View>
    </View>
  );
}

export function DrawerDivider() {
  const { theme } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 50,
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
  },
  icon: { width: 26, alignItems: 'center' },
  text: { flex: 1, gap: 1 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  section: { gap: 6 },
  sectionTitle: { paddingHorizontal: 12 },
});
