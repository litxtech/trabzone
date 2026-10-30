import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ShareSheet } from '@/components/navigation/ShareSheet';
import { AppText } from '@/components/ui';
import { requestTabScrollTop } from '@/features/navigation/tab-scroll';
import { useReduceMotion } from '@/perf/use-reduce-motion';
import { useKeyboard } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type TabConfig = {
  name: string;
  label: string;
  icon: IconName;
  activeIcon: IconName;
};

/**
 * Alt menunun tek kaynagi. Mesajlar artik sekme degil; ust basliktaki mesaj
 * simgesi ve hamburger menuden acilir. Ortadaki + butonu yerinde kalir.
 */
export const TAB_CONFIG: TabConfig[] = [
  { name: 'feed', label: 'Akış', icon: 'home-outline', activeIcon: 'home' },
  { name: 'marketplace', label: 'Market', icon: 'storefront-outline', activeIcon: 'storefront' },
  { name: 'reels', label: 'Reels', icon: 'play-circle-outline', activeIcon: 'play-circle' },
  { name: 'profile', label: 'Profil', icon: 'person-outline', activeIcon: 'person' },
];

export function AppTabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { theme } = useTheme();
  const { isVisible: keyboardVisible } = useKeyboard();
  const reduceMotion = useReduceMotion();
  const [shareOpen, setShareOpen] = useState(false);

  const hidden = useSharedValue(0);
  const focusedName = state.routes[state.index]?.name;
  const reelsActive = focusedName === 'reels';

  useEffect(() => {
    // Klavye acilip kapanirken cubuk hemen yerine otursun; 180ms'lik kayma
    // "takilma" gibi algilaniyordu. Animasyon kapatilmissa aninda atanir.
    hidden.set(
      reduceMotion
        ? keyboardVisible
          ? 1
          : 0
        : withTiming(keyboardVisible ? 1 : 0, { duration: 110 }),
    );
  }, [hidden, keyboardVisible, reduceMotion]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hidden.get() * 110 }],
    opacity: 1 - hidden.get(),
  }));

  // Rota sirasindan bagimsiz olarak her zaman istenen sirada cizilir.
  const ordered = useMemo(
    () =>
      TAB_CONFIG.map((config) => {
        const index = state.routes.findIndex((route) => route.name === config.name);
        return index >= 0 ? { config, route: state.routes[index]!, index } : null;
      }).filter((item): item is { config: TabConfig; route: (typeof state.routes)[number]; index: number } =>
        Boolean(item),
      ),
    [state],
  );

  const activeColor = reelsActive ? '#FFFFFF' : theme.colors.primary;
  const inactiveColor = reelsActive ? 'rgba(255,255,255,0.58)' : theme.colors.textTertiary;

  const renderTab = (route: (typeof state.routes)[number], index: number, config: TabConfig) => {
    const focused = state.index === index;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={config.label}
        accessibilityState={{ selected: focused }}
        onPress={() => {
          const event = emitter.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            haptics.selection();
            navigateToTab(route.key);
            return;
          }
          // Zaten açık olan sekmeye yeniden basmak, ekranı en başa sarar
          // (akıştaki "en aşağıdayken ana sayfa butonu" davranışı). Ekran bir
          // dinleyici kaydetmemişse hiçbir şey olmaz; boşuna geri bildirim yok.
          if (focused && !event.defaultPrevented && requestTabScrollTop(config.name)) {
            haptics.selection();
          }
        }}
        onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
        style={styles.tab}
      >
        <Ionicons
          name={focused ? config.activeIcon : config.icon}
          size={23}
          color={focused ? activeColor : inactiveColor}
        />
        <AppText
          variant="caption"
          style={[styles.tabLabel, { color: focused ? activeColor : inactiveColor }]}
          numberOfLines={1}
        >
          {config.label}
        </AppText>
      </Pressable>
    );
  };

  const left = ordered.slice(0, 2);
  const right = ordered.slice(2);

  return (
    <>
      <Animated.View
        style={[
          styles.bar,
          {
            backgroundColor: reelsActive ? 'rgba(6,9,18,0.94)' : theme.colors.tabBar,
            borderTopColor: reelsActive ? 'rgba(255,255,255,0.08)' : theme.colors.tabBarBorder,
            paddingBottom: Math.max(insets.bottom, 10),
          },
          barStyle,
        ]}
      >
        <View style={styles.row}>
          {left.map(({ route, index, config }) => renderTab(route, index, config))}

          <View style={styles.shareSlot}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="İçerik oluştur"
              hitSlop={8}
              onPress={() => {
                haptics.press();
                setShareOpen(true);
              }}
              style={({ pressed }) => [
                styles.shareButton,
                { transform: [{ scale: pressed ? 0.93 : 1 }] },
              ]}
            >
              <LinearGradient
                colors={theme.gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.shareHighlight} pointerEvents="none" />
              <Ionicons name="add" size={29} color={theme.colors.onPrimary} />
            </Pressable>
          </View>

          {right.map(({ route, index, config }) => renderTab(route, index, config))}
        </View>
      </Animated.View>

      <ShareSheet visible={shareOpen} onClose={() => setShareOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    overflow: 'visible',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
    minHeight: 46,
  },
  tabLabel: { fontSize: 10.5, lineHeight: 13 },
  shareSlot: { width: 70, alignItems: 'center', justifyContent: 'center' },
  shareButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: -8,
  },
  shareHighlight: {
    position: 'absolute',
    top: 1,
    left: 10,
    right: 10,
    height: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});
