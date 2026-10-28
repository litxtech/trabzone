import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { pickMedia } from '@/features/media/media-picker';
import { SafetySheet } from '@/features/safety/components/SafetySheet';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type Props = {
  visible: boolean;
  onClose: () => void;
};

type ActionKey = 'post' | 'photo' | 'video' | 'reel' | 'story' | 'listing';

const ACTIONS: {
  key: ActionKey;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  gradient?: boolean;
}[] = [
  {
    key: 'post',
    icon: 'create-outline',
    title: 'Gönderi oluştur',
    subtitle: 'Metin, fotoğraf veya video ile paylaş',
    gradient: true,
  },
  {
    key: 'photo',
    icon: 'images-outline',
    title: 'Fotoğraf paylaş',
    subtitle: 'Galerinden bir fotoğraf seç',
  },
  {
    key: 'video',
    icon: 'videocam-outline',
    title: 'Video paylaş',
    subtitle: 'Kısa bir video yükle',
  },
  {
    key: 'reel',
    icon: 'play-circle-outline',
    title: 'Reels oluştur',
    subtitle: 'Dikey video çek, kapak seç ve yayınla',
  },
  {
    key: 'story',
    icon: 'aperture-outline',
    title: 'Hikâye oluştur',
    subtitle: '24 saat görünür, sonra kaybolur',
  },
  {
    key: 'listing',
    icon: 'storefront-outline',
    title: 'Marketplace ilanı',
    subtitle: 'Ürününü satışa çıkar',
  },
];

export function ShareSheet({ visible, onClose }: Props) {
  const { theme } = useTheme();
  const router = useRouter();

  const openComposerFromLibrary = useCallback(
    async (kind: 'image' | 'video') => {
      const picked = await pickMedia({
        source: 'library',
        kind,
        multiple: kind === 'image',
        limit: 10,
      });
      const params: Record<string, string> = { media: kind };
      if (picked && picked.length > 0) {
        params.draft = JSON.stringify(
          picked.map((asset) => ({
            uri: asset.uri,
            mediaType: asset.mediaType,
            mimeType: asset.mimeType,
            fileName: asset.fileName,
          })),
        );
      }
      router.push({ pathname: '/compose/post', params } as never);
    },
    [router],
  );

  const go = useCallback(
    (key: ActionKey) => {
      haptics.tap();
      onClose();
      if (key === 'photo' || key === 'video') {
        // Modal kapanmadan galeriyi acmak iOS'ta cakismaya yol acar; bekleme
        // sadece kapanis karesi icin, kullaniciyi bekletmeyecek kadar kisa.
        setTimeout(() => void openComposerFromLibrary(key === 'photo' ? 'image' : 'video'), 140);
        return;
      }
      const routes: Record<'post' | 'reel' | 'story' | 'listing', string> = {
        post: '/compose/post',
        reel: '/compose/reel',
        story: '/compose/story',
        listing: '/marketplace/create',
      };
      // Modal kapanmadan yeni ekrani itmek iOS'ta cakismaya yol acar.
      setTimeout(() => router.push(routes[key] as never), 140);
    },
    [onClose, openComposerFromLibrary, router],
  );

  return (
    <SafetySheet
      visible={visible}
      onClose={onClose}
      title="Ne paylaşmak istersin?"
      subtitle="Trabzone'da paylaşım birkaç saniye sürer"
      scrollable={false}
    >
      {ACTIONS.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.title}
          onPress={() => go(action.key)}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: action.gradient ? theme.colors.primarySoft : theme.colors.surface,
              borderColor: action.gradient ? theme.colors.primary : theme.colors.border,
              borderRadius: theme.radius.md,
              opacity: pressed ? 0.82 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.icon,
              {
                backgroundColor: action.gradient ? theme.colors.primary : theme.colors.surfaceMuted,
              },
            ]}
          >
            <Ionicons
              name={action.icon}
              size={19}
              color={action.gradient ? theme.colors.onPrimary : theme.colors.primaryDeep}
            />
          </View>
          <View style={styles.text}>
            <AppText variant="bodyStrong">{action.title}</AppText>
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {action.subtitle}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      ))}
    </SafetySheet>
  );
}

const styles = StyleSheet.create({
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 1 },
});
