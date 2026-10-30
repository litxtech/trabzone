import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AppText, IconButton, Screen, Skeleton, TextField } from '@/components/ui';
import { loginHref } from '@/features/auth/next-path';
import { useDeviceLocation } from '@/features/map/hooks/use-map';
import { PharmacyCard } from '@/features/pharmacy/components/PharmacyCard';
import {
  PharmacyDutyHighlight,
  PharmacyDutyNoticeBanner,
} from '@/features/pharmacy/components/PharmacyDutyHighlight';
import { PharmacyNotificationSheet } from '@/features/pharmacy/components/PharmacyNotificationSheet';
import {
  usePharmacies,
  usePharmacyBootstrap,
  usePharmacyDutyNotice,
  usePharmacyDutyStatus,
  usePharmacyNotificationPrefs,
  useTogglePharmacyNotificationDistrict,
} from '@/features/pharmacy/hooks/use-pharmacy';
import type { PharmacySummary } from '@/features/pharmacy/types';
import { staleNotice, type DutyStateFilter } from '@/features/pharmacy/utils/status';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

const PAGE_SIZE = 40;

function normalize(value: string) {
  return value.toLocaleLowerCase('tr-TR').trim();
}

const SEGMENTS: { key: DutyStateFilter; label: string }[] = [
  { key: 'duty_today', label: 'Bugün nöbetçi' },
  { key: 'all', label: 'Tüm eczaneler' },
  { key: 'nearby', label: 'Yakınımda' },
];

/**
 * Nöbetçi eczane rehberi.
 *
 * Varsayılan görünüm "bugün nöbetçi"dir: kullanıcı uygulamayı açtığında tek
 * bakışta bugün hangi eczanenin nöbetçi olduğunu görür. Nöbet listesi henüz
 * yayımlanmadıysa ekran sessizce tüm eczanelere düşer ve bunu açıkça söyler.
 */
export default function PharmacyDirectoryScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ district?: string; query?: string; mode?: string }>();

  const initialFilter: DutyStateFilter =
    params.mode === 'nearby' || params.mode === 'all' || params.mode === 'duty_today'
      ? params.mode
      : 'duty_today';

  const [filter, setFilter] = useState<DutyStateFilter>(initialFilter);
  const [query, setQuery] = useState(params.query ?? '');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(query, 320);
  const bootstrap = usePharmacyBootstrap();
  const dutyStatus = usePharmacyDutyStatus();
  const location = useDeviceLocation(false);
  const authStatus = useAuthStatus();
  const signedIn = authStatus === 'authenticated';
  const prefs = usePharmacyNotificationPrefs(signedIn);
  const toggleDistrict = useTogglePharmacyNotificationDistrict();
  const subscribed = useMemo(
    () => new Set(prefs.data?.enabled ? prefs.data.districts : []),
    [prefs.data],
  );

  const nearby = filter === 'nearby';
  const nearbyReady = nearby && location.point != null;
  const effectiveMode = nearbyReady ? 'nearby' : nearby ? 'all' : filter;

  const list = usePharmacies(
    {
      district: null,
      query: debouncedQuery.trim() || null,
      mode: effectiveMode,
      lat: nearbyReady ? location.point?.lat ?? null : null,
      lng: nearbyReady ? location.point?.lng ?? null : null,
      limit,
    },
    { enabled: true },
  );

  const items = useMemo(() => list.data?.items ?? [], [list.data?.items]);

  /**
   * Mahalle bağlamı yalnızca gerçek kayıttan türetilir: kullanıcı "Kalkınma"
   * yazdığında sonuçlardaki mahalle adı eşleşiyorsa o mahalle için nöbet
   * duyurusu istenir. Uydurma mahalle bilgisi kullanılmaz.
   */
  const neighborhoodContext = useMemo(() => {
    const needle = normalize(query);
    if (needle.length < 3) {
      return null;
    }
    const match = items.find(
      (item) => item.neighborhood && normalize(item.neighborhood).includes(needle),
    );
    return match?.neighborhood ?? null;
  }, [items, query]);

  const notice = usePharmacyDutyNotice(null, neighborhoodContext);
  const districts = useMemo(() => bootstrap.data?.districts ?? [], [bootstrap.data?.districts]);
  const districtNames = useMemo(() => districts.map((entry) => entry.name), [districts]);

  /**
   * Bugün yayımlanmış nöbet kaydı yoksa kullanıcıya boş bir "nöbetçi" ekranı
   * yerine açık bir boş durum gösterilir; filtre kullanıcı seçimidir ve arka
   * planda habersizce değiştirilmez. Eski veri "bugün" gibi sunulmaz.
   */

  const showHighlight = filter === 'duty_today' || filter === 'on_duty_now';
  const dutyCount = notice.data?.count ?? 0;
  const totalPharmacies = bootstrap.data?.total_pharmacies ?? null;

  const subtitle = showHighlight
    ? notice.isLoading && !notice.data
      ? 'nöbet listesi yükleniyor'
      : dutyCount > 0
        ? `${dutyCount} eczane nöbetçi`
        : 'nöbet listesi henüz yayımlanmadı'
    : nearbyReady
      ? 'mesafeye göre sıralı'
      : totalPharmacies != null
        ? `${totalPharmacies} eczane · Trabzon`
        : 'Trabzon eczane rehberi';

  const changeFilter = (next: DutyStateFilter) => {
    if (next === filter) {
      return;
    }
    haptics.selection();
    if (next === 'nearby' && !location.point) {
      void (async () => {
        const point = await location.request();
        if (!point) {
          Alert.alert(
            'Konum kullanılamıyor',
            'Konum izni verilmedi. İlçe seçerek nöbetçi eczaneleri listeleyebilirsin.',
          );
          return;
        }
        setFilter('nearby');
      })();
      return;
    }
    setFilter(next);
    setLimit(PAGE_SIZE);
  };

  const openMap = (item: PharmacySummary) => {
    router.push({
      pathname: '/map',
      params: {
        lat: String(item.lat ?? ''),
        lng: String(item.lng ?? ''),
        label: item.name,
        zoom: '16',
        pharmacy: item.slug,
      },
    } as never);
  };

  const openItem = (item: PharmacySummary) => router.push(`/eczaneler/${item.slug}` as never);

  const openMapView = () => router.push('/eczaneler/harita' as never);

  const onDistrictNotify = (name: string) => {
    if (!signedIn) {
      Alert.alert(
        'Giriş yapman gerekiyor',
        'İlçe bazlı nöbet bildirimi almak için giriş yapmalısın.',
        [
          { text: 'Vazgeç', style: 'cancel' },
          { text: 'Giriş yap', onPress: () => router.push(loginHref('/eczaneler')) },
        ],
      );
      return;
    }
    const adding = !subscribed.has(name);
    haptics.selection();
    toggleDistrict.mutate(name, {
      onSuccess: (data) => {
        if (adding && !data.global_enabled) {
          Alert.alert(
            'Tercihin kaydedildi',
            'Eczane nöbet bildirimleri şu anda yönetici tarafından kapalı. Açıldığında bu ilçe için bildirim alacaksın.',
          );
        }
      },
      onError: (error) =>
        Alert.alert('Bildirim tercihi kaydedilemedi', error.message || 'Tekrar dene.'),
    });
  };

  const warning = staleNotice(Boolean(notice.data?.stale), notice.data?.stale_after_hours);

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.shell}>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <View style={styles.flex}>
          <AppText variant="h2" numberOfLines={1}>
            Nöbetçi Eczane
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
        <IconButton
          name="map-outline"
          accessibilityLabel="Eczaneleri haritada gör"
          variant="surface"
          size={19}
          onPress={openMapView}
        />
        <IconButton
          name="notifications-outline"
          accessibilityLabel="Nöbet bildirimlerini ayarla"
          variant="surface"
          size={19}
          onPress={() => setNotificationsOpen(true)}
        />
      </View>

      <View style={styles.searchWrap}>
        <TextField
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="Eczane, ilçe veya mahalle ara"
          leftIcon="search-outline"
          autoCorrect={false}
          returnKeyType="search"
          rightSlot={
            query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
                hitSlop={8}
                onPress={() => setQuery('')}
              >
                <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ) : null
          }
        />
      </View>

      <View
        style={[
          styles.segment,
          { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
        ]}
      >
        {SEGMENTS.map((segment) => {
          const active = filter === segment.key || (segment.key === 'duty_today' && showHighlight && filter === 'on_duty_now');
          return (
            <Pressable
              key={segment.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={segment.label}
              onPress={() => changeFilter(segment.key)}
              style={[
                styles.segmentItem,
                active && {
                  backgroundColor: theme.colors.surface,
                  ...theme.shadows.xs,
                },
              ]}
            >
              <AppText
                variant="caption"
                numberOfLines={1}
                style={{
                  color: active ? theme.colors.text : theme.colors.textSecondary,
                  fontWeight: '700',
                }}
              >
                {segment.label}
                {segment.key === 'duty_today' && dutyCount > 0 ? ` · ${dutyCount}` : ''}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.districtChips}
      >
        <View style={styles.chipLead}>
          <Ionicons name="notifications-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.chipLeadText}>
            Bildirim al
          </AppText>
        </View>
        {districts.map((entry) => (
          <DistrictChip
            key={entry.slug}
            label={entry.name}
            count={entry.duty_today > 0 ? entry.duty_today : undefined}
            active={subscribed.has(entry.name)}
            onPress={() => onDistrictNotify(entry.name)}
          />
        ))}
      </ScrollView>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isLoading}
            onRefresh={() => {
              void list.refetch();
              void notice.refetch();
              void bootstrap.refetch();
              void dutyStatus.refetch();
            }}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {nearby && !nearbyReady ? (
          <View
            style={[
              styles.hint,
              { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="navigate-outline" size={15} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {location.requesting
                ? 'Konum alınıyor…'
                : 'Konum izni yok. İlçe seçerek eczaneleri listeleyebilirsin; mesafeler kuş uçuşu hesaplanır.'}
            </AppText>
          </View>
        ) : null}

        {warning && !showHighlight ? (
          <View
            style={[
              styles.hint,
              { backgroundColor: theme.colors.warningSoft, borderColor: `${theme.colors.warning}33` },
            ]}
          >
            <Ionicons name="warning-outline" size={15} color={theme.colors.warning} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {warning}
            </AppText>
          </View>
        ) : null}

        {showHighlight ? (
          <PharmacyDutyHighlight
            notice={notice.data}
            status={dutyStatus.data}
            items={items}
            loading={list.isLoading}
            onPressItem={openItem}
            onMapItem={openMap}
          />
        ) : (
          <>
            <PharmacyDutyNoticeBanner
              notice={notice.data}
              onPress={() => changeFilter('duty_today')}
            />
            <View style={styles.sectionHead}>
              <AppText variant="h3">
                {nearbyReady ? 'Yakınımdaki eczaneler' : 'Tüm eczaneler'}
              </AppText>
              {list.data ? (
                <AppText variant="caption" color="textTertiary">
                  {nearbyReady ? `${list.data.total} kayıt · mesafe sıralı` : `${list.data.total} kayıt`}
                </AppText>
              ) : null}
            </View>

            {list.isLoading ? (
              [0, 1, 2].map((key) => <Skeleton key={key} height={132} radius={20} />)
            ) : items.length ? (
              items.map((item) => (
                <PharmacyCard
                  key={item.id}
                  item={item}
                  onPress={() => openItem(item)}
                  onMap={() => openMap(item)}
                />
              ))
            ) : list.isError ? (
              <StateBlock
                icon="cloud-offline-outline"
                title="Eczaneler yüklenemedi"
                body="Bağlantını kontrol edip tekrar dene."
                actionLabel="Tekrar dene"
                onAction={() => void list.refetch()}
              />
            ) : (
              <StateBlock
                icon="search-outline"
                title="Eczane bulunamadı"
                body="Arama kelimesini değiştirerek tekrar dene."
                actionLabel={query ? 'Aramayı temizle' : undefined}
                onAction={query ? () => setQuery('') : undefined}
              />
            )}
          </>
        )}

        {showHighlight && list.isError ? (
          <StateBlock
            icon="cloud-offline-outline"
            title="Nöbet listesi yüklenemedi"
            body="Bağlantını kontrol edip tekrar dene. Nöbet bilgisi doğrulanmadan gösterilmez."
            actionLabel="Tekrar dene"
            onAction={() => void list.refetch()}
          />
        ) : null}

        {list.data && items.length < list.data.total && limit < 200 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Daha fazla eczane yükle"
            onPress={() => setLimit((current) => Math.min(current + PAGE_SIZE, 200))}
            style={[styles.more, { borderColor: theme.colors.border }]}
          >
            <AppText variant="label" color="primaryDeep">
              Daha fazla göster
            </AppText>
            {list.isFetching ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Ionicons name="chevron-down" size={15} color={theme.colors.primaryDeep} />
            )}
          </Pressable>
        ) : null}

        <View style={styles.footerNote}>
          <Ionicons name="information-circle-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex}>
            Nöbet bilgileri Trabzon Eczacı Odası&apos;nın resmî listesinden alınır ve Europe/Istanbul
            saatine göre hesaplanır. Nöbet listesinde olmak eczanenin o an açık olduğunun canlı
            teyidi değildir; yola çıkmadan önce telefonla arayın.
          </AppText>
        </View>
      </ScrollView>

      <PharmacyNotificationSheet
        visible={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        districts={districtNames}
        defaultDistrict={params.district?.trim() || null}
      />
      </View>
    </Screen>
  );
}

function DistrictChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${label} nöbet bildirimi${count ? `, bugün ${count} nöbetçi` : ''}`}
      onPress={onPress}
      style={[
        styles.districtChip,
        {
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
          borderColor: 'transparent',
        },
      ]}
    >
      <Ionicons
        name={active ? 'notifications' : 'notifications-off-outline'}
        size={12}
        color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
      />
      <AppText
        variant="caption"
        numberOfLines={1}
        style={{
          color: active ? theme.colors.primaryDeep : theme.colors.textSecondary,
          fontWeight: active ? '700' : '600',
        }}
      >
        {label}
        {count ? ` · ${count}` : ''}
      </AppText>
    </Pressable>
  );
}

function StateBlock({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={24} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="h3" align="center">
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {body}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={[styles.retry, { backgroundColor: theme.colors.primaryDeep }]}
        >
          <AppText variant="label" color="onPrimary">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 4,
  },
  flex: { flex: 1 },
  searchWrap: { paddingHorizontal: 18, paddingTop: 6 },
  segment: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 18,
    marginTop: 10,
    padding: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentItem: {
    flex: 1,
    minHeight: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  districtChips: { alignItems: 'center', gap: 6, paddingHorizontal: 18 },
  chipScroll: { flexGrow: 0, flexShrink: 0, height: 48 },
  chipLead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 2 },
  chipLeadText: { fontWeight: '600' },
  districtChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 18, paddingBottom: 36, gap: 12 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  footerNote: { flexDirection: 'row', gap: 6, paddingTop: 4, alignItems: 'flex-start' },
  state: { alignItems: 'center', gap: 7, paddingVertical: 40, paddingHorizontal: 20 },
  stateIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999, marginTop: 6 },
});
