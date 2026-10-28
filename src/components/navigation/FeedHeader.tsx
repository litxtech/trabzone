import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, BrandWordmark } from '@/components/ui';
import { useUnreadMessageCount } from '@/features/messaging/hooks/use-chat';
import { useDrawer } from '@/features/navigation/drawer-context';
import { useUnreadNotifications } from '@/features/notifications/hooks/use-notifications';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Basligin sabit olculeri.
 *
 * 54 dp icerik yuksekligi + ust guvenli alan. Ikonlar 22 dp, dokunma alanlari
 * 44 dp: gorsel olarak kompakt, erisilebilirlikte tam hedef.
 */
const HEADER_HEIGHT = 54;
const ICON_SIZE = 22;
const ACTION_SIZE = 44;
const ACTION_GAP = 2;
const BRAND_SIZE = 21;

type HeaderActionProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
  badgeColor?: string;
};

/**
 * Baslik ikonu: dairesel zemin, golge veya olcek animasyonu yok. Yalnizca
 * dokunma aninda hafif opaklik degisir; boylece ekran "titremis" gorunmez.
 */
const HeaderAction = memo(function HeaderAction({
  icon,
  label,
  onPress,
  badge = 0,
  badgeColor,
}: HeaderActionProps) {
  const { theme } = useTheme();
  const showBadge = badge > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={showBadge ? `${label}, ${badge} okunmamış` : label}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
    >
      <Ionicons name={icon} size={ICON_SIZE} color={theme.colors.text} />
      {showBadge ? (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: badgeColor ?? theme.colors.primary,
              borderColor: theme.colors.background,
            },
          ]}
        >
          <AppText variant="caption" color="#FFFFFF" allowFontScaling={false} style={styles.badgeText}>
            {badge > 99 ? '99+' : badge}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
});

/**
 * Ana sosyal akisin kompakt premium basligi.
 *
 * Sol: hamburger + "trabzone." markasi. Sag: arama, mesajlar, bildirimler.
 * Yolculuk ve harita buradan kaldirildi; ikisi de sol menude (DrawerMenu) ve
 * arama ekranindaki kesif kisayollarinda yer aliyor.
 *
 * Okunmamis sayilari yalnizca bu bilesen abone olur. Akis ekrani her 30 sn'de
 * bir yeniden cizilmez; FlashList kaydirma konumu korunur.
 */
export const FeedHeader = memo(function FeedHeader() {
  const { theme } = useTheme();
  const router = useRouter();
  const { open } = useDrawer();
  const insets = useSafeAreaInsets();
  const unreadMessages = useUnreadMessageCount();
  const { data: unreadNotifications } = useUnreadNotifications();

  const openSearch = useCallback(() => {
    router.push('/search' as never);
  }, [router]);

  const openMessages = useCallback(() => {
    router.push('/messages' as never);
  }, [router]);

  const openNotifications = useCallback(() => {
    router.push('/notifications' as never);
  }, [router]);

  // Hedef ekranlari onceden yukle: ilk dokunusta bekleme olusmaz. Prefetch
  // desteklenmeyen platformlarda sessizce atlanir.
  useEffect(() => {
    if (typeof router.prefetch !== 'function') {
      return;
    }
    const timer = setTimeout(() => {
      router.prefetch('/search' as never);
      router.prefetch('/messages' as never);
      router.prefetch('/notifications' as never);
    }, 600);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          backgroundColor: theme.colors.background,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.left}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Menüyü aç"
            onPress={() => open('main')}
            style={({ pressed }) => [styles.menu, pressed ? styles.actionPressed : null]}
          >
            <Ionicons name="menu-outline" size={ICON_SIZE} color={theme.colors.text} />
          </Pressable>
          <BrandWordmark size={BRAND_SIZE} />
        </View>

        <View style={styles.actions}>
          <HeaderAction icon="search-outline" label="Ara" onPress={openSearch} />
          <HeaderAction
            icon="chatbubble-ellipses-outline"
            label="Mesajlar"
            badge={unreadMessages}
            onPress={openMessages}
          />
          <HeaderAction
            icon="notifications-outline"
            label="Bildirimler"
            badge={unreadNotifications ?? 0}
            badgeColor={theme.colors.danger}
            onPress={openNotifications}
          />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    // Ayirici cizgi, golge veya blur yok: baslik zeminle ayni yuzeyde kalir.
    width: '100%',
  },
  row: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 1,
    minWidth: 0,
  },
  menu: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ACTION_GAP,
  },
  action: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: {
    opacity: 0.55,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 9,
    lineHeight: 12,
  },
});
