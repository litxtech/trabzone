import { Image } from 'expo-image';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { fontFamilies } from '@/theme/typography';

import { AppText } from './AppText';

// Web'de logo en fazla ~44 pt çizilir; 512 px'lik PNG (~300 KB) yerine
// 192 px WebP (~7 KB) yüklenir.
const LOGO_SOURCE =
  Platform.OS === 'web'
    ? require('../../../assets/brand/splash/logo-web.webp')
    : require('../../../assets/brand/splash/splash-logo.png');

export function Logo({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={LOGO_SOURCE}
      style={{ width: size, height: size, borderRadius: size * 0.2237 }}
      contentFit="cover"
      transition={0}
      accessibilityLabel="Trabzone"
    />
  );
}

const WORDMARK = 'TRABZONE';
/** "TRABZONE" icindeki Z harfi marka vurgusu olarak farkli renkte cizilir. */
const DEFAULT_ACCENT_INDEX = 4;
/** Modern marka yazisi icin sikistik ve dengeli harf araligi (em). */
const DEFAULT_TRACKING = 0.085;

type WordmarkProps = {
  /** Ana harf rengi. */
  color?: string;
  /** Vurgu harfinin rengi; verilmezse temanin parlak aksani kullanilir. */
  accentColor?: string;
  size?: number;
  /** Farkli renge boyanacak harfin indeksi (varsayilan: Z). */
  accentIndex?: number;
  /** Harf araligi carpani (em). */
  tracking?: number;
  showTagline?: boolean;
  /**
   * Harfleri soldan saga marka gradyaniyla boyar (mavi -> mor).
   * Verildiginde `color` / `accentColor` yok sayilir.
   */
  gradient?: boolean;
  /** Gradyan duraklari; verilmezse temanin birincil + aksan rengi kullanilir. */
  gradientColors?: readonly string[];
};

type Rgb = { r: number; g: number; b: number };

function parseRgb(hex: string): Rgb {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

function toHex({ r, g, b }: Rgb) {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** 0..1 arasindaki konumun rengini duraklar arasinda dogrusal karistirir. */
function sampleGradient(stops: readonly string[], position: number) {
  if (stops.length === 0) return '#4169F5';
  if (stops.length === 1) return stops[0] ?? '#4169F5';

  const clamped = Math.min(1, Math.max(0, position));
  const scaled = clamped * (stops.length - 1);
  const lower = Math.min(stops.length - 2, Math.floor(scaled));
  const from = parseRgb(stops[lower] ?? '#4169F5');
  const to = parseRgb(stops[lower + 1] ?? stops[stops.length - 1] ?? '#8057F4');
  const t = scaled - lower;

  return toHex({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  });
}

/**
 * Trabzone marka yazisi.
 *
 * Tek bir harf marka aksaniyla renklendirilir; boylece logo + isim birlikte
 * kullanildiginda bile kimlik korunur. `gradient` verildiginde harfler soldan
 * saga marka gradyaniyla boyanir. Izgara (tracking) modern markalarda oldugu
 * gibi sikidir ve son harfin biraktigi bosluk optik olarak telafi edilir, aksi
 * halde yazi kapsayicisinda sola kaymis gorunur.
 */
export function Wordmark({
  color,
  accentColor,
  size = 22,
  accentIndex = DEFAULT_ACCENT_INDEX,
  tracking = DEFAULT_TRACKING,
  showTagline = false,
  gradient = false,
  gradientColors,
}: WordmarkProps) {
  const { theme, scheme } = useTheme();

  const baseColor = color ?? theme.colors.text;
  const accent = accentColor ?? theme.colors.accentBright;
  // Koyu zeminde gradyanin ucu daha parlak olmali, yoksa marka yazisi sonuk kalir.
  const stops =
    gradientColors ??
    (scheme === 'dark'
      ? [theme.colors.primaryDeep, theme.colors.accentBright]
      : [theme.colors.primary, theme.colors.accent]);
  const letterSpacing = size * tracking;

  const index = Math.min(Math.max(accentIndex, 0), WORDMARK.length - 1);
  const before = WORDMARK.slice(0, index);
  const after = WORDMARK.slice(index + 1);

  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="image"
        accessibilityLabel="Trabzone"
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.word,
          {
            color: baseColor,
            fontSize: size,
            lineHeight: size * 1.16,
            letterSpacing,
            // Son harften sonra da harf araligi eklenir; optik ortalama icin kirp.
            marginRight: -letterSpacing,
          },
        ]}
      >
        {gradient ? (
          // Her harf gradyan uzerindeki kendi noktasindan renk alir; native ve
          // web'de ayni sonucu verir, ek bir maske kutuphanesi gerektirmez.
          WORDMARK.split('').map((letter, position) => (
            <Text
              // Harfler sabit; indeks anahtar olarak guvenli.
              key={`${letter}-${position}`}
              style={[
                styles.accent,
                {
                  color: sampleGradient(
                    stops,
                    WORDMARK.length > 1 ? position / (WORDMARK.length - 1) : 0,
                  ),
                },
              ]}
            >
              {letter}
            </Text>
          ))
        ) : (
          <>
            {before}
            <Text style={[styles.accent, { color: accent }]}>{WORDMARK[index]}</Text>
            {after}
          </>
        )}
      </Text>
      {showTagline ? (
        <AppText variant="caption" color={color ?? theme.colors.textSecondary} align="center">
          Trabzon&apos;un dijital buluşma noktası
        </AppText>
      ) : null}
    </View>
  );
}

type BrandWordmarkProps = {
  /** Yazinin punto boyutu (dp). */
  size?: number;
  /** Ana harf rengi; verilmezse tema metin rengi kullanilir. */
  color?: string;
  /** Sondaki marka noktasinin rengi; verilmezse premium mavi kullanilir. */
  accentColor?: string;
};

/**
 * Ana akis icin kompakt marka yazisi: "trabzone."
 *
 * Buyuk logo yerine kullanilan bu surum, ayni marka kimligini (Sora Bold ve
 * mavi vurgu) korurken basligi tek satirda tutar. Sondaki nokta marka
 * vurgusudur; boylece ek bir ikon olmadan yazi kendi basina kimlik tasir.
 */
export function BrandWordmark({ size = 21, color, accentColor }: BrandWordmarkProps) {
  const { theme } = useTheme();
  const baseColor = color ?? theme.colors.text;
  const accent = accentColor ?? theme.colors.primary;
  // Kucuk puntoda normal harf araligi dagilmis gorunur; optik olarak sikilastir.
  const letterSpacing = size * -0.012;

  return (
    <Text
      accessibilityRole="image"
      accessibilityLabel="Trabzone"
      allowFontScaling={false}
      numberOfLines={1}
      style={[
        styles.brandWord,
        {
          color: baseColor,
          fontSize: size,
          lineHeight: size * 1.16,
          letterSpacing,
          // Son harften sonra eklenen araligi kirp; yazi sola kaymis gorunmesin.
          marginRight: -letterSpacing,
        },
      ]}
    >
      trabzone
      <Text style={[styles.brandDot, { color: accent }]}>.</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 6,
  },
  word: {
    fontFamily: fontFamilies.displayBold,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  brandWord: {
    fontFamily: fontFamilies.displayBold,
    includeFontPadding: false,
  },
  brandDot: {
    fontFamily: fontFamilies.displayBold,
  },
  // Marka harfi: ayni agirlikta kalir; yalnizca rengi degisir.
  accent: {
    fontFamily: fontFamilies.displayBold,
  },
});
