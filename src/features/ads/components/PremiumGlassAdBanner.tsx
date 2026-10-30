import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';

import { AppImage } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { fontFamilies } from '@/theme/typography';

export type PremiumGlassAdBannerProps = {
  title: string;
  description?: string | null;
  ctaLabel?: string | null;
  businessName?: string | null;
  imageUrl?: string | null;
  imageFocus?: 'left' | 'center' | 'right';
  onPress?: () => void;
  onMenu?: () => void;
  /** Önizleme için sabit genişlik (ör. admin cihaz önizlemesi). */
  width?: number;
  /** Önizlemede metin güvenli alanını gösterir. */
  showSafeArea?: boolean;
  style?: ViewStyle;
};

const RADIUS = 20;
/** Telefonda biraz daha yüksek, geniş ekranda panoramik oran. */
export function adBannerRatio(width: number): number {
  return width < 520 ? 2.7 : 3.2;
}

/**
 * Trabzone Glass Banner.
 *
 * Görsel solda karartılır, başlık ve açıklama bu koyu alanda okunur kalır.
 * Cam etkisi tüm reklama blur uygulanarak değil; yarı saydam katmanlar,
 * ince iç kenar ve yumuşak kenar geçişiyle oluşturulur. Dış kenar çizgisi
 * her zaman görünür: kenar saydamlığı reklamın gerçek sınırını gizlemez.
 * "Reklam" etiketi her koşulda görünür ve reklam organik içerik gibi
 * gösterilmez.
 */
export const PremiumGlassAdBanner = forwardRef<ComponentRef<typeof View>, PremiumGlassAdBannerProps>(
  function PremiumGlassAdBanner(
    {
      title,
      description,
      ctaLabel,
      businessName,
      imageUrl,
      imageFocus = 'center',
      onPress,
      onMenu,
      width,
      showSafeArea = false,
      style,
    },
    ref,
  ) {
    const { theme, scheme } = useTheme();
    const window = useWindowDimensions();
    const [failed, setFailed] = useState(false);
    const ratio = adBannerRatio(width ?? Math.min(window.width, 680));
    const wide = (width ?? window.width) >= 520;
    const edgeFade = scheme === 'dark' ? 'rgba(8, 12, 22, 0.42)' : 'rgba(255, 255, 255, 0.26)';
    const label = ctaLabel?.trim() || 'İncele';

    return (
      <View
        ref={ref}
        collapsable={false}
        style={[
          styles.shadowWrap,
          theme.shadows.card,
          { backgroundColor: theme.colors.surfaceInverse },
          width ? { width } : null,
          style,
        ]}
      >
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Reklam: ${title}${businessName ? `, ${businessName}` : ''}`}
          accessibilityHint={`${label} için dokunun`}
          disabled={!onPress}
          onPress={onPress}
          style={({ pressed }) => [
            styles.frame,
            {
              aspectRatio: ratio,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceInverse,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            },
          ]}
        >
          {imageUrl && !failed ? (
            <AppImage
              source={{ uri: imageUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              contentPosition={imageFocus}
              recycleKey={imageUrl}
              onError={() => setFailed(true)}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <LinearGradient
              colors={theme.gradients.primary as unknown as [string, string, ...string[]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          )}

          <LinearGradient
            pointerEvents="none"
            colors={['rgba(6, 10, 20, 0.88)', 'rgba(6, 10, 20, 0.6)', 'rgba(6, 10, 20, 0.06)']}
            locations={[0, 0.48, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(6, 10, 20, 0)', 'rgba(6, 10, 20, 0.42)']}
            locations={[0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255, 255, 255, 0)', edgeFade]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.edgeRight}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[edgeFade, 'rgba(255, 255, 255, 0)']}
            style={styles.edgeTop}
          />
          <View pointerEvents="none" style={styles.innerBorder} />

          {showSafeArea ? <View pointerEvents="none" style={styles.safeArea} /> : null}

          <View style={[styles.content, wide && styles.contentWide]}>
            <View style={styles.left}>
              <View style={styles.adLabel}>
                <Text style={styles.adLabelText}>Reklam</Text>
              </View>
              <View style={styles.texts}>
                <Text
                  numberOfLines={2}
                  style={[styles.title, wide && styles.titleWide]}
                  maxFontSizeMultiplier={1.3}
                >
                  {title}
                </Text>
                {description ? (
                  <Text numberOfLines={wide ? 2 : 1} style={styles.description} maxFontSizeMultiplier={1.3}>
                    {description}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.right}>
              {onMenu ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reklam seçenekleri"
                  hitSlop={8}
                  onPress={onMenu}
                  style={({ pressed }) => [styles.menu, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Ionicons name="ellipsis-horizontal" size={15} color="#FFFFFF" />
                </Pressable>
              ) : (
                <View style={styles.menuSpacer} />
              )}
              <View style={styles.ctaColumn}>
                {businessName ? (
                  <Text numberOfLines={1} style={styles.business} maxFontSizeMultiplier={1.2}>
                    {businessName}
                  </Text>
                ) : null}
                <View style={styles.cta}>
                  <Text numberOfLines={1} style={styles.ctaText} maxFontSizeMultiplier={1.2}>
                    {label}
                  </Text>
                  <Ionicons name="arrow-forward" size={13} color="#0B1220" />
                </View>
              </View>
            </View>
          </View>
        </Pressable>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  shadowWrap: { borderRadius: RADIUS },
  frame: {
    width: '100%',
    borderRadius: RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  edgeRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '12%' },
  edgeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '22%' },
  innerBorder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  safeArea: {
    position: 'absolute',
    top: 10,
    bottom: 10,
    left: 12,
    width: '62%',
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 214, 102, 0.9)',
  },
  content: { flex: 1, flexDirection: 'row', padding: 12, gap: 10 },
  contentWide: { padding: 16, gap: 14 },
  left: { flex: 1, justifyContent: 'space-between', minWidth: 0 },
  adLabel: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  adLabelText: {
    fontFamily: fontFamilies.bold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.3,
    color: '#0B1220',
  },
  texts: { gap: 2 },
  title: {
    fontFamily: fontFamilies.displayBold,
    fontSize: 15,
    lineHeight: 19,
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  titleWide: { fontSize: 18, lineHeight: 23 },
  description: {
    fontFamily: fontFamilies.medium,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.84)',
  },
  right: { maxWidth: '40%', alignItems: 'flex-end', justifyContent: 'space-between' },
  menu: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 10, 20, 0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  menuSpacer: { height: 26 },
  ctaColumn: { alignItems: 'flex-end', gap: 5, maxWidth: '100%' },
  business: {
    fontFamily: fontFamilies.semibold,
    fontSize: 11,
    lineHeight: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowRadius: 4,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    maxWidth: '100%',
  },
  ctaText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
    lineHeight: 15,
    color: '#0B1220',
    flexShrink: 1,
  },
});
