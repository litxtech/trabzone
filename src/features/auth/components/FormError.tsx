import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export function FormError({ message }: { message: string | null | undefined }) {
  const { theme } = useTheme();
  if (!message) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.dangerSoft, borderRadius: theme.radius.sm },
      ]}
    >
      <Ionicons name="alert-circle" size={18} color={theme.colors.danger} />
      <AppText variant="caption" color="danger" style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: { flex: 1 },
});
