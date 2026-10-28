import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export type Column<T> = {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
  hideOnMobile?: boolean;
};

export function DataTable<T>({
  columns,
  rows,
  keyExtractor,
  onRowPress,
  loading = false,
  empty,
  compactAt = 860,
}: {
  columns: Column<T>[];
  rows: T[];
  keyExtractor: (row: T) => string;
  onRowPress?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  compactAt?: number;
}) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < compactAt;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.primary} />
        <AppText variant="caption" color="textTertiary">
          Yükleniyor…
        </AppText>
      </View>
    );
  }

  if (rows.length === 0) {
    return <>{empty ?? null}</>;
  }

  if (compact) {
    return (
      <View style={styles.mobileList}>
        {rows.map((row) => {
          const content = (
            <View
              style={[
                styles.mobileCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              {columns
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <View key={column.key} style={styles.mobileRow}>
                    <AppText variant="caption" color="textTertiary" style={styles.mobileLabel}>
                      {column.label}
                    </AppText>
                    <View style={styles.mobileValue}>{column.render(row)}</View>
                  </View>
                ))}
              {onRowPress ? (
                <View style={styles.mobileChevron}>
                  <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
                </View>
              ) : null}
            </View>
          );
          return onRowPress ? (
            <Pressable
              key={keyExtractor(row)}
              accessibilityRole="button"
              onPress={() => onRowPress(row)}
            >
              {content}
            </Pressable>
          ) : (
            <View key={keyExtractor(row)}>{content}</View>
          );
        })}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.table,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <View style={[styles.header, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.divider }]}>
        {columns.map((column) => (
          <View
            key={column.key}
            style={[styles.cell, { flex: column.width ?? 1, justifyContent: column.align === 'right' ? 'flex-end' : 'flex-start' }]}
          >
            <AppText variant="overline" color="textTertiary">
              {column.label}
            </AppText>
          </View>
        ))}
      </View>

      {rows.map((row, index) => {
        const body = (
          <View
            style={[
              styles.row,
              {
                borderColor: theme.colors.divider,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                backgroundColor: theme.colors.surface,
              },
            ]}
          >
            {columns.map((column) => (
              <View
                key={column.key}
                style={[
                  styles.cell,
                  {
                    flex: column.width ?? 1,
                    alignItems:
                      column.align === 'right' ? 'flex-end' : column.align === 'center' ? 'center' : 'flex-start',
                  },
                ]}
              >
                {column.render(row)}
              </View>
            ))}
          </View>
        );

        return onRowPress ? (
          <Pressable
            key={keyExtractor(row)}
            accessibilityRole="button"
            onPress={() => onRowPress(row)}
            style={({ hovered }) => [hovered ? { backgroundColor: theme.colors.primarySoft } : null]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={keyExtractor(row)}>{body}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 44, gap: 8 },
  table: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  row: { flexDirection: 'row', paddingVertical: 11, paddingHorizontal: 12, gap: 10, alignItems: 'center' },
  cell: { minWidth: 0, justifyContent: 'center' },
  mobileList: { gap: 8 },
  mobileCard: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 7, position: 'relative' },
  mobileRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  mobileLabel: { width: 108 },
  mobileValue: { flex: 1, alignItems: 'flex-start' },
  mobileChevron: { position: 'absolute', right: 10, top: 12 },
});
