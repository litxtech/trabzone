import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Badge, Button, Card, TextField } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { ChildProtectedBadge } from '@/features/safety/components/ChildProtectedBadge';
import { ChildSafetyInfoSheet } from '@/features/safety/components/ChildSafetyInfoSheet';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import {
  CALL_POLICY_OPTIONS,
  COMMENT_POLICY_OPTIONS,
  DM_POLICY_OPTIONS,
  SAFETY_COMMITMENTS,
  SUPPORT_EMAIL,
} from '@/features/safety/constants';
import { useSafetyState } from '@/features/safety/hooks/use-safety';
import {
  useRequestGuardianConsent,
  useRevokeGuardianConsent,
  useSetBirthDate,
  useUpdateChildSettings,
} from '@/features/safety/hooks/use-safety-mutations';
import type { ChildSettingsPatch } from '@/features/safety/services/safety-service';
import { contactSupportByEmail } from '@/features/safety/utils/contact';
import { useTheme } from '@/theme/ThemeProvider';
import {
  ageFromBirthDate,
  birthDateToInput,
  formatDateTimeTr,
  inputToBirthDate,
} from '@/utils/date';
import { haptics } from '@/utils/haptics';

export default function ChildSafetySettingsScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const { data: state, isLoading, isError, refetch } = useSafetyState();
  const setBirthDate = useSetBirthDate();
  const updateSettings = useUpdateChildSettings();
  const requestConsent = useRequestGuardianConsent();
  const revokeConsent = useRevokeGuardianConsent();

  const [birthInput, setBirthInput] = useState<string | null>(null);
  const [birthError, setBirthError] = useState<string | null>(null);
  const [guardianOpen, setGuardianOpen] = useState(false);
  const [guardianEmail, setGuardianEmail] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianRelation, setGuardianRelation] = useState('');
  const [guardianError, setGuardianError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // `null` means "untouched": the field mirrors the saved birth date until the
  // user starts typing, which avoids syncing server state through an effect.
  const birthDateValue =
    birthInput ?? (state?.birth_date ? birthDateToInput(state.birth_date) : '');

  const isProtected = state?.is_child_protected ?? false;
  const age = ageFromBirthDate(state?.birth_date);
  const guardianStatus = state?.guardian.status ?? 'none';
  const guardianPending = guardianStatus === 'pending';
  const guardianVerified = guardianStatus === 'verified';

  const saveBirthDate = async () => {
    setBirthError(null);
    const iso = inputToBirthDate(birthDateValue);
    if (!iso) {
      setBirthError('Geçerli bir tarih gir (GG.AA.YYYY).');
      haptics.warning();
      return;
    }
    try {
      await setBirthDate.mutateAsync(iso);
      haptics.success();
    } catch (error) {
      haptics.error();
      setBirthError(
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Doğum tarihi kaydedilemedi.',
      );
    }
  };

  const changeSetting = (input: ChildSettingsPatch) => {
    setActionError(null);
    updateSettings.mutate(input, {
      onSuccess: () => haptics.selection(),
      onError: (error) => {
        haptics.error();
        setActionError(error.message);
      },
    });
  };

  const submitGuardian = async () => {
    setGuardianError(null);
    const email = guardianEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setGuardianError('Velinin geçerli bir e-posta adresini gir.');
      haptics.warning();
      return;
    }
    try {
      await requestConsent.mutateAsync({
        email,
        name: guardianName.trim() || undefined,
        relation: guardianRelation.trim() || undefined,
      });
      haptics.success();
      setGuardianOpen(false);
      setGuardianEmail('');
      setGuardianName('');
      setGuardianRelation('');
      Alert.alert(
        'Talep oluşturuldu',
        'Veline onay bağlantısı gönderilecek. Onay tamamlanana kadar hesabın korumalı kalır.',
      );
    } catch (error) {
      haptics.error();
      setGuardianError(
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Talep oluşturulamadı.',
      );
    }
  };

  const confirmRevoke = () => {
    Alert.alert(
      'Veli onayını kaldır',
      'Veli onayını kaldırırsan hesabın korumalı kalmaya devam eder ancak veli bağlantısı sona erer. Devam etmek istiyor musun?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: () =>
            revokeConsent.mutate(undefined, {
              onError: (error) => setActionError(error.message),
            }),
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <SafetyHeader title="Güvenlik ve gizlilik" />
        <View style={styles.center}>
          <AppText variant="caption" color="textTertiary">
            Yükleniyor…
          </AppText>
        </View>
      </Screen>
    );
  }

  if (isError || !state) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <SafetyHeader title="Güvenlik ve gizlilik" />
        <Card style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
          <AppText variant="bodyStrong">Bilgiler yüklenemedi</AppText>
          <Button label="Tekrar dene" variant="secondary" size="md" onPress={() => void refetch()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded keyboardAware>
      <SafetyHeader title="Güvenlik ve gizlilik" subtitle="Yaş doğrulama ve çocuk koruması" />

      {isProtected ? (
        <ChildProtectedBadge variant="card" onPress={() => setInfoOpen(true)} />
      ) : (
        <Card tone="muted" elevated={false} style={styles.neutralCard}>
          <View style={styles.rowBetween}>
            <View style={styles.rowLeft}>
              <Ionicons name="lock-open-outline" size={18} color={theme.colors.textSecondary} />
              <AppText variant="bodyStrong">Standart gizlilik ayarları</AppText>
            </View>
            {age != null ? <Badge label={`${age} yaş`} tone="neutral" /> : null}
          </View>
          <AppText variant="caption" color="textSecondary">
            18 yaş altında bir hesap kullanıyorsan doğum tarihini girdiğinde korumalar otomatik
            olarak devreye girer.
          </AppText>
        </Card>
      )}

      <View style={styles.section}>
        <AppText variant="h3">Yaş doğrulama</AppText>
        <Card style={styles.birthCard}>
          <AppText variant="caption" color="textSecondary">
            {state.birth_date_set
              ? 'Doğum tarihin kayıtlı. Yanlış girdiysen destek ekibimizle iletişime geçebilirsin.'
              : 'Doğum tarihini bir kez gir. 13 yaşından küçük hesaplar oluşturulamaz.'}
          </AppText>

          {state.birth_date_set ? (
            <View style={styles.birthRow}>
              <View
                style={[
                  styles.birthValue,
                  { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.sm },
                ]}
              >
                <Ionicons name="calendar-outline" size={16} color={theme.colors.textSecondary} />
                <AppText variant="bodyStrong">{formatDateTimeTr(state.birth_date).split(',')[0]}</AppText>
              </View>
              <View style={styles.ageGroup}>
                <Badge
                  label={
                    state.age_group === 'child'
                      ? '18 yaş altı'
                      : state.age_group === 'adult'
                        ? '18 yaş ve üzeri'
                        : 'Belirsiz'
                  }
                  tone={state.age_group === 'child' ? 'primary' : 'success'}
                />
              </View>
            </View>
          ) : (
            <>
              <TextField
                label="Doğum tarihi"
                placeholder="GG.AA.YYYY"
                value={birthDateValue}
                onChangeText={setBirthInput}
                keyboardType="numbers-and-punctuation"
                leftIcon="calendar-outline"
                error={birthError}
                hint="Örn. 14.03.2011"
                maxLength={10}
              />
              <Button
                label="Doğum tarihini kaydet"
                loading={setBirthDate.isPending}
                onPress={() => void saveBirthDate()}
              />
            </>
          )}

          <AppText variant="caption" color="textTertiary">
            Minimum yaş: {state.min_age} · Yetişkinlik yaşı: {state.adult_age} · Ülke:{' '}
            {state.country_code}
          </AppText>
        </Card>
      </View>

      {isProtected ? (
        <>
          <View style={styles.section}>
            <AppText variant="h3">Kimler ulaşabilir?</AppText>

            <SettingGroup
              title="Mesajlar"
              description="Sana kimler doğrudan mesaj gönderebilir."
              options={DM_POLICY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                hint: option.hint,
              }))}
              value={state.protection.dm_policy}
              disabled={updateSettings.isPending}
              onChange={(value) =>
                changeSetting({ dmPolicy: value as NonNullable<ChildSettingsPatch['dmPolicy']> })
              }
              icon="chatbubbles-outline"
            />

            <SettingGroup
              title="Aramalar"
              description="Seni kimler arayabilir."
              options={CALL_POLICY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                hint: option.hint,
              }))}
              value={state.protection.call_policy}
              disabled={updateSettings.isPending}
              onChange={(value) =>
                changeSetting({ callPolicy: value as NonNullable<ChildSettingsPatch['callPolicy']> })
              }
              icon="call-outline"
            />

            <SettingGroup
              title="Yorumlar"
              description="Gönderilerine kimler yorum yapabilir."
              options={COMMENT_POLICY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                hint: option.hint,
              }))}
              value={state.protection.comment_policy}
              disabled={updateSettings.isPending}
              onChange={(value) =>
                changeSetting({
                  commentPolicy: value as NonNullable<ChildSettingsPatch['commentPolicy']>,
                })
              }
              icon="chatbubble-ellipses-outline"
            />
          </View>

          <View style={styles.section}>
            <AppText variant="h3">Gizlilik</AppText>
            <Card style={styles.toggleCard}>
              <View style={styles.rowBetween}>
                <View style={styles.rowLeft}>
                  <View style={[styles.toggleIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="location-outline" size={17} color={theme.colors.primaryDeep} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">Konum paylaşımı</AppText>
                    <AppText variant="caption" color="textSecondary">
                      Haritada görünme ve canlı konum paylaşımı
                    </AppText>
                  </View>
                </View>
                <Switch
                  value={Boolean(state.protection.location_sharing)}
                  disabled
                  trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
                />
              </View>

              <View style={[styles.lockedNote, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name="lock-closed" size={13} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  Konum paylaşımı çocuk korumalı hesaplarda kapalıdır ve açılamaz.
                </AppText>
              </View>
            </Card>

            <Card style={styles.toggleCard}>
              <View style={styles.rowBetween}>
                <View style={styles.rowLeft}>
                  <View style={[styles.toggleIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="eye-off-outline" size={17} color={theme.colors.primaryDeep} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">Gizli profil</AppText>
                    <AppText variant="caption" color="textSecondary">
                      Profilin yalnızca arkadaşlarına görünür
                    </AppText>
                  </View>
                </View>
                <Badge label="Zorunlu" tone="neutral" />
              </View>
            </Card>
          </View>

          <View style={styles.section}>
            <AppText variant="h3">Veli onayı</AppText>
            <Card style={styles.guardianCard}>
              <View style={styles.rowBetween}>
                <View style={styles.rowLeft}>
                  <View
                    style={[
                      styles.guardianIcon,
                      {
                        backgroundColor: guardianVerified
                          ? theme.colors.successSoft
                          : guardianPending
                            ? theme.colors.warningSoft
                            : theme.colors.surfaceMuted,
                      },
                    ]}
                  >
                    <Ionicons
                      name={guardianVerified ? 'checkmark-circle' : 'people-outline'}
                      size={20}
                      color={
                        guardianVerified
                          ? theme.colors.success
                          : guardianPending
                            ? theme.colors.warning
                            : theme.colors.textSecondary
                      }
                    />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">
                      {guardianVerified
                        ? 'Veli onayı tamamlandı'
                        : guardianPending
                          ? 'Veli onayı bekleniyor'
                          : 'Veli onayı gerekli'}
                    </AppText>
                    <AppText variant="caption" color="textSecondary">
                      {guardianVerified
                        ? `Onay: ${formatDateTimeTr(state.guardian.verified_at)}`
                        : guardianPending
                          ? `Talep: ${formatDateTimeTr(state.guardian.requested_at)} · ${state.guardian.guardian_email_masked ?? ''}`
                          : `${state.min_age}-${state.adult_age - 1} yaş arası hesaplar için veli onayı gerekir.`}
                    </AppText>
                  </View>
                </View>
              </View>

              {guardianVerified ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Veli onayını kaldır"
                  onPress={confirmRevoke}
                  style={styles.linkRow}
                >
                  <AppText variant="caption" color="textTertiary">
                    Veli bağlantısını kaldır
                  </AppText>
                </Pressable>
              ) : (
                <Button
                  label={guardianPending ? 'Yeni talep oluştur' : 'Veli onayı talep et'}
                  variant={guardianPending ? 'secondary' : 'primary'}
                  onPress={() => setGuardianOpen((value) => !value)}
                  leftIcon={
                    <Ionicons
                      name="person-add-outline"
                      size={17}
                      color={guardianPending ? theme.colors.primaryDeep : '#FFFFFF'}
                    />
                  }
                />
              )}

              {guardianOpen && !guardianVerified ? (
                <View style={styles.guardianForm}>
                  <TextField
                    label="Velinin e-posta adresi"
                    placeholder="ornek@eposta.com"
                    value={guardianEmail}
                    onChangeText={setGuardianEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    leftIcon="mail-outline"
                    error={guardianError}
                  />
                  <TextField
                    label="Velinin adı (isteğe bağlı)"
                    value={guardianName}
                    onChangeText={setGuardianName}
                    maxLength={80}
                  />
                  <TextField
                    label="Yakınlık (isteğe bağlı)"
                    placeholder="Anne, baba, vasi…"
                    value={guardianRelation}
                    onChangeText={setGuardianRelation}
                    maxLength={40}
                  />
                  <Button
                    label="Onay talebi gönder"
                    loading={requestConsent.isPending}
                    onPress={() => void submitGuardian()}
                  />
                  <AppText variant="caption" color="textTertiary">
                    Veline, hesabın için onay bağlantısı içeren bir e-posta gönderilir. Bağlantı 7
                    gün geçerlidir.
                  </AppText>
                </View>
              ) : null}

              {guardianStatus === 'revoked' ? (
                <AppText variant="caption" color="warning">
                  Veli onayı kaldırıldı. Korumalar devam ediyor; yeni onay talebi oluşturabilirsin.
                </AppText>
              ) : null}
            </Card>
          </View>
        </>
      ) : null}

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

      <View style={styles.section}>
        <AppText variant="h3">Yardım ve politika</AppText>
        <MenuLink
          icon="shield-checkmark-outline"
          label="Çocuk güvenliği politikası"
          onPress={() => router.push('/policy/child-safety')}
        />
        <MenuLink
          icon="flag-outline"
          label="Çocuk güvenliği bildirimi yap"
          onPress={() => router.push('/support/create?category=child_safety')}
        />
        <MenuLink
          icon="mail-outline"
          label={SUPPORT_EMAIL}
          onPress={() => void contactSupportByEmail('Çocuk güvenliği hakkında')}
        />
      </View>

      <View style={styles.commitments}>
        {SAFETY_COMMITMENTS.map((commitment) => (
          <View key={commitment} style={styles.commitment}>
            <Ionicons name="shield-outline" size={13} color={theme.colors.primary} />
            <AppText variant="caption" color="textTertiary" style={styles.flex}>
              {commitment}
            </AppText>
          </View>
        ))}
      </View>

      <ChildSafetyInfoSheet
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        isOwner
      />
    </Screen>
  );
}

function SettingGroup({
  title,
  description,
  options,
  value,
  onChange,
  disabled,
  icon,
}: {
  title: string;
  description: string;
  options: { value: string; label: string; hint: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const { theme } = useTheme();
  return (
    <Card style={styles.settingCard}>
      <View style={styles.rowLeft}>
        <View style={[styles.toggleIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name={icon} size={17} color={theme.colors.primaryDeep} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="caption" color="textSecondary">
            {description}
          </AppText>
        </View>
      </View>

      <View style={styles.options}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                  borderColor: active ? theme.colors.primary : 'transparent',
                  borderRadius: theme.radius.sm,
                  opacity: pressed || disabled ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons
                name={active ? 'radio-button-on' : 'radio-button-off'}
                size={17}
                color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
              />
              <View style={styles.flex}>
                <AppText variant="bodyStrong" color={active ? 'primaryDeep' : 'text'}>
                  {option.label}
                </AppText>
                <AppText variant="caption" color="textSecondary">
                  {option.hint}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function MenuLink({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuLink,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={theme.colors.primaryDeep} />
      <AppText variant="body" style={styles.flex}>
        {label}
      </AppText>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', paddingVertical: 40 },
  errorCard: { alignItems: 'center', gap: 10 },
  neutralCard: { gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  section: { gap: 10, marginTop: 10 },
  birthCard: { gap: 12 },
  birthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  birthValue: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  ageGroup: {},
  toggleCard: { gap: 10, marginBottom: 8 },
  toggleIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lockedNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 9, borderRadius: 10 },
  settingCard: { gap: 10, marginBottom: 8 },
  options: { gap: 7 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderWidth: 1 },
  guardianCard: { gap: 12 },
  guardianIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  guardianForm: { gap: 10, paddingTop: 4 },
  linkRow: { alignSelf: 'flex-start', paddingVertical: 4 },
  menuLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
  },
  commitments: { gap: 7, marginTop: 18 },
  commitment: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
});
