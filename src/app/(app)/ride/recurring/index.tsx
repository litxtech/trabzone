import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Button, Skeleton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { RecurringPauseSheet } from '@/features/ride/components/RecurringPauseSheet';
import { RecurringPlanCard } from '@/features/ride/components/RecurringPlanCard';
import { RecurringPlanSheet } from '@/features/ride/components/RecurringPlanSheet';
import {
  usePauseRecurringDay,
  useRecurring,
  useRemoveRecurring,
  useRideProfile,
  useRideVehicles,
  useSaveRecurring,
} from '@/features/ride/hooks/use-ride';
import { geocodePlace } from '@/features/ride/services/map-service';
import type { RecurringInput } from '@/features/ride/services/ride-service';
import type { RideRecurring } from '@/features/ride/types';
import { isIdentityVerified } from '@/features/ride/utils/identity';
import {
  draftFromPlan,
  nextAcross,
  occurrenceLabel,
  parsePriceCents,
  totalWeeklyDepartures,
  upcomingPausedDates,
  type RecurringDraft,
} from '@/features/ride/utils/recurring';

type RoleFilter = 'all' | 'driver' | 'passenger';

const FILTERS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'driver', label: 'Sürücü' },
  { key: 'passenger', label: 'Yolcu' },
];

export default function RideRecurringScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const recurring = useRecurring();
  const vehicles = useRideVehicles();
  const profile = useRideProfile();
  const save = useSaveRecurring();
  const remove = useRemoveRecurring();
  const pause = usePauseRecurringDay();

  const [sheet, setSheet] = useState<{ plan: RideRecurring | null } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [pauseTarget, setPauseTarget] = useState<RideRecurring | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const plans = recurring.data ?? [];
  const activePlans = plans.filter((plan) => plan.is_active);
  const inactivePlans = plans.filter((plan) => !plan.is_active);
  const matchesFilter = (plan: RideRecurring) => filter === 'all' || plan.role === filter;
  const visibleActive = activePlans.filter(matchesFilter);
  const visibleInactive = inactivePlans.filter(matchesFilter);
  const counts: Record<RoleFilter, number> = {
    all: plans.length,
    driver: plans.filter((plan) => plan.role === 'driver').length,
    passenger: plans.filter((plan) => plan.role === 'passenger').length,
  };
  const weeklyCount = totalWeeklyDepartures(plans);
  const next = nextAcross(activePlans);
  const pausedCount = new Set(activePlans.flatMap((plan) => upcomingPausedDates(plan))).size;
  // Sürücü planı için tek kapı kimlik doğrulaması.
  const driverReady = isIdentityVerified(profile.data);

  const openCreate = () => {
    setSheetError(null);
    setSheet({ plan: null });
  };

  const openEdit = (plan: RideRecurring) => {
    setSheetError(null);
    setSheet({ plan });
  };

  async function composeInput(
    draft: RecurringDraft,
    plan: RideRecurring | null,
    isActive?: boolean,
  ): Promise<RecurringInput> {
    const [originResult, destResult] = await Promise.all([
      geocodePlace(`${draft.originLabel}, ${draft.originCity}`),
      geocodePlace(`${draft.destLabel}, ${draft.destCity}`),
    ]);
    return {
      id: plan?.id,
      role: draft.role,
      scope: draft.scope,
      originLabel: draft.originLabel,
      originCity: draft.originCity,
      originLat: originResult.ok ? originResult.data.lat : null,
      originLng: originResult.ok ? originResult.data.lng : null,
      destLabel: draft.destLabel,
      destCity: draft.destCity,
      destLat: destResult.ok ? destResult.data.lat : null,
      destLng: destResult.ok ? destResult.data.lng : null,
      weekdays: draft.weekdays,
      departTime: draft.departTime,
      returnTime: draft.returnTime || null,
      seats: draft.seats,
      pricePerSeatCents: draft.role === 'driver' ? parsePriceCents(draft.price) : null,
      preferences: { women_only: draft.womenOnly, smoking: !draft.noSmoking },
      vehicleId: draft.role === 'driver' ? draft.vehicleId : null,
      luggage: plan?.luggage ?? 'medium',
      bookingMode: plan?.booking_mode ?? 'manual',
      visibility: plan?.visibility ?? 'public',
      isActive: isActive ?? null,
    };
  }

  const handleSubmit = async (draft: RecurringDraft) => {
    setSheetError(null);
    try {
      const input = await composeInput(draft, sheet?.plan ?? null);
      await save.mutateAsync(input);
      setSheet(null);
    } catch (cause) {
      setSheetError(errorMessage(cause, 'Düzenli yolculuk kaydedilemedi.'));
    }
  };

  const handlePause = async (date: string) => {
    if (!pauseTarget) {
      return;
    }
    setPauseError(null);
    try {
      await pause.mutateAsync({ id: pauseTarget.id, date });
      setPauseTarget(null);
    } catch (cause) {
      setPauseError(errorMessage(cause, 'Gün duraklatılamadı.'));
    }
  };

  const confirmRemove = (plan: RideRecurring) => {
    Alert.alert(
      'Plan kaldırılsın mı?',
      `${plan.origin_label} → ${plan.dest_label} planı pasife alınacak ve bekleyen ilanları iptal edilecek. Geçmiş yolculuk kayıtların korunur.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: () =>
            remove.mutate(plan.id, {
              onError: (cause) =>
                Alert.alert('Plan kaldırılamadı', errorMessage(cause, 'Bilinmeyen hata')),
            }),
        },
      ],
    );
  };

  const reactivate = async (plan: RideRecurring) => {
    setReactivatingId(plan.id);
    try {
      const input = await composeInput(draftFromPlan(plan), plan, true);
      await save.mutateAsync(input);
    } catch (cause) {
      Alert.alert('Plan başlatılamadı', errorMessage(cause, 'Bilinmeyen hata'));
    } finally {
      setReactivatingId(null);
    }
  };

  const confirmReactivate = (plan: RideRecurring) => {
    Alert.alert(
      'Plan yeniden başlatılsın mı?',
      'Plan aktifleşir ve sonraki günler için otomatik ilan üretimi devam eder. Kapasite ve doğrulama koşulları yeniden kontrol edilir.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Başlat', onPress: () => void reactivate(plan) },
      ],
    );
  };

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      scroll
      padded
      refreshControl={
        <RefreshControl
          refreshing={recurring.isRefetching}
          onRefresh={() => void recurring.refetch()}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View style={styles.content}>
        <RideHeader
          title="Düzenli yolculuklar"
          subtitle="Haftalık planlar ve duraklatma"
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yeni düzenli plan"
              onPress={openCreate}
              style={({ pressed }) => [
                styles.newBtn,
                { backgroundColor: theme.colors.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="add" size={16} color={theme.colors.onPrimary} />
              <AppText variant="label" color={theme.colors.onPrimary}>
                Yeni
              </AppText>
            </Pressable>
          }
        />

        <LinearGradient
          colors={['#233B86', '#2F55D4', '#8057F4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View style={styles.heroText}>
              <AppText variant="overline" style={styles.heroEyebrow}>
                HAFTALIK PROGRAM
              </AppText>
              <AppText variant="h1" style={styles.heroTitle}>
                {activePlans.length > 0
                  ? `${activePlans.length} aktif plan`
                  : 'Programın hazır değil'}
              </AppText>
              <AppText variant="body" style={styles.heroSubtitle}>
                {activePlans.length > 0
                  ? next
                    ? `Sonraki sefer ${occurrenceLabel(next)}. Uygun günlerde ilan otomatik üretilir.`
                    : 'Yaklaşan sefer yok. Duraklatmaları kontrol et veya yeni bir plan ekle.'
                  : 'İşe, okula veya eve gidişini bir kez tanımla; Trabzone uygun günlerde ilanı kendisi oluştursun.'}
              </AppText>
            </View>
            <View style={styles.heroBadge}>
              <Ionicons name="repeat" size={20} color="#DCE6FF" />
            </View>
          </View>

          <View style={styles.heroStats}>
            <HeroStat value={activePlans.length} label="Aktif plan" />
            <View style={styles.heroDivider} />
            <HeroStat value={weeklyCount} label="Haftalık sefer" />
            <View style={styles.heroDivider} />
            <HeroStat value={pausedCount} label="Duraklatılan gün" />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yeni düzenli plan oluştur"
            onPress={openCreate}
            style={({ pressed }) => [styles.heroCta, { opacity: pressed ? 0.92 : 1 }]}
          >
            <View style={styles.heroCtaIcon}>
              <Ionicons name="add" size={16} color="#FFFFFF" />
            </View>
            <AppText variant="label" color="#2F55D4" style={styles.flex}>
              Yeni düzenli plan oluştur
            </AppText>
            <Ionicons name="arrow-forward" size={15} color="#2F55D4" />
          </Pressable>
        </LinearGradient>

        {recurring.isLoading ? (
          <View style={styles.list}>
            {[0, 1].map((index) => (
              <View
                key={index}
                style={[
                  styles.skeletonCard,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <View style={styles.skeletonHead}>
                  <Skeleton width={42} height={42} radius={14} />
                  <View style={styles.flex}>
                    <Skeleton width="70%" height={15} />
                    <Skeleton width="45%" height={11} />
                  </View>
                </View>
                <Skeleton height={30} radius={9} />
                <Skeleton width="60%" height={12} />
              </View>
            ))}
          </View>
        ) : recurring.isError ? (
          <RideEmptyState
            icon="cloud-offline-outline"
            title="Planlar yüklenemedi"
            message={recurring.error.message}
            action={
              <Button
                label="Tekrar dene"
                variant="secondary"
                onPress={() => void recurring.refetch()}
              />
            }
          />
        ) : plans.length === 0 ? (
          <RideEmptyState
            icon="repeat-outline"
            title="Henüz düzenli plan yok"
            message="Haftanın belirli günlerinde gittiğin güzergâhı tanımla. Plan aktifken uygun her gün için ilan otomatik oluşturulur, tek günlük duraklatma diğer günleri etkilemez."
            action={<Button label="İlk planı oluştur" onPress={openCreate} />}
          />
        ) : (
          <>
            <View style={[styles.segment, { backgroundColor: theme.colors.surfaceMuted }]}>
              {FILTERS.map((item) => {
                const active = filter === item.key;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setFilter(item.key)}
                    style={[
                      styles.segmentItem,
                      {
                        backgroundColor: active ? theme.colors.surface : 'transparent',
                        borderColor: active ? theme.colors.border : 'transparent',
                      },
                    ]}
                  >
                    <AppText variant="label" color={active ? 'primaryDeep' : 'textTertiary'}>
                      {item.label}
                    </AppText>
                    <View
                      style={[
                        styles.countPill,
                        {
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                        },
                      ]}
                    >
                      <AppText variant="caption" color={active ? 'primaryDeep' : 'textTertiary'}>
                        {counts[item.key]}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {visibleActive.length === 0 && visibleInactive.length === 0 ? (
              <RideEmptyState
                icon="funnel-outline"
                title="Bu filtrede plan yok"
                message="Seçili rol için kayıtlı düzenli yolculuk bulunmuyor. Filtreyi değiştir veya yeni bir plan oluştur."
                action={
                  <Button
                    label="Tüm planlar"
                    variant="secondary"
                    onPress={() => setFilter('all')}
                  />
                }
              />
            ) : null}

            {visibleActive.length > 0 ? (
              <View style={styles.list}>
                <View style={styles.sectionHead}>
                  <AppText variant="label" color="textSecondary">
                    Aktif planlar
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {visibleActive.length} plan
                  </AppText>
                </View>
                {visibleActive.map((plan) => (
                  <RecurringPlanCard
                    key={plan.id}
                    plan={plan}
                    onEdit={() => openEdit(plan)}
                    onPause={() => {
                      setPauseError(null);
                      setPauseTarget(plan);
                    }}
                    onRemove={() => confirmRemove(plan)}
                    onReactivate={() => confirmReactivate(plan)}
                  />
                ))}
              </View>
            ) : null}

            {visibleInactive.length > 0 ? (
              <View style={styles.list}>
                <View style={styles.sectionHead}>
                  <AppText variant="label" color="textSecondary">
                    Pasif planlar
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    Yeniden başlatılabilir
                  </AppText>
                </View>
                {visibleInactive.map((plan) => (
                  <RecurringPlanCard
                    key={plan.id}
                    plan={plan}
                    onEdit={() => openEdit(plan)}
                    onPause={() => {
                      setPauseError(null);
                      setPauseTarget(plan);
                    }}
                    onRemove={() => confirmRemove(plan)}
                    onReactivate={() => confirmReactivate(plan)}
                    reactivating={reactivatingId === plan.id}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}

        <View style={[styles.infoCard, { backgroundColor: theme.colors.surfaceMuted }]}>
          <InfoRow
            icon="calendar-clear-outline"
            text="Duraklatma yalnızca seçilen günü etkiler; diğer tarihlerin planı bozulmaz."
          />
          <InfoRow
            icon="sync-outline"
            text="Aktif planlar için uygun günlerde ilan otomatik üretilir ve kapasite kontrollerinden geçer."
          />
          <InfoRow
            icon="shield-checkmark-outline"
            text="Sürücü planı için kimlik doğrulaması ve bir araç yeterlidir; ayrıca onay beklemez."
          />
        </View>

        {sheet ? (
          <RecurringPlanSheet
            plan={sheet.plan}
            vehicles={vehicles.data ?? []}
            saving={save.isPending}
            error={sheetError}
            driverReady={driverReady}
            onClose={() => setSheet(null)}
            onSubmit={(draft) => void handleSubmit(draft)}
            onOpenGarage={() => {
              setSheet(null);
              router.navigate('/ride/garage' as never);
            }}
          />
        ) : null}

        {pauseTarget ? (
          <RecurringPauseSheet
            plan={pauseTarget}
            saving={pause.isPending}
            error={pauseError}
            onClose={() => setPauseTarget(null)}
            onConfirm={(date) => void handlePause(date)}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function HeroStat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.heroStat}>
      <AppText variant="h2" style={styles.heroStatValue}>
        {value}
      </AppText>
      <AppText variant="caption" style={styles.heroStatLabel}>
        {label}
      </AppText>
    </View>
  );
}

function InfoRow({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color={theme.colors.primaryDeep} />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 880, alignSelf: 'center', gap: 14 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
  },
  hero: { borderRadius: 24, padding: 18, gap: 14, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroText: { flex: 1, gap: 5 },
  heroEyebrow: { color: 'rgba(235,242,255,0.72)', letterSpacing: 1.1, fontSize: 10 },
  heroTitle: { color: '#FFFFFF' },
  heroSubtitle: { color: 'rgba(235,242,255,0.86)' },
  heroBadge: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(8,14,32,0.28)',
    borderRadius: 14,
    paddingVertical: 10,
  },
  heroStat: { alignItems: 'center', gap: 1 },
  heroStatValue: { color: '#FFFFFF' },
  heroStatLabel: { color: 'rgba(235,242,255,0.72)' },
  heroDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingLeft: 8,
    paddingRight: 14,
    paddingVertical: 8,
  },
  heroCtaIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#2F55D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 15,
    gap: 12,
  },
  skeletonHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 14,
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  countPill: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 999,
    alignItems: 'center',
  },
  list: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 4 },
  infoCard: { borderRadius: 16, padding: 13, gap: 9 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1 },
});
