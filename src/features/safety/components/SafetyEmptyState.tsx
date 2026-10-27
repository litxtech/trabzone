import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  icon?: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'danger';
};

export function SafetyEmptyState({
  icon = 'document-text-outline',
  title,
  body,
  actionLabel,
  onAction,
  tone = 'neutral',
}: Props) {
  const { theme } = useTheme();
  const accent = tone === 'danger' ? theme.colors.danger : theme.colors.primaryDeep;
  const soft = tone === 'danger' ? theme.colors.dangerSoft : theme.colors.primarySoft;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.icon, { backgroundColor: soft, borderRadius: theme.radius.xl }]}>
        <Ionicons name={icon} size={28} color={accent} />
      </View>
      <AppText variant="h3" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" color="textSecondary" align="center" style={styles.body}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          variant="secondary"
          size="md"
          fullWidth={false}
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 12 },
  icon: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  body: { maxWidth: 300 },
  action: { marginTop: 8, paddingHorizontal: 22 },
});
