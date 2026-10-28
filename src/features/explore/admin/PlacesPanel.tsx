import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import {
  useAdminPlaces,
  useExploreBootstrap,
} from '@/features/explore/hooks/use-explore';
import type { AdminPlaceRow } from '@/features/explore/types';
import type { MapPoint } from '@/features/map/types';
import { publicMediaUrl } from '@/features/media/media-service';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminEmptyState, AdminMapPreview, AdminQueryState } from './AdminExploreShared';
import { PlaceDetailModal } from './PlaceDetailModal';
import { PlaceEditorModal } from './PlaceEditorModal';
import {
  formatNumber,
  formatShortDate,
  PLACE_STATUS_LABELS,
  PLACE_STATUS_TONES,
  statusLabel,
  toneFor,
  VERIFICATION_LABELS,
  VERIFICATION_TONES,
} from './labels';

const PAGE_SIZE = 25;
const MAP_LIMIT = 100;

type StatusFilter = 'all' | 'published' | 'pending' | 'draft' | 'rejected' | 'archived' | 'duplicate';
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
    case 'duplicate':
      return 'danger';
    case 'archived':
      return 'info';
    default:
      return 'primary';
  }
}

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'published', label: 'Yayında' },
  { key: 'pending', label: 'Onay bekliyor' },
  { key: 'draft', label: 'Taslak' },
  { key: 'rejected', label: 'Reddedildi' },
  { key: 'archived', label: 'Arşiv' },
  { key: 'duplicate', label: 'Mükerrer' },
];

export function PlacesPanel({
  canManage,
  canModerate,
}: {
  canManage: boolean;
  canModerate: boolean;
}) {
  const { theme } = useTheme();
  const bootstrap = useExploreBootstrap();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const query = useAdminPlaces(
    {
      status: status === 'all' ? null : status,
      q: debouncedSearch.trim() || null,
      districtId,
      category: categorySlug,
      limit: view === 'map' ? MAP_LIMIT : PAGE_SIZE,
      offset: view === 'map' ? 0 : offset,
    },
    true,
  );

  const categories = useMemo(() => {
    const roots = bootstrap.data?.place_categories ?? [];
    return roots.flatMap((root) => [root, ...(root.children ?? [])]);
  }, [bootstrap.data?.place_categories]);

  const mapPoints = useMemo<MapPoint[]>(
    () =>
      (query.data?.items ?? [])
        .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
        .map((row) => ({
          id: row.id,
          kind: 'place',
          lat: row.lat,
          lng: row.lng,
          title: row.name,
          subtitle: [row.category_name, row.district, row.neighborhood].filter(Boolean).join(' · '),
          icon: 'storefront',
          tone: mapTone(row.status),
        })),
    [query.data?.items],
  );

  const district = bootstrap.data?.districts.find((item) => item.id === districtId) ?? null;
  const category = categories.find((item) => item.slug === categorySlug) ?? null;

  const resetPage = () => setOffset(0);

  const columns: Column<AdminPlaceRow>[] = [
    {
      key: 'place',
      label: 'İşletme',
      width: 1.9,
      render: (row) => {
        const cover = publicMediaUrl('place-media', row.cover_path);
        return (
          <View style={styles.placeCell}>
            <View style={[styles.cover, { backgroundColor: theme.colors.surfaceMuted }]}>
              {cover ? (
                <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="storefront-outline" size={18} color={theme.colors.textTertiary} />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
                {row.name}
              </AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {row.category_name ?? 'Kategori yok'} · {[row.district, row.neighborhood].filter(Boolean).join(' / ') || 'Konum yok'}
              </AppText>
              <AppText variant="caption" color="textTertiary" style={styles.mono} numberOfLines={1}>
                {row.id.slice(0, 8)} · {formatShortDate(row.updated_at)}
              </AppText>
            </View>
          </View>
        );
      },
    },
    {
      key: 'status',
      label: 'Durum',
      width: 1,
      render: (row) => (
        <View style={{ gap: 3 }}>
          <Badge
            label={statusLabel(row.status, PLACE_STATUS_LABELS)}
            tone={toneFor(row.status, PLACE_STATUS_TONES)}
          />
          <Badge
            label={statusLabel(row.verification_status, VERIFICATION_LABELS)}
            tone={toneFor(row.verification_status, VERIFICATION_TONES)}
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
            {formatNumber(row.photo_count)} foto · {formatNumber(row.video_count)} video
          </AppText>
          {row.pending_media > 0 ? (
            <Badge label={`${row.pending_media} medya bekliyor`} tone="warning" />
          ) : null}
        </View>
      ),
    },
    {
      key: 'signals',
      label: 'Sinyal',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <AppText variant="caption" color="textSecondary">
            {row.rating_avg != null ? `${row.rating_avg.toFixed(1)} ★` : 'Puan yok'}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {formatNumber(row.review_count)} yorum
          </AppText>
          {row.pending_claims > 0 ? (
            <Badge label={`${row.pending_claims} sahiplenme`} tone="warning" />
          ) : null}
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
        title="İşletme kayıtları"
        subtitle="Gerçek veritabanı kayıtları. Konum, medya ve doğrulama işlemleri yetkiye bağlıdır."
        action={
          <View style={styles.headActions}>
            <Badge label={`${formatNumber(query.data?.total ?? 0)} kayıt`} tone="primary" />
            {canManage ? (
              <Button
                label="Yeni işletme"
                size="sm"
                fullWidth={false}
                leftIcon={<Ionicons name="add" size={15} color={theme.colors.onPrimary} />}
                onPress={() => setEditorOpen(true)}
              />
            ) : null}
          </View>
        }
      >
        <View style={styles.toolbar}>
          <View style={styles.searchWrap}>
            <TextInput
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                resetPage();
              }}
              placeholder="İşletme adı veya adres ara…"
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
            <Ionicons
              name="search"
              size={16}
              color={theme.colors.textTertiary}
              style={styles.searchIcon}
            />
          </View>
          <Button
            label={district?.name ?? 'Tüm ilçeler'}
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => setDistrictOpen(true)}
          />
          <Button
            label={category?.name ?? 'Tüm kategoriler'}
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => setCategoryOpen(true)}
          />
        </View>

        <FilterChips
          options={VIEW_OPTIONS}
          value={view}
          onChange={(value) => {
            setView(value);
            resetPage();
          }}
        />

        <FilterChips
          options={STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            setStatus(value);
            resetPage();
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
              loading={false}
              empty={
                <AdminEmptyState
                  icon="storefront-outline"
                  title="Bu filtrede işletme yok"
                  text="Arama veya durum filtresini değiştir."
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

      <PlaceDetailModal
        placeId={detailId}
        canManage={canManage}
        canModerate={canModerate}
        onClose={() => setDetailId(null)}
      />

      <PlaceEditorModal
        visible={editorOpen}
        canManage={canManage}
        onClose={() => setEditorOpen(false)}
        onSaved={(message) => {
          Alert.alert('Kaydedildi', message);
          void query.refetch();
        }}
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
          resetPage();
          setDistrictOpen(false);
        }}
      />

      <SelectSheet
        visible={categoryOpen}
        title="Kategori filtresi"
        options={['Tüm kategoriler', ...categories.map((item) => item.name)]}
        value={category?.name ?? 'Tüm kategoriler'}
        onClose={() => setCategoryOpen(false)}
        onSelect={(label) => {
          const selected = categories.find((item) => item.name === label) ?? null;
          setCategorySlug(selected?.slug ?? null);
          resetPage();
          setCategoryOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  searchWrap: {
    flexGrow: 1,
    flexBasis: 260,
    minWidth: 200,
    position: 'relative',
    justifyContent: 'center',
  },
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
  placeCell: { flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0 },
  cover: { width: 42, height: 42, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  mono: { fontFamily: 'monospace' },
});
