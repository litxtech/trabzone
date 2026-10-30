/**
 * Trabzone Konaklama — paylaşılan tipler.
 *
 * Alan adları doğrudan Supabase RPC'lerinin JSON çıktısıyla eşleşir; böylece
 * ekranlarda ayrı bir dönüştürme katmanı gerekmez.
 */

export type PropertyType = 'hotel' | 'bungalow' | 'apartment' | 'pension' | 'villa';

export type PropertyStatus =
  | 'draft'
  | 'pending_verification'
  | 'published'
  | 'suspended'
  | 'rejected';

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type ReservationStatus =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'expired'
  | 'awaiting_checkin'
  | 'checked_in'
  | 'staying'
  | 'checked_out'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'change_pending'
  | 'disputed';

export type ReservationSource =
  | 'trabzone'
  | 'phone'
  | 'front_desk'
  | 'direct_web'
  | 'external_agency'
  | 'other';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';

export type BookingMode = 'instant' | 'manual';

export type RoomStatus =
  | 'clean'
  | 'dirty'
  | 'cleaning'
  | 'inspection'
  | 'maintenance'
  | 'out_of_service';

export type HousekeepingStatus = 'pending' | 'in_progress' | 'done' | 'verified';

export type CampaignKind =
  | 'trabzone'
  | 'last_minute'
  | 'early_booking'
  | 'weekday'
  | 'weekend'
  | 'long_stay'
  | 'seasonal'
  | 'limited'
  | 'fixed_price'
  | 'percentage'
  | 'special';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'ended';

export type CashAccountKind = 'cash' | 'pos' | 'bank';

export type CashTransactionKind =
  | 'collection'
  | 'expense'
  | 'refund'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'opening';

export type StaffRole =
  | 'owner'
  | 'manager'
  | 'front_desk'
  | 'housekeeping'
  | 'accountant'
  | 'viewer';

export type MediaCategory =
  | 'cover'
  | 'general'
  | 'room'
  | 'restaurant'
  | 'pool'
  | 'lobby'
  | 'view'
  | 'common';

export interface AccommodationPropertyContext {
  id: string;
  name: string;
  slug: string;
  property_type: PropertyType;
  status: PropertyStatus;
  verification_status: VerificationStatus;
  verification_note: string | null;
  district: string | null;
  neighborhood: string | null;
  cover_path: string | null;
  role: StaffRole | 'admin';
  permissions: string[];
  pending_reservations: number;
  unread_messages: number;
  pending_tasks: number;
}

export interface AccommodationContext {
  items: AccommodationPropertyContext[];
  is_admin: boolean;
}

export interface PublicFilters {
  districts: { id: number; name: string }[];
  types: { key: PropertyType; label: string }[];
}

export interface PropertySummary {
  id: string;
  name: string;
  slug: string;
  property_type: PropertyType;
  description: string | null;
  district: string | null;
  neighborhood: string | null;
  district_id: number | null;
  neighborhood_id: number | null;
  lat: number | null;
  lng: number | null;
  cover_path: string | null;
  photos: string[];
  photo_count: number;
  rating_avg: number;
  rating_count: number;
  amenities: string[];
  price_from_cents: number | null;
  currency: string;
  max_guests: number | null;
  booking_modes: BookingMode[];
  has_deal: boolean;
  my_reservation_count: number;
  is_published: boolean;
}

export interface SearchResponse {
  items: PropertySummary[];
  total: number;
  limit: number;
  offset: number;
  has_dates: boolean;
}

export interface PublicReview {
  id: string;
  guest_name: string;
  guest_avatar_path: string | null;
  rating: number;
  cleanliness: number | null;
  staff_score: number | null;
  location_score: number | null;
  value_score: number | null;
  comment: string | null;
  owner_reply: string | null;
  created_at: string;
}

export interface PublicCampaign {
  id: string;
  title: string;
  description: string | null;
  cover_path: string | null;
  kind: CampaignKind;
  start_date: string;
  end_date: string;
  discount_percent: number;
  fixed_price_cents: number | null;
  room_type_ids: string[];
  rate_plan_ids: string[];
  min_nights: number;
  max_nights: number | null;
}

export interface PublicMedia {
  id: string;
  kind: 'image' | 'video';
  category: MediaCategory;
  storage_path: string;
  thumbnail_path: string | null;
  caption: string | null;
  cover: boolean;
  sort_order: number;
  room_type_id: string | null;
}

export interface PublicRatePlan {
  id: string;
  name: string;
  description: string | null;
  booking_mode: BookingMode;
  cancellation_policy: string | null;
  cancellation_hours: number;
  deposit_percent: number;
  includes_breakfast: boolean;
  min_stay: number;
  max_stay: number | null;
}

export interface PublicRoomType {
  id: string;
  name: string;
  description: string | null;
  capacity_adults: number;
  capacity_children: number;
  bed_setup: string | null;
  size_m2: number | null;
  view: string | null;
  balcony: boolean;
  air_conditioning: boolean;
  wifi: boolean;
  breakfast: boolean;
  amenities: string[];
  base_price_cents: number;
  currency: string;
  cover_path: string | null;
  photos: string[];
  rate_plans: PublicRatePlan[];
}

export interface PublicProperty {
  id: string;
  name: string;
  slug: string;
  property_type: PropertyType;
  description: string | null;
  district: string | null;
  neighborhood: string | null;
  district_id: number | null;
  neighborhood_id: number | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  checkin_time: string;
  checkout_time: string;
  languages: string[];
  policies: Record<string, unknown>;
  amenities: string[];
  room_capacity: number | null;
  cover_path: string | null;
  rating_avg: number;
  rating_count: number;
  view_count: number;
  verification_status: VerificationStatus;
  media: PublicMedia[];
  room_types: PublicRoomType[];
  reviews: PublicReview[];
  rating_breakdown: {
    cleanliness?: number;
    staff?: number;
    location?: number;
    value?: number;
  };
  campaigns: PublicCampaign[];
}

export interface QuoteNight {
  date: string;
  base_cents: number;
  extra_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  campaign_id: string | null;
  campaign_title: string | null;
}

export interface Quote {
  property_id: string;
  room_type_id: string;
  rate_plan_id: string;
  property_name: string;
  room_type_name: string;
  rate_plan_name: string;
  booking_mode: BookingMode;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  currency: string;
  nightly: QuoteNight[];
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  commission_rate: number;
  commission_cents: number;
  available_rooms: number;
  sold_out: boolean;
  min_stay: number;
  max_stay: number | null;
  min_stay_ok: boolean;
  max_stay_ok: boolean;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  campaign_id: string | null;
  has_discount: boolean;
}

export interface CalendarRoom {
  id: string;
  number: string;
  floor: string | null;
  status: RoomStatus;
  active: boolean;
}

export interface CalendarRoomType {
  id: string;
  name: string;
  base_price_cents: number;
  currency: string;
  capacity_adults: number;
  capacity_children: number;
  rooms: CalendarRoom[];
}

export interface CalendarReservation {
  id: string;
  code: string;
  guest_name: string;
  guest_phone: string | null;
  room_id: string | null;
  room_number: string | null;
  room_type_id: string;
  rate_plan_id: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  status: ReservationStatus;
  source: ReservationSource;
  booking_mode: BookingMode;
  payment_status: PaymentStatus;
  paid_cents: number;
  total_cents: number;
  commission_cents: number;
  currency: string;
  hold_expires_at: string | null;
  created_at: string;
}

export interface CalendarBlock {
  id: string;
  room_id: string;
  room_number: string;
  room_type_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
}

export interface CalendarData {
  from: string;
  to: string;
  room_types: CalendarRoomType[];
  reservations: CalendarReservation[];
  blocks: CalendarBlock[];
}

export interface ReservationListRow {
  id: string;
  code: string;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  room_type_id: string;
  room_type_name: string;
  room_id: string | null;
  room_number: string | null;
  rate_plan_id: string;
  rate_plan_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  status: ReservationStatus;
  source: ReservationSource;
  booking_mode: BookingMode;
  payment_status: PaymentStatus;
  paid_cents: number;
  total_cents: number;
  commission_cents: number;
  currency: string;
  notes: string | null;
  hold_expires_at: string | null;
  created_at: string;
}

export interface ReservationListResponse {
  items: ReservationListRow[];
  total: number;
  limit: number;
  offset: number;
}

export type ReservationAction =
  | 'confirm'
  | 'decline'
  | 'cancel'
  | 'no_show'
  | 'mark_arrival'
  | 'check_in'
  | 'mark_staying'
  | 'check_out'
  | 'complete'
  | 'dispute'
  | 'change_pending'
  | 'resolve_dispute';

export interface ReservationDetail {
  id: string;
  code: string;
  property_id: string;
  guest_id: string | null;
  guest_user_id: string | null;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  adults: number;
  children: number;
  room_type_id: string;
  room_type_name: string;
  room_id: string | null;
  room_number: string | null;
  rate_plan_id: string;
  rate_plan_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  status: ReservationStatus;
  source: ReservationSource;
  booking_mode: BookingMode;
  nightly_price_cents: number;
  total_cents: number;
  discount_cents: number;
  commission_rate: number;
  commission_cents: number;
  currency: string;
  payment_status: PaymentStatus;
  paid_cents: number;
  notes: string | null;
  internal_notes: string | null;
  hold_expires_at: string | null;
  created_at: string;
  confirmed_at: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  cancelled_at: string | null;
  allowed_actions: ReservationAction[];
  history: {
    from_status: string | null;
    to_status: string;
    note: string | null;
    actor_name: string | null;
    created_at: string;
  }[];
  folio: {
    id: string;
    kind: string;
    category: string;
    description: string | null;
    amount_cents: number;
    currency: string;
    occurred_on: string;
    method: string | null;
    created_at: string;
  }[];
}

export interface DashboardFinance {
  today_revenue_cents: number;
  yesterday_revenue_cents: number;
  week_revenue_cents: number;
  month_revenue_cents: number;
  prev_month_revenue_cents: number;
  year_revenue_cents: number;
  cash_total_cents: number;
  cash_cents: number;
  pos_cents: number;
  bank_cents: number;
  open_balance_cents: number;
  commission_estimated_cents: number;
  commission_finalized_cents: number;
  commission_paid_cents: number;
  commission_due_cents: number;
  collected_today_cents: number;
  cash_today_cents: number;
  pos_today_cents: number;
  bank_today_cents: number;
  refunds_today_cents: number;
}

export interface DashboardOperations {
  arrivals_today: number;
  departures_today: number;
  in_house: number;
  pending_reservations: number;
  created_today: number;
  available_rooms: number;
  occupied_rooms: number;
  out_of_service_rooms: number;
  occupancy_rate: number;
  unread_messages: number;
  upcoming_reservations: number;
  active_campaigns: number;
  dirty_rooms: number;
  cleaning_rooms: number;
  maintenance_rooms: number;
}

export interface Dashboard {
  property: {
    id: string;
    name: string;
    property_type: PropertyType;
    status: PropertyStatus;
    verification_status: VerificationStatus;
    district: string | null;
    cover_path: string | null;
    commission_rate: number;
  };
  date: string;
  finance: DashboardFinance;
  operations: DashboardOperations;
}

export interface RateRow {
  room_type_id: string;
  room_type_name: string;
  rate_plan_id: string;
  rate_plan_name: string;
  stay_date: string;
  base_price_cents: number;
  extra_adult_cents: number;
  extra_child_cents: number;
  available_rooms: number | null;
  min_stay: number | null;
  max_stay: number | null;
  closed: boolean;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  is_set: boolean;
}

export interface RateCalendarData {
  from: string;
  to: string;
  room_types: { id: string; name: string; base_price_cents: number; currency: string }[];
  rate_plans: {
    id: string;
    name: string;
    room_type_id: string | null;
    booking_mode: BookingMode;
    min_stay: number;
    max_stay: number | null;
  }[];
  rows: RateRow[];
}

export type BulkRateAction =
  | 'set_price'
  | 'increase_percent'
  | 'decrease_percent'
  | 'set_availability'
  | 'close'
  | 'open'
  | 'set_min_stay'
  | 'set_max_stay'
  | 'close_arrival'
  | 'open_arrival'
  | 'close_departure'
  | 'open_departure'
  | 'weekday_weekend';

export interface BulkRateResult {
  dry_run: boolean;
  action: BulkRateAction;
  from: string;
  to: string;
  affected: number;
  sample: {
    date: string;
    room_type_name: string;
    rate_plan_name: string;
    base_price_cents: number;
    available_rooms: number | null;
    min_stay: number | null;
    max_stay: number | null;
    closed: boolean;
  }[];
}

export interface CashAccount {
  id: string;
  name: string;
  kind: CashAccountKind;
  currency: string;
  opening_balance_cents: number;
  balance_cents: number;
  today_collected_cents: number;
  active?: boolean;
}

export interface CashTransaction {
  id: string;
  account_id: string;
  account_name: string;
  kind: CashTransactionKind;
  amount_cents: number;
  currency: string;
  occurred_on: string;
  reservation_id: string | null;
  reservation_code?: string | null;
  description: string | null;
  created_by: string | null;
  actor_name?: string | null;
  reverses_id?: string | null;
  created_at: string;
}

export interface CashOverview {
  accounts: CashAccount[];
  transactions: CashTransaction[];
}

export interface FinanceSummary {
  month: string;
  from: string;
  to: string;
  revenue_cents: number;
  other_income_cents: number;
  discount_cents: number;
  collected_cents: number;
  refunded_cents: number;
  expenses_cents: number;
  commission_accrued_cents: number;
  commission_estimated_cents: number;
  commission_paid_cents: number;
  open_balance_cents: number;
  by_source: {
    source: ReservationSource;
    reservations: number;
    total_cents: number;
    commission_cents: number;
  }[];
  daily: {
    date: string;
    revenue_cents: number;
    collected_cents: number;
    expenses_cents: number;
  }[];
  payments_by_category: { category: string; total_cents: number }[];
}

export interface DailyReport {
  date: string;
  revenue_cents: number;
  extra_income_cents: number;
  cash_cents: number;
  pos_cents: number;
  bank_cents: number;
  refunds_cents: number;
  net_cents: number;
  expenses_cents: number;
  commission_accrued_cents: number;
  open_balance_cents: number;
  arrivals: number;
  departures: number;
}

export interface CommissionSummary {
  from: string;
  to: string;
  estimated_cents: number;
  finalized_cents: number;
  paid_cents: number;
  due_cents: number;
  reservations: {
    reservation_id: string;
    code: string;
    guest_name: string;
    check_in: string;
    check_out: string;
    status: ReservationStatus;
    source: ReservationSource;
    total_cents: number;
    commission_rate: number;
    commission_cents: number;
  }[];
}

export interface FrontDeskReservation {
  id: string;
  code: string;
  guest_name: string;
  guest_phone?: string | null;
  check_in: string;
  check_out: string;
  nights?: number;
  status: ReservationStatus;
  payment_status: PaymentStatus;
  total_cents: number;
  paid_cents: number;
  open_balance_cents: number;
  room_id: string | null;
  room_number: string | null;
  room_type_name?: string;
  room_status?: RoomStatus | null;
  notes?: string | null;
  note?: string | null;
}

export interface FrontDeskData {
  date: string;
  arrivals: FrontDeskReservation[];
  departures: FrontDeskReservation[];
  in_house: FrontDeskReservation[];
  late_arrivals: FrontDeskReservation[];
  rooms: {
    id: string;
    number: string;
    floor: string | null;
    room_type_name: string;
    status: RoomStatus;
    note: string | null;
  }[];
}

export interface HousekeepingRoom {
  room_id: string;
  number: string;
  floor: string | null;
  room_type_name: string;
  room_status: RoomStatus;
  note: string | null;
  arrival_today: boolean;
  departure_today: boolean;
  task_id: string | null;
  task_kind: 'cleaning' | 'maintenance' | 'inspection' | null;
  task_status: HousekeepingStatus | null;
  task_note: string | null;
  task_photo_path: string | null;
  task_due_date: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
}

export interface HousekeepingData {
  date: string;
  items: HousekeepingRoom[];
  staff: { user_id: string; name: string; role: StaffRole }[];
}

export interface ManagedRoomType {
  id: string;
  name: string;
  description: string | null;
  capacity_adults: number;
  capacity_children: number;
  bed_setup: string | null;
  size_m2: number | null;
  view: string | null;
  balcony: boolean;
  air_conditioning: boolean;
  wifi: boolean;
  breakfast: boolean;
  amenities: string[];
  base_price_cents: number;
  currency: string;
  cover_path: string | null;
  sort_order: number;
  active: boolean;
  room_count: number;
}

export interface ManagedRoom {
  id: string;
  room_type_id: string;
  room_type_name: string;
  number: string;
  floor: string | null;
  status: RoomStatus;
  housekeeping_note: string | null;
  sort_order: number;
  active: boolean;
}

export interface ManagedRatePlan {
  id: string;
  room_type_id: string | null;
  room_type_name: string | null;
  name: string;
  description: string | null;
  booking_mode: BookingMode;
  cancellation_policy: string | null;
  cancellation_hours: number;
  deposit_percent: number;
  includes_breakfast: boolean;
  min_stay: number;
  max_stay: number | null;
  sort_order: number;
  active: boolean;
}

export interface PropertyInventory {
  room_types: ManagedRoomType[];
  rooms: ManagedRoom[];
  rate_plans: ManagedRatePlan[];
}

export interface ManagedProperty {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  property_type: PropertyType;
  description: string | null;
  status: PropertyStatus;
  verification_status: VerificationStatus;
  verification_note: string | null;
  verified_at: string | null;
  published_at: string | null;
  city: string;
  district_id: number | null;
  neighborhood_id: number | null;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tax_office: string | null;
  tax_number: string | null;
  invoice_title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  documents_required: boolean;
  room_capacity: number | null;
  checkin_time: string;
  checkout_time: string;
  languages: string[];
  policies: Record<string, unknown>;
  amenities: string[];
  cover_path: string | null;
  rating_avg: number;
  rating_count: number;
  view_count: number;
  commission_rate: number;
  settings: PropertySettings;
  created_at: string;
  updated_at: string;
  role: StaffRole | 'admin';
  can_manage: boolean;
  missing: string[];
  counts: {
    room_types: number;
    rooms: number;
    rate_plans: number;
    documents: number;
    media: number;
  };
}

export interface ReservationAvailableRoom {
  id: string;
  number: string;
  floor: string | null;
  status: RoomStatus;
  busy: boolean;
  blocked: boolean;
}

export interface Campaign {
  id: string;
  title: string;
  description: string | null;
  cover_path: string | null;
  kind: CampaignKind;
  start_date: string;
  end_date: string;
  booking_deadline: string | null;
  room_type_ids: string[];
  rate_plan_ids: string[];
  discount_percent: number;
  fixed_price_cents: number | null;
  min_nights: number;
  max_nights: number | null;
  quota: number | null;
  used_count: number;
  stackable: boolean;
  status: CampaignStatus;
  created_at: string;
}

export interface CampaignListData {
  items: Campaign[];
  room_types: { id: string; name: string }[];
  rate_plans: { id: string; name: string; room_type_id: string | null }[];
}

export interface MediaItem {
  id: string;
  room_type_id: string | null;
  room_type_name: string | null;
  kind: 'image' | 'video';
  category: MediaCategory;
  storage_path: string;
  thumbnail_path: string | null;
  caption: string | null;
  cover: boolean;
  sort_order: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface MediaListData {
  items: MediaItem[];
  room_types: { id: string; name: string }[];
}

export interface StaffMember {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
  role: StaffRole;
  permissions: string[];
  status: 'active' | 'invited' | 'revoked';
  created_at: string;
}

export interface StaffListData {
  items: StaffMember[];
  can_manage: boolean;
}

export interface MessageThread {
  reservation_id: string;
  reservation_code: string;
  guest_name: string;
  guest_user_id: string | null;
  status: ReservationStatus;
  check_in: string;
  check_out: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface Message {
  id: string;
  sender_role: 'guest' | 'property';
  sender_id: string;
  sender_name: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface MessageThreadListData {
  items: MessageThread[];
}

export interface MessageListData {
  reservation_id: string;
  guest_name: string;
  items: Message[];
  can_reply: boolean;
}

export interface Review {
  id: string;
  reservation_id: string | null;
  guest_name: string;
  guest_avatar_path: string | null;
  rating: number;
  cleanliness: number | null;
  staff_score: number | null;
  location_score: number | null;
  value_score: number | null;
  comment: string | null;
  owner_reply: string | null;
  status: 'published' | 'hidden';
  created_at: string;
  replied_at: string | null;
}

export interface ReviewListData {
  items: Review[];
  average: number;
  count: number;
}

export interface PropertyDocument {
  id: string;
  kind: string;
  title: string;
  storage_path: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface PropertyDocumentListData {
  items: PropertyDocument[];
}

export interface AccommodationDocument {
  id: string;
  reservation_id: string | null;
  kind: 'reservation' | 'invoice' | 'receipt' | 'statement';
  number: string;
  title: string;
  total_cents: number;
  currency: string;
  storage_path: string | null;
  issued_at: string;
  guest_name: string | null;
  reservation_code: string | null;
  snapshot?: Record<string, unknown>;
}

export interface ReportData {
  property: {
    id: string;
    name: string;
    district: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    tax_office: string | null;
    tax_number: string | null;
  };
  from: string;
  to: string;
  daily: {
    date: string;
    revenue_cents: number;
    collected_cents: number;
    expenses_cents: number;
    commission_cents: number;
  }[];
  reservations: {
    code: string;
    guest_name: string;
    source: ReservationSource;
    status: ReservationStatus;
    check_in: string;
    check_out: string;
    nights: number;
    room_type: string;
    room_number: string | null;
    adults: number;
    children: number;
    total_cents: number;
    paid_cents: number;
    commission_cents: number;
    currency: string;
  }[];
  totals: {
    revenue_cents: number;
    collected_cents: number;
    expenses_cents: number;
    commission_cents: number;
    reservation_count: number;
  };
  generated_at: string;
}

export interface ActivityEntry {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
}

export interface ActivityListData {
  items: ActivityEntry[];
}

export interface DocumentsListData {
  items: AccommodationDocument[];
}

export interface WebTracking {
  slug: string;
  status: PropertyStatus;
  verification_status: VerificationStatus;
  published_at: string | null;
  view_count: number;
  reservation_count: number;
  direct_web_count: number;
  last_30_days: number;
  completed_revenue_cents: number;
  conversion_rate: number;
  sources: { source: ReservationSource; count: number }[];
}

export interface PropertySettings {
  hold_minutes?: number;
  notify_new_reservation?: boolean;
  notify_cancellation?: boolean;
  notify_messages?: boolean;
  auto_checkout?: boolean;
  web_tracking?: boolean;
}

export interface MyReservation {
  id: string;
  code: string;
  status: ReservationStatus;
  source: ReservationSource;
  booking_mode: BookingMode;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  total_cents: number;
  commission_cents: number;
  currency: string;
  payment_status: PaymentStatus;
  hold_expires_at: string | null;
  created_at: string;
  property: {
    id: string;
    name: string;
    slug: string;
    property_type: PropertyType;
    district: string | null;
    cover_path: string | null;
  };
  room_type_name: string;
  rate_plan_name: string;
  can_cancel: boolean;
}

export interface MyReservationDetail {
  id: string;
  code: string;
  status: ReservationStatus;
  source: ReservationSource;
  booking_mode: BookingMode;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  total_cents: number;
  discount_cents: number;
  commission_cents: number;
  currency: string;
  payment_status: PaymentStatus;
  notes: string | null;
  hold_expires_at: string | null;
  created_at: string;
  property: {
    id: string;
    name: string;
    slug: string;
    property_type: PropertyType;
    district: string | null;
    neighborhood: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    checkin_time: string;
    checkout_time: string;
    policies: Record<string, unknown>;
    cover_path: string | null;
  };
  room_type_name: string;
  rate_plan_name: string;
  can_cancel: boolean;
  history: {
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: string;
  }[];
}

export interface BookResult {
  id: string;
  code: string;
  status: ReservationStatus;
  booking_mode: BookingMode;
  check_in: string;
  check_out: string;
  nights: number;
  total_cents: number;
  commission_cents: number;
  currency: string;
  hold_expires_at: string | null;
  property_name: string;
  room_type_name: string;
}

export interface GuestRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  contact_consent: boolean;
  reservation_count: number;
  total_spent_cents: number;
  open_balance_cents: number;
  last_stay: string | null;
}

export interface GuestListData {
  items: GuestRow[];
  total: number;
}

export type PropertyMissingResponse = string[];

export interface AdminProperty {
  id: string;
  name: string;
  slug: string;
  property_type: PropertyType;
  status: PropertyStatus;
  verification_status: VerificationStatus;
  verification_note: string | null;
  district: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_number: string | null;
  created_at: string;
  owner: { id: string; username: string; display_name: string | null; avatar_path: string | null };
  missing: string[];
  documents: {
    id: string;
    kind: string;
    title: string;
    storage_path: string;
    status: 'pending' | 'approved' | 'rejected';
  }[];
  room_type_count: number;
  room_count: number;
}

export interface AdminPropertyList {
  items: AdminProperty[];
  counts: { pending: number; published: number; rejected: number; suspended: number };
}
