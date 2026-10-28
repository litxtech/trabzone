import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * Auth ekranlarinin ortak arka plani. Tum katmanlar statiktir; kaydirma veya
 * giris sirasinda yeniden cizilmez, JS thread'ini mesgul etmez.
 */
export function AuthBackdrop() {
  const { width, height } = useWindowDimensions();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={['#0A1124', '#070C18', '#04060D']}
        locations={[0, 0.54, 1]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="tzBlueGlow" cx={width * 0.18} cy={height * 0.04} r={width * 0.82}>
            <Stop offset="0" stopColor="#2E63FF" stopOpacity={0.55} />
            <Stop offset="0.5" stopColor="#163B9E" stopOpacity={0.2} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="tzPurpleGlow" cx={width * 0.96} cy={height * 0.36} r={width * 0.7}>
            <Stop offset="0" stopColor="#8A5CFF" stopOpacity={0.34} />
            <Stop offset="0.55" stopColor="#472A9F" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="tzCyanGlow" cx={width * 0.32} cy={height * 0.94} r={width * 0.68}>
            <Stop offset="0" stopColor="#22D3EE" stopOpacity={0.13} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#tzBlueGlow)" />
        <Rect width={width} height={height} fill="url(#tzPurpleGlow)" />
        <Rect width={width} height={height} fill="url(#tzCyanGlow)" />
      </Svg>

      <View style={styles.hairlineTop} />
      <View style={styles.hairlineBottom} />
    </View>
  );
}

const styles = StyleSheet.create({
  hairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  hairlineBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
});
