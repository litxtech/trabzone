import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button } from '@/components/ui';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';
import { haptics } from '@/utils/haptics';

import { MAP_SHARE_DURATIONS } from '../constants';
import type { MapFriend, MapPreferences, MapVisibility } from '../types';
import { formatMinutesLeft } from '../utils/map-theme';
import { MapSheet } from './MapSheet';

const VISIBILITY: { key: MapVisibility; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; hint: string }[] = [
  { key: 'ghost', label: 'Görünmez', icon: 'eye-off-outline', hint: 'Hayalet modu' },
  { key: 'friends', label: 'Arkadaşlar', icon: 'people-outline', hint: 'Onaylı arkadaşlar' },
  { key: 'selected', label: 'Seçili kişiler', icon: 'person-add-outline', hint: 'Yalnızca seçtiklerin' },
];

const DURATION_LABEL: Record<number, string> = {
  15: '15 dk',
  60: '1 saat',
  180: '3 saat',
  480: '8 saat',
  1440: '24 saat',
};

export type StartShareInput = {
  minutes: number;
  audience: 'friends' | 'selected';
  precise: boolean;
  viewers: string[];
};

/**
 * Konum gizliliği ve güvenlik merkezi. Hayalet modu varsayılandır; paylaşım
 * süresi ve hassasiyeti kullanıcı tarafından açıkça seçilir. Bütün kararlar
 * sunucudaki RPC'lerde yeniden doğrulanır.
 */
export function MapPrivacySheet({
  visible,
  onClose,
  prefs,
  friends,
  friendsLoading,
  saving,
  shareBusy,
  shareError,
  locationStatus,
  onRequestLocation,
  onPatch,
  onStartShare,
  onStopShare,
  onPanic,
}: {
  visible: boolean;
  onClose: () => void;
  prefs: MapPreferences;
  friends: MapFriend[];
  friendsLoading: boolean;
  saving?: boolean;
  shareBusy?: boolean;
  shareError?: string | null;
  locationStatus: 'unknown' | 'granted' | 'denied' | 'unavailable';
  onRequestLocation: () => void;
  onPatch: (patch: {
    visibility?: MapVisibility;
    precision?: MapPreferences['precision'];
    default_share_minutes?: number;
    ghost_mode?: boolean;
  }) => void;
  onStartShare: (input: StartShareInput) => void;
  onStopShare: () => void;
  onPanic: () => void;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const [minutes, setMinutes] = useState(prefs.defaultShareMinutes);
  const [viewers, setViewers] = useState<string[]>(prefs.activeShare?.viewers ?? []);

  const activeShare = prefs.activeShare;
  const isGhost = prefs.ghostMode || prefs.visibility === 'ghost';
  const canShare = prefs.visibility !== 'ghost';

  const toggleViewer = (id: string) => {
    haptics.tap();
    setViewers((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title="Konum gizliliği"
      subtitle="Görünürlük, süre ve hassasiyet sende"
      footer={
        activeShare ? (
          <Button
            label="Konum paylaşımını durdur"
            variant="danger"
            loading={shareBusy}
            onPress={() => {
              haptics.press();
              onStopShare();
            }}
          />
        ) : (
          <Button
            label={
              locationStatus === 'denied'
                ? 'Ayarlardan konum izni ver'
                : locationStatus === 'unavailable'
                  ? 'Bu cihazda konum yok'
                  : locationStatus === 'granted'
                    ? canShare
                      ? 'Süreli konum paylaşımını başlat'
                      : 'Paylaşmak için görünürlük seç'
                    : 'Konum izni ver'
            }
            disabled={
              locationStatus === 'unavailable' ||
              (locationStatus === 'granted' && !canShare) ||
              (prefs.visibility === 'selected' && viewers.length === 0)
            }
            loading={shareBusy || saving}
            onPress={() => {
              haptics.tap();
              if (locationStatus === 'denied') {
                void Linking.openSettings();
                return;
              }
              if (locationStatus !== 'granted') {
                onRequestLocation();
                return;
              }
              onStartShare({
                minutes,
                audience: prefs.visibility === 'selected' ? 'selected' : 'friends',
                precise: prefs.precision === 'exact',
                viewers,
              });
            }}
          />
        )
      }
    >
      <View style={[styles.statusCard, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
        <View
          style={[
            styles.statusIcon,
            { backgroundColor: isGhost ? `${theme.colors.success}22` : `${theme.colors.warning}22` },
          ]}
        >
          <Ionicons
            name={isGhost ? 'eye-off-outline' : 'location'}
            size={18}
            color={isGhost ? theme.colors.success : theme.colors.warning}
          />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{isGhost ? 'Haritada görünmüyorsun' : 'Konum görünürlüğü açık'}</AppText>
          <AppText variant="caption" color="textSecondary">
            {activeShare
              ? `Aktif paylaşım · ${formatMinutesLeft(activeShare.expires_at) ?? '—'} kaldı · ${
                  activeShare.audience === 'selected' ? `${activeShare.viewers?.length ?? 0} kişi` : 'arkadaşlar'
                }`
              : isGhost
                ? 'Yeni hesaplar için varsayılan: Hayalet Modu'
                : 'Yalnızca seçtiğin kitle konumunu görebilir'}
          </AppText>
        </View>
      </View>

      {shareError ? (
        <AppText variant="caption" color="danger">
          {shareError}
        </AppText>
      ) : null}

      <View style={styles.section}>
        <AppText variant="label" color="textSecondary">
          Kimler görebilir?
        </AppText>
        <View style={styles.visibilityRow}>
          {VISIBILITY.map((item) => {
            const active = prefs.visibility === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                onPress={() => {
                  haptics.selection();
                  onPatch({ visibility: item.key, ghost_mode: item.key === 'ghost' });
                }}
                style={({ pressed }) => [
                  styles.visibilityItem,
                  {
                    backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surfaceMuted,
                    borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={17}
                  color={active ? theme.colors.onPrimary : theme.colors.textSecondary}
                />
                <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                  {item.label}
                </AppText>
                <AppText
                  variant="caption"
                  color={active ? 'onPrimary' : 'textTertiary'}
                  style={styles.visibilityHint}
                >
                  {item.hint}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {prefs.visibility === 'selected' ? (
        <View style={styles.section}>
          <AppText variant="label" color="textSecondary">
            Konumunu görebilecek kişiler
          </AppText>
          {friendsLoading ? (
            <AppText variant="caption" color="textTertiary">
              Arkadaşlar yükleniyor…
            </AppText>
          ) : friends.length === 0 ? (
            <AppText variant="caption" color="textTertiary">
              Kişi seçebilmek için önce arkadaş ekle.
            </AppText>
          ) : (
            friends.map((friend) => {
              const checked = viewers.includes(friend.id);
              return (
                <Pressable
                  key={friend.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={friend.displayName}
                  onPress={() => toggleViewer(friend.id)}
                  style={({ pressed }) => [
                    styles.friendRow,
                    {
                      borderColor: theme.colors.divider,
                      backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                    },
                  ]}
                >
                  <Avatar uri={mediaPublicUrl('avatar', friend.avatarPath)} name={friend.displayName} size={32} />
                  <View style={styles.flex}>
                    <AppText variant="caption" numberOfLines={1}>
                      {friend.displayName}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      @{friend.username}
                    </AppText>
                  </View>
                  <View
                    style={[
                      styles.check,
                      {
                        backgroundColor: checked ? theme.colors.primaryDeep : 'transparent',
                        borderColor: checked ? theme.colors.primaryDeep : theme.colors.borderStrong,
                      },
                    ]}
                  >
                    {checked ? <Ionicons name="checkmark" size={13} color={theme.colors.onPrimary} /> : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}

      <View style={styles.section}>
        <AppText variant="label" color="textSecondary">
          Konum hassasiyeti
        </AppText>
        <View style={styles.precisionRow}>
          {(
            [
              { key: 'approximate' as const, label: 'Yaklaşık bölge', hint: '~1 km yuvarlanır · önerilen' },
              { key: 'exact' as const, label: 'Hassas konum', hint: 'Açık izinle tam nokta' },
            ]
          ).map((option) => {
            const active = prefs.precision === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.selection();
                  onPatch({ precision: option.key });
                }}
                style={({ pressed }) => [
                  styles.precisionItem,
                  {
                    backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={17}
                  color={active ? theme.colors.primary : theme.colors.textTertiary}
                />
                <View style={styles.flex}>
                  <AppText variant="caption">{option.label}</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {option.hint}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {!activeShare ? (
        <View style={styles.section}>
          <AppText variant="label" color="textSecondary">
            Paylaşım süresi
          </AppText>
          <View style={styles.durationRow}>
            {MAP_SHARE_DURATIONS.map((value) => {
              const active = minutes === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    haptics.selection();
                    setMinutes(value);
                    onPatch({ default_share_minutes: value });
                  }}
                  style={[
                    styles.durationChip,
                    {
                      backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surfaceMuted,
                      borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                    {DURATION_LABEL[value] ?? `${value} dk`}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <AppText variant="caption" color="textTertiary">
            Süre dolduğunda erişim sunucuda otomatik kapanır. Dilediğin an durdurabilirsin.
          </AppText>
        </View>
      ) : null}

      <View style={styles.links}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onClose();
            router.push('/settings/privacy');
          }}
          style={[styles.linkRow, { borderColor: theme.colors.divider }]}
        >
          <Ionicons name="settings-outline" size={16} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Gizlilik ayarları
          </AppText>
          <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onClose();
            router.push('/support/create');
          }}
          style={[styles.linkRow, { borderColor: theme.colors.divider }]}
        >
          <Ionicons name="flag-outline" size={16} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Şikâyet veya itiraz oluştur
          </AppText>
          <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
        </Pressable>
      </View>

      <Button
        label="Tüm konum paylaşımını durdur"
        variant="outline"
        size="sm"
        leftIcon={<Ionicons name="hand-left-outline" size={16} color={theme.colors.danger} />}
        onPress={() => {
          haptics.press();
          onPanic();
        }}
      />

      <AppText variant="caption" color="textTertiary">
        Konum erişimi sunucu tarafında RLS ve yetkilendirilmiş RPC’lerle denetlenir. Admin paneli dahi özel GPS verisini
        gerekçesiz ve kayıt bırakmadan göremez.
      </AppText>
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 1 },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  section: { gap: 7 },
  visibilityRow: { flexDirection: 'row', gap: 7 },
  visibilityItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  visibilityHint: { fontSize: 8, textAlign: 'center' },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  precisionRow: { gap: 6 },
  precisionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  durationChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  links: { gap: 0 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
