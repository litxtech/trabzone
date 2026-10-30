import { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { EarthquakeAnalytics, EarthquakeBin } from '../types';
import { formatDecimal, formatLocalDate, formatLocalDateTime } from '../utils/format';
import { magnitudeColor } from '../utils/scale';

function useWidth(initial = 320) {
  const [width, setWidth] = useState(initial);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };
  return { width, onLayout };
}

function niceMax(value: number): number {
  if (value <= 5) return Math.max(1, Math.ceil(value));
  const pow = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  for (const step of steps) {
    if (value <= step * pow) return step * pow;
  }
  return 10 * pow;
}

function Tooltip({ text }: { text: string | null }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.tooltip, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm }]}>
      <AppText variant="caption" color={text ? 'text' : 'textTertiary'} numberOfLines={2}>
        {text ?? 'Ayrıntı için grafikte bir noktaya dokunun.'}
      </AppText>
    </View>
  );
}

const PAD = { left: 34, right: 8, top: 10, bottom: 24 };

/** A) Zamana göre deprem sayısı. */
export function TimeSeriesChart({
  series,
  bucket,
  height = 180,
}: {
  series: EarthquakeAnalytics['series'];
  bucket: EarthquakeAnalytics['bucket'];
  height?: number;
}) {
  const { theme } = useTheme();
  const { width, onLayout } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(series.reduce((m, s) => Math.max(m, s.count), 0));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const barW = series.length > 0 ? innerW / series.length : innerW;
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));

  const label = (t: string) =>
    bucket === 'hour' ? formatLocalDateTime(t).slice(11, 16) : formatLocalDate(t).slice(0, 5);

  const activeItem = active != null ? series[active] : null;
  return (
    <View onLayout={onLayout} style={styles.chart}>
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((f) => {
          const y = PAD.top + innerH * (1 - f);
          return (
            <G key={f}>
              <Line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={theme.colors.divider} strokeWidth={1} />
              <SvgText x={PAD.left - 6} y={y + 3} fontSize={10} fill={theme.colors.textTertiary} textAnchor="end">
                {String(Math.round(max * f))}
              </SvgText>
            </G>
          );
        })}
        {series.map((item, index) => {
          const h = max > 0 ? (item.count / max) * innerH : 0;
          const x = PAD.left + index * barW;
          return (
            <G key={item.t}>
              <Rect
                x={x + barW * 0.12}
                y={PAD.top + innerH - h}
                width={Math.max(1, barW * 0.76)}
                height={Math.max(item.count > 0 ? 1.5 : 0, h)}
                rx={Math.min(3, barW * 0.3)}
                fill={item.max_magnitude != null ? magnitudeColor(item.max_magnitude) : theme.colors.primary}
                opacity={active == null || active === index ? 1 : 0.45}
              />
              <Rect
                x={x}
                y={PAD.top}
                width={barW}
                height={innerH}
                fill="transparent"
                onPress={() => setActive(index === active ? null : index)}
              />
              {index % labelEvery === 0 ? (
                <SvgText x={x + barW / 2} y={height - 6} fontSize={9} fill={theme.colors.textTertiary} textAnchor="middle">
                  {label(item.t)}
                </SvgText>
              ) : null}
            </G>
          );
        })}
      </Svg>
      <Tooltip
        text={
          activeItem
            ? `${bucket === 'hour' ? formatLocalDateTime(activeItem.t) : formatLocalDate(activeItem.t)}${
                bucket === 'week' ? ' haftası' : ''
              }: ${activeItem.count} deprem${
                activeItem.max_magnitude != null ? ` · en büyük ${formatDecimal(activeItem.max_magnitude, 1)}` : ''
              }`
            : null
        }
      />
    </View>
  );
}

/** B/C) Büyüklük veya derinlik aralıkları. */
export function BinChart({
  bins,
  colorFor,
  unit,
  height = 170,
}: {
  bins: EarthquakeBin[];
  colorFor?: (bin: EarthquakeBin, index: number) => string;
  unit?: string;
  height?: number;
}) {
  const { theme } = useTheme();
  const { width, onLayout } = useWidth();
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  const max = niceMax(bins.reduce((m, b) => Math.max(m, b.count), 0));
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const slot = bins.length > 0 ? innerW / bins.length : innerW;

  return (
    <View onLayout={onLayout} style={styles.chart}>
      <Svg width={width} height={height} accessibilityLabel="Dağılım grafiği">
        <Line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          stroke={theme.colors.divider}
          strokeWidth={1}
        />
        {bins.map((bin, index) => {
          const h = max > 0 ? (bin.count / max) * innerH : 0;
          const x = PAD.left + index * slot;
          return (
            <G key={bin.key}>
              <Rect
                x={x + slot * 0.18}
                y={PAD.top + innerH - h}
                width={slot * 0.64}
                height={Math.max(bin.count > 0 ? 2 : 0, h)}
                rx={4}
                fill={colorFor ? colorFor(bin, index) : theme.colors.primary}
              />
              <SvgText
                x={x + slot / 2}
                y={Math.max(PAD.top + 9, PAD.top + innerH - h - 4)}
                fontSize={10}
                fill={theme.colors.text}
                textAnchor="middle"
              >
                {String(bin.count)}
              </SvgText>
              <SvgText x={x + slot / 2} y={height - 6} fontSize={9} fill={theme.colors.textSecondary} textAnchor="middle">
                {bin.label}
                {unit ? ` ${unit}` : ''}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      <View accessible accessibilityLabel={bins.map((b) => `${b.label}${unit ? ` ${unit}` : ''}: ${b.count}`).join(', ')}>
        <AppText variant="caption" color="textTertiary">
          Toplam {total} kayıt
        </AppText>
      </View>
    </View>
  );
}

type ScatterDatum = { id: string; x: number; y: number; magnitude: number; label: string };

/**
 * D/E) Saçılım grafiği. `yInverted` derinlikte kullanılır (yüzey üstte).
 * Nokta dokunuşu ipucu gösterir; ikinci dokunuş kaydı açar.
 */
export function ScatterChart({
  data,
  xDomain,
  yDomain,
  xLabel,
  yLabel,
  formatX,
  formatY,
  yInverted,
  onOpen,
  height = 220,
}: {
  data: ScatterDatum[];
  xDomain: [number, number];
  yDomain: [number, number];
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  yInverted?: boolean;
  onOpen?: (id: string) => void;
  height?: number;
}) {
  const { theme } = useTheme();
  const { width, onLayout } = useWidth();
  const [active, setActive] = useState<string | null>(null);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const spanX = xDomain[1] - xDomain[0] || 1;
  const spanY = yDomain[1] - yDomain[0] || 1;
  const px = (x: number) => PAD.left + ((x - xDomain[0]) / spanX) * innerW;
  const py = (y: number) => {
    const f = (y - yDomain[0]) / spanY;
    return PAD.top + (yInverted ? f : 1 - f) * innerH;
  };
  const activeItem = active ? data.find((d) => d.id === active) ?? null : null;
  const ticksY = [0, 0.5, 1].map((f) => yDomain[0] + spanY * f);
  const ticksX = [0, 0.5, 1].map((f) => xDomain[0] + spanX * f);

  return (
    <View onLayout={onLayout} style={styles.chart}>
      <Svg width={width} height={height}>
        {ticksY.map((value) => (
          <G key={`y${value}`}>
            <Line x1={PAD.left} x2={width - PAD.right} y1={py(value)} y2={py(value)} stroke={theme.colors.divider} strokeWidth={1} />
            <SvgText x={PAD.left - 6} y={py(value) + 3} fontSize={9} fill={theme.colors.textTertiary} textAnchor="end">
              {formatY(value)}
            </SvgText>
          </G>
        ))}
        {ticksX.map((value, index) => (
          <SvgText
            key={`x${value}`}
            x={px(value)}
            y={height - 6}
            fontSize={9}
            fill={theme.colors.textTertiary}
            textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}
          >
            {formatX(value)}
          </SvgText>
        ))}
        {data.map((d) => (
          <Circle
            key={d.id}
            cx={px(d.x)}
            cy={py(d.y)}
            r={active === d.id ? 6 : Math.max(2.5, Math.min(7, 2 + d.magnitude))}
            fill={magnitudeColor(d.magnitude)}
            fillOpacity={active && active !== d.id ? 0.35 : 0.8}
            stroke={active === d.id ? theme.colors.text : 'none'}
            strokeWidth={1.5}
            onPress={() => {
              if (active === d.id && onOpen) onOpen(d.id);
              else setActive(d.id);
            }}
          />
        ))}
      </Svg>
      <View style={styles.axisNames}>
        <AppText variant="caption" color="textTertiary">
          Dikey: {yLabel}
        </AppText>
        <AppText variant="caption" color="textTertiary">
          Yatay: {xLabel}
        </AppText>
      </View>
      <Tooltip text={activeItem ? `${activeItem.label}${onOpen ? ' — açmak için tekrar dokunun' : ''}` : null} />
    </View>
  );
}

/** F) Bölgesel yoğunluk ızgarası (merkez üssü sayısı). */
export function HeatGrid({
  grid,
  cellDeg,
  center,
  height = 240,
}: {
  grid: EarthquakeAnalytics['grid'];
  cellDeg: number;
  center: { lat: number; lng: number };
  height?: number;
}) {
  const { theme } = useTheme();
  const { width, onLayout } = useWidth();
  const [active, setActive] = useState<number | null>(null);

  const bounds = useMemo(() => {
    if (grid.length === 0) return null;
    let minLat = center.lat;
    let maxLat = center.lat;
    let minLng = center.lng;
    let maxLng = center.lng;
    for (const cell of grid) {
      minLat = Math.min(minLat, cell.lat);
      maxLat = Math.max(maxLat, cell.lat + cellDeg);
      minLng = Math.min(minLng, cell.lng);
      maxLng = Math.max(maxLng, cell.lng + cellDeg);
    }
    return { minLat, maxLat, minLng, maxLng };
  }, [grid, cellDeg, center.lat, center.lng]);

  if (!bounds) return null;
  const pad = 8;
  const kx = Math.cos((((bounds.minLat + bounds.maxLat) / 2) * Math.PI) / 180);
  const spanX = (bounds.maxLng - bounds.minLng) * kx || cellDeg;
  const spanY = bounds.maxLat - bounds.minLat || cellDeg;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const x = (lng: number) => offX + (lng - bounds.minLng) * kx * scale;
  const y = (lat: number) => offY + (bounds.maxLat - lat) * scale;
  const maxCount = grid.reduce((m, c) => Math.max(m, c.count), 1);
  const activeCell = active != null ? grid[active] : null;

  return (
    <View onLayout={onLayout} style={styles.chart}>
      <Svg width={width} height={height} style={{ backgroundColor: theme.colors.surfaceMuted, borderRadius: 12 }}>
        {grid.map((cell, index) => (
          <Rect
            key={`${cell.lat}:${cell.lng}`}
            x={x(cell.lng)}
            y={y(cell.lat + cellDeg)}
            width={Math.max(2, cellDeg * kx * scale - 1)}
            height={Math.max(2, cellDeg * scale - 1)}
            fill={theme.colors.danger}
            fillOpacity={0.15 + 0.8 * Math.sqrt(cell.count / maxCount)}
            stroke={active === index ? theme.colors.text : 'none'}
            strokeWidth={1.5}
            onPress={() => setActive(index === active ? null : index)}
          />
        ))}
        <Circle cx={x(center.lng)} cy={y(center.lat)} r={5} fill={theme.colors.primary} stroke="#FFFFFF" strokeWidth={2} />
        <SvgText x={x(center.lng) + 8} y={y(center.lat) + 4} fontSize={10} fill={theme.colors.text}>
          Trabzon
        </SvgText>
      </Svg>
      <Tooltip
        text={
          activeCell
            ? `${formatDecimal(activeCell.lat, 2)}–${formatDecimal(activeCell.lat + cellDeg, 2)}° K, ${formatDecimal(
                activeCell.lng,
                2,
              )}–${formatDecimal(activeCell.lng + cellDeg, 2)}° D: ${activeCell.count} deprem · en büyük ${formatDecimal(
                activeCell.max_magnitude,
                1,
              )}`
            : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { width: '100%', gap: 6 },
  tooltip: { paddingHorizontal: 10, paddingVertical: 7, minHeight: 30, justifyContent: 'center' },
  axisNames: { flexDirection: 'row', justifyContent: 'space-between' },
});
