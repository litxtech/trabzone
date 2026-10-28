import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Card, Screen, ScreenHeader, Skeleton } from '@/components/ui';
import {
  useMyPrivacySettings,
  useUpdatePrivacySettings,
} from '@/features/profile/hooks/use-profile-mutations';
import type { PrivacySettings } from '@/features/profile/services/profile-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: 'Herkes',
    hint: 'Profilin Trabzone’daki tüm üyelere açık.',
  },
  {
    value: 'followers',
    label: 'Takipçilerim',
    hint: 'Yalnızca seni takip edenler biyografini ve gönderilerini görür.',
  },
  {
    value: 'private',
    label: 'Yalnızca arkadaşlarım',
    hint: 'Profilin yalnızca arkadaşlık isteğini kabul ettiklerine görünür.',
  },
] as const;

const MESSAGE_OPTIONS = [
  { value: 'everyone', label: 'Herkes', hint: 'Tüm üyeler mesaj gönderebilir.' },
  { value: 'friends', label: 'Arkadaşlarım', hint: 'Yalnızca arkadaşların mesaj gönderebilir.' },
  { value: 'nobody', label: 'Kimse', hint: 'Doğrudan mesajlar kapalı.' },
] as const;

export default function PrivacySettingsScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const { data: settings, isLoading, isError, refetch } = useMyPrivacySettings();
  const update = useUpdatePrivacySettings();
  const [error, setError] = useState<string | null>(null);

  const change = (patch: Partial<PrivacySettings>) => {
    setError(null);
    update.mutate(patch, {
      onSuccess: () => haptics.selection(),
      onError: (mutationError) => {
        haptics.error();
        setError(mutationError.message);
      },
    });
  };

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <ScreenHeader
        title="Gizlilik"
        subtitle="Kimler seni görebilir ve sana ulaşabilir"
        onBack={() => router.back()}
      />

      {isLoading ? (
        <View style={styles.skeleton}>
          <Skeleton height={140} radius={18} />
          <Skeleton height={140} radius={18} />
          <Skeleton height={96} radius={18} />
        </View>
      ) : isError || !settings ? (
        <Card style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
          <AppText variant="bodyStrong">Ayarlar yüklenemedi</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tekrar dene"
            onPress={() => void refetch()}
            style={({ pressed }) => [
              styles.retry,
              { backgroundColor: theme.colors.primarySoft, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <AppText variant="label" color="primaryDeep">
              Tekrar dene
            </AppText>
          </Pressable>
        </Card>
      ) : (
        <>
          <View style={styles.section}>
            <AppText variant="h3">Profil görünürlüğü</AppText>
            <Card style={styles.card}>
              {VISIBILITY_OPTIONS.map((option) => (
                <Choice
                  key={option.value}
                  label={option.label}
                  hint={option.hint}
                  selected={settings.profile_visibility === option.value}
                  disabled={update.isPending}
                  onPress={() => change({ profile_visibility: option.value })}
                />
              ))}
            </Card>
            <AppText variant="caption" color="textTertiary">
              Profil fotoğrafın ve kullanıcı adın her durumda görünür kalır.
            </AppText>
          </View>

          <View style={styles.section}>
            <AppText variant="h3">Harita konum gizliliği</AppText>
            <Card style={styles.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Etkileşim haritasında konum gizliliğini yönet"
                onPress={() => router.push('/map' as never)}
                style={({ pressed }) => [styles.mapRow, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Ionicons name="map-outline" size={20} color={theme.colors.primaryDeep} />
                <View style={styles.mapRowText}>
                  <AppText variant="bodyStrong">Hayalet modu ve konum paylaşımı</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Görünürlük, süre ve hassasiyet harita güvenlik merkezinde yönetilir.
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            </Card>
          </View>

          <View style={styles.section}>
            <AppText variant="h3">Kimler ulaşabilir?</AppText>
            <Card style={styles.card}>
              <Toggle
                icon="person-add-outline"
                label="Arkadaşlık istekleri"
                description="Kapalıyken kimse sana arkadaşlık isteği gönderemez."
                value={settings.allow_friend_requests}
                disabled={update.isPending}
                onChange={(value) => change({ allow_friend_requests: value })}
              />
            </Card>

            <AppText variant="label" color="textSecondary" style={styles.groupLabel}>
              Doğrudan mesajlar
            </AppText>
            <Card style={styles.card}>
              {MESSAGE_OPTIONS.map((option) => (
                <Choice
                  key={option.value}
                  label={option.label}
                  hint={option.hint}
                  selected={settings.allow_messages_from === option.value}
                  disabled={update.isPending}
                  onPress={() => change({ allow_messages_from: option.value })}
                />
              ))}
            </Card>
          </View>

          <View style={styles.section}>
            <AppText variant="h3">Konum ve keşif</AppText>
            <Card style={styles.card}>
              <Toggle
                icon="compass-outline"
                label="Keşfette görün"
                description="Arkadaş önerilerinde ve aramalarda listelenirsin."
                value={settings.discoverable}
                disabled={update.isPending}
                onChange={(value) => change({ discoverable: value })}
              />
              <Toggle
                icon="location-outline"
                label="Şehir"
                description="Profilinde şehir bilgin görünür."
                value={settings.show_city}
                disabled={update.isPending}
                onChange={(value) => change({ show_city: value })}
              />
              <Toggle
                icon="map-outline"
                label="İlçe"
                description="Profilinde ilçe bilgin görünür."
                value={settings.show_district}
                disabled={update.isPending}
                onChange={(value) => change({ show_district: value })}
              />
            </Card>
          </View>

          <View style={styles.section}>
            <AppText variant="h3">Etkinlik</AppText>
            <Card style={styles.card}>
              <Toggle
                icon="eye-outline"
                label="Çevrimiçi durumu"
                description="Diğerleri çevrimiçi olduğunu görebilir."
                value={settings.show_online_status}
                disabled={update.isPending}
                onChange={(value) => change({ show_online_status: value })}
              />
              <Toggle
                icon="time-outline"
                label="Son görülme"
                description="En son ne zaman aktif olduğun paylaşılır."
                value={settings.show_last_seen}
                disabled={update.isPending}
                onChange={(value) => change({ show_last_seen: value })}
              />
              <Toggle
                icon="checkmark-done-outline"
                label="Okundu bilgisi"
                description="Mesajları okuduğunda karşı taraf görür."
                value={settings.read_receipts}
                disabled={update.isPending}
                onChange={(value) => change({ read_receipts: value })}
              />
            </Card>
          </View>

          {error ? (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}

          <View style={styles.note}>
            <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.primary} />
            <AppText variant="caption" color="textTertiary" style={styles.flex}>
              Engellediğin kişiler profilinizi hiçbir koşulda göremez. Çocuk korumalı hesaplarda
              gizlilik ayarları sistem tarafından sabitlenir.
            </AppText>
          </View>
        </>
      )}
    </Screen>
  );
}

function Choice({
  label,
  hint,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceMuted,
          opacity: pressed || disabled ? 0.75 : 1,
        },
      ]}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={18}
        color={selected ? theme.colors.primaryDeep : theme.colors.textTertiary}
      />
      <View style={styles.flex}>
        <AppText variant="bodyStrong" color={selected ? 'primaryDeep' : 'text'}>
          {label}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {hint}
        </AppText>
      </View>
    </Pressable>
  );
}

function Toggle({
  icon,
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={[styles.toggleIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={17} color={theme.colors.primaryDeep} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" color="textSecondary">
          {description}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skeleton: { gap: 12, paddingTop: 6 },
  errorCard: { alignItems: 'center', gap: 10, marginTop: 20 },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  section: { gap: 8, marginTop: 18 },
  card: { gap: 10, paddingVertical: 14 },
  groupLabel: { marginTop: 4 },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 2 },
  mapRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 2 },
  mapRowText: { flex: 1, gap: 2 },
  toggleIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 16,
  },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 16 },
});
