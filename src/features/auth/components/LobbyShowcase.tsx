import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AppText, Logo } from '@/components/ui';

/**
 * Lobi icin katmanli sosyal topluluk kompozisyonu. Iki kucuk translateY
 * animasyonu UI thread'inde calisir; gradient'lar statiktir ve blur yoktur.
 */
export function LobbyShowcase() {
  const floatA = useSharedValue(0);
  const floatB = useSharedValue(0);

  useEffect(() => {
    floatA.value = withRepeat(
      withTiming(1, { duration: 6800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    floatB.value = withRepeat(
      withTiming(1, { duration: 8600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [floatA, floatB]);

  const postStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatA.value * -7 }, { rotate: '-2deg' }],
  }));

  const reelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatB.value * 8 + 4 }, { rotate: '4deg' }],
  }));

  return (
    <View style={styles.stage} pointerEvents="none">
      <View style={styles.stageGlow} />
      <View style={styles.gridLine} />

      <Animated.View style={[styles.postCard, postStyle]}>
        <View style={styles.postHeader}>
          <LinearGradient
            colors={['#4169F5', '#8057F4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <AppText variant="caption" color="#FFFFFF" style={styles.avatarLetter}>
              T
            </AppText>
          </LinearGradient>
          <View style={styles.postAuthor}>
            <View style={styles.authorRow}>
              <AppText variant="label" color="#F4F7FF" style={styles.authorName}>
                trabzonlive
              </AppText>
              <Ionicons name="checkmark-circle" size={12} color="#6E9AFF" />
            </View>
            <AppText variant="caption" color="#7F8CA6" style={styles.metaText}>
              2 dk · Trabzon
            </AppText>
          </View>
          <Ionicons name="ellipsis-horizontal" size={14} color="#64718B" />
        </View>

        <AppText variant="body" color="#E9EEFB" style={styles.postText}>
          Şehrin ritmi burada. Yeni rotalar, yeni hikâyeler.
        </AppText>

        <View style={styles.postMedia}>
          <LinearGradient
            colors={['#1D3A86', '#2F55D4', '#8057F4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.postMediaHaze} />
          <Ionicons name="image-outline" size={26} color="rgba(255,255,255,0.55)" />
          <View style={styles.locationChip}>
            <Ionicons name="location" size={10} color="#FFFFFF" />
            <AppText variant="caption" color="#FFFFFF" style={styles.metaText}>
              Boztepe
            </AppText>
          </View>
        </View>

        <View style={styles.postActions}>
          <View style={styles.action}>
            <Ionicons name="heart" size={14} color="#FF6B70" />
            <AppText variant="caption" color="#B8C3D9" style={styles.metaText}>
              1,2B
            </AppText>
          </View>
          <View style={styles.action}>
            <Ionicons name="chatbubble-outline" size={13} color="#B8C3D9" />
            <AppText variant="caption" color="#B8C3D9" style={styles.metaText}>
              184
            </AppText>
          </View>
          <View style={styles.action}>
            <Ionicons name="paper-plane-outline" size={13} color="#B8C3D9" />
          </View>
        </View>
      </Animated.View>

      <Animated.View style={[styles.reelCard, reelStyle]}>
        <LinearGradient
          colors={['#2F55D4', '#8057F4', '#161D35']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.reelGlow} />
        <View style={styles.reelPlay}>
          <Ionicons name="play" size={17} color="#FFFFFF" />
        </View>
        <View style={styles.reelFooter}>
          <AppText variant="overline" color="#FFFFFF" style={styles.reelLabel}>
            REELS
          </AppText>
          <View style={styles.reelSound}>
            <Ionicons name="musical-note" size={9} color="#DCE5FF" />
            <AppText variant="caption" color="#DCE5FF" style={styles.reelSoundText}>
              Orijinal ses
            </AppText>
          </View>
        </View>
      </Animated.View>

      <View style={styles.messageCard}>
        <LinearGradient
          colors={['#4169F5', '#8057F4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.messageAvatar}
        >
          <Ionicons name="chatbubble-ellipses" size={14} color="#FFFFFF" />
        </LinearGradient>
        <View style={styles.messageCopy}>
          <AppText variant="label" color="#F2F6FF" style={styles.messageTitle}>
            Yeni mesaj
          </AppText>
          <AppText variant="caption" color="#8794AD" style={styles.metaText} numberOfLines={1}>
            Akşam planına var mısın?
          </AppText>
        </View>
        <View style={styles.unreadDot} />
      </View>

      <View style={styles.peopleCard}>
        <View style={styles.avatarStack}>
          <View style={[styles.stackedAvatar, { backgroundColor: '#4169F5' }]}>
            <AppText variant="caption" color="#FFFFFF" style={styles.stackedLetter}>
              A
            </AppText>
          </View>
          <View style={[styles.stackedAvatar, { backgroundColor: '#8057F4', marginLeft: -7 }]}>
            <AppText variant="caption" color="#FFFFFF" style={styles.stackedLetter}>
              E
            </AppText>
          </View>
          <View style={[styles.stackedAvatar, { backgroundColor: '#1D9E75', marginLeft: -7 }]}>
            <AppText variant="caption" color="#FFFFFF" style={styles.stackedLetter}>
              M
            </AppText>
          </View>
        </View>
        <View style={styles.peopleCopy}>
          <AppText variant="caption" color="#F2F6FF" style={styles.peopleCount}>
            12,4B
          </AppText>
          <AppText variant="caption" color="#8794AD" style={styles.metaText}>
            çevrimiçi
          </AppText>
        </View>
      </View>

      <View style={styles.logoBadge}>
        <Logo size={28} />
        <View style={styles.liveDot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    height: 268,
    marginTop: 2,
    marginBottom: 4,
  },
  stageGlow: {
    position: 'absolute',
    left: '18%',
    top: 12,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(65,105,245,0.13)',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 138,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  postCard: {
    position: 'absolute',
    left: 0,
    top: 32,
    width: '76%',
    padding: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 8,
  },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 11, lineHeight: 14 },
  postAuthor: { flex: 1, gap: 0 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  authorName: { fontSize: 12, lineHeight: 16 },
  metaText: { fontSize: 10, lineHeight: 13 },
  postText: { fontSize: 12, lineHeight: 17 },
  postMedia: {
    height: 80,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postMediaHaze: {
    position: 'absolute',
    width: 140,
    height: 60,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -18,
    right: -24,
  },
  locationChip: {
    position: 'absolute',
    left: 8,
    bottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(4,8,16,0.5)',
  },
  postActions: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 1 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reelCard: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 98,
    height: 166,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  reelGlow: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.16)',
    top: -20,
    right: -20,
  },
  reelPlay: {
    position: 'absolute',
    top: '38%',
    left: '50%',
    marginLeft: -19,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(4,8,16,0.34)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reelFooter: { position: 'absolute', left: 9, right: 8, bottom: 9, gap: 2 },
  reelLabel: { fontSize: 10, letterSpacing: 1.8 },
  reelSound: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  reelSoundText: { fontSize: 9, lineHeight: 12 },
  messageCard: {
    position: 'absolute',
    left: 8,
    bottom: 3,
    width: '64%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 15,
    backgroundColor: 'rgba(17,26,46,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.11)',
  },
  messageAvatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageCopy: { flex: 1, gap: 0 },
  messageTitle: { fontSize: 11, lineHeight: 15 },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#6E9AFF',
  },
  peopleCard: {
    position: 'absolute',
    right: 2,
    bottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 13,
    backgroundColor: 'rgba(17,26,46,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.11)',
  },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  stackedAvatar: {
    width: 21,
    height: 21,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#111A2E',
  },
  stackedLetter: { fontSize: 8, lineHeight: 10 },
  peopleCopy: { gap: 0 },
  peopleCount: { fontSize: 10, lineHeight: 13 },
  logoBadge: {
    position: 'absolute',
    left: '54%',
    top: 14,
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  liveDot: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#3DD68C',
    borderWidth: 1,
    borderColor: '#111A2E',
  },
});
