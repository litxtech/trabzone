import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  ActionSheet,
  AppText,
  Button,
  IconButton,
  type ActionSheetItem,
} from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/theme/ThemeProvider';

import {
  RideEmptyState,
  RideQuickAction,
  RideRouteBlock,
  RideSection,
  StatusPill,
} from '@/features/ride/components/RideBits';
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

type When = 'any' | 'today' | 'tomorrow';

const WHEN_LABEL: Record<When, string> = {
  any: 'Esnek',
  today: 'Bugün',
  tomorrow: 'Yarın',
};

const MENU_ITEMS: ActionSheetItem[] = [
  {
    key: 'requests',
    label: 'Yolcu taleplerim',
    icon: 'hand-left-outline',
    description: 'Açık taleplerini görüntüle',
  },
  { key: 'favorites', label: 'Favori güzergâhlar', icon: 'heart-outline' },
  { key: 'safety', label: 'Güvenlik merkezi', icon: 'shield-checkmark-outline' },
  { key: 'messages', label: 'Mesajlar', icon: 'chatbubbles-outline' },
  { key: 'verification', label: 'Doğrulamalar', icon: 'id-card-outline' },
  { key: 'archive', label: 'Arşiv ve raporlar', icon: 'archive-outline' },
  { key: 'policy', label: 'Yolculuk anlaşması', icon: 'document-text-outline' },
];

export default function RideLobbyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const profile = useRideProfile();
  const trips = useMyTrips('upcoming');

  const [scope, setScope] = useState<RideScope>('intracity');
  const [origin, setOrigin] = useState('');
  const [dest, setDest] = useState('');
  const [when, setWhen] = useState<When>('any');
  const [menuOpen, setMenuOpen] = useState(false);
  const nearby = useRideSearch({ scope, mode: 'all', limit: 3 });

  const upcoming = trips.data?.[0] ?? null;
  // Profildeki alan senkronsuz kalabildiği için onaylı belge kaydı da hesaba katılır.
  const identityApproved = isIdentityVerified(profile.data);

  const goSearch = (nextScope: RideScope = scope) =>
    router.navigate({
      pathname: '/ride/search',
      params: {
        scope: nextScope,
        origin: origin.trim(),
        dest: dest.trim(),
        when,
      },
    } as never);

  const handleMenu = (key: string) => {
    setMenuOpen(false);
    switch (key) {
      case 'requests':
        router.navigate('/ride/requests' as never);
        break;
      case 'favorites':
        router.navigate('/ride/favorites' as never);
        break;
      case 'safety':
        router.navigate('/ride/safety' as never);
        break;
      case 'messages':
        router.navigate('/messages' as never);
        break;
      case 'verification':
        router.navigate('/ride/verification' as never);
        break;
      case 'archive':
        router.navigate('/ride/archive' as never);
        break;
      case 'policy':
        router.navigate('/ride/policy' as never);
        break;
      default:
        break;
    }
  };

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      scroll
      padded
      contentContainerStyle={styles.page}
    >
      <RideHeader
        title="Yolculuk"
        subtitle="Nereden nereye?"
        right={
          <View style={styles.headerActions}>
            <IconButton
              name="car-outline"
              accessibilityLabel="Garajım"
              variant="surface"
              size={19}
              onPress={() => router.navigate('/ride/garage' as never)}
            />
            <IconButton
              name="receipt-outline"
              accessibilityLabel="Yolculuklarım"
              variant="surface"
              size={19}
              onPress={() => router.navigate('/ride/trips' as never)}
            />
            <IconButton
              name="ellipsis-horizontal"
              accessibilityLabel="Diğer işlemler"
              variant="surface"
              size={19}
              onPress={() => setMenuOpen(true)}
            />
          </View>
        }
      />

      <View
        style={[
          styles.searchCard,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <View style={[styles.segment, { backgroundColor: theme.colors.surfaceMuted }]}>
          {(['intracity', 'intercity'] as RideScope[]).map((item) => {
            const active = scope === item;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setScope(item)}
                style={[
                  styles.segmentItem,
                  {
                    backgroundColor: active ? theme.colors.surface : 'transparent',
                    borderColor: active ? theme.colors.border : 'transparent',
                  },
                ]}
              >
                <Ionicons
                  name={item === 'intracity' ? 'business-outline' : 'trail-sign-outline'}
                  size={14}
                  color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
                />
                <AppText
                  variant="label"
                  color={active ? 'primaryDeep' : 'textTertiary'}
                  numberOfLines={1}
                >
                  {SCOPE_LABEL[item]}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.inputs}>
          <View style={styles.inputRow}>
            <View style={[styles.inputDot, { backgroundColor: theme.colors.success }]} />
            <TextInput
              value={origin}
              onChangeText={setOrigin}
              placeholder="Nereden?"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.input, theme.typography.body, { color: theme.colors.text }]}
              returnKeyType="next"
              accessibilityLabel="Kalkış noktası"
            />
          </View>
          <View
            style={[styles.inputConnector, { backgroundColor: theme.colors.borderStrong }]}
          />
          <View style={styles.inputRow}>
            <View style={[styles.inputDot, { backgroundColor: theme.colors.primary }]} />
            <TextInput
              value={dest}
              onChangeText={setDest}
              placeholder="Nereye?"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.input, theme.typography.body, { color: theme.colors.text }]}
              returnKeyType="search"
              onSubmitEditing={() => goSearch()}
              accessibilityLabel="Varış noktası"
            />
          </View>
        </View>

        <View style={styles.searchFoot}>
          <View style={styles.chips}>
            {(['today', 'tomorrow', 'any'] as When[]).map((item) => {
              const active = when === item;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setWhen(item)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                    {WHEN_LABEL[item]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <Button
            label="Ara"
            size="sm"
            fullWidth={false}
            leftIcon={<Ionicons name="search" size={15} color="#FFFFFF" />}
            onPress={() => goSearch()}
            style={styles.searchButton}
          />
        </View>
      </View>

      <View style={styles.quickRow}>
        <RideQuickAction
          icon="add-circle-outline"
          title="Yolculuk paylaş"
          subtitle="Araçla ilan ver"
          tone="primary"
          onPress={() => router.navigate('/ride/create' as never)}
        />
        <RideQuickAction
          icon="hand-left-outline"
          title="Yolcu talebi"
          subtitle="Nereye gideceğini yaz"
          tone="accent"
          onPress={() => router.navigate('/ride/request' as never)}
        />
      </View>

      {!identityApproved ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kimlik doğrulaması"
          onPress={() => router.navigate('/ride/verification' as never)}
          style={[
            styles.notice,
            {
              backgroundColor: theme.colors.warningSoft,
              borderColor: theme.colors.warning,
            },
          ]}
        >
          <Ionicons name="shield-half-outline" size={17} color={theme.colors.warning} />
          <View style={styles.flex}>
            <AppText variant="label">Kimlik doğrulaması</AppText>
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {profile.data
                ? `${VERIFICATION_STATUS_LABEL[profile.data.identity_status] ?? profile.data.identity_status} · Rezervasyon için gerekli`
                : 'Rezervasyon için gerekli'}
            </AppText>
          </View>
          <AppText variant="label" color="primaryDeep">
            Doğrula
          </AppText>
          <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
        </Pressable>
      ) : null}

      {upcoming ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AppText variant="title" style={styles.flex}>
              Yaklaşan yolculuğun
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tüm yolculuklarım"
              onPress={() => router.navigate('/ride/trips' as never)}
              hitSlop={8}
            >
              <AppText variant="caption" color="primaryDeep">
                Tümü
              </AppText>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${upcoming.origin_label} - ${upcoming.dest_label} yaklaşan yolculuğu`}
            onPress={() => router.navigate(`/ride/trips/${upcoming.id}` as never)}
            style={({ pressed }) => [
              styles.upcomingCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
          >
            <View style={styles.upcomingTop}>
              <View style={styles.flex}>
                <RideRouteBlock
                  origin={upcoming.origin_label}
                  dest={upcoming.dest_label}
                  emphasis
                />
              </View>
              <StatusPill status={upcoming.status} />
            </View>
            <View style={[styles.upcomingMeta, { borderTopColor: theme.colors.divider }]}>
              <Ionicons name="calendar-outline" size={13} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textSecondary">
                {dayLabel(upcoming.depart_at)} · {formatTime(upcoming.depart_at)}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                ·
              </AppText>
              <AppText variant="caption" color="textSecondary">
                {upcoming.seats} koltuk
              </AppText>
              <View style={styles.flex} />
              <AppText variant="label" color="primaryDeep">
                {formatMoney(upcoming.total_cents, upcoming.currency)}
              </AppText>
            </View>
          </Pressable>
        </View>
      ) : null}

      <RideSection
        bare
        title="Yakındaki yolculuklar"
        subtitle={SCOPE_LABEL[scope]}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tüm yolculukları gör"
            onPress={() => goSearch(scope)}
            hitSlop={8}
          >
            <AppText variant="caption" color="primaryDeep">
              Tümünü gör
            </AppText>
          </Pressable>
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
            action={
              <Button
                label="Tekrar dene"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={() => void nearby.refetch()}
              />
            }
          />
        ) : (nearby.data?.items.length ?? 0) === 0 ? (
          <RideEmptyState
            icon="car-outline"
            title="Yakında ilan yok"
            message="Şu anda yayınlanmış şehir içi yolculuk bulunmuyor. Yolcu talebi oluşturup sürücülerin sana ulaşmasını sağlayabilirsin."
            action={
              <Button
                label="Yolcu talebi oluştur"
                variant="secondary"
                size="sm"
                fullWidth={false}
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

      <AppText variant="caption" color="textTertiary" align="center" style={styles.footnote}>
        Masraf paylaşımıdır; ticari taşımacılık değildir. Acil durumda 112’yi ara.
      </AppText>

      <ActionSheet
        visible={menuOpen}
        title="Yolculuk araçları"
        items={MENU_ITEMS}
        onSelect={handleMenu}
        onClose={() => setMenuOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 880, alignSelf: 'center', gap: 14 },
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    gap: 11,
  },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 12, gap: 3 },
  segmentItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  inputs: { gap: 0 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
  inputDot: { width: 8, height: 8, borderRadius: 4 },
  inputConnector: { width: 1, height: 10, marginLeft: 3.5, opacity: 0.7 },
  input: { flex: 1, paddingVertical: 4 },
  searchFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchButton: { marginLeft: 'auto', minWidth: 96, paddingHorizontal: 18 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  upcomingCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    gap: 10,
  },
  upcomingTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upcomingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 9,
  },
  center: { paddingVertical: 22, alignItems: 'center' },
  list: { gap: 8 },
  footnote: { opacity: 0.85, marginTop: 2 },
});
