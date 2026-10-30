import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppImage, AppText, Button, Screen } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  StatusPill,
} from '@/features/accommodation/components/AccommodationUI';
import { AURORA, AuroraBackdrop, IconSquare, SectionTitle } from '@/features/accommodation/components/PremiumUI';
import { useAccommodationContext } from '@/features/accommodation/hooks/use-accommodation';
import { useAccommodationLayout } from '@/features/accommodation/hooks/use-accommodation-layout';
import { accommodationMediaUrl } from '@/features/accommodation/services/accommodation-media-service';
import type { AccommodationPropertyContext } from '@/features/accommodation/types';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  STAFF_ROLE_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/features/accommodation/utils/format';

const TYPE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  hotel: 'business',
  bungalow: 'home',
  apartment: 'grid',
  pension: 'bed',
  villa: 'leaf',
};

export default function AccommodationManagementScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const layout = useAccommodationLayout();
  const context = useAccommodationContext();

  const items = context.data?.items ?? [];
  const totals = items.reduce(
    (acc, item) => ({
      reservations: acc.reservations + item.pending_reservations,
      messages: acc.messages + item.unread_messages,
      tasks: acc.tasks + item.pending_tasks,
      published: acc.published + (item.status === 'published' ? 1 : 0),
      verified: acc.verified + (item.verification_status === 'verified' ? 1 : 0),
    }),
    { reservations: 0, messages: 0, tasks: 0, published: 0, verified: 0 },
  );
  const horizontalPadding = layout.isDesktop ? 28 : theme.layout.screenPadding;

  const openProperty = (id: string) =>
    router.push({
      pathname: '/konaklama/yonetim/[tab]',
      params: { tab: 'genel-bakis', property: id },
    } as never);

  return (
    <Screen padded={false} edges={['top', 'left', 'right']} scroll>
      <AuroraBackdrop style={styles.hero} colors={[AURORA.night, '#101A33', '#2E2A6E']}>
        <View style={[styles.heroInner, { paddingHorizontal: horizontalPadding }]}>
          <View style={styles.heroTop}>
            <IconSquare icon="chevron-back" accessibilityLabel="Konaklamaya dön" onPress={() => router.push('/konaklama' as never)} />
            <View style={styles.heroBrand}>
              <AppText variant="overline" style={styles.brandOverline}>
                TRABZONE KONAKLAMA
              </AppText>
              <AppText variant="h3" style={styles.brandTitle}>
                Otel Yönetimim
              </AppText>
            </View>
            <IconSquare icon="add" accessibilityLabel="Yeni tesis ekle" onPress={() => router.push('/konaklama/otel-ekle' as never)} />
          </View>

          <View style={styles.heroCopy}>
            <AppText variant="display" style={styles.heroTitle}>
              İşletmelerin,{'\n'}tek panelde.
            </AppText>
            <AppText variant="caption" style={styles.heroSubtitle}>
              Rezervasyon, takvim, kasa ve finans yönetimini tek Trabzone hesabıyla yürüt.
            </AppText>
          </View>

          <View style={styles.heroStats}>
            <PortfolioStat label="Tesis" value={items.length} icon="business" tone="#6284FF" />
            <PortfolioStat label="Onay bekleyen" value={totals.reservations} icon="time" tone="#FBBF24" />
            <PortfolioStat label="Mesaj" value={totals.messages} icon="chatbubble" tone="#A78BFA" />
            <PortfolioStat label="Açık görev" value={totals.tasks} icon="sparkles" tone="#3DD68C" />
          </View>
        </View>
      </AuroraBackdrop>

      <View style={styles.content}>
        {context.isLoading ? (
          <View style={{ padding: 16, gap: 12 }}>
            <LoadingBlock height={70} />
            <LoadingBlock height={200} />
          </View>
        ) : context.isError ? (
          <View style={{ padding: 16 }}>
            <InlineError
              message={context.error instanceof Error ? context.error.message : 'Tesisler yüklenemedi.'}
              onRetry={() => void context.refetch()}
            />
          </View>
        ) : items.length === 0 ? (
          <View style={{ padding: horizontalPadding, gap: 14 }}>
            <AuroraBackdrop rounded colors={[AURORA.indigo, '#1D2450', '#3A2E78']} style={styles.onboardCard}>
              <View style={styles.onboardHead}>
                <View style={styles.onboardIcon}>
                  <Ionicons name="rocket" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.flex}>
                  <AppText variant="overline" style={styles.onboardOverline}>
                    ÜCRETSİZ BAŞVURU
                  </AppText>
                  <AppText variant="title" style={styles.onboardTitle}>
                    Tesisini 4 adımda yayına al
                  </AppText>
                </View>
              </View>
              <View style={styles.onboardSteps}>
                <OnboardStep index={1} title="Tesis bilgileri" text="Adres, iletişim, politika ve olanaklar" />
                <OnboardStep index={2} title="Belgeler" text="İşletme ve konaklama belgelerini yükle" />
                <OnboardStep index={3} title="Oda & fiyat" text="Oda tipleri, fiyat planları, kampanyalar" />
                <OnboardStep index={4} title="Doğrulama" text="Admin onayı sonrası kamuya açılır" />
              </View>
              <Button label="Otelimi ekle" onPress={() => router.push('/konaklama/otel-ekle' as never)} />
            </AuroraBackdrop>
            <InfoBanner text="Otel yönetimi için ayrı bir işletme hesabı açman gerekmez. Mevcut Trabzone hesabınla tesis ekleyebilir, aynı hesabı hem normal kullanıcı hem otel yetkilisi olarak kullanabilirsin." />
            <EmptyState
              icon="business-outline"
              title="Henüz tesisin yok"
              message="Başvurunu tamamladığında oda takvimi, ön büro, kasa ve finans modülleri otomatik açılır."
              actionLabel="Başvuruya başla"
              onAction={() => router.push('/konaklama/otel-ekle' as never)}
              compact
            />
          </View>
        ) : (
          <View style={[styles.body, { paddingHorizontal: horizontalPadding }]}>
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <View style={[styles.summaryIcon, { backgroundColor: theme.colors.successSoft }]}>
                  <Ionicons name="checkmark-done" size={16} color={theme.colors.success} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{totals.published} yayında</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {items.length - totals.published} taslak / doğrulama bekliyor
                  </AppText>
                </View>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <View style={[styles.summaryIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="shield-checkmark" size={16} color={theme.colors.primaryDeep} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{totals.verified} doğrulanmış</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Doğrulanmamış tesis satışa açılmaz
                  </AppText>
                </View>
              </View>
            </View>

            <SectionTitle
              overline="PORTFÖY"
              title="Tesislerin"
              icon="business"
              subtitle="Yönetmek istediğin tesisi seç · her tesise ayrı personel ve yetki tanımlanabilir"
              actionLabel="Yeni tesis"
              onAction={() => router.push('/konaklama/otel-ekle' as never)}
            />

            <View style={styles.grid}>
              {items.map((property) => (
                <PropertyManageCard
                  key={property.id}
                  property={property}
                  onPress={() => openProperty(property.id)}
                />
              ))}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Yeni tesis ekle"
                onPress={() => router.push('/konaklama/otel-ekle' as never)}
                style={({ pressed }) => [
                  styles.addCard,
                  {
                    borderColor: theme.colors.borderStrong,
                    backgroundColor: theme.colors.surfaceMuted,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <LinearGradient
                  colors={[theme.colors.primary, theme.colors.accent]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.addIcon}
                >
                  <Ionicons name="add" size={22} color="#FFFFFF" />
                </LinearGradient>
                <AppText variant="bodyStrong">Yeni tesis ekle</AppText>
                <AppText variant="caption" color="textTertiary" style={styles.addHint}>
                  Otel, bungalov, apart, pansiyon veya villa
                </AppText>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

function PortfolioStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: string;
}) {
  return (
    <View style={styles.portfolioStat}>
      <View style={[styles.portfolioDot, { backgroundColor: tone }]} />
      <Ionicons name={icon} size={12} color="rgba(255,255,255,0.55)" />
      <AppText variant="bodyStrong" style={styles.portfolioValue}>
        {value}
      </AppText>
      <AppText variant="caption" style={styles.portfolioLabel} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function PropertyManageCard({
  property,
  onPress,
}: {
  property: AccommodationPropertyContext;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const cover = accommodationMediaUrl(property.cover_path);
  const published = property.status === 'published';
  const verified = property.verification_status === 'verified';
  const hasPending = property.pending_reservations + property.unread_messages + property.pending_tasks > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${property.name} yönetim paneli`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          opacity: pressed ? 0.97 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
        theme.shadows.card,
      ]}
    >
      <View style={styles.cardMedia}>
        {cover ? (
          <AppImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <LinearGradient
            colors={[theme.colors.primarySoft, theme.colors.surfaceMuted]}
            style={[StyleSheet.absoluteFill, styles.cardMediaFallback]}
          >
            <Ionicons name={TYPE_ICONS[property.property_type] ?? 'business'} size={30} color={theme.colors.primaryDeep} />
          </LinearGradient>
        )}
        <LinearGradient
          colors={['rgba(6,10,20,0.35)', 'transparent', 'rgba(6,10,20,0.68)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.cardMediaTop}>
          <StatusPill
            label={PROPERTY_STATUS_LABELS[property.status]}
            color={published ? '#3DD68C' : '#FBBF24'}
            background={published ? 'rgba(22,163,74,0.24)' : 'rgba(245,158,11,0.24)'}
            border={published ? 'rgba(61,214,140,0.5)' : 'rgba(251,191,36,0.5)'}
            icon={published ? 'globe-outline' : 'time-outline'}
          />
          <View style={styles.cardMediaRight}>
            <StatusPill
              label={VERIFICATION_STATUS_LABELS[property.verification_status]}
              color={verified ? '#3DD68C' : '#FBBF24'}
              background="rgba(8,13,26,0.55)"
              border={verified ? 'rgba(61,214,140,0.45)' : 'rgba(251,191,36,0.45)'}
              icon={verified ? 'shield-checkmark' : 'shield-outline'}
            />
          </View>
        </View>
        <View style={styles.cardMediaBottom}>
          <View style={styles.cardTypePill}>
            <Ionicons name={TYPE_ICONS[property.property_type] ?? 'business'} size={11} color="#FFFFFF" />
            <AppText variant="caption" style={styles.cardTypeText}>
              {PROPERTY_TYPE_LABELS[property.property_type]}
            </AppText>
          </View>
          <AppText variant="caption" style={styles.cardRole}>
            {property.role === 'admin' ? 'Platform yöneticisi' : STAFF_ROLE_LABELS[property.role]}
          </AppText>
        </View>
      </View>

      <View style={styles.cardBody}>
        <AppText variant="title" numberOfLines={1}>
          {property.name}
        </AppText>
        <View style={styles.cardLocation}>
          <Ionicons name="location-outline" size={12} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
            {[property.neighborhood, property.district].filter(Boolean).join(', ') || 'Trabzon'}
          </AppText>
        </View>

        {hasPending ? (
          <View style={styles.pendingRow}>
            {property.pending_reservations > 0 ? (
              <PendingBadge icon="time-outline" label={`${property.pending_reservations} onay`} tone={theme.colors.warning} />
            ) : null}
            {property.unread_messages > 0 ? (
              <PendingBadge icon="chatbubble-outline" label={`${property.unread_messages} mesaj`} tone={theme.colors.primary} />
            ) : null}
            {property.pending_tasks > 0 ? (
              <PendingBadge icon="sparkles-outline" label={`${property.pending_tasks} görev`} tone={theme.colors.accent} />
            ) : null}
          </View>
        ) : (
          <View style={styles.clearRow}>
            <Ionicons name="checkmark-circle" size={13} color={theme.colors.success} />
            <AppText variant="caption" color="textTertiary">
              Bekleyen işlem yok
            </AppText>
          </View>
        )}

        {property.verification_note ? (
          <View style={[styles.note, { backgroundColor: theme.colors.warningSoft }]}>
            <Ionicons name="information-circle-outline" size={13} color={theme.colors.warning} />
            <AppText variant="caption" color="warning" numberOfLines={2} style={styles.flex}>
              {property.verification_note}
            </AppText>
          </View>
        ) : null}

        <View style={[styles.cardCta, { borderTopColor: theme.colors.divider }]}>
          <AppText variant="caption" color="primaryDeep" style={styles.cardCtaText}>
            Yönetim panelini aç
          </AppText>
          <View style={[styles.cardCtaIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="arrow-forward" size={14} color={theme.colors.primaryDeep} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function PendingBadge({
  icon,
  label,
  tone,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.pendingBadge, { backgroundColor: theme.colors.surfaceMuted }]}>
      <Ionicons name={icon} size={11} color={tone} />
      <AppText variant="caption" color="textSecondary" style={styles.pendingText}>
        {label}
      </AppText>
    </View>
  );
}

function OnboardStep({ index, title, text }: { index: number; title: string; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIndex}>
        <AppText variant="caption" style={styles.stepIndexText}>
          {index}
        </AppText>
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" style={styles.stepTitle}>
          {title}
        </AppText>
        <AppText variant="caption" style={styles.stepText}>
          {text}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  hero: { paddingBottom: 20 },
  heroInner: { width: '100%', maxWidth: 1280, alignSelf: 'center', paddingTop: 12, gap: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBrand: { flex: 1, alignItems: 'center', gap: 2 },
  brandOverline: { color: 'rgba(255,255,255,0.62)', fontSize: 9, letterSpacing: 2.4 },
  brandTitle: { color: '#FFFFFF' },
  heroCopy: { gap: 5 },
  heroTitle: { color: '#FFFFFF', fontSize: 28, lineHeight: 35, letterSpacing: -0.9 },
  heroSubtitle: { color: 'rgba(255,255,255,0.66)', fontSize: 11, lineHeight: 16, maxWidth: 560 },
  heroStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  portfolioStat: {
    flex: 1,
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    padding: 9,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  portfolioDot: { width: 6, height: 6, borderRadius: 3 },
  portfolioValue: { color: '#FFFFFF', fontSize: 14 },
  portfolioLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 9 },

  content: {},
  body: { width: '100%', maxWidth: 1280, alignSelf: 'center', paddingTop: 16, paddingBottom: 30, gap: 14 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  summaryCard: {
    flex: 1,
    minWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summaryIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '32%', minWidth: 296, flexGrow: 1, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardMedia: { height: 150, position: 'relative' },
  cardMediaFallback: { alignItems: 'center', justifyContent: 'center' },
  cardMediaTop: { position: 'absolute', top: 9, left: 9, right: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMediaRight: { marginLeft: 'auto' },
  cardMediaBottom: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(8,13,26,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  cardTypeText: { color: '#FFFFFF', fontSize: 9 },
  cardRole: { color: 'rgba(255,255,255,0.8)', fontSize: 9, marginLeft: 'auto' },
  cardBody: { padding: 13, gap: 7 },
  cardLocation: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  pendingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  pendingText: { fontSize: 9 },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, padding: 8, borderRadius: 9 },
  cardCta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  cardCtaText: { flex: 1, fontSize: 11 },
  cardCtaIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },

  addCard: {
    width: '32%',
    minWidth: 296,
    flexGrow: 1,
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  addIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  addHint: { textAlign: 'center', maxWidth: 200 },

  onboardCard: { padding: 18, gap: 16 },
  onboardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  onboardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardOverline: { color: 'rgba(255,255,255,0.55)', fontSize: 9 },
  onboardTitle: { color: '#FFFFFF' },
  onboardSteps: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepIndex: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndexText: { color: '#FFFFFF', fontSize: 11 },
  stepTitle: { color: '#FFFFFF', fontSize: 13 },
  stepText: { color: 'rgba(255,255,255,0.62)', fontSize: 10 },
});
