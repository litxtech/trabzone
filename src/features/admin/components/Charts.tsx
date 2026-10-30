import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Rect, Stop } from 'react-native-svg';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type Point = { label: string; value: number };

const CHART_HEIGHT = 190;

function compactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(Math.round(value));
}

export function TrendChart({
  data,
  color,
  formatValue = compactNumber,
  height = CHART_HEIGHT,
  showArea = true,
}: {
  data: Point[];
  color?: string;
  formatValue?: (value: number) => string;
  height?: number;
  showArea?: boolean;
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(640);
  const stroke = color ?? theme.colors.primary;
  const gradientId = `grad-${stroke.replace('#', '')}`;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - width) > 1) {
      setWidth(next);
    }
  };

  const PAD_X = 8;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 24;
  const innerW = Math.max(width - PAD_X * 2, 10);
  const innerH = Math.max(height - PAD_TOP - PAD_BOTTOM, 10);
  const max = Math.max(...data.map((point) => point.value), 1);
  const n = data.length;
  const step = n > 1 ? innerW / (n - 1) : 0;

  const coords = data.map((point, index) => ({
    x: PAD_X + index * step,
    y: PAD_TOP + innerH - (point.value / max) * innerH,
    ...point,
  }));

  const linePath = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const areaPath =
    coords.length > 0
      ? `${linePath} L ${coords[coords.length - 1]?.x.toFixed(2)} ${PAD_TOP + innerH} L ${coords[0]?.x.toFixed(2)} ${PAD_TOP + innerH} Z`
      : '';

  // n === 2 iken [0, 0, 1] üretiliyordu: aynı etiket iki kez çizilip
  // "Encountered two children with the same key" uyarısına yol açıyordu.
  const tickIndexes =
    n <= 1 ? [0] : Array.from(new Set([0, Math.floor((n - 1) / 2), n - 1]));
  const gridValues = [0, 0.5, 1];

  if (data.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <AppText variant="caption" color="textTertiary">
          Bu dönem için veri yok.
        </AppText>
      </View>
    );
  }

  return (
    <View onLayout={onLayout} style={{ height }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity={0.28} />
            <Stop offset="1" stopColor={stroke} stopOpacity={0.01} />
          </LinearGradient>
        </Defs>

        {gridValues.map((ratio) => {
          const y = PAD_TOP + innerH - ratio * innerH;
          return (
            <Line
              key={ratio}
              x1={PAD_X}
              x2={width - PAD_X}
              y1={y}
              y2={y}
              stroke={theme.colors.divider}
              strokeWidth={1}
              strokeDasharray="3 5"
            />
          );
        })}

        {showArea && areaPath ? <Path d={areaPath} fill={`url(#${gradientId})`} /> : null}
        <Path d={linePath} fill="none" stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" />
        {coords.length <= 40
          ? coords.map((point, index) => (
              <Circle
                key={`${point.label}-${index}`}
                cx={point.x}
                cy={point.y}
                r={2.2}
                fill={theme.colors.surface}
                stroke={stroke}
                strokeWidth={1.6}
              />
            ))
          : null}
      </Svg>

      <View style={styles.axisRow}>
        {tickIndexes.map((index) => {
          const point = data[index];
          return (
            <AppText key={`${point?.label ?? index}-${index}`} variant="caption" color="textTertiary">
              {point?.label ?? ''}
            </AppText>
          );
        })}
      </View>

      <AppText variant="caption" color="textTertiary" style={styles.maxLabel}>
        maks. {formatValue(max)}
      </AppText>
    </View>
  );
}

export function BarChart({
  data,
  color,
  height = 180,
  formatValue = compactNumber,
}: {
  data: Point[];
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(560);
  const fill = color ?? theme.colors.accent;
  const max = Math.max(...data.map((point) => point.value), 1);
  const PAD_BOTTOM = 20;
  const innerH = height - PAD_BOTTOM - 8;
  const gap = 6;
  const barW =
    data.length > 0 ? Math.max((width - gap * (data.length - 1)) / data.length, 2) : 2;
  const tick = Math.max(Math.ceil(data.length / 8), 1);

  if (data.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <AppText variant="caption" color="textTertiary">
          Bu dönem için veri yok.
        </AppText>
      </View>
    );
  }

  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0 && Math.abs(next - width) > 1) {
          setWidth(next);
        }
      }}
      style={{ height }}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {data.map((point, index) => {
          const h = Math.max((point.value / max) * innerH, point.value > 0 ? 2 : 0);
          return (
            <Rect
              key={`${point.label}-${index}`}
              x={index * (barW + gap)}
              y={8 + innerH - h}
              width={barW}
              height={h}
              rx={Math.min(3, barW / 2)}
              fill={fill}
              opacity={0.85}
            />
          );
        })}
      </Svg>
      <View style={styles.axisRow}>
        {data
          .filter((_, index) => index % tick === 0)
          .slice(0, 8)
          .map((point, index) => (
            <AppText key={`${point.label}-${index}`} variant="caption" color="textTertiary">
              {point.label}
            </AppText>
          ))}
      </View>
      <AppText variant="caption" color="textTertiary" style={styles.maxLabel}>
        maks. {formatValue(max)}
      </AppText>
    </View>
  );
}

export function Distribution({
  data,
  totalLabel = 'toplam',
}: {
  data: { label: string; value: number }[];
  totalLabel?: string;
}) {
  const { theme } = useTheme();
  const palette = [
    theme.colors.primary,
    theme.colors.accent,
    theme.colors.success,
    theme.colors.warning,
    theme.colors.danger,
    theme.colors.info,
    '#8B5CF6',
    '#14B8A6',
  ];
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) {
    return (
      <AppText variant="caption" color="textTertiary">
        Dağılım için veri yok.
      </AppText>
    );
  }

  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={styles.donutRow}>
      <View style={styles.donut}>
        <Svg width={124} height={124} viewBox="0 0 124 124">
          <Circle cx={62} cy={62} r={radius} stroke={theme.colors.surfaceMuted} strokeWidth={16} fill="none" />
          {data.slice(0, 8).map((item, index) => {
            const length = (item.value / total) * circumference;
            const dash = `${Math.max(length - 2, 1)} ${circumference - Math.max(length - 2, 1)}`;
            const offset = data
              .slice(0, index)
              .reduce((sum, entry) => sum + (entry.value / total) * circumference, 0);
            return (
              <Circle
                key={`${item.label}-${index}`}
                cx={62}
                cy={62}
                r={radius}
                stroke={palette[index % palette.length]}
                strokeWidth={16}
                fill="none"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                rotation={-90}
                origin="62, 62"
              />
            );
          })}
        </Svg>
        <View pointerEvents="none" style={styles.donutCenter}>
          <AppText variant="h3">{total > 999 ? `${(total / 1000).toFixed(1)}K` : total}</AppText>
          <AppText variant="caption" color="textTertiary">
            {totalLabel}
          </AppText>
        </View>
      </View>

      <View style={styles.legend}>
        {data.slice(0, 8).map((item, index) => (
          <View key={`${item.label}-${index}`} style={styles.legendRow}>
            <View
              style={[styles.dot, { backgroundColor: palette[index % palette.length] }]}
            />
            <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.legendLabel}>
              {item.label}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {Math.round((item.value / total) * 100)}%
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

export function HorizontalBars({
  data,
  formatValue = compactNumber,
}: {
  data: Point[];
  formatValue?: (value: number) => string;
}) {
  const { theme } = useTheme();
  const max = Math.max(...data.map((point) => point.value), 1);
  if (data.length === 0) {
    return (
      <AppText variant="caption" color="textTertiary">
        Veri yok.
      </AppText>
    );
  }
  return (
    <View style={{ gap: 9 }}>
      {data.map((point, index) => (
        <View key={`${point.label}-${index}`} style={{ gap: 4 }}>
          <View style={styles.hRow}>
            <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
              {point.label}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {formatValue(point.value)}
            </AppText>
          </View>
          <View style={[styles.track, { backgroundColor: theme.colors.surfaceMuted }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.max((point.value / max) * 100, 1)}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -18, paddingHorizontal: 8 },
  maxLabel: { position: 'absolute', top: 2, right: 6, fontSize: 10 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  donut: { width: 124, height: 124, alignItems: 'center', justifyContent: 'center' },
  donutCenter: { position: 'absolute', alignItems: 'center' },
  legend: { flex: 1, minWidth: 190, gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendLabel: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 7, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 999 },
  flex: { flex: 1 },
});
