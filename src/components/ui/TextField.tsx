import { Ionicons } from '@expo/vector-icons';
import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  Platform,
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
  /** İpucu satırının rengi: kullanıcı adı uygun/uygun değil geri bildirimi. */
  hintTone?: 'neutral' | 'success' | 'danger';
  error?: string | null;
  leftIcon?: IconName;
  rightSlot?: ReactNode;
  secure?: boolean;
  containerStyle?: object;
  /**
   * Mobilde alanı düzenlemek için önce bilinçli bir dokunuş gerekir.
   * Sayfa kaydırılırken parmağın alana denk gelmesi klavyeyi açmaz.
   */
  tapToEdit?: boolean;
};

export const TextField = forwardRef<ComponentRef<typeof TextInput>, TextFieldProps>(
  function TextField(
    {
      label,
      hint,
      hintTone = 'neutral',
      error,
      leftIcon,
      rightSlot,
      secure = false,
      containerStyle,
      tapToEdit = false,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) {
    const { theme } = useTheme();
    const [focused, setFocused] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const multiline = Boolean(rest.multiline);

    const inputRef = useRef<ComponentRef<typeof TextInput> | null>(null);
    const gateEdit = tapToEdit && Platform.OS !== 'web' && rest.editable !== false;
    const [armed, setArmed] = useState(!gateEdit);
    const needsArm = gateEdit && !armed;

    const setRef = useCallback(
      (node: ComponentRef<typeof TextInput> | null) => {
        inputRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const armAndFocus = useCallback(() => {
      setArmed(true);
      // Alan bir sonraki render'da düzenlenebilir hale gelir; odak ondan sonra verilir.
      setTimeout(() => inputRef.current?.focus(), 40);
    }, []);

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
            ref={setRef}
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
              if (gateEdit) setArmed(false);
              onBlur?.(event);
            }}
            {...rest}
            editable={needsArm ? false : rest.editable}
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

          {/* Kaydırma sırasında kazara klavye açılmasını engelleyen dokunma kapısı. */}
          {needsArm ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label ? `${label} alanını düzenle` : 'Alanı düzenle'}
              onPress={armAndFocus}
              style={[StyleSheet.absoluteFill, styles.editGate]}
            />
          ) : null}
        </View>

        {error ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : hint ? (
          <AppText
            variant="caption"
            color={
              hintTone === 'success' ? 'success' : hintTone === 'danger' ? 'danger' : 'textTertiary'
            }
          >
            {hint}
          </AppText>
        ) : null}
      </View>
    );
  },
);

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
    minWidth: 0,
    paddingVertical: 0,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  multilineIcon: { paddingTop: 2 },
  editGate: { zIndex: 1 },
});
