import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useFrontDesk, useTransitionReservation } from '../hooks/use-accommodation';
import type { FrontDeskReservation } from '../types';
import {
  formatDateLong,
  formatMoneyCents,
  paymentStatusLabel,
  paymentTone,
  reservationTone,
  roomStatusTone,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  Chip,
  ChipsRow,
  DateField,
  EmptyState,
  InfoBanner,
  InlineError,
  LoadingBlock,
  MoneyText,
  StatusPill,
} from './AccommodationUI';

type Tab = 'arrivals' | 'departures' | 'in_house' | 'rooms';

export function FrontDeskBoard({
  propertyId,
  onReservationPress,
  onRoomPress,
}: {
  propertyId: string;
  onReservationPress: (id: string) => void;
  onRoomPress?: (room: { id: string; number: string; status: string }) => void;
}) {
  const { theme } = useTheme();
  const [date, setDate] = useState(todayIso);
  const [tab, setTab] = useState<Tab>('arrivals');
  const frontDesk = useFrontDesk(propertyId, date);
  const transition = useTransitionReservation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = frontDesk.data;

  const quickTransition = async (reservation: FrontDeskReservation, action: 'check_in' | 'check_out' | 'mark_arrival') => {
    setError(null);
    setBusyId(reservation.id);
    try {
      await transition.mutateAsync({ id: reservation.id, action });
      await frontDesk.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    } finally {
      setBusyId(null);
    }
  };

  const lists: Record<Exclude<Tab, 'rooms'>, FrontDeskReservation[]> = {
    arrivals: data?.arrivals ?? [],
    departures: data?.departures ?? [],
    in_house: data?.in_house ?? [],
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Ön büro</AppText>
          <AppText variant="caption" color="textTertiary">
            {formatDateLong(date)} · giriş, çıkış ve konaklayan misafirler
          </AppText>
        </View>
        <View style={styles.dateBox}>
          <DateField label="Tarih" value={date} onChange={setDate} />
        </View>
      </View>

      <View style={styles.counters}>
        <Counter label="Giriş" value={data?.arrivals.length ?? 0} color={theme.colors.success} onPress={() => setTab('arrivals')} />
        <Counter label="Çıkış" value={data?.departures.length ?? 0} color={theme.colors.warning} onPress={() => setTab('departures')} />
        <Counter label="Konaklayan" value={data?.in_house.length ?? 0} color={theme.colors.primary} onPress={() => setTab('in_house')} />
        <Counter label="Oda" value={data?.rooms.length ?? 0} color={theme.colors.accent} onPress={() => setTab('rooms')} />
      </View>

      <ChipsRow>
        <Chip label={`Girişler (${lists.arrivals.length})`} active={tab === 'arrivals'} onPress={() => setTab('arrivals')} />
        <Chip label={`Çıkışlar (${lists.departures.length})`} active={tab === 'departures'} onPress={() => setTab('departures')} />
        <Chip label={`Konaklayan (${lists.in_house.length})`} active={tab === 'in_house'} onPress={() => setTab('in_house')} />
        <Chip label="Oda durumu" active={tab === 'rooms'} onPress={() => setTab('rooms')} />
      </ChipsRow>

      {error ? <InlineError message={error} /> : null}

      {frontDesk.isLoading ? (
        <LoadingBlock height={180} />
      ) : frontDesk.isError ? (
        <InlineError
          message={frontDesk.error instanceof Error ? frontDesk.error.message : 'Ön büro verisi yüklenemedi.'}
          onRetry={() => void frontDesk.refetch()}
        />
      ) : tab === 'rooms' ? (
        <View style={styles.roomGrid}>
          {(data?.rooms ?? []).map((room) => {
            const tone = roomStatusTone(room.status);
            return (
              <Pressable
                key={room.id}
                accessibilityRole="button"
                accessibilityLabel={`${room.number} odası, ${tone.label}`}
                onPress={() => onRoomPress?.({ id: room.id, number: room.number, status: room.status })}
                style={[styles.roomTile, { backgroundColor: tone.background, borderColor: tone.border }]}
              >
                <View style={styles.roomHead}>
                  <AppText variant="bodyStrong" style={{ color: tone.color }}>
                    {room.number}
                  </AppText>
                  <View style={[styles.roomDot, { backgroundColor: tone.color }]} />
                </View>
                <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.roomType}>
                  {room.room_type_name}
                </AppText>
                <AppText variant="caption" style={{ color: tone.color, fontSize: 9 }}>
                  {tone.label}
                </AppText>
                {room.note ? (
                  <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.roomNote}>
                    {room.note}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
          {(data?.rooms ?? []).length === 0 ? (
            <EmptyState icon="bed-outline" title="Oda bulunamadı" message="Odalar menüsünden fiziksel oda ekleyin." />
          ) : null}
        </View>
      ) : lists[tab].length === 0 ? (
        <EmptyState
          icon={tab === 'arrivals' ? 'log-in-outline' : tab === 'departures' ? 'log-out-outline' : 'people-outline'}
          title={
            tab === 'arrivals'
              ? 'Bugün giriş yok'
              : tab === 'departures'
                ? 'Bugün çıkış yok'
                : 'Konaklayan misafir yok'
          }
          message="Seçilen tarihte ilgili kayıt bulunmuyor."
        />
      ) : (
        <View style={styles.list}>
          {tab === 'arrivals' && (data?.late_arrivals.length ?? 0) > 0 ? (
            <InfoBanner
              tone="warning"
              text={`Geç giriş bekleyen ${data?.late_arrivals.length} misafir var. Giriş işlemini tamamlamadan oda satışa açılmaz.`}
            />
          ) : null}
          {lists[tab].map((reservation) => (
            <FrontDeskCard
              key={reservation.id}
              reservation={reservation}
              busy={busyId === reservation.id}
              onPress={() => onReservationPress(reservation.id)}
              onCheckIn={() => void quickTransition(reservation, 'check_in')}
              onCheckOut={() => void quickTransition(reservation, 'check_out')}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function Counter({ label, value, color, onPress }: { label: string; value: number; color: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={[styles.counter, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
    >
      <View style={[styles.counterDot, { backgroundColor: color }]} />
      <AppText variant="h3" style={styles.counterValue}>
        {value}
      </AppText>
      <AppText variant="caption" color="textTertiary" style={styles.counterLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}

function FrontDeskCard({
  reservation,
  busy,
  onPress,
  onCheckIn,
  onCheckOut,
}: {
  reservation: FrontDeskReservation;
  busy: boolean;
  onPress: () => void;
  onCheckIn: () => void;
  onCheckOut: () => void;
}) {
  const { theme } = useTheme();
  const tone = reservationTone(reservation.status);
  const payment = paymentTone(reservation.payment_status);
  const canCheckIn = ['confirmed', 'awaiting_checkin', 'pending'].includes(reservation.status);
  const canCheckOut = ['checked_in', 'staying'].includes(reservation.status);

  return (
    <AccCard padding={12} style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <AppText variant="bodyStrong">{reservation.guest_name}</AppText>
            <StatusPill label={tone.label} color={tone.color} background={tone.background} />
          </View>
          <AppText variant="caption" color="textTertiary">
            {reservation.code} · {reservation.room_number ?? 'Oda atanmadı'} · {reservation.room_type_name ?? ''}
          </AppText>
        </View>
        <StatusPill label={paymentStatusLabel(reservation.payment_status)} color={payment.color} background={payment.background} />
      </View>

      <View style={styles.cardMeta}>
        <View style={styles.metaCell}>
          <Ionicons name="log-in-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary">
            {reservation.check_in}
          </AppText>
        </View>
        <View style={styles.metaCell}>
          <Ionicons name="log-out-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary">
            {reservation.check_out}
          </AppText>
        </View>
        <View style={styles.metaCell}>
          <Ionicons name="cash-outline" size={13} color={theme.colors.textTertiary} />
          <AppText variant="caption" color={reservation.open_balance_cents > 0 ? 'warning' : 'success'}>
            {reservation.open_balance_cents > 0
              ? `${formatMoneyCents(reservation.open_balance_cents)} açık bakiye`
              : 'Bakiye kapalı'}
          </AppText>
        </View>
        {reservation.note || reservation.notes ? (
          <View style={styles.metaCell}>
            <Ionicons name="document-text-outline" size={13} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
              {reservation.note ?? reservation.notes}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.cardActions}>
        <Button label="Detay" variant="ghost" size="sm" fullWidth={false} onPress={onPress} />
        <View style={styles.flex} />
        {reservation.total_cents > 0 ? (
          <View style={styles.totalBlock}>
            <AppText variant="caption" color="textTertiary">
              Toplam
            </AppText>
            <MoneyText cents={reservation.total_cents} variant="caption" />
          </View>
        ) : null}
        {canCheckIn ? (
          <Button label="Giriş yap" size="sm" fullWidth={false} loading={busy} onPress={onCheckIn} />
        ) : canCheckOut ? (
          <Button label="Çıkış yap" size="sm" fullWidth={false} loading={busy} onPress={onCheckOut} />
        ) : null}
      </View>
    </AccCard>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' },
  dateBox: { minWidth: 190 },
  counters: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  counter: { flex: 1, minWidth: 80, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 1 },
  counterDot: { width: 7, height: 7, borderRadius: 4, marginBottom: 2 },
  counterValue: { fontSize: 20, lineHeight: 24 },
  counterLabel: { fontSize: 9 },
  roomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  roomTile: { width: '23.4%', minWidth: 100, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, padding: 9, gap: 2 },
  roomHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  roomDot: { width: 6, height: 6, borderRadius: 3 },
  roomType: { fontSize: 9 },
  roomNote: { fontSize: 8 },
  list: { gap: 8 },
  card: { gap: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metaCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  totalBlock: { alignItems: 'flex-end' },
});
