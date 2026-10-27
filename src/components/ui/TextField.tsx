import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { AppText } from './AppText';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type TextFieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  leftIcon?: IconName;
  rightSlot?: ReactNode;
  secure?: boolean;
  containerStyle?: object;
};

export const TextField = forwardRef<ComponentRef<typeof TextInput>, TextFieldProps>(function TextField(
  { label, hint, error, leftIcon, rightSlot, secure = false, containerStyle, onFocus, onBlur, ...rest },
  ref,
) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const multiline = Boolean(rest.multiline);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? (
        <AppText variant="label" color="textSecondary">
          {label}
        </AppText>
      ) : null}

      <View
        style={[
          styles.field,
          multiline && styles.fieldMultiline,
          {
            backgroundColor: theme.colors.inputBackground,
            borderColor,
            borderRadius: theme.radius.md,
            borderWidth: focused || error ? 1.5 : 1,
          },
        ]}
      >
        {leftIcon ? (
          <Ionicons
            name={leftIcon}
            size={20}
            color={theme.colors.textTertiary}
            style={multiline ? styles.multilineIcon : undefined}
          />
        ) : null}

        <TextInput
          ref={ref}
          style={[
            styles.input,
            theme.typography.body,
            { color: theme.colors.text },
            multiline && styles.inputMultiline,
          ]}
          placeholderTextColor={theme.colors.textTertiary}
          selectionColor={theme.colors.primary}
          secureTextEntry={secure && !revealed}
          autoCorrect={false}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />

        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Şifreyi gizle' : 'Şifreyi göster'}
            hitSlop={10}
            onPress={() => setRevealed((value) => !value)}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={theme.colors.textTertiary}
            />
          </Pressable>
        ) : (
          rightSlot
        )}
      </View>

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 54,
    paddingHorizontal: 14,
  },
  fieldMultiline: {
    height: undefined,
    minHeight: 108,
    alignItems: 'flex-start',
    paddingTop: 14,
    paddingBottom: 14,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  multilineIcon: { paddingTop: 2 },
});
