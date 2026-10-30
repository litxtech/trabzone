import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { CommentNode } from '../types';

export type CommentMenuAction =
  | 'edit'
  | 'delete'
  | 'report'
  | 'block'
  | 'copy'
  | 'share'
  | 'share_thread';

type Item = {
  key: CommentMenuAction;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  hidden?: boolean;
};

export function CommentActionMenu({
  visible,
  comment,
  onClose,
  onAction,
}: {
  visible: boolean;
  comment: CommentNode | null;
  onClose: () => void;
  onAction: (action: CommentMenuAction, comment: CommentNode) => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  if (!visible || !comment) {
    return null;
  }

  const items: Item[] = [
    { key: 'edit', label: 'Yorumu düzenle', icon: 'create-outline', hidden: !comment.can_edit },
    {
      key: 'delete',
      label: 'Yorumu sil',
      icon: 'trash-outline',
      destructive: true,
      hidden: !comment.can_delete,
    },
    { key: 'report', label: 'Yorumu bildir', icon: 'flag-outline', hidden: comment.is_mine },
    {
      key: 'block',
      label: 'Kullanıcıyı engelle',
      icon: 'ban-outline',
      destructive: true,
      hidden: comment.is_mine,
    },
    { key: 'copy', label: 'Bağlantıyı kopyala', icon: 'link-outline' },
    { key: 'share', label: 'Paylaş', icon: 'share-outline' },
    {
      key: 'share_thread',
      label: 'Konuşmayı görsel olarak paylaş',
      icon: 'albums-outline',
      hidden: comment.id.startsWith('temp-'),
    },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        entering={FadeIn.duration(140)}
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Menüyü kapat"
        />
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(170)}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: theme.colors.borderStrong }]} />
        <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.preview}>
          {comment.author_username ? `@${comment.author_username}` : 'Yorum'} · {comment.body}
        </AppText>

        {items
          .filter((item) => !item.hidden)
          .map((item) => (
            <Pressable
              key={item.key}
              onPress={() => onAction(item.key, comment)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={19}
                color={item.destructive ? theme.colors.danger : theme.colors.text}
              />
              <AppText
                variant="body"
                color={item.destructive ? 'danger' : 'text'}
                style={styles.itemLabel}
              >
                {item.label}
              </AppText>
            </Pressable>
          ))}

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Vazgeç"
          style={({ pressed }) => [
            styles.cancel,
            {
              borderTopColor: theme.colors.border,
              opacity: pressed ? 0.6 : 1,
            },
          ]}
        >
          <AppText variant="bodyStrong" color="textSecondary">
            Vazgeç
          </AppText>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 10,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, opacity: 0.5 },
  preview: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 12,
  },
  itemLabel: { flex: 1 },
  cancel: {
    alignItems: 'center',
    paddingVertical: 15,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
