import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar, Button, IconButton } from '@/components/ui';
import {
  useAdminMe,
  useAdminSessionHeartbeat,
  useShellCounts,
} from '@/features/admin/hooks/use-admin';
import { ADMIN_NAV, canSee, findNavItem, type AdminNavItem } from '@/features/admin/nav';
import { logoutSession } from '@/features/admin/services/admin-service';
import { useAuthStore } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminToastProvider } from './AdminToast';
import { AdminAlertProvider } from './AdminAlertBubbles';

type BadgeKey = NonNullable<AdminNavItem['badge']>;

const SIDEBAR_FULL = 252;
const SIDEBAR_MINI = 76;
const MOBILE_BREAKPOINT = 980;

function badgeCount(
  key: BadgeKey | undefined,
  counts: ReturnType<typeof useShellCounts>['data'],
): number {
  if (!key || !counts) {
    return 0;
  }
  switch (key) {
    case 'reports':
      return counts.pending_reports;
    case 'tickets':
      return counts.open_tickets;
    case 'approvals':
      return counts.pending_approvals;
    case 'errors':
      return counts.open_errors;
    case 'critical':
      return counts.critical_reports;
    default:
      return 0;
  }
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { theme, scheme, setMode } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const isMobile = width < MOBILE_BREAKPOINT;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const me = useAdminMe();
  const counts = useShellCounts();
  const signOut = useAuthStore((state) => state.signOut);
  const sessionAgent = typeof navigator === 'undefined' ? Platform.OS : navigator.userAgent;
  useAdminSessionHeartbeat(Boolean(me.data?.is_admin), sessionAgent);

  const permissions = useMemo(() => me.data?.permissions ?? [], [me.data]);
  const current = findNavItem(pathname);
  const currentGroup = ADMIN_NAV.find((group) =>
    group.items.some((item) => item.key === current?.key),
  );

  const visibleGroups = useMemo(
    () =>
      ADMIN_NAV.map((group) => ({
        ...group,
        items: group.items.filter((item) => canSee(item, permissions)),
      })).filter((group) => group.items.length > 0),
    [permissions],
  );

  const searchResults = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr-TR');
    const flat = visibleGroups.flatMap((group) => group.items);
    if (!term) {
      return flat.slice(0, 8);
    }
    return flat
      .filter(
        (item) =>
          item.label.toLocaleLowerCase('tr-TR').includes(term) ||
          item.description.toLocaleLowerCase('tr-TR').includes(term),
      )
      .slice(0, 12);
  }, [search, visibleGroups]);

  const notifications = [
    counts.data?.critical_reports
      ? {
          key: 'critical',
          icon: 'warning-outline' as const,
          title: `${counts.data.critical_reports} kritik şikâyet`,
          body: 'Çocuk güvenliği ve acil bildirimler öncelikli kuyrukta.',
          href: '/admin/child-safety',
          tone: 'danger' as const,
        }
      : null,
    counts.data?.pending_reports
      ? {
          key: 'reports',
          icon: 'flag-outline' as const,
          title: `${counts.data.pending_reports} bekleyen şikâyet`,
          body: 'Moderasyon kuyruğunda işlem bekleyen kayıtlar var.',
          href: '/admin/reports',
          tone: 'warning' as const,
        }
      : null,
    counts.data?.open_tickets
      ? {
          key: 'tickets',
          icon: 'headset-outline' as const,
          title: `${counts.data.open_tickets} açık destek talebi`,
          body: 'SLA süresi dolmadan yanıtlanması gereken talepler.',
          href: '/admin/support',
          tone: 'info' as const,
        }
      : null,
    counts.data?.pending_approvals
      ? {
          key: 'approvals',
          icon: 'checkmark-done-outline' as const,
          title: `${counts.data.pending_approvals} onay bekliyor`,
          body: 'Kritik özellik değişiklikleri ikinci yönetici onayı bekliyor.',
          href: '/admin/features',
          tone: 'accent' as const,
        }
      : null,
    counts.data?.open_errors
      ? {
          key: 'errors',
          icon: 'alert-circle-outline' as const,
          title: `${counts.data.open_errors} sistem hatası`,
          body: 'Sistem sağlığı merkezinde açık hata kayıtları var.',
          href: '/admin/system',
          tone: 'danger' as const,
        }
      : null,
  ].filter(Boolean) as {
    key: string;
    icon: ComponentProps<typeof Ionicons>['name'];
    title: string;
    body: string;
    href: string;
    tone: 'danger' | 'warning' | 'info' | 'accent';
  }[];

  const unread =
    (counts.data?.pending_reports ?? 0) +
    (counts.data?.critical_reports ?? 0) +
    (counts.data?.open_tickets ?? 0) +
    (counts.data?.pending_approvals ?? 0) +
    (counts.data?.open_errors ?? 0);

  const navigate = (href: string) => {
    setDrawerOpen(false);
    setSearchOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
    router.push(href as Href);
  };

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await logoutSession();
      await signOut();
      router.replace('/(auth)/login');
    } finally {
      setSigningOut(false);
    }
  };

  // Loading shell identity before rendering prevents a flash of forbidden nav.
  if (me.isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
        <AppText variant="body" color="textSecondary">
          Yönetim oturumu doğrulanıyor…
        </AppText>
      </View>
    );
  }

  if (me.isError || !me.data?.is_admin) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background, gap: 16 }]}>
        <View style={[styles.deniedIcon, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="shield-outline" size={26} color={theme.colors.danger} />
        </View>
        <AppText variant="h2">Yetkisiz erişim</AppText>
        <AppText variant="body" color="textSecondary" style={styles.deniedText}>
          Bu alan yalnızca yetkili Trabzone personeline açıktır. Yetkiniz olduğunu düşünüyorsanız
          sistem yöneticisiyle iletişime geçin.
        </AppText>
        <Button label="Ana sayfaya dön" variant="secondary" onPress={() => router.replace('/')} />
      </View>
    );
  }

  const sidebarWidth = collapsed && !isMobile ? SIDEBAR_MINI : SIDEBAR_FULL;
  const sidebar = (
    <View
      style={[
        styles.sidebar,
        {
          width: isMobile ? SIDEBAR_FULL : sidebarWidth,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={[styles.brand, { borderColor: theme.colors.divider }]}>
        <View style={[styles.brandMark, { backgroundColor: theme.colors.primary }]}>
          <AppText variant="bodyStrong" style={{ color: theme.colors.onPrimary }}>
            T
          </AppText>
        </View>
        {(isMobile || !collapsed) && (
          <View style={styles.brandText}>
            <AppText variant="bodyStrong">Trabzone</AppText>
            <AppText variant="caption" color="textTertiary">
              Control Center
            </AppText>
          </View>
        )}
        {isMobile ? (
          <IconButton
            accessibilityLabel="Menüyü kapat"
            name="close"
            onPress={() => setDrawerOpen(false)}
          />
        ) : (
          <IconButton
            accessibilityLabel={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
            name={collapsed ? 'chevron-forward' : 'chevron-back'}
            size={17}
            onPress={() => setCollapsed((value) => !value)}
          />
        )}
      </View>

      {!collapsed || isMobile ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setDrawerOpen(false);
            setSearchOpen(true);
          }}
          style={[
            styles.searchTrigger,
            { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="search" size={15} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
            Menüde ara…
          </AppText>
          <View style={[styles.kbd, { borderColor: theme.colors.border }]}>
            <AppText variant="caption" color="textTertiary" style={{ fontSize: 10 }}>
              ⌘K
            </AppText>
          </View>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Menüde ara"
          onPress={() => setSearchOpen(true)}
          style={[styles.miniSearch, { backgroundColor: theme.colors.surfaceMuted }]}
        >
          <Ionicons name="search" size={17} color={theme.colors.textTertiary} />
        </Pressable>
      )}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.navScroll}
        contentContainerStyle={styles.navContent}
        showsVerticalScrollIndicator={false}
      >
        {visibleGroups.map((group) => (
          <View key={group.key} style={styles.navGroup}>
            {!collapsed || isMobile ? (
              <AppText variant="overline" color="textTertiary" style={styles.groupLabel}>
                {group.label}
              </AppText>
            ) : (
              <View style={[styles.groupRule, { backgroundColor: theme.colors.divider }]} />
            )}
            {group.items.map((item) => (
              <SidebarItem
                key={item.key}
                item={item}
                active={current?.key === item.key}
                collapsed={collapsed && !isMobile}
                badge={badgeCount(item.badge, counts.data)}
                onPress={() => navigate(item.href)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.sidebarFooter, { borderColor: theme.colors.divider }]}>
        <View style={[styles.healthDot, { backgroundColor: theme.colors.success }]} />
        {!collapsed || isMobile ? (
          <View style={{ flex: 1 }}>
            <AppText variant="caption" style={{ fontWeight: '600' }}>
              Sistem çalışıyor
            </AppText>
            <AppText variant="caption" color="textTertiary" style={{ fontSize: 10 }}>
              Supabase · Realtime · Storage
            </AppText>
          </View>
        ) : null}
        {!collapsed || isMobile ? (
          <IconButton
            accessibilityLabel="Sistem durumu"
            name="pulse-outline"
            size={16}
            onPress={() => navigate('/admin/system')}
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <AdminToastProvider>
      <AdminAlertProvider>
        <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
          {isMobile ? (
            <Modal
              visible={drawerOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setDrawerOpen(false)}
            >
              <View style={styles.modalRoot}>
                <Pressable
                  accessibilityLabel="Menüyü kapat"
                  style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
                  onPress={() => setDrawerOpen(false)}
                />
                <View style={{ width: SIDEBAR_FULL, height: '100%' }}>{sidebar}</View>
              </View>
            </Modal>
          ) : (
            sidebar
          )}

          <View style={styles.main}>
            <View
              style={[
                styles.topbar,
                {
                  height: 58 + (Platform.OS === 'web' ? 0 : insets.top),
                  paddingTop: Platform.OS === 'web' ? 0 : insets.top,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View style={styles.topbarLeft}>
                {isMobile ? (
                  <IconButton
                    accessibilityLabel="Menüyü aç"
                    name="menu"
                    size={20}
                    onPress={() => setDrawerOpen(true)}
                  />
                ) : null}
                <View style={styles.breadcrumb}>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {currentGroup?.label ?? 'Yönetim'}
                  </AppText>
                  <Ionicons name="chevron-forward" size={11} color={theme.colors.textTertiary} />
                  <AppText variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
                    {current?.label ?? 'Genel Bakış'}
                  </AppText>
                </View>
              </View>

              <View style={styles.topbarRight}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Uygulamaya dön"
                  onPress={() => {
                    setDrawerOpen(false);
                    router.push('/feed' as Href);
                  }}
                  style={({ pressed }) => [
                    styles.appBackButton,
                    {
                      borderColor: theme.colors.border,
                      backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                    },
                  ]}
                >
                  <Ionicons name="arrow-back" size={13} color={theme.colors.textSecondary} />
                  {!isMobile ? (
                    <AppText variant="caption" color="textSecondary" style={styles.appBackLabel}>
                      Uygulamaya dön
                    </AppText>
                  ) : null}
                </Pressable>

                {!isMobile ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSearchOpen(true)}
                    style={[
                      styles.topSearch,
                      {
                        backgroundColor: theme.colors.surfaceMuted,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <Ionicons name="search" size={14} color={theme.colors.textTertiary} />
                    <AppText variant="caption" color="textTertiary">
                      Hızlı arama
                    </AppText>
                  </Pressable>
                ) : null}

                <IconButton
                  accessibilityLabel={scheme === 'dark' ? 'Aydınlık tema' : 'Karanlık tema'}
                  name={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'}
                  size={17}
                  onPress={() => setMode(scheme === 'dark' ? 'light' : 'dark')}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bildirim merkezi"
                  onPress={() => setNotificationsOpen(true)}
                  style={styles.iconWrap}
                >
                  <Ionicons
                    name="notifications-outline"
                    size={19}
                    color={theme.colors.textSecondary}
                  />
                  {unread > 0 ? (
                    <View style={[styles.badgeDot, { backgroundColor: theme.colors.danger }]}>
                      <AppText style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>
                        {unread > 9 ? '9+' : unread}
                      </AppText>
                    </View>
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Personel menüsü"
                  onPress={() => setProfileOpen(true)}
                  style={[styles.profileChip, { borderColor: theme.colors.border }]}
                >
                  <Avatar name={me.data?.display_name ?? 'Yönetici'} size={26} />
                  {!isMobile ? (
                    <View style={{ maxWidth: 150 }}>
                      <AppText variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
                        {me.data?.display_name ?? 'Yönetici'}
                      </AppText>
                      <AppText
                        variant="caption"
                        color="textTertiary"
                        numberOfLines={1}
                        style={{ fontSize: 10 }}
                      >
                        {(me.data?.role_names ?? me.data?.roles ?? []).join(', ') || 'Personel'}
                      </AppText>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-down" size={12} color={theme.colors.textTertiary} />
                </Pressable>
              </View>
            </View>

            <View
              style={[
                styles.content,
                {
                  paddingBottom: Platform.OS === 'web' ? 0 : insets.bottom,
                },
              ]}
            >
              {children}
            </View>
          </View>

          {/* Command palette */}
          <Modal
            visible={searchOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setSearchOpen(false)}
          >
            <View style={styles.modalRoot}>
              <Pressable
                accessibilityLabel="Aramayı kapat"
                style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
                onPress={() => setSearchOpen(false)}
              />
              <View
                style={[
                  styles.searchPanel,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.border,
                    marginTop: Math.max(insets.top, 20),
                  },
                ]}
              >
                <View style={[styles.searchInputRow, { borderColor: theme.colors.divider }]}>
                  <Ionicons name="search" size={17} color={theme.colors.textTertiary} />
                  <TextInput
                    autoFocus
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Sayfa, işlem veya ayar ara…"
                    placeholderTextColor={theme.colors.textTertiary}
                    style={[styles.searchInput, { color: theme.colors.text }]}
                    autoCorrect={false}
                    returnKeyType="go"
                  />
                  <IconButton
                    accessibilityLabel="Aramayı kapat"
                    name="close"
                    size={16}
                    onPress={() => setSearchOpen(false)}
                  />
                </View>
                <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
                  {searchResults.length === 0 ? (
                    <View style={styles.searchEmpty}>
                      <AppText variant="body" color="textSecondary">
                        Sonuç bulunamadı.
                      </AppText>
                    </View>
                  ) : (
                    searchResults.map((item) => (
                      <Pressable
                        key={item.key}
                        accessibilityRole="button"
                        onPress={() => {
                          setSearch('');
                          navigate(item.href);
                        }}
                        style={({ pressed }) => [
                          styles.searchRow,
                          pressed ? { backgroundColor: theme.colors.primarySoft } : null,
                        ]}
                      >
                        <View
                          style={[styles.searchIcon, { backgroundColor: theme.colors.primarySoft }]}
                        >
                          <Ionicons name={item.icon} size={16} color={theme.colors.primaryDeep} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <AppText variant="bodyStrong">{item.label}</AppText>
                          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                            {item.description}
                          </AppText>
                        </View>
                        <Ionicons
                          name="return-down-back"
                          size={13}
                          color={theme.colors.textTertiary}
                        />
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>

          {/* Notification center */}
          <Modal
            visible={notificationsOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setNotificationsOpen(false)}
          >
            <View style={styles.modalRoot}>
              <Pressable
                accessibilityLabel="Bildirimleri kapat"
                style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
                onPress={() => setNotificationsOpen(false)}
              />
              <View
                style={[
                  styles.notificationPanel,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.border,
                    marginTop: 64,
                  },
                ]}
              >
                <View style={styles.notificationHeader}>
                  <AppText variant="h3">Operasyon bildirimleri</AppText>
                  <IconButton
                    accessibilityLabel="Kapat"
                    name="close"
                    size={16}
                    onPress={() => setNotificationsOpen(false)}
                  />
                </View>
                {notifications.length === 0 ? (
                  <View style={styles.notificationEmpty}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={24}
                      color={theme.colors.success}
                    />
                    <AppText variant="body" color="textSecondary">
                      Bekleyen işlem yok. Her şey güncel.
                    </AppText>
                  </View>
                ) : (
                  notifications.map((note) => {
                    const tone =
                      note.tone === 'danger'
                        ? theme.colors.danger
                        : note.tone === 'warning'
                          ? theme.colors.warning
                          : note.tone === 'accent'
                            ? theme.colors.accent
                            : theme.colors.info;
                    return (
                      <Pressable
                        key={note.key}
                        accessibilityRole="button"
                        onPress={() => navigate(note.href)}
                        style={({ pressed }) => [
                          styles.notificationRow,
                          { borderColor: theme.colors.divider },
                          pressed ? { backgroundColor: theme.colors.surfaceMuted } : null,
                        ]}
                      >
                        <View style={[styles.searchIcon, { backgroundColor: `${tone}1A` }]}>
                          <Ionicons name={note.icon} size={17} color={tone} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <AppText variant="bodyStrong">{note.title}</AppText>
                          <AppText variant="caption" color="textTertiary">
                            {note.body}
                          </AppText>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={14}
                          color={theme.colors.textTertiary}
                        />
                      </Pressable>
                    );
                  })
                )}
              </View>
            </View>
          </Modal>

          {/* Staff menu */}
          <Modal
            visible={profileOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setProfileOpen(false)}
          >
            <View style={styles.modalRoot}>
              <Pressable
                accessibilityLabel="Menüyü kapat"
                style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
                onPress={() => setProfileOpen(false)}
              />
              <View
                style={[
                  styles.profilePanel,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <View style={[styles.profileHead, { borderColor: theme.colors.divider }]}>
                  <Avatar name={me.data?.display_name ?? 'Yönetici'} size={40} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong">{me.data?.display_name ?? 'Yönetici'}</AppText>
                    <AppText variant="caption" color="textTertiary">
                      {(me.data?.role_names ?? me.data?.roles ?? []).join(', ') || 'Personel'}
                    </AppText>
                  </View>
                </View>
                <ProfileAction
                  icon="shield-checkmark-outline"
                  label="Güvenlik merkezi"
                  onPress={() => navigate('/admin/security')}
                />
                <ProfileAction
                  icon="key-outline"
                  label="Rol ve yetkiler"
                  onPress={() => navigate('/admin/roles')}
                />
                <ProfileAction
                  icon="receipt-outline"
                  label="İşlem geçmişim"
                  onPress={() => navigate('/admin/audit')}
                />
                <View style={[styles.profileDivider, { backgroundColor: theme.colors.divider }]} />
                <ProfileAction
                  icon="log-out-outline"
                  label={signingOut ? 'Çıkış yapılıyor…' : 'Güvenli çıkış'}
                  tone="danger"
                  onPress={() => {
                    if (!signingOut) {
                      void onSignOut();
                    }
                  }}
                />
              </View>
            </View>
          </Modal>
        </View>
      </AdminAlertProvider>
    </AdminToastProvider>
  );
}

function SidebarItem({
  item,
  active,
  collapsed,
  badge,
  onPress,
}: {
  item: AdminNavItem;
  active: boolean;
  collapsed: boolean;
  badge: number;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.navItem,
        collapsed ? styles.navItemCollapsed : null,
        {
          backgroundColor: active
            ? theme.colors.primarySoft
            : hovered
              ? theme.colors.surfaceMuted
              : 'transparent',
        },
      ]}
    >
      <View style={styles.navIconWrap}>
        <Ionicons
          name={item.icon}
          size={18}
          color={active ? theme.colors.primaryDeep : theme.colors.textSecondary}
        />
        {badge > 0 && collapsed ? (
          <View style={[styles.navBadgeDot, { backgroundColor: theme.colors.danger }]} />
        ) : null}
      </View>
      {!collapsed ? (
        <>
          <AppText
            variant="caption"
            numberOfLines={1}
            style={{
              flex: 1,
              fontWeight: active ? '700' : '600',
              color: active ? theme.colors.primaryDeep : theme.colors.textSecondary,
            }}
          >
            {item.label}
          </AppText>
          {badge > 0 ? (
            <View
              style={[
                styles.navBadge,
                {
                  backgroundColor:
                    item.badge === 'critical' ? theme.colors.danger : theme.colors.primarySoft,
                },
              ]}
            >
              <AppText
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: item.badge === 'critical' ? '#fff' : theme.colors.primaryDeep,
                }}
              >
                {badge > 99 ? '99+' : badge}
              </AppText>
            </View>
          ) : null}
        </>
      ) : null}
      {active ? (
        <View style={[styles.activeBar, { backgroundColor: theme.colors.primary }]} />
      ) : null}
    </Pressable>
  );
}

function ProfileAction({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  tone?: 'danger';
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileAction,
        pressed ? { backgroundColor: theme.colors.surfaceMuted } : null,
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={tone === 'danger' ? theme.colors.danger : theme.colors.textSecondary}
      />
      <AppText variant="body" color={tone === 'danger' ? 'danger' : 'text'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  deniedIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deniedText: { maxWidth: 420, textAlign: 'center' },
  sidebar: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  brand: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { flex: 1, minWidth: 0 },
  searchTrigger: {
    marginHorizontal: 12,
    marginTop: 12,
    height: 34,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
  },
  kbd: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  miniSearch: {
    marginHorizontal: 12,
    marginTop: 12,
    height: 36,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navScroll: { flex: 1, marginTop: 8 },
  navContent: { paddingHorizontal: 8, paddingBottom: 12 },
  navGroup: { marginBottom: 10 },
  groupLabel: { paddingHorizontal: 10, marginBottom: 4, fontSize: 10, letterSpacing: 0.6 },
  groupRule: { height: StyleSheet.hairlineWidth, marginHorizontal: 10, marginBottom: 8 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 36,
    borderRadius: 9,
    paddingHorizontal: 10,
    marginBottom: 1,
    position: 'relative',
  },
  navItemCollapsed: { paddingHorizontal: 0, justifyContent: 'center' },
  navIconWrap: { width: 20, alignItems: 'center', justifyContent: 'center' },
  navBadge: {
    minWidth: 19,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  navBadgeDot: { position: 'absolute', top: -1, right: -3, width: 7, height: 7, borderRadius: 4 },
  activeBar: { position: 'absolute', left: -8, top: 9, bottom: 9, width: 3, borderRadius: 2 },
  sidebarFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  healthDot: { width: 8, height: 8, borderRadius: 4 },
  main: { flex: 1, minWidth: 0 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  topbarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 },
  topbarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  appBackButton: {
    height: 26,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  appBackLabel: { fontSize: 11, fontWeight: '600' },
  topSearch: {
    height: 32,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 180,
  },
  iconWrap: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  badgeDot: {
    position: 'absolute',
    top: 2,
    right: 1,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingLeft: 3,
    paddingRight: 8,
    height: 34,
  },
  content: { flex: 1, minWidth: 0 },
  modalRoot: { flex: 1 },
  searchPanel: {
    width: '92%',
    maxWidth: 560,
    alignSelf: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    maxHeight: '80%',
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 50,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8, outlineStyle: 'none' } as never,
  searchEmpty: { padding: 24, alignItems: 'center' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationPanel: {
    width: '92%',
    maxWidth: 420,
    maxHeight: '76%',
    alignSelf: 'flex-end',
    marginRight: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  notificationEmpty: { alignItems: 'center', gap: 8, padding: 32 },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  profilePanel: {
    position: 'absolute',
    top: 64,
    right: 12,
    width: 248,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingBottom: 6,
  },
  profileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  profileAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 38,
    paddingHorizontal: 14,
  },
  profileDivider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
