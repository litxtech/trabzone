import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Screen } from '@/components/ui';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { AccCard, LoadingBlock, StatusPill } from '@/features/accommodation/components/AccommodationUI';
import { HotelOnboardingWizard } from '@/features/accommodation/components/HotelOnboardingWizard';
import { AURORA, AuroraBackdrop } from '@/features/accommodation/components/PremiumUI';
import {
  HOTEL_APPLICATION_STEPS,
  clearHotelApplicationDraft,
  hotelApplicationProgress,
  readHotelApplicationDraft,
  type HotelApplicationDraft,
} from '@/features/accommodation/services/onboarding-draft';

type ResumeChoice = 'pending' | 'resume' | 'new';

export default function AddPropertyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const session = useSession();
  const { propertyId } = useLocalSearchParams<{ propertyId?: string }>();
  const userId = session?.user?.id ?? null;
  const isEditing = Boolean(propertyId);

  const [storedDraft, setStoredDraft] = useState<HotelApplicationDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(!isEditing);
  const [resumeChoice, setResumeChoice] = useState<ResumeChoice>('pending');

  useEffect(() => {
    if (isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftLoading(false);
      return;
    }
    let cancelled = false;
    setDraftLoading(true);
    void (async () => {
      const draft = await readHotelApplicationDraft(userId);
      if (cancelled) return;
      setStoredDraft(draft);
      setDraftLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, userId]);

  const startFresh = () => {
    void clearHotelApplicationDraft(userId);
    setStoredDraft(null);
    setResumeChoice('new');
  };

  const showResumeCard =
    !isEditing && !draftLoading && Boolean(storedDraft) && resumeChoice === 'pending';

  return (
    <Screen padded={false} keyboardAware edges={['top', 'left', 'right']}>
      <View style={[styles.header, { paddingHorizontal: theme.layout.screenPadding }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Geri"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: theme.colors.surfaceMuted, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={21} color={theme.colors.text} />
        </Pressable>
        <View style={styles.flex}>
          <AppText variant="overline" color="primaryDeep" style={styles.overline}>
            HOTEL PARTNER
          </AppText>
          <AppText variant="h3" numberOfLines={1}>
            {isEditing ? 'Tesis bilgilerini düzenle' : 'Otelini Trabzone’a ekle'}
          </AppText>
        </View>
        {!isEditing ? (
          <View style={[styles.autoBadge, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="cloud-done-outline" size={12} color={theme.colors.success} />
            <AppText variant="caption" style={{ color: theme.colors.success, fontSize: 10 }}>
              Otomatik taslak
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.flex}>
        {isEditing ? (
          <HotelOnboardingWizard
            propertyId={propertyId ?? null}
            onCancel={() => router.back()}
            onSaved={(id) => {
              router.replace(`/konaklama/yonetim/${'genel-bakis'}?property=${id}` as never);
            }}
            onOpenManagement={(id, tab) => {
              router.replace(`/konaklama/yonetim/${tab}?property=${id}` as never);
            }}
          />
        ) : draftLoading ? (
          <LoadingBlock height={240} label="Taslak kontrol ediliyor…" />
        ) : showResumeCard && storedDraft ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.resumeScroll,
              { paddingHorizontal: theme.layout.screenPadding },
            ]}
          >
            <ResumeApplicationCard
              draft={storedDraft}
              onResume={() => setResumeChoice('resume')}
              onStartNew={startFresh}
            />
          </ScrollView>
        ) : (
          <HotelOnboardingWizard
            initialDraft={resumeChoice === 'resume' ? storedDraft : null}
            onCancel={() => router.back()}
            onSaved={(id) => {
              router.replace(`/konaklama/yonetim/${'genel-bakis'}?property=${id}` as never);
            }}
            onOpenManagement={(id, tab) => {
              router.replace(`/konaklama/yonetim/${tab}?property=${id}` as never);
            }}
          />
        )}
      </View>
    </Screen>
  );
}

function ResumeApplicationCard({
  draft,
  onResume,
  onStartNew,
}: {
  draft: HotelApplicationDraft;
  onResume: () => void;
  onStartNew: () => void;
}) {
  const { theme } = useTheme();
  const progress = hotelApplicationProgress(draft.form);
  const stepLabel = HOTEL_APPLICATION_STEPS[draft.step] ?? HOTEL_APPLICATION_STEPS[0];

  return (
    <AccCard padding={0} style={styles.resumeCard}>
      <AuroraBackdrop
        colors={[AURORA.night, AURORA.indigo, AURORA.violet]}
        style={styles.resumeHero}
      >
        <View style={styles.resumeHeroTop}>
          <View style={styles.resumeIcon}>
            <Ionicons name="documents-outline" size={18} color="#FFFFFF" />
          </View>
          <AppText variant="overline" style={styles.resumeOverline} numberOfLines={1}>
            CONTINUE APPLICATION
          </AppText>
          <StatusPill
            label={`%${progress.percent}`}
            color="#3DD68C"
            background="rgba(61,214,140,0.18)"
            border="rgba(61,214,140,0.42)"
            icon="trending-up-outline"
          />
        </View>
        <AppText variant="h3" style={styles.resumeName} numberOfLines={2}>
          {draft.form.name.trim() || 'İsimsiz tesis taslağı'}
        </AppText>
        <AppText variant="caption" style={styles.resumeMeta} numberOfLines={2}>
          {stepLabel} adımında kaldın · {formatRelativeTime(draft.updatedAt)}
        </AppText>
      </AuroraBackdrop>

      <View style={styles.resumeBody}>
        <View style={[styles.resumeProgressTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
          <View
            style={[
              styles.resumeProgressFill,
              { width: `${Math.max(3, progress.percent)}%`, backgroundColor: theme.colors.primary },
            ]}
          />
        </View>

        <View style={styles.resumeStats}>
          <View style={[styles.resumeStat, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="layers-outline" size={12} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              {progress.filled}/{progress.total} alan dolu
            </AppText>
          </View>
          <View style={[styles.resumeStat, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="footsteps-outline" size={12} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              Adım {draft.step + 1}/{HOTEL_APPLICATION_STEPS.length}
            </AppText>
          </View>
          {draft.propertyId ? (
            <View style={[styles.resumeStat, { backgroundColor: theme.colors.successSoft }]}>
              <Ionicons name="cloud-done-outline" size={12} color={theme.colors.success} />
              <AppText variant="caption" style={{ color: theme.colors.success }}>
                Sunucuda kayıtlı
              </AppText>
            </View>
          ) : null}
        </View>

        <Button
          label="Kaldığım yerden devam et"
          leftIcon={<Ionicons name="play-forward" size={16} color={theme.colors.onPrimary} />}
          onPress={onResume}
        />
        <Button label="Yeni başvuru başlat" variant="outline" onPress={onStartNew} />

        <View style={styles.resumeNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex}>
            Başvurudan çıksan bile doldurduğun alanlar bu cihazda otomatik olarak saklanır. Yeni
            başvuru seçersen bu cihazdaki taslak temizlenir; daha önce sunucuya kaydedilen tesis
            taslağı Otel Yönetimim&apos;de kalır.
          </AppText>
        </View>
      </View>
    </AccCard>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'az önce kaydedildi';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} dk önce kaydedildi`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce kaydedildi`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'dün kaydedildi';
  if (days < 7) return `${days} gün önce kaydedildi`;
  try {
    return `${new Date(timestamp).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long' })} tarihinde kaydedildi`;
  } catch {
    return 'daha önce kaydedildi';
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    paddingBottom: 10,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overline: { fontSize: 9, letterSpacing: 1.6, marginBottom: 1 },
  autoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  resumeScroll: { paddingTop: 4, paddingBottom: 24, gap: 12 },

  resumeCard: { overflow: 'hidden' },
  resumeHero: { padding: 16, gap: 6 },
  resumeHeroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resumeIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  resumeOverline: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 9,
    letterSpacing: 1.6,
    flex: 1,
  },
  resumeName: { color: '#FFFFFF', marginTop: 2 },
  resumeMeta: { color: 'rgba(255,255,255,0.66)' },

  resumeBody: { padding: 14, gap: 10 },
  resumeProgressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  resumeProgressFill: { height: '100%', borderRadius: 3 },
  resumeStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  resumeStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  resumeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: 2 },
});
