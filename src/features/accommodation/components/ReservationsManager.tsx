import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useAccommodationLayout } from '../hooks/use-accommodation-layout';
import { useReservations } from '../hooks/use-accommodation';
import type { ReservationListRow, ReservationStatus } from '../types';
import {
  RESERVATION_STATUS_OPTIONS,
  SOURCE_LABELS,
  formatDate,
  formatMoneyCents,
  reservationTone,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  LoadingBlock,
  StatusPill,
} from './AccommodationUI';
import { ManualBookingModal } from './ManualBookingModal';
import { ReservationDetailModal } from './ReservationDetailModal';

const PAGE_SIZE = 25;

export function ReservationsManager({
  propertyId,
  onOpenMessages,
}: {
  propertyId: string;
  onOpenMessages?: (reservationId: string) => void;
}) {
  const { theme } = useTheme();
  const layout = useAccommodationLayout();
  const [status, setStatus] = useState<ReservationStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const reservations = useReservations(propertyId, {
    status,
    query: query.trim() || null,
    limit,
    offset: 0,
  });

  const items = reservations.data?.items ?? [];
  const total = reservations.data?.total ?? 0;
  const statusOptions = useMemo(() => RESERVATION_STATUS_OPTIONS, []);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Rezervasyonlar</AppText>
          <AppText variant="caption" color="textTertiary">
            {total > 0 ? `${total} kayıt` : 'Henüz rezervasyon yok'} · {formatDate(todayIso())}
          </AppText>
        </View>
        <Button
          label="Yeni rezervasyon"
          size="sm"
          fullWidth={false}
          leftIcon={<Ionicons name="add" size={16} color={theme.colors.onPrimary} />}
          onPress={() => setCreating(true)}
        />
      </View>

      <TextField
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setLimit(PAGE_SIZE);
        }}
        placeholder="Misafir adı, telefon veya rezervasyon kodu ara"
        leftIcon="search-outline"
        autoCorrect={false}
      />

      <View style={styles.filters}>
        <Chip label="Tümü" active={status === 'all'} onPress={() => { setStatus('all'); setLimit(PAGE_SIZE); }} />
        {statusOptions
          .filter((option) => option.value !== 'all')
          .map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={status === option.value}
              onPress={() => {
                setStatus(option.value as ReservationStatus);
                setLimit(PAGE_SIZE);
              }}
            />
          ))}
      </View>

      {reservations.isLoading ? (
        <LoadingBlock height={240} />
      ) : reservations.isError ? (
        <InlineError
          message={reservations.error instanceof Error ? reservations.error.message : 'Rezervasyonlar yüklenemedi.'}
          onRetry={() => void reservations.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="Rezervasyon bulunamadı"
          message={query ? 'Arama kriterine uygun rezervasyon yok.' : 'Yeni rezervasyon oluşturarak başla.'}
          compact
        />
      ) : (
        <>
          {layout.isDesktop ? (
          <AccCard padding={0} style={styles.table}>
            <View style={[styles.tableHead, { borderBottomColor: theme.colors.divider }]}>
              <AppText variant="caption" color="textTertiary" style={styles.colGuest}>Misafir</AppText>
              <AppText variant="caption" color="textTertiary" style={styles.colDates}>Tarihler</AppText>
              <AppText variant="caption" color="textTertiary" style={styles.colRoom}>Oda</AppText>
              <AppText variant="caption" color="textTertiary" style={styles.colStatus}>Durum</AppText>
              <AppText variant="caption" color="textTertiary" style={styles.colAmount}>Tutar</AppText>
            </View>
            {items.map((row, index) => {
              const tone = reservationTone(row.status);
              return (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.guest_name} rezervasyonu`}
                  onPress={() => setDetailId(row.id)}
                  style={({ pressed }) => [
                    styles.tableRow,
                    {
                      borderBottomColor: theme.colors.divider,
                      borderBottomWidth: index === items.length - 1 ? 0 : StyleSheet.hairlineWidth,
                      backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
                    },
                  ]}
                >
                  <View style={styles.colGuest}>
                    <AppText variant="bodyStrong" numberOfLines={1}>{row.guest_name}</AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {row.code} · {SOURCE_LABELS[row.source]}
                    </AppText>
                  </View>
                  <View style={styles.colDates}>
                    <AppText variant="caption" color="text">
                      {formatDate(row.check_in)} → {formatDate(row.check_out)}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">{row.nights} gece</AppText>
                  </View>
                  <View style={styles.colRoom}>
                    <AppText variant="caption" color="text" numberOfLines={1}>{row.room_type_name}</AppText>
                    <AppText variant="caption" color="textTertiary">
                      {row.room_number ? `Oda ${row.room_number}` : 'Oda atanmadı'}
                    </AppText>
                  </View>
                  <View style={styles.colStatus}>
                    <StatusPill label={tone.label} color={tone.color} background={tone.background} />
                  </View>
                  <View style={styles.colAmount}>
                    <AppText variant="bodyStrong">{formatMoneyCents(row.total_cents)}</AppText>
                    <AppText
                      variant="caption"
                      color={row.payment_status === 'paid' ? 'success' : row.payment_status === 'partial' ? 'warning' : 'danger'}
                    >
                      {row.payment_status === 'paid' ? 'Ödendi' : row.payment_status === 'partial' ? 'Kısmi' : 'Ödenmedi'}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </AccCard>
          ) : (
            <View style={styles.mobileList}>
              {items.map((row) => (
                <MobileReservationRow key={row.id} row={row} onPress={() => setDetailId(row.id)} />
              ))}
            </View>
          )}

          {items.length < total ? (
            <Button
              label={`Daha fazla göster (${total - items.length})`}
              variant="outline"
              size="sm"
              loading={reservations.isFetching}
              onPress={() => setLimit((current) => current + PAGE_SIZE)}
            />
          ) : null}
        </>
      )}

      <ManualBookingModal
        visible={creating}
        onClose={() => setCreating(false)}
        propertyId={propertyId}
        onCreated={(reservation) => {
          setCreating(false);
          setDetailId(reservation.id);
          void reservations.refetch();
        }}
      />

      <ReservationDetailModal
        reservationId={detailId}
        propertyId={propertyId}
        onClose={() => setDetailId(null)}
        onChanged={() => void reservations.refetch()}
        onOpenMessages={(reservationId) => {
          setDetailId(null);
          onOpenMessages?.(reservationId);
        }}
      />
    </View>
  );
}

function MobileReservationRow({ row, onPress }: { row: ReservationListRow; onPress: () => void }) {
  const { theme } = useTheme();
  const tone = reservationTone(row.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.guest_name} rezervasyonu`}
      onPress={onPress}
    >
      <AccCard padding={11} style={{ gap: 6 }}>
        <View style={styles.mobileTop}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong" numberOfLines={1}>{row.guest_name}</AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {row.code} · {SOURCE_LABELS[row.source]}
            </AppText>
          </View>
          <StatusPill label={tone.label} color={tone.color} background={tone.background} />
        </View>
        <View style={styles.mobileMeta}>
          <View style={styles.mobileMetaItem}>
            <Ionicons name="calendar-outline" size={12} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary">
              {formatDate(row.check_in)} → {formatDate(row.check_out)}
            </AppText>
          </View>
          <View style={styles.mobileMetaItem}>
            <Ionicons name="bed-outline" size={12} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textSecondary" numberOfLines={1}>
              {row.room_type_name}{row.room_number ? ` · ${row.room_number}` : ''}
            </AppText>
          </View>
        </View>
        <View style={styles.mobileBottom}>
          <AppText variant="bodyStrong">{formatMoneyCents(row.total_cents)}</AppText>
          <AppText
            variant="caption"
            color={row.payment_status === 'paid' ? 'success' : row.payment_status === 'partial' ? 'warning' : 'danger'}
          >
            {row.payment_status === 'paid' ? 'Ödendi' : row.payment_status === 'partial' ? 'Kısmi ödeme' : 'Ödeme bekliyor'}
          </AppText>
        </View>
      </AccCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  filters: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  table: { overflow: 'hidden' },
  tableHead: { flexDirection: 'row', gap: 8, paddingHorizontal: 11, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  tableRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 11, paddingVertical: 9, alignItems: 'center' },
  colGuest: { flex: 2.2, minWidth: 0 },
  colDates: { flex: 1.7, minWidth: 0 },
  colRoom: { flex: 1.5, minWidth: 0 },
  colStatus: { flex: 1.4, minWidth: 0 },
  colAmount: { flex: 1.2, minWidth: 0, alignItems: 'flex-end' },
  mobileList: { gap: 7 },
  mobileTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mobileMeta: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  mobileMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  mobileBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
