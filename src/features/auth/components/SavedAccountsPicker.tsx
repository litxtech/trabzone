import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import type { SavedAccount } from '../saved-accounts';

type Props = {
  accounts: SavedAccount[];
  /** Oturumu açık olan hesap; tek dokunuşta doğrudan devam edilir. */
  activeId?: string | null;
  onPick: (account: SavedAccount) => void;
  onForget: (account: SavedAccount) => void;
};

const WEB_POINTER = Platform.OS === 'web' ? ({ cursor: 'pointer' } as unknown as object) : null;

/**
 * Giriş formunun üstündeki "bu cihazda" hesap seçici.
 *
 * Davranış: satıra dokunmak e-posta alanını doldurur; oturumu hâlâ açık olan
 * hesapta doğrudan uygulamaya geçilir. Sağdaki × hesabı bu cihazdan siler,
 * çıkış yapmış olsa bile diğer hesaplar listede kalır.
 */
export function SavedAccountsPicker({ accounts, activeId, onPick, onForget }: Props) {
  const { theme } = useTheme();

  if (accounts.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textSecondary} />
        <AppText variant="label" color="textSecondary" style={styles.headLabel}>
          Bu cihazda kayıtlı hesaplar
        </AppText>
      </View>

      <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        {accounts.map((account, index) => {
          const active = Boolean(activeId && account.id === activeId);
          return (
            <View
              key={account.id}
              style={[
                styles.rowWrap,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  active
                    ? `${account.name || account.email} hesabıyla devam et`
                    : `${account.email} e-postasını doldur`
                }
                onPress={() => {
                  haptics.selection();
                  onPick(account);
                }}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' },
                ]}
              >
                <Avatar
                  uri={mediaPublicUrl('avatar', account.avatarPath)}
                  name={account.name || account.email}
                  size={40}
                  recycleKey={account.id}
                />
                <View style={styles.body}>
                  <View style={styles.nameRow}>
                    <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                      {account.name || account.email}
                    </AppText>
                    {active ? (
                      <View style={[styles.badge, { backgroundColor: theme.colors.successSoft }]}>
                        <Ionicons name="checkmark-circle" size={11} color={theme.colors.success} />
                        <AppText variant="caption" color="success" style={styles.badgeText}>
                          Açık
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                    {account.email}
                  </AppText>
                </View>
                <View style={styles.action}>
                  <AppText variant="caption" color="primary">
                    {active ? 'Devam et' : 'Doldur'}
                  </AppText>
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.primary} />
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${account.email} hesabını bu cihazdan kaldır`}
                hitSlop={8}
                onPress={() => {
                  haptics.tap();
                  onForget(account);
                }}
                style={({ pressed }) => [styles.remove, { opacity: pressed ? 0.5 : 1 }]}
              >
                <Ionicons name="close" size={15} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          );
        })}
      </View>

      <AppText variant="caption" color="textTertiary">
        Bir hesaba dokunduğunda e-posta adresi doldurulur; şifren her zaman sende kalır.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headLabel: { letterSpacing: 0.2 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  rowWrap: { flexDirection: 'row', alignItems: 'center' },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 10,
    minHeight: 62,
    ...(WEB_POINTER ?? {}),
  },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: { fontSize: 10.5, lineHeight: 13 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  remove: {
    width: 34,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    ...(WEB_POINTER ?? {}),
  },
});
