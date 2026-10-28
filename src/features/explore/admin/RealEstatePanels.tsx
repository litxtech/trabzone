import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import {
  useAdminExploreMutation,
  useAdminExploreOverview,
  useAdminRealEstate,
  useAdminRealEstateMedia,
  useAdminVerifications,
  useExploreBootstrap,
} from '@/features/explore/hooks/use-explore';
import * as api from '@/features/explore/services/explore-service';
import type { AdminReRow, AdminVerificationRow } from '@/features/explore/types';
import { formatPrice } from '@/features/explore/utils/format';
import type { MapPoint } from '@/features/map/types';
import { publicMediaUrl } from '@/features/media/media-service';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminEmptyState, AdminMapPreview, AdminQueryState } from './AdminExploreShared';
import { RealEstateDetailModal } from './RealEstateDetailModal';
import {
  EIDS_LABELS,
  EIDS_TONES,
  formatDate,
  formatNumber,
  LISTING_KIND_LABELS,
  MODERATION_STATUS_LABELS,
  RE_STATUS_LABELS,
  RE_STATUS_TONES,
  statusLabel,
  toneFor,
  VERIFICATION_LABELS,
  VERIFICATION_TONES,
} from './labels';

const PAGE_SIZE = 25;
const MAP_LIMIT = 100;

type ViewMode = 'list' | 'map';

const VIEW_OPTIONS: { key: ViewMode; label: string }[] = [
  { key: 'list', label: 'Liste' },
  { key: 'map', label: 'Harita' },
];

function mapTone(status: string): MapPoint['tone'] {
  switch (status) {
    case 'published':
      return 'success';
    case 'pending':
      return 'warning';
    case 'rejected':
      return 'danger';
    case 'archived':
    case 'expired':
      return 'info';
    default:
      return 'primary';
  }
}

export function RealEstateOverviewPanel() {
  const query = useAdminExploreOverview();
  const data = query.data;
  const pendingQueue = data
    ? (data.queue.re_verifications ?? 0) +
      (data.queue.re_media ?? 0) +
      (data.queue.re_listings ?? 0) +
      (data.queue.re_reports ?? 0)
    : 0;

  return (
    <AdminQueryState
      loading={query.isLoading}
      error={query.isError ? query.error.message : null}
      onRetry={() => void query.refetch()}
    >
      {data ? (
        <>
          <StatGrid>
            <StatCard label="Toplam ilan" value={formatNumber(data.real_estate.total)} icon="home-outline" hint="Tüm durumlar" />
            <StatCard
              label="Yayında"
              value={formatNumber(data.real_estate.published)}
              icon="checkmark-done-outline"
              tone="success"
              hint="Haritada görünen doğrulanmış ilanlar"
            />
            <StatCard
              label="Doğrulama bekliyor"
              value={formatNumber(data.real_estate.pending)}
              icon="shield-outline"
              tone="warning"
              hint="Yayınlanamaz; EİDS incelemesi gerekir"
            />
            <StatCard label="Taslak" value={formatNumber(data.real_estate.draft)} icon="document-outline" hint="Sahibi tarafından tamamlanacak" />
            <StatCard
              label="Reddedilen"
              value={formatNumber(data.real_estate.rejected)}
              icon="close-circle-outline"
              tone={data.real_estate.rejected > 0 ? 'danger' : 'success'}
              hint={`${formatNumber(data.real_estate.expired)} süresi dolmuş ilan`}
            />
            <StatCard
              label="Bekleyen işlem"
              value={formatNumber(pendingQueue)}
              icon="layers-outline"
              tone={pendingQueue > 0 ? 'warning' : 'success'}
              hint="Doğrulama + medya + ilan + şikâyet"
            />
          </StatGrid>

          <AdminSection
            title="Emlak kuyrukları"
            subtitle="EİDS doğrulaması tamamlanmadan ve onaylı fotoğraf yüklenmeden ilan yayınlanamaz."
          >
            <View style={styles.queueRow}>
              <QueueStat label="EİDS doğrulama" value={data.queue.re_verifications ?? 0} icon="shield-checkmark-outline" />
              <QueueStat label="İlan moderasyonu" value={data.queue.re_listings ?? 0} icon="home-outline" />
              <QueueStat label="Medya" value={data.queue.re_media ?? 0} icon="images-outline" />
              <QueueStat label="Şikâyet" value={data.queue.re_reports ?? 0} icon="flag-outline" />
            </View>
          </AdminSection>

          <AdminSection title="EİDS entegrasyon durumu" subtitle="Bu anahtar kapalıyken doğrulama onayı ve yayınlama sunucuda engellenir.">
            <View style={styles.eidsRow}>
              <Badge label={data.eids_enabled ? 'EİDS etkin' : 'EİDS bağlı değil'} tone={data.eids_enabled ? 'success' : 'danger'} />
              <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
                {data.eids_enabled
                  ? 'Doğrulama kayıtları incelenebilir. Onay sonrası ilan yalnızca yetkili yayın izniyle yayınlanır.'
                  : 'Resmî EİDS entegrasyonu yapılandırılmadığı için doğrulama onaylanamaz ve ilan yayınlanamaz. Sahte doğrulama rozeti üretilmez.'}
              </AppText>
            </View>
          </AdminSection>
        </>
      ) : null}
    </AdminQueryState>
  );
}

function QueueStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.queueCard,
        {
          borderColor: value > 0 ? theme.colors.warning : theme.colors.border,
          backgroundColor: value > 0 ? theme.colors.warningSoft : theme.colors.surfaceMuted,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={value > 0 ? theme.colors.warning : theme.colors.textTertiary} />
      <View style={{ flex: 1 }}>
        <AppText variant="h3" color={value > 0 ? 'warning' : 'textTertiary'}>
          {formatNumber(value)}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {label}
        </AppText>
      </View>
    </View>
  );
}

type ReStatusFilter =
  | 'all'
  | 'pending_verification'
  | 'pending_moderation'
  | 'published'
  | 'draft'
  | 'rejected'
  | 'expired'
  | 'archived';

const RE_STATUS_OPTIONS: { key: ReStatusFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'pending_verification', label: 'Doğrulama bekliyor' },
  { key: 'pending_moderation', label: 'Moderasyon' },
  { key: 'published', label: 'Yayında' },
  { key: 'draft', label: 'Taslak' },
  { key: 'rejected', label: 'Reddedilen' },
  { key: 'expired', label: 'Süresi dolan' },
  { key: 'archived', label: 'Arşiv' },
];

export function RealEstateListingsPanel({
  canModerate,
  canPublish,
}: {
  canModerate: boolean;
  canPublish: boolean;
}) {
  const { theme } = useTheme();
  const bootstrap = useExploreBootstrap();
  const [status, setStatus] = useState<ReStatusFilter>('all');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 350);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const [detailId, setDetailId] = useState<string | null>(null);

  const query = useAdminRealEstate(
    {
      status: status === 'all' ? null : status,
      q: debounced.trim() || null,
      districtId,
      listingKind: kind,
      limit: view === 'map' ? MAP_LIMIT : PAGE_SIZE,
      offset: view === 'map' ? 0 : offset,
    },
    true,
  );

  const mapPoints = useMemo<MapPoint[]>(
    () =>
      (query.data?.items ?? [])
        .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
        .map((row) => ({
          id: row.id,
          kind: 'real_estate',
          lat: row.lat,
          lng: row.lng,
          title: row.title,
          subtitle: [
            LISTING_KIND_LABELS[row.listing_kind] ?? row.listing_kind,
            row.district,
            row.neighborhood,
          ]
            .filter(Boolean)
            .join(' · '),
          icon: 'home',
          tone: mapTone(row.status),
        })),
    [query.data?.items],
  );

  const district = bootstrap.data?.districts.find((item) => item.id === districtId) ?? null;

  const columns: Column<AdminReRow>[] = [
    {
      key: 'listing',
      label: 'İlan',
      width: 2,
      render: (row) => {
        const cover = publicMediaUrl('real-estate-media', row.cover_path);
        return (
          <View style={styles.listingCell}>
            <View style={[styles.cover, { backgroundColor: theme.colors.surfaceMuted }]}>
              {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
                <Ionicons name="home-outline" size={18} color={theme.colors.textTertiary} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
                {row.title}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {LISTING_KIND_LABELS[row.listing_kind] ?? row.listing_kind} · {row.category_name} ·{' '}
                {[row.district, row.neighborhood].filter(Boolean).join(' / ') || 'Konum yok'}
              </AppText>
              <AppText variant="caption" color="textTertiary" style={styles.mono} numberOfLines={1}>
                {row.owner ? `@${row.owner}` : 'Sahip yok'} · {row.id.slice(0, 8)}
              </AppText>
            </View>
          </View>
        );
      },
    },
    {
      key: 'price',
      label: 'Fiyat',
      width: 0.9,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <AppText variant="caption" style={{ fontWeight: '700' }}>
            {formatPrice(row.price_cents, row.currency, row.price_period)}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {LISTING_KIND_LABELS[row.listing_kind] ?? row.listing_kind}
          </AppText>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Durum / EİDS',
      width: 1.2,
      render: (row) => (
        <View style={{ gap: 3, alignItems: 'flex-start' }}>
          <Badge
            label={statusLabel(row.status, RE_STATUS_LABELS)}
            tone={toneFor(row.status, RE_STATUS_TONES)}
          />
          <Badge
            label={statusLabel(row.verification_status, VERIFICATION_LABELS)}
            tone={toneFor(row.verification_status, VERIFICATION_TONES)}
          />
          <Badge
            label={statusLabel(row.eids_status, EIDS_LABELS)}
            tone={toneFor(row.eids_status, EIDS_TONES)}
          />
        </View>
      ),
    },
    {
      key: 'media',
      label: 'Medya',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <AppText variant="caption" color="textSecondary">
            {formatNumber(row.media_count)} medya
          </AppText>
          {row.pending_media > 0 ? <Badge label={`${row.pending_media} bekliyor`} tone="warning" /> : null}
        </View>
      ),
    },
    {
      key: 'dates',
      label: 'Tarih',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <AppText variant="caption" color="textTertiary">
            Yayın: {row.published_at ? formatDate(row.published_at) : '—'}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            Bitiş: {row.expires_at ? formatDate(row.expires_at) : '—'}
          </AppText>
        </View>
      ),
    },
    {
      key: 'action',
      label: '',
      width: 0.7,
      render: (row) => (
        <Button
          label="İncele"
          size="sm"
          variant="secondary"
          fullWidth={false}
          onPress={() => setDetailId(row.id)}
        />
      ),
    },
  ];

  return (
    <>
      <AdminSection
        title="Emlak ilanları"
        subtitle="Gerçek ilan kayıtları. Mahremiyet gereği hassas adres yalnızca yetkili inceleme ekranında görünür."
        action={<Badge label={`${formatNumber(query.data?.total ?? 0)} ilan`} tone="primary" />}
      >
        <View style={styles.toolbar}>
          <View style={styles.searchWrap}>
            <TextInput
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setOffset(0);
              }}
              placeholder="İlan başlığı veya ilan no ara…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.search,
                {
                  backgroundColor: theme.colors.inputBackground,
                  borderColor: theme.colors.border,
                  color: theme.colors.text,
                },
              ]}
            />
            <Ionicons name="search" size={16} color={theme.colors.textTertiary} style={styles.searchIcon} />
          </View>
          <Button
            label={district?.name ?? 'Tüm ilçeler'}
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => setDistrictOpen(true)}
          />
          <Button
            label={kind ? LISTING_KIND_LABELS[kind] ?? kind : 'Tüm türler'}
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => setKindOpen(true)}
          />
        </View>

        <FilterChips
          options={VIEW_OPTIONS}
          value={view}
          onChange={(value) => {
            setView(value);
            setOffset(0);
          }}
        />

        <FilterChips
          options={RE_STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setOffset(0);
          }}
        />

        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {view === 'map' ? (
            <AdminMapPreview points={mapPoints} onSelect={setDetailId} />
          ) : (
            <DataTable
              columns={columns}
              rows={query.data?.items ?? []}
              keyExtractor={(row) => row.id}
              onRowPress={(row) => setDetailId(row.id)}
              empty={
                <AdminEmptyState
                  icon="home-outline"
                  title="Bu filtrede ilan yok"
                  text="Durum, arama veya ilçe filtresini değiştir."
                  tone="neutral"
                />
              }
            />
          )}
        </AdminQueryState>

        {view === 'list' && query.data && query.data.total > PAGE_SIZE ? (
          <Pager
            total={query.data.total}
            limit={query.data.limit}
            offset={query.data.offset}
            onChange={setOffset}
          />
        ) : null}
      </AdminSection>

      <RealEstateDetailModal
        listingId={detailId}
        canModerate={canModerate}
        canPublish={canPublish}
        onClose={() => setDetailId(null)}
      />

      <SelectSheet
        visible={districtOpen}
        title="İlçe filtresi"
        options={['Tüm ilçeler', ...(bootstrap.data?.districts ?? []).map((item) => item.name)]}
        value={district?.name ?? 'Tüm ilçeler'}
        onClose={() => setDistrictOpen(false)}
        onSelect={(label) => {
          const selected = bootstrap.data?.districts.find((item) => item.name === label) ?? null;
          setDistrictId(selected?.id ?? null);
          setOffset(0);
          setDistrictOpen(false);
        }}
      />

      <SelectSheet
        visible={kindOpen}
        title="İlan türü"
        options={['Tüm türler', 'Kiralık', 'Satılık', 'Devren']}
        value={kind ? LISTING_KIND_LABELS[kind] ?? kind : 'Tüm türler'}
        onClose={() => setKindOpen(false)}
        onSelect={(label) => {
          const entry = Object.entries(LISTING_KIND_LABELS).find(([, value]) => value === label);
          setKind(entry?.[0] ?? null);
          setOffset(0);
          setKindOpen(false);
        }}
      />
    </>
  );
}

export function VerificationPanel({ canVerify }: { canVerify: boolean }) {
  const { theme } = useTheme();
  const overview = useAdminExploreOverview();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const query = useAdminVerifications(status);
  const mutation = useAdminExploreMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note: string }) =>
      api.adminReviewVerification({ verificationId: input.id, decision: input.decision, note: input.note }),
  );
  const [dialog, setDialog] = useState<{
    row: AdminVerificationRow;
    decision: 'approve' | 'reject';
  } | null>(null);

  const eidsEnabled = overview.data?.eids_enabled === true;
  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  return (
    <>
      <AdminSection
        title="EİDS kimlik ve yetki doğrulaması"
        subtitle="Onay yalnızca gerçek belge incelemesiyle yapılır. Belge yolları burada gösterilir; kamuya açık bağlantıya dönüştürülmez."
        action={<Badge label={eidsEnabled ? 'EİDS etkin' : 'EİDS kapalı'} tone={eidsEnabled ? 'success' : 'danger'} />}
      >
        {!eidsEnabled ? (
          <View style={[styles.warning, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="lock-closed-outline" size={17} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={{ flex: 1 }}>
              Resmî EİDS entegrasyonu yapılandırılmadığı için onay işlemi sunucuda reddedilir.
              Sahte doğrulama üretilmez; ilanlar doğrulama bekliyor durumunda kalır.
            </AppText>
          </View>
        ) : null}

        <FilterChips
          options={[
            { key: 'pending', label: 'Bekleyen' },
            { key: 'approved', label: 'Onaylanan' },
            { key: 'rejected', label: 'Reddedilen' },
          ]}
          value={status}
          onChange={setStatus}
        />

        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {items.length === 0 ? (
            <AdminEmptyState
              icon="shield-checkmark-outline"
              title="Doğrulama kaydı yok"
              text="Seçili durumda EİDS doğrulama kaydı bulunmuyor."
              tone="neutral"
            />
          ) : (
            <View style={styles.list}>
              {items.map((row) => (
                <View key={row.id} style={[styles.verificationCard, { borderColor: theme.colors.border }]}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {row.listing_title}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {row.kind} · {row.reference_no || 'Referans yok'} · {row.owner ? `@${row.owner}` : 'Sahip yok'}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" style={styles.mono} numberOfLines={1}>
                      Belge: {row.document_path || 'yok'}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      Oluşturma: {formatDate(row.created_at)} · Bitiş: {formatDate(row.expires_at)}
                    </AppText>
                    {row.note ? (
                      <AppText variant="caption" color="textSecondary">
                        Not: {row.note}
                      </AppText>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Badge
                      label={row.status === 'approved' ? 'Onaylı' : row.status === 'pending' ? 'Bekliyor' : 'Reddedildi'}
                      tone={row.status === 'approved' ? 'success' : row.status === 'pending' ? 'warning' : 'danger'}
                    />
                    {row.status === 'pending' ? (
                      <>
                        <Button
                          label="Onayla"
                          size="sm"
                          fullWidth={false}
                          disabled={!canVerify || !eidsEnabled}
                          onPress={() => setDialog({ row, decision: 'approve' })}
                        />
                        <Button
                          label="Reddet"
                          size="sm"
                          variant="outline"
                          fullWidth={false}
                          disabled={!canVerify}
                          onPress={() => setDialog({ row, decision: 'reject' })}
                        />
                      </>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </AdminQueryState>
      </AdminSection>

      <ReasonDialog
        visible={dialog !== null}
        title={dialog?.decision === 'approve' ? 'EİDS doğrulamasını onayla' : 'EİDS doğrulamasını reddet'}
        description={
          dialog
            ? `${dialog.row.listing_title} için karar kayda geçirilecek ve ilan sahibine bildirilecek.`
            : undefined
        }
        confirmLabel={dialog?.decision === 'approve' ? 'Doğrulamayı onayla' : 'Reddet'}
        destructive={dialog?.decision === 'reject'}
        loading={mutation.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={({ reason }) => {
          if (!dialog) return;
          mutation.mutate(
            { id: dialog.row.id, decision: dialog.decision, note: reason },
            {
              onSuccess: () => {
                setDialog(null);
                void query.refetch();
              },
              onError: (cause) => Alert.alert('İşlem tamamlanamadı', cause.message),
            },
          );
        }}
      />
    </>
  );
}

export function RealEstateMediaPanel({ canModerate }: { canModerate: boolean }) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const query = useAdminRealEstateMedia(status);
  const mutation = useAdminExploreMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note: string }) =>
      api.adminReviewRealEstateMedia(input.id, input.decision, input.note),
  );
  const [dialog, setDialog] = useState<{ id: string; decision: 'approve' | 'reject'; title: string } | null>(null);

  return (
    <>
      <AdminSection
        title="Emlak medyası moderasyonu"
        subtitle="İlan fotoğraf ve videoları. Onaylı medya olmadan ilan yayınlanamaz."
        action={<Badge label={`${query.data?.items.length ?? 0} medya`} tone="primary" />}
      >
        <FilterChips
          options={[
            { key: 'pending', label: 'Bekleyen' },
            { key: 'approved', label: 'Onaylanan' },
            { key: 'rejected', label: 'Reddedilen' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {(query.data?.items.length ?? 0) === 0 ? (
            <AdminEmptyState
              icon="images-outline"
              title="Bekleyen emlak medyası yok"
              text="Yeni yüklenen ilan fotoğraf ve videoları burada incelenir."
            />
          ) : (
            <View style={styles.mediaGrid}>
              {query.data?.items.map((item) => {
                const url = publicMediaUrl('real-estate-media', item.storage_path);
                return (
                  <View key={item.id} style={[styles.mediaCard, { borderColor: theme.colors.border }]}>
                    <View style={[styles.mediaThumb, { backgroundColor: theme.colors.surfaceMuted }]}>
                      {item.kind === 'image' && url ? (
                        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <Ionicons name="videocam-outline" size={24} color={theme.colors.textTertiary} />
                      )}
                    </View>
                    <View style={{ padding: 8, gap: 4 }}>
                      <AppText variant="caption" numberOfLines={1}>
                        {item.listing_title || 'İlan'}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        {item.uploader ? `@${item.uploader}` : 'Yükleyen bilinmiyor'}
                      </AppText>
                      <Badge
                        label={statusLabel(item.status, MODERATION_STATUS_LABELS)}
                        tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}
                      />
                      {item.status === 'pending' ? (
                        <View style={styles.actions}>
                          <Button
                            label="Onayla"
                            size="sm"
                            variant="secondary"
                            fullWidth={false}
                            disabled={!canModerate}
                            onPress={() => setDialog({ id: item.id, decision: 'approve', title: item.listing_title || 'Medya' })}
                          />
                          <Button
                            label="Reddet"
                            size="sm"
                            variant="outline"
                            fullWidth={false}
                            disabled={!canModerate}
                            onPress={() => setDialog({ id: item.id, decision: 'reject', title: item.listing_title || 'Medya' })}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </AdminQueryState>
      </AdminSection>

      <ReasonDialog
        visible={dialog !== null}
        title={dialog?.decision === 'approve' ? 'Emlak medyasını onayla' : 'Emlak medyasını reddet'}
        description={dialog ? `${dialog.title} için karar denetim kaydına yazılacak.` : undefined}
        confirmLabel={dialog?.decision === 'approve' ? 'Onayla' : 'Reddet'}
        destructive={dialog?.decision === 'reject'}
        loading={mutation.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={({ reason }) => {
          if (!dialog) return;
          mutation.mutate(
            { id: dialog.id, decision: dialog.decision, note: reason },
            {
              onSuccess: () => {
                setDialog(null);
                void query.refetch();
              },
              onError: (cause) => Alert.alert('İşlem tamamlanamadı', cause.message),
            },
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  queueRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  queueCard: {
    flexGrow: 1,
    flexBasis: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  eidsRow: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  searchWrap: { flexGrow: 1, flexBasis: 260, minWidth: 200, justifyContent: 'center' },
  search: {
    height: 38,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 11,
    paddingRight: 34,
    fontSize: 13,
    outlineStyle: 'none',
  } as never,
  searchIcon: { position: 'absolute', right: 11 },
  listingCell: { flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0 },
  cover: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  mono: { fontFamily: 'monospace' },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, borderRadius: 11 },
  list: { gap: 8 },
  verificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaCard: { width: 210, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  mediaThumb: { height: 126, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
});
