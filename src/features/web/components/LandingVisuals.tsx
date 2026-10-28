import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/ui';
import { useReduceMotion } from '@/perf/use-reduce-motion';

function Float({
  children,
  distance = 8,
  duration = 5200,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  distance?: number;
  duration?: number;
  delay?: number;
  style?: object;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    // Delay is applied by offsetting the initial value; avoids extra timers.
    progress.value = delay > 0 ? progress.value : progress.value;
  }, [delay, duration, progress, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: -distance * progress.value }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

export function PhoneFrame({
  children,
  width = 260,
  height = 530,
  tone = 'dark',
}: {
  children: React.ReactNode;
  width?: number;
  height?: number;
  tone?: 'dark' | 'light';
}) {
  return (
    <View
      style={[
        styles.phone,
        {
          width,
          height,
          backgroundColor: tone === 'dark' ? '#05080F' : '#F7F9FF',
          borderColor: tone === 'dark' ? 'rgba(150,175,235,0.32)' : 'rgba(65,105,245,0.24)',
        },
      ]}
    >
      <View
        style={[
          styles.phoneScreen,
          { backgroundColor: tone === 'dark' ? '#0A1020' : '#FFFFFF' },
        ]}
      >
        <View style={styles.phoneNotch} />
        {children}
      </View>
    </View>
  );
}

function AvatarDot({ size = 24, color = '#4169F5' }: { size?: number; color?: string }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    >
      <Ionicons name="person" size={size * 0.5} color="#FFFFFF" />
    </View>
  );
}

function FeedCard({
  title,
  lines = 2,
  accent = '#4169F5',
}: {
  title: string;
  lines?: number;
  accent?: string;
}) {
  return (
    <View style={styles.feedCard}>
      <View style={styles.feedHead}>
        <AvatarDot size={22} color={accent} />
        <View style={styles.flex}>
          <View style={[styles.line, { width: '58%' }]} />
          <View style={[styles.line, styles.lineSoft, { width: '36%' }]} />
        </View>
        <Ionicons name="ellipsis-horizontal" size={13} color="#6C7A96" />
      </View>
      <AppText variant="caption" color="#EAF0FF" style={styles.feedTitle}>
        {title}
      </AppText>
      <View style={[styles.mediaBlock, { backgroundColor: `${accent}22` }]}>
        <Ionicons name="image-outline" size={24} color={accent} />
      </View>
      {Array.from({ length: lines }).map((_, index) => (
        <View
          key={`line-${index}`}
          style={[styles.line, styles.lineSoft, { width: index === 0 ? '88%' : '64%' }]}
        />
      ))}
      <View style={styles.feedActions}>
        <Ionicons name="heart-outline" size={14} color="#94A3C0" />
        <Ionicons name="chatbubble-outline" size={14} color="#94A3C0" />
        <Ionicons name="paper-plane-outline" size={14} color="#94A3C0" />
      </View>
    </View>
  );
}

export function FeedPhone() {
  return (
    <PhoneFrame width={250} height={500}>
      <View style={styles.phoneHeader}>
        <Ionicons name="sparkles" size={14} color="#A78BFA" />
        <AppText variant="caption" color="#FFFFFF" style={styles.phoneBrand}>
          TRABZONE
        </AppText>
        <Ionicons name="notifications-outline" size={15} color="#9FB0CE" />
      </View>
      <View style={styles.storyRow}>
        {['#4169F5', '#8057F4', '#2BB673', '#F0A23A'].map((color, index) => (
          <View key={color} style={styles.storyItem}>
            <View style={[styles.storyRing, { borderColor: color }]}>
              <AvatarDot size={24} color={color} />
            </View>
            <View style={[styles.line, { width: 22, height: 4 }]} />
            <View style={[styles.line, styles.lineSoft, { width: 14, height: 3 }]} />
          </View>
        ))}
      </View>
      <View style={styles.feedList}>
        <FeedCard title="Şehrinden bir kare paylaş" accent="#4169F5" />
        <FeedCard title="Yeni bir keşif, yeni bir bağlantı" accent="#8057F4" lines={1} />
      </View>
    </PhoneFrame>
  );
}

export function ReelsPhone() {
  return (
    <PhoneFrame width={230} height={470}>
      <LinearGradient
        colors={['#101B36', '#1B1238', '#0A1020']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.reelsTop}>
        <AppText variant="caption" color="#FFFFFF" style={styles.reelsTitle}>
          Reels
        </AppText>
        <Ionicons name="volume-mute" size={16} color="#FFFFFF" />
      </View>
      <View style={styles.reelsCenter}>
        <View style={styles.playCircle}>
          <Ionicons name="play" size={30} color="#FFFFFF" />
        </View>
        <AppText variant="caption" color="#C7D4EE" align="center">
          Sessiz başlar,{'\n'}ses kontrolü sende.
        </AppText>
      </View>
      <View style={styles.reelsSide}>
        <View style={styles.reelsAction}>
          <Ionicons name="heart" size={18} color="#FF6B8A" />
          <View style={[styles.line, { width: 16, height: 4 }]} />
        </View>
        <View style={styles.reelsAction}>
          <Ionicons name="chatbubble-ellipses" size={17} color="#FFFFFF" />
          <View style={[styles.line, { width: 16, height: 4 }]} />
        </View>
        <View style={styles.reelsAction}>
          <Ionicons name="paper-plane" size={17} color="#FFFFFF" />
          <View style={[styles.line, { width: 16, height: 4 }]} />
        </View>
      </View>
      <View style={styles.reelsBottom}>
        <AvatarDot size={24} color="#8057F4" />
        <View style={styles.flex}>
          <View style={[styles.line, { width: '48%' }]} />
          <View style={[styles.line, styles.lineSoft, { width: '72%' }]} />
        </View>
      </View>
    </PhoneFrame>
  );
}

export function ChatPhone() {
  return (
    <PhoneFrame width={250} height={470}>
      <View style={styles.phoneHeader}>
        <Ionicons name="chevron-back" size={15} color="#9FB0CE" />
        <AvatarDot size={24} color="#2BB673" />
        <View style={styles.flex}>
          <View style={[styles.line, { width: 64 }]} />
          <View style={[styles.line, styles.lineSoft, { width: 40, height: 3 }]} />
        </View>
        <Ionicons name="call-outline" size={14} color="#9FB0CE" />
      </View>
      <View style={styles.chatBody}>
        <View style={styles.bubbleIn}>
          <View style={[styles.line, styles.lineOnLight, { width: 110 }]} />
          <View style={[styles.line, styles.lineOnLightSoft, { width: 82 }]} />
        </View>
        <View style={styles.bubbleOut}>
          <View style={[styles.line, styles.lineOnPrimary, { width: 120 }]} />
          <View style={[styles.line, styles.lineOnPrimarySoft, { width: 78 }]} />
        </View>
        <View style={styles.bubbleIn}>
          <View style={[styles.line, styles.lineOnLight, { width: 96 }]} />
        </View>
        <View style={styles.bubbleOut}>
          <View style={[styles.line, styles.lineOnPrimary, { width: 104 }]} />
        </View>
      </View>
      <View style={styles.chatInput}>
        <Ionicons name="add-circle-outline" size={16} color="#7C8AA6" />
        <View style={[styles.line, styles.lineSoft, { flex: 1 }]} />
        <Ionicons name="send" size={15} color="#6284FF" />
      </View>
    </PhoneFrame>
  );
}

export function MapPreview({ compact = false }: { compact?: boolean }) {
  const pins = [
    { top: '22%', left: '24%', color: '#4169F5', icon: 'restaurant' as const },
    { top: '42%', left: '62%', color: '#8057F4', icon: 'cafe' as const },
    { top: '64%', left: '34%', color: '#2BB673', icon: 'bed' as const },
    { top: '30%', left: '76%', color: '#F0A23A', icon: 'home' as const },
  ];
  return (
    <View style={[styles.map, compact ? styles.mapCompact : null]}>
      <LinearGradient
        colors={['#0C1730', '#101F3E', '#0A1326']}
        style={StyleSheet.absoluteFill}
      />
      {[12, 28, 44, 60, 76, 92].map((top) => (
        <View key={`h-${top}`} style={[styles.mapLine, { top: `${top}%`, left: 0, right: 0, height: 1 }]} />
      ))}
      {[14, 30, 46, 62, 78, 94].map((left) => (
        <View key={`v-${left}`} style={[styles.mapLine, { left: `${left}%`, top: 0, bottom: 0, width: 1 }]} />
      ))}
      <View style={styles.mapWater}>
        <LinearGradient
          colors={['rgba(18,86,140,0.45)', 'rgba(10,30,60,0.15)']}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={styles.mapRoad} />
      <View style={[styles.mapRoad, styles.mapRoadAlt]} />

      {pins.map((pin) => (
        <View key={`${pin.top}-${pin.left}`} style={[styles.pin, { top: pin.top, left: pin.left }]}>
          <View style={[styles.pinBubble, { backgroundColor: pin.color }]}>
            <Ionicons name={pin.icon} size={11} color="#FFFFFF" />
          </View>
          <View style={[styles.pinStem, { backgroundColor: pin.color }]} />
        </View>
      ))}

      {!compact ? (
        <>
          <View style={styles.mapCard}>
            <View style={[styles.mapCardIcon, { backgroundColor: 'rgba(65,105,245,0.2)' }]}>
              <Ionicons name="location" size={14} color="#9DB6FF" />
            </View>
            <View style={styles.flex}>
              <View style={[styles.line, { width: 72 }]} />
              <View style={[styles.line, styles.lineSoft, { width: 48, height: 3 }]} />
            </View>
          </View>
          <View style={styles.mapBadge}>
            <AppText variant="caption" color="#9DB6FF" style={styles.mapBadgeText}>
              Harita görünümü önizlemedir
            </AppText>
          </View>
        </>
      ) : null}
    </View>
  );
}

export function MarketplaceTile({
  icon,
  label,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent: string;
}) {
  return (
    <View style={[styles.marketTile, { borderColor: `${accent}44` }]}>
      <View style={[styles.marketIcon, { backgroundColor: `${accent}22` }]}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <AppText variant="caption" color="#EAF0FF">
        {label}
      </AppText>
    </View>
  );
}

export function HeroShowcase() {
  return (
    <View style={styles.showcase}>
      <View style={styles.glowOne} />
      <View style={styles.glowTwo} />

      <View style={styles.phoneWrap}>
        <FeedPhone />
      </View>

      <Float distance={9} duration={5600} style={[styles.floatCard, styles.floatPost]}>
        <View style={styles.miniCard}>
          <View style={styles.miniHead}>
            <AvatarDot size={22} color="#4169F5" />
            <View style={styles.flex}>
              <View style={[styles.line, { width: 58 }]} />
              <View style={[styles.line, styles.lineSoft, { width: 36, height: 3 }]} />
            </View>
          </View>
          <AppText variant="caption" color="#DCE6FF" style={styles.miniTitle}>
            Şehrinden bir kare
          </AppText>
          <View style={[styles.miniMedia, { backgroundColor: 'rgba(65,105,245,0.18)' }]}>
            <Ionicons name="image" size={22} color="#7FA0FF" />
          </View>
        </View>
      </Float>

      <Float distance={11} duration={6400} style={[styles.floatCard, styles.floatReels]}>
        <View style={styles.miniCard}>
          <View style={styles.miniMediaTall}>
            <LinearGradient
              colors={['#241A4D', '#101B36']}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.playSmall}>
              <Ionicons name="play" size={14} color="#FFFFFF" />
            </View>
          </View>
          <AppText variant="caption" color="#DCE6FF" style={styles.miniTitle}>
            Reels
          </AppText>
        </View>
      </Float>

      <Float distance={7} duration={4800} style={[styles.floatCard, styles.floatMarket]}>
        <View style={styles.miniCard}>
          <View style={styles.miniHead}>
            <View style={[styles.marketIcon, { backgroundColor: 'rgba(43,182,115,0.18)' }]}>
              <Ionicons name="storefront" size={15} color="#4AD295" />
            </View>
            <AppText variant="caption" color="#DCE6FF">
              Marketplace
            </AppText>
          </View>
          <View style={[styles.line, styles.lineSoft, { width: '72%' }]} />
          <View style={[styles.line, { width: '48%' }]} />
        </View>
      </Float>

      <Float distance={10} duration={6000} style={[styles.floatCard, styles.floatMap]}>
        <View style={styles.miniCard}>
          <MapPreview compact />
          <View style={styles.miniHead}>
            <Ionicons name="location" size={13} color="#9DB6FF" />
            <AppText variant="caption" color="#DCE6FF">
              Trabzon&apos;u keşfet
            </AppText>
          </View>
        </View>
      </Float>

      <Float distance={6} duration={5400} style={[styles.floatCard, styles.floatBiz]}>
        <View style={styles.miniCard}>
          <View style={styles.miniHead}>
            <View style={[styles.marketIcon, { backgroundColor: 'rgba(240,162,58,0.18)' }]}>
              <Ionicons name="business" size={15} color="#F0B45A" />
            </View>
            <View style={styles.flex}>
              <AppText variant="caption" color="#DCE6FF">
                İşletmeler
              </AppText>
              <View style={[styles.line, styles.lineSoft, { width: 44, height: 3 }]} />
            </View>
          </View>
        </View>
      </Float>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  phone: {
    borderRadius: 36,
    borderWidth: 1.5,
    padding: 7,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 24px 70px rgba(0,0,0,0.5)' } as unknown as object)
      : {}),
  },
  phoneScreen: { flex: 1, borderRadius: 29, overflow: 'hidden', paddingTop: 22 },
  phoneNotch: {
    position: 'absolute',
    top: 7,
    alignSelf: 'center',
    width: 68,
    height: 16,
    borderRadius: 10,
    backgroundColor: '#05080F',
    zIndex: 2,
  },
  phoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  phoneBrand: { flex: 1, letterSpacing: 1.2, fontSize: 10 },
  storyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(140,170,235,0.12)',
  },
  storyItem: { alignItems: 'center', gap: 4 },
  storyRing: { borderWidth: 1.5, borderRadius: 18, padding: 2 },
  feedList: { padding: 10, gap: 10 },
  feedCard: {
    borderRadius: 14,
    backgroundColor: '#101A30',
    borderWidth: 1,
    borderColor: 'rgba(140,170,235,0.12)',
    padding: 9,
    gap: 7,
  },
  feedHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  feedTitle: { fontSize: 10.5 },
  mediaBlock: {
    height: 62,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { height: 6, borderRadius: 4, backgroundColor: 'rgba(214,226,250,0.42)' },
  lineSoft: { backgroundColor: 'rgba(160,178,210,0.18)', height: 4 },
  lineOnLight: { backgroundColor: 'rgba(15,30,55,0.42)', height: 5 },
  lineOnLightSoft: { backgroundColor: 'rgba(15,30,55,0.16)', height: 4 },
  lineOnPrimary: { backgroundColor: 'rgba(255,255,255,0.7)', height: 5 },
  lineOnPrimarySoft: { backgroundColor: 'rgba(255,255,255,0.3)', height: 4 },
  feedActions: { flexDirection: 'row', gap: 9, paddingTop: 1 },

  reelsTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  reelsTitle: { letterSpacing: 1, fontSize: 11 },
  reelsCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  playCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reelsSide: { position: 'absolute', right: 12, bottom: 84, gap: 15, alignItems: 'center' },
  reelsAction: { alignItems: 'center', gap: 4 },
  reelsBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },

  chatBody: { flex: 1, padding: 12, gap: 9, justifyContent: 'flex-end' },
  bubbleIn: {
    alignSelf: 'flex-start',
    backgroundColor: '#E9EEFA',
    borderRadius: 12,
    borderBottomLeftRadius: 3,
    padding: 9,
    gap: 5,
    maxWidth: '82%',
  },
  bubbleOut: {
    alignSelf: 'flex-end',
    backgroundColor: '#4169F5',
    borderRadius: 12,
    borderBottomRightRadius: 3,
    padding: 9,
    gap: 5,
    maxWidth: '82%',
  },
  chatInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(140,170,235,0.14)',
  },

  map: {
    flex: 1,
    minHeight: 210,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(120,150,220,0.2)',
    backgroundColor: '#0B152B',
  },
  mapCompact: { minHeight: 96, height: 96, borderRadius: 10 },
  mapLine: { position: 'absolute', backgroundColor: 'rgba(120,160,230,0.09)' },
  mapWater: {
    position: 'absolute',
    top: '-12%',
    right: '-18%',
    width: '52%',
    height: '70%',
    borderBottomLeftRadius: 120,
    transform: [{ rotate: '-14deg' }],
    overflow: 'hidden',
  },
  mapRoad: {
    position: 'absolute',
    top: '18%',
    left: '-10%',
    right: '-10%',
    height: 16,
    backgroundColor: 'rgba(140,170,235,0.1)',
    transform: [{ rotate: '17deg' }],
  },
  mapRoadAlt: {
    top: '62%',
    height: 10,
    transform: [{ rotate: '-9deg' }],
    backgroundColor: 'rgba(140,170,235,0.07)',
  },
  pin: { position: 'absolute', alignItems: 'center' },
  pinBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  pinStem: { width: 2, height: 7, opacity: 0.7 },
  mapCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(10,18,34,0.9)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(120,150,220,0.22)',
    padding: 9,
  },
  mapCardIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  mapBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(8,14,28,0.78)',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  mapBadgeText: { fontSize: 8.5 },

  marketTile: {
    flexGrow: 1,
    minWidth: 130,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(13,23,44,0.72)',
  },
  marketIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  showcase: {
    flex: 1,
    minHeight: 580,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneWrap: { zIndex: 2 },
  glowOne: {
    position: 'absolute',
    width: 330,
    height: 330,
    borderRadius: 165,
    backgroundColor: 'rgba(65,105,245,0.22)',
  },
  glowTwo: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(128,87,244,0.18)',
    transform: [{ translateX: 120 }, { translateY: -100 }],
  },
  floatCard: { position: 'absolute', zIndex: 3 },
  floatPost: { left: -6, top: 44 },
  floatReels: { right: -8, top: 90 },
  floatMarket: { left: -18, bottom: 40 },
  floatMap: { right: -14, bottom: 10, width: 168 },
  floatBiz: { right: 2, top: -6 },
  miniCard: {
    width: 158,
    borderRadius: 14,
    backgroundColor: 'rgba(12,20,38,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(130,160,225,0.24)',
    padding: 9,
    gap: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 16px 44px rgba(0,0,0,0.4)' } as unknown as object)
      : {}),
  },
  miniHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  miniTitle: { fontSize: 10 },
  miniMedia: { height: 52, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  miniMediaTall: {
    height: 108,
    borderRadius: 9,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
