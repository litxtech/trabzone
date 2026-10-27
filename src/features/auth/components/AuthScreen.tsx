import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, IconButton } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type AuthScreenProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  scroll?: boolean;
  footer?: ReactNode;
};

/**
 * Shared auth chrome: soft brand glow on a light canvas, safe-area aware and
 * keyboard friendly. Keeps every auth screen visually identical.
 */
export function AuthScreen({
  children,
  title,
  subtitle,
  showBack = true,
  scroll = true,
  footer,
}: AuthScreenProps) {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const content = (
    <View style={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      {showBack ? (
        <View style={styles.topRow}>
          <IconButton
            name="chevron-back"
            accessibilityLabel="Geri"
            variant="surface"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/lobby'))}
          />
        </View>
      ) : null}

      {title ? (
        <View style={styles.header}>
          <AppText variant="h1">{title}</AppText>
          {subtitle ? (
            <AppText variant="body" color="textSecondary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {children}
    </View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <LinearGradient
        colors={[theme.colors.primarySoft, theme.colors.background]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 0.55 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[
          styles.orb,
          { backgroundColor: theme.colors.primary, opacity: theme.scheme === 'dark' ? 0.18 : 0.12 },
        ]}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
        {footer}
      </KeyboardAvoidingView>
    </View>
  );
}

export function InlineLink({
  label,
  onPress,
  align = 'center',
}: {
  label: string;
  onPress: () => void;
  align?: 'center' | 'flex-start';
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [{ alignSelf: align, opacity: pressed ? 0.6 : 1 }]}
    >
      <AppText variant="label" color={theme.colors.primaryDeep}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 22,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    marginLeft: -10,
  },
  header: {
    gap: 8,
  },
  orb: {
    position: 'absolute',
    top: -160,
    right: -110,
    width: 340,
    height: 340,
    borderRadius: 170,
  },
});
