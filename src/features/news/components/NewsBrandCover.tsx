import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { AppText, Logo, Wordmark } from '@/components/ui';

/**
 * `@trabzonehaber` kurumsal profil kapağı.
 *
 * Harici haber kuruluşu görselleri kullanılmaz; yalnızca Trabzone'nun kendi
 * marka renkleri, logosu ve tipografisiyle üretilen özgün bir kompozisyondur.
 */
export function NewsBrandCover({ height = 168 }: { height?: number }) {
  return (
    <View style={[styles.wrap, { height }]}>
      <LinearGradient
        colors={['#081536', '#17339C', '#5B3FD6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.orbit, styles.orbitLarge]} />
      <View style={[styles.orbit, styles.orbitSmall]} />
      <View style={styles.gridLine} />

      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <Logo size={26} />
          </View>
          <Wordmark color="#FFFFFF" accentColor="#9CC0FF" size={16} />
          <View style={styles.divider} />
          <AppText variant="overline" color="rgba(255,255,255,0.78)">
            HABER MERKEZİ
          </AppText>
        </View>

        <AppText variant="display" color="#FFFFFF" style={styles.headline}>
          Trabzon’un gündemi,{'\n'}doğrulanmış kaynaklardan.
        </AppText>

        <View style={styles.metaRow}>
          <View style={styles.live}>
            <View style={styles.liveDot} />
            <AppText variant="caption" color="#FFFFFF">
              CANLI GÜNDEM
            </AppText>
          </View>
          <AppText variant="caption" color="rgba(255,255,255,0.72)">
            TRABZON · 18 İLÇE
          </AppText>
        </View>
      </View>

      <View style={styles.icon}>
        <Ionicons name="newspaper-outline" size={16} color="rgba(255,255,255,0.9)" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 26, overflow: 'hidden', justifyContent: 'flex-end' },
  content: { paddingHorizontal: 18, paddingBottom: 16, gap: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logoBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { width: StyleSheet.hairlineWidth, height: 14, backgroundColor: 'rgba(255,255,255,0.28)' },
  headline: { fontSize: 22, lineHeight: 27, letterSpacing: -0.4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#5CE1A4' },
  orbit: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  orbitLarge: { width: 260, height: 260, right: -80, top: -110 },
  orbitSmall: { width: 150, height: 150, right: 10, top: -70 },
  gridLine: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 140,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.2)',
    transform: [{ rotate: '-28deg' }],
  },
  icon: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
});
