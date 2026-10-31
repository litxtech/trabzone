import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppImage, AppText, Button, Screen } from '@/components/ui';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import {
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  StatusPill,
} from '@/features/accommodation/components/AccommodationUI';
import {
  AURORA,
  AuroraBackdrop,
  IconSquare,
  SectionTitle,
} from '@/features/accommodation/components/PremiumUI';
import { useAccommodationContext } from '@/features/accommodation/hooks/use-accommodation';
import { useAccommodationLayout } from '@/features/accommodation/hooks/use-accommodation-layout';
import { accommodationMediaUrl } from '@/features/accommodation/services/accommodation-media-service';
import {
  hotelApplicationProgress,
  readHotelApplicationDraft,
  type HotelApplicationDraft,
} from '@/features/accommodation/services/onboarding-draft';
import type { AccommodationPropertyContext } from '@/features/accommodation/types';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  STAFF_ROLE_LABELS,
  VERIFICATION_STATUS_LABELS,
} from '@/features/accommodation/utils/format';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TYPE_ICONS: Record<string, IconName> = {
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
  const insets = useSafeAreaInsets();
  const session = useSession();
  const context = useAccommodationContext();

  const [draft, setDraft] = useState<HotelApplicationDraft | null>(null);
  const [draftHidden, setDraftHidden] = useState(false);

  // Cihazdaki yarım kalan başvuru, sayfaya her dönüşte tazelenir.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const stored = await readHotelApplicationDraft(session?.user?.id ?? null);
        if (!cancelled) setDraft(stored);
      })();
      return () => {
        cancelled = true;
      };
    }, [session?.user?.id]),
  );

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
  const canAddProperty = items.length < 20;

  const goAdd = () => router.push('/konaklama/otel-ekle' as never);
  const openProperty = (id: string) =>
    router.push({
      pathname: '/konaklama/yonetim/[tab]',
      params: { tab: 'genel-bakis', property: id },
    } as never);

  const draftProgress = draft ? hotelApplicationProgress(draft.form) : null;

  return (
    <Screen padded={false} edges={['left', 'right']} scroll>
      <AuroraBackdrop style={styles.hero} colors={[AURORA.night, '#101A33', '#2E2A6E']}>
        <View
          style={[
            styles.heroInner,
            { paddingHorizontal: horizontalPadding, paddingTop: insets.top + 10 },
          ]}
        >
          <View style={styles.heroTop}>
            <IconSquare
              icon="chevron-back"
              accessibilityLabel="Konaklamaya dön"
              onPress={() => router.push('/konaklama' as never)}
            />
            <View style={styles.heroBrand}>
              <AppText variant="overline" style={styles.brandOverline}>
                TRABZONE · KONAKLAMA
              </AppText>
              <AppText variant="bodyStrong" style={styles.brandTitle}>
                Otel Yönetimim
              </AppText>
            </View>
            <View style={styles.heroTopRight}>
              <IconSquare
                icon="help-buoy-outline"
                accessibilityLabel="Konaklama desteği"
                onPress={() => router.push('/konaklama/destek' as never)}
              />
              {!layout.isDesktop ? (
                <IconSquare icon="add" accessibilityLabel="Yeni tesis ekle" onPress={goAdd} />
              ) : null}
            </View>
          </View>

          <View style={styles.heroMain}>
            <View style={styles.heroCopy}>
              <AppText variant="overline" style={styles.heroOverline}>
                TESİS YÖNETİM MERKEZİ
              </AppText>
              <AppText variant="display" style={styles.heroTitle}>
                İşletmenin{'\n'}tek paneli.
              </AppText>
              <AppText variant="caption" style={styles.heroSubtitle}>
                Rezervasyon, takvim, kasa, finans ve galeri yönetimini tek Trabzone hesabıyla
                yürüt. Tüm tesislerin, bekleyen işlerin ve başvuruların burada.
              </AppText>
              {!layout.isDesktop ? (
                <Button
                  label="Yeni tesis ekle"
                  size="sm"
                  fullWidth={false}
                  style={styles.heroMobileCta}
                  leftIcon={<Ionicons name="add" size={16} color={theme.colors.onPrimary} />}
                  onPress={goAdd}
                />
              ) : null}
            </View>

            {layout.isDesktop ? (
              <View style={styles.heroCta}>
                <View style={styles.heroCtaTop}>
                  <View style={styles.heroCtaIcon}>
                    <Ionicons name="rocket-outline" size={17} color="#FFFFFF" />
                  </View>
                  <AppText variant="overline" style={styles.heroCtaOverline}>
                    ÜCRETSİZ BAŞVURU
                  </AppText>
                </View>
                <AppText variant="title" style={styles.heroCtaTitle}>
                  Yeni tesisini 4 adımda yayına al
                </AppText>
                <AppText variant="caption" style={styles.heroCtaText}>
                  Fotoğraf ve belgeleri tek ekranda yükle, oda ve fiyat planlarını ekle, admin
                  onayıyla yayına çık.
                </AppText>
                <Button
                  label="Tesis ekle"
                  size="sm"
                  fullWidth={false}
                  style={styles.heroCtaButton}
                  rightIcon={<Ionicons name="arrow-forward" size={15} color={theme.colors.onPrimary} />}
                  onPress={goAdd}
                />
              </View>
            ) : null}
          </View>

          <View style={styles.heroStats}>
            <HeroStat icon="business" label="Tesis" value={items.length} tone="#6284FF" />
            <HeroStat icon="time" label="Onay bekleyen" value={totals.reservations} tone="#FBBF24" />
            <HeroStat icon="chatbubble" label="Okunmamış mesaj" value={totals.messages} tone="#A78BFA" />
            <HeroStat icon="sparkles" label="Açık görev" value={totals.tasks} tone="#3DD68C" />
          </View>
        </View>
      </AuroraBackdrop>

      <View style={[styles.content, { paddingHorizontal: horizontalPadding }]}>
        <View style={styles.quickRow}>
          <QuickAction
            icon="add-circle-outline"
            title="Yeni tesis"
            text="Otel, bungalov, apart, pansiyon veya villa"
            tone={theme.colors.primarySoft}
            foreground={theme.colors.primaryDeep}
            onPress={goAdd}
          />
          <QuickAction
            icon="calendar-outline"
            title="Rezervasyonlarım"
            text="Misafir olarak yaptığın rezervasyonlar"
            tone={theme.colors.accentSoft}
            foreground={theme.colors.accent}
            onPress={() => router.push('/konaklama/rezervasyonlarim' as never)}
          />
          <QuickAction
            icon="help-buoy-outline"
            title="Destek"
            text="Konaklama ekibiyle iletişime geç"
            tone={theme.colors.successSoft}
            foreground={theme.colors.success}
            onPress={() => router.push('/konaklama/destek' as never)}
          />
        </View>

        {draft && !draftHidden ? (
          <View
            style={[
              styles.draftCard,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.draftIcon, { backgroundColor: theme.colors.warningSoft }]}>
              <Ionicons name="document-text-outline" size={17} color={theme.colors.warning} />
            </View>
            <View style={styles.flex}>
              <View style={styles.draftTitleRow}>
                <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                  {draft.form.name.trim() || 'İsimsiz tesis taslağı'}
                </AppText>
                <StatusPill
                  label={`%${draftProgress?.percent ?? 0}`}
                  color={theme.colors.warning}
                  background={theme.colors.warningSoft}
                  icon="trending-up-outline"
                />
              </View>
              <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                Yarım kalan başvurun bu cihazda saklı. Kaldığın adımdan devam edebilirsin.
              </AppText>
              <View style={styles.draftActions}>
                <Button
                  label="Devam et"
                  size="sm"
                  fullWidth={false}
                  onPress={() => router.push('/konaklama/otel-ekle' as never)}
                />
                <Button
                  label="Gizle"
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  onPress={() => setDraftHidden(true)}
                />
              </View>
            </View>
          </View>
        ) : null}

        {context.isLoading ? (
          <View style={styles.loadingWrap}>
            <LoadingBlock height={70} />
            <LoadingBlock height={200} />
          </View>
        ) : context.isError ? (
          <InlineError
            message={context.error instanceof Error ? context.error.message : 'Tesisler yüklenemedi.'}
            onRetry={() => void context.refetch()}
          />
        ) : items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <AuroraBackdrop
              rounded
              colors={[AURORA.indigo, '#1C2450', '#3A2E78']}
              style={styles.onboard}
            >
              <View style={styles.onboardHead}>
                <View style={styles.onboardIcon}>
                  <Ionicons name="rocket" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.flex}>
                  <AppText variant="overline" style={styles.onboardOverline}>
                    ÜCRETSİZ BAŞVURU
                  </AppText>
                  <AppText variant="h3" style={styles.onboardTitle}>
                    Tesisini 4 adımda yayına al
                  </AppText>
                </View>
              </View>
              <View style={styles.onboardSteps}>
                <OnboardStep
                  index={1}
                  icon="create-outline"
                  title="Tesis bilgileri"
                  text="Adres, iletişim, olanaklar ve kurallar"
                />
                <OnboardStep
                  index={2}
                  icon="images-outline"
                  title="Fotoğraf ve belgeler"
                  text="Galeri fotoğrafları ile vergi/işletme belgeleri tek ekranda"
                />
                <OnboardStep
                  index={3}
                  icon="bed-outline"
                  title="Oda ve fiyat"
                  text="Oda tipleri, fiyat planları ve müsaitlik"
                />
                <OnboardStep
                  index={4}
                  icon="shield-checkmark-outline"
                  title="Doğrulama"
                  text="Admin onayı sonrası tesis kamuya açılır"
                />
              </View>
              <Button
                label="Başvuruya başla"
                leftIcon={<Ionicons name="arrow-forward" size={16} color={theme.colors.onPrimary} />}
                onPress={goAdd}
              />
              <View style={styles.onboardHint}>
                <Ionicons name="lock-closed-outline" size={12} color="rgba(255,255,255,0.55)" />
                <AppText variant="caption" style={styles.onboardHintText}>
                  Belgeler gizli depolamada saklanır, yalnızca yetkili admin görebilir.
                </AppText>
              </View>
            </AuroraBackdrop>

            <InfoBanner text="Otel yönetimi için ayrı bir işletme hesabı açman gerekmez. Mevcut Trabzone hesabınla tesis ekleyebilir, aynı hesabı hem normal kullanıcı hem otel yetkilisi olarak kullanabilirsin." />

            <View style={styles.infoGrid}>
              <InfoTile
                icon="layers-outline"
                title="Tek hesap"
                text="Misafir ve işletme tarafı aynı Trabzone hesabında yaşar."
              />
              <InfoTile
                icon="cloud-done-outline"
                title="Otomatik taslak"
                text="Başvurudan çıksan bile girdiğin bilgiler cihazında saklanır."
              />
              <InfoTile
                icon="wallet-outline"
                title="Şeffaf finans"
                text="Komisyon, kasa ve raporlar gerçek kayıtlardan hesaplanır."
              />
            </View>

            <EmptyState
              icon="business-outline"
              title="Henüz tesisin yok"
              message="Başvurunu tamamladığında oda takvimi, ön büro, kasa ve finans modülleri otomatik açılır."
              actionLabel="Başvuruya başla"
              onAction={goAdd}
              compact
            />
          </View>
        ) : (
          <View style={styles.body}>
            <PortfolioHealth
              total={items.length}
              published={totals.published}
              verified={totals.verified}
            />

            <SectionTitle
              overline="PORTFÖY"
              title="Tesislerin"
              icon="business"
              subtitle="Yönetmek istediğin tesisi seç · her tesise ayrı personel ve yetki tanımlanabilir"
              actionLabel={canAddProperty ? 'Yeni tesis' : undefined}
              onAction={canAddProperty ? goAdd : undefined}
            />

            <View style={styles.grid}>
              {items.map((property) => (
                <PropertyManageCard
                  key={property.id}
                  property={property}
                  onPress={() => openProperty(property.id)}
                />
              ))}

              {canAddProperty ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Yeni tesis ekle"
                  onPress={goAdd}
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
                    Otel, bungalow, apart, pansiyon veya villa
                  </AppText>
                </Pressable>
              ) : null}
            </View>

            <View style={[styles.footerNote, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="information-circle-outline" size={14} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary" style={styles.flex}>
                Tesis kartındaki fotoğraf vitrin kapak görselidir. Kapak, fotoğraf ve medya
                yönetiminden değiştirilebilir.
              </AppText>
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

function HeroStat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: IconName;
  tone: string;
}) {
  return (
    <View style={styles.heroStat}>
      <View style={[styles.heroStatIcon, { backgroundColor: `${tone}22` }]}>
        <Ionicons name={icon} size={13} color={tone} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" style={styles.heroStatValue} numberOfLines={1}>
          {value}
        </AppText>
        <AppText variant="caption" style={styles.heroStatLabel} numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Hızlı işlemler                                                              */
/* -------------------------------------------------------------------------- */

function QuickAction({
  icon,
  title,
  text,
  tone,
  foreground,
  onPress,
}: {
  icon: IconName;
  title: string;
  text: string;
  tone: string;
  foreground: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      <View style={[styles.quickIcon, { backgroundColor: tone }]}>
        <Ionicons name={icon} size={17} color={foreground} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={2}>
          {text}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Portföy sağlığı                                                             */
/* -------------------------------------------------------------------------- */

function PortfolioHealth({
  total,
  published,
  verified,
}: {
  total: number;
  published: number;
  verified: number;
}) {
  const { theme } = useTheme();
  const pending = Math.max(0, total - published);
  const pct = (value: number) => `${Math.round((value / Math.max(1, total)) * 100)}%`;
  return (
    <View
      style={[
        styles.healthCard,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={styles.healthHead}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Portföy durumu</AppText>
          <AppText variant="caption" color="textTertiary">
            {published} / {total} tesis yayında · {verified} doğrulanmış
          </AppText>
        </View>
        <View style={styles.healthLegend}>
          <LegendDot color={theme.colors.success} label="Yayında" />
          <LegendDot color={theme.colors.warning} label="Bekliyor" />
        </View>
      </View>
      <View style={[styles.healthTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
        {published > 0 ? (
          <View
            style={[styles.healthFill, { width: pct(published), backgroundColor: theme.colors.success }]}
          />
        ) : null}
        {pending > 0 ? (
          <View
            style={[styles.healthFill, { width: pct(pending), backgroundColor: theme.colors.warning }]}
          />
        ) : null}
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendDotWrap}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Tesis kartı                                                                 */
/* -------------------------------------------------------------------------- */

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
  const pendingTotal = property.pending_reservations + property.unread_messages + property.pending_tasks;

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
          opacity: pressed ? 0.97 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
        theme.shadows.card,
      ]}
    >
      <View style={styles.cardMedia}>
        {cover ? (
          <AppImage
            source={{ uri: cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
            recycleKey={property.id}
          />
        ) : (
          <LinearGradient
            colors={[theme.colors.primarySoft, theme.colors.surfaceMuted]}
            style={[StyleSheet.absoluteFill, styles.cardMediaFallback]}
          >
            <Ionicons
              name={TYPE_ICONS[property.property_type] ?? 'business'}
              size={30}
              color={theme.colors.primaryDeep}
            />
          </LinearGradient>
        )}
        <LinearGradient
          colors={['rgba(6,10,20,0.42)', 'transparent', 'rgba(6,10,20,0.72)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.cardMediaTop}>
          <StatusPill
            label={PROPERTY_STATUS_LABELS[property.status]}
            color={published ? '#3DD68C' : '#FBBF24'}
            background={published ? 'rgba(22,163,74,0.28)' : 'rgba(245,158,11,0.28)'}
            border={published ? 'rgba(61,214,140,0.5)' : 'rgba(251,191,36,0.5)'}
            icon={published ? 'globe-outline' : 'time-outline'}
          />
          <StatusPill
            label={VERIFICATION_STATUS_LABELS[property.verification_status]}
            color={verified ? '#3DD68C' : '#FBBF24'}
            background="rgba(8,13,26,0.55)"
            border={verified ? 'rgba(61,214,140,0.45)' : 'rgba(251,191,36,0.45)'}
            icon={verified ? 'shield-checkmark' : 'shield-outline'}
          />
        </View>
        <View style={styles.cardMediaBottom}>
          <View style={styles.cardTypePill}>
            <Ionicons
              name={TYPE_ICONS[property.property_type] ?? 'business'}
              size={11}
              color="#FFFFFF"
            />
            <AppText variant="caption" style={styles.cardTypeText}>
              {PROPERTY_TYPE_LABELS[property.property_type]}
            </AppText>
          </View>
          <AppText variant="caption" style={styles.cardRole} numberOfLines={1}>
            {property.role === 'admin' ? 'Platform yöneticisi' : STAFF_ROLE_LABELS[property.role]}
          </AppText>
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <View style={styles.flex}>
            <AppText variant="title" numberOfLines={1}>
              {property.name}
            </AppText>
            <View style={styles.cardLocation}>
              <Ionicons name="location-outline" size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
                {[property.neighborhood, property.district].filter(Boolean).join(', ') || 'Trabzon'}
              </AppText>
            </View>
          </View>
          <View style={[styles.cardGo, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="arrow-forward" size={14} color={theme.colors.primaryDeep} />
          </View>
        </View>

        <View style={[styles.metrics, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Metric
            icon="time-outline"
            label="Onay"
            value={property.pending_reservations}
            tone={theme.colors.warning}
          />
          <View style={[styles.metricDivider, { backgroundColor: theme.colors.divider }]} />
          <Metric
            icon="chatbubble-outline"
            label="Mesaj"
            value={property.unread_messages}
            tone={theme.colors.primary}
          />
          <View style={[styles.metricDivider, { backgroundColor: theme.colors.divider }]} />
          <Metric
            icon="sparkles-outline"
            label="Görev"
            value={property.pending_tasks}
            tone={theme.colors.accent}
          />
        </View>

        {property.verification_note ? (
          <View style={[styles.note, { backgroundColor: theme.colors.warningSoft }]}>
            <Ionicons name="information-circle-outline" size={13} color={theme.colors.warning} />
            <AppText variant="caption" color="warning" numberOfLines={2} style={styles.flex}>
              {property.verification_note}
            </AppText>
          </View>
        ) : pendingTotal === 0 ? (
          <View style={styles.clearRow}>
            <Ionicons name="checkmark-circle" size={13} color={theme.colors.success} />
            <AppText variant="caption" color="textTertiary">
              Bekleyen işlem yok
            </AppText>
          </View>
        ) : null}

        <View style={[styles.cardCta, { borderTopColor: theme.colors.divider }]}>
          <AppText variant="caption" color="primaryDeep" style={styles.cardCtaText}>
            Yönetim panelini aç
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {pendingTotal > 0 ? `${pendingTotal} bekleyen iş` : 'Her şey güncel'}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconName;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={12} color={value > 0 ? tone : '#94A3B8'} />
      <AppText variant="bodyStrong" style={styles.metricValue}>
        {value}
      </AppText>
      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Boş durum ve bilgi kutuları                                                 */
/* -------------------------------------------------------------------------- */

function OnboardStep({
  index,
  icon,
  title,
  text,
}: {
  index: number;
  icon: IconName;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIndex}>
        <AppText variant="caption" style={styles.stepIndexText}>
          {index}
        </AppText>
      </View>
      <Ionicons name={icon} size={14} color="rgba(255,255,255,0.75)" />
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

function InfoTile({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.infoTile,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={[styles.infoTileIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={15} color={theme.colors.primaryDeep} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" color="textTertiary">
          {text}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  hero: { paddingBottom: 18 },
  heroInner: { width: '100%', maxWidth: 1280, alignSelf: 'center', gap: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBrand: { flex: 1, alignItems: 'center', gap: 1 },
  brandOverline: { color: 'rgba(255,255,255,0.55)', fontSize: 8, letterSpacing: 2.2 },
  brandTitle: { color: '#FFFFFF', fontSize: 14 },
  heroTopRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  heroMain: { flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  heroCopy: { flex: 1, gap: 5 },
  heroOverline: { color: 'rgba(255,255,255,0.5)', fontSize: 8, letterSpacing: 2 },
  heroTitle: { color: '#FFFFFF', fontSize: 28, lineHeight: 34, letterSpacing: -0.9 },
  heroSubtitle: { color: 'rgba(255,255,255,0.66)', fontSize: 11, lineHeight: 17, maxWidth: 560 },
  heroMobileCta: { marginTop: 6 },

  heroCta: {
    width: 300,
    gap: 5,
    padding: 15,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  heroCtaTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroCtaIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroCtaOverline: { color: 'rgba(255,255,255,0.6)', fontSize: 8, letterSpacing: 1.6 },
  heroCtaTitle: { color: '#FFFFFF', fontSize: 15, lineHeight: 21 },
  heroCtaText: { color: 'rgba(255,255,255,0.62)', fontSize: 10, lineHeight: 15 },
  heroCtaButton: { marginTop: 4 },

  heroStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroStat: {
    flex: 1,
    minWidth: 132,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  heroStatIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  heroStatValue: { color: '#FFFFFF', fontSize: 15, lineHeight: 19 },
  heroStatLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 9, lineHeight: 12 },

  content: { width: '100%', maxWidth: 1280, alignSelf: 'center', paddingTop: 14, paddingBottom: 34, gap: 14 },

  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  quickCard: {
    flex: 1,
    minWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  draftCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  draftIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  draftTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  draftActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },

  loadingWrap: { gap: 11 },
  emptyWrap: { gap: 12 },
  body: { gap: 13 },

  healthCard: { padding: 13, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, gap: 9 },
  healthHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  healthLegend: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendDotWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  healthTrack: { flexDirection: 'row', height: 7, borderRadius: 4, overflow: 'hidden' },
  healthFill: { height: '100%' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '32%',
    minWidth: 296,
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    overflow: 'hidden',
  },
  cardMedia: { height: 168, position: 'relative' },
  cardMediaFallback: { alignItems: 'center', justifyContent: 'center' },
  cardMediaTop: {
    position: 'absolute',
    top: 9,
    left: 9,
    right: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
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
  cardRole: { color: 'rgba(255,255,255,0.78)', fontSize: 9, marginLeft: 'auto', maxWidth: '52%' },
  cardBody: { padding: 13, gap: 9 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardLocation: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  cardGo: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  metrics: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 11 },
  metric: { flex: 1, alignItems: 'center', gap: 1 },
  metricValue: { fontSize: 14, lineHeight: 18, fontVariant: ['tabular-nums'] },
  metricDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 3 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, padding: 8, borderRadius: 9 },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardCtaText: { flex: 1, fontSize: 11 },

  addCard: {
    width: '32%',
    minWidth: 296,
    flexGrow: 1,
    minHeight: 210,
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

  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 9,
    borderRadius: 9,
  },

  onboard: { padding: 18, gap: 14 },
  onboardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  onboardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardOverline: { color: 'rgba(255,255,255,0.55)', fontSize: 8, letterSpacing: 1.8 },
  onboardTitle: { color: '#FFFFFF' },
  onboardSteps: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
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
  onboardHint: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onboardHintText: { color: 'rgba(255,255,255,0.55)', fontSize: 10 },

  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  infoTile: {
    flex: 1,
    minWidth: 240,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoTileIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
