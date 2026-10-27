import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ShareSheet } from '@/components/navigation/ShareSheet';
import { AppText } from '@/components/ui';
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

export const TAB_CONFIG: TabConfig[] = [
  { name: 'feed', label: 'Akış', icon: 'home-outline', activeIcon: 'home' },
  { name: 'marketplace', label: 'Market', icon: 'storefront-outline', activeIcon: 'storefront' },
  { name: 'messages', label: 'Mesajlar', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
  { name: 'profile', label: 'Profil', icon: 'person-outline', activeIcon: 'person' },
];

export function AppTabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { theme } = useTheme();
  const { isVisible: keyboardVisible } = useKeyboard();
  const [shareOpen, setShareOpen] = useState(false);

  const hidden = useSharedValue(0);

  useEffect(() => {
    hidden.set(withTiming(keyboardVisible ? 1 : 0, { duration: 180 }));
  }, [hidden, keyboardVisible]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hidden.get() * 110 }],
    opacity: 1 - hidden.get(),
  }));

  const items = state.routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => TAB_CONFIG.some((tab) => tab.name === route.name));

  const renderTab = (route: (typeof state.routes)[number], index: number) => {
    const config = TAB_CONFIG.find((tab) => tab.name === route.name);
    if (!config) {
      return null;
    }
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
          }
        }}
        onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
        style={styles.tab}
      >
        <Ionicons
          name={focused ? config.activeIcon : config.icon}
          size={23}
          color={focused ? theme.colors.primary : theme.colors.textTertiary}
        />
        <AppText
          variant="caption"
          style={[
            styles.tabLabel,
            { color: focused ? theme.colors.primary : theme.colors.textTertiary },
          ]}
          numberOfLines={1}
        >
          {config.label}
        </AppText>
      </Pressable>
    );
  };

  const splitAt = Math.ceil(items.length / 2);
  const left = items.slice(0, splitAt);
  const right = items.slice(splitAt);

  return (
    <>
      <Animated.View
        style={[
          styles.bar,
          {
            backgroundColor: theme.colors.tabBar,
            borderTopColor: theme.colors.tabBarBorder,
            paddingBottom: Math.max(insets.bottom, 10),
          },
          barStyle,
        ]}
      >
        <View style={styles.row}>
          {left.map(({ route, index }) => renderTab(route, index))}

          <View style={styles.shareSlot}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Paylaş"
              hitSlop={8}
              onPress={() => {
                haptics.press();
                setShareOpen(true);
              }}
              style={({ pressed }) => [styles.shareButton, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
            >
              <LinearGradient
                colors={theme.gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Ionicons name="add" size={28} color={theme.colors.onPrimary} />
            </Pressable>
          </View>

          {right.map(({ route, index }) => renderTab(route, index))}
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
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
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
  shareSlot: { width: 68, alignItems: 'center', justifyContent: 'center' },
  shareButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: -6,
    shadowColor: '#1459E8',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
