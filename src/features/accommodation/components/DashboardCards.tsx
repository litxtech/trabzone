import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { Dashboard, ManagedProperty } from '../types';
import {
  PROPERTY_TYPE_LABELS,
  formatDateLong,
  formatMoneyCents,
  formatPercent,
} from '../utils/format';
import { AccCard, DateField, InfoBanner, StatTile, StatusPill } from './AccommodationUI';

type FinanceKey = keyof Dashboard['finance'];
type OpsKey = keyof Dashboard['operations'];

const FINANCE_CARDS: { key: FinanceKey; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; tone?: 'primary' | 'success' | 'warning' | 'danger'; hint?: string }[] = [
  { key: 'today_revenue_cents', label: 'Bugünkü konaklama geliri', icon: 'trending-up-outline', tone: 'primary', hint: 'Gece bazında tahakkuk' },
  { key: 'yesterday_revenue_cents', label: 'Dün gerçekleşen', icon: 'time-outline' },
  { key: 'week_revenue_cents', label: 'Bu hafta', icon: 'calendar-outline' },
  { key: 'month_revenue_cents', label: 'Bu ay', icon: 'calendar-number-outline' },
  { key: 'prev_month_revenue_cents', label: 'Önceki ay', icon: 'calendar-clear-outline' },
  { key: 'year_revenue_cents', label: 'Yıllık gelir', icon: 'analytics-outline' },
  { key: 'cash_total_cents', label: 'Kasa toplamı', icon: 'wallet-outline', hint: 'Tüm hesaplar' },
  { key: 'cash_cents', label: 'Nakit kasa', icon: 'cash-outline' },
  { key: 'pos_cents', label: 'POS tahsilatı', icon: 'card-outline' },
  { key: 'bank_cents', label: 'Banka tahsilatı', icon: 'business-outline' },
  { key: 'open_balance_cents', label: 'Açık misafir bakiyesi', icon: 'alert-circle-outline', tone: 'warning' },
  { key: 'commission_estimated_cents', label: 'Tahmini komisyon', icon: 'calculator-outline', hint: '%10 Trabzone' },
  { key: 'commission_finalized_cents', label: 'Kesinleşen komisyon', icon: 'checkmark-done-outline' },
  { key: 'commission_paid_cents', label: 'Ödenen komisyon', icon: 'checkmark-circle-outline', tone: 'success' },
  { key: 'commission_due_cents', label: 'Ödenmemiş komisyon', icon: 'alert-outline', tone: 'danger' },
];

const OPS_CARDS: { key: OpsKey; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; tone?: 'primary' | 'success' | 'warning' | 'danger'; tab?: string }[] = [
  { key: 'arrivals_today', label: 'Bugün giriş', icon: 'log-in-outline', tone: 'primary', tab: 'frontdesk' },
  { key: 'departures_today', label: 'Bugün çıkış', icon: 'log-out-outline', tab: 'frontdesk' },
  { key: 'in_house', label: 'Konaklayan misafir', icon: 'people-outline', tab: 'frontdesk' },
  { key: 'pending_reservations', label: 'Onay bekleyen', icon: 'hourglass-outline', tone: 'warning', tab: 'reservations' },
  { key: 'created_today', label: 'Bugün oluşturulan', icon: 'add-circle-outline', tab: 'reservations' },
  { key: 'available_rooms', label: 'Müsait oda', icon: 'bed-outline', tone: 'success', tab: 'rooms' },
  { key: 'occupied_rooms', label: 'Dolu oda', icon: 'bed' , tab: 'rooms' },
  { key: 'out_of_service_rooms', label: 'Satışa kapalı', icon: 'close-circle-outline', tone: 'danger', tab: 'rooms' },
  { key: 'dirty_rooms', label: 'Kirli oda', icon: 'water-outline', tone: 'warning', tab: 'housekeeping' },
  { key: 'cleaning_rooms', label: 'Temizlikte', icon: 'sparkles-outline', tab: 'housekeeping' },
  { key: 'maintenance_rooms', label: 'Bakımda', icon: 'construct-outline', tone: 'danger', tab: 'housekeeping' },
  { key: 'unread_messages', label: 'Okunmamış mesaj', icon: 'chatbubbles-outline', tab: 'messages' },
  { key: 'upcoming_reservations', label: 'Yaklaşan rezervasyon', icon: 'airplane-outline', tab: 'reservations' },
  { key: 'active_campaigns', label: 'Aktif kampanya', icon: 'pricetag-outline', tab: 'campaigns' },
];

export function DashboardCards({
  dashboard,
  property,
  date,
  onDateChange,
  onOpenTab,
}: {
  dashboard: Dashboard;
  property: ManagedProperty;
  date: string;
  onDateChange: (date: string) => void;
  onOpenTab: (tab: string) => void;
}) {
  const { theme } = useTheme();
  const finance = dashboard.finance;
  const operations = dashboard.operations;
  const occupancy = Math.max(0, Math.min(100, operations.occupancy_rate));

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <AppText variant="overline" color="primaryDeep">
            {PROPERTY_TYPE_LABELS[property.property_type]} · {property.district ?? 'Trabzon'}
          </AppText>
          <AppText variant="h2" style={styles.title}>
            {property.name}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {formatDateLong(dashboard.date)}
          </AppText>
        </View>
        <View style={styles.headActions}>
          {property.verification_status === 'verified' ? (
            <StatusPill
              label="Doğrulanmış işletme"
              icon="shield-checkmark"
              color={theme.colors.success}
              background={theme.colors.successSoft}
            />
          ) : (
            <StatusPill
              label={
                property.verification_status === 'pending'
                  ? 'Doğrulama bekliyor'
                  : property.verification_status === 'rejected'
                    ? 'Doğrulama reddedildi'
                    : 'Doğrulanmamış'
              }
              icon="alert-circle"
              color={theme.colors.warning}
              background={theme.colors.warningSoft}
            />
          )}
        </View>
      </View>

      <View style={styles.dateBar}>
        <View style={styles.flex}>
          <DateField label="Rapor tarihi" value={date} onChange={onDateChange} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bugünün raporu"
          onPress={() => onDateChange(new Date().toISOString().slice(0, 10))}
          style={[styles.todayButton, { backgroundColor: theme.colors.primarySoft }]}
        >
          <Ionicons name="locate-outline" size={15} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="primaryDeep">
            Bugün
          </AppText>
        </Pressable>
      </View>

      {property.verification_status !== 'verified' && property.missing.length > 0 ? (
        <InfoBanner
          tone="warning"
          text={`Yayın ve rezervasyon satışı için eksikler: ${property.missing.join(', ')}`}
        />
      ) : null}

      <AccCard padding={14} style={styles.occupancyCard}>
        <View style={styles.occupancyHead}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Doluluk oranı</AppText>
            <AppText variant="caption" color="textTertiary">
              {operations.occupied_rooms} dolu / {operations.occupied_rooms + operations.available_rooms} satılabilir oda
            </AppText>
          </View>
          <AppText variant="h2" color="primaryDeep" style={styles.occupancyValue}>
            {formatPercent(occupancy, 0)}
          </AppText>
        </View>
        <View style={[styles.occupancyTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
          <View style={[styles.occupancyFill, { width: `${occupancy}%`, backgroundColor: theme.colors.primary }]} />
        </View>
        <View style={styles.occupancyStats}>
          <MiniStat label="Müsait" value={operations.available_rooms} tone={theme.colors.success} />
          <MiniStat label="Dolu" value={operations.occupied_rooms} tone={theme.colors.primary} />
          <MiniStat label="Kapalı" value={operations.out_of_service_rooms} tone={theme.colors.danger} />
          <MiniStat label="Kirli" value={operations.dirty_rooms} tone={theme.colors.warning} />
        </View>
      </AccCard>

      <View style={styles.sectionHead}>
        <View style={styles.flex}>
          <AppText variant="h3">Finans özeti</AppText>
          <AppText variant="caption" color="textTertiary">
            Konaklama geliri, tahsilat ve komisyon ayrı hesaplanır
          </AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Finans merkezini aç" onPress={() => onOpenTab('finance')}>
          <AppText variant="caption" color="primaryDeep">
            Finans merkezi →
          </AppText>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statRow}>
        {FINANCE_CARDS.map((card) => (
          <View key={card.key} style={styles.financeTile}>
            <StatTile
              icon={card.icon}
              label={card.label}
              value={formatMoneyCents(finance[card.key])}
              hint={card.hint}
              tone={card.tone}
            />
          </View>
        ))}
      </ScrollView>

      <View style={styles.sectionHead}>
        <View style={styles.flex}>
          <AppText variant="h3">Operasyon</AppText>
          <AppText variant="caption" color="textTertiary">
            Bugünün ön büro ve kat hizmetleri durumu
          </AppText>
        </View>
      </View>

      <View style={styles.opsGrid}>
        {OPS_CARDS.map((card) => (
          <Pressable
            key={card.key}
            accessibilityRole="button"
            accessibilityLabel={card.label}
            onPress={() => card.tab && onOpenTab(card.tab)}
            style={({ pressed }) => [
              styles.opsTile,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.opsIcon,
                {
                  backgroundColor:
                    card.tone === 'warning'
                      ? theme.colors.warningSoft
                      : card.tone === 'danger'
                        ? theme.colors.dangerSoft
                        : card.tone === 'success'
                          ? theme.colors.successSoft
                          : theme.colors.primarySoft,
                },
              ]}
            >
              <Ionicons
                name={card.icon}
                size={16}
                color={
                  card.tone === 'warning'
                    ? theme.colors.warning
                    : card.tone === 'danger'
                      ? theme.colors.danger
                      : card.tone === 'success'
                        ? theme.colors.success
                        : theme.colors.primaryDeep
                }
              />
            </View>
            <AppText variant="h3" style={styles.opsValue}>
              {operations[card.key]}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={2} style={styles.opsLabel}>
              {card.label}
            </AppText>
          </Pressable>
        ))}
      </View>

      <View style={styles.shortcutGrid}>
        {[
          { tab: 'calendar', label: 'Oda takvimi', icon: 'grid-outline' },
          { tab: 'rates', label: 'Fiyat takvimi', icon: 'pricetags-outline' },
          { tab: 'frontdesk', label: 'Ön büro', icon: 'desktop-outline' },
          { tab: 'housekeeping', label: 'Kat hizmetleri', icon: 'sparkles-outline' },
          { tab: 'cash', label: 'Kasa', icon: 'wallet-outline' },
          { tab: 'finance', label: 'Finans', icon: 'analytics-outline' },
        ].map((shortcut) => (
          <Pressable
            key={shortcut.tab}
            accessibilityRole="button"
            accessibilityLabel={shortcut.label}
            onPress={() => onOpenTab(shortcut.tab)}
            style={[styles.shortcut, { backgroundColor: theme.colors.surfaceMuted }]}
          >
            <Ionicons name={shortcut.icon as React.ComponentProps<typeof Ionicons>['name']} size={16} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="textSecondary">
              {shortcut.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.miniStat}>
      <View style={[styles.miniDot, { backgroundColor: tone }]} />
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="caption" color="text" style={styles.miniValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  flex: { flex: 1 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  headActions: { alignItems: 'flex-end' },
  title: { fontSize: 24, lineHeight: 29 },
  dateBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  todayButton: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 44, paddingHorizontal: 12, borderRadius: 10 },
  occupancyCard: { gap: 8 },
  occupancyHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  occupancyValue: { fontSize: 26, lineHeight: 30 },
  occupancyTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  occupancyFill: { height: '100%', borderRadius: 4 },
  occupancyStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  miniStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniDot: { width: 6, height: 6, borderRadius: 3 },
  miniValue: { fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 4 },
  statRow: { gap: 8, paddingBottom: 2 },
  financeTile: { width: 190 },
  opsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opsTile: { width: '23.6%', minWidth: 132, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 2 },
  opsIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  opsValue: { fontSize: 21, lineHeight: 25 },
  opsLabel: { fontSize: 9, lineHeight: 12 },
  shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 38, borderRadius: 10 },
});
