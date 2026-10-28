import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Skeleton } from '@/components/ui';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { fileNameFromDocument, useDocumentViewer } from '@/features/documents/viewer';
import { AdminPage, AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { BarChart, TrendChart } from '@/features/admin/components/Charts';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import {
  useRideAdminAnalytics,
  useRideAdminAudit,
  useRideAdminDisputeDecide,
  useRideAdminDisputes,
  useRideAdminDriverApplications,
  useRideAdminDriverDecide,
  useRideAdminFinance,
  useRideAdminIncidentAction,
  useRideAdminIncidents,
  useRideAdminOfferAction,
  useRideAdminOffers,
  useRideAdminOverview,
  useRideAdminRecurring,
  useRideAdminRefundDecide,
  useRideAdminRequestAction,
  useRideAdminRequests,
  useRideAdminReservationAction,
  useRideAdminReservations,
  useRideAdminReviewModerate,
  useRideAdminReviews,
  useRideAdminSetSetting,
  useRideAdminSettings,
  useRideAdminVehicleDecide,
  useRideAdminVehicleDocumentDecide,
  useRideAdminVehicles,
  useRideAdminVerificationDecide,
  useRideAdminVerifications,
  useRideAdminWaitlists,
} from '@/features/ride/hooks/use-ride';
import { rideDocumentUrl } from '@/features/ride/services/ride-service';
import type {
  RideAdminOffer,
  RideAdminRequest,
  RideAdminReservation,
  RideAdminVerification,
  RideAdminVehicle,
} from '@/features/ride/types';
import {
  BOOKING_MODE_LABEL,
  MODE_LABEL,
  OFFER_STATUS_LABEL,
  RESERVATION_STATUS_LABEL,
  SCOPE_LABEL,
  STATUS_TONE,
  VERIFICATION_LABEL,
  VERIFICATION_STATUS_LABEL,
  WEEKDAY_NAMES,
  formatDateTime,
  formatMoney,
  formatShortDate,
} from '@/features/ride/utils/format';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * İnceleme belgesini uygulama içi görüntüleyicide açar.
 *
 * Yönetim panelinde belgeyi görmek için tarayıcıya çıkmak hem yavaştı hem de
 * imzalı adresi cihaz tarayıcısı geçmişine bırakıyordu. Belge artık aynı
 * ekranda, yakınlaştırılabilir görüntüleyicide açılır; bağlantının süresi
 * dolarsa görüntüleyici kendi yenisini ister.
 *
 * @returns Hata mesajı; başarılıysa `null`.
 */
function useRideDocumentOpener() {
  const viewer = useDocumentViewer();

  return useCallback(
    async (path: string, title: string): Promise<string | null> => {
      const result = await rideDocumentUrl(path);
      if (!result.ok) {
        return result.error.message;
      }
      viewer.openDocument({
        url: result.data.url,
        name: fileNameFromDocument({ url: result.data.url, name: path }),
        title,
        refresh: async () => {
          const fresh = await rideDocumentUrl(path);
          return fresh.ok ? fresh.data.url : null;
        },
      });
      return null;
    },
    [viewer],
  );
}

type TabKey =
  | 'overview'
  | 'offers'
  | 'requests'
  | 'reservations'
  | 'waitlists'
  | 'verifications'
  | 'drivers'
  | 'vehicles'
  | 'disputes'
  | 'incidents'
  | 'finance'
  | 'reviews'
  | 'recurring'
  | 'settings'
  | 'analytics'
  | 'audit';

const TABS: {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  permission: string;
}[] = [
  { key: 'overview', label: 'Dashboard', icon: 'grid-outline', permission: 'ride.view' },
  { key: 'offers', label: 'İlanlar', icon: 'car-outline', permission: 'ride.view' },
  { key: 'requests', label: 'Yolcu talepleri', icon: 'hand-left-outline', permission: 'ride.view' },
  { key: 'reservations', label: 'Rezervasyonlar', icon: 'ticket-outline', permission: 'ride.view' },
  {
    key: 'waitlists',
    label: 'Bekleme listesi',
    icon: 'hourglass-outline',
    permission: 'ride.view',
  },
  {
    key: 'verifications',
    label: 'Doğrulamalar',
    icon: 'shield-checkmark-outline',
    permission: 'ride.verify',
  },
  {
    key: 'drivers',
    label: 'Sürücü başvuruları',
    icon: 'id-card-outline',
    permission: 'ride.verify',
  },
  {
    key: 'vehicles',
    label: 'Araç ve belgeler',
    icon: 'car-sport-outline',
    permission: 'ride.verify',
  },
  {
    key: 'disputes',
    label: 'Uyuşmazlık',
    icon: 'git-compare-outline',
    permission: 'ride.moderate',
  },
  {
    key: 'incidents',
    label: 'Güvenlik olayları',
    icon: 'warning-outline',
    permission: 'ride.safety',
  },
  { key: 'finance', label: 'Finans', icon: 'wallet-outline', permission: 'ride.finance' },
  { key: 'reviews', label: 'Değerlendirmeler', icon: 'star-outline', permission: 'ride.moderate' },
  {
    key: 'recurring',
    label: 'Düzenli planlar',
    icon: 'repeat-outline',
    permission: 'ride.analytics',
  },
  { key: 'settings', label: 'Kurallar', icon: 'options-outline', permission: 'ride.manage' },
  { key: 'analytics', label: 'Analitik', icon: 'analytics-outline', permission: 'ride.analytics' },
  { key: 'audit', label: 'Denetim', icon: 'receipt-outline', permission: 'ride.view' },
];

const money = (cents: number | null | undefined, currency = 'TRY') => formatMoney(cents, currency);
const dateText = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : '—');

/** Baloncuk rotasındaki `?tab=` değerini güvenli biçimde sekmeye çevirir. */
function tabFromParam(value: string | string[] | undefined): TabKey | null {
  const key = Array.isArray(value) ? value[0] : value;
  return TABS.some((item) => item.key === key) ? (key as TabKey) : null;
}

export default function AdminRideScreen() {
  const { theme } = useTheme();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<TabKey>(() => tabFromParam(params.tab) ?? 'overview');

  // Baloncuk uyarısı ilgili sekmeyi açar; panel açıkken gelen yeni uyarı da
  // aynı davranışla sekmeyi değiştirir. URL parametresi dış kaynak olduğu için
  // sekmeyi efekt içinde eşitliyoruz.
  useEffect(() => {
    const next = tabFromParam(params.tab);
    if (next) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(next);
    }
  }, [params.tab]);

  const allowed = TABS.filter((item) => permissions.includes(item.permission));
  const can = (permission: string) => permissions.includes(permission);
  const active = allowed.find((item) => item.key === tab) ?? allowed[0] ?? null;

  return (
    <AdminPage
      title="Yolculuk Yönetim Merkezi"
      subtitle="İlanlar, rezervasyonlar, doğrulamalar, güvenlik, finans ve denetim tek merkezde. Her işlem sunucuda izin kontrolünden geçer ve denetim kaydı üretir."
      actions={
        <Badge
          label={me.isLoading ? 'Yetki kontrolü…' : `${permissions.length} izin`}
          tone="primary"
        />
      }
    >
      {me.isLoading ? (
        <View style={styles.gap}>
          <Skeleton height={44} />
          <Skeleton height={220} radius={14} />
        </View>
      ) : !me.data?.is_admin ? (
        <Locked message="Bu alan yönetici yetkisi gerektirir." />
      ) : allowed.length === 0 ? (
        <Locked message="Yolculuk yönetimi için izniniz yok. Sistem yöneticisinden ride.view veya ilgili izni talep edin." />
      ) : (
        <>
          <View style={styles.tabs}>
            {allowed.map((item) => {
              const selected = active?.key === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setTab(item.key)}
                  style={[
                    styles.tab,
                    {
                      backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={14}
                    color={selected ? theme.colors.onPrimary : theme.colors.textSecondary}
                  />
                  <AppText variant="caption" color={selected ? 'onPrimary' : 'textSecondary'}>
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {active?.key === 'overview' && can('ride.view') ? <OverviewPanel /> : null}
          {active?.key === 'offers' && can('ride.view') ? (
            <OffersPanel canModerate={can('ride.moderate')} />
          ) : null}
          {active?.key === 'requests' && can('ride.view') ? (
            <RequestsPanel canModerate={can('ride.moderate')} />
          ) : null}
          {active?.key === 'reservations' && can('ride.view') ? (
            <ReservationsPanel canModerate={can('ride.moderate')} />
          ) : null}
          {active?.key === 'waitlists' && can('ride.view') ? <WaitlistsPanel /> : null}
          {active?.key === 'verifications' && can('ride.verify') ? <VerificationsPanel /> : null}
          {active?.key === 'drivers' && can('ride.verify') ? <DriverApplicationsPanel /> : null}
          {active?.key === 'vehicles' && can('ride.verify') ? <VehiclesPanel /> : null}
          {active?.key === 'disputes' && can('ride.moderate') ? <DisputesPanel /> : null}
          {active?.key === 'incidents' && can('ride.safety') ? <IncidentsPanel /> : null}
          {active?.key === 'finance' && can('ride.finance') ? <FinancePanel /> : null}
          {active?.key === 'reviews' && can('ride.moderate') ? <ReviewsPanel /> : null}
          {active?.key === 'recurring' && can('ride.analytics') ? <RecurringPanel /> : null}
          {active?.key === 'settings' && can('ride.manage') ? <SettingsPanel /> : null}
          {active?.key === 'analytics' && can('ride.analytics') ? <AnalyticsPanel /> : null}
          {active?.key === 'audit' && can('ride.view') ? <AuditPanel /> : null}
        </>
      )}
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function OverviewPanel() {
  const overview = useRideAdminOverview();
  const data = overview.data;

  if (overview.isLoading) return <LoadingBlock />;
  if (overview.isError)
    return <ErrorBlock message={overview.error.message} onRetry={() => void overview.refetch()} />;
  if (!data) return null;

  return (
    <View style={styles.stack}>
      <StatGrid>
        <StatCard
          label="Aktif ilan"
          value={String(data.offers.active)}
          icon="car-outline"
          hint={`${data.offers.scheduled} planlı · ${data.offers.today} bugün`}
        />
        <StatCard
          label="Yolda"
          value={String(data.offers.started)}
          icon="navigate-outline"
          tone="accent"
          hint={`${data.offers.completed_30d} son 30 gün tamamlandı`}
        />
        <StatCard
          label="Onay bekleyen rezervasyon"
          value={String(data.reservations.requested)}
          icon="time-outline"
          tone={data.reservations.requested > 0 ? 'warning' : 'success'}
          hint={`${data.reservations.confirmed} onaylı`}
        />
        <StatCard
          label="Kritik güvenlik olayı"
          value={String(data.queues.critical_incidents)}
          icon="warning-outline"
          tone={data.queues.critical_incidents > 0 ? 'danger' : 'success'}
          hint={`${data.queues.incidents} açık olay`}
        />
        <StatCard
          label="Doğrulama kuyruğu"
          value={String(data.queues.verifications)}
          icon="shield-checkmark-outline"
          hint={`${data.queues.vehicles} araç · ${data.queues.vehicle_documents} belge`}
        />
        <StatCard
          label="Bekleme listesi"
          value={String(data.queues.waitlists)}
          icon="hourglass-outline"
          hint="Sırada bekleyen yolcu"
        />
        <StatCard
          label="Açık uyuşmazlık"
          value={String(data.queues.disputes)}
          icon="git-compare-outline"
          tone={data.queues.disputes > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Doğrulanmış kart tahsilatı"
          value={money(data.finance.verified_paid_cents)}
          icon="card-outline"
          tone="success"
          hint={`${data.finance.card_payments} ödeme kaydı`}
        />
        <StatCard
          label="Nakit bildirimi (30 gün)"
          value={money(data.finance.cash_reported_cents_30d)}
          icon="cash-outline"
          hint={`${data.finance.cash_reservations_30d} rezervasyon`}
        />
        <StatCard
          label="İade talebi"
          value={String(data.finance.refund_requests)}
          icon="return-down-back-outline"
          tone={data.finance.refund_requests > 0 ? 'warning' : 'success'}
          hint={money(data.finance.refunds_total_cents)}
        />
        <StatCard
          label="Üye puanı"
          value={data.community.rating_avg ? data.community.rating_avg.toFixed(2) : '—'}
          icon="star-outline"
          tone="accent"
          hint={`${data.community.reviews} yayınlanmış değerlendirme`}
        />
        <StatCard
          label="Aktif düzenli plan"
          value={String(data.community.recurring_active)}
          icon="repeat-outline"
          hint={`${data.community.verified_members} doğrulanmış üye`}
        />
      </StatGrid>

      <AdminSection
        title="Yapılandırma durumu"
        subtitle="Kartlı ödeme ve ticari mod yalnızca yasal/teknik koşullar sağlandığında açılır."
      >
        <View style={styles.wrap}>
          <Badge
            label={data.config.card_payments_enabled ? 'Kart ödemesi açık' : 'Kart ödemesi kapalı'}
            tone={data.config.card_payments_enabled ? 'success' : 'neutral'}
          />
          <Badge
            label={data.config.commercial_enabled ? 'Ticari mod açık' : 'Ticari mod kapalı'}
            tone={data.config.commercial_enabled ? 'warning' : 'neutral'}
          />
          <Badge label={`Koltuk tutma: ${data.config.hold_minutes} dk`} tone="neutral" />
          <Badge
            label={`İptal: ${data.config.free_hours_intracity} sa / ${data.config.free_hours_intercity} sa`}
            tone="neutral"
          />
        </View>
        <AppText variant="caption" color="textTertiary">
          {data.finance.note}
        </AppText>
      </AdminSection>

      <AdminSection
        title="Kapasite ve koltuk"
        subtitle="Segment bazlı kapasiteyi ilan detayından inceleyin; aynı koltuk çakışan bölümlerde satılamaz."
      >
        <AppText variant="caption" color="textSecondary">
          Aktif ilanlarda toplam {data.offers.active + data.offers.started} araç yolda ya da
          yayında. Koltuk uygunluğu sunucudaki segment tahsislerinden hesaplanır; yönetici paneli
          kapasiteyi doğrudan değiştirmez, yalnızca ilanı iptal edebilir veya sürücüyü askıya
          alabilir.
        </AppText>
      </AdminSection>
    </View>
  );
}

// ---------------------------------------------------------------------------
// İlanlar
// ---------------------------------------------------------------------------
function OffersPanel({ canModerate }: { canModerate: boolean }) {
  const [status, setStatus] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const offers = useRideAdminOffers({ status: status === 'all' ? null : status, query, offset });
  const action = useRideAdminOfferAction();

  const run = (offer: RideAdminOffer, kind: 'cancel' | 'suspend_driver') => {
    if (reason.trim().length < 5) {
      setNotice('İşlem için en az 5 karakterlik gerekçe girin.');
      return;
    }
    setNotice(null);
    action.mutate(
      { offerId: offer.id, action: kind, reason: reason.trim() },
      {
        onSuccess: () =>
          setNotice(kind === 'cancel' ? 'İlan iptal edildi.' : 'Sürücü askıya alındı.'),
        onError: (cause) => setNotice(cause.message),
      },
    );
  };

  return (
    <AdminSection
      title="Sürücü ilanları"
      subtitle="Aktif, planlı, sosyal ve düzenli planlardan üretilen ilanlar"
      action={<Badge label={`${offers.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <View style={styles.wrap}>
        <FilterChips
          value={status}
          onChange={(next) => {
            setStatus(next);
            setOffset(0);
          }}
          options={[
            { key: 'all', label: 'Tümü' },
            { key: 'published', label: 'Yayında' },
            { key: 'started', label: 'Yolda' },
            { key: 'full', label: 'Dolu' },
            { key: 'completed', label: 'Tamamlandı' },
            { key: 'cancelled', label: 'İptal' },
          ]}
        />
        <AdminField
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          placeholder="Güzergâh veya kullanıcı ara"
          width={240}
        />
      </View>
      <ReasonField value={reason} onChangeText={setReason} />
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {offers.isLoading ? (
        <LoadingBlock compact />
      ) : offers.isError ? (
        <ErrorBlock message={offers.error.message} onRetry={() => void offers.refetch()} />
      ) : (offers.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Bu filtrede ilan yok." />
      ) : (
        <View style={styles.stack}>
          {offers.data?.items.map((offer) => (
            <AdminRow key={offer.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {offer.origin_label} → {offer.dest_label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {dateText(offer.depart_at)} · {SCOPE_LABEL[offer.scope]} ·{' '}
                    {MODE_LABEL[offer.mode]} · {offer.driver.username}
                  </AppText>
                </View>
                <Badge
                  label={OFFER_STATUS_LABEL[offer.status] ?? offer.status}
                  tone={STATUS_TONE[offer.status] ?? 'neutral'}
                />
              </View>
              <View style={styles.wrap}>
                <Badge label={`${offer.seats_total} koltuk`} tone="neutral" />
                <Badge label={money(offer.price_per_seat_cents, offer.currency)} tone="primary" />
                <Badge label={BOOKING_MODE_LABEL[offer.booking_mode]} tone="neutral" />
                <Badge
                  label={`${offer.reservations.confirmed} onaylı / ${offer.reservations.requested} talep`}
                  tone="neutral"
                />
                <Badge
                  label={`${offer.vehicle.make} ${offer.vehicle.model} · ${offer.vehicle.plate}`}
                  tone="neutral"
                />
              </View>
              {canModerate && offer.status !== 'cancelled' && offer.status !== 'completed' ? (
                <View style={styles.wrap}>
                  <Button
                    label="İlanı iptal et"
                    size="sm"
                    variant="danger"
                    fullWidth={false}
                    loading={action.isPending}
                    onPress={() => run(offer, 'cancel')}
                  />
                  <Button
                    label="Sürücüyü askıya al"
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    loading={action.isPending}
                    onPress={() => run(offer, 'suspend_driver')}
                  />
                </View>
              ) : null}
            </AdminRow>
          ))}
          <Pager total={offers.data?.total ?? 0} limit={30} offset={offset} onChange={setOffset} />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Yolcu talepleri
// ---------------------------------------------------------------------------
function RequestsPanel({ canModerate }: { canModerate: boolean }) {
  const [status, setStatus] = useState('open');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const requests = useRideAdminRequests({
    status: status === 'all' ? null : status,
    query,
    offset,
  });
  const action = useRideAdminRequestAction();

  const run = (request: RideAdminRequest, kind: 'close' | 'expire') => {
    setNotice(null);
    action.mutate(
      { requestId: request.id, action: kind, reason: reason.trim() || 'Yönetici işlemi' },
      {
        onSuccess: () => setNotice('Talep güncellendi.'),
        onError: (cause) => setNotice(cause.message),
      },
    );
  };

  return (
    <AdminSection
      title="Yolcu talepleri"
      subtitle="Çift taraflı ilan modeli: yolcuların açtığı talepler ve süreleri"
      action={<Badge label={`${requests.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <View style={styles.wrap}>
        <FilterChips
          value={status}
          onChange={(next) => {
            setStatus(next);
            setOffset(0);
          }}
          options={[
            { key: 'open', label: 'Açık' },
            { key: 'matched', label: 'Eşleşti' },
            { key: 'closed', label: 'Kapandı' },
            { key: 'expired', label: 'Süresi doldu' },
            { key: 'all', label: 'Tümü' },
          ]}
        />
        <AdminField
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          placeholder="Şehir, güzergâh veya kullanıcı"
          width={240}
        />
      </View>
      <ReasonField value={reason} onChangeText={setReason} optional />
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {requests.isLoading ? (
        <LoadingBlock compact />
      ) : requests.isError ? (
        <ErrorBlock message={requests.error.message} onRetry={() => void requests.refetch()} />
      ) : (requests.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Bu filtrede yolcu talebi yok." />
      ) : (
        <View style={styles.stack}>
          {requests.data?.items.map((request) => (
            <AdminRow key={request.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {request.origin_label} → {request.dest_label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {request.origin_city} → {request.dest_city} · {request.passenger.username} ·{' '}
                    {dateText(request.earliest_depart)}
                  </AppText>
                </View>
                <Badge
                  label={request.status}
                  tone={request.status === 'open' ? 'success' : 'neutral'}
                />
              </View>
              <View style={styles.wrap}>
                <Badge label={`${request.party_size} kişi`} tone="neutral" />
                <Badge label={request.luggage} tone="neutral" />
                <Badge label={SCOPE_LABEL[request.scope]} tone="neutral" />
                <Badge label={`Son: ${formatShortDate(request.latest_depart)}`} tone="accent" />
                {Array.isArray(request.mandatory) && request.mandatory.length ? (
                  <Badge label={`${request.mandatory.length} zorunlu tercih`} tone="warning" />
                ) : null}
              </View>
              {request.notes ? (
                <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                  {request.notes}
                </AppText>
              ) : null}
              {canModerate && request.status === 'open' ? (
                <View style={styles.wrap}>
                  <Button
                    label="Talebi kapat"
                    size="sm"
                    variant="secondary"
                    fullWidth={false}
                    loading={action.isPending}
                    onPress={() => run(request, 'close')}
                  />
                  <Button
                    label="Süresi doldu"
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    loading={action.isPending}
                    onPress={() => run(request, 'expire')}
                  />
                </View>
              ) : null}
            </AdminRow>
          ))}
          <Pager
            total={requests.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Rezervasyonlar
// ---------------------------------------------------------------------------
function ReservationsPanel({ canModerate }: { canModerate: boolean }) {
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const reservations = useRideAdminReservations({
    status: status === 'all' ? null : status,
    query,
    offset,
  });
  const action = useRideAdminReservationAction();

  const cancel = (reservation: RideAdminReservation) => {
    if (reason.trim().length < 5) {
      setNotice('İptal için gerekçe zorunlu.');
      return;
    }
    setNotice(null);
    action.mutate(
      { reservationId: reservation.id, reason: reason.trim() },
      {
        onSuccess: (result) =>
          setNotice(
            result.refund_requested_cents > 0
              ? `İptal edildi. ${money(result.refund_requested_cents)} iade talebi oluşturuldu.`
              : 'Rezervasyon iptal edildi.',
          ),
        onError: (cause) => setNotice(cause.message),
      },
    );
  };

  return (
    <AdminSection
      title="Rezervasyonlar"
      subtitle="Koltuk tahsisi, ödeme durumu ve uyuşmazlık bağlantısı"
      action={<Badge label={`${reservations.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <View style={styles.wrap}>
        <FilterChips
          value={status}
          onChange={(next) => {
            setStatus(next);
            setOffset(0);
          }}
          options={[
            { key: 'all', label: 'Tümü' },
            { key: 'requested', label: 'Talep' },
            { key: 'confirmed', label: 'Onaylı' },
            { key: 'started', label: 'Yolda' },
            { key: 'completed', label: 'Tamamlandı' },
            { key: 'cancelled', label: 'İptal' },
            { key: 'disputed', label: 'Uyuşmazlık' },
          ]}
        />
        <AdminField
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          placeholder="Yolcu, sürücü veya güzergâh"
          width={230}
        />
      </View>
      <ReasonField value={reason} onChangeText={setReason} />
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {reservations.isLoading ? (
        <LoadingBlock compact />
      ) : reservations.isError ? (
        <ErrorBlock
          message={reservations.error.message}
          onRetry={() => void reservations.refetch()}
        />
      ) : (reservations.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Bu filtrede rezervasyon yok." />
      ) : (
        <View style={styles.stack}>
          {reservations.data?.items.map((reservation) => (
            <AdminRow key={reservation.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {reservation.origin_label} → {reservation.dest_label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {dateText(reservation.depart_at)} · {reservation.passenger.username} →{' '}
                    {reservation.driver.username}
                  </AppText>
                </View>
                <Badge
                  label={RESERVATION_STATUS_LABEL[reservation.status] ?? reservation.status}
                  tone={STATUS_TONE[reservation.status] ?? 'neutral'}
                />
              </View>
              <View style={styles.wrap}>
                <Badge label={`${reservation.seats} koltuk`} tone="neutral" />
                <Badge
                  label={money(reservation.total_cents, reservation.currency)}
                  tone="primary"
                />
                <Badge
                  label={reservation.payment_method === 'card' ? 'Kart' : 'Yolculukta'}
                  tone="neutral"
                />
                <Badge
                  label={reservation.payment_status}
                  tone={
                    reservation.payment_status === 'paid'
                      ? 'success'
                      : reservation.payment_status === 'refunded'
                        ? 'accent'
                        : 'neutral'
                  }
                />
                {reservation.has_open_dispute ? (
                  <Badge label="Açık uyuşmazlık" tone="danger" />
                ) : null}
                {reservation.pickup_label ? (
                  <Badge label={reservation.pickup_label} tone="neutral" />
                ) : null}
              </View>
              {canModerate &&
              ['requested', 'awaiting_approval', 'confirmed', 'started'].includes(
                reservation.status,
              ) ? (
                <Button
                  label="Rezervasyonu iptal et"
                  size="sm"
                  variant="danger"
                  fullWidth={false}
                  loading={action.isPending}
                  onPress={() => cancel(reservation)}
                />
              ) : null}
            </AdminRow>
          ))}
          <Pager
            total={reservations.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Bekleme listeleri
// ---------------------------------------------------------------------------
function WaitlistsPanel() {
  const [status, setStatus] = useState('waiting');
  const [offset, setOffset] = useState(0);
  const waitlists = useRideAdminWaitlists({ status: status === 'all' ? null : status, offset });

  return (
    <AdminSection
      title="Bekleme listeleri"
      subtitle="Adil sıra, süreli teklif ve segment uygunluğu"
      action={<Badge label={`${waitlists.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <FilterChips
        value={status}
        onChange={(next) => {
          setStatus(next);
          setOffset(0);
        }}
        options={[
          { key: 'waiting', label: 'Bekliyor' },
          { key: 'offered', label: 'Teklif' },
          { key: 'converted', label: 'Rezervasyon' },
          { key: 'expired', label: 'Süresi doldu' },
          { key: 'left', label: 'Ayrıldı' },
          { key: 'all', label: 'Tümü' },
        ]}
      />
      {waitlists.isLoading ? (
        <LoadingBlock compact />
      ) : waitlists.isError ? (
        <ErrorBlock message={waitlists.error.message} onRetry={() => void waitlists.refetch()} />
      ) : (waitlists.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Bu filtrede bekleme kaydı yok." />
      ) : (
        <View style={styles.stack}>
          {waitlists.data?.items.map((item) => (
            <AdminRow key={item.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {item.offer.origin_label} → {item.offer.dest_label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {item.user.username} · Sıra {item.position} · {dateText(item.offer.depart_at)}
                  </AppText>
                </View>
                <Badge
                  label={item.status}
                  tone={
                    item.status === 'waiting'
                      ? 'warning'
                      : item.status === 'offered'
                        ? 'accent'
                        : 'neutral'
                  }
                />
              </View>
              <View style={styles.wrap}>
                <Badge label={`${item.seats} koltuk`} tone="neutral" />
                <Badge label={`Segment ${item.pickup_seq}-${item.dropoff_seq}`} tone="neutral" />
                {item.user.is_verified ? (
                  <Badge label="Kimlik doğrulandı" tone="success" />
                ) : (
                  <Badge label="Doğrulanmadı" tone="danger" />
                )}
                {item.active_offer ? (
                  <Badge
                    label={`Teklif ${formatShortDate(item.active_offer.expires_at)}`}
                    tone="accent"
                  />
                ) : null}
              </View>
            </AdminRow>
          ))}
          <Pager
            total={waitlists.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Doğrulamalar
// ---------------------------------------------------------------------------
function VerificationsPanel() {
  const [status, setStatus] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const verifications = useRideAdminVerifications({
    status: status === 'all' ? null : status,
    offset,
  });
  const decide = useRideAdminVerificationDecide();
  const driverDecide = useRideAdminDriverDecide();
  const openDoc = useRideDocumentOpener();

  const openDocument = async (verification: RideAdminVerification) => {
    const label =
      VERIFICATION_LABEL[verification.kind as keyof typeof VERIFICATION_LABEL] ?? verification.kind;
    const failure = await openDoc(
      verification.document_path,
      `${label} · ${verification.user.username}`,
    );
    if (failure) {
      setNotice(failure);
    }
  };

  const submit = (verification: RideAdminVerification, approve: boolean) => {
    setNotice(null);
    decide.mutate(
      {
        verificationId: verification.id,
        approve,
        reason: approve ? null : reason.trim() || 'Belge doğrulanamadı.',
      },
      {
        onSuccess: () => setNotice(approve ? 'Belge onaylandı.' : 'Belge reddedildi.'),
        onError: (cause) => setNotice(cause.message),
      },
    );
  };

  return (
    <AdminSection
      title="Kimlik ve belge doğrulamaları"
      subtitle="Belgeler yalnızca ride.verify izniyle açılır; bağlantı 2 dakika geçerlidir"
      action={<Badge label={`${verifications.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <FilterChips
        value={status}
        onChange={(next) => {
          setStatus(next);
          setOffset(0);
        }}
        options={[
          { key: 'pending', label: 'İnceleniyor' },
          { key: 'approved', label: 'Onaylı' },
          { key: 'rejected', label: 'Reddedildi' },
          { key: 'expired', label: 'Süresi doldu' },
          { key: 'all', label: 'Tümü' },
        ]}
      />
      <ReasonField
        value={reason}
        onChangeText={setReason}
        placeholder="Ret veya askıya alma gerekçesi"
      />
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {verifications.isLoading ? (
        <LoadingBlock compact />
      ) : verifications.isError ? (
        <ErrorBlock
          message={verifications.error.message}
          onRetry={() => void verifications.refetch()}
        />
      ) : (verifications.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Kuyrukta doğrulama yok." />
      ) : (
        <View style={styles.stack}>
          {verifications.data?.items.map((verification) => (
            <AdminRow key={verification.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {verification.user.first_name ?? verification.user.username} ·{' '}
                    {VERIFICATION_LABEL[verification.kind as keyof typeof VERIFICATION_LABEL] ??
                      verification.kind}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    Gönderim {formatShortDate(verification.created_at)} · Kimlik:{' '}
                    {verification.user.identity_status} · Sürücü: {verification.user.driver_status}
                  </AppText>
                </View>
                <Badge
                  label={verification.status}
                  tone={
                    verification.status === 'approved'
                      ? 'success'
                      : verification.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                />
              </View>
              <View style={styles.wrap}>
                <Badge
                  label={`Doğrulanmış üye: ${verification.user.is_verified ? 'evet' : 'hayır'}`}
                  tone={verification.user.is_verified ? 'success' : 'neutral'}
                />
                {verification.expires_at ? (
                  <Badge
                    label={`Geçerlilik: ${formatShortDate(verification.expires_at)}`}
                    tone="neutral"
                  />
                ) : null}
                {verification.user.completed_trips != null ? (
                  <Badge label={`${verification.user.completed_trips} yolculuk`} tone="neutral" />
                ) : null}
              </View>
              {verification.reject_reason ? (
                <AppText variant="caption" color="danger">
                  Ret nedeni: {verification.reject_reason}
                </AppText>
              ) : null}
              <View style={styles.wrap}>
                <Button
                  label="Belgeyi aç"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => void openDocument(verification)}
                />
                {verification.status === 'pending' ? (
                  <>
                    <Button
                      label="Onayla"
                      size="sm"
                      variant="secondary"
                      fullWidth={false}
                      loading={decide.isPending}
                      onPress={() => submit(verification, true)}
                    />
                    <Button
                      label="Reddet"
                      size="sm"
                      variant="danger"
                      fullWidth={false}
                      loading={decide.isPending}
                      onPress={() => submit(verification, false)}
                    />
                  </>
                ) : null}
                <Button
                  label="Sürücülüğü onayla"
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  loading={driverDecide.isPending}
                  disabled={
                    verification.user.identity_status !== 'approved' ||
                    verification.user.driver_status === 'approved'
                  }
                  onPress={() =>
                    driverDecide.mutate(
                      { userId: verification.user.id, approve: true },
                      {
                        onSuccess: () => setNotice('Sürücü başvurusu onaylandı.'),
                        onError: (cause) => setNotice(cause.message),
                      },
                    )
                  }
                />
              </View>
            </AdminRow>
          ))}
          <Pager
            total={verifications.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Sürücü başvuruları
// ---------------------------------------------------------------------------
function DriverApplicationsPanel() {
  const [status, setStatus] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const applications = useRideAdminDriverApplications({ status, offset });
  const decide = useRideAdminDriverDecide();

  const run = (userId: string, approve: boolean) => {
    if (!approve && reason.trim().length < 5) {
      setNotice('Ret için en az 5 karakterlik gerekçe girin.');
      return;
    }
    setNotice(null);
    decide.mutate(
      { userId, approve, reason: approve ? undefined : reason.trim() },
      {
        onSuccess: () => {
          setNotice(
            approve
              ? 'Sürücü başvurusu onaylandı. Kullanıcı yetkileri açıldı.'
              : 'Sürücü başvurusu reddedildi.',
          );
          void applications.refetch();
        },
        onError: (cause) => setNotice(cause.message),
      },
    );
  };

  return (
    <AdminSection
      title="Sürücü başvuruları"
      subtitle="Onay için kimlik ve geçerli ehliyet yeterlidir. İlan yayınlamak için ayrıca onaylı bir araç (ruhsat + sigorta) gerekir."
      action={<Badge label={`${applications.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <FilterChips
        value={status}
        onChange={(next) => {
          setStatus(next);
          setOffset(0);
        }}
        options={[
          { key: 'pending', label: 'İnceleniyor' },
          { key: 'approved', label: 'Onaylı' },
          { key: 'rejected', label: 'Reddedildi' },
          { key: 'suspended', label: 'Askıda' },
          { key: 'all', label: 'Tümü' },
        ]}
      />
      <ReasonField
        value={reason}
        onChangeText={setReason}
        placeholder="Ret gerekçesi (onayda zorunlu değil)"
      />
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {applications.isLoading ? (
        <LoadingBlock compact />
      ) : applications.isError ? (
        <ErrorBlock
          message={applications.error.message}
          onRetry={() => void applications.refetch()}
        />
      ) : (applications.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Bu filtrede sürücü başvurusu yok." />
      ) : (
        <View style={styles.stack}>
          {applications.data?.items.map((application) => (
            <AdminRow key={application.user_id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {application.user.first_name ?? application.user.username}
                    {application.user.last_name ? ` ${application.user.last_name}` : ''} · @
                    {application.user.username}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                    Başvuru {dateText(application.updated_at)}
                    {application.driver_bio ? ` · “${application.driver_bio}”` : ''}
                  </AppText>
                </View>
                <Badge
                  label={
                    VERIFICATION_STATUS_LABEL[application.driver_status] ??
                    application.driver_status
                  }
                  tone={
                    application.driver_status === 'approved'
                      ? 'success'
                      : application.driver_status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                />
              </View>
              <View style={styles.wrap}>
                <Badge
                  label={`Kimlik: ${application.identity_status}`}
                  tone={application.identity_status === 'approved' ? 'success' : 'warning'}
                />
                <Badge
                  label={`Ehliyet: ${application.license_ok ? 'onaylı' : 'eksik'}`}
                  tone={application.license_ok ? 'success' : 'danger'}
                />
                <Badge
                  label={`${application.vehicles.approved}/${application.vehicles.total} onaylı araç`}
                  tone={application.vehicles.approved > 0 ? 'success' : 'neutral'}
                />
                <Badge label={`${application.documents.length} belge`} tone="neutral" />
                {application.rating_avg ? (
                  <Badge label={`${application.rating_avg.toFixed(1)}★`} tone="accent" />
                ) : null}
                <Badge label={`${application.completed_trips} yolculuk`} tone="neutral" />
              </View>
              {application.driver_status !== 'approved' ? (
                <View style={styles.wrap}>
                  <Button
                    label="Sürücülüğü onayla"
                    size="sm"
                    variant="secondary"
                    fullWidth={false}
                    loading={decide.isPending}
                    disabled={application.identity_status !== 'approved' || !application.license_ok}
                    onPress={() => run(application.user_id, true)}
                  />
                  <Button
                    label="Reddet"
                    size="sm"
                    variant="danger"
                    fullWidth={false}
                    loading={decide.isPending}
                    disabled={reason.trim().length < 5}
                    onPress={() => run(application.user_id, false)}
                  />
                  {application.identity_status !== 'approved' || !application.license_ok ? (
                    <AppText variant="caption" color="textTertiary">
                      Onay için kimlik ve geçerli ehliyet onayı gerekir.
                    </AppText>
                  ) : null}
                </View>
              ) : null}
            </AdminRow>
          ))}
          <Pager
            total={applications.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Araçlar
// ---------------------------------------------------------------------------
function VehiclesPanel() {
  const [status, setStatus] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const vehicles = useRideAdminVehicles({ status: status === 'all' ? null : status, offset });
  const decide = useRideAdminVehicleDecide();
  const docDecide = useRideAdminVehicleDocumentDecide();
  const openDoc = useRideDocumentOpener();

  return (
    <AdminSection
      title="Araç ve garaj"
      subtitle="Kapasite, erişilebilirlik ve zorunlu belgeler"
      action={<Badge label={`${vehicles.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <FilterChips
        value={status}
        onChange={(next) => {
          setStatus(next);
          setOffset(0);
        }}
        options={[
          { key: 'pending', label: 'Onay bekliyor' },
          { key: 'approved', label: 'Onaylı' },
          { key: 'rejected', label: 'Reddedildi' },
          { key: 'suspended', label: 'Askıda' },
          { key: 'all', label: 'Tümü' },
        ]}
      />
      <ReasonField value={reason} onChangeText={setReason} />
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {vehicles.isLoading ? (
        <LoadingBlock compact />
      ) : vehicles.isError ? (
        <ErrorBlock message={vehicles.error.message} onRetry={() => void vehicles.refetch()} />
      ) : (vehicles.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Bu filtrede araç yok." />
      ) : (
        <View style={styles.stack}>
          {vehicles.data?.items.map((vehicle) => (
            <VehicleRow
              key={vehicle.id}
              vehicle={vehicle}
              reason={reason}
              busy={decide.isPending || docDecide.isPending}
              onDecide={(approve) =>
                decide.mutate(
                  {
                    vehicleId: vehicle.id,
                    approve,
                    reason: approve ? undefined : reason.trim() || 'Araç koşulları karşılamıyor.',
                  },
                  {
                    onSuccess: () => setNotice(approve ? 'Araç onaylandı.' : 'Araç reddedildi.'),
                    onError: (cause) => setNotice(cause.message),
                  },
                )
              }
              onDocument={(documentId, approve) =>
                docDecide.mutate(
                  {
                    documentId,
                    approve,
                    reason: approve ? null : reason.trim() || 'Belge geçersiz.',
                  },
                  {
                    onSuccess: () => setNotice('Belge kararı kaydedildi.'),
                    onError: (cause) => setNotice(cause.message),
                  },
                )
              }
              onOpenDocument={async (path) => {
                const failure = await openDoc(
                  path,
                  `${vehicle.make} ${vehicle.model} · ${vehicle.plate}`,
                );
                if (failure) {
                  setNotice(failure);
                }
              }}
            />
          ))}
          <Pager
            total={vehicles.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

function VehicleRow({
  vehicle,
  reason,
  busy,
  onDecide,
  onDocument,
  onOpenDocument,
}: {
  vehicle: RideAdminVehicle;
  reason: string;
  busy: boolean;
  onDecide: (approve: boolean) => void;
  onDocument: (documentId: string, approve: boolean) => void;
  onOpenDocument: (path: string) => Promise<void>;
}) {
  return (
    <AdminRow>
      <View style={styles.rowHead}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {vehicle.make} {vehicle.model} · {vehicle.plate}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {vehicle.year} · {vehicle.color} · {vehicle.seat_capacity} koltuk · {vehicle.fuel_type}{' '}
            · {vehicle.owner.username}
          </AppText>
        </View>
        <Badge
          label={vehicle.status}
          tone={
            vehicle.status === 'approved'
              ? 'success'
              : vehicle.status === 'rejected'
                ? 'danger'
                : 'warning'
          }
        />
      </View>
      <View style={styles.wrap}>
        <Badge label={vehicle.has_ac ? 'Klima' : 'Klima yok'} tone="neutral" />
        <Badge label={`Bagaj: ${vehicle.luggage_capacity}`} tone="neutral" />
        <Badge
          label={vehicle.owner.identity_status === 'approved' ? 'Kimlik onaylı' : 'Kimlik eksik'}
          tone={vehicle.owner.identity_status === 'approved' ? 'success' : 'danger'}
        />
      </View>
      {vehicle.documents.map((document) => (
        <View key={document.id} style={[styles.docRow, { borderColor: '#E5E7EB' }]}>
          <View style={styles.flex}>
            <AppText variant="caption" numberOfLines={1}>
              {document.kind} · {document.status}
              {document.expires_at ? ` · ${formatShortDate(document.expires_at)}` : ''}
            </AppText>
          </View>
          <Button
            label="Belge"
            size="sm"
            variant="ghost"
            fullWidth={false}
            onPress={() => void onOpenDocument(document.document_path)}
          />
          {document.status === 'pending' ? (
            <>
              <Button
                label="Onay"
                size="sm"
                variant="secondary"
                fullWidth={false}
                loading={busy}
                onPress={() => onDocument(document.id, true)}
              />
              <Button
                label="Ret"
                size="sm"
                variant="danger"
                fullWidth={false}
                loading={busy}
                onPress={() => onDocument(document.id, false)}
              />
            </>
          ) : null}
        </View>
      ))}
      {vehicle.status === 'pending' ? (
        <View style={styles.wrap}>
          <Button
            label="Aracı onayla"
            size="sm"
            variant="secondary"
            fullWidth={false}
            loading={busy}
            onPress={() => onDecide(true)}
          />
          <Button
            label="Aracı reddet"
            size="sm"
            variant="danger"
            fullWidth={false}
            loading={busy}
            disabled={reason.trim().length < 5}
            onPress={() => onDecide(false)}
          />
        </View>
      ) : null}
    </AdminRow>
  );
}

// ---------------------------------------------------------------------------
// Uyuşmazlıklar
// ---------------------------------------------------------------------------
function DisputesPanel() {
  const [status, setStatus] = useState('open');
  const [offset, setOffset] = useState(0);
  const [resolution, setResolution] = useState('');
  const [refund, setRefund] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const disputes = useRideAdminDisputes({ status: status === 'all' ? null : status, offset });
  const decide = useRideAdminDisputeDecide();

  const resolve = (disputeId: string, next: 'reviewing' | 'resolved' | 'rejected') => {
    if (next !== 'reviewing' && resolution.trim().length < 5) {
      setNotice('Karar için açıklama girin.');
      return;
    }
    const cents = refund.trim() ? Math.round(Number(refund.replace(',', '.')) * 100) : 0;
    if (Number.isNaN(cents) || cents < 0) {
      setNotice('İade tutarı geçersiz.');
      return;
    }
    setNotice(null);
    decide.mutate(
      {
        disputeId,
        status: next,
        resolution: resolution.trim() || 'İnceleme başlatıldı.',
        refundCents: cents,
      },
      {
        onSuccess: () => setNotice('Uyuşmazlık kararı kaydedildi.'),
        onError: (cause) => setNotice(cause.message),
      },
    );
  };

  return (
    <AdminSection
      title="Şikâyet ve uyuşmazlık"
      subtitle="İade kararı ödeme sağlayıcısı onayı olmadan kesinleşmez"
      action={<Badge label={`${disputes.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <FilterChips
        value={status}
        onChange={(next) => {
          setStatus(next);
          setOffset(0);
        }}
        options={[
          { key: 'open', label: 'Açık' },
          { key: 'reviewing', label: 'İnceleniyor' },
          { key: 'resolved', label: 'Çözüldü' },
          { key: 'rejected', label: 'Reddedildi' },
          { key: 'all', label: 'Tümü' },
        ]}
      />
      <View style={styles.wrap}>
        <AdminField
          value={resolution}
          onChangeText={setResolution}
          placeholder="Karar açıklaması"
          flex
        />
        <AdminField value={refund} onChangeText={setRefund} placeholder="İade ₺" width={110} />
      </View>
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {disputes.isLoading ? (
        <LoadingBlock compact />
      ) : disputes.isError ? (
        <ErrorBlock message={disputes.error.message} onRetry={() => void disputes.refetch()} />
      ) : (disputes.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Bu filtrede uyuşmazlık yok." />
      ) : (
        <View style={styles.stack}>
          {disputes.data?.items.map((dispute) => (
            <AdminRow key={dispute.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {dispute.category} · {dispute.reservation.origin_label} →{' '}
                    {dispute.reservation.dest_label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {dispute.opened_by.username} · {dateText(dispute.created_at)} ·{' '}
                    {money(dispute.reservation.total_cents)}
                  </AppText>
                </View>
                <Badge
                  label={dispute.status}
                  tone={
                    dispute.status === 'open'
                      ? 'danger'
                      : dispute.status === 'resolved'
                        ? 'success'
                        : 'warning'
                  }
                />
              </View>
              <AppText variant="caption" color="textSecondary" numberOfLines={3}>
                {dispute.description}
              </AppText>
              {dispute.resolution ? (
                <AppText variant="caption" color="textTertiary">
                  Karar: {dispute.resolution}
                </AppText>
              ) : null}
              <View style={styles.wrap}>
                <Badge label={`Talep edilen iade: ${money(dispute.refund_cents)}`} tone="neutral" />
                <Badge
                  label={`Ödeme: ${dispute.reservation.payment_status}`}
                  tone={dispute.reservation.payment_status === 'paid' ? 'success' : 'neutral'}
                />
              </View>
              <View style={styles.wrap}>
                <Button
                  label="İncelemeye al"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  loading={decide.isPending}
                  onPress={() => resolve(dispute.id, 'reviewing')}
                />
                <Button
                  label="Çöz"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  loading={decide.isPending}
                  onPress={() => resolve(dispute.id, 'resolved')}
                />
                <Button
                  label="Reddet"
                  size="sm"
                  variant="danger"
                  fullWidth={false}
                  loading={decide.isPending}
                  onPress={() => resolve(dispute.id, 'rejected')}
                />
              </View>
            </AdminRow>
          ))}
          <Pager
            total={disputes.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Güvenlik olayları
// ---------------------------------------------------------------------------
function IncidentsPanel() {
  const [status, setStatus] = useState('open');
  const [offset, setOffset] = useState(0);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const incidents = useRideAdminIncidents({ status: status === 'all' ? null : status, offset });
  const action = useRideAdminIncidentAction();

  return (
    <AdminSection
      title="Güvenlik olayları"
      subtitle="SOS, rota sapması ve acil olay kayıtları; erişim ride.safety ile sınırlı"
      action={<Badge label={`${incidents.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <FilterChips
        value={status}
        onChange={(next) => {
          setStatus(next);
          setOffset(0);
        }}
        options={[
          { key: 'open', label: 'Açık' },
          { key: 'acknowledged', label: 'Alındı' },
          { key: 'resolved', label: 'Çözüldü' },
          { key: 'all', label: 'Tümü' },
        ]}
      />
      <AdminField value={note} onChangeText={setNote} placeholder="Müdahale notu" flex />
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {incidents.isLoading ? (
        <LoadingBlock compact />
      ) : incidents.isError ? (
        <ErrorBlock message={incidents.error.message} onRetry={() => void incidents.refetch()} />
      ) : (incidents.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Açık güvenlik olayı yok." />
      ) : (
        <View style={styles.stack}>
          {incidents.data?.items.map((incident) => (
            <AdminRow key={incident.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {incident.kind} · {incident.severity} · {incident.user.username}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {dateText(incident.created_at)}
                    {incident.offer
                      ? ` · ${incident.offer.origin_label} → ${incident.offer.dest_label}`
                      : ''}
                  </AppText>
                </View>
                <Badge
                  label={incident.status}
                  tone={
                    incident.severity === 'critical'
                      ? 'danger'
                      : incident.status === 'resolved'
                        ? 'success'
                        : 'warning'
                  }
                />
              </View>
              {incident.note ? (
                <AppText variant="caption" color="textSecondary" numberOfLines={3}>
                  {incident.note}
                </AppText>
              ) : null}
              <View style={styles.wrap}>
                {incident.lat != null && incident.lng != null ? (
                  <Badge
                    label={`${incident.lat.toFixed(4)}, ${incident.lng.toFixed(4)}`}
                    tone="neutral"
                  />
                ) : null}
                <Button
                  label="Alındı"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  loading={action.isPending}
                  onPress={() =>
                    action.mutate(
                      {
                        incidentId: incident.id,
                        status: 'acknowledged',
                        note: note.trim() || undefined,
                      },
                      {
                        onSuccess: () => setNotice('Olay alındı olarak işaretlendi.'),
                        onError: (cause) => setNotice(cause.message),
                      },
                    )
                  }
                />
                <Button
                  label="Çözüldü"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  loading={action.isPending}
                  onPress={() =>
                    action.mutate(
                      {
                        incidentId: incident.id,
                        status: 'resolved',
                        note: note.trim() || undefined,
                      },
                      {
                        onSuccess: () => setNotice('Olay çözüldü.'),
                        onError: (cause) => setNotice(cause.message),
                      },
                    )
                  }
                />
              </View>
            </AdminRow>
          ))}
          <Pager
            total={incidents.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Finans
// ---------------------------------------------------------------------------
function FinancePanel() {
  const finance = useRideAdminFinance();
  const refundDecide = useRideAdminRefundDecide();
  const [notice, setNotice] = useState<string | null>(null);
  const data = finance.data;

  if (finance.isLoading) return <LoadingBlock />;
  if (finance.isError)
    return <ErrorBlock message={finance.error.message} onRetry={() => void finance.refetch()} />;
  if (!data) return null;

  return (
    <View style={styles.stack}>
      <StatGrid>
        <StatCard
          label="Doğrulanmış tahsilat"
          value={money(data.totals.verified_paid_cents)}
          icon="shield-checkmark-outline"
          tone="success"
        />
        <StatCard
          label="Yetkilendirilmiş"
          value={money(data.totals.authorized_cents)}
          icon="card-outline"
        />
        <StatCard
          label="İade talebi"
          value={money(data.totals.refund_requested_cents)}
          icon="return-down-back-outline"
          tone="warning"
        />
        <StatCard
          label="Tamamlanan iade"
          value={money(data.totals.refund_completed_cents)}
          icon="checkmark-done-outline"
        />
        <StatCard
          label="Nakit bildirimi"
          value={money(data.totals.cash_reported_cents)}
          icon="cash-outline"
          tone="accent"
        />
        <StatCard
          label="Sağlayıcı hazır"
          value={data.provider_ready ? 'Evet' : 'Hayır'}
          icon="cloud-done-outline"
          tone={data.provider_ready ? 'success' : 'danger'}
        />
      </StatGrid>
      <AdminSection title="Ödeme sağlayıcısı" subtitle={data.note}>
        <AppText variant="caption" color="textTertiary">
          Kart verisi veritabanında saklanmaz. Sağlayıcı webhook onayı olmadan hiçbir ödeme
          “başarılı” sayılmaz; kısmi iade yalnızca sağlayıcı kaydıyla işlenir.
        </AppText>
      </AdminSection>

      <AdminSection
        title="İade kuyruğu"
        subtitle="Onay ödeme sağlayıcısına iletilir"
        action={
          <Badge
            label={`${data.refunds.filter((r) => r.status === 'requested').length} bekliyor`}
            tone="warning"
          />
        }
      >
        {notice ? (
          <AppText variant="caption" color="primaryDeep">
            {notice}
          </AppText>
        ) : null}
        {data.refunds.length === 0 ? (
          <EmptyBlock text="İade kaydı yok." />
        ) : (
          data.refunds.map((refund) => (
            <AdminRow key={refund.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">
                    {money(refund.amount_cents)} · {refund.reason}
                  </AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatShortDate(refund.created_at)} · {refund.status}
                  </AppText>
                </View>
                <Badge
                  label={refund.status}
                  tone={
                    refund.status === 'succeeded'
                      ? 'success'
                      : refund.status === 'requested'
                        ? 'warning'
                        : 'neutral'
                  }
                />
              </View>
              {refund.status === 'requested' ? (
                <View style={styles.wrap}>
                  <Button
                    label="Onayla"
                    size="sm"
                    variant="secondary"
                    fullWidth={false}
                    loading={refundDecide.isPending}
                    onPress={() =>
                      refundDecide.mutate(
                        { refundId: refund.id, approve: true, reason: 'Yönetici onayı' },
                        {
                          onSuccess: (result) => setNotice(result.note),
                          onError: (cause) => setNotice(cause.message),
                        },
                      )
                    }
                  />
                  <Button
                    label="Reddet"
                    size="sm"
                    variant="danger"
                    fullWidth={false}
                    loading={refundDecide.isPending}
                    onPress={() =>
                      refundDecide.mutate(
                        { refundId: refund.id, approve: false, reason: 'Koşullar karşılanmadı' },
                        {
                          onSuccess: (result) => setNotice(result.note),
                          onError: (cause) => setNotice(cause.message),
                        },
                      )
                    }
                  />
                </View>
              ) : null}
            </AdminRow>
          ))
        )}
      </AdminSection>

      <AdminSection title="Ödeme işlemleri" subtitle="Son 100 sağlayıcı kaydı">
        {data.payments.length === 0 ? (
          <EmptyBlock text="Ödeme kaydı yok." />
        ) : (
          data.payments.map((payment) => (
            <View key={payment.id} style={styles.docRow}>
              <View style={styles.flex}>
                <AppText variant="caption" numberOfLines={1}>
                  {payment.payer.username} · {money(payment.amount_cents, payment.currency)} ·{' '}
                  {payment.provider}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {formatShortDate(payment.created_at)} · {payment.status}
                  {payment.failure_code ? ` · ${payment.failure_code}` : ''}
                </AppText>
              </View>
              <Badge
                label={payment.status}
                tone={
                  payment.status === 'succeeded'
                    ? 'success'
                    : payment.status === 'failed'
                      ? 'danger'
                      : 'neutral'
                }
              />
            </View>
          ))
        )}
      </AdminSection>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Değerlendirmeler
// ---------------------------------------------------------------------------
function ReviewsPanel() {
  const [status, setStatus] = useState('published');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const reviews = useRideAdminReviews({ status: status === 'all' ? null : status, query, offset });
  const moderate = useRideAdminReviewModerate();

  return (
    <AdminSection
      title="Değerlendirmeler"
      subtitle="Sahte değerlendirme ve topluluk kuralı ihlali incelemesi"
      action={<Badge label={`${reviews.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <View style={styles.wrap}>
        <FilterChips
          value={status}
          onChange={(next) => {
            setStatus(next);
            setOffset(0);
          }}
          options={[
            { key: 'published', label: 'Yayında' },
            { key: 'hidden', label: 'Gizli' },
            { key: 'all', label: 'Tümü' },
          ]}
        />
        <AdminField
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          placeholder="Kullanıcı veya yorum"
          width={220}
        />
      </View>
      <ReasonField
        value={reason}
        onChangeText={setReason}
        placeholder="Yayından kaldırma gerekçesi"
      />
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}

      {reviews.isLoading ? (
        <LoadingBlock compact />
      ) : reviews.isError ? (
        <ErrorBlock message={reviews.error.message} onRetry={() => void reviews.refetch()} />
      ) : (reviews.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Bu filtrede değerlendirme yok." />
      ) : (
        <View style={styles.stack}>
          {reviews.data?.items.map((review) => (
            <AdminRow key={review.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {review.author.username} → {review.subject.username} · {review.rating}★
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {review.reservation.origin_label} → {review.reservation.dest_label} ·{' '}
                    {formatShortDate(review.created_at)}
                  </AppText>
                </View>
                <Badge
                  label={review.status}
                  tone={review.status === 'published' ? 'success' : 'neutral'}
                />
              </View>
              {review.comment ? (
                <AppText variant="caption" color="textSecondary" numberOfLines={3}>
                  {review.comment}
                </AppText>
              ) : null}
              <View style={styles.wrap}>
                <Badge
                  label={review.author_role === 'driver' ? 'Sürücü yorumu' : 'Yolcu yorumu'}
                  tone="neutral"
                />
                {review.status === 'published' ? (
                  <Button
                    label="Yayından kaldır"
                    size="sm"
                    variant="danger"
                    fullWidth={false}
                    disabled={reason.trim().length < 5}
                    loading={moderate.isPending}
                    onPress={() =>
                      moderate.mutate(
                        { reviewId: review.id, hide: true, reason: reason.trim() },
                        {
                          onSuccess: () => setNotice('Değerlendirme gizlendi.'),
                          onError: (cause) => setNotice(cause.message),
                        },
                      )
                    }
                  />
                ) : (
                  <Button
                    label="Yeniden yayınla"
                    size="sm"
                    variant="secondary"
                    fullWidth={false}
                    loading={moderate.isPending}
                    onPress={() =>
                      moderate.mutate(
                        { reviewId: review.id, hide: false, reason: 'İnceleme sonucu uygun' },
                        {
                          onSuccess: () => setNotice('Değerlendirme yayınlandı.'),
                          onError: (cause) => setNotice(cause.message),
                        },
                      )
                    }
                  />
                )}
              </View>
            </AdminRow>
          ))}
          <Pager total={reviews.data?.total ?? 0} limit={30} offset={offset} onChange={setOffset} />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Düzenli planlar
// ---------------------------------------------------------------------------
function RecurringPanel() {
  const [active, setActive] = useState<'active' | 'inactive' | 'all'>('active');
  const [offset, setOffset] = useState(0);
  const recurring = useRideAdminRecurring({
    active: active === 'all' ? null : active === 'active',
    offset,
  });

  return (
    <AdminSection
      title="Düzenli yolculuklar"
      subtitle="Haftalık planlar, duraklatmalar ve üretilen ilanlar"
      action={<Badge label={`${recurring.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <FilterChips
        value={active}
        onChange={(next) => {
          setActive(next);
          setOffset(0);
        }}
        options={[
          { key: 'active', label: 'Aktif' },
          { key: 'inactive', label: 'Pasif' },
          { key: 'all', label: 'Tümü' },
        ]}
      />
      {recurring.isLoading ? (
        <LoadingBlock compact />
      ) : recurring.isError ? (
        <ErrorBlock message={recurring.error.message} onRetry={() => void recurring.refetch()} />
      ) : (recurring.data?.items.length ?? 0) === 0 ? (
        <EmptyBlock text="Düzenli plan yok." />
      ) : (
        <View style={styles.stack}>
          {recurring.data?.items.map((plan) => (
            <AdminRow key={plan.id}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {plan.origin_label} → {plan.dest_label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {plan.user.username} · {plan.role} · {plan.depart_time.slice(0, 5)}
                    {plan.return_time ? ` / ${plan.return_time.slice(0, 5)}` : ''}
                  </AppText>
                </View>
                <Badge
                  label={plan.is_active ? 'Aktif' : 'Pasif'}
                  tone={plan.is_active ? 'success' : 'neutral'}
                />
              </View>
              <View style={styles.wrap}>
                <Badge
                  label={plan.weekdays.map((day) => WEEKDAY_NAMES[day - 1] ?? day).join(', ')}
                  tone="neutral"
                />
                <Badge label={SCOPE_LABEL[plan.scope]} tone="neutral" />
                <Badge label={`${plan.generated_offers} yaklaşan ilan`} tone="accent" />
                {plan.paused_dates.length ? (
                  <Badge label={`${plan.paused_dates.length} duraklatılmış gün`} tone="warning" />
                ) : null}
              </View>
            </AdminRow>
          ))}
          <Pager
            total={recurring.data?.total ?? 0}
            limit={30}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Kurallar
// ---------------------------------------------------------------------------
function SettingsPanel() {
  const settings = useRideAdminSettings();
  const save = useRideAdminSetSetting();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  if (settings.isLoading) return <LoadingBlock />;
  if (settings.isError)
    return <ErrorBlock message={settings.error.message} onRetry={() => void settings.refetch()} />;

  const data = settings.data;

  return (
    <AdminSection
      title="Yolculuk kuralları"
      subtitle="Yalnızca yönetici tarafından değiştirilebilen iş kuralları; güvenlik kuralları kilitlidir"
      action={<Badge label={`${data?.editable_keys.length ?? 0} düzenlenebilir`} tone="neutral" />}
    >
      {notice ? (
        <AppText variant="caption" color="primaryDeep">
          {notice}
        </AppText>
      ) : null}
      {data?.items.map((item) => {
        const locked = data.locked_keys[item.key];
        const editable = data.editable_keys.includes(item.key);
        const current =
          draft[item.key] ??
          (typeof item.value === 'string' ? item.value : JSON.stringify(item.value));
        return (
          <View key={item.key} style={styles.settingRow}>
            <View style={styles.flex}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {item.key}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                {item.description ?? (item.is_public ? 'Herkese açık ayar' : 'Yalnızca yönetici')}
              </AppText>
            </View>
            {editable ? (
              <View style={styles.wrap}>
                <AdminField
                  value={current}
                  onChangeText={(value) => setDraft((prev) => ({ ...prev, [item.key]: value }))}
                  width={150}
                />
                <Button
                  label="Kaydet"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  loading={save.isPending}
                  onPress={() => {
                    const raw = (draft[item.key] ?? current).trim();
                    let parsed: unknown = raw;
                    try {
                      parsed = JSON.parse(raw);
                    } catch {
                      parsed = raw;
                    }
                    save.mutate(
                      { key: item.key, value: parsed },
                      {
                        onSuccess: () =>
                          setNotice(`${item.key} güncellendi. Denetim kaydı oluşturuldu.`),
                        onError: (cause) => setNotice(cause.message),
                      },
                    );
                  }}
                />
              </View>
            ) : (
              <View style={styles.wrap}>
                <Badge label={current} tone="neutral" />
                {locked ? <Badge label="Kilitli" tone="warning" /> : null}
              </View>
            )}
          </View>
        );
      })}
      <AppText variant="caption" color="textTertiary">
        Ticari taşımacılık ve kartlı ödeme, gerekli hukuki ve teknik koşullar sağlanmadan açılamaz.
        Güvenlik kuralları panelden devre dışı bırakılamaz.
      </AppText>
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Analitik
// ---------------------------------------------------------------------------
function AnalyticsPanel() {
  const [days, setDays] = useState(30);
  const analytics = useRideAdminAnalytics(days);
  const { theme } = useTheme();
  const data = analytics.data;

  if (analytics.isLoading) return <LoadingBlock />;
  if (analytics.isError)
    return (
      <ErrorBlock message={analytics.error.message} onRetry={() => void analytics.refetch()} />
    );
  if (!data) return null;

  const offers = data.series.map((point) => ({
    label: point.date.slice(5).replace('-', '.'),
    value: point.offers,
  }));
  const completed = data.series.map((point) => ({
    label: point.date.slice(5).replace('-', '.'),
    value: point.completed,
  }));

  return (
    <View style={styles.stack}>
      <FilterChips
        value={String(days)}
        onChange={(next) => setDays(Number(next))}
        options={[
          { key: '7', label: '7 gün' },
          { key: '30', label: '30 gün' },
          { key: '90', label: '90 gün' },
        ]}
      />
      <StatGrid>
        <StatCard
          label="Üye"
          value={String(data.verification_funnel.members)}
          icon="people-outline"
          hint={`${data.verification_funnel.identity_approved} kimlik onaylı`}
        />
        <StatCard
          label="Onaylı sürücü"
          value={String(data.verification_funnel.drivers_approved)}
          icon="car-outline"
          hint={`${data.verification_funnel.vehicles_approved} onaylı araç`}
        />
        <StatCard
          label="Uyuşmazlık oranı"
          value={`${(data.dispute_rate * 100).toFixed(1)}%`}
          icon="git-compare-outline"
          tone={data.dispute_rate > 0.1 ? 'danger' : 'success'}
        />
      </StatGrid>

      <AdminSection title="Talep ve tamamlanma" subtitle={`Son ${data.days} gün`}>
        <View style={styles.wrap}>
          <View style={styles.chartBox}>
            <AppText variant="bodyStrong">Yeni ilan</AppText>
            <BarChart data={offers} color={theme.colors.primary} />
          </View>
          <View style={styles.chartBox}>
            <AppText variant="bodyStrong">Tamamlanan</AppText>
            <TrendChart data={completed} color={theme.colors.success} />
          </View>
        </View>
      </AdminSection>

      <AdminSection title="En yoğun güzergâhlar">
        {data.top_routes.length === 0 ? (
          <EmptyBlock text="Veri yok." />
        ) : (
          data.top_routes.map((route) => (
            <View key={`${route.origin}-${route.dest}`} style={styles.docRow}>
              <AppText variant="caption" style={styles.flex} numberOfLines={1}>
                {route.origin} → {route.dest}
              </AppText>
              <Badge label={`${route.trips} yolculuk`} tone="primary" />
            </View>
          ))
        )}
      </AdminSection>

      <AdminSection title="En aktif sürücüler">
        {data.top_drivers.length === 0 ? (
          <EmptyBlock text="Veri yok." />
        ) : (
          data.top_drivers.map((driver) => (
            <View key={driver.user_id} style={styles.docRow}>
              <AppText variant="caption" style={styles.flex} numberOfLines={1}>
                {driver.first_name ?? driver.username} · {driver.level}
              </AppText>
              <Badge label={`${driver.completed_trips} yolculuk`} tone="success" />
              <Badge
                label={driver.rating_avg ? `${driver.rating_avg.toFixed(1)}★` : '—'}
                tone="accent"
              />
            </View>
          ))
        )}
      </AdminSection>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Denetim
// ---------------------------------------------------------------------------
function AuditPanel() {
  const [offset, setOffset] = useState(0);
  const audit = useRideAdminAudit(offset);

  if (audit.isLoading) return <LoadingBlock />;
  if (audit.isError)
    return <ErrorBlock message={audit.error.message} onRetry={() => void audit.refetch()} />;

  const items = audit.data?.items ?? [];

  return (
    <AdminSection
      title="Yetki ve denetim kayıtları"
      subtitle="Değiştirilemez yolculuk işlem geçmişi"
    >
      {items.length === 0 ? (
        <EmptyBlock text="Denetim kaydı yok." />
      ) : (
        items.map((entry) => (
          <View key={entry.id} style={styles.docRow}>
            <View style={styles.flex}>
              <AppText variant="caption" numberOfLines={1}>
                {entry.action} · {entry.entity_type}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {formatDateTime(entry.created_at)} · {entry.actor?.username ?? 'sistem'}
              </AppText>
            </View>
            <Badge label={entry.entity_id ? entry.entity_id.slice(0, 8) : '—'} tone="neutral" />
          </View>
        ))
      )}
      <Pager
        total={offset + items.length + (items.length === 30 ? 30 : 0)}
        limit={30}
        offset={offset}
        onChange={setOffset}
      />
    </AdminSection>
  );
}

// ---------------------------------------------------------------------------
// Ortak bileşenler
// ---------------------------------------------------------------------------
function AdminRow({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      {children}
    </View>
  );
}

function AdminField({
  value,
  onChangeText,
  placeholder,
  width,
  flex,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  width?: number;
  flex?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textTertiary}
      style={[
        styles.input,
        {
          width: flex ? undefined : (width ?? 180),
          flex: flex ? 1 : undefined,
          color: theme.colors.text,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.inputBackground,
        },
      ]}
    />
  );
}

function ReasonField({
  value,
  onChangeText,
  placeholder = 'İşlem gerekçesi (denetim kaydına yazılır)',
  optional,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  optional?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <AdminField value={value} onChangeText={onChangeText} placeholder={placeholder} flex />
      {optional ? (
        <Badge label="Opsiyonel" tone="neutral" />
      ) : (
        <Badge label="Gerekçe zorunlu" tone="warning" />
      )}
    </View>
  );
}

function LoadingBlock({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.stack}>
      <Skeleton height={compact ? 40 : 20} width="40%" />
      <Skeleton height={compact ? 60 : 120} radius={12} />
      <Skeleton height={compact ? 60 : 120} radius={12} />
    </View>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
      <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
      <AppText variant="caption" color="danger" style={styles.flex}>
        {message}
      </AppText>
      <Button label="Yenile" size="sm" variant="outline" fullWidth={false} onPress={onRetry} />
    </View>
  );
}

function EmptyBlock({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.empty, { borderColor: theme.colors.border }]}>
      <Ionicons name="file-tray-outline" size={18} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textTertiary">
        {text}
      </AppText>
    </View>
  );
}

function Locked({ message }: { message: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.locked,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <Ionicons name="lock-closed-outline" size={22} color={theme.colors.textTertiary} />
      <AppText variant="body" color="textSecondary" align="center">
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: 10 },
  gap: { gap: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center' },
  row: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    height: 36,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    flexWrap: 'wrap',
  },
  chartBox: { flex: 1, minWidth: 280, gap: 6 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12 },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  locked: {
    alignItems: 'center',
    gap: 10,
    padding: 30,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
