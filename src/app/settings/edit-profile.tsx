import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/utils/router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  ActionSheet,
  AppText,
  Avatar,
  Button,
  Card,
  Screen,
  ScreenHeader,
  SelectSheet,
  Skeleton,
  TextField,
} from '@/components/ui';
import { PROVINCES } from '@/features/profile/constants/regions';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import {
  useChangeUsername,
  useRemoveProfileMedia,
  useUpdateProfile,
  useUploadProfileMedia,
  useUsernameChangeStatus,
} from '@/features/profile/hooks/use-profile-mutations';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

type Draft = {
  firstName: string;
  lastName: string;
  bio: string;
  city: string | null;
  district: string;
  website: string;
};

type FieldErrors = Partial<Record<'firstName' | 'lastName' | 'bio' | 'website', string>>;

const BIO_LIMIT = 300;

const EMPTY: Draft = {
  firstName: '',
  lastName: '',
  bio: '',
  city: null,
  district: '',
  website: '',
};

function formatCooldown(nextChangeAt: string | null): string {
  if (!nextChangeAt) {
    return 'Kullanıcı adı şu anda değiştirilemez.';
  }
  const date = new Date(nextChangeAt);
  if (Number.isNaN(date.getTime())) {
    return 'Kullanıcı adı şu anda değiştirilemez.';
  }
  const formatted = date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Haftada 1 kez değiştirilebilir · ${formatted} sonrasında tekrar dene`;
}

export default function EditProfileScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const { data: profile, isLoading, isError, refetch } = useMyProfile();
  const updateProfile = useUpdateProfile();
  const uploadMedia = useUploadProfileMedia();
  const removeMedia = useRemoveProfileMedia();
  const { data: usernameStatus } = useUsernameChangeStatus();
  const changeUsername = useChangeUsername();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [mediaSheet, setMediaSheet] = useState<'avatar' | 'cover' | null>(null);
  const [cityOpen, setCityOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const base = useMemo<Draft>(
    () =>
      profile
        ? {
            firstName: profile.first_name,
            lastName: profile.last_name,
            bio: profile.bio ?? '',
            city: profile.city ?? null,
            district: profile.district ?? '',
            website: profile.website ?? '',
          }
        : EMPTY,
    [profile],
  );

  const value = draft ?? base;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(base);
  const saving = updateProfile.isPending || uploadMedia.isPending || removeMedia.isPending;

  const patch = (next: Partial<Draft>) => {
    setDraft((current) => ({ ...(current ?? base), ...next }));
    setActionError(null);
  };

  const confirmDiscard = () => {
    const goBack = () => router.back();
    if (!dirty) {
      goBack();
      return;
    }
    Alert.alert('Değişiklikleri bırak', 'Kaydetmediğin değişiklikler kaybolacak.', [
      { text: 'Düzenlemeye dön', style: 'cancel' },
      { text: 'Bırak', style: 'destructive', onPress: goBack },
    ]);
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty) {
        return false;
      }
      confirmDiscard();
      return true;
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (value.firstName.trim().length < 1 || value.firstName.trim().length > 60) {
      next.firstName = 'Ad 1-60 karakter arasında olmalı.';
    }
    if (value.lastName.trim().length < 1 || value.lastName.trim().length > 60) {
      next.lastName = 'Soyad 1-60 karakter arasında olmalı.';
    }
    if (value.bio.length > BIO_LIMIT) {
      next.bio = `Biyografi en fazla ${BIO_LIMIT} karakter olabilir.`;
    }
    const site = value.website.trim();
    if (site.length > 0 && !/^https?:\/\/[^\s]+\.[^\s]+/.test(site)) {
      next.website = 'https:// ile başlayan geçerli bir adres gir.';
    }
    return next;
  };

  const save = async () => {
    const validation = validate();
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      haptics.error();
      return;
    }

    try {
      await updateProfile.mutateAsync({
        firstName: value.firstName,
        lastName: value.lastName,
        bio: value.bio,
        city: value.city,
        district: value.district,
        website: value.website,
      });
      haptics.success();
      setDraft(null);
      router.back();
    } catch (error) {
      haptics.error();
      setActionError(error instanceof Error ? error.message : 'Profil kaydedilemedi.');
    }
  };

  const applyUsername = async (next: string) => {
    try {
      await changeUsername.mutateAsync(next);
      haptics.success();
      setUsernameDraft(null);
      setUsernameError(null);
    } catch (error) {
      haptics.error();
      setUsernameError(error instanceof Error ? error.message : 'Kullanıcı adı değiştirilemedi.');
    }
  };

  const submitUsername = () => {
    const next = (usernameDraft ?? '').trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(next)) {
      setUsernameError('3-24 karakter; küçük harf, rakam, nokta ve alt çizgi kullan.');
      return;
    }
    if (next === profile?.username) {
      setUsernameError('Bu zaten mevcut kullanıcı adın.');
      return;
    }
    setUsernameError(null);
    Alert.alert(
      'Kullanıcı adını değiştir',
      `@${next} adresini kullanmak istediğine emin misin? Kullanıcı adı haftada yalnızca bir kez değiştirilebilir.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Değiştir', onPress: () => void applyUsername(next) },
      ],
    );
  };

  const pickImage = async (kind: 'avatar' | 'cover', source: 'library' | 'camera') => {
    setMediaSheet(null);
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setActionError(
          source === 'camera'
            ? 'Kamera izni verilmedi. Ayarlardan izin verebilirsin.'
            : 'Galeri izni verilmedi. Ayarlardan izin verebilirsin.',
        );
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 1,
        exif: false,
        allowsEditing: source === 'library',
        ...(kind === 'avatar' ? { aspect: [1, 1] as [number, number] } : {}),
      };

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      await uploadMedia.mutateAsync({
        kind,
        uri: asset.uri,
        size: asset.fileSize,
        mime: asset.mimeType ?? 'image/jpeg',
      });
      haptics.success();
    } catch (error) {
      haptics.error();
      setActionError(
        error instanceof Error ? error.message : 'Fotoğraf yüklenemedi. Tekrar dene.',
      );
    }
  };

  const removePhoto = async (kind: 'avatar' | 'cover', currentPath: string | null) => {
    setMediaSheet(null);
    try {
      await removeMedia.mutateAsync({ kind, currentPath });
      haptics.selection();
    } catch (error) {
      haptics.error();
      setActionError(error instanceof Error ? error.message : 'Fotoğraf kaldırılamadı.');
    }
  };

  const avatarUrl = mediaPublicUrl('avatar', profile?.avatar_path);
  const coverUrl = mediaPublicUrl('cover', profile?.cover_path);
  const fullName = `${value.firstName} ${value.lastName}`.trim();

  if (isLoading) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <ScreenHeader title="Profili düzenle" onBack={() => router.back()} />
        <View style={styles.skeleton}>
          <Skeleton height={140} radius={22} />
          <Skeleton height={92} radius={18} />
          <Skeleton height={92} radius={18} />
        </View>
      </Screen>
    );
  }

  if (isError || !profile) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <ScreenHeader title="Profili düzenle" onBack={() => router.back()} />
        <Card style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
          <AppText variant="bodyStrong">Profil yüklenemedi</AppText>
          <Button label="Tekrar dene" variant="secondary" onPress={() => void refetch()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll keyboardAware>
      <ScreenHeader title="Profili düzenle" onBack={confirmDiscard} />

      {/* Kapak + avatar */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Kapak fotoğrafını değiştir"
        onPress={() => setMediaSheet('cover')}
        style={styles.cover}
      >
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <LinearGradient
            colors={theme.gradients.aurora}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View style={styles.coverBadge}>
          <Ionicons name="camera-outline" size={15} color="#FFFFFF" />
          <AppText variant="caption" style={styles.coverBadgeText}>
            Kapak fotoğrafı
          </AppText>
        </View>
      </Pressable>

      <View style={styles.avatarRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profil fotoğrafını değiştir"
          onPress={() => setMediaSheet('avatar')}
          disabled={uploadMedia.isPending || removeMedia.isPending}
        >
          <Avatar uri={avatarUrl} name={fullName} size={86} ring />
          <View
            style={[
              styles.avatarBadge,
              { backgroundColor: theme.colors.primaryDeep, borderColor: theme.colors.background },
            ]}
          >
            {uploadMedia.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            )}
          </View>
        </Pressable>
        <View style={styles.avatarHint}>
          <AppText variant="caption" color="textSecondary">
            Fotoğrafa dokunarak değiştir
          </AppText>
          <AppText variant="caption" color="textTertiary">
            Kare kırpılır · 512×512 olarak yüklenir
          </AppText>
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="h3">Kimlik</AppText>
        <Card style={styles.card}>
          <TextField
            label="Ad"
            value={value.firstName}
            onChangeText={(text) => patch({ firstName: text })}
            error={errors.firstName}
            maxLength={60}
            leftIcon="person-outline"
            autoCapitalize="words"
            textContentType="givenName"
          />
          <TextField
            label="Soyad"
            value={value.lastName}
            onChangeText={(text) => patch({ lastName: text })}
            error={errors.lastName}
            maxLength={60}
            leftIcon="person-outline"
            autoCapitalize="words"
            textContentType="familyName"
          />
          {usernameDraft === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kullanıcı adını değiştir"
              disabled={!usernameStatus?.can_change}
              onPress={() => {
                setUsernameError(null);
                setUsernameDraft(profile.username);
              }}
              style={[
                styles.lockedRow,
                {
                  backgroundColor: theme.colors.surfaceMuted,
                  borderRadius: theme.radius.sm,
                },
              ]}
            >
              <Ionicons name="at" size={16} color={theme.colors.textTertiary} />
              <View style={styles.lockedText}>
                <AppText variant="bodyStrong">@{profile.username}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {usernameStatus?.can_change
                    ? usernameStatus.credits > 0 && usernameStatus.last_changed_at
                      ? `Haftalık süre dolmadı · ${usernameStatus.credits} ek hakkın var`
                      : 'Kullanıcı adını değiştirebilirsin'
                    : formatCooldown(usernameStatus?.next_change_at ?? null)}
                </AppText>
              </View>
              {usernameStatus?.can_change ? (
                <AppText variant="label" color="primaryDeep">
                  Değiştir
                </AppText>
              ) : (
                <Ionicons name="lock-closed-outline" size={15} color={theme.colors.textTertiary} />
              )}
            </Pressable>
          ) : (
            <View style={styles.usernameEditor}>
              <TextField
                label="Yeni kullanıcı adı"
                value={usernameDraft}
                onChangeText={(text) => {
                  setUsernameDraft(text.toLowerCase());
                  setUsernameError(null);
                }}
                error={usernameError}
                hint="3-24 karakter · küçük harf, rakam, nokta ve alt çizgi"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={24}
                leftIcon="at"
              />
              <View style={styles.usernameActions}>
                <Button
                  label="Vazgeç"
                  variant="secondary"
                  onPress={() => {
                    setUsernameDraft(null);
                    setUsernameError(null);
                  }}
                  style={styles.flex}
                />
                <Button
                  label="Kaydet"
                  onPress={submitUsername}
                  loading={changeUsername.isPending}
                  style={styles.flex}
                />
              </View>
            </View>
          )}
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="h3">Hakkında</AppText>
        <Card style={styles.card}>
          <TextField
            label="Biyografi"
            value={value.bio}
            onChangeText={(text) => patch({ bio: text.slice(0, BIO_LIMIT + 20) })}
            error={errors.bio}
            hint={`${value.bio.length}/${BIO_LIMIT}`}
            multiline
            maxLength={BIO_LIMIT + 20}
            placeholder="Kendini birkaç cümleyle anlat."
            containerStyle={styles.bioField}
          />
          <TextField
            label="Web sitesi"
            value={value.website}
            onChangeText={(text) => patch({ website: text })}
            error={errors.website}
            placeholder="https://ornek.com"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            leftIcon="link-outline"
            maxLength={120}
          />
        </Card>
      </View>

      <View style={styles.section}>
        <AppText variant="h3">Konum</AppText>
        <Card style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Şehir seç"
            onPress={() => setCityOpen(true)}
            style={[
              styles.selectRow,
              {
                backgroundColor: theme.colors.inputBackground,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
              },
            ]}
          >
            <Ionicons name="location-outline" size={19} color={theme.colors.textTertiary} />
            <View style={styles.selectText}>
              <AppText variant="caption" color="textSecondary">
                Şehir
              </AppText>
              <AppText variant="body" color={value.city ? 'text' : 'textTertiary'}>
                {value.city ?? 'Seçilmedi'}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
          </Pressable>

          <TextField
            label="İlçe"
            value={value.district}
            onChangeText={(text) => patch({ district: text })}
            placeholder="Örn. Ortahisar"
            leftIcon="map-outline"
            maxLength={60}
            autoCapitalize="words"
          />

          <View style={styles.locationNote}>
            <Ionicons name="eye-off-outline" size={13} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" style={styles.flex}>
              Konumun yalnızca gizlilik ayarlarında izin verdiğin kişilere gösterilir.
            </AppText>
          </View>
        </Card>
      </View>

      {actionError ? (
        <View
          style={[
            styles.errorBox,
            { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            {actionError}
          </AppText>
        </View>
      ) : null}

      <Button
        label="Değişiklikleri kaydet"
        onPress={() => void save()}
        loading={saving}
        disabled={!dirty && !saving}
        style={styles.saveButton}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Gizlilik ayarlarını aç"
        onPress={() => router.push('/settings/privacy')}
        style={styles.privacyLink}
      >
        <Ionicons name="lock-closed-outline" size={15} color={theme.colors.primaryDeep} />
        <AppText variant="label" color="primaryDeep">
          Kimler profilimi görebilir?
        </AppText>
      </Pressable>

      <ActionSheet
        visible={mediaSheet !== null}
        title={mediaSheet === 'avatar' ? 'Profil fotoğrafı' : 'Kapak fotoğrafı'}
        items={[
          { key: 'library', label: 'Galeriden seç', icon: 'images-outline' },
          { key: 'camera', label: 'Kamerayla çek', icon: 'camera-outline' },
          ...(mediaSheet === 'avatar' && profile.avatar_path
            ? [
                {
                  key: 'remove',
                  label: 'Fotoğrafı kaldır',
                  icon: 'trash-outline' as const,
                  destructive: true,
                },
              ]
            : []),
          ...(mediaSheet === 'cover' && profile.cover_path
            ? [
                {
                  key: 'remove',
                  label: 'Kapak fotoğrafını kaldır',
                  icon: 'trash-outline' as const,
                  destructive: true,
                },
              ]
            : []),
        ]}
        onClose={() => setMediaSheet(null)}
        onSelect={(key) => {
          const kind = mediaSheet;
          if (!kind) {
            return;
          }
          if (key === 'library' || key === 'camera') {
            void pickImage(kind, key);
            return;
          }
          void removePhoto(kind, kind === 'avatar' ? profile.avatar_path : profile.cover_path);
        }}
      />

      <SelectSheet
        visible={cityOpen}
        title="Şehir seç"
        options={PROVINCES}
        value={value.city}
        emptyLabel="Bu isimde bir il bulunamadı."
        onClose={() => setCityOpen(false)}
        onSelect={(city) => {
          patch({ city });
          setCityOpen(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skeleton: { gap: 12 },
  errorCard: { alignItems: 'center', gap: 10 },
  cover: {
    height: 140,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 10,
  },
  coverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(9,16,30,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  coverBadgeText: { color: '#FFFFFF' },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: -30 },
  avatarBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  avatarHint: { flex: 1, paddingBottom: 6, gap: 1 },
  section: { gap: 8, marginTop: 20 },
  card: { gap: 12 },
  bioField: { marginBottom: 2 },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  lockedText: { flex: 1, gap: 1 },
  usernameEditor: { gap: 10 },
  usernameActions: { flexDirection: 'row', gap: 8 },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
  },
  selectText: { flex: 1, gap: 1 },
  locationNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 18,
  },
  saveButton: { marginTop: 22 },
  privacyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
});
