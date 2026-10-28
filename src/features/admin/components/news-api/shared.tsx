import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type {
  NewsHealth,
  NewsItemStatus,
  NewsLicenseStatus,
  NewsPublishMode,
  NewsStatus,
} from '@/features/news-api/types';

export const CONNECTOR_LABELS: Record<string, string> = {
  rss: 'RSS 2.0',
  atom: 'Atom',
  xml: 'XML Feed',
  json_feed: 'JSON Feed',
  rest_json: 'REST JSON API',
  custom_api: 'Özel API',
};

export const STATUS_LABELS: Record<NewsStatus, string> = {
  draft: 'Taslak',
  active: 'Açık',
  paused: 'Duraklatıldı',
  disabled: 'Kapalı',
  deleting: 'Siliniyor',
};

const STATUS_TONES: Record<NewsStatus, 'success' | 'neutral' | 'warning' | 'danger' | 'accent'> = {
  draft: 'neutral',
  active: 'success',
  paused: 'warning',
  disabled: 'neutral',
  deleting: 'danger',
};

export const HEALTH_LABELS: Record<NewsHealth, string> = {
  unknown: 'Bilinmiyor',
  ok: 'Sağlıklı',
  warning: 'Uyarı',
  error: 'Hata',
};

export const LICENSE_LABELS: Record<NewsLicenseStatus, string> = {
  unverified: 'Doğrulanmadı',
  permitted: 'Yayın izni var',
  restricted: 'Kısıtlı kullanım',
  prohibited: 'Yayın izni yok',
};

export const MODE_LABELS: Record<NewsPublishMode, string> = {
  discovery: 'Yalnızca keşif',
  source_profile: 'Kaynak profilinde tam metin',
  trabzone_digest: 'Trabzone Haber derlemesi',
  editor_approval: 'Editör onaylı yayın',
};

export const ITEM_STATUS_LABELS: Record<NewsItemStatus, string> = {
  new: 'Yeni',
  pending_review: 'İnceleme bekliyor',
  drafted: 'Taslak',
  published: 'Yayında',
  duplicate: 'Tekrar',
  blocked: 'Engellendi',
  rejected: 'Reddedildi',
  removed: 'Kaldırıldı',
};

const ITEM_TONES: Record<NewsItemStatus, 'success' | 'neutral' | 'warning' | 'danger' | 'accent'> = {
  new: 'accent',
  pending_review: 'warning',
  drafted: 'neutral',
  published: 'success',
  duplicate: 'neutral',
  blocked: 'danger',
  rejected: 'danger',
  removed: 'neutral',
};

export function StatusBadge({ status }: { status: NewsStatus }) {
  return <Badge label={STATUS_LABELS[status] ?? status} tone={STATUS_TONES[status] ?? 'neutral'} />;
}

export function HealthBadge({ health }: { health: NewsHealth }) {
  const tone = health === 'ok' ? 'success' : health === 'error' ? 'danger' : health === 'warning' ? 'warning' : 'neutral';
  return <Badge label={HEALTH_LABELS[health] ?? health} tone={tone} />;
}

export function LicenseBadge({ status }: { status: NewsLicenseStatus }) {
  const tone =
    status === 'permitted' ? 'success' : status === 'restricted' ? 'warning' : status === 'prohibited' ? 'danger' : 'neutral';
  return <Badge label={LICENSE_LABELS[status] ?? status} tone={tone} />;
}

export function ItemStatusBadge({ status }: { status: NewsItemStatus }) {
  return <Badge label={ITEM_STATUS_LABELS[status] ?? status} tone={ITEM_TONES[status] ?? 'neutral'} />;
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[newsApiStyles.infoRow, { borderColor: theme.colors.divider }]}>
      <AppText variant="caption" color="textTertiary" style={newsApiStyles.infoLabel}>
        {label}
      </AppText>
      <View style={newsApiStyles.infoValue}>
        {typeof value === 'string' || typeof value === 'number' ? (
          <AppText variant="caption" color="textSecondary">
            {String(value)}
          </AppText>
        ) : (
          value
        )}
      </View>
    </View>
  );
}

export function FormRow({ children }: { children: ReactNode }) {
  return <View style={newsApiStyles.formRow}>{children}</View>;
}

export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
  multiple = false,
  values = [],
  onToggle,
}: {
  options: { value: T; label: string }[];
  value?: T;
  onChange?: (value: T) => void;
  multiple?: boolean;
  values?: T[];
  onToggle?: (value: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={newsApiStyles.chips}>
      {options.map((option) => {
        const active = multiple ? values.includes(option.value) : value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => (multiple ? onToggle?.(option.value) : onChange?.(option.value))}
            style={[
              newsApiStyles.chip,
              {
                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                borderColor: active ? theme.colors.primary : theme.colors.border,
              },
            ]}
          >
            <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={newsApiStyles.toggleRow}>
      <View style={newsApiStyles.toggleText}>
        <AppText variant="label">{title}</AppText>
        {description ? (
          <AppText variant="caption" color="textTertiary">
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
        thumbColor={theme.colors.surface}
      />
    </View>
  );
}

export function EmptyHint({ text, icon = 'information-circle-outline' }: { text: string; icon?: ComponentProps<typeof Ionicons>['name'] }) {
  const { theme } = useTheme();
  return (
    <View style={[newsApiStyles.empty, { borderColor: theme.colors.border }]}>
      <Ionicons name={icon} size={18} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textTertiary" style={newsApiStyles.flex}>
        {text}
      </AppText>
    </View>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <AppText variant="caption" color="danger">
      {text}
    </AppText>
  );
}

export const newsApiStyles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 12 },
  gapSm: { gap: 8 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  infoLabel: { width: 148 },
  infoValue: { flex: 1, alignItems: 'flex-start' },
  formRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleText: { flex: 1, gap: 2 },
  empty: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statBox: {
    minWidth: 120,
    flexGrow: 1,
    flexBasis: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 3,
  },
  tableRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  mono: { fontFamily: 'monospace' },
});

export function StatBox({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  const { theme } = useTheme();
  return (
    <View style={[newsApiStyles.statBox, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
      <AppText variant="title">{typeof value === 'number' ? new Intl.NumberFormat('tr-TR').format(value) : value}</AppText>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      {hint ? (
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

