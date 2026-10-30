import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAccommodationCalendar,
  useBulkRateUpdate,
  useRateCalendar,
} from '../hooks/use-accommodation';
import { useAccommodationLayout } from '../hooks/use-accommodation-layout';
import type {
  BookingMode,
  BulkRateAction,
  CalendarBlock,
  CalendarReservation,
  CalendarRoom,
  CalendarRoomType,
  RateRow,
} from '../types';
import {
  BOOKING_MODE_LABELS,
  addDaysIso,
  centsToInput,
  formatDateLong,
  formatDateShort,
  formatMoneyCents,
  formatWeekdayShort,
  isoToDate,
  parseMoneyToCents,
  reservationTone,
  roomStatusTone,
  todayIso,
} from '../utils/format';
import { Chip, InlineError, ModalSheet, ToggleRow } from './AccommodationUI';
import { BulkRateModal } from './BulkRateModal';

export type CalendarViewMode = 'day' | 'week' | 'fortnight' | 'month' | 'compact' | 'wide';

export type CalendarMode = 'rates' | 'reservations' | 'rooms';

export type EmptyCalendarCell = {
  date: string;
  roomId: string | null;
  roomNumber: string | null;
  roomTypeId: string;
  roomTypeName: string;
};

const VIEW_OPTIONS: { value: CalendarViewMode; label: string; days: number; width: number }[] = [
  { value: 'day', label: 'Günlük', days: 1, width: 320 },
  { value: 'week', label: 'Haftalık', days: 7, width: 116 },
  { value: 'fortnight', label: '14 gün', days: 14, width: 84 },
  { value: 'month', label: 'Aylık', days: 30, width: 64 },
  { value: 'compact', label: 'Kompakt', days: 14, width: 46 },
  { value: 'wide', label: 'Geniş', days: 14, width: 150 },
];

const MODE_OPTIONS = [
  { value: 'rates', label: 'Fiyat ve Müsaitlik', icon: 'pricetags-outline' },
  { value: 'reservations', label: 'Rezervasyonlar', icon: 'albums-outline' },
  { value: 'rooms', label: 'Odalar', icon: 'bed-outline' },
] as const;

const HEADER_HEIGHT = 58;
const TYPE_ROW_HEIGHT = 46;
const PLAN_ROW_HEIGHT = 58;
const ROOM_ROW_HEIGHT = 56;
const POOL_ROW_HEIGHT = 54;
const BAR_HEIGHT = 18;
const LANE_GAP = 5;

/** Bu durumlar odadaki envanteri bloke eder. */
const OCCUPYING_STATUSES: CalendarReservation['status'][] = [
  'pending',
  'confirmed',
  'awaiting_checkin',
  'checked_in',
  'staying',
  'change_pending',
  'disputed',
];

type RatePlanLite = {
  id: string;
  name: string;
  room_type_id: string | null;
  booking_mode: BookingMode;
  min_stay: number;
  max_stay: number | null;
};

type Occupancy = { total: number; sold: number; blocked: number };

type GridRowModel =
  | {
      key: string;
      kind: 'type';
      height: number;
      roomTypeId: string;
      name: string;
      roomCount: number;
      collapsed: boolean;
    }
  | {
      key: string;
      kind: 'plan';
      height: number;
      roomTypeId: string;
      roomTypeName: string;
      plan: RatePlanLite;
    }
  | {
      key: string;
      kind: 'bars';
      height: number;
      roomTypeId: string;
      roomTypeName: string;
      items: { reservation: CalendarReservation; lane: number }[];
    }
  | { key: string; kind: 'room'; height: number; roomType: CalendarRoomType; room: CalendarRoom }
  | {
      key: string;
      kind: 'pool';
      height: number;
      roomType: CalendarRoomType;
      items: { reservation: CalendarReservation; lane: number }[];
    };

type EditorTarget = {
  roomTypeId: string;
  roomTypeName: string;
  ratePlanId: string;
  ratePlanName: string;
  date: string;
  row: RateRow | null;
  available: number | null;
};

type BulkSeed = {
  from: string;
  to: string;
  roomTypes: { id: string; name: string }[];
  ratePlans: { id: string; name: string; room_type_id: string | null }[];
};

function diffDays(from: string, to: string): number {
  return Math.round((isoToDate(to).getTime() - isoToDate(from).getTime()) / 86_400_000);
}

function monthShort(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(isoToDate(iso));
}

function assignLanes(reservations: CalendarReservation[]) {
  const sorted = [...reservations].sort(
    (a, b) => a.check_in.localeCompare(b.check_in) || a.id.localeCompare(b.id),
  );
  const laneEnds: string[] = [];
  const items: { reservation: CalendarReservation; lane: number }[] = [];
  for (const reservation of sorted) {
    let lane = laneEnds.findIndex((end) => end <= reservation.check_in);
    if (lane === -1) {
      laneEnds.push(reservation.check_out);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = reservation.check_out;
    }
    items.push({ reservation, lane });
  }
  return { items, lanes: Math.max(1, laneEnds.length) };
}

export function HotelRunnerCalendar({
  propertyId,
  initialView = 'fortnight',
  initialMode = 'rates',
  onReservationPress,
  onEmptyCellPress,
  onRoomPress,
  onBlockPress,
}: {
  propertyId: string;
  initialView?: CalendarViewMode;
  initialMode?: CalendarMode;
  onReservationPress: (reservation: CalendarReservation) => void;
  onEmptyCellPress: (cell: EmptyCalendarCell) => void;
  onRoomPress: (room: CalendarRoom, roomType: CalendarRoomType) => void;
  onBlockPress?: (block: CalendarBlock) => void;
}) {
  const { theme } = useTheme();
  const layout = useAccommodationLayout();
  const [mode, setMode] = useState<CalendarMode>(initialMode);
  const [view, setView] = useState<CalendarViewMode>(initialView);
  const [from, setFrom] = useState(todayIso);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [bulkSeed, setBulkSeed] = useState<BulkSeed | null>(null);
  const horizontalRef = useRef<ScrollViewInstance | null>(null);

  const config = VIEW_OPTIONS.find((option) => option.value === view) ?? VIEW_OPTIONS[2]!;
  const to = useMemo(() => addDaysIso(from, config.days), [from, config.days]);
  const days = useMemo(() => {
    const list: string[] = [];
    for (let index = 0; index < config.days; index += 1) {
      list.push(addDaysIso(from, index));
    }
    return list;
  }, [from, config.days]);

  const rateCalendar = useRateCalendar(propertyId, from, to);
  const calendar = useAccommodationCalendar(propertyId, from, to);
  const rateData = rateCalendar.data;
  const calendarData = calendar.data;
  const today = todayIso();
  const dayWidth = config.width;
  const gridWidth = dayWidth * days.length;
  const leftWidth = layout.isDesktop ? 224 : 158;

  const roomTypeMap = useMemo(() => {
    const map = new Map<string, CalendarRoomType>();
    for (const roomType of calendarData?.room_types ?? []) {
      map.set(roomType.id, roomType);
    }
    return map;
  }, [calendarData?.room_types]);

  const roomCountOf = (roomTypeId: string): number =>
    (roomTypeMap.get(roomTypeId)?.rooms ?? []).filter((room) => room.active).length;

  const occupancy = useMemo(() => {
    const map = new Map<string, Occupancy>();
    for (const roomType of calendarData?.room_types ?? []) {
      const total = roomType.rooms.filter((room) => room.active).length;
      for (const day of days) {
        map.set(`${roomType.id}|${day}`, { total, sold: 0, blocked: 0 });
      }
    }
    if (!calendarData) return map;
    for (const reservation of calendarData.reservations) {
      if (!OCCUPYING_STATUSES.includes(reservation.status)) continue;
      const start = Math.max(0, diffDays(from, reservation.check_in));
      const end = Math.min(days.length, diffDays(from, reservation.check_out));
      for (let index = start; index < end; index += 1) {
        const entry = map.get(`${reservation.room_type_id}|${days[index]}`);
        if (entry) entry.sold += 1;
      }
    }
    for (const block of calendarData.blocks) {
      const start = Math.max(0, diffDays(from, block.start_date));
      const end = Math.min(days.length, diffDays(from, block.end_date));
      for (let index = start; index < end; index += 1) {
        const entry = map.get(`${block.room_type_id}|${days[index]}`);
        if (entry && entry.blocked < entry.total) entry.blocked += 1;
      }
    }
    return map;
  }, [calendarData, days, from]);

  const availabilityFor = (roomTypeId: string, day: string, manual: number | null): number | null => {
    const entry = occupancy.get(`${roomTypeId}|${day}`);
    if (!entry || entry.total === 0) return manual;
    const computed = Math.max(0, entry.total - entry.sold - entry.blocked);
    if (manual == null) return computed;
    return Math.max(0, Math.min(manual, computed));
  };

  const plansByType = useMemo(() => {
    const map = new Map<string, RatePlanLite[]>();
    for (const roomType of rateData?.room_types ?? []) {
      map.set(
        roomType.id,
        (rateData?.rate_plans ?? []).filter(
          (plan) => plan.room_type_id == null || plan.room_type_id === roomType.id,
        ),
      );
    }
    return map;
  }, [rateData]);

  const currencyByType = useMemo(() => {
    const map = new Map<string, string>();
    for (const roomType of rateData?.room_types ?? []) {
      map.set(roomType.id, roomType.currency);
    }
    return map;
  }, [rateData?.room_types]);

  const rateMap = useMemo(() => {
    const map = new Map<string, RateRow>();
    for (const row of rateData?.rows ?? []) {
      map.set(`${row.room_type_id}|${row.rate_plan_id}|${row.stay_date}`, row);
    }
    return map;
  }, [rateData?.rows]);

  const rows = useMemo<GridRowModel[]>(() => {
    const list: GridRowModel[] = [];
    if (mode === 'rates') {
      for (const roomType of rateData?.room_types ?? []) {
        const isCollapsed = collapsed.includes(roomType.id);
        list.push({
          key: `type-${roomType.id}`,
          kind: 'type',
          height: TYPE_ROW_HEIGHT,
          roomTypeId: roomType.id,
          name: roomType.name,
          roomCount: roomCountOf(roomType.id),
          collapsed: isCollapsed,
        });
        if (isCollapsed) continue;
        for (const plan of plansByType.get(roomType.id) ?? []) {
          list.push({
            key: `plan-${roomType.id}-${plan.id}`,
            kind: 'plan',
            height: PLAN_ROW_HEIGHT,
            roomTypeId: roomType.id,
            roomTypeName: roomType.name,
            plan,
          });
        }
      }
      return list;
    }
    if (mode === 'reservations') {
      for (const roomType of calendarData?.room_types ?? []) {
        const isCollapsed = collapsed.includes(roomType.id);
        list.push({
          key: `type-${roomType.id}`,
          kind: 'type',
          height: TYPE_ROW_HEIGHT,
          roomTypeId: roomType.id,
          name: roomType.name,
          roomCount: roomType.rooms.filter((room) => room.active).length,
          collapsed: isCollapsed,
        });
        if (isCollapsed) continue;
        const overlapping = (calendarData?.reservations ?? []).filter(
          (reservation) =>
            reservation.room_type_id === roomType.id &&
            reservation.check_in < to &&
            reservation.check_out > from,
        );
        const { items, lanes } = assignLanes(overlapping);
        list.push({
          key: `bars-${roomType.id}`,
          kind: 'bars',
          height: Math.max(POOL_ROW_HEIGHT, lanes * (BAR_HEIGHT + LANE_GAP) + 12),
          roomTypeId: roomType.id,
          roomTypeName: roomType.name,
          items,
        });
      }
      return list;
    }
    for (const roomType of calendarData?.room_types ?? []) {
      const isCollapsed = collapsed.includes(roomType.id);
      const activeRooms = roomType.rooms.filter((room) => room.active);
      list.push({
        key: `type-${roomType.id}`,
        kind: 'type',
        height: TYPE_ROW_HEIGHT,
        roomTypeId: roomType.id,
        name: roomType.name,
        roomCount: activeRooms.length,
        collapsed: isCollapsed,
      });
      if (isCollapsed) continue;
      for (const room of activeRooms) {
        list.push({
          key: `room-${room.id}`,
          kind: 'room',
          height: ROOM_ROW_HEIGHT,
          roomType,
          room,
        });
      }
      const unassigned = (calendarData?.reservations ?? []).filter(
        (reservation) =>
          reservation.room_type_id === roomType.id &&
          !reservation.room_id &&
          reservation.check_in < to &&
          reservation.check_out > from,
      );
      if (unassigned.length > 0 || activeRooms.length === 0) {
        const { items, lanes } = assignLanes(unassigned);
        list.push({
          key: `pool-${roomType.id}`,
          kind: 'pool',
          height: Math.max(POOL_ROW_HEIGHT, lanes * (BAR_HEIGHT + LANE_GAP) + 12),
          roomType,
          items,
        });
      }
    }
    return list;
  }, [calendarData, collapsed, from, mode, plansByType, rateData?.room_types, to, roomTypeMap]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const selectionSeed = useMemo<BulkSeed | null>(() => {
    if (!rateData || selected.length === 0) return null;
    const planIds = new Set<string>();
    let minDate = '';
    let maxDate = '';
    for (const key of selected) {
      const [planId, date] = key.split('|');
      if (!planId || !date) continue;
      planIds.add(planId);
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
    }
    const plans = rateData.rate_plans.filter((plan) => planIds.has(plan.id));
    if (plans.length === 0) return null;
    const selectedTypeIds = new Set<string>();
    for (const plan of plans) {
      if (plan.room_type_id) {
        selectedTypeIds.add(plan.room_type_id);
      } else {
        for (const roomType of rateData.room_types) selectedTypeIds.add(roomType.id);
      }
    }
    return {
      from: minDate || from,
      to: addDaysIso(maxDate || from, 1),
      roomTypes: rateData.room_types
        .filter((roomType) => selectedTypeIds.has(roomType.id))
        .map((roomType) => ({ id: roomType.id, name: roomType.name })),
      ratePlans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        room_type_id: plan.room_type_id,
      })),
    };
  }, [from, rateData, selected]);

  const rangeLabel = `${formatDateShort(from)} – ${formatDateShort(addDaysIso(to, -1))}`;
  const activeReservations = calendarData?.reservations.length ?? 0;
  const activePlans = rateData?.rate_plans.length ?? 0;
  const activeRoomTypes = rateData?.room_types.length ?? calendarData?.room_types.length ?? 0;
  const hasPlans = activePlans > 0;

  const shift = (direction: -1 | 1) => {
    setFrom((current) => addDaysIso(current, direction * config.days));
    setSelected([]);
  };

  const goToday = () => {
    setFrom(today);
    setSelected([]);
    horizontalRef.current?.scrollTo({ x: 0, animated: true });
  };

  const changeMode = (next: CalendarMode) => {
    setMode(next);
    setSelected([]);
    setSelectMode(false);
    setEditor(null);
    horizontalRef.current?.scrollTo({ x: 0, animated: false });
  };

  const changeView = (next: CalendarViewMode) => {
    setView(next);
    setSelected([]);
    horizontalRef.current?.scrollTo({ x: 0, animated: false });
  };

  const toggleCategory = (roomTypeId: string) =>
    setCollapsed((current) =>
      current.includes(roomTypeId)
        ? current.filter((item) => item !== roomTypeId)
        : [...current, roomTypeId],
    );

  const toggleSelection = (planId: string, day: string) => {
    const key = `${planId}|${day}`;
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const openEmptyCell = (
    roomTypeId: string,
    roomTypeName: string,
    date: string,
    room?: CalendarRoom,
  ) => {
    onEmptyCellPress({
      date,
      roomId: room?.id ?? null,
      roomNumber: room?.number ?? null,
      roomTypeId,
      roomTypeName,
    });
  };

  const reservationsForRoom = (roomId: string): CalendarReservation[] =>
    (calendarData?.reservations ?? []).filter(
      (reservation) =>
        reservation.room_id === roomId &&
        reservation.check_in < to &&
        reservation.check_out > from,
    );

  const blocksForRoom = (roomId: string): CalendarBlock[] =>
    (calendarData?.blocks ?? []).filter(
      (block) => block.room_id === roomId && block.start_date < to && block.end_date > from,
    );

  const renderBar = (
    reservation: CalendarReservation,
    lane: number,
    prefix: string,
  ) => {
    const start = Math.max(0, diffDays(from, reservation.check_in));
    const end = Math.min(days.length, diffDays(from, reservation.check_out));
    if (end <= 0 || start >= days.length || end <= start) return null;
    const tone = reservationTone(reservation.status);
    const width = (end - start) * dayWidth - 4;
    const label = width >= 104 ? reservation.guest_name : width >= 46 ? tone.short : '';
    return (
      <Pressable
        key={`${prefix}-${reservation.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${reservation.guest_name}, ${tone.label}, ${reservation.nights} gece`}
        onPress={() => onReservationPress(reservation)}
        style={[
          styles.bar,
          {
            left: start * dayWidth + 2,
            top: 6 + lane * (BAR_HEIGHT + LANE_GAP),
            width,
            height: BAR_HEIGHT,
            backgroundColor: tone.background,
            borderColor: tone.border,
          },
        ]}
      >
        <View style={[styles.barStrip, { backgroundColor: tone.color }]} />
        {label ? (
          <AppText numberOfLines={1} style={[styles.barText, { color: tone.color }]}>
            {label}
          </AppText>
        ) : null}
        {width >= 150 && reservation.paid_cents > 0 ? (
          <Ionicons name="cash-outline" size={10} color={tone.color} />
        ) : null}
      </Pressable>
    );
  };

  const openRateEditor = (row: Extract<GridRowModel, { kind: 'plan' }>, day: string) => {
    const key = `${row.roomTypeId}|${row.plan.id}|${day}`;
    const rate = rateMap.get(key) ?? null;
    setEditor({
      roomTypeId: row.roomTypeId,
      roomTypeName: row.roomTypeName,
      ratePlanId: row.plan.id,
      ratePlanName: row.plan.name,
      date: day,
      row: rate,
      available: availabilityFor(row.roomTypeId, day, rate?.available_rooms ?? null),
    });
  };

  const onRateCellPress = (row: Extract<GridRowModel, { kind: 'plan' }>, day: string) => {
    if (selectMode) {
      toggleSelection(row.plan.id, day);
      return;
    }
    openRateEditor(row, day);
  };

  const refresh = () => {
    void calendar.refetch();
    void rateCalendar.refetch();
  };

  const error = mode === 'rates' ? (rateCalendar.error ?? calendar.error) : calendar.error;
  const loading = mode === 'rates' ? rateCalendar.isLoading : calendar.isLoading;
  const leftHeader =
    mode === 'rates'
      ? 'ODA TİPİ / FİYAT PLANI'
      : mode === 'reservations'
        ? 'ODA TİPİ / REZERVASYON'
        : 'ODA / KATEGORİ';

  const subtitle =
    mode === 'rates'
      ? `${activeRoomTypes} oda tipi · ${activePlans} fiyat planı`
      : mode === 'reservations'
        ? `${activeReservations} rezervasyon · ${calendarData?.room_types.length ?? 0} oda tipi`
        : `${calendarData?.room_types.reduce(
            (total, roomType) => total + roomType.rooms.filter((room) => room.active).length,
            0,
          ) ?? 0} oda · ${calendarData?.room_types.length ?? 0} kategori`;

  const legend =
    mode === 'rates' ? (
      <>
        <LegendDot color={theme.colors.success} label="Müsait" />
        <LegendDot color={theme.colors.warning} label="Az kaldı" />
        <LegendDot color={theme.colors.danger} label="Dolu" />
        <LegendDot color={theme.colors.textTertiary} label="Satışa kapalı" />
        <LegendDot color={theme.colors.primaryDeep} label="Manuel kayıt" />
      </>
    ) : mode === 'reservations' ? (
      <>
        {(['pending', 'confirmed', 'awaiting_checkin', 'checked_in', 'cancelled'] as const).map(
          (status) => {
            const tone = reservationTone(status);
            return <LegendDot key={status} color={tone.color} label={tone.label} />;
          },
        )}
      </>
    ) : (
      <>
        {(['clean', 'dirty', 'maintenance'] as const).map((status) => {
          const tone = roomStatusTone(status);
          return <LegendDot key={status} color={tone.color} label={tone.label} />;
        })}
        <LegendDot color={theme.colors.textTertiary} label="Bloke / bakım" />
      </>
    );

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={[styles.toolbar, { borderBottomColor: theme.colors.divider }]}>
        <View style={styles.toolbarTop}>
          <View style={styles.navGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Önceki tarih aralığı"
              onPress={() => shift(-1)}
              style={[styles.iconButton, { backgroundColor: theme.colors.surfaceMuted }]}
            >
              <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sonraki tarih aralığı"
              onPress={() => shift(1)}
              style={[styles.iconButton, { backgroundColor: theme.colors.surfaceMuted }]}
            >
              <Ionicons name="chevron-forward" size={18} color={theme.colors.text} />
            </Pressable>
            <View style={styles.rangeBlock}>
              <AppText variant="bodyStrong">{rangeLabel}</AppText>
              <AppText variant="caption" color="textTertiary">
                {loading ? 'Takvim yükleniyor' : subtitle}
              </AppText>
            </View>
          </View>
          <View style={styles.toolbarActions}>
            <Chip label="Bugün" icon="locate-outline" onPress={goToday} />
            {mode === 'rates' ? (
              <>
                <Chip
                  label="Çoklu seçim"
                  icon="checkbox-outline"
                  active={selectMode}
                  onPress={() => {
                    setSelectMode((current) => !current);
                    setSelected([]);
                  }}
                />
                <Chip
                  label="Toplu güncelle"
                  icon="layers-outline"
                  onPress={() => setBulkSeed(selectionSeed ?? { from, to: addDaysIso(from, 1), roomTypes: [], ratePlans: [] })}
                />
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Takvimi yenile"
              onPress={refresh}
              style={[styles.iconButton, { backgroundColor: theme.colors.surfaceMuted }]}
            >
              {calendar.isRefetching || rateCalendar.isRefetching ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <Ionicons name="refresh" size={17} color={theme.colors.textSecondary} />
              )}
            </Pressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.viewChips}>
          {MODE_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              icon={option.icon}
              active={mode === option.value}
              onPress={() => changeMode(option.value)}
            />
          ))}
          <View style={[styles.chipDivider, { backgroundColor: theme.colors.divider }]} />
          {VIEW_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={view === option.value}
              onPress={() => changeView(option.value)}
            />
          ))}
        </ScrollView>

        <View style={styles.legend}>{legend}</View>

        {mode === 'rates' && selectMode ? (
          <View
            style={[
              styles.selectionBar,
              { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primaryDeep },
            ]}
          >
            <AppText variant="caption" color="primaryDeep">
              {selected.length > 0 ? `${selected.length} hücre seçildi` : 'Toplu işlem için hücre seç'}
            </AppText>
            <View style={styles.selectionActions}>
              <Chip
                label="Toplu güncelle"
                icon="layers-outline"
                active={Boolean(selectionSeed)}
                onPress={() => {
                  if (selectionSeed) setBulkSeed(selectionSeed);
                }}
              />
              <Chip label="Temizle" icon="close-outline" onPress={() => setSelected([])} />
            </View>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorWrap}>
          <InlineError
            message={error instanceof Error ? error.message : 'Takvim yüklenemedi.'}
            onRetry={refresh}
          />
        </View>
      ) : null}

      {mode === 'rates' && !loading && !hasPlans && activeRoomTypes > 0 ? (
        <View style={[styles.notice, { backgroundColor: theme.colors.warningSoft }]}>
          <Ionicons name="information-circle-outline" size={14} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Fiyat planı tanımlanmamış. Yalnızca müsaitlik gösteriliyor. Fiyat Planları sekmesinden plan
            ekleyerek hücreleri düzenleyebilirsin.
          </AppText>
        </View>
      ) : null}

      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
        <View style={styles.table}>
          <View
            style={[
              styles.leftColumn,
              { width: leftWidth, borderRightColor: theme.colors.divider },
            ]}
          >
            <View
              style={[
                styles.leftHead,
                {
                  backgroundColor: theme.colors.surfaceMuted,
                  borderBottomColor: theme.colors.divider,
                },
              ]}
            >
              <AppText variant="caption" color="textTertiary" style={styles.leftHeadText}>
                {leftHeader}
              </AppText>
            </View>
            {rows.map((row) => (
              <View
                key={row.key}
                style={[
                  styles.leftCell,
                  {
                    height: row.height,
                    borderBottomColor: theme.colors.divider,
                    backgroundColor:
                      row.kind === 'type' ? theme.colors.surfaceMuted : theme.colors.surface,
                  },
                ]}
              >
                {row.kind === 'type' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name} kategorisini ${row.collapsed ? 'aç' : 'kapat'}`}
                    onPress={() => toggleCategory(row.roomTypeId)}
                    style={styles.typeCell}
                  >
                    <Ionicons
                      name={row.collapsed ? 'chevron-forward' : 'chevron-down'}
                      size={14}
                      color={theme.colors.textSecondary}
                    />
                    <View style={styles.flex}>
                      <AppText variant="caption" color="text" numberOfLines={1} style={styles.name}>
                        {row.name}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                        {row.roomCount} oda
                      </AppText>
                    </View>
                  </Pressable>
                ) : row.kind === 'plan' ? (
                  <View style={styles.planCell}>
                    <View style={[styles.planBullet, { backgroundColor: theme.colors.primary }]} />
                    <View style={styles.flex}>
                      <AppText variant="caption" color="text" numberOfLines={1} style={styles.name}>
                        {row.plan.name}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" style={styles.tiny} numberOfLines={1}>
                        {BOOKING_MODE_LABELS[row.plan.booking_mode]} · min {row.plan.min_stay}
                      </AppText>
                    </View>
                  </View>
                ) : row.kind === 'bars' ? (
                  <View style={styles.typeCell}>
                    <Ionicons name="albums-outline" size={13} color={theme.colors.primaryDeep} />
                    <View style={styles.flex}>
                      <AppText variant="caption" color="text" numberOfLines={1} style={styles.name}>
                        Rezervasyonlar
                      </AppText>
                      <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                        {row.items.length} kayıt
                      </AppText>
                    </View>
                  </View>
                ) : row.kind === 'room' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${row.room.number} odası`}
                    onPress={() => onRoomPress(row.room, row.roomType)}
                    style={styles.roomCell}
                  >
                    <View
                      style={[
                        styles.roomStatusDot,
                        { backgroundColor: roomStatusTone(row.room.status).color },
                      ]}
                    />
                    <View style={styles.flex}>
                      <AppText variant="bodyStrong" color="text" style={styles.roomNumber}>
                        {row.room.number}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" style={styles.tiny} numberOfLines={1}>
                        {row.room.floor ? `${row.room.floor}. kat · ` : ''}
                        {roomStatusTone(row.room.status).label}
                      </AppText>
                    </View>
                    <Ionicons name="ellipsis-horizontal" size={13} color={theme.colors.textTertiary} />
                  </Pressable>
                ) : (
                  <View style={styles.typeCell}>
                    <Ionicons name="layers-outline" size={13} color={theme.colors.primaryDeep} />
                    <View style={styles.flex}>
                      <AppText variant="caption" color="text" numberOfLines={1} style={styles.name}>
                        Oda atanmamış
                      </AppText>
                      <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                        {row.items.length} rezervasyon
                      </AppText>
                    </View>
                  </View>
                )}
              </View>
            ))}
            {rows.length === 0 && !loading ? (
              <View style={[styles.leftCell, { borderBottomColor: theme.colors.divider }]}>
                <AppText variant="caption" color="textTertiary">
                  {mode === 'rates' ? 'Fiyat planı yok' : 'Oda tipi yok'}
                </AppText>
              </View>
            ) : null}
          </View>

          <ScrollView
            horizontal
            ref={horizontalRef}
            nestedScrollEnabled
            showsHorizontalScrollIndicator
          >
            <View style={{ width: gridWidth }}>
              <View style={styles.dayHeaderRow}>
                {days.map((day) => {
                  const date = isoToDate(day);
                  const isToday = day === today;
                  const weekend = date.getDay() === 0 || date.getDay() === 6;
                  return (
                    <View
                      key={day}
                      style={[
                        styles.dayHeader,
                        {
                          width: dayWidth,
                          borderRightColor: theme.colors.divider,
                          borderBottomColor: theme.colors.divider,
                          backgroundColor: isToday
                            ? theme.colors.primaryDeep
                            : weekend
                              ? theme.colors.surfaceMuted
                              : theme.colors.surface,
                        },
                      ]}
                    >
                      <AppText
                        style={[
                          styles.weekday,
                          {
                            color: isToday
                              ? theme.colors.onPrimary
                              : weekend
                                ? theme.colors.danger
                                : theme.colors.textTertiary,
                          },
                        ]}
                      >
                        {formatWeekdayShort(day)}
                      </AppText>
                      <AppText
                        style={[
                          styles.dayNumber,
                          {
                            color: isToday ? theme.colors.onPrimary : theme.colors.text,
                          },
                        ]}
                      >
                        {day.slice(8, 10)}
                      </AppText>
                      {dayWidth >= 64 ? (
                        <AppText
                          style={[
                            styles.month,
                            {
                              color: isToday
                                ? theme.colors.onPrimary
                                : theme.colors.textTertiary,
                            },
                          ]}
                        >
                          {monthShort(day)}
                        </AppText>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {rows.map((row) => {
                const weekend = (day: string) => {
                  const index = isoToDate(day).getDay();
                  return index === 0 || index === 6;
                };
                const baseBackground = (day: string) =>
                  weekend(day) ? `${theme.colors.textTertiary}08` : 'transparent';

                if (row.kind === 'type') {
                  return (
                    <View
                      key={row.key}
                      style={[
                        styles.gridRow,
                        {
                          height: row.height,
                          borderBottomColor: theme.colors.divider,
                          backgroundColor: theme.colors.surfaceMuted,
                        },
                      ]}
                    >
                      {days.map((day) => {
                        const entry = occupancy.get(`${row.roomTypeId}|${day}`);
                        const available = availabilityFor(row.roomTypeId, day, null);
                        const busy = entry ? entry.sold + entry.blocked : 0;
                        const ratio = entry && entry.total > 0 ? Math.min(1, busy / entry.total) : 0;
                        const soldOut = available != null && available <= 0 && (entry?.total ?? 0) > 0;
                        const background = soldOut
                          ? theme.colors.dangerSoft
                          : ratio >= 0.8
                            ? theme.colors.warningSoft
                            : 'transparent';
                        const accent = soldOut
                          ? theme.colors.danger
                          : ratio >= 0.8
                            ? theme.colors.warning
                            : theme.colors.text;
                        return (
                          <View
                            key={day}
                            style={[
                              styles.cellBase,
                              {
                                width: dayWidth,
                                borderRightColor: theme.colors.divider,
                                backgroundColor: background,
                              },
                            ]}
                          >
                            <AppText style={[styles.typeCellNumber, { color: accent }]}>
                              {available == null ? '—' : available}
                            </AppText>
                            <View style={[styles.occBar, { backgroundColor: `${theme.colors.textTertiary}33` }]}>
                              <View
                                style={[
                                  styles.occBarFill,
                                  {
                                    width: `${Math.round(ratio * 100)}%`,
                                    backgroundColor: soldOut ? theme.colors.danger : theme.colors.primary,
                                  },
                                ]}
                              />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                }

                if (row.kind === 'plan') {
                  const currency = currencyByType.get(row.roomTypeId) ?? 'TRY';
                  return (
                    <View
                      key={row.key}
                      style={[
                        styles.gridRow,
                        { height: row.height, borderBottomColor: theme.colors.divider },
                      ]}
                    >
                      {days.map((day) => {
                        const rate = rateMap.get(`${row.roomTypeId}|${row.plan.id}|${day}`);
                        const manual = rate?.available_rooms ?? null;
                        const available = availabilityFor(row.roomTypeId, day, manual);
                        const total = occupancy.get(`${row.roomTypeId}|${day}`)?.total ?? 0;
                        const closed = Boolean(rate?.closed);
                        const soldOut = !closed && available != null && available <= 0;
                        const low =
                          !closed &&
                          available != null &&
                          available > 0 &&
                          available <= Math.max(1, Math.ceil(total * 0.2));
                        const background = closed
                          ? theme.colors.surfaceMuted
                          : soldOut
                            ? theme.colors.dangerSoft
                            : low
                              ? theme.colors.warningSoft
                              : baseBackground(day);
                        const statusColor = closed
                          ? theme.colors.textTertiary
                          : soldOut
                            ? theme.colors.danger
                            : low
                              ? theme.colors.warning
                              : theme.colors.success;
                        const isSelected = selectedSet.has(`${row.plan.id}|${day}`);
                        return (
                          <Pressable
                            key={day}
                            accessibilityRole="button"
                            accessibilityLabel={`${row.roomTypeName} ${row.plan.name} ${day} fiyat ve müsaitlik`}
                            accessibilityState={{ selected: isSelected }}
                            onPress={() => onRateCellPress(row, day)}
                            onLongPress={() => {
                              setSelectMode(true);
                              toggleSelection(row.plan.id, day);
                            }}
                            style={[
                              styles.cellBase,
                              {
                                width: dayWidth,
                                borderRightColor: theme.colors.divider,
                                backgroundColor: background,
                              },
                            ]}
                          >
                            <AppText
                              numberOfLines={1}
                              style={[
                                styles.ratePrice,
                                {
                                  color: closed ? theme.colors.textTertiary : theme.colors.text,
                                },
                              ]}
                            >
                              {rate
                                ? formatMoneyCents(rate.base_price_cents, currency, { decimals: false })
                                : '—'}
                            </AppText>
                            <View style={styles.rateMetaRow}>
                              {manual != null ? (
                                <View style={[styles.manualDot, { backgroundColor: theme.colors.primaryDeep }]} />
                              ) : null}
                              <AppText
                                numberOfLines={1}
                                style={[styles.rateMeta, { color: statusColor }]}
                              >
                                {closed
                                  ? 'Kapalı'
                                  : available == null
                                    ? '—'
                                    : available <= 0
                                      ? 'Dolu'
                                      : `${available} oda`}
                              </AppText>
                            </View>
                            {rate?.closed_to_arrival || rate?.closed_to_departure ? (
                              <View
                                style={[
                                  styles.restrictionBadge,
                                  { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warning },
                                ]}
                              >
                                <AppText style={[styles.restrictionText, { color: theme.colors.warning }]}>
                                  {rate.closed_to_arrival && rate.closed_to_departure
                                    ? 'G/Ç'
                                    : rate.closed_to_arrival
                                      ? 'G'
                                      : 'Ç'}
                                </AppText>
                              </View>
                            ) : null}
                            {isSelected ? (
                              <View
                                pointerEvents="none"
                                style={[styles.selectRing, { borderColor: theme.colors.primaryDeep }]}
                              />
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                }

                if (row.kind === 'bars' || row.kind === 'pool') {
                  const items = row.items;
                  const roomTypeId = row.kind === 'bars' ? row.roomTypeId : row.roomType.id;
                  const roomTypeName = row.kind === 'bars' ? row.roomTypeName : row.roomType.name;
                  return (
                    <View
                      key={row.key}
                      style={[
                        styles.gridRow,
                        { height: row.height, borderBottomColor: theme.colors.divider },
                      ]}
                    >
                      {days.map((day) => (
                        <Pressable
                          key={day}
                          accessibilityRole="button"
                          accessibilityLabel={`${roomTypeName} ${day} rezervasyon oluştur`}
                          onPress={() => openEmptyCell(roomTypeId, roomTypeName, day)}
                          style={[
                            styles.cellBase,
                            {
                              width: dayWidth,
                              borderRightColor: theme.colors.divider,
                              backgroundColor: baseBackground(day),
                            },
                          ]}
                        />
                      ))}
                      {items.map(({ reservation, lane }) =>
                        renderBar(reservation, lane, row.key),
                      )}
                    </View>
                  );
                }

                const reservations = reservationsForRoom(row.room.id);
                const blocks = blocksForRoom(row.room.id);
                return (
                  <View
                    key={row.key}
                    style={[
                      styles.gridRow,
                      { height: row.height, borderBottomColor: theme.colors.divider },
                    ]}
                  >
                    {days.map((day) => (
                      <Pressable
                        key={day}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.room.number} ${day} rezervasyon oluştur`}
                        onPress={() => openEmptyCell(row.roomType.id, row.roomType.name, day, row.room)}
                        style={[
                          styles.cellBase,
                          {
                            width: dayWidth,
                            borderRightColor: theme.colors.divider,
                            backgroundColor: baseBackground(day),
                          },
                        ]}
                      />
                    ))}
                    {reservations.map((reservation) => renderBar(reservation, 0, row.key))}
                    {blocks.map((block) => {
                      const start = Math.max(0, diffDays(from, block.start_date));
                      const end = Math.min(days.length, diffDays(from, block.end_date));
                      if (end <= 0 || start >= days.length || end <= start) return null;
                      return (
                        <Pressable
                          key={block.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Bloke: ${block.reason ?? 'bakım'}`}
                          onPress={() => onBlockPress?.(block)}
                          style={[
                            styles.blockBar,
                            {
                              left: start * dayWidth + 2,
                              top: 8,
                              width: (end - start) * dayWidth - 4,
                              height: row.height - 16,
                              borderColor: theme.colors.borderStrong,
                              backgroundColor: theme.colors.surfaceMuted,
                            },
                          ]}
                        >
                          {dayWidth >= 64 ? (
                            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                              {block.reason ?? 'Bloke'}
                            </AppText>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.colors.primary} />
            <AppText variant="caption" color="textSecondary">
              Takvim yükleniyor…
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.colors.divider }]}>
        <Ionicons name="information-circle-outline" size={14} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          {mode === 'rates'
            ? 'Hücreye dokunarak gecelik fiyat, müsait oda ve kısıtları düzenle. Çoklu seçimde seçtiğin günlere toplu işlem uygula.'
            : mode === 'reservations'
              ? 'Boş hücreye dokunarak rezervasyon oluştur; renkli bardan rezervasyon detayını aç.'
              : 'Oda satırında blok ve rezervasyonları görürsün; boş hücre yeni rezervasyon başlatır.'}
        </AppText>
      </View>

      <RateCellEditor
        propertyId={propertyId}
        target={editor}
        onClose={() => setEditor(null)}
        onSaved={() => {
          setEditor(null);
          refresh();
        }}
        onBulk={() => {
          if (!editor) return;
          setBulkSeed({
            from: editor.date,
            to: addDaysIso(editor.date, 1),
            roomTypes: [{ id: editor.roomTypeId, name: editor.roomTypeName }],
            ratePlans: [
              {
                id: editor.ratePlanId,
                name: editor.ratePlanName,
                room_type_id: editor.roomTypeId,
              },
            ],
          });
          setEditor(null);
        }}
        onCreateReservation={() => {
          if (!editor) return;
          openEmptyCell(editor.roomTypeId, editor.roomTypeName, editor.date);
          setEditor(null);
        }}
      />

      <BulkRateModal
        visible={Boolean(bulkSeed)}
        onClose={() => {
          setBulkSeed(null);
          refresh();
        }}
        propertyId={propertyId}
        defaultFrom={bulkSeed?.from ?? from}
        defaultTo={bulkSeed?.to ?? addDaysIso(from, 1)}
        roomTypes={bulkSeed?.roomTypes ?? []}
        ratePlans={bulkSeed?.ratePlans ?? []}
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

function RateCellEditor({
  propertyId,
  target,
  onClose,
  onSaved,
  onBulk,
  onCreateReservation,
}: {
  propertyId: string;
  target: EditorTarget | null;
  onClose: () => void;
  onSaved: () => void;
  onBulk: () => void;
  onCreateReservation: () => void;
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
    setPrice(target.row ? centsToInput(target.row.base_price_cents) : '');
    setAvailability(target.row?.available_rooms != null ? String(target.row.available_rooms) : '');
    setMinStay(target.row?.min_stay != null ? String(target.row.min_stay) : '');
    setMaxStay(target.row?.max_stay != null ? String(target.row.max_stay) : '');
    setClosed(Boolean(target.row?.closed));
    setClosedArrival(Boolean(target.row?.closed_to_arrival));
    setClosedDeparture(Boolean(target.row?.closed_to_departure));
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
      if (nextPrice != null && nextPrice !== (original?.base_price_cents ?? null)) {
        await run('set_price', nextPrice / 100);
      }
      if (availability.trim() !== '' && Number(availability) !== (original?.available_rooms ?? null)) {
        await run('set_availability', Math.max(0, Number(availability)));
      }
      if (minStay.trim() !== '' && Number(minStay) !== (original?.min_stay ?? null)) {
        await run('set_min_stay', Math.max(1, Number(minStay)));
      }
      if (maxStay.trim() !== '' && Number(maxStay) !== (original?.max_stay ?? null)) {
        await run('set_max_stay', Math.max(1, Number(maxStay)));
      }
      if (closed !== Boolean(original?.closed)) {
        await run(closed ? 'close' : 'open', null);
      }
      if (closedArrival !== Boolean(original?.closed_to_arrival)) {
        await run(closedArrival ? 'close_arrival' : 'open_arrival', null);
      }
      if (closedDeparture !== Boolean(original?.closed_to_departure)) {
        await run(closedDeparture ? 'close_departure' : 'open_departure', null);
      }
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hücre güncellenemedi.');
    } finally {
      setSaving(false);
    }
  };

  const quickSoldOut = async () => {
    if (!target) return;
    setError(null);
    setSaving(true);
    try {
      await run('set_availability', 0);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Müsaitlik güncellenemedi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet
      visible={Boolean(target)}
      onClose={onClose}
      title={target ? formatDateLong(target.date) : 'Fiyat'}
      subtitle={target ? `${target.roomTypeName} · ${target.ratePlanName}` : undefined}
      maxWidth={560}
      footer={
        <View style={styles.footerButtons}>
          <Button label="Vazgeç" variant="outline" onPress={onClose} style={styles.flex} />
          <Button label="Kaydet" loading={saving} onPress={() => void save()} style={styles.flex} />
        </View>
      }
    >
      <View style={styles.editor}>
        {target ? (
          <View style={[styles.editorSummary, { backgroundColor: theme.colors.surfaceMuted }]}>
            <View style={styles.flex}>
              <AppText variant="caption" color="textSecondary">
                Hesaplanan müsaitlik
              </AppText>
              <AppText variant="bodyStrong" color="text">
                {target.available == null ? 'Bilinmiyor' : `${target.available} oda`}
              </AppText>
            </View>
            <View style={styles.editorSummaryRight}>
              <AppText variant="caption" color="textTertiary">
                {target.row?.is_set ? 'Manuel kayıt' : 'Fiyat plandan geliyor'}
              </AppText>
            </View>
          </View>
        ) : null}

        <View style={styles.editorRow}>
          <TextField
            label="Gecelik fiyat (₺)"
            value={price}
            onChangeText={(next) => setPrice(next.replace(/[^\d.,]/g, ''))}
            keyboardType="decimal-pad"
            containerStyle={styles.flex}
          />
          <TextField
            label="Müsait oda (manuel)"
            value={availability}
            onChangeText={(next) => setAvailability(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            placeholder={target?.available != null ? String(target.available) : 'Boş = otomatik'}
            containerStyle={styles.flex}
          />
        </View>

        <View style={styles.stepperRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Müsaitliği bir azalt"
            onPress={() =>
              setAvailability((current) => String(Math.max(0, Number(current || 0) - 1)))
            }
            style={[styles.stepperButton, { backgroundColor: theme.colors.surfaceMuted }]}
          >
            <Ionicons name="remove" size={16} color={theme.colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Müsaitliği bir artır"
            onPress={() => setAvailability((current) => String(Number(current || 0) + 1))}
            style={[styles.stepperButton, { backgroundColor: theme.colors.surfaceMuted }]}
          >
            <Ionicons name="add" size={16} color={theme.colors.text} />
          </Pressable>
          <Chip label="Dolu yap" icon="close-circle-outline" onPress={() => void quickSoldOut()} />
          <Chip label="Otomatik" icon="sync-outline" onPress={() => setAvailability('')} />
        </View>

        <View style={styles.editorRow}>
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

        <ToggleRow
          label="Satışa kapalı"
          description="Bu gün rezervasyon alınmaz"
          value={closed}
          onChange={setClosed}
        />
        <ToggleRow
          label="Girişe kapalı"
          description="Bu gün giriş yapılamaz"
          value={closedArrival}
          onChange={setClosedArrival}
        />
        <ToggleRow
          label="Çıkışa kapalı"
          description="Bu gün çıkış yapılamaz"
          value={closedDeparture}
          onChange={setClosedDeparture}
        />

        <View style={styles.editorActions}>
          <Chip label="Rezervasyon oluştur" icon="add-circle-outline" onPress={onCreateReservation} />
          <Chip label="Toplu düzenle" icon="layers-outline" onPress={onBulk} />
        </View>

        {error ? (
          <InlineError message={error} />
        ) : (
          <AppText variant="caption" color="textTertiary">
            Manuel müsaitlik boş bırakılırsa rezervasyon ve bloklardan otomatik hesaplanır. Onaylı
            rezervasyonların fiyatı değişmez.
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
  toolbarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    flexWrap: 'wrap',
  },
  navGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  rangeBlock: { marginLeft: 4 },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewChips: { gap: 6, paddingHorizontal: 12, alignItems: 'center' },
  chipDivider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontSize: 9 },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginHorizontal: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorWrap: { padding: 12 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  table: { flexDirection: 'row' },
  leftColumn: { borderRightWidth: StyleSheet.hairlineWidth },
  leftHead: {
    height: HEADER_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leftHeadText: { fontSize: 9, letterSpacing: 0.4 },
  leftCell: {
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  typeCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planCell: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12 },
  planBullet: { width: 5, height: 5, borderRadius: 3 },
  roomCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roomStatusDot: { width: 6, height: 6, borderRadius: 3 },
  roomNumber: { fontSize: 12 },
  name: { fontSize: 11 },
  tiny: { fontSize: 8, lineHeight: 11 },
  dayHeaderRow: { flexDirection: 'row', height: HEADER_HEIGHT },
  dayHeader: {
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  weekday: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.3 },
  dayNumber: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  month: { fontSize: 8 },
  gridRow: { flexDirection: 'row', position: 'relative', borderBottomWidth: StyleSheet.hairlineWidth },
  cellBase: {
    height: '100%',
    borderRightWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingHorizontal: 5,
    gap: 2,
  },
  typeCellNumber: { fontSize: 13, lineHeight: 16, fontWeight: '700' },
  occBar: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 1 },
  occBarFill: { height: 3, borderRadius: 2 },
  ratePrice: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  rateMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rateMeta: { fontSize: 8, lineHeight: 10 },
  manualDot: { width: 4, height: 4, borderRadius: 2 },
  restrictionBadge: {
    position: 'absolute',
    top: 4,
    right: 3,
    paddingHorizontal: 3,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  restrictionText: { fontSize: 7, fontWeight: '700' },
  selectRing: {
    position: 'absolute',
    top: 1,
    bottom: 1,
    left: 1,
    right: 1,
    borderWidth: 2,
    borderRadius: 4,
  },
  bar: {
    position: 'absolute',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingRight: 4,
    overflow: 'hidden',
  },
  barStrip: { width: 3, height: '100%' },
  barText: { fontSize: 10, lineHeight: 12, flexShrink: 1 },
  blockBar: {
    position: 'absolute',
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 14 },
  footer: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerButtons: { flexDirection: 'row', gap: 8 },
  editor: { gap: 12 },
  editorSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
  editorSummaryRight: { alignItems: 'flex-end' },
  editorRow: { flexDirection: 'row', gap: 10 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  stepperButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  editorActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
});
