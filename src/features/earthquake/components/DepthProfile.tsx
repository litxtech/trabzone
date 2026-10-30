import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { formatDecimal } from '../utils/format';
import { magnitudeColor } from '../utils/scale';

const SCALE_STEPS = [10, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700];

/**
 * Yüzeyden odak noktasına şematik kesit. Ölçek derinliğe göre seçilir;
 * çizim yer kabuğu katmanlarını temsil etmez, yalnızca derinliği gösterir.
 */
export function DepthProfile({ depthKm, magnitude }: { depthKm: number | null; magnitude: number }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(320);
  const height = 170;

  if (depthKm == null) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md }]}>
        <AppText variant="bodyStrong">Odak derinliği bildirilmedi</AppText>
        <AppText variant="caption" color="textSecondary" align="center">
          Kaynak bu kayıt için derinlik değeri yayımlamadı. Değer tahmin edilmez.
        </AppText>
      </View>
    );
  }

  const max = SCALE_STEPS.find((step) => depthKm <= step * 0.85) ?? Math.ceil((depthKm * 1.2) / 100) * 100;
  const top = 26;
  const bottom = height - 14;
  const left = 46;
  const right = width - 12;
  const y = (km: number) => top + (Math.min(Math.max(km, 0), max) / max) * (bottom - top);
  const ticks = [0, max / 2, max];
  const focusX = left + (right - left) * 0.55;
  const label = `Odak derinliği: ${formatDecimal(depthKm, 1)} km`;

  return (
    <View
      accessible
      accessibilityLabel={`${label}. Ölçek 0 ile ${max} kilometre arası.`}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width);
        if (next > 0 && next !== width) setWidth(next);
      }}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="crust" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.scheme === 'dark' ? '#3A2F25' : '#E9DCC8'} />
            <Stop offset="1" stopColor={theme.scheme === 'dark' ? '#1E1712' : '#B89B78'} />
          </LinearGradient>
        </Defs>
        <Rect x={left} y={top} width={right - left} height={bottom - top} fill="url(#crust)" rx={8} />
        <Line x1={left} x2={right} y1={top} y2={top} stroke={theme.colors.success} strokeWidth={3} />
        <SvgText x={left + 6} y={top - 8} fontSize={10} fill={theme.colors.textSecondary}>
          Yüzey
        </SvgText>
        {ticks.map((tick) => (
          <SvgText key={tick} x={left - 6} y={y(tick) + 3} fontSize={10} fill={theme.colors.textTertiary} textAnchor="end">
            {`${formatDecimal(tick, 0)} km`}
          </SvgText>
        ))}
        <Line
          x1={focusX}
          x2={focusX}
          y1={top}
          y2={y(depthKm)}
          stroke={theme.colors.text}
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
        <Circle cx={focusX} cy={y(depthKm)} r={14} fill={magnitudeColor(magnitude)} fillOpacity={0.25} />
        <Circle cx={focusX} cy={y(depthKm)} r={6} fill={magnitudeColor(magnitude)} stroke="#FFFFFF" strokeWidth={2} />
        <SvgText
          x={focusX + (focusX > width * 0.6 ? -18 : 18)}
          y={y(depthKm) + 4}
          fontSize={12}
          fontWeight="700"
          fill={theme.colors.text}
          textAnchor={focusX > width * 0.6 ? 'end' : 'start'}
        >
          {`${formatDecimal(depthKm, 1)} km`}
        </SvgText>
      </Svg>
      <AppText variant="bodyStrong">{label}</AppText>
      <AppText variant="caption" color="textTertiary">
        Şematik kesittir; yer altı katmanlarını göstermez.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { padding: 16, gap: 4, alignItems: 'center' },
});
