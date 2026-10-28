import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import type { MapFriend } from '../types';
import { MapSheet } from './MapSheet';

/**
 * Arkadaş listesi. Yalnızca konum paylaşan arkadaşlar haritada görünür;
 * burada paylaşmayanlar da "gizli" etiketiyle listelenir. Seçim modunda
 * süreli canlı konum paylaşımının izinli kişileri belirlenir.
 */
export function MapFriendsSheet({
  visible,
  onClose,
  friends,
  loading,
  selectable = false,
  selectedIds,
  onToggleSelect,
  onConfirm,
  confirming,
}: {
  visible: boolean;
  onClose: () => void;
  friends: MapFriend[];
  loading: boolean;
  selectable?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onConfirm?: () => void;
  confirming?: boolean;
}) {
  const { theme } = useTheme();
  const selected = new Set(selectedIds ?? []);

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title={selectable ? 'Kimler görebilir?' : 'Haritadaki arkadaşlar'}
      subtitle={
        selectable
          ? 'Yalnızca seçtiğin kişiler süreli konumunu görebilir'
          : 'Hayalet modundaki arkadaşlar haritada görünmez'
      }
      footer={
        selectable ? (
          <Button
            label={selected.size > 0 ? `${selected.size} kişiyle paylaş` : 'Kişi seç'}
            disabled={selected.size === 0}
            loading={confirming}
            onPress={onConfirm}
          />
        ) : undefined
      }
    >
      {loading ? (
        <AppText variant="caption" color="textTertiary" align="center">
          Arkadaşlar yükleniyor…
        </AppText>
      ) : friends.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={22} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" align="center">
            Henüz arkadaşın yok. Arkadaş ekledikçe konum paylaşımı izni ayrıca sorulur.
          </AppText>
        </View>
      ) : (
        friends.map((friend) => {
          const isSelected = selected.has(friend.id);
          return (
            <Pressable
              key={friend.id}
              accessibilityRole={selectable ? 'checkbox' : 'button'}
              accessibilityState={selectable ? { checked: isSelected } : undefined}
              accessibilityLabel={friend.displayName}
              disabled={!selectable}
              onPress={() => {
                haptics.tap();
                onToggleSelect?.(friend.id);
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  borderColor: theme.colors.divider,
                  backgroundColor: isSelected ? theme.colors.primarySoft : pressed ? theme.colors.surfaceMuted : 'transparent',
                },
              ]}
            >
              <Avatar
                uri={mediaPublicUrl('avatar', friend.avatarPath)}
                name={friend.displayName}
                size={38}
                ring={isSelected}
              />
              <View style={styles.flex}>
                <View style={styles.nameRow}>
                  <AppText variant="body" numberOfLines={1}>
                    {friend.displayName}
                  </AppText>
                  {friend.isVerified ? (
                    <Ionicons name="shield-checkmark" size={13} color={theme.colors.success} />
                  ) : null}
                </View>
                <AppText variant="caption" color="textTertiary">
                  @{friend.username} · {friend.sharing ? 'konum paylaşıyor' : 'konum gizli'}
                </AppText>
              </View>
              {selectable ? (
                <View
                  style={[
                    styles.check,
                    {
                      backgroundColor: isSelected ? theme.colors.primaryDeep : 'transparent',
                      borderColor: isSelected ? theme.colors.primaryDeep : theme.colors.borderStrong,
                    },
                  ]}
                >
                  {isSelected ? <Ionicons name="checkmark" size={14} color={theme.colors.onPrimary} /> : null}
                </View>
              ) : (
                <View
                  style={[
                    styles.status,
                    { backgroundColor: friend.sharing ? `${theme.colors.success}1F` : theme.colors.surfaceMuted },
                  ]}
                >
                  <Ionicons
                    name={friend.sharing ? 'location' : 'eye-off-outline'}
                    size={13}
                    color={friend.sharing ? theme.colors.success : theme.colors.textTertiary}
                  />
                </View>
              )}
            </Pressable>
          );
        })
      )}

      <AppText variant="caption" color="textTertiary">
        Arkadaş olmak otomatik GPS paylaşımı anlamına gelmez. Konum yalnızca kişi açıkça paylaştığında ve süre dolmadan görünür.
      </AppText>
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  status: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 18 },
});
