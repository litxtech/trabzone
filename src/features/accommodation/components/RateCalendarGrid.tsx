import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useBulkRateUpdate, useRateCalendar } from '../hooks/use-accommodation';
import type { BulkRateAction, RateRow } from '../types';
import {
  addDaysIso,
  formatDateShort,
  formatMoneyCents,
  formatWeekdayShort,
  isoToDate,
  parseMoneyToCents,
  todayIso,
} from '../utils/format';
import {
  Chip,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
  ToggleRow,
} from './AccommodationUI';
import { BulkRateModal } from './BulkRateModal';

type RangeMode = 7 | 14 | 30;

type CellTarget = {
  roomTypeId: string;
  roomTypeName: string;
  ratePlanId: string;
  ratePlanName: string;
  date: string;
  row: RateRow;
};

const DAY_WIDTH: Record<RangeMode, number> = { 7: 92, 14: 64, 30: 50 };
const ROW_HEIGHT = 58;
const HEADER_HEIGHT = 48;
const LEFT_WIDTH = 152;

export function RateCalendarGrid({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [from, setFrom] = useState(todayIso);
  const [range, setRange] = useState<RangeMode>(14);
  const [roomTypeFilter, setRoomTypeFilter] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [cell, setCell] = useState<CellTarget | null>(null);

  const to = useMemo(() => addDaysIso(from, range), [from, range]);
  const days = useMemo(
    () => Array.from({ length: range }, (_, index) => addDaysIso(from, index)),
    [from, range],
  );
  const calendar = useRateCalendar(propertyId, from, to, roomTypeFilter);
  const data = calendar.data;

  const rows = useMemo(() => {
    if (!data) return [];
    const list: { roomTypeId: string; roomTypeName: string; ratePlanId: string; ratePlanName: string; bookingMode: string }[] = [];
    for (const roomType of data.room_types) {
      for (const plan of data.rate_plans) {
        if (plan.room_type_id != null && plan.room_type_id !== roomType.id) continue;
        list.push({
          roomTypeId: roomType.id,
          roomTypeName: roomType.name,
          ratePlanId: plan.id,
          ratePlanName: plan.name,
          bookingMode: plan.booking_mode,
        });
      }
    }
    return list;
  }, [data]);

  const rowMap = useMemo(() => {
    const map = new Map<string, RateRow>();
    for (const row of data?.rows ?? []) {
      map.set(`${row.room_type_id}:${row.rate_plan_id}:${row.stay_date}`, row);
    }
    return map;
  }, [data?.rows]);

  const dayWidth = DAY_WIDTH[range];
  const shift = (direction: number) => setFrom((current) => addDaysIso(current, direction * range));

  const findRow = (target: Omit<CellTarget, 'row'>): RateRow =>
    rowMap.get(`${target.roomTypeId}:${target.ratePlanId}:${target.date}`) ?? {
      room_type_id: target.roomTypeId,
      room_type_name: target.roomTypeName,
      rate_plan_id: target.ratePlanId,
      rate_plan_name: target.ratePlanName,
      stay_date: target.date,
      base_price_cents: 0,
      extra_adult_cents: 0,
      extra_child_cents: 0,
      available_rooms: null,
      min_stay: null,
      max_stay: null,
      closed: false,
      closed_to_arrival: false,
      closed_to_departure: false,
      is_set: false,
    };

  return (
    <View style={[styles.wrap, { borderColor: theme.colors.border }]}>
      <View style={[styles.toolbar, { borderBottomColor: theme.colors.divider }]}>
        <View style={styles.toolbarTop}>
          <View style={styles.navGroup}>
            <Pressable accessibilityRole="button" accessibilityLabel="Önceki dönem" onPress={() => shift(-1)} style={[styles.iconButton, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Sonraki dönem" onPress={() => shift(1)} style={[styles.iconButton, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.text} />
            </Pressable>
            <View>
              <AppText variant="bodyStrong">
                {formatDateShort(from)} – {formatDateShort(addDaysIso(to, -1))}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                Fiyat ve müsaitlik takvimi
              </AppText>
            </View>
          </View>
          <View style={styles.toolbarActions}>
            <Chip label="Bugün" icon="locate-outline" onPress={() => setFrom(todayIso())} />
            <Chip label="Toplu güncelle" icon="layers-outline" active onPress={() => setBulkOpen(true)} />
            <Pressable accessibilityRole="button" accessibilityLabel="Yenile" onPress={() => void calendar.refetch()} style={[styles.iconButton, { backgroundColor: theme.colors.surfaceMuted }]}>
              {calendar.isRefetching ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Ionicons name="refresh" size={17} color={theme.colors.textSecondary} />}
            </Pressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {([7, 14, 30] as RangeMode[]).map((value) => (
            <Chip
              key={value}
              label={`${value} gün`}
              active={range === value}
              onPress={() => setRange(value)}
            />
          ))}
          <View style={[styles.chipDivider, { backgroundColor: theme.colors.divider }]} />
          <Chip label="Tüm oda tipleri" active={!roomTypeFilter} onPress={() => setRoomTypeFilter(null)} />
          {(data?.room_types ?? []).map((roomType) => (
            <Chip
              key={roomType.id}
              label={roomType.name}
              active={roomTypeFilter === roomType.id}
              onPress={() => setRoomTypeFilter(roomType.id)}
            />
          ))}
        </ScrollView>
        <View style={styles.legend}>
          <LegendDot color={theme.colors.primary} label="Fiyat" />
          <LegendDot color={theme.colors.textTertiary} label="Manuel kayıt" />
          <LegendDot color={theme.colors.danger} label="Satışa kapalı" />
          <LegendDot color={theme.colors.warning} label="Giriş/çıkış kısıtlı" />
        </View>
      </View>

      {calendar.isError ? (
        <View style={{ padding: 12 }}>
          <InlineError
            message={calendar.error instanceof Error ? calendar.error.message : 'Fiyat takvimi yüklenemedi.'}
            onRetry={() => void calendar.refetch()}
          />
        </View>
      ) : null}

      <ScrollView nestedScrollEnabled>
        <View style={styles.table}>
          <View style={[styles.leftColumn, { borderRightColor: theme.colors.divider }]}>
            <View style={[styles.leftHead, { backgroundColor: theme.colors.surfaceMuted, borderBottomColor: theme.colors.divider }]}>
              <AppText variant="caption" color="textTertiary">
                ODA TİPİ / PLAN
              </AppText>
            </View>
            {rows.map((row) => (
              <View key={`${row.roomTypeId}-${row.ratePlanId}`} style={[styles.leftCell, { borderBottomColor: theme.colors.divider }]}>
                <AppText variant="caption" color="text" numberOfLines={1} style={styles.rowTitle}>
                  {row.roomTypeName}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.rowSub}>
                  {row.ratePlanName} · {row.bookingMode === 'instant' ? 'Anında' : 'Manuel'}
                </AppText>
              </View>
            ))}
            {rows.length === 0 && !calendar.isLoading ? (
              <View style={styles.leftCell}>
                <AppText variant="caption" color="textTertiary">
                  Fiyat planı yok
                </AppText>
              </View>
            ) : null}
          </View>

          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
            <View style={{ width: dayWidth * days.length }}>
              <View style={styles.dayHeaderRow}>
                {days.map((day) => {
                  const weekend = [0, 6].includes(isoToDate(day).getDay());
                  const isToday = day === todayIso();
                  return (
                    <View
                      key={day}
                      style={[
                        styles.dayHeader,
                        {
                          width: dayWidth,
                          borderRightColor: theme.colors.divider,
                          borderBottomColor: theme.colors.divider,
                          backgroundColor: isToday ? theme.colors.primarySoft : weekend ? theme.colors.surfaceMuted : theme.colors.surface,
                        },
                      ]}
                    >
                      <AppText variant="caption" color="textTertiary" style={styles.weekday}>
                        {formatWeekdayShort(day)}
                      </AppText>
                      <AppText variant="bodyStrong" color={isToday ? 'primaryDeep' : 'text'} style={styles.dayNumber}>
                        {day.slice(8, 10)}
                      </AppText>
                    </View>
                  );
                })}
              </View>

              {rows.map((row) => (
                <View key={`${row.roomTypeId}-${row.ratePlanId}`} style={[styles.gridRow, { height: ROW_HEIGHT, borderBottomColor: theme.colors.divider }]}>
                  {days.map((day) => {
                    const key = `${row.roomTypeId}:${row.ratePlanId}:${day}`;
                    const rate = rowMap.get(key);
                    const weekend = [0, 6].includes(isoToDate(day).getDay());
                    return (
                      <Pressable
                        key={day}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.roomTypeName} ${row.ratePlanName} ${day} fiyat düzenle`}
                        onPress={() => {
                          const target = {
                            roomTypeId: row.roomTypeId,
                            roomTypeName: row.roomTypeName,
                            ratePlanId: row.ratePlanId,
                            ratePlanName: row.ratePlanName,
                            date: day,
                          };
                          setCell({ ...target, row: findRow(target) });
                        }}
                        style={[
                          styles.cell,
                          {
                            width: dayWidth,
                            borderRightColor: theme.colors.divider,
                            backgroundColor: rate?.closed
                              ? theme.colors.dangerSoft
                              : weekend
                                ? `${theme.colors.textTertiary}08`
                                : 'transparent',
                          },
                        ]}
                      >
                        {rate ? (
                          <>
                            <AppText
                              variant="caption"
                              color={rate.closed ? 'danger' : 'text'}
                              style={[styles.price, rate.is_set && styles.priceManual]}
                            >
                              {formatMoneyCents(rate.base_price_cents, 'TRY', { decimals: false })}
                            </AppText>
                            <View style={styles.metaRow}>
                              {rate.available_rooms != null ? (
                                <>
                                  <Ionicons name="bed-outline" size={9} color={theme.colors.textTertiary} />
                                  <AppText variant="caption" color="textTertiary" style={styles.metaText}>
                                    {rate.available_rooms}
                                  </AppText>
                                </>
                              ) : null}
                              {rate.min_stay && rate.min_stay > 1 ? (
                                <AppText variant="caption" color="textTertiary" style={styles.metaText}>
                                  min {rate.min_stay}
                                </AppText>
                              ) : null}
                            </View>
                            <View style={styles.badges}>
                              {rate.closed ? <View style={[styles.badge, { backgroundColor: theme.colors.danger }]} /> : null}
                              {rate.closed_to_arrival || rate.closed_to_departure ? (
                                <View style={[styles.badge, { backgroundColor: theme.colors.warning }]} />
                              ) : null}
                              {rate.is_set ? <View style={[styles.badge, { backgroundColor: theme.colors.primary }]} /> : null}
                            </View>
                          </>
                        ) : (
                          <AppText variant="caption" color="textTertiary" style={styles.metaText}>
                            —
                          </AppText>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
        {calendar.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
            <AppText variant="caption" color="textSecondary">
              Fiyatlar yükleniyor…
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.colors.divider }]}>
        <Ionicons name="pencil-outline" size={13} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary">
          Hücreye dokunarak gecelik fiyat, müsait oda, min/maks gece ve giriş/çıkış kısıtlarını düzenle. Toplu işlemler önizleme sonrası uygulanır.
        </AppText>
      </View>

      <BulkRateModal
        visible={bulkOpen}
        onClose={() => setBulkOpen(false)}
        propertyId={propertyId}
        defaultFrom={from}
        defaultTo={addDaysIso(to, -1)}
        roomTypes={(data?.room_types ?? []).map((roomType) => ({ id: roomType.id, name: roomType.name }))}
        ratePlans={(data?.rate_plans ?? []).map((plan) => ({ id: plan.id, name: plan.name, room_type_id: plan.room_type_id }))}
      />

      <RateCellModal
        target={cell}
        onClose={() => setCell(null)}
        propertyId={propertyId}
        onSaved={() => {
          setCell(null);
          void calendar.refetch();
        }}
      />
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <AppText variant="caption" color="textTertiary" style={styles.legendText}>
        {label}
      </AppText>
    </View>
  );
}

function RateCellModal({
  target,
  propertyId,
  onClose,
  onSaved,
}: {
  target: CellTarget | null;
  propertyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { theme } = useTheme();
  const bulk = useBulkRateUpdate(propertyId);
  const [price, setPrice] = useState('');
  const [availability, setAvailability] = useState('');
  const [minStay, setMinStay] = useState('');
  const [maxStay, setMaxStay] = useState('');
  const [closed, setClosed] = useState(false);
  const [closedArrival, setClosedArrival] = useState(false);
  const [closedDeparture, setClosedDeparture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrice(target.row.base_price_cents ? String(target.row.base_price_cents / 100) : '');
    setAvailability(target.row.available_rooms != null ? String(target.row.available_rooms) : '');
    setMinStay(target.row.min_stay != null ? String(target.row.min_stay) : '');
    setMaxStay(target.row.max_stay != null ? String(target.row.max_stay) : '');
    setClosed(target.row.closed);
    setClosedArrival(target.row.closed_to_arrival);
    setClosedDeparture(target.row.closed_to_departure);
    setError(null);
  }, [target]);

  const run = async (action: BulkRateAction, value: number | null) => {
    if (!target) return;
    await bulk.mutateAsync({
      roomTypeIds: [target.roomTypeId],
      ratePlanIds: [target.ratePlanId],
      from: target.date,
      to: addDaysIso(target.date, 1),
      action,
      value,
      dryRun: false,
    });
  };

  const save = async () => {
    if (!target) return;
    setError(null);
    setSaving(true);
    try {
      const original = target.row;
      const nextPrice = parseMoneyToCents(price);
      if (nextPrice != null && nextPrice !== original.base_price_cents) {
        await run('set_price', nextPrice / 100);
      }
      if (availability.trim() !== '' && Number(availability) !== original.available_rooms) {
        await run('set_availability', Math.max(0, Number(availability)));
      }
      if (minStay.trim() !== '' && Number(minStay) !== original.min_stay) {
        await run('set_min_stay', Math.max(1, Number(minStay)));
      }
      if (maxStay.trim() !== '' && Number(maxStay) !== original.max_stay) {
        await run('set_max_stay', Math.max(1, Number(maxStay)));
      }
      if (closed !== original.closed) {
        await run(closed ? 'close' : 'open', null);
      }
      if (closedArrival !== original.closed_to_arrival) {
        await run(closedArrival ? 'close_arrival' : 'open_arrival', null);
      }
      if (closedDeparture !== original.closed_to_departure) {
        await run(closedDeparture ? 'close_departure' : 'open_departure', null);
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hücre güncellenemedi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet
      visible={Boolean(target)}
      onClose={onClose}
      title={target ? formatDateShort(target.date) : 'Fiyat'}
      subtitle={target ? `${target.roomTypeName} · ${target.ratePlanName}` : undefined}
      maxWidth={560}
      footer={
        <View style={styles.footerButtons}>
          <Button label="Vazgeç" variant="outline" onPress={onClose} style={styles.flex} />
          <Button label="Kaydet" loading={saving} onPress={() => void save()} style={styles.flex} />
        </View>
      }
    >
      <View style={styles.cellForm}>
        {target?.row.is_set ? (
          <InfoBanner text="Bu gün için manuel fiyat kaydı var. Kaydettiğinde mevcut değerler güncellenir; diğer günler etkilenmez." />
        ) : (
          <InfoBanner text="Bu gün için henüz manuel kayıt yok; fiyat oda tipinin baz fiyatından geliyor." />
        )}
        <View style={styles.row}>
          <TextField
            label="Gecelik fiyat (₺)"
            value={price}
            onChangeText={(next) => setPrice(next.replace(/[^\d.,]/g, ''))}
            keyboardType="decimal-pad"
            containerStyle={styles.flex}
          />
          <TextField
            label="Müsait oda"
            value={availability}
            onChangeText={(next) => setAvailability(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            placeholder="Boş = sınırsız"
            containerStyle={styles.flex}
          />
        </View>
        <View style={styles.row}>
          <TextField
            label="Minimum gece"
            value={minStay}
            onChangeText={(next) => setMinStay(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            containerStyle={styles.flex}
          />
          <TextField
            label="Maksimum gece"
            value={maxStay}
            onChangeText={(next) => setMaxStay(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            containerStyle={styles.flex}
          />
        </View>
        <ToggleRow label="Satışa kapalı" description="Bu gün rezervasyon alınmaz" value={closed} onChange={setClosed} />
        <ToggleRow label="Girişe kapalı" description="Bu gün giriş yapılamaz" value={closedArrival} onChange={setClosedArrival} />
        <ToggleRow label="Çıkışa kapalı" description="Bu gün çıkış yapılamaz" value={closedDeparture} onChange={setClosedDeparture} />
        {error ? (
          <InlineError message={error} />
        ) : new Date(`${target?.date ?? todayIso()}T12:00:00`).getDay() === 0 ? (
          <AppText variant="caption" color="textTertiary">
            Pazar günü seçtin. Hafta sonu fiyatı için toplu güncellemede “Hafta içi / sonu” işlemini kullanabilirsin.
          </AppText>
        ) : (
          <AppText variant="caption" color="textTertiary">
            <Ionicons name="information-circle-outline" size={11} color={theme.colors.textTertiary} /> Fiyatlar Türk Lirası
            olarak kaydedilir; onaylanmış rezervasyonların fiyatı değişmez.
          </AppText>
        )}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  flex: { flex: 1 },
  toolbar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 8 },
  toolbarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, flexWrap: 'wrap' },
  navGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  iconButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 6, paddingHorizontal: 12, alignItems: 'center' },
  chipDivider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 9 },
  table: { flexDirection: 'row' },
  leftColumn: { width: LEFT_WIDTH, borderRightWidth: StyleSheet.hairlineWidth },
  leftHead: { height: HEADER_HEIGHT, justifyContent: 'center', paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  leftCell: { height: ROW_HEIGHT, justifyContent: 'center', paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 1 },
  rowTitle: { fontSize: 11 },
  rowSub: { fontSize: 8 },
  dayHeaderRow: { flexDirection: 'row', height: HEADER_HEIGHT },
  dayHeader: { height: HEADER_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  weekday: { fontSize: 8, textTransform: 'uppercase' },
  dayNumber: { fontSize: 13, lineHeight: 16 },
  gridRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: 3, paddingVertical: 4, justifyContent: 'center', gap: 1 },
  price: { fontSize: 10, lineHeight: 13 },
  priceManual: { fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  metaText: { fontSize: 8, lineHeight: 10 },
  badges: { position: 'absolute', top: 4, right: 3, flexDirection: 'row', gap: 2 },
  badge: { width: 4, height: 4, borderRadius: 2 },
  loading: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 14 },
  footer: { flexDirection: 'row', gap: 6, alignItems: 'center', padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  footerButtons: { flexDirection: 'row', gap: 8 },
  cellForm: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
});
