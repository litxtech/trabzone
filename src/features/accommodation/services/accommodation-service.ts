import { rpcError } from '@/services/rpc';
import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AccommodationContext,
  AccommodationDocument,
  ActivityListData,
  AdminProperty,
  AdminPropertyList,
  BookResult,
  BulkRateAction,
  BulkRateResult,
  CalendarData,
  Campaign,
  CampaignListData,
  CashAccount,
  CashOverview,
  CashTransaction,
  CommissionSummary,
  DailyReport,
  Dashboard,
  DocumentsListData,
  FinanceSummary,
  FrontDeskData,
  GuestListData,
  HousekeepingData,
  ManagedProperty,
  ManagedRatePlan,
  ManagedRoom,
  ManagedRoomType,
  MediaListData,
  MediaItem,
  MessageListData,
  MessageThreadListData,
  MyReservation,
  MyReservationDetail,
  PropertyDocumentListData,
  PropertyInventory,
  PropertyMissingResponse,
  PropertySettings,
  PublicFilters,
  PublicProperty,
  Quote,
  RateCalendarData,
  ReportData,
  ReservationAvailableRoom,
  ReservationDetail,
  ReservationListResponse,
  ReservationAction,
  ReservationSource,
  ReviewListData,
  SearchResponse,
  StaffListData,
  StaffMember,
  StaffRole,
  WebTracking,
  BookingMode,
  MediaCategory,
  PaymentStatus,
  ReservationStatus,
} from '../types';

/**
 * Trabzone Konaklama servis katmanı.
 *
 * Bütün yazma işlemleri Supabase RPC'lerine gider; tablolara doğrudan yazma
 * yoktur. Hata kodları `rpcError` üzerinden kullanıcıya gösterilebilir Türkçe
 * mesaja çevrilir.
 */

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    return fail(rpcError(error));
  }
  if (data === null || data === undefined) {
    return fail(appError('unknown', 'Sunucudan yanıt alınamadı. Tekrar dene.'));
  }
  return ok(data as T);
}

function dateOnly(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function todayIso(): string {
  return dateOnly(new Date());
}

export function isoAddDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return dateOnly(addDays(new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1), days));
}

// -----------------------------------------------------------------------------
// Genel / keşfet
// -----------------------------------------------------------------------------

export function fetchMyContext(): Promise<Result<AccommodationContext>> {
  return call<AccommodationContext>('acc_my_context');
}

export function fetchPublicFilters(): Promise<Result<PublicFilters>> {
  return call<PublicFilters>('acc_public_filters');
}

export type PropertyLocationNeighborhood = { id: number; name: string };

export type PropertyLocationOption = {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
  neighborhoods: PropertyLocationNeighborhood[];
};

/**
 * Tesis ekleme/düzenleme formunun ilçe ve mahalle listesi.
 *
 * `acc_public_filters` yalnızca **yayında tesis bulunan** ilçeleri döndürüyor;
 * ilk tesisini ekleyen bir işletmeci bu yüzden boş liste görüyor ve ilçe
 * seçemediği için ilerleyemiyordu. Birincil kaynak `acc_property_location_options`
 * (şehrin tüm ilçeleri + mahalleleri). Bu çağrı başarısız olursa sırasıyla
 * `explore_bootstrap` ve eski filtre listesine düşülür, yani form hiçbir
 * durumda ilçesiz kalmaz.
 */
export async function fetchPropertyLocationOptions(): Promise<Result<PropertyLocationOption[]>> {
  const city = await call<{
    districts?: PropertyLocationOption[] | null;
  }>('acc_property_location_options');

  if (city.ok) {
    const districts = normalizeDistrictOptions(city.data.districts);
    if (districts.length > 0) {
      return ok(districts);
    }
  }

  const bootstrap = await call<{
    districts?: PropertyLocationOption[] | null;
  }>('explore_bootstrap');

  if (bootstrap.ok) {
    const districts = normalizeDistrictOptions(bootstrap.data.districts);
    if (districts.length > 0) {
      return ok(districts);
    }
  }

  const filters = await fetchPublicFilters();
  if (filters.ok) {
    return ok(
      filters.data.districts.map((district) => ({
        id: district.id,
        name: district.name,
        lat: null,
        lng: null,
        neighborhoods: [],
      })),
    );
  }
  if (bootstrap.ok) {
    return ok([]);
  }
  return fail(bootstrap.error);
}

function normalizeDistrictOptions(
  input: PropertyLocationOption[] | null | undefined,
): PropertyLocationOption[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item.id === 'number' && typeof item.name === 'string')
    .map((item) => ({
      id: item.id,
      name: item.name,
      lat: typeof item.lat === 'number' ? item.lat : null,
      lng: typeof item.lng === 'number' ? item.lng : null,
      neighborhoods: Array.isArray(item.neighborhoods)
        ? item.neighborhoods.filter(
            (neighborhood) =>
              neighborhood && typeof neighborhood.id === 'number' && typeof neighborhood.name === 'string',
          )
        : [],
    }));
}

export type SearchParams = {
  propertyType?: string | null;
  districtId?: number | null;
  guests?: number | null;
  checkIn?: string | null;
  checkOut?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  query?: string | null;
  sort?: 'recommended' | 'price_asc' | 'price_desc' | 'rating' | 'new';
  deals?: boolean;
  limit?: number;
  offset?: number;
};

export function searchProperties(params: SearchParams = {}): Promise<Result<SearchResponse>> {
  return call<SearchResponse>('acc_search', {
    p_property_type: params.propertyType ?? null,
    p_district_id: params.districtId ?? null,
    p_guests: params.guests ?? null,
    p_check_in: params.checkIn ?? null,
    p_check_out: params.checkOut ?? null,
    p_min_price: params.minPrice ?? null,
    p_max_price: params.maxPrice ?? null,
    p_query: params.query ?? null,
    p_sort: params.sort ?? 'recommended',
    p_deals: params.deals ?? false,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });
}

export function fetchPublicProperty(propertyId: string): Promise<Result<PublicProperty>> {
  return call<PublicProperty>('acc_property_public', { p_property_id: propertyId });
}

export function quoteStay(input: {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
}): Promise<Result<Quote>> {
  return call<Quote>('acc_quote', {
    p_property_id: input.propertyId,
    p_room_type_id: input.roomTypeId,
    p_rate_plan_id: input.ratePlanId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_adults: input.adults,
    p_children: input.children ?? 0,
    p_source: 'trabzone',
  });
}

export function bookStay(input: {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  guestName: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  note?: string | null;
}): Promise<Result<BookResult>> {
  return call<BookResult>('acc_book', {
    p_property_id: input.propertyId,
    p_room_type_id: input.roomTypeId,
    p_rate_plan_id: input.ratePlanId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_adults: input.adults,
    p_children: input.children ?? 0,
    p_guest_name: input.guestName,
    p_guest_phone: input.guestPhone ?? null,
    p_guest_email: input.guestEmail ?? null,
    p_note: input.note ?? null,
  });
}

export async function fetchMyReservations(): Promise<Result<MyReservation[]>> {
  const result = await call<{ items: MyReservation[] }>('acc_my_reservations');
  return result.ok ? ok(result.data.items ?? []) : result;
}

export function fetchMyReservationDetail(id: string): Promise<Result<MyReservationDetail>> {
  return call<MyReservationDetail>('acc_my_reservation_detail', { p_reservation_id: id });
}

export function cancelMyReservation(id: string, reason?: string): Promise<Result<{ id: string; status: string }>> {
  return call<{ id: string; status: string }>('acc_cancel_my_reservation', {
    p_reservation_id: id,
    p_reason: reason ?? null,
  });
}

export function createReview(input: {
  reservationId: string;
  rating: number;
  comment?: string | null;
  cleanliness?: number | null;
  staffScore?: number | null;
  locationScore?: number | null;
  valueScore?: number | null;
}): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_review_create', {
    p_reservation_id: input.reservationId,
    p_rating: input.rating,
    p_comment: input.comment ?? null,
    p_cleanliness: input.cleanliness ?? null,
    p_staff_score: input.staffScore ?? null,
    p_location_score: input.locationScore ?? null,
    p_value_score: input.valueScore ?? null,
  });
}

// -----------------------------------------------------------------------------
// Tesis / onboarding
// -----------------------------------------------------------------------------

export function fetchPropertyDetail(propertyId: string): Promise<Result<ManagedProperty>> {
  return call<ManagedProperty>('acc_property_detail', { p_property_id: propertyId });
}

export function fetchPropertyMissing(propertyId: string): Promise<Result<PropertyMissingResponse>> {
  return call<PropertyMissingResponse>('acc_property_missing', { p_property_id: propertyId });
}

export type PropertySaveInput = {
  name: string;
  property_type: string;
  description?: string | null;
  city?: string | null;
  district_id?: number | null;
  neighborhood_id?: number | null;
  district?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  tax_office?: string | null;
  tax_number?: string | null;
  invoice_title?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  room_capacity?: number | null;
  checkin_time?: string | null;
  checkout_time?: string | null;
  languages?: string[];
  policies?: Record<string, unknown>;
  amenities?: string[];
  settings?: PropertySettings;
};

export function saveProperty(
  input: PropertySaveInput,
  options: { propertyId?: string | null; submit?: boolean } = {},
): Promise<
  Result<{
    id: string;
    slug: string;
    name: string;
    status: string;
    verification_status: string;
    submitted: boolean;
    missing: string[];
  }>
> {
  return call<{
    id: string;
    slug: string;
    name: string;
    status: string;
    verification_status: string;
    submitted: boolean;
    missing: string[];
  }>('acc_property_save', {
    p_property_id: options.propertyId ?? null,
    p_payload: input,
    p_submit: options.submit ?? false,
  });
}

export function savePropertySettings(
  propertyId: string,
  settings: PropertySettings,
): Promise<Result<PropertySettings>> {
  return call<PropertySettings>('acc_property_settings_update', {
    p_property_id: propertyId,
    p_settings: settings,
  });
}

export function fetchPropertyDocuments(propertyId: string): Promise<Result<PropertyDocumentListData>> {
  return call<PropertyDocumentListData>('acc_property_documents_list', { p_property_id: propertyId });
}

export function addPropertyDocument(input: {
  propertyId: string;
  kind: string;
  title: string;
  storagePath: string;
  note?: string | null;
}): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_property_document_add', {
    p_property_id: input.propertyId,
    p_payload: {
      kind: input.kind,
      title: input.title,
      storage_path: input.storagePath,
      note: input.note ?? null,
    },
  });
}

export function fetchWebTracking(propertyId: string): Promise<Result<WebTracking>> {
  return call<WebTracking>('acc_web_tracking', { p_property_id: propertyId });
}

export function fetchActivity(propertyId: string, limit = 50): Promise<Result<ActivityListData>> {
  return call<ActivityListData>('acc_activity_list', { p_property_id: propertyId, p_limit: limit });
}

// -----------------------------------------------------------------------------
// Dashboard & takvim
// -----------------------------------------------------------------------------

export function fetchDashboard(propertyId: string, date?: string): Promise<Result<Dashboard>> {
  return call<Dashboard>('acc_dashboard', {
    p_property_id: propertyId,
    p_date: date ?? todayIso(),
  });
}

export function fetchCalendar(propertyId: string, from: string, to: string): Promise<Result<CalendarData>> {
  return call<CalendarData>('acc_calendar', { p_property_id: propertyId, p_from: from, p_to: to });
}

export function fetchRateCalendar(
  propertyId: string,
  from: string,
  to: string,
  roomTypeId?: string | null,
  ratePlanId?: string | null,
): Promise<Result<RateCalendarData>> {
  return call<RateCalendarData>('acc_rate_calendar', {
    p_property_id: propertyId,
    p_from: from,
    p_to: to,
    p_room_type_id: roomTypeId ?? null,
    p_rate_plan_id: ratePlanId ?? null,
  });
}

export function bulkUpdateRates(input: {
  propertyId: string;
  roomTypeIds: string[];
  ratePlanIds: string[];
  from: string;
  to: string;
  action: BulkRateAction;
  value?: number | null;
  dryRun?: boolean;
  extra?: Record<string, unknown>;
}): Promise<Result<BulkRateResult>> {
  return call<BulkRateResult>('acc_rate_bulk_update', {
    p_property_id: input.propertyId,
    p_room_type_ids: input.roomTypeIds,
    p_rate_plan_ids: input.ratePlanIds,
    p_from: input.from,
    p_to: input.to,
    p_action: input.action,
    p_value: input.value ?? null,
    p_dry_run: input.dryRun ?? true,
    p_extra: input.extra ?? {},
  });
}

export function createRoomBlock(input: {
  propertyId: string;
  roomId: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
  blockRoom?: boolean;
}): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_room_block_create', {
    p_property_id: input.propertyId,
    p_payload: {
      room_id: input.roomId,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason ?? null,
      block_room: input.blockRoom ?? false,
    },
  });
}

export function deleteRoomBlock(blockId: string, note?: string): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_room_block_delete', { p_room_block_id: blockId, p_note: note ?? null });
}

// -----------------------------------------------------------------------------
// Rezervasyonlar
// -----------------------------------------------------------------------------

export function fetchReservations(
  propertyId: string,
  params: {
    status?: ReservationStatus | 'all' | null;
    from?: string | null;
    to?: string | null;
    query?: string | null;
    limit?: number;
    offset?: number;
  } = {},
): Promise<Result<ReservationListResponse>> {
  return call<ReservationListResponse>('acc_reservations_list', {
    p_property_id: propertyId,
    p_status: params.status ?? null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_query: params.query ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
}

export function fetchReservationDetail(id: string): Promise<Result<ReservationDetail>> {
  return call<ReservationDetail>('acc_reservation_detail', { p_reservation_id: id });
}

export type ManualReservationInput = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  roomId?: string | null;
  guestId?: string | null;
  guestName: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  guestNote?: string | null;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  nightlyPriceCents?: number | null;
  discountCents?: number;
  paidCents?: number;
  paymentMethod?: 'cash' | 'pos' | 'bank' | null;
  cashAccountId?: string | null;
  source: ReservationSource;
  status?: 'pending' | 'confirmed';
  notes?: string | null;
  internalNotes?: string | null;
  sendNotification?: boolean;
};

export function createManualReservation(input: ManualReservationInput): Promise<Result<ReservationDetail>> {
  return call<ReservationDetail>('acc_reservation_create_manual', {
    p_property_id: input.propertyId,
    p_payload: {
      room_type_id: input.roomTypeId,
      rate_plan_id: input.ratePlanId,
      room_id: input.roomId ?? null,
      guest_id: input.guestId ?? null,
      guest_name: input.guestName,
      guest_phone: input.guestPhone ?? null,
      guest_email: input.guestEmail ?? null,
      guest_note: input.guestNote ?? null,
      adults: input.adults,
      children: input.children,
      check_in: input.checkIn,
      check_out: input.checkOut,
      nightly_price_cents: input.nightlyPriceCents ?? null,
      discount_cents: input.discountCents ?? 0,
      paid_cents: input.paidCents ?? 0,
      payment_method: input.paymentMethod ?? null,
      cash_account_id: input.cashAccountId ?? null,
      source: input.source,
      status: input.status ?? 'confirmed',
      notes: input.notes ?? null,
      internal_notes: input.internalNotes ?? null,
      send_notification: input.sendNotification ?? false,
    },
  });
}

export type ReservationUpdateInput = {
  guestName?: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  adults?: number;
  children?: number;
  roomTypeId?: string;
  roomId?: string | null;
  ratePlanId?: string;
  checkIn?: string;
  checkOut?: string;
  nightlyPriceCents?: number | null;
  discountCents?: number;
  notes?: string | null;
  internalNotes?: string | null;
};

export function updateReservation(
  id: string,
  input: ReservationUpdateInput,
): Promise<Result<ReservationDetail>> {
  const payload: Record<string, unknown> = {};
  if (input.guestName !== undefined) payload.guest_name = input.guestName;
  if (input.guestPhone !== undefined) payload.guest_phone = input.guestPhone;
  if (input.guestEmail !== undefined) payload.guest_email = input.guestEmail;
  if (input.adults !== undefined) payload.adults = input.adults;
  if (input.children !== undefined) payload.children = input.children;
  if (input.roomTypeId !== undefined) payload.room_type_id = input.roomTypeId;
  if (input.roomId !== undefined) payload.room_id = input.roomId;
  if (input.ratePlanId !== undefined) payload.rate_plan_id = input.ratePlanId;
  if (input.checkIn !== undefined) payload.check_in = input.checkIn;
  if (input.checkOut !== undefined) payload.check_out = input.checkOut;
  if (input.nightlyPriceCents !== undefined) payload.nightly_price_cents = input.nightlyPriceCents;
  if (input.discountCents !== undefined) payload.discount_cents = input.discountCents;
  if (input.notes !== undefined) payload.notes = input.notes;
  if (input.internalNotes !== undefined) payload.internal_notes = input.internalNotes;

  return call<ReservationDetail>('acc_reservation_update', {
    p_reservation_id: id,
    p_payload: payload,
  });
}

export function transitionReservation(
  id: string,
  action: ReservationAction,
  note?: string,
): Promise<Result<ReservationDetail>> {
  return call<ReservationDetail>('acc_reservation_transition', {
    p_reservation_id: id,
    p_action: action,
    p_note: note ?? null,
  });
}

export async function fetchAvailableRooms(input: {
  propertyId: string;
  roomTypeId: string;
  from: string;
  to: string;
  excludeReservationId?: string | null;
}): Promise<Result<ReservationAvailableRoom[]>> {
  const result = await call<{ items: ReservationAvailableRoom[] }>('acc_reservation_available_rooms', {
    p_property_id: input.propertyId,
    p_room_type_id: input.roomTypeId,
    p_from: input.from,
    p_to: input.to,
    p_exclude_reservation_id: input.excludeReservationId ?? null,
  });
  return result.ok ? ok(result.data.items ?? []) : result;
}

// -----------------------------------------------------------------------------
// Oda / fiyat planı envanteri
// -----------------------------------------------------------------------------

export function fetchPropertyInventory(propertyId: string): Promise<Result<PropertyInventory>> {
  return call<PropertyInventory>('acc_property_inventory', { p_property_id: propertyId });
}

export type RoomTypeInput = Partial<Omit<ManagedRoomType, 'room_count'>> & { name: string };

export function saveRoomType(
  propertyId: string,
  input: RoomTypeInput,
): Promise<Result<ManagedRoomType>> {
  return call<ManagedRoomType>('acc_room_type_upsert', {
    p_property_id: propertyId,
    p_payload: input,
  });
}

export function archiveRoomType(roomTypeId: string): Promise<Result<{ id: string; archived: boolean }>> {
  return call<{ id: string; archived: boolean }>('acc_room_type_delete', { p_room_type_id: roomTypeId });
}

export type RoomInput = Partial<Omit<ManagedRoom, 'room_type_name'>> & {
  room_type_id: string;
  number: string;
};

export function saveRoom(propertyId: string, input: RoomInput): Promise<Result<ManagedRoom>> {
  return call<ManagedRoom>('acc_room_upsert', {
    p_property_id: propertyId,
    p_payload: input,
  });
}

export function archiveRoom(roomId: string): Promise<Result<{ id: string; archived: boolean }>> {
  return call<{ id: string; archived: boolean }>('acc_room_delete', { p_room_id: roomId });
}

export function setRoomStatus(
  roomId: string,
  status: ManagedRoom['status'],
  note?: string,
): Promise<Result<ManagedRoom>> {
  return call<ManagedRoom>('acc_room_status_set', {
    p_room_id: roomId,
    p_status: status,
    p_note: note ?? null,
  });
}

export type RatePlanInput = Partial<Omit<ManagedRatePlan, 'room_type_name'>> & { name: string };

export function saveRatePlan(
  propertyId: string,
  input: RatePlanInput,
): Promise<Result<ManagedRatePlan>> {
  return call<ManagedRatePlan>('acc_rate_plan_upsert', {
    p_property_id: propertyId,
    p_payload: input,
  });
}

export function archiveRatePlan(ratePlanId: string): Promise<Result<{ id: string; archived: boolean }>> {
  return call<{ id: string; archived: boolean }>('acc_rate_plan_delete', { p_rate_plan_id: ratePlanId });
}

// -----------------------------------------------------------------------------
// Misafirler
// -----------------------------------------------------------------------------

export function fetchGuests(
  propertyId: string,
  query?: string,
  limit = 50,
  offset = 0,
): Promise<Result<GuestListData>> {
  return call<GuestListData>('acc_guests_list', {
    p_property_id: propertyId,
    p_query: query?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  });
}

export type GuestInput = {
  id?: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  contact_consent?: boolean;
};

export function saveGuest(propertyId: string, input: GuestInput): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_guest_upsert', { p_property_id: propertyId, p_payload: input });
}

export function fetchGuestDetail(guestId: string): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_guest_detail', { p_guest_id: guestId });
}

// -----------------------------------------------------------------------------
// Ön büro / kat hizmetleri
// -----------------------------------------------------------------------------

export function fetchFrontDesk(propertyId: string, date?: string): Promise<Result<FrontDeskData>> {
  return call<FrontDeskData>('acc_frontdesk', {
    p_property_id: propertyId,
    p_date: date ?? todayIso(),
  });
}

export function fetchHousekeeping(propertyId: string, date?: string): Promise<Result<HousekeepingData>> {
  return call<HousekeepingData>('acc_housekeeping', {
    p_property_id: propertyId,
    p_date: date ?? todayIso(),
  });
}

export function createHousekeepingTask(input: {
  propertyId: string;
  roomId: string;
  kind: 'cleaning' | 'maintenance' | 'inspection';
  assignedTo?: string | null;
  note?: string | null;
  photoPath?: string | null;
  dueDate?: string | null;
}): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_housekeeping_upsert', {
    p_property_id: input.propertyId,
    p_payload: {
      room_id: input.roomId,
      kind: input.kind,
      assigned_to: input.assignedTo ?? null,
      note: input.note ?? null,
      photo_path: input.photoPath ?? null,
      due_date: input.dueDate ?? null,
    },
  });
}

export function transitionHousekeepingTask(
  taskId: string,
  status: 'pending' | 'in_progress' | 'done' | 'verified',
  note?: string,
  photoPath?: string,
): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_housekeeping_transition', {
    p_task_id: taskId,
    p_status: status,
    p_note: note ?? null,
    p_photo_path: photoPath ?? null,
  });
}

// -----------------------------------------------------------------------------
// Kasa / finans
// -----------------------------------------------------------------------------

export function fetchCashOverview(propertyId: string): Promise<Result<CashOverview>> {
  return call<CashOverview>('acc_cash_overview', { p_property_id: propertyId });
}

export type CashAccountInput = {
  id?: string;
  name: string;
  kind: 'cash' | 'pos' | 'bank';
  currency?: string;
  opening_balance_cents?: number;
  active?: boolean;
};

export function saveCashAccount(
  propertyId: string,
  input: CashAccountInput,
): Promise<Result<CashAccount>> {
  return call<CashAccount>('acc_cash_account_upsert', {
    p_property_id: propertyId,
    p_payload: input,
  });
}

export type CashTransactionInput = {
  accountId: string;
  kind: 'collection' | 'expense' | 'refund' | 'adjustment';
  amountCents: number;
  reservationId?: string | null;
  occurredOn?: string;
  description?: string | null;
};

export function addCashTransaction(
  propertyId: string,
  input: CashTransactionInput,
): Promise<Result<CashTransaction>> {
  return call<CashTransaction>('acc_cash_transaction_add', {
    p_property_id: propertyId,
    p_payload: {
      account_id: input.accountId,
      kind: input.kind,
      amount_cents: input.amountCents,
      reservation_id: input.reservationId ?? null,
      occurred_on: input.occurredOn ?? todayIso(),
      description: input.description ?? null,
    },
  });
}

export function transferCash(input: {
  propertyId: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  occurredOn?: string;
  note?: string | null;
}): Promise<Result<{ transfer_group: string; amount_cents: number }>> {
  return call<{ transfer_group: string; amount_cents: number }>('acc_cash_transfer', {
    p_property_id: input.propertyId,
    p_from_account_id: input.fromAccountId,
    p_to_account_id: input.toAccountId,
    p_amount_cents: input.amountCents,
    p_occurred_on: input.occurredOn ?? todayIso(),
    p_note: input.note ?? null,
  });
}

export function reverseCashTransaction(
  transactionId: string,
  note?: string,
): Promise<Result<CashTransaction>> {
  return call<CashTransaction>('acc_cash_transaction_reverse', {
    p_transaction_id: transactionId,
    p_note: note ?? null,
  });
}

export type FolioInput = {
  reservationId: string;
  kind: 'charge' | 'payment' | 'refund';
  category: 'room' | 'extra' | 'city_tax' | 'other' | 'cash' | 'pos' | 'bank';
  amountCents: number;
  description?: string | null;
  method?: 'cash' | 'pos' | 'bank' | null;
  cashAccountId?: string | null;
  occurredOn?: string;
  note?: string | null;
};

export function addFolioItem(
  propertyId: string,
  input: FolioInput,
): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_folio_add', {
    p_property_id: propertyId,
    p_payload: {
      reservation_id: input.reservationId,
      kind: input.kind,
      category: input.category,
      amount_cents: input.amountCents,
      description: input.description ?? null,
      method: input.method ?? null,
      cash_account_id: input.cashAccountId ?? null,
      occurred_on: input.occurredOn ?? todayIso(),
      note: input.note ?? null,
    },
  });
}

export function fetchFinanceSummary(propertyId: string, month?: string): Promise<Result<FinanceSummary>> {
  const date = month ? `${month}-01` : `${todayIso().slice(0, 7)}-01`;
  return call<FinanceSummary>('acc_finance_summary', {
    p_property_id: propertyId,
    p_month: date,
  });
}

export function fetchDailyReport(propertyId: string, date?: string): Promise<Result<DailyReport>> {
  return call<DailyReport>('acc_daily_report', {
    p_property_id: propertyId,
    p_date: date ?? todayIso(),
  });
}

export function fetchCommissionSummary(
  propertyId: string,
  from: string,
  to: string,
): Promise<Result<CommissionSummary>> {
  return call<CommissionSummary>('acc_commission_summary', {
    p_property_id: propertyId,
    p_from: from,
    p_to: to,
  });
}

export function payCommission(input: {
  propertyId: string;
  amountCents: number;
  occurredOn?: string;
  note?: string | null;
}): Promise<Result<CommissionSummary>> {
  return call<CommissionSummary>('acc_commission_pay', {
    p_property_id: input.propertyId,
    p_amount_cents: input.amountCents,
    p_occurred_on: input.occurredOn ?? todayIso(),
    p_note: input.note ?? null,
  });
}

export function fetchReport(
  propertyId: string,
  from: string,
  to: string,
): Promise<Result<ReportData>> {
  return call<ReportData>('acc_report_export', {
    p_property_id: propertyId,
    p_from: from,
    p_to: to,
  });
}

// -----------------------------------------------------------------------------
// Kampanyalar
// -----------------------------------------------------------------------------

export function fetchCampaigns(propertyId: string): Promise<Result<CampaignListData>> {
  return call<CampaignListData>('acc_campaign_list', { p_property_id: propertyId });
}

export type CampaignInput = {
  id?: string;
  title: string;
  description?: string | null;
  cover_path?: string | null;
  kind: Campaign['kind'];
  start_date: string;
  end_date: string;
  booking_deadline?: string | null;
  room_type_ids: string[];
  rate_plan_ids: string[];
  discount_percent: number;
  fixed_price_cents?: number | null;
  min_nights: number;
  max_nights?: number | null;
  quota?: number | null;
  stackable?: boolean;
  status: Campaign['status'];
};

export function saveCampaign(propertyId: string, input: CampaignInput): Promise<Result<Campaign>> {
  return call<Campaign>('acc_campaign_upsert', {
    p_property_id: propertyId,
    p_payload: input,
  });
}

export function endCampaign(campaignId: string): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_campaign_delete', { p_campaign_id: campaignId });
}

// -----------------------------------------------------------------------------
// Medya
// -----------------------------------------------------------------------------

export function fetchMedia(propertyId: string): Promise<Result<MediaListData>> {
  return call<MediaListData>('acc_media_list', { p_property_id: propertyId });
}

export function addMedia(input: {
  propertyId: string;
  roomTypeId?: string | null;
  kind?: 'image' | 'video';
  category?: MediaCategory;
  storagePath: string;
  thumbnailPath?: string | null;
  caption?: string | null;
  cover?: boolean;
  sortOrder?: number;
}): Promise<Result<MediaItem>> {
  return call<MediaItem>('acc_media_add', {
    p_property_id: input.propertyId,
    p_payload: {
      room_type_id: input.roomTypeId ?? null,
      kind: input.kind ?? 'image',
      category: input.category ?? 'general',
      storage_path: input.storagePath,
      thumbnail_path: input.thumbnailPath ?? null,
      caption: input.caption ?? null,
      cover: input.cover ?? false,
      sort_order: input.sortOrder ?? 0,
    },
  });
}

export function updateMedia(
  mediaId: string,
  payload: { category?: MediaCategory; caption?: string | null; cover?: boolean; sortOrder?: number },
): Promise<Result<MediaItem>> {
  return call<MediaItem>('acc_media_update', {
    p_media_id: mediaId,
    p_payload: {
      ...(payload.category !== undefined ? { category: payload.category } : {}),
      ...(payload.caption !== undefined ? { caption: payload.caption } : {}),
      ...(payload.cover !== undefined ? { cover: payload.cover } : {}),
      ...(payload.sortOrder !== undefined ? { sort_order: payload.sortOrder } : {}),
    },
  });
}

export function deleteMedia(mediaId: string): Promise<Result<{ id: string; storage_path: string; kind: string }>> {
  return call<{ id: string; storage_path: string; kind: string }>('acc_media_delete', { p_media_id: mediaId });
}

export function reorderMedia(propertyId: string, ids: string[]): Promise<Result<{ reordered: number }>> {
  return call<{ reordered: number }>('acc_media_reorder', { p_property_id: propertyId, p_ids: ids });
}

export function setMediaCover(mediaId: string): Promise<Result<MediaItem>> {
  return call<MediaItem>('acc_media_set_cover', { p_media_id: mediaId });
}

// -----------------------------------------------------------------------------
// Personel
// -----------------------------------------------------------------------------

export function fetchStaff(propertyId: string): Promise<Result<StaffListData>> {
  return call<StaffListData>('acc_staff_list', { p_property_id: propertyId });
}

export function saveStaff(input: {
  propertyId: string;
  userId?: string | null;
  username?: string | null;
  role: Exclude<StaffRole, 'owner'>;
  permissions?: string[];
}): Promise<Result<StaffMember>> {
  return call<StaffMember>('acc_staff_upsert', {
    p_property_id: input.propertyId,
    p_payload: {
      user_id: input.userId ?? null,
      username: input.username ?? null,
      role: input.role,
      permissions: input.permissions ?? [],
    },
  });
}

export function removeStaff(propertyId: string, userId: string): Promise<Result<{ user_id: string; status: string }>> {
  return call<{ user_id: string; status: string }>('acc_staff_remove', { p_property_id: propertyId, p_user_id: userId });
}

// -----------------------------------------------------------------------------
// Mesajlar / yorumlar
// -----------------------------------------------------------------------------

export function fetchMessageThreads(propertyId: string): Promise<Result<MessageThreadListData>> {
  return call<MessageThreadListData>('acc_message_threads', { p_property_id: propertyId });
}

export function fetchMessages(propertyId: string, reservationId: string): Promise<Result<MessageListData>> {
  return call<MessageListData>('acc_messages_list', {
    p_property_id: propertyId,
    p_reservation_id: reservationId,
  });
}

export function sendMessage(
  propertyId: string,
  reservationId: string,
  body: string,
): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_message_send', {
    p_property_id: propertyId,
    p_reservation_id: reservationId,
    p_body: body,
  });
}

export function fetchReviews(
  propertyId: string,
  status?: 'published' | 'hidden' | 'all',
): Promise<Result<ReviewListData>> {
  return call<ReviewListData>('acc_reviews_list', {
    p_property_id: propertyId,
    p_status: status ?? null,
  });
}

export function replyToReview(reviewId: string, reply: string): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_review_reply', { p_review_id: reviewId, p_reply: reply });
}

export function setReviewStatus(
  reviewId: string,
  status: 'published' | 'hidden',
): Promise<Result<Record<string, unknown>>> {
  return call<Record<string, unknown>>('acc_review_status', { p_review_id: reviewId, p_status: status });
}

// -----------------------------------------------------------------------------
// Belgeler
// -----------------------------------------------------------------------------

export function fetchDocuments(
  propertyId: string,
  kind?: 'reservation' | 'invoice' | 'receipt' | 'statement' | 'all',
): Promise<Result<DocumentsListData>> {
  return call<DocumentsListData>('acc_documents_list', {
    p_property_id: propertyId,
    p_kind: kind ?? null,
  });
}

export function createDocument(input: {
  propertyId: string;
  kind: 'reservation' | 'invoice' | 'receipt' | 'statement';
  reservationId?: string | null;
  title?: string | null;
}): Promise<Result<AccommodationDocument>> {
  return call<AccommodationDocument>('acc_document_create', {
    p_property_id: input.propertyId,
    p_payload: {
      kind: input.kind,
      reservation_id: input.reservationId ?? null,
      title: input.title ?? null,
    },
  });
}

export function attachDocument(documentId: string, storagePath: string): Promise<Result<AccommodationDocument>> {
  return call<AccommodationDocument>('acc_document_attach', {
    p_document_id: documentId,
    p_storage_path: storagePath,
  });
}

// -----------------------------------------------------------------------------
// Yönetici doğrulama
// -----------------------------------------------------------------------------

export function fetchAdminProperties(status?: string): Promise<Result<AdminPropertyList>> {
  return call<AdminPropertyList>('acc_admin_properties', { p_status: status ?? null });
}

export function reviewProperty(input: {
  propertyId: string;
  approve: boolean;
  note?: string | null;
}): Promise<Result<{ id: string; status: string; verification_status: string }>> {
  return call<{ id: string; status: string; verification_status: string }>('acc_admin_review_property', {
    p_property_id: input.propertyId,
    p_approve: input.approve,
    p_note: input.note ?? null,
  });
}

export type {
  AdminProperty,
  BookingMode,
  Campaign,
  CashAccount,
  CashTransaction,
  MediaItem,
  MessageThreadListData,
  MyReservation,
  PaymentStatus,
  PropertyInventory,
  PropertySettings,
  PublicProperty,
  ReservationStatus,
};
