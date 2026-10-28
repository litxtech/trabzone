import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from '@/utils/router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import {
  LevelBadge,
  RideActionTile,
  RideEmptyState,
  RideSection,
  RideStat,
} from '@/features/ride/components/RideBits';
import { IdentityReadyBanner, VerifiedTick } from '@/features/ride/components/IdentityBadge';
import { RideOfferCard } from '@/features/ride/components/RideOfferCard';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { useMyTrips, useRideProfile, useRideSearch } from '@/features/ride/hooks/use-ride';
import type { RideScope } from '@/features/ride/types';
import {
  SCOPE_LABEL,
  VERIFICATION_STATUS_LABEL,
  dayLabel,
  formatMoney,
  formatTime,
} from '@/features/ride/utils/format';
import { isIdentityVerified } from '@/features/ride/utils/identity';

export default function RideLobbyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const session = useAuthStore((state) => state.session);
  const profile = useRideProfile();
  const trips = useMyTrips('upcoming');
  const nearby = useRideSearch({ scope: 'intracity', mode: 'all', limit: 3 });

  const firstName =
    (session?.user.user_metadata?.first_name as string | undefined) ??
    (session?.user.user_metadata?.full_name as string | undefined)?.split(' ')[0] ??
    null;
  const upcoming = trips.data?.[0] ?? null;
  // Profildeki alan senkronsuz kalabildiği için onaylı belge kaydı da hesaba katılır.
  const identityApproved = isIdentityVerified(profile.data);
  const driverApproved = profile.data?.driver_status === 'approved';

  const goSearch = (scope: RideScope) => {
    router.navigate({ pathname: '/ride/search', params: { scope } } as never);
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Yolculuk"
        subtitle="Trabzone Yolculuk Paylaşımı"
        right={
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Haritada gör"
              onPress={() => router.navigate('/map' as never)}
              style={[styles.iconBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name="map-outline" size={19} color={theme.colors.primaryDeep} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bildirimler"
              onPress={() => router.navigate('/notifications' as never)}
              style={[styles.iconBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            >
              <Ionicons name="notifications-outline" size={19} color={theme.colors.text} />
            </Pressable>
          </View>
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
            <AppText variant="caption" style={styles.heroEyebrow}>
              TRABZONE · YOLCULUK PAYLAŞIMI
            </AppText>
            <AppText variant="h1" style={styles.heroTitle}>
              {firstName ? `Merhaba ${firstName},` : 'Yolculuğun burada başlıyor.'}
            </AppText>
            <AppText variant="body" style={styles.heroSubtitle}>
              Şehir içi ve şehirler arası; masraf paylaşımıyla, doğrulanmış yol arkadaşlarıyla.
            </AppText>
          </View>
          <View style={styles.heroBadge}>
            <Ionicons name="car-sport" size={20} color="#DCE6FF" />
          </View>
        </View>

        <View style={styles.heroStats}>
          <RideStat
            icon={identityApproved ? 'checkmark-circle' : 'shield-checkmark-outline'}
            value={
              profile.data
                ? identityApproved
                  ? 'Doğrulandı'
                  : (VERIFICATION_STATUS_LABEL[profile.data.identity_status] ??
                    profile.data.identity_status)
                : '—'
            }
            label="Kimlik"
          />
          <View style={styles.heroDivider} />
          <RideStat
            icon="star-outline"
            value={profile.data?.rating_avg ? profile.data.rating_avg.toFixed(1) : '—'}
            label="Puan"
          />
          <View style={styles.heroDivider} />
          <RideStat
            icon="checkmark-done-outline"
            value={profile.data?.completed_trips ?? 0}
            label="Yolculuk"
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yolculuk ara"
          onPress={() => goSearch('intracity')}
          style={({ pressed }) => [styles.searchPill, { opacity: pressed ? 0.9 : 1 }]}
        >
          <Ionicons name="search" size={18} color="#2F55D4" />
          <AppText variant="body" color="#4C5B7A" style={styles.searchText}>
            Nereden nereye?
          </AppText>
          <View style={styles.searchGo}>
            <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
          </View>
        </Pressable>

        <View style={styles.scopeRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => goSearch('intracity')}
            style={styles.scopeChip}
          >
            <Ionicons name="business-outline" size={13} color="#EAF0FF" />
            <AppText variant="caption" style={styles.scopeText}>
              Şehir içi
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => goSearch('intercity')}
            style={styles.scopeChip}
          >
            <Ionicons name="trail-sign-outline" size={13} color="#EAF0FF" />
            <AppText variant="caption" style={styles.scopeText}>
              Şehirler arası
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/ride/recurring' as never)}
            style={styles.scopeChip}
          >
            <Ionicons name="repeat-outline" size={13} color="#EAF0FF" />
            <AppText variant="caption" style={styles.scopeText}>
              Düzenli
            </AppText>
          </Pressable>
        </View>
      </LinearGradient>

      {identityApproved ? (
        <IdentityReadyBanner
          subtitle="Kimliğin doğrulandı; rezervasyon ve ilanlarda tekrar belge istenmez."
          onPress={() => router.navigate('/settings/verifications' as never)}
        />
      ) : (
        <Card
          padding={14}
          tone="primarySoft"
          style={[styles.verifyCard, { borderColor: theme.colors.primary }]}
        >
          <View style={[styles.verifyIcon, { backgroundColor: theme.colors.primary }]}>
            <Ionicons name="shield-half-outline" size={18} color="#FFFFFF" />
          </View>
          <View style={styles.flex}>
            <AppText variant="label">Rezervasyon için kimlik doğrulaması gerekli</AppText>
            <AppText variant="caption" color="textSecondary">
              Belgeler gizli kovada saklanır. Onay tamamlanmadan rezervasyon oluşturulamaz.
            </AppText>
          </View>
          <Button
            label="Doğrula"
            size="sm"
            fullWidth={false}
            onPress={() => router.navigate('/ride/verification' as never)}
          />
        </Card>
      )}

      <View style={styles.roleHead}>
        <AppText variant="label" color="textSecondary">
          Ne yapmak istiyorsun?
        </AppText>
        <AppText variant="caption" color="textTertiary">
          Sürücü ilanı ve yolcu talebi ayrı akışlardır.
        </AppText>
      </View>
      <View style={styles.actions}>
        <RideActionTile
          icon="add-circle-outline"
          title="Sürücü: Yolculuk Paylaş"
          subtitle="Aracınla ilan ver, koltuk aç"
          tone="primary"
          onPress={() => router.navigate('/ride/create' as never)}
        />
        <RideActionTile
          icon="hand-left-outline"
          title="Yolcu: Talep Oluştur"
          subtitle="Nereye gideceğini yaz, eşleş"
          tone="accent"
          onPress={() => router.navigate('/ride/request' as never)}
        />
      </View>

      {upcoming ? (
        <RideSection
          title="Yaklaşan yolculuğun"
          subtitle={`${dayLabel(upcoming.depart_at)} · ${formatTime(upcoming.depart_at)}`}
          action={
            <Button
              label="Tümü"
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={() => router.navigate('/ride/trips' as never)}
            />
          }
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate(`/ride/trips/${upcoming.id}` as never)}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, gap: 8 }]}
          >
            <View style={styles.upcomingRow}>
              <View style={styles.flex}>
                <AppText variant="label">
                  {upcoming.origin_label} → {upcoming.dest_label}
                </AppText>
                <View style={styles.driverLine}>
                  {upcoming.driver_identity_verified ? <VerifiedTick size={14} /> : null}
                  <AppText variant="caption" color="textSecondary" style={styles.flex}>
                    {upcoming.driver_first_name ?? upcoming.driver_username} ·{' '}
                    {upcoming.vehicle.make} {upcoming.vehicle.model}
                  </AppText>
                </View>
              </View>
              <Badge
                label={
                  upcoming.status === 'confirmed'
                    ? 'Onaylandı'
                    : upcoming.status === 'requested'
                      ? 'Onay bekliyor'
                      : upcoming.status
                }
                tone={upcoming.status === 'confirmed' ? 'success' : 'warning'}
              />
            </View>
            <View style={styles.upcomingFoot}>
              <AppText variant="caption" color="textTertiary">
                {upcoming.seats} koltuk · {formatMoney(upcoming.total_cents, upcoming.currency)}
              </AppText>
              <AppText variant="caption" color="primaryDeep">
                Detay →
              </AppText>
            </View>
          </Pressable>
        </RideSection>
      ) : null}

      <RideSection
        title="Yakındaki şehir içi yolculuklar"
        subtitle="Gerçek ilanlar, hesaplanmış eşleşme puanıyla"
        action={
          <Button
            label="Haritada ara"
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => goSearch('intracity')}
          />
        }
      >
        {nearby.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : nearby.isError ? (
          <RideEmptyState
            icon="cloud-offline-outline"
            title="Yolculuklar yüklenemedi"
            message={nearby.error.message}
            action={<Button label="Tekrar dene" variant="secondary" onPress={() => void nearby.refetch()} />}
          />
        ) : (nearby.data?.items.length ?? 0) === 0 ? (
          <RideEmptyState
            icon="car-outline"
            title="Yakında ilan yok"
            message="Şu anda şehir içi yayınlanmış yolculuk bulunmuyor. Yolcu talebi oluşturup uygun sürücü geldiğinde bildirim alabilirsin."
            action={
              <Button
                label="Yolcu talebi oluştur"
                variant="secondary"
                onPress={() => router.navigate('/ride/request' as never)}
              />
            }
          />
        ) : (
          <View style={styles.list}>
            {nearby.data?.items.map((offer) => (
              <RideOfferCard key={offer.id} offer={offer} />
            ))}
          </View>
        )}
      </RideSection>

      <View style={styles.grid}>
        <RideActionTile
          icon="receipt-outline"
          title="Yolculuklarım"
          subtitle="Yaklaşan ve geçmiş"
          onPress={() => router.navigate('/ride/trips' as never)}
        />
        <RideActionTile
          icon="heart-outline"
          title="Favori Güzergâhlar"
          subtitle="Tek dokunuşla ara"
          onPress={() => router.navigate('/ride/favorites' as never)}
        />
        <RideActionTile
          icon="car-outline"
          title="Garajım"
          subtitle={profile.data ? `${profile.data.vehicle_count} araç` : 'Araç ve belgeler'}
          onPress={() => router.navigate('/ride/garage' as never)}
        />
        <RideActionTile
          icon="shield-checkmark-outline"
          title="Güvenlik Merkezi"
          subtitle="SOS, konum paylaşımı"
          onPress={() => router.navigate('/ride/safety' as never)}
        />
        <RideActionTile
          icon="chatbubbles-outline"
          title="Mesajlar"
          subtitle="Yolculuk sohbetleri"
          onPress={() => router.navigate('/messages' as never)}
        />
        <RideActionTile
          icon="id-card-outline"
          title="Doğrulamalar"
          subtitle={
            identityApproved
              ? driverApproved
                ? 'Kimlik ve sürücü onaylı'
                : 'Kimlik onaylı · eksik belge'
              : profile.data?.identity_status === 'pending'
                ? 'Kimlik inceleniyor'
                : 'Kimlik doğrula'
          }
          onPress={() => router.navigate('/ride/verification' as never)}
        />
        <RideActionTile
          icon="archive-outline"
          title="Arşiv ve Raporlar"
          subtitle="Özetler, PDF, harcama"
          onPress={() => router.navigate('/ride/archive' as never)}
        />
        <RideActionTile
          icon="document-text-outline"
          title="Yolculuk Anlaşması"
          subtitle="Koşullar ve sürüm"
          onPress={() => router.navigate('/ride/policy' as never)}
        />
      </View>

      <Card padding={14} tone="muted" style={styles.trust}>
        <View style={styles.trustHead}>
          <Ionicons name="lock-closed-outline" size={15} color={theme.colors.primaryDeep} />
          <AppText variant="label">Güven ve şeffaflık</AppText>
          <LevelBadge level={profile.data?.level ?? null} />
        </View>
        <AppText variant="caption" color="textSecondary">
          Tam adresler yalnızca rezervasyon taraflarına gösterilir. Kart verisi saklanmaz;
          kartlı ödeme, ödeme kuruluşu yetkileri tamamlanana kadar kapalıdır. Yolculuk sırasında
          acil durumlarda 112 aranmalıdır — Trabzone resmi acil yardım hizmeti değildir.
        </AppText>
        {!driverApproved ? (
          <Button
            label="Sürücü olarak başvur"
            size="sm"
            variant="secondary"
            onPress={() => router.navigate('/ride/verification' as never)}
          />
        ) : (
          <Button
            label="İlan ver"
            size="sm"
            variant="secondary"
            onPress={() => router.navigate('/ride/create' as never)}
          />
        )}
      </Card>

      <AppText variant="caption" color="textTertiary" align="center" style={styles.scopeFootnote}>
        {SCOPE_LABEL.intracity} · {SCOPE_LABEL.intercity} · Masraf paylaşımı, ticari taşımacılık değildir.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { flexDirection: 'row', gap: 7 },
  hero: { borderRadius: 24, padding: 18, gap: 16, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heroText: { flex: 1, gap: 6 },
  heroEyebrow: { color: 'rgba(235,242,255,0.72)', letterSpacing: 1.1, fontSize: 10 },
  heroTitle: { color: '#FFFFFF' },
  heroSubtitle: { color: 'rgba(235,242,255,0.86)' },
  heroBadge: {
    width: 46,
    height: 46,
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
    paddingVertical: 9,
  },
  heroDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(255,255,255,0.22)' },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    paddingLeft: 14,
    paddingRight: 7,
    paddingVertical: 7,
  },
  searchText: { flex: 1 },
  searchGo: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: '#2F55D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  scopeText: { color: '#EAF0FF' },
  verifyCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  verifyIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  roleHead: { gap: 1 },
  driverLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  center: { paddingVertical: 24, alignItems: 'center' },
  list: { gap: 10 },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  upcomingFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  trust: { gap: 9 },
  trustHead: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  scopeFootnote: { opacity: 0.85 },
});
