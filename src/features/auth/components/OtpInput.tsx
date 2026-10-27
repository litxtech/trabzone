import { useEffect, useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  error?: string | null;
  autoFocus?: boolean;
};

type OtpInputRef = ComponentRef<typeof TextInput>;

/**
 * Six visual boxes backed by real inputs so native OTP autofill (iOS/Android)
 * and clipboard paste both work.
 */
export function OtpInput({ value, onChange, length = 6, error, autoFocus = true }: OtpInputProps) {
  const { theme } = useTheme();
  const inputs = useRef<(OtpInputRef | null)[]>([]);

  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => inputs.current[0]?.focus(), 350);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [autoFocus]);

  const setChar = (index: number, text: string) => {
    const digits = text.replace(/\D/g, '');
    if (!digits) {
      const next = value.split('');
      next[index] = '';
      onChange(next.join('').slice(0, length));
      return;
    }

    const next = value.padEnd(length, ' ').split('');
    digits.split('').forEach((digit, offset) => {
      if (index + offset < length) {
        next[index + offset] = digit;
      }
    });
    const merged = next.join('').replace(/ /g, '').slice(0, length);
    onChange(merged);
    const focusIndex = Math.min(index + digits.length, length - 1);
    inputs.current[focusIndex]?.focus();
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.row}>
        {Array.from({ length }).map((_, index) => {
          const char = value[index] ?? '';
          const isFocused = false;
          return (
            <Pressable
              key={index}
              onPress={() => inputs.current[index]?.focus()}
              style={[
                styles.box,
                {
                  borderColor: error
                    ? theme.colors.danger
                    : char
                      ? theme.colors.primary
                      : theme.colors.border,
                  backgroundColor: char ? theme.colors.primarySoft : theme.colors.inputBackground,
                  borderRadius: theme.radius.md,
                },
                isFocused ? { borderWidth: 2 } : null,
              ]}
            >
              <TextInput
                ref={(element) => {
                  inputs.current[index] = element;
                }}
                value={char}
                onChangeText={(text) => setChar(index, text)}
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === 'Backspace' && !char && index > 0) {
                    inputs.current[index - 1]?.focus();
                  }
                }}
                keyboardType="number-pad"
                textContentType={index === 0 ? 'oneTimeCode' : 'none'}
                autoComplete={index === 0 ? 'one-time-code' : 'off'}
                maxLength={length}
                caretHidden
                style={[styles.input, theme.typography.h2, { color: theme.colors.text }]}
                accessibilityLabel={`Kod hanesi ${index + 1}`}
              />
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  box: {
    flex: 1,
    maxWidth: 56,
    aspectRatio: 0.92,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  input: {
    width: '100%',
    height: '100%',
    textAlign: 'center',
    padding: 0,
  },
});
