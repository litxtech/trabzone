import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useAccommodationLayout } from '../hooks/use-accommodation-layout';
import { centsToInput, formatDate, formatMoneyCents, parseMoneyToCents } from '../utils/format';
import { DatePickerModal } from './DatePickerModal';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function AccCard({
  children,
  style,
  padding = 14,
  onPress,
  glass = false,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  onPress?: () => void;
  glass?: boolean;
  accessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  const content = (
    <>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: theme.radius.lg,
            borderTopWidth: 1,
            borderTopColor: glass ? theme.colors.glassHighlight : theme.colors.border,
          },
        ]}
      />
      {children}
    </>
  );

  const base = [
    styles.card,
    {
      backgroundColor: glass ? theme.colors.glass : theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.lg,
      padding,
    },
    style,
  ];

  if (!onPress) {
    return <View style={base}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [...base, { opacity: pressed ? 0.88 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      {icon ? (
        <View style={[styles.sectionIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name={icon} size={17} color={theme.colors.primaryDeep} />
        </View>
      ) : null}
      <View style={styles.flex}>
        <AppText variant="h3">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color="textSecondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  compact = false,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string | null;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'accent';
  icon?: IconName;
  compact?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const colors = {
    default: { fg: theme.colors.text, bg: theme.colors.surfaceMuted },
    primary: { fg: theme.colors.primaryDeep, bg: theme.colors.primarySoft },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
    accent: { fg: theme.colors.accent, bg: theme.colors.accentSoft },
  }[tone];

  return (
    <AccCard
      padding={compact ? 11 : 13}
      onPress={onPress}
      accessibilityLabel={`${label}: ${value}`}
      style={styles.statTile}
    >
      <View style={styles.statTop}>
        <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
          {label}
        </AppText>
        {icon ? (
          <View style={[styles.statIcon, { backgroundColor: colors.bg }]}>
            <Ionicons name={icon} size={14} color={colors.fg} />
          </View>
        ) : null}
      </View>
      <AppText
        variant={compact ? 'bodyStrong' : 'h3'}
        numberOfLines={1}
        style={{ color: colors.fg, fontVariant: ['tabular-nums'] }}
      >
        {value}
      </AppText>
      {hint ? (
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {hint}
        </AppText>
      ) : null}
    </AccCard>
  );
}

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  message,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.empty, compact ? styles.emptyCompact : null]}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={compact ? 20 : 26} color={theme.colors.textSecondary} />
      </View>
      <AppText variant="bodyStrong" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="caption" color="textSecondary" align="center" style={styles.emptyMessage}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} size="sm" onPress={onAction} style={styles.emptyAction} fullWidth={false} />
      ) : null}
    </View>
  );
}

export function LoadingBlock({ label = 'Yükleniyor…', height = 160 }: { label?: string; height?: number }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.loading, { height }]}>
      <ActivityIndicator color={theme.colors.primary} />
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

export function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger }]}>
      <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
      <AppText variant="caption" color="danger" style={styles.flex}>
        {message}
      </AppText>
      {onRetry ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Tekrar dene" onPress={onRetry} hitSlop={8}>
          <AppText variant="caption" color="danger" style={styles.retry}>
            Tekrar dene
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
  tone,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: IconName;
  tone?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surfaceMuted,
          borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
          borderRadius: theme.radius.pill,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={14} color={active ? '#FFFFFF' : (tone ?? theme.colors.textSecondary)} />
      ) : null}
      <AppText variant="caption" color={active ? '#FFFFFF' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function ChipsRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.chipsRow, style]}
    >
      {children}
    </ScrollView>
  );
}

export function StatusPill({
  label,
  color,
  background,
  border,
  icon,
}: {
  label: string;
  color: string;
  background: string;
  border?: string;
  icon?: IconName;
}) {
  return (
    <View
      accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: background, borderColor: border ?? background }]}
    >
      {icon ? <Ionicons name={icon} size={11} color={color} /> : null}
      <AppText variant="caption" style={{ color, fontSize: 11 }}>
        {label}
      </AppText>
    </View>
  );
}

export function KeyValueRow({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={15} color={theme.colors.textTertiary} /> : null}
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {label}
      </AppText>
      {typeof value === 'string' ? (
        <AppText variant="caption" align="right" style={styles.kvValue}>
          {value}
        </AppText>
      ) : (
        value
      )}
    </>
  );
  if (!onPress) {
    return <View style={styles.kv}>{content}</View>;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.kv}>
      {content}
    </Pressable>
  );
}

export function MoneyField({
  label,
  cents,
  onChangeCents,
  currency = 'TRY',
  error,
  hint,
}: {
  label: string;
  cents: number | null;
  onChangeCents: (cents: number | null) => void;
  currency?: string;
  error?: string | null;
  hint?: string;
}) {
  const [text, setText] = useState(centsToInput(cents));

  useEffect(() => {
    const next = centsToInput(cents);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText((current) => (parseMoneyToCents(current) === cents ? current : next));
  }, [cents]);

  return (
    <TextField
      label={label}
      value={text}
      onChangeText={(value) => {
        setText(value);
        onChangeCents(parseMoneyToCents(value));
      }}
      keyboardType="decimal-pad"
      inputMode="decimal"
      placeholder="0"
      hint={hint ?? `Para birimi: ${currency}`}
      error={error}
      leftIcon="cash-outline"
    />
  );
}

export function DateField({
  label,
  value,
  onChange,
  mode = 'single',
  endValue,
  onEndChange,
  minDate,
  error,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (iso: string) => void;
  mode?: 'single' | 'range';
  endValue?: string | null;
  onEndChange?: (iso: string) => void;
  minDate?: string | null;
  error?: string | null;
  hint?: string;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? formatDate(value) : 'seçilmedi'}`}
        onPress={() => setOpen(true)}
        style={[
          styles.dateField,
          {
            backgroundColor: theme.colors.inputBackground,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            borderRadius: theme.radius.md,
          },
        ]}
      >
        <Ionicons name="calendar-outline" size={18} color={theme.colors.textTertiary} />
        <AppText variant="body" color={value ? 'text' : 'textTertiary'} style={styles.flex}>
          {value
            ? mode === 'range' && endValue
              ? `${formatDate(value)} – ${formatDate(endValue)}`
              : formatDate(value)
            : 'Tarih seç'}
        </AppText>
        <Ionicons name="chevron-down" size={16} color={theme.colors.textTertiary} />
      </Pressable>
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      ) : null}
      <DatePickerModal
        visible={open}
        title={label}
        mode={mode}
        value={value}
        endValue={endValue}
        minDate={minDate}
        onClose={() => setOpen(false)}
        onSelectSingle={(iso) => onChange(iso)}
        onSelectRange={(start, end) => {
          onChange(start);
          onEndChange?.(end);
        }}
      />
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <AppText variant="body">{label}</AppText>
        {description ? (
          <AppText variant="caption" color="textTertiary">
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

export function StarRating({
  rating,
  size = 14,
  count,
  onChange,
}: {
  rating: number;
  size?: number;
  count?: number;
  onChange?: (rating: number) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.round(rating);
        const element = (
          <Ionicons
            name={filled ? 'star' : 'star-outline'}
            size={size}
            color={filled ? '#F5B301' : theme.colors.textTertiary}
          />
        );
        return onChange ? (
          <Pressable key={star} accessibilityRole="button" accessibilityLabel={`${star} yıldız`} onPress={() => onChange(star)}>
            {element}
          </Pressable>
        ) : (
          <View key={star}>{element}</View>
        );
      })}
      {typeof count === 'number' ? (
        <AppText variant="caption" color="textTertiary">
          {rating > 0 ? rating.toFixed(1) : 'Yeni'} {count > 0 ? `(${count})` : ''}
        </AppText>
      ) : null}
    </View>
  );
}

export function ModalSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 720,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  scroll?: boolean;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useAccommodationLayout();

  return (
    <Modal visible={visible} transparent animationType={layout.isDesktop ? 'fade' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.modalRoot, layout.isDesktop ? styles.modalCenter : styles.modalBottom]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paneli kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: layout.isDesktop ? theme.radius.xl : 0,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              width: layout.isDesktop ? Math.min(layout.width - 48, maxWidth) : layout.width,
              maxHeight: layout.isDesktop ? '88%' : '94%',
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.modalHead}>
            <View style={styles.flex}>
              <AppText variant="h3">{title}</AppText>
              {subtitle ? (
                <AppText variant="caption" color="textSecondary">
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Kapat" hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalContent}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.modalContent}>{children}</View>
          )}
          {footer ? (
            <View style={[styles.modalFooter, { borderTopColor: theme.colors.divider }]}>{footer}</View>
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function InfoBanner({
  icon = 'information-circle-outline',
  text,
  tone = 'primary',
}: {
  icon?: IconName;
  text: string;
  tone?: 'primary' | 'warning' | 'success';
}) {
  const { theme } = useTheme();
  const palette = {
    primary: { fg: theme.colors.primaryDeep, bg: theme.colors.primarySoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg }]}>
      <Ionicons name={icon} size={17} color={palette.fg} />
      <AppText variant="caption" color={palette.fg} style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

export function MoneyText({
  cents,
  currency = 'TRY',
  variant = 'bodyStrong',
  color,
}: {
  cents: number | null | undefined;
  currency?: string;
  variant?: 'body' | 'bodyStrong' | 'h3' | 'caption';
  color?: string;
}) {
  return (
    <AppText variant={variant} color={color} style={{ fontVariant: ['tabular-nums'] }}>
      {formatMoneyCents(cents, currency)}
    </AppText>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  sectionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statTile: { gap: 3, minWidth: 128, flexGrow: 1 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statIcon: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 7, paddingVertical: 38, paddingHorizontal: 20 },
  emptyCompact: { paddingVertical: 20 },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emptyMessage: { maxWidth: 380 },
  emptyAction: { marginTop: 6 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  retry: { textDecorationLine: 'underline' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
  },
  chipsRow: { gap: 8, paddingVertical: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: 999, alignSelf: 'flex-start' },
  kv: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, minHeight: 30 },
  kvValue: { maxWidth: '60%' },
  dateField: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 14, borderWidth: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  modalRoot: { flex: 1 },
  modalCenter: { justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalBottom: { justifyContent: 'flex-end' },
  modalCard: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 12 },
  divider: { height: StyleSheet.hairlineWidth },
  modalContent: { padding: 16, gap: 12 },
  modalFooter: { padding: 14, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10 },
});
