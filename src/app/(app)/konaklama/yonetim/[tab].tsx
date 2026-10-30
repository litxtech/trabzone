import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Reanimated from 'react-native-reanimated';

import { AppImage, AppText, Button, Screen, TextField } from '@/components/ui';
import { useKeyboardBottomInset } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';

import {
  Chip,
  DateField,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
  StatusPill,
} from '@/features/accommodation/components/AccommodationUI';
import { CampaignManager } from '@/features/accommodation/components/CampaignManager';
import { CashFolioCenter } from '@/features/accommodation/components/CashFolioCenter';
import { DashboardCards } from '@/features/accommodation/components/DashboardCards';
import { DocumentsCenter } from '@/features/accommodation/components/DocumentsCenter';
import { FinanceReportCenter } from '@/features/accommodation/components/FinanceReportCenter';
import { FrontDeskBoard } from '@/features/accommodation/components/FrontDeskBoard';
import { GuestsManager } from '@/features/accommodation/components/GuestsManager';
import {
  HotelRunnerCalendar,
  type CalendarMode,
  type CalendarViewMode,
  type EmptyCalendarCell,
} from '@/features/accommodation/components/HotelRunnerCalendar';
import { HotelOnboardingWizard } from '@/features/accommodation/components/HotelOnboardingWizard';
import { HousekeepingBoard } from '@/features/accommodation/components/HousekeepingBoard';
import { ManualBookingModal } from '@/features/accommodation/components/ManualBookingModal';
import { MediaManager } from '@/features/accommodation/components/MediaManager';
import { MessagesManager } from '@/features/accommodation/components/MessagesManager';
import { NotificationsCenter } from '@/features/accommodation/components/NotificationsCenter';
import { AURORA, AuroraBackdrop } from '@/features/accommodation/components/PremiumUI';
import { PropertySettingsManager } from '@/features/accommodation/components/PropertySettingsManager';
import { RatePlansManager } from '@/features/accommodation/components/RatePlansManager';
import { ReportsCenter } from '@/features/accommodation/components/ReportsCenter';
import { ReservationDetailModal } from '@/features/accommodation/components/ReservationDetailModal';
import { ReservationsManager } from '@/features/accommodation/components/ReservationsManager';
import { ReviewsManager } from '@/features/accommodation/components/ReviewsManager';
import { RoomsManager } from '@/features/accommodation/components/RoomsManager';
import { StaffManager } from '@/features/accommodation/components/StaffManager';
import { WebTrackingCenter } from '@/features/accommodation/components/WebTrackingCenter';
import {
  useAccommodationContext,
  useCreateRoomBlock,
  useDashboard,
  useDeleteRoomBlock,
  usePropertyDetail,
  useSetRoomStatus,
} from '@/features/accommodation/hooks/use-accommodation';
import { useAccommodationLayout } from '@/features/accommodation/hooks/use-accommodation-layout';
import { accommodationMediaUrl } from '@/features/accommodation/services/accommodation-media-service';
import type {
  AccommodationPropertyContext,
  CalendarBlock,
  CalendarReservation,
  RoomStatus,
} from '@/features/accommodation/types';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  ROOM_STATUS_OPTIONS,
  VERIFICATION_STATUS_LABELS,
  addDaysIso,
  formatDate,
  roomStatusTone,
  todayIso,
} from '@/features/accommodation/utils/format';
import {
  PMS_GROUPS,
  PMS_TABS,
  isPmsTabKey,
  pmsTab,
  type PmsTabKey,
} from '@/features/accommodation/utils/pms-tabs';

type BookingDefaults = {
  date: string;
  roomId: string | null;
  roomTypeId: string | null;
};

type RoomTarget = {
  id: string;
  number: string;
  typeId: string | null;
  status: RoomStatus;
};

const LEGACY_TAB_MAP: Record<string, PmsTabKey> = {
  calendar: 'oda-takvimi',
  rates: 'fiyat-musaitlik',
  frontdesk: 'on-buro',
  housekeeping: 'kat-hizmetleri',
  cash: 'kasa',
  finance: 'finans-komisyon',
};

const GROUP_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  Operasyon: 'pulse',
  Envanter: 'cube',
  Misafir: 'people',
  Finans: 'wallet',
  Yönetim: 'settings',
};

/** Mobil başlıkta en sık kullanılan sekmeler; tamamı menü çekmecesinde. */
const MOBILE_QUICK_TABS: PmsTabKey[] = [
  'genel-bakis',
  'rezervasyonlar',
  'oda-takvimi',
  'on-buro',
  'kasa',
  'raporlar',
];

export default function PmsTabScreen() {
  const params = useLocalSearchParams<{ tab?: string; property?: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const layout = useAccommodationLayout();
  const context = useAccommodationContext();

  const initialTab: PmsTabKey = isPmsTabKey(params.tab) ? params.tab : 'genel-bakis';
  const [tab, setTab] = useState<PmsTabKey>(initialTab);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    params.property ?? null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);

  // Mobil menü soldan kayarak açılır; hamburger simgesi aynı animasyonla X'e döner.
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const drawerWidth = Math.min(Math.max(layout.width * 0.86, 276), 344);

  useEffect(() => {
    Animated.timing(drawerProgress, {
      toValue: menuOpen ? 1 : 0,
      duration: menuOpen ? 280 : 210,
      easing: menuOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [menuOpen, drawerProgress]);

  useEffect(() => {
    // Masaüstüne geçildiğinde (pencere genişlediğinde) menü açık kalmasın.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (layout.isDesktop && menuOpen) setMenuOpen(false);
  }, [layout.isDesktop, menuOpen]);

  const [bookingDefaults, setBookingDefaults] = useState<BookingDefaults | null>(null);
  const [reservationDetailId, setReservationDetailId] = useState<string | null>(null);
  const [roomTarget, setRoomTarget] = useState<RoomTarget | null>(null);
  const [blockTarget, setBlockTarget] = useState<CalendarBlock | null>(null);
  const [messageReservationId, setMessageReservationId] = useState<string | null>(null);

  // Tesis bilgileri gibi form sekmelerinde alanlar klavyenin altında kalıyordu.
  // Android'de edge-to-edge yüzünden pencere klavye açılınca küçülmüyor; bu
  // yüzden klavye yüksekliğini içerik alanından ayırıyoruz. iOS'ta ScrollView'in
  // kendi klavye inset davranışı (automaticallyAdjustKeyboardInsets) kullanılır.
  const keyboardInset = useKeyboardBottomInset();
  const contentRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const contentOffset = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Odaklanan alanı klavyenin üstüne kaydırır.
   *
   * Android'de klavye açıldığında pencere küçülmediği için ScrollView odaklı
   * alanı görünür alana taşımıyor; alanın ekran koordinatını klavyenin üst
   * çizgisiyle karşılaştırıp yalnızca eksik kalan kadar kaydırıyoruz.
   */
  const revealFocusedField = useCallback(() => {
    if (Platform.OS !== 'android') return;
    const scrollView = contentRef.current;
    const focused = TextInput.State.currentlyFocusedInput();
    if (!scrollView || !focused) return;
    const keyboardTopY = keyboardTop.current ?? Keyboard.metrics()?.screenY ?? null;
    if (keyboardTopY == null) return;
    focused.measure((_x, _y, _width, height, _pageX, pageY) => {
      // Alanın altı klavye üst çizgisini geçiyorsa aradaki fark kadar kaydır.
      const overflow = pageY + height + 16 - keyboardTopY;
      if (overflow <= 0) return;
      scrollView.scrollTo({ y: contentOffset.current + overflow, animated: true });
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      if (revealTimer.current) clearTimeout(revealTimer.current);
      // Klavye payı yerleştikten sonra ölçmek için bir sonraki kareyi bekle.
      revealTimer.current = setTimeout(revealFocusedField, 32);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = null;
      if (revealTimer.current) clearTimeout(revealTimer.current);
    });
    return () => {
      show.remove();
      hide.remove();
      if (revealTimer.current) clearTimeout(revealTimer.current);
    };
  }, [revealFocusedField]);

  const properties = context.data?.items ?? [];
  const property =
    properties.find((entry) => entry.id === selectedPropertyId) ?? properties[0] ?? null;

  useEffect(() => {
    if (isPmsTabKey(params.tab) && params.tab !== tab) {
      // Route param is the source of truth when navigating between PMS tabs.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(params.tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tab]);

  if (context.isLoading) {
    return (
      <Screen padded={false}>
        <View style={styles.center}>
          <LoadingBlock height={220} />
        </View>
      </Screen>
    );
  }

  if (context.isError) {
    return (
      <Screen padded={false}>
        <View style={styles.center}>
          <InlineError
            message={
              context.error instanceof Error ? context.error.message : 'Tesisler yüklenemedi.'
            }
            onRetry={() => void context.refetch()}
          />
        </View>
      </Screen>
    );
  }

  if (!property) {
    return (
      <Screen padded={false}>
        <View style={styles.center}>
          <EmptyState
            icon="business-outline"
            title="Yönetilecek tesis yok"
            message="Önce bir tesis eklemelisin."
            actionLabel="Tesis ekle"
            onAction={() => router.push('/konaklama/otel-ekle' as never)}
          />
        </View>
      </Screen>
    );
  }

  const active = pmsTab(tab);
  const quickTabs = (
    MOBILE_QUICK_TABS.includes(tab) ? MOBILE_QUICK_TABS : [tab, ...MOBILE_QUICK_TABS]
  ).map((key) => pmsTab(key));

  const selectTab = (key: PmsTabKey) => {
    setTab(key);
    setMenuOpen(false);
  };

  const openMessagesFor = (reservationId: string) => {
    setMessageReservationId(reservationId);
    setReservationDetailId(null);
    setTab('mesajlar');
  };

  const changeProperty = (id: string) => {
    setSelectedPropertyId(id);
    setPropertyPickerOpen(false);
    setMenuOpen(false);
  };

  const pendingFor = (key: PmsTabKey) => {
    if (key === 'rezervasyonlar') return property.pending_reservations;
    if (key === 'mesajlar') return property.unread_messages;
    if (key === 'kat-hizmetleri') return property.pending_tasks;
    return 0;
  };

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.divider },
          theme.shadows.xs,
        ]}
      >
        {layout.isDesktop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yönetim merkezine dön"
            onPress={() => router.push('/konaklama/yonetim' as never)}
            style={({ pressed }) => [
              styles.headerButton,
              { backgroundColor: theme.colors.surfaceMuted, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name="chevron-back" size={19} color={theme.colors.text} />
          </Pressable>
        ) : (
          <MenuToggleButton
            open={menuOpen}
            progress={drawerProgress}
            onPress={() => setMenuOpen((current) => !current)}
          />
        )}

        {layout.isDesktop ? (
          <LinearGradient
            colors={[theme.colors.primary, theme.colors.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerLogo}
          >
            <Ionicons name="business" size={16} color="#FFFFFF" />
          </LinearGradient>
        ) : null}

        <View style={styles.headerTitle}>
          <View style={styles.headerTitleRow}>
            <View style={[styles.headerGroupDot, { backgroundColor: theme.colors.primary }]} />
            <AppText
              variant="overline"
              color="textTertiary"
              style={styles.headerOverline}
              numberOfLines={1}
            >
              {active.group.toUpperCase()}
            </AppText>
            {!layout.isMobile ? (
              <>
                <AppText variant="caption" color="textTertiary" style={styles.headerDivider}>
                  ·
                </AppText>
                <AppText
                  variant="caption"
                  color="textTertiary"
                  style={styles.headerBrandMini}
                  numberOfLines={1}
                >
                  OTEL YÖNETİMİM
                </AppText>
              </>
            ) : null}
          </View>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {active.label}
          </AppText>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tesis seç"
            onPress={() => setPropertyPickerOpen(true)}
            style={({ pressed }) => [
              styles.propertyPicker,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderColor: theme.colors.border,
                maxWidth: layout.isMobile ? 118 : 232,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.propertyDot,
                {
                  backgroundColor:
                    property.status === 'published' ? theme.colors.success : theme.colors.warning,
                },
              ]}
            />
            <AppText
              variant="caption"
              color="text"
              numberOfLines={1}
              style={[styles.propertyName, { maxWidth: layout.isMobile ? 62 : 164 }]}
            >
              {property.name}
            </AppText>
            <Ionicons name="chevron-down" size={13} color={theme.colors.textTertiary} />
          </Pressable>

          {layout.isDesktop ? (
            <Button
              label="Yeni rezervasyon"
              size="sm"
              fullWidth={false}
              leftIcon={<Ionicons name="add" size={15} color={theme.colors.onPrimary} />}
              onPress={() =>
                setBookingDefaults({ date: todayIso(), roomId: null, roomTypeId: null })
              }
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yeni rezervasyon"
              onPress={() =>
                setBookingDefaults({ date: todayIso(), roomId: null, roomTypeId: null })
              }
              style={({ pressed }) => [
                styles.headerAddButton,
                { backgroundColor: theme.colors.primary, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <Ionicons name="add" size={20} color={theme.colors.onPrimary} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.body}>
        {layout.isDesktop ? (
          <View
            style={[
              styles.sidebar,
              { borderRightColor: theme.colors.divider, backgroundColor: theme.colors.surface },
            ]}
          >
            <AuroraBackdrop
              colors={[AURORA.night, AURORA.indigo, '#2A2660']}
              style={styles.sidebarBrand}
            >
              <View style={styles.sidebarBrandRow}>
                <LinearGradient
                  colors={[theme.colors.primary, theme.colors.accent]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sidebarLogo}
                >
                  <Ionicons name="business" size={16} color="#FFFFFF" />
                </LinearGradient>
                <View style={styles.flex}>
                  <AppText variant="overline" style={styles.sidebarOverline}>
                    TRABZONE
                  </AppText>
                  <AppText variant="caption" style={styles.sidebarBrandText}>
                    Otel Yönetimim
                  </AppText>
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tesis değiştir"
                onPress={() => setPropertyPickerOpen(true)}
                style={({ pressed }) => [styles.sidebarProperty, { opacity: pressed ? 0.82 : 1 }]}
              >
                <PropertyAvatar property={property} size={34} />
                <View style={styles.flex}>
                  <AppText variant="caption" numberOfLines={1} style={styles.sidebarPropertyName}>
                    {property.name}
                  </AppText>
                  <AppText variant="caption" numberOfLines={1} style={styles.sidebarPropertyMeta}>
                    {PROPERTY_TYPE_LABELS[property.property_type]}
                    {property.district ? ` · ${property.district}` : ''}
                  </AppText>
                </View>
                <Ionicons name="swap-horizontal" size={14} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </AuroraBackdrop>

            <ScrollView
              contentContainerStyle={styles.sidebarContent}
              showsVerticalScrollIndicator={false}
            >
              {PMS_GROUPS.map((group) => (
                <View key={group} style={styles.sidebarGroup}>
                  <View style={styles.groupHead}>
                    <Ionicons
                      name={GROUP_ICONS[group] ?? 'ellipse'}
                      size={11}
                      color={theme.colors.textTertiary}
                    />
                    <AppText variant="overline" color="textTertiary" style={styles.groupLabel}>
                      {group.toUpperCase()}
                    </AppText>
                  </View>
                  {PMS_TABS.filter((entry) => entry.group === group).map((entry) => {
                    const isActive = entry.key === tab;
                    const pending = pendingFor(entry.key);
                    return (
                      <Pressable
                        key={entry.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                        onPress={() => selectTab(entry.key)}
                        style={({ pressed }) => [
                          styles.navItem,
                          {
                            backgroundColor: isActive ? theme.colors.primarySoft : 'transparent',
                            opacity: pressed ? 0.78 : 1,
                          },
                        ]}
                      >
                        {isActive ? (
                          <View
                            style={[styles.navActiveBar, { backgroundColor: theme.colors.primary }]}
                          />
                        ) : null}
                        <Ionicons
                          name={entry.icon}
                          size={16}
                          color={isActive ? theme.colors.primary : theme.colors.textTertiary}
                        />
                        <AppText
                          variant="caption"
                          color={isActive ? 'primary' : 'textSecondary'}
                          numberOfLines={1}
                          style={styles.navLabel}
                        >
                          {entry.label}
                        </AppText>
                        {pending > 0 ? <Badge value={pending} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tesis yönetim merkezi"
                onPress={() => router.push('/konaklama/yonetim' as never)}
                style={({ pressed }) => [
                  styles.sidebarFooter,
                  { borderColor: theme.colors.border, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Ionicons name="apps-outline" size={14} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary" style={styles.flex}>
                  Tesis yönetim merkezi
                </AppText>
                <Ionicons name="chevron-forward" size={12} color={theme.colors.textTertiary} />
              </Pressable>
            </ScrollView>
          </View>
        ) : null}

        <View style={[styles.main, { backgroundColor: theme.colors.background }]}>
          {!layout.isDesktop ? (
            <View
              style={[
                styles.mobileTabs,
                { borderBottomColor: theme.colors.divider, backgroundColor: theme.colors.surface },
              ]}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.mobileTabsRow}
              >
                {quickTabs.map((entry) => {
                  const isActive = entry.key === tab;
                  const pending = pendingFor(entry.key);
                  return (
                    <Pressable
                      key={entry.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      onPress={() => selectTab(entry.key)}
                      style={({ pressed }) => [
                        styles.mobileTab,
                        {
                          backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                          borderColor: isActive ? theme.colors.primary : theme.colors.border,
                          opacity: pressed ? 0.82 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={entry.icon}
                        size={13}
                        color={isActive ? theme.colors.onPrimary : theme.colors.textTertiary}
                      />
                      <AppText
                        variant="caption"
                        color={isActive ? theme.colors.onPrimary : 'textSecondary'}
                        style={styles.mobileTabText}
                      >
                        {entry.short}
                      </AppText>
                      {pending > 0 ? (
                        <View
                          style={[
                            styles.mobileTabDot,
                            {
                              backgroundColor: isActive
                                ? theme.colors.onPrimary
                                : theme.colors.primary,
                            },
                          ]}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tüm menüyü aç"
                  onPress={() => setMenuOpen(true)}
                  style={({ pressed }) => [
                    styles.mobileTab,
                    {
                      backgroundColor: theme.colors.surfaceMuted,
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.82 : 1,
                    },
                  ]}
                >
                  <Ionicons name="grid-outline" size={13} color={theme.colors.textSecondary} />
                  <AppText variant="caption" color="textSecondary" style={styles.mobileTabText}>
                    Tümü
                  </AppText>
                </Pressable>
              </ScrollView>
            </View>
          ) : null}

          <Reanimated.View style={[styles.flex, Platform.OS === 'android' ? keyboardInset : null]}>
            <ScrollView
              ref={contentRef}
              style={styles.flex}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              onScroll={(event) => {
                contentOffset.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.contentHead}>
                <View style={styles.flex}>
                  <AppText variant="overline" color="primaryDeep" style={styles.contentOverline}>
                    {active.group.toUpperCase()}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                    {active.description}
                  </AppText>
                </View>
                <View
                  style={[
                    styles.tabStatus,
                    { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.propertyDot,
                      {
                        backgroundColor:
                          property.status === 'published'
                            ? theme.colors.success
                            : theme.colors.warning,
                      },
                    ]}
                  />
                  <AppText variant="caption" color="textSecondary" style={styles.tabStatusText}>
                    {PROPERTY_STATUS_LABELS[property.status]}
                  </AppText>
                </View>
              </View>

              <TabContent
                tab={tab}
                propertyId={property.id}
                propertyName={property.name}
                messageReservationId={messageReservationId}
                onOpenTab={selectTab}
                onOpenMessages={openMessagesFor}
                onReservationPress={(id) => setReservationDetailId(id)}
                onRoomPress={(room) => setRoomTarget(room)}
                onBlockPress={(block) => setBlockTarget(block)}
                onEmptyCellPress={(cell) =>
                  setBookingDefaults({
                    date: cell.date,
                    roomId: cell.roomId,
                    roomTypeId: cell.roomTypeId,
                  })
                }
              />
            </ScrollView>
          </Reanimated.View>
        </View>

        {!layout.isDesktop ? (
          <PmsDrawer
            open={menuOpen}
            progress={drawerProgress}
            width={drawerWidth}
            tab={tab}
            property={property}
            pendingFor={pendingFor}
            onSelectTab={selectTab}
            onClose={() => setMenuOpen(false)}
            onOpenPicker={() => {
              setMenuOpen(false);
              setPropertyPickerOpen(true);
            }}
            onOpenManagement={() => {
              setMenuOpen(false);
              router.push('/konaklama/yonetim' as never);
            }}
            onNewProperty={() => {
              setMenuOpen(false);
              router.push('/konaklama/otel-ekle' as never);
            }}
          />
        ) : null}
      </View>

      <ModalSheet
        visible={propertyPickerOpen}
        onClose={() => setPropertyPickerOpen(false)}
        title="Tesis seç"
        subtitle="Yönetim verileri seçilen tesise göre yüklenir"
        maxWidth={520}
      >
        <View style={{ gap: 8 }}>
          {properties.map((entry) => {
            const isActive = entry.id === property.id;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => changeProperty(entry.id)}
                style={({ pressed }) => [
                  styles.propertyRow,
                  {
                    borderColor: isActive ? theme.colors.primary : theme.colors.border,
                    backgroundColor: isActive ? theme.colors.primarySoft : theme.colors.surface,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <PropertyAvatar property={entry} size={38} />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {entry.name}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {PROPERTY_TYPE_LABELS[entry.property_type]} · {entry.district ?? 'Trabzon'}
                  </AppText>
                </View>
                {entry.pending_reservations > 0 ? (
                  <Badge value={entry.pending_reservations} />
                ) : null}
                {isActive ? (
                  <Ionicons name="checkmark-circle" size={19} color={theme.colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
          <Button
            label="Yeni tesis ekle"
            variant="outline"
            onPress={() => {
              setPropertyPickerOpen(false);
              router.push('/konaklama/otel-ekle' as never);
            }}
          />
          <Button
            label="Tesis yönetim merkezi"
            variant="ghost"
            onPress={() => {
              setPropertyPickerOpen(false);
              router.push('/konaklama/yonetim' as never);
            }}
          />
        </View>
      </ModalSheet>

      <ManualBookingModal
        visible={Boolean(bookingDefaults)}
        onClose={() => setBookingDefaults(null)}
        propertyId={property.id}
        defaultDate={bookingDefaults?.date ?? todayIso()}
        defaultRoomId={bookingDefaults?.roomId ?? null}
        defaultRoomTypeId={bookingDefaults?.roomTypeId ?? null}
        onCreated={(reservation) => {
          setBookingDefaults(null);
          setRoomTarget(null);
          setReservationDetailId(reservation.id);
        }}
      />

      <ReservationDetailModal
        reservationId={reservationDetailId}
        propertyId={property.id}
        onClose={() => setReservationDetailId(null)}
        onChanged={() => setReservationDetailId(null)}
        onOpenMessages={openMessagesFor}
      />

      <RoomActionsModal
        propertyId={property.id}
        room={roomTarget}
        onClose={() => setRoomTarget(null)}
        onNewReservation={() => {
          if (!roomTarget) return;
          setBookingDefaults({
            date: todayIso(),
            roomId: roomTarget.id,
            roomTypeId: roomTarget.typeId,
          });
          setRoomTarget(null);
        }}
      />

      <BlockDetailModal block={blockTarget} onClose={() => setBlockTarget(null)} />
    </Screen>
  );
}

function PropertyAvatar({
  property,
  size,
}: {
  property: AccommodationPropertyContext;
  size: number;
}) {
  const { theme } = useTheme();
  const cover = accommodationMediaUrl(property.cover_path);
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 3,
          backgroundColor: theme.colors.primarySoft,
        },
      ]}
    >
      {cover ? (
        <AppImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Ionicons name="business" size={size * 0.45} color={theme.colors.primaryDeep} />
      )}
    </View>
  );
}

function TabContent({
  tab,
  propertyId,
  propertyName,
  messageReservationId,
  onOpenTab,
  onOpenMessages,
  onReservationPress,
  onRoomPress,
  onBlockPress,
  onEmptyCellPress,
}: {
  tab: PmsTabKey;
  propertyId: string;
  propertyName: string;
  messageReservationId: string | null;
  onOpenTab: (tab: PmsTabKey) => void;
  onOpenMessages: (reservationId: string) => void;
  onReservationPress: (id: string) => void;
  onRoomPress: (room: RoomTarget) => void;
  onBlockPress: (block: CalendarBlock) => void;
  onEmptyCellPress: (cell: EmptyCalendarCell) => void;
}) {
  switch (tab) {
    case 'genel-bakis':
      return <OverviewTab propertyId={propertyId} onOpenTab={onOpenTab} />;
    case 'rezervasyonlar':
      return <ReservationsManager propertyId={propertyId} onOpenMessages={onOpenMessages} />;
    case 'oda-takvimi':
      return (
        <CalendarTab
          propertyId={propertyId}
          initialView="fortnight"
          initialMode="rates"
          onReservationPress={(reservation) => onReservationPress(reservation.id)}
          onRoomPress={onRoomPress}
          onBlockPress={onBlockPress}
          onEmptyCellPress={onEmptyCellPress}
        />
      );
    case 'rezervasyon-takvimi':
      return (
        <CalendarTab
          propertyId={propertyId}
          initialView="fortnight"
          initialMode="reservations"
          onReservationPress={(reservation) => onReservationPress(reservation.id)}
          onRoomPress={onRoomPress}
          onBlockPress={onBlockPress}
          onEmptyCellPress={onEmptyCellPress}
        />
      );
    case 'fiyat-musaitlik':
      return (
        <CalendarTab
          propertyId={propertyId}
          initialView="month"
          initialMode="rates"
          onReservationPress={(reservation) => onReservationPress(reservation.id)}
          onRoomPress={onRoomPress}
          onBlockPress={onBlockPress}
          onEmptyCellPress={onEmptyCellPress}
        />
      );
    case 'odalar':
      return <RoomsManager propertyId={propertyId} />;
    case 'fiyat-planlari':
      return <RatePlansManager propertyId={propertyId} />;
    case 'kampanyalar':
      return <CampaignManager propertyId={propertyId} />;
    case 'misafirler':
      return <GuestsManager propertyId={propertyId} />;
    case 'on-buro':
    case 'giris-cikis':
      return (
        <FrontDeskBoard
          propertyId={propertyId}
          onReservationPress={onReservationPress}
          onRoomPress={(room) =>
            onRoomPress({
              id: room.id,
              number: room.number,
              typeId: null,
              status: room.status as RoomStatus,
            })
          }
        />
      );
    case 'kat-hizmetleri':
      return <HousekeepingBoard propertyId={propertyId} />;
    case 'kasa':
      return <CashFolioCenter propertyId={propertyId} />;
    case 'gelir-gider':
    case 'finans-komisyon':
      return <FinanceReportCenter propertyId={propertyId} />;
    case 'belgeler':
      return <DocumentsCenter propertyId={propertyId} />;
    case 'raporlar':
      return <ReportsCenter propertyId={propertyId} />;
    case 'mesajlar':
      return (
        <MessagesManager propertyId={propertyId} initialReservationId={messageReservationId} />
      );
    case 'yorumlar':
      return <ReviewsManager propertyId={propertyId} />;
    case 'medya':
      return <MediaManager propertyId={propertyId} />;
    case 'tesis-bilgileri':
      return (
        <View style={{ gap: 10 }}>
          <InfoBanner
            text={`${propertyName} tesis bilgilerini güncelle. Doğrulama belgeleri yalnızca yetkili yöneticiler tarafından görüntülenebilir.`}
          />
          <HotelOnboardingWizard
            propertyId={propertyId}
            onOpenManagement={(_, tabKey) => onOpenTab(tabKey)}
          />
        </View>
      );
    case 'personel':
      return <StaffManager propertyId={propertyId} />;
    case 'bildirimler':
      return <NotificationsCenter propertyId={propertyId} />;
    case 'web-takip':
      return <WebTrackingCenter propertyId={propertyId} />;
    case 'ayarlar':
      return <PropertySettingsManager propertyId={propertyId} />;
    default:
      return <OverviewTab propertyId={propertyId} onOpenTab={onOpenTab} />;
  }
}

function OverviewTab({
  propertyId,
  onOpenTab,
}: {
  propertyId: string;
  onOpenTab: (tab: PmsTabKey) => void;
}) {
  const { theme } = useTheme();
  const detail = usePropertyDetail(propertyId);
  const [date, setDate] = useState(todayIso());
  const dashboard = useDashboard(propertyId, date);

  if (detail.isLoading || dashboard.isLoading) {
    return <LoadingBlock height={300} />;
  }
  if (detail.isError || dashboard.isError || !detail.data || !dashboard.data) {
    return (
      <InlineError
        message={
          detail.error instanceof Error
            ? detail.error.message
            : dashboard.error instanceof Error
              ? dashboard.error.message
              : 'Panel verileri yüklenemedi.'
        }
        onRetry={() => {
          void detail.refetch();
          void dashboard.refetch();
        }}
      />
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <DashboardCards
        dashboard={dashboard.data}
        property={detail.data}
        date={date}
        onDateChange={setDate}
        onOpenTab={(legacy) =>
          onOpenTab(LEGACY_TAB_MAP[legacy] ?? (isPmsTabKey(legacy) ? legacy : 'genel-bakis'))
        }
      />
      <View style={[styles.compactInfo, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name="information-circle-outline" size={14} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          Tüm rakamlar seçilen tarihe göre gerçek kayıtlardan hesaplanır. Boş veride sıfır
          gösterilir; örnek veri kullanılmaz.
        </AppText>
      </View>
    </View>
  );
}

function CalendarTab({
  propertyId,
  initialView,
  initialMode,
  onReservationPress,
  onRoomPress,
  onBlockPress,
  onEmptyCellPress,
}: {
  propertyId: string;
  initialView: CalendarViewMode;
  initialMode: CalendarMode;
  onReservationPress: (reservation: CalendarReservation) => void;
  onRoomPress: (room: RoomTarget) => void;
  onBlockPress: (block: CalendarBlock) => void;
  onEmptyCellPress: (cell: EmptyCalendarCell) => void;
}) {
  return (
    <HotelRunnerCalendar
      propertyId={propertyId}
      initialView={initialView}
      initialMode={initialMode}
      onReservationPress={onReservationPress}
      onRoomPress={(room, roomType) =>
        onRoomPress({ id: room.id, number: room.number, typeId: roomType.id, status: room.status })
      }
      onBlockPress={onBlockPress}
      onEmptyCellPress={onEmptyCellPress}
    />
  );
}

function Badge({ value }: { value: number }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
      <AppText variant="caption" style={{ color: theme.colors.onPrimary, fontSize: 8 }}>
        {value > 99 ? '99+' : value}
      </AppText>
    </View>
  );
}

function RoomActionsModal({
  propertyId,
  room,
  onClose,
  onNewReservation,
}: {
  propertyId: string;
  room: RoomTarget | null;
  onClose: () => void;
  onNewReservation: () => void;
}) {
  const { theme } = useTheme();
  const setRoomStatusMutation = useSetRoomStatus();
  const createBlock = useCreateRoomBlock(propertyId);
  const [status, setStatus] = useState<RoomStatus>('clean');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDaysIso(todayIso(), 1));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (room) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(room.status);
      setFrom(todayIso());
      setTo(addDaysIso(todayIso(), 1));
      setReason('');
      setError(null);
    }
  }, [room]);

  if (!room) return null;

  return (
    <ModalSheet
      visible={Boolean(room)}
      onClose={onClose}
      title={`Oda ${room.number}`}
      subtitle="Hızlı işlemler"
      maxWidth={480}
    >
      <View style={{ gap: 12 }}>
        {error ? <InlineError message={error} /> : null}

        <View>
          <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>
            Oda durumu
          </AppText>
          <View style={styles.chips}>
            {ROOM_STATUS_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={status === option.value}
                onPress={() => setStatus(option.value)}
              />
            ))}
          </View>
          <Button
            label="Durumu güncelle"
            size="sm"
            variant="outline"
            loading={setRoomStatusMutation.isPending}
            onPress={async () => {
              setError(null);
              try {
                await setRoomStatusMutation.mutateAsync({ roomId: room.id, status });
                onClose();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Oda durumu güncellenemedi.');
              }
            }}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

        <AppText variant="bodyStrong">Odayı bloke et</AppText>
        <View style={styles.dateRow}>
          <View style={styles.flex}>
            <DateField label="Başlangıç" value={from} onChange={setFrom} />
          </View>
          <View style={styles.flex}>
            <DateField label="Bitiş" value={to} onChange={setTo} minDate={from} />
          </View>
        </View>
        <TextField
          label="Neden"
          value={reason}
          onChangeText={setReason}
          placeholder="Bakım, tadilat, özel kullanım…"
        />
        <Button
          label="Odayı bloke et"
          size="sm"
          loading={createBlock.isPending}
          onPress={async () => {
            setError(null);
            try {
              await createBlock.mutateAsync({
                roomId: room.id,
                startDate: from,
                endDate: to,
                reason: reason.trim() || null,
                blockRoom: true,
              });
              onClose();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Oda bloke edilemedi.');
            }
          }}
        />

        <Button
          label="Bu oda için rezervasyon oluştur"
          variant="outline"
          onPress={onNewReservation}
        />
      </View>
    </ModalSheet>
  );
}

function BlockDetailModal({
  block,
  onClose,
}: {
  block: CalendarBlock | null;
  onClose: () => void;
}) {
  const remove = useDeleteRoomBlock();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote('');
    setError(null);
    setConfirming(false);
  }, [block]);

  if (!block) return null;

  const tone = roomStatusTone('maintenance');

  return (
    <ModalSheet
      visible={Boolean(block)}
      onClose={onClose}
      title={`Oda ${block.room_number} bloğu`}
      subtitle={`${formatDate(block.start_date)} – ${formatDate(block.end_date)}`}
      maxWidth={440}
      footer={
        confirming ? (
          <View style={styles.modalFooter}>
            <Button
              label="Vazgeç"
              variant="ghost"
              fullWidth={false}
              onPress={() => setConfirming(false)}
            />
            <Button
              label="Bloğu kaldır"
              variant="danger"
              fullWidth={false}
              loading={remove.isPending}
              onPress={async () => {
                setError(null);
                try {
                  await remove.mutateAsync({ blockId: block.id, note: note.trim() || undefined });
                  onClose();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Blok kaldırılamadı.');
                }
              }}
            />
          </View>
        ) : (
          <Button label="Bloğu kaldır" variant="danger" onPress={() => setConfirming(true)} />
        )
      }
    >
      <View style={{ gap: 10 }}>
        {error ? <InlineError message={error} /> : null}
        <View style={[styles.blockStatus, { backgroundColor: tone.background }]}>
          <StatusPill label={tone.label} color={tone.color} background={tone.background} />
          <AppText variant="caption" color="textSecondary">
            {block.reason || 'Neden belirtilmedi'}
          </AppText>
        </View>
        {confirming ? (
          <TextField
            label="Kaldırma notu"
            value={note}
            onChangeText={setNote}
            placeholder="Opsiyonel açıklama"
          />
        ) : (
          <AppText variant="caption" color="textTertiary">
            Bloğu kaldırdığında oda bu tarihlerde yeniden satışa açılır. Mevcut rezervasyonlar
            etkilenmez.
          </AppText>
        )}
      </View>
    </ModalSheet>
  );
}

function MenuToggleButton({
  open,
  progress,
  onPress,
}: {
  open: boolean;
  progress: Animated.Value;
  onPress: () => void;
}) {
  const { theme } = useTheme();

  // Hamburger → X: üst ve alt çizgi ortada birleşip 45° döner, orta çizgi kaybolur.
  const topStyle = {
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }) },
      { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) },
    ],
  };
  const middleStyle = {
    opacity: progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0, 0] }),
    transform: [{ scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }],
  };
  const bottomStyle = {
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
      { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-45deg'] }) },
    ],
  };

  const barColor = open ? theme.colors.primary : theme.colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? 'Menüyü kapat' : 'Menüyü aç'}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerButton,
        {
          backgroundColor: open ? theme.colors.primarySoft : theme.colors.surfaceMuted,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={styles.burger}>
        <Animated.View style={[styles.burgerBar, { backgroundColor: barColor }, topStyle]} />
        <Animated.View style={[styles.burgerBar, { backgroundColor: barColor }, middleStyle]} />
        <Animated.View style={[styles.burgerBar, { backgroundColor: barColor }, bottomStyle]} />
      </View>
    </Pressable>
  );
}

function PmsDrawer({
  open,
  progress,
  width,
  tab,
  property,
  pendingFor,
  onSelectTab,
  onClose,
  onOpenPicker,
  onOpenManagement,
  onNewProperty,
}: {
  open: boolean;
  progress: Animated.Value;
  width: number;
  tab: PmsTabKey;
  property: AccommodationPropertyContext;
  pendingFor: (key: PmsTabKey) => number;
  onSelectTab: (key: PmsTabKey) => void;
  onClose: () => void;
  onOpenPicker: () => void;
  onOpenManagement: () => void;
  onNewProperty: () => void;
}) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase('tr-TR');

  const results = useMemo(() => {
    if (!normalized) return null;
    return PMS_TABS.filter((entry) =>
      `${entry.label} ${entry.short} ${entry.description} ${entry.group}`
        .toLocaleLowerCase('tr-TR')
        .includes(normalized),
    );
  }, [normalized]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width - 40, 0] });
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const renderItem = (entry: (typeof PMS_TABS)[number]) => {
    const isActive = entry.key === tab;
    const pending = pendingFor(entry.key);
    return (
      <Pressable
        key={entry.key}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
        onPress={() => onSelectTab(entry.key)}
        style={({ pressed }) => [
          styles.drawerItem,
          {
            backgroundColor: isActive ? theme.colors.primarySoft : 'transparent',
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.drawerItemIcon,
            { backgroundColor: isActive ? theme.colors.primary : theme.colors.surfaceMuted },
          ]}
        >
          <Ionicons
            name={entry.icon}
            size={15}
            color={isActive ? theme.colors.onPrimary : theme.colors.textSecondary}
          />
        </View>
        <View style={styles.flex}>
          <AppText variant="label" color={isActive ? 'primary' : 'text'} numberOfLines={1}>
            {entry.label}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {entry.description}
          </AppText>
        </View>
        {pending > 0 ? <Badge value={pending} /> : null}
        <Ionicons name="chevron-forward" size={13} color={theme.colors.textTertiary} />
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents={open ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.drawerLayer]}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.colors.overlay, opacity: backdropOpacity },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Menüyü kapat"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View
        style={[
          styles.drawerPanel,
          {
            width,
            backgroundColor: theme.colors.surface,
            borderRightColor: theme.colors.divider,
            transform: [{ translateX }],
          },
          theme.shadows.floating,
        ]}
      >
        <AuroraBackdrop
          colors={[AURORA.night, AURORA.indigo, '#2A2660']}
          style={styles.drawerBrand}
        >
          <View style={styles.drawerBrandRow}>
            <LinearGradient
              colors={[theme.colors.primary, theme.colors.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.drawerLogo}
            >
              <Ionicons name="business" size={15} color="#FFFFFF" />
            </LinearGradient>
            <View style={styles.flex}>
              <AppText variant="overline" style={styles.drawerOverline}>
                TRABZONE
              </AppText>
              <AppText variant="caption" style={styles.drawerBrandText}>
                Otel Yönetimim
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Menüyü kapat"
              onPress={onClose}
              style={styles.drawerClose}
            >
              <Ionicons name="close" size={17} color="#FFFFFF" />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tesis değiştir"
            onPress={onOpenPicker}
            style={({ pressed }) => [styles.drawerProperty, { opacity: pressed ? 0.85 : 1 }]}
          >
            <PropertyAvatar property={property} size={32} />
            <View style={styles.flex}>
              <AppText variant="caption" numberOfLines={1} style={styles.drawerPropertyName}>
                {property.name}
              </AppText>
              <AppText variant="caption" numberOfLines={1} style={styles.drawerPropertyMeta}>
                {PROPERTY_TYPE_LABELS[property.property_type]}
                {property.district ? ` · ${property.district}` : ''}
              </AppText>
            </View>
            <Ionicons name="swap-horizontal" size={14} color="rgba(255,255,255,0.75)" />
          </Pressable>

          <View style={styles.drawerBadges}>
            <StatusPill
              label={PROPERTY_STATUS_LABELS[property.status]}
              color={property.status === 'published' ? '#3DD68C' : '#FBBF24'}
              background="rgba(255,255,255,0.12)"
              border="rgba(255,255,255,0.2)"
              icon={property.status === 'published' ? 'globe-outline' : 'time-outline'}
            />
            <StatusPill
              label={VERIFICATION_STATUS_LABELS[property.verification_status]}
              color={property.verification_status === 'verified' ? '#3DD68C' : '#FBBF24'}
              background="rgba(255,255,255,0.12)"
              border="rgba(255,255,255,0.2)"
              icon={
                property.verification_status === 'verified' ? 'shield-checkmark' : 'shield-outline'
              }
            />
          </View>
        </AuroraBackdrop>

        <View style={[styles.drawerSearchWrap, { borderBottomColor: theme.colors.divider }]}>
          <View
            style={[
              styles.drawerSearch,
              { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="search" size={15} color={theme.colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Menüde ara"
              placeholderTextColor={theme.colors.textTertiary}
              autoCorrect={false}
              returnKeyType="search"
              style={[
                styles.drawerSearchInput,
                theme.typography.caption,
                { color: theme.colors.text },
              ]}
            />
            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
                hitSlop={8}
                onPress={() => setQuery('')}
              >
                <Ionicons name="close-circle" size={15} color={theme.colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.drawerContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {results ? (
            results.length === 0 ? (
              <View style={styles.drawerEmpty}>
                <Ionicons name="search-outline" size={22} color={theme.colors.textTertiary} />
                <AppText variant="caption" color="textTertiary">
                  Eşleşen menü bulunamadı
                </AppText>
              </View>
            ) : (
              <View style={styles.drawerGroup}>
                <AppText variant="overline" color="textTertiary" style={styles.drawerGroupLabel}>
                  {results.length} SONUÇ
                </AppText>
                {results.map(renderItem)}
              </View>
            )
          ) : (
            PMS_GROUPS.map((group) => (
              <View key={group} style={styles.drawerGroup}>
                <View style={styles.drawerGroupHead}>
                  <Ionicons
                    name={GROUP_ICONS[group] ?? 'ellipse'}
                    size={11}
                    color={theme.colors.textTertiary}
                  />
                  <AppText variant="overline" color="textTertiary" style={styles.drawerGroupLabel}>
                    {group.toUpperCase()}
                  </AppText>
                </View>
                {PMS_TABS.filter((entry) => entry.group === group).map(renderItem)}
              </View>
            ))
          )}

          <View style={[styles.drawerFooter, { borderTopColor: theme.colors.divider }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tesis yönetim merkezi"
              onPress={onOpenManagement}
              style={({ pressed }) => [styles.drawerFooterItem, { opacity: pressed ? 0.75 : 1 }]}
            >
              <Ionicons name="apps-outline" size={15} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Tesis yönetim merkezi
              </AppText>
              <Ionicons name="chevron-forward" size={12} color={theme.colors.textTertiary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yeni tesis ekle"
              onPress={onNewProperty}
              style={({ pressed }) => [styles.drawerFooterItem, { opacity: pressed ? 0.75 : 1 }]}
            >
              <Ionicons name="add-circle-outline" size={15} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep" style={styles.flex}>
                Yeni tesis ekle
              </AppText>
              <Ionicons name="chevron-forward" size={12} color={theme.colors.textTertiary} />
            </Pressable>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: 16 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 5,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLogo: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, minWidth: 0, gap: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  headerGroupDot: { width: 5, height: 5, borderRadius: 3 },
  headerOverline: { fontSize: 8, letterSpacing: 1.4, flexShrink: 1 },
  headerDivider: { fontSize: 8 },
  headerBrandMini: { fontSize: 8, letterSpacing: 1.1, flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  headerAddButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  burger: { width: 18, height: 14, justifyContent: 'space-between', paddingVertical: 1 },
  burgerBar: { height: 2, borderRadius: 2, width: '100%' },
  propertyPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  propertyDot: { width: 6, height: 6, borderRadius: 3 },
  propertyName: {},
  hidden: { display: 'none' },

  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
  sidebar: { width: 252, borderRightWidth: StyleSheet.hairlineWidth },
  sidebarBrand: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 12, gap: 11 },
  sidebarBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  sidebarLogo: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarOverline: { color: 'rgba(255,255,255,0.55)', fontSize: 8, letterSpacing: 2 },
  sidebarBrandText: { color: '#FFFFFF', fontSize: 12 },
  sidebarProperty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  sidebarPropertyName: { color: '#FFFFFF', fontSize: 11 },
  sidebarPropertyMeta: { color: 'rgba(255,255,255,0.6)', fontSize: 9 },
  sidebarContent: { paddingVertical: 10, paddingHorizontal: 8, paddingBottom: 24 },
  sidebarGroup: { gap: 1, marginBottom: 10 },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  groupLabel: { fontSize: 8, letterSpacing: 1.2 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 9,
    position: 'relative',
  },
  navActiveBar: { position: 'absolute', left: 0, top: 7, bottom: 7, width: 2.5, borderRadius: 2 },
  navLabel: { flex: 1 },
  badge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  sidebarFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: 10,
    marginTop: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },

  main: { flex: 1, minWidth: 0 },
  mobileTabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  mobileTabsRow: { gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  mobileTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    height: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mobileTabText: { fontSize: 10 },
  mobileTabDot: { width: 5, height: 5, borderRadius: 3, marginLeft: 1 },
  content: { padding: 14, paddingBottom: 44, gap: 10 },
  contentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contentOverline: { fontSize: 9, letterSpacing: 1.6, marginBottom: 2 },
  tabStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabStatusText: { fontSize: 9 },

  drawerLayer: { zIndex: 30, elevation: 30 },
  drawerPanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
  },
  drawerBrand: { paddingHorizontal: 14, paddingTop: 16, paddingBottom: 13, gap: 10 },
  drawerBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  drawerLogo: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerOverline: { color: 'rgba(255,255,255,0.55)', fontSize: 8, letterSpacing: 2 },
  drawerBrandText: { color: '#FFFFFF', fontSize: 12 },
  drawerClose: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  drawerProperty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  drawerPropertyName: { color: '#FFFFFF', fontSize: 11 },
  drawerPropertyMeta: { color: 'rgba(255,255,255,0.6)', fontSize: 9 },
  drawerBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  drawerSearchWrap: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  drawerSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  drawerSearchInput: { flex: 1, paddingVertical: 0 },
  drawerContent: { padding: 8, paddingBottom: 28 },
  drawerGroup: { gap: 1, marginBottom: 10 },
  drawerGroupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  drawerGroupLabel: { fontSize: 8, letterSpacing: 1.3 },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 10,
  },
  drawerItemIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerEmpty: { alignItems: 'center', gap: 7, paddingVertical: 30 },
  drawerFooter: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 6, gap: 2 },
  drawerFooterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 10,
    borderRadius: 9,
  },

  propertyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
  },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  compactInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 9, borderRadius: 8 },
  fieldLabel: { marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  divider: { height: StyleSheet.hairlineWidth },
  dateRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  blockStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 8 },
});
