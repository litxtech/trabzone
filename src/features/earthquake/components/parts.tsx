import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { EarthquakeEvent, EarthquakeStatus } from '../types';
import {
  formatAgo,
  formatDepth,
  formatLocalDateTime,
  formatMagnitude,
  formatDecimal,
  placeLabel,
  SOURCE_LABELS,
} from '../utils/format';
import { MAGNITUDE_STEPS, magnitudeColor, magnitudeTextColor } from '../utils/scale';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function MagnitudeBadge({
  magnitude,
  type,
  size = 'md',
}: {
  magnitude: number;
  type?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dimension = size === 'lg' ? 72 : size === 'sm' ? 40 : 52;
  return (
    <View
      accessible
      accessibilityLabel={`Büyüklük ${formatMagnitude(magnitude, type)}`}
      style={[
        styles.magBadge,
        { width: dimension, height: dimension, borderRadius: size === 'lg' ? 20 : 14, backgroundColor: magnitudeColor(magnitude) },
      ]}
    >
      <AppText
        variant={size === 'lg' ? 'h2' : 'title'}
        color={magnitudeTextColor(magnitude)}
        style={size === 'sm' ? styles.magSmall : null}
      >
        {formatDecimal(magnitude, 1)}
      </AppText>
      {type ? (
        <AppText variant="caption" color={magnitudeTextColor(magnitude)} style={styles.magType}>
          {type}
        </AppText>
      ) : null}
    </View>
  );
}

const STATE_META: Record<EarthquakeStatus['state'], { label: string; icon: IconName; tone: 'success' | 'warning' | 'danger' }> = {
  live: { label: 'Güncel', icon: 'checkmark-circle', tone: 'success' },
  fallback: { label: 'Yedek kaynak', icon: 'swap-horizontal', tone: 'warning' },
  delayed: { label: 'Gecikmeli', icon: 'time', tone: 'warning' },
  unavailable: { label: 'Veri alınamıyor', icon: 'cloud-offline', tone: 'danger' },
};

/**
 * Veri durumu. "Güncel" yalnızca birincil kaynak son okuma eşiği içinde
 * başarıyla okunduysa gösterilir; aksi halde gecikme açıkça yazılır.
 */
export function DataStatusBar({ status, error }: { status: EarthquakeStatus | null | undefined; error?: boolean }) {
  const { theme } = useTheme();
  if (!status) {
    return (
      <View style={[styles.statusBar, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md }]}>
        <Ionicons name={error ? 'cloud-offline' : 'sync'} size={16} color={theme.colors.textSecondary} />
        <AppText variant="caption" color="textSecondary">
          {error ? 'Veri durumu alınamadı. Bağlantınızı kontrol edin.' : 'Veri durumu kontrol ediliyor…'}
        </AppText>
      </View>
    );
  }
  const meta = STATE_META[status.state];
  const color = theme.colors[meta.tone];
  const soft = theme.colors[`${meta.tone}Soft` as 'successSoft' | 'warningSoft' | 'dangerSoft'];
  const primary = status.primary_source ? SOURCE_LABELS[status.primary_source] : 'AFAD';
  let detail: string;
  if (status.state === 'live') {
    detail = `${primary} verisi · son okuma ${formatAgo(status.primary_last_success_at)}`;
  } else if (status.state === 'fallback') {
    detail = `${primary} şu anda okunamıyor; yedek kaynak (USGS) gösteriliyor. Son ${primary} okuması: ${formatAgo(status.primary_last_success_at)}`;
  } else if (status.state === 'delayed') {
    detail = `Son başarılı okuma ${formatAgo(status.last_success_at)}. Yeni kayıtlar gecikebilir.`;
  } else {
    detail = status.last_success_at
      ? `Kaynaklara şu anda ulaşılamıyor. Son başarılı okuma ${formatAgo(status.last_success_at)}.`
      : 'Kaynaklara şu anda ulaşılamıyor.';
  }
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Veri durumu: ${meta.label}. ${detail}`}
      style={[styles.statusBar, { backgroundColor: soft, borderColor: `${color}33`, borderRadius: theme.radius.lg }]}
    >
      <View style={[styles.statusIcon, { backgroundColor: `${color}22` }]}>
        <Ionicons name={meta.icon} size={15} color={color} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" color={color}>
          {meta.label}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {detail}
        </AppText>
      </View>
    </View>
  );
}

export function SummaryCard({
  label,
  value,
  hint,
  icon,
  onPress,
  muted,
}: {
  label: string;
  value: string;
  hint?: string | null;
  icon: IconName;
  onPress?: () => void;
  muted?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.summaryCard,
        theme.shadows.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={styles.summaryHead}>
        <View style={[styles.summaryIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name={icon} size={15} color={theme.colors.primary} />
        </View>
        <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
          {label}
        </AppText>
        {onPress ? <Ionicons name="arrow-forward" size={14} color={theme.colors.textTertiary} /> : null}
      </View>
      <AppText variant="h2" color={muted ? 'textTertiary' : 'text'} numberOfLines={1}>
        {value}
      </AppText>
      {hint ? (
        <AppText variant="caption" color="textTertiary" numberOfLines={2}>
          {hint}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export function EarthquakeRow({
  event,
  onPress,
  onLocate,
  selected,
}: {
  event: EarthquakeEvent;
  onPress: () => void;
  onLocate?: () => void;
  selected?: boolean;
}) {
  const { theme } = useTheme();
  const place = placeLabel(event);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatMagnitude(event.magnitude, event.magnitude_type)} büyüklüğünde deprem, ${place}, ${formatLocalDateTime(event.occurred_at)}, derinlik ${formatDepth(event.depth_km)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        theme.shadows.xs,
        {
          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          borderRadius: theme.radius.lg,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.rowAccent, { backgroundColor: magnitudeColor(event.magnitude) }]} />
      <MagnitudeBadge magnitude={event.magnitude} type={event.magnitude_type} size="sm" />
      <View style={styles.rowBody}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {place}
        </AppText>
        {event.location && place !== event.location ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            {event.location}
          </AppText>
        ) : null}
        <View style={styles.rowMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={12} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {formatAgo(event.occurred_at)}
            </AppText>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="layers-outline" size={12} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {formatDepth(event.depth_km)}
            </AppText>
          </View>
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
            {formatLocalDateTime(event.occurred_at, true)}
            {event.source === 'usgs' && !event.sources.includes('afad') ? ' · USGS' : ''}
          </AppText>
        </View>
      </View>
      {onLocate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Haritada göster"
          hitSlop={10}
          onPress={onLocate}
          style={({ pressed }) => [
            styles.locate,
            { backgroundColor: theme.colors.surfaceMuted, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="locate-outline" size={17} color={theme.colors.primary} />
        </Pressable>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
      )}
    </Pressable>
  );
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const { theme } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={label}
      contentContainerStyle={styles.chips}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [
              styles.chip,
              active ? theme.shadows.button : null,
              {
                backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted,
                borderColor: active ? theme.colors.primary : 'transparent',
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <AppText variant="label" color={active ? theme.colors.onPrimary : 'textSecondary'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <View style={[styles.sectionBar, { backgroundColor: theme.colors.primary }]} />
      <AppText variant="h3" accessibilityRole="header" style={styles.flex}>
        {title}
      </AppText>
      {action}
    </View>
  );
}

export function ScaleLegend() {
  const { theme } = useTheme();
  return (
    <View accessible accessibilityLabel="Renk ölçeği deprem büyüklüğünü gösterir" style={styles.legend}>
      {MAGNITUDE_STEPS.map((step) => (
        <View key={step.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: step.color }]} />
          <AppText variant="caption" color="textSecondary">
            {step.label}
          </AppText>
        </View>
      ))}
      <AppText variant="caption" color="textTertiary" style={{ color: theme.colors.textTertiary }}>
        Renk büyüklüğü gösterir; şiddet veya hasar değildir.
      </AppText>
    </View>
  );
}

export function InfoNote({ icon = 'information-circle-outline', children }: { icon?: IconName; children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md }]}>
      <Ionicons name={icon} size={16} color={theme.colors.textSecondary} />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {children}
      </AppText>
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={28} color={theme.colors.textTertiary} />
      <AppText variant="bodyStrong" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="caption" color="textSecondary" align="center">
          {body}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

/** Basit alt sayfa: filtre ve kaynak bilgisi için. */
export function BottomSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.sheetHead}>
            <AppText variant="h3" accessibilityRole="header" style={styles.flex}>
              {title}
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Kapat" hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  magBadge: { alignItems: 'center', justifyContent: 'center' },
  magSmall: { fontSize: 16, lineHeight: 19 },
  magType: { fontSize: 9, lineHeight: 11, marginTop: -2 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  statusIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { flexBasis: '47%', flexGrow: 1, minWidth: 140, padding: 14, gap: 6, borderWidth: StyleSheet.hairlineWidth },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowAccent: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  rowBody: { flex: 1, gap: 3 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  locate: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 8, paddingVertical: 4, paddingHorizontal: 2 },
  chip: { minHeight: 36, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, justifyContent: 'center' },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  sectionBar: { width: 4, height: 20, borderRadius: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  note: { flexDirection: 'row', gap: 8, padding: 10, alignItems: 'flex-start' },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 28, paddingHorizontal: 16 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '86%', paddingTop: 16 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
  sheetBody: { paddingHorizontal: 20, paddingTop: 4, gap: 14 },
});
