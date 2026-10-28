import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import type { ComponentProps, ReactNode } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  maxWidth?: number;
  dense?: boolean;
};

export function AdminPage({
  title,
  subtitle,
  actions,
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  maxWidth = 1440,
  dense = false,
}: Props) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const router = useRouter();
  const canBack = !['/admin', '/admin/'].includes(
    typeof window !== 'undefined' ? window.location.pathname : '',
  );

  const content = (
    <View
      style={[
        styles.inner,
        {
          maxWidth,
          paddingHorizontal: compact ? 14 : 26,
          paddingTop: compact ? 14 : 22,
          gap: compact ? 14 : 18,
        },
      ]}
    >
      <View style={[styles.head, compact && styles.headCompact]}>
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            {compact && canBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Geri"
                onPress={() => router.back()}
                style={[
                  styles.back,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <Ionicons name="chevron-back" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            ) : null}
            <AppText variant={compact ? 'h2' : 'h1'} numberOfLines={2}>
              {title}
            </AppText>
          </View>
          {subtitle ? (
            <AppText variant="body" color="textSecondary" style={styles.subtitle}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? (
          <View style={[styles.actions, compact && styles.actionsCompact]}>{actions}</View>
        ) : null}
      </View>
      {children}
      <View style={{ height: dense ? 8 : 24 }} />
    </View>
  );

  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>{content}</View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        ) : undefined
      }
    >
      {content}
    </ScrollView>
  );
}

type SectionProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: object;
};

export function AdminSection({ title, subtitle, action, children, style }: SectionProps) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.section,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
        },
        style,
      ]}
    >
      <View style={styles.sectionHead}>
        <View style={styles.flex}>
          <AppText variant="title">{title}</AppText>
          {subtitle ? (
            <AppText variant="caption" color="textTertiary">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

export function AdminToolbar({ children }: { children: ReactNode }) {
  return <View style={styles.toolbar}>{children}</View>;
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.key)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                borderColor: active ? theme.colors.primary : theme.colors.border,
              },
            ]}
          >
            <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
              {option.label}
            </AppText>
            {typeof option.count === 'number' ? (
              <View
                style={[
                  styles.chipCount,
                  {
                    backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={active ? 'onPrimary' : 'textTertiary'}
                  style={styles.tiny}
                >
                  {option.count > 999 ? '999+' : option.count}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const { theme } = useTheme();
  const page = Math.floor(offset / Math.max(limit, 1)) + 1;
  const pages = Math.max(Math.ceil(total / Math.max(limit, 1)), 1);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <View style={styles.pager}>
      <AppText variant="caption" color="textTertiary">
        {from}-{to} / {total} kayıt
      </AppText>
      <View style={styles.pagerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Önceki sayfa"
          disabled={page <= 1}
          onPress={() => onChange(Math.max(offset - limit, 0))}
          style={[
            styles.pagerButton,
            {
              borderColor: theme.colors.border,
              opacity: page <= 1 ? 0.4 : 1,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={16} color={theme.colors.textSecondary} />
        </Pressable>
        <Badge label={`${page} / ${pages}`} tone="neutral" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sonraki sayfa"
          disabled={page >= pages}
          onPress={() => onChange(offset + limit)}
          style={[
            styles.pagerButton,
            {
              borderColor: theme.colors.border,
              opacity: page >= pages ? 0.4 : 1,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export function QuickAction({
  label,
  icon,
  onPress,
  variant = 'secondary',
  loading,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  loading?: boolean;
}) {
  return (
    <Button
      label={label}
      size="sm"
      variant={variant}
      fullWidth={false}
      loading={loading}
      leftIcon={<Ionicons name={icon} size={15} color="#FFFFFF" />}
      onPress={onPress}
      style={styles.quickAction}
    />
  );
}

export const adminStyles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  muted: { color: '#888' },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  inner: { width: '100%', alignSelf: 'center' },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  headCompact: { flexDirection: 'column', alignItems: 'stretch' },
  titleBlock: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subtitle: { maxWidth: 760 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actionsCompact: { justifyContent: 'flex-start' },
  back: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  section: { padding: 16, gap: 12, borderWidth: StyleSheet.hairlineWidth },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tiny: { fontSize: 10, lineHeight: 13 },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 8,
    flexWrap: 'wrap',
  },
  pagerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pagerButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickAction: { minHeight: 38, paddingHorizontal: 14 },
});
