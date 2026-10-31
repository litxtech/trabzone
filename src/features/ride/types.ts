/**
 * Trabzone Yolculuk Paylaşımı — istemci tipleri.
 *
 * Şekiller `supabase/migrations/0035_ride_core.sql` ve `0036_ride_trips.sql`
 * içindeki SECURITY DEFINER RPC'lerin döndürdüğü JSON ile birebir eşleşir.
 * İstemci hiçbir zaman ride_* tablolarını doğrudan okumaz.
 */

export type RideScope = 'intracity' | 'intercity';
export type RideMode = 'instant' | 'scheduled';
export type RideRouteMode = 'fixed' | 'flexible';
export type RideBookingMode = 'manual' | 'auto';
export type RideVisibility = 'public' | 'friends' | 'private';
export type RidePaymentMethod = 'cash' | 'card';
export type RideLevel = 'verified' | 'silver' | 'gold' | 'platinum';

export type OfferStatus =
  | 'draft'
  | 'published'
  | 'full'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'expired';

export type ReservationStatus =
  | 'requested'
  | 'awaiting_approval'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'started'
  | 'completed'
  | 'disputed';

export type VerificationKind =
  | 'identity'
  | 'driver_license'
  | 'insurance'
  | 'transport_license';

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type Verification = {
  id: string;
  kind: VerificationKind;
  status: VerificationStatus;
  expires_at: string | null;
  reject_reason: string | null;
  created_at: string;
  reviewed_at?: string | null;
  document_path?: string;
  meta?: Record<string, unknown>;
};

export type RidePreferences = {
  smoking?: boolean;
  ac?: boolean;
  pets?: boolean;
  music?: 'none' | 'low' | 'any';
  quiet?: boolean;
  chat?: 'quiet' | 'friendly' | 'any';
  breaks?: boolean;
  charging?: boolean;
  child_seat?: boolean;
  women_only?: boolean;
  accessible_required?: boolean;
  [key: string]: unknown;
};

export type RidePolicy = {
  version: string;
  title: string;
  items: string[];
};

export type RideMemberProfile = {
  user_id: string;
  identity_status: 'unverified' | 'pending' | 'approved' | 'rejected' | 'expired';
  /** Sunucunun hesapladığı, süresi geçmemiş onaylı kimlik bayrağı. */
  identity_verified?: boolean;
  identity_verified_at?: string | null;
  driver_status: 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';
  driver_bio: string | null;
  level: RideLevel;
  completed_trips: number;
  cancelled_trips: number;
  rating_avg: number | null;
  review_count: number;
  preferences: RidePreferences;
  vehicle_count: number;
  verifications: Verification[];
  policy: RidePolicy;
};

export type RideVehicleDocument = {
  id: string;
  kind: 'registration' | 'insurance' | 'inspection' | 'authorization';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  document_path: string;
  expires_at: string | null;
  reject_reason: string | null;
  created_at: string;
};

export type RideVehicle = {
  id: string;
  owner_id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  seat_capacity: number;
  luggage_capacity: 'small' | 'medium' | 'large';
  has_ac: boolean;
  fuel_type: 'gasoline' | 'diesel' | 'lpg' | 'hybrid' | 'electric';
  accessibility: Record<string, unknown>;
  photo_paths: string[];
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  is_active: boolean;
  reject_reason: string | null;
  created_at: string;
  documents: RideVehicleDocument[];
};

export type SeatAllocation = {
  seat_no: number;
  from_seq: number;
  to_seq: number;
  status?: string;
};

export type SeatAvailability = {
  seats_total: number;
  max_seq: number;
  segments: {
    from_seq: number;
    to_seq: number;
    occupied: number;
    available: number;
  }[];
  seats: {
    seat_no: number;
    occupied: { from_seq: number; to_seq: number }[];
  }[];
};

export type RideStop = {
  id: string;
  seq: number;
  kind: 'origin' | 'waypoint' | 'destination';
  label: string;
  city: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  arrive_offset_minutes: number | null;
  is_public: boolean;
};

export type RideDriverPublic = {
  id: string;
  username: string;
  first_name: string | null;
  avatar_path: string | null;
  /** Genel profil doğrulaması (sosyal rozet). */
  is_verified: boolean;
  /** Yolculuk kimliği doğrulaması; mavi tik bu alandan gelir. */
  identity_verified?: boolean;
  bio?: string | null;
  level: RideLevel | null;
  rating_avg: number | null;
  review_count?: number;
  completed_trips: number | null;
};

export type RideVehiclePublic = {
  id?: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate?: string;
  seat_capacity?: number;
  luggage_capacity?: string;
  has_ac: boolean;
  fuel_type?: string;
  accessibility: Record<string, unknown>;
  photo_paths?: string[];
  /** Araç belgeleri yönetici tarafından onaylanmış mı? */
  verified?: boolean;
};

export type RideSearchItem = {
  id: string;
  scope: RideScope;
  mode: RideMode;
  status: OfferStatus;
  origin_label: string;
  origin_city: string;
  origin_district: string | null;
  dest_label: string;
  dest_city: string;
  dest_district: string | null;
  depart_at: string;
  depart_flex_minutes: number;
  duration_minutes: number | null;
  distance_meters: number | null;
  price_per_seat_cents: number;
  currency: string;
  seats_total: number;
  seats_available: number;
  luggage: string;
  preferences: RidePreferences;
  route_mode: RideRouteMode;
  booking_mode: RideBookingMode;
  visibility: RideVisibility;
  /** 0226: kartta "yayınlandı" zamanı ve kullanıcının aktif rezervasyonu. */
  created_at?: string;
  published_at?: string | null;
  my_reservation_id?: string | null;
  my_reservation_status?: ReservationStatus | null;
  driver: RideDriverPublic;
  vehicle: RideVehiclePublic;
  match: {
    score: number | null;
    pickup_distance_m: number | null;
    dropoff_distance_m: number | null;
    approx_detour_m: number | null;
    time_delta_min: number | null;
    reasons: string[];
  };
};

export type RideSearchResponse = {
  items: RideSearchItem[];
  total: number;
  limit: number;
  offset: number;
  map_available: boolean;
  map_note: string;
};

export type RidePublicConfig = {
  card_payments_enabled: boolean;
  commercial_mode_enabled: boolean;
  currency: string;
};

export type RideWaitlistOffer = {
  id: string;
  offer_id: string;
  waitlist_id: string;
  expires_at: string;
  seats: number;
  pickup_seq: number;
  dropoff_seq: number;
  offer: {
    id: string;
    origin_label: string;
    origin_city: string;
    dest_label: string;
    dest_city: string;
    depart_at: string;
    duration_minutes: number | null;
    distance_meters: number | null;
    price_per_seat_cents: number;
    currency: string;
    seats_total: number;
    scope: RideScope;
    status: OfferStatus;
  };
};

export type RideOfferDetail = {
  id: string;
  scope: RideScope;
  mode: RideMode;
  status: OfferStatus;
  origin_label: string;
  origin_address: string | null;
  origin_city: string;
  origin_district: string | null;
  origin_lat: number;
  origin_lng: number;
  dest_label: string;
  dest_address: string | null;
  dest_city: string;
  dest_district: string | null;
  dest_lat: number;
  dest_lng: number;
  depart_at: string;
  depart_flex_minutes: number;
  duration_minutes: number | null;
  distance_meters: number | null;
  price_per_seat_cents: number;
  currency: string;
  seats_total: number;
  luggage: string;
  preferences: RidePreferences;
  route_mode: RideRouteMode;
  max_detour_meters: number | null;
  max_detour_minutes: number | null;
  booking_mode: RideBookingMode;
  visibility: RideVisibility;
  notes: string | null;
  policy_version: string;
  is_driver: boolean;
  is_participant: boolean;
  my_reservation_id: string | null;
  my_reservation_status: ReservationStatus | null;
  driver: RideDriverPublic;
  vehicle: RideVehiclePublic;
  stops: RideStop[];
  availability: SeatAvailability;
  policy: RidePolicy;
  waitlist: { id: string; status: 'waiting' | 'offered'; position: number } | null;
};

export type ReservationPassenger = {
  id: string;
  full_name: string;
  seat_no: number;
  is_primary: boolean;
  boarded_at: string | null;
  alighted_at: string | null;
};

export type RideReservation = {
  id: string;
  status: ReservationStatus;
  seats: number;
  total_cents: number;
  currency: string;
  payment_method: RidePaymentMethod;
  payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';
  pickup_label: string;
  dropoff_label: string;
  pickup_seq: number;
  dropoff_seq: number;
  boarding_code: string | null;
  alighting_code: string | null;
  hold_expires_at: string | null;
  created_at: string;
  started_at: string | null;
  boarded_at: string | null;
  alighted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  note: string | null;
  policy_version: string;
  offer_id: string;
  offer_status: OfferStatus;
  scope: RideScope;
  mode: RideMode;
  origin_label: string;
  dest_label: string;
  origin_city: string;
  dest_city: string;
  depart_at: string;
  price_per_seat_cents: number;
  driver_id: string;
  driver_username: string;
  driver_first_name: string | null;
  driver_avatar_path: string | null;
  driver_verified: boolean;
  driver_identity_verified?: boolean;
  driver_level: RideLevel | null;
  driver_rating: number | null;
  driver_trips: number | null;
  vehicle: {
    make: string;
    model: string;
    year: number;
    color: string;
    plate: string;
    has_ac: boolean;
    accessibility: Record<string, unknown>;
  };
  passenger_id: string;
  passenger_username: string;
  passenger_first_name: string | null;
  passenger_avatar_path: string | null;
  passenger_identity_verified?: boolean;
  passengers: ReservationPassenger[];
  seats_detail: SeatAllocation[];
  has_reviewed: boolean;
};

export type RideTripDetail = {
  reservation: RideReservation;
  is_driver: boolean;
  policy: RidePolicy;
  tracking: RideTrackingSnapshot | null;
};

export type RideTrackingSnapshot = {
  active: boolean;
  note?: string;
  lat?: number;
  lng?: number;
  heading?: number | null;
  speed_kmh?: number | null;
  updated_at?: string;
  remaining_meters?: number | null;
  eta_minutes?: number | null;
  eta_note?: string;
};

export type RideMyOffer = {
  id: string;
  scope: RideScope;
  mode: RideMode;
  status: OfferStatus;
  origin_label: string;
  dest_label: string;
  depart_at: string;
  seats_total: number;
  price_per_seat_cents: number;
  currency: string;
  booking_mode: RideBookingMode;
  visibility: RideVisibility;
  distance_meters: number | null;
  requested_count: number;
  confirmed_count: number;
  availability: SeatAvailability;
};

export type RideRequest = {
  id: string;
  scope: RideScope;
  origin_label: string;
  origin_city: string;
  dest_label: string;
  dest_city: string;
  earliest_depart: string;
  latest_depart: string;
  party_size: number;
  luggage: string;
  preferences: RidePreferences;
  status: 'open' | 'matched' | 'closed' | 'expired';
  notes: string | null;
  created_at: string;
  expires_at: string;
};

export type RideFavorite = {
  id: string;
  label: string;
  scope: RideScope;
  origin_label: string;
  origin_city: string;
  dest_label: string;
  dest_city: string;
  origin_lat: number | null;
  origin_lng: number | null;
  dest_lat: number | null;
  dest_lng: number | null;
  alert_enabled: boolean;
  created_at: string;
};

export type RideRecurring = {
  id: string;
  role: 'driver' | 'passenger';
  scope: RideScope;
  origin_label: string;
  origin_city: string;
  dest_label: string;
  dest_city: string;
  weekdays: number[];
  depart_time: string;
  return_time: string | null;
  seats: number;
  price_per_seat_cents: number | null;
  preferences: RidePreferences;
  is_active: boolean;
  paused_dates: string[];
  paused_until: string | null;
  vehicle_id: string | null;
  luggage: string;
  booking_mode: RideBookingMode;
  visibility: RideVisibility;
  created_at: string;
};

export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  notify_on_sos: boolean;
};

export type RideSosResult = {
  incident_id: string;
  status: string;
  emergency_number: '112';
  contacts: { name: string; phone: string }[];
  disclaimer: string;
};

export type RideReview = {
  id: string;
  rating: number;
  comment: string | null;
  categories: Record<string, number>;
  created_at: string;
  author_role: 'driver' | 'passenger';
  author_username: string;
  author_first_name: string | null;
  author_avatar_path: string | null;
};

export type RideReviewsResponse = {
  items: RideReview[];
  summary: {
    rating_avg: number | null;
    review_count: number;
    level: RideLevel | null;
    completed_trips: number | null;
  } | null;
};

export type PriceHint =
  | {
      available: true;
      distance_km: number;
      estimated_cost_cents: number;
      per_seat_cents: number;
      suggested_min_cents: number;
      suggested_max_cents: number;
      formula: string;
      note: string;
    }
  | { available: false; reason: string };

export type LocationShare = {
  id: string;
  token: string;
  expires_at: string;
};

/**
 * Süreli konum bağlantısının karşı taraf görünümü.
 *
 * `ride_location_share_view` token'ı doğrular; süresi dolmuş veya iptal
 * edilmiş bağlantıda RPC hata döner. Konum henüz akmamışsa `lat`/`lng` null
 * gelir — bu durumda uydurma koordinat gösterilmez.
 */
export type LocationShareView = {
  shared_by: string;
  offer_status: string;
  origin_label: string;
  dest_label: string;
  depart_at: string;
  expires_at: string;
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  updated_at: string | null;
  note: string;
};

export type Paged<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

// ---------------------------------------------------------------------------
// Yönetim paneli
// ---------------------------------------------------------------------------

export type RideAdminOverview = {
  offers: {
    active: number;
    started: number;
    scheduled: number;
    today: number;
    completed_30d: number;
  };
  reservations: {
    requested: number;
    confirmed: number;
    active: number;
    today: number;
    completed_30d: number;
    cancelled_30d: number;
  };
  queues: {
    verifications: number;
    vehicles: number;
    vehicle_documents: number;
    disputes: number;
    incidents: number;
    critical_incidents: number;
    waitlists: number;
    expiring_documents: number;
  };
  finance: {
    cash_reservations_30d: number;
    cash_reported_cents_30d: number;
    card_payments: number;
    verified_paid_cents: number;
    refund_requests: number;
    refunds_total_cents: number;
    note: string;
  };
  community: {
    reviews: number;
    rating_avg: number | null;
    verified_members: number;
    approved_drivers: number;
    vehicles_approved: number;
    recurring_active: number;
  };
  config: {
    card_payments_enabled: boolean;
    commercial_enabled: boolean;
    hold_minutes: number | string;
    free_hours_intracity: number | string;
    free_hours_intercity: number | string;
    cost_per_km_cents: number | string | null;
  };
};

export type RideAdminOffer = {
  id: string;
  scope: RideScope;
  mode: RideMode;
  status: OfferStatus;
  origin_label: string;
  origin_city: string;
  dest_label: string;
  dest_city: string;
  depart_at: string;
  seats_total: number;
  price_per_seat_cents: number;
  currency: string;
  distance_meters: number | null;
  booking_mode: RideBookingMode;
  visibility: RideVisibility;
  route_mode: RideRouteMode;
  recurring_id: string | null;
  created_at: string;
  driver: RideDriverPublic & { identity_status?: string; driver_status?: string };
  vehicle: { id: string; make: string; model: string; year: number; plate: string; status: string };
  reservations: { requested: number; confirmed: number; started: number; completed: number };
  availability: SeatAvailability;
};

export type RideAdminReservation = {
  id: string;
  status: ReservationStatus;
  seats: number;
  total_cents: number;
  currency: string;
  payment_method: RidePaymentMethod;
  payment_status: string;
  pickup_label: string;
  dropoff_label: string;
  hold_expires_at: string | null;
  created_at: string;
  depart_at: string;
  offer_id: string;
  offer_status: OfferStatus;
  origin_label: string;
  dest_label: string;
  driver: { id: string; username: string; first_name: string | null; last_name?: string | null };
  passenger: {
    id: string;
    username: string;
    first_name: string | null;
    last_name?: string | null;
    is_verified?: boolean;
  };
  has_open_dispute: boolean;
};

export type RideAdminVerification = {
  id: string;
  kind: string;
  status: string;
  document_path: string;
  expires_at: string | null;
  reject_reason: string | null;
  created_at: string;
  meta: Record<string, unknown>;
  user: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    avatar_path: string | null;
    is_verified: boolean;
    identity_status: string;
    driver_status: string;
    level: string;
    rating_avg: number | null;
    completed_trips: number | null;
  };
};

export type RideAdminDriverApplication = {
  user_id: string;
  identity_status: string;
  driver_status: string;
  driver_bio: string | null;
  level: string;
  rating_avg: number | null;
  completed_trips: number;
  created_at: string;
  updated_at: string;
  user: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    avatar_path: string | null;
    is_verified: boolean;
  };
  license_ok: boolean;
  vehicles: { total: number; approved: number };
  documents: {
    id: string;
    kind: string;
    status: string;
    expires_at: string | null;
    reject_reason: string | null;
    created_at: string;
  }[];
};

export type RideAdminVehicle = RideVehicle & {
  owner: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    identity_status: string;
    driver_status: string;
  };
};

export type RideAdminDispute = {
  id: string;
  category: string;
  description: string;
  status: string;
  resolution: string | null;
  refund_cents: number;
  created_at: string;
  reservation_id: string;
  opened_by: { id: string; username: string; first_name: string | null; last_name: string | null };
  against: { id: string; username: string; first_name: string | null; last_name: string | null } | null;
  reservation: {
    status: ReservationStatus;
    seats: number;
    total_cents: number;
    payment_method: RidePaymentMethod;
    payment_status: string;
    origin_label: string;
    dest_label: string;
    depart_at: string;
  };
};

export type RideAdminIncident = {
  id: string;
  kind: string;
  severity: string;
  status: string;
  lat: number | null;
  lng: number | null;
  note: string | null;
  created_at: string;
  handled_at: string | null;
  reservation_id: string | null;
  offer_id: string | null;
  user: { id: string; username: string; first_name: string | null; last_name: string | null };
  offer: {
    origin_label: string;
    dest_label: string;
    depart_at: string;
    status: string;
  } | null;
};

export type RideAdminPayment = {
  id: string;
  reservation_id: string;
  provider: string;
  provider_intent_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  failure_code: string | null;
  created_at: string;
  payer: { id: string; username: string; first_name: string | null; last_name: string | null };
};

export type RideAdminRefund = {
  id: string;
  reservation_id: string;
  amount_cents: number;
  reason: string;
  status: string;
  provider_refund_id: string | null;
  created_at: string;
  decided_at: string | null;
};

export type RideAdminFinance = {
  payments: RideAdminPayment[];
  refunds: RideAdminRefund[];
  totals: {
    verified_paid_cents: number;
    authorized_cents: number;
    refund_requested_cents: number;
    refund_completed_cents: number;
    cash_reported_cents: number;
  };
  provider_ready: boolean;
  note: string;
};

export type RideAdminSettings = {
  items: {
    key: string;
    value: unknown;
    description: string | null;
    is_public: boolean;
    updated_at: string;
  }[];
  editable_keys: string[];
  locked_keys: Record<string, string>;
};

export type RideAdminAnalytics = {
  days: number;
  series: {
    date: string;
    offers: number;
    reservations: number;
    completed: number;
    cancelled: number;
    new_members: number;
  }[];
  top_routes: { origin: string; dest: string; trips: number }[];
  top_drivers: {
    user_id: string;
    username: string;
    first_name: string | null;
    completed_trips: number;
    rating_avg: number | null;
    level: string;
  }[];
  verification_funnel: {
    members: number;
    identity_approved: number;
    drivers_approved: number;
    vehicles_approved: number;
  };
  dispute_rate: number;
};

export type RideAdminAuditEntry = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: { id: string; username: string; first_name: string | null; last_name: string | null } | null;
};

export type RideAdminRequest = {
  id: string;
  scope: RideScope;
  origin_label: string;
  origin_city: string;
  dest_label: string;
  dest_city: string;
  earliest_depart: string;
  latest_depart: string;
  party_size: number;
  luggage: string;
  preferences: RidePreferences;
  mandatory: string[];
  status: 'open' | 'matched' | 'closed' | 'expired';
  notes: string | null;
  created_at: string;
  expires_at: string;
  passenger: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    avatar_path: string | null;
    identity_status?: string;
    level?: RideLevel;
    rating_avg?: number | null;
    completed_trips?: number | null;
  };
};

export type RideAdminWaitlist = {
  id: string;
  offer_id: string;
  seats: number;
  pickup_seq: number;
  dropoff_seq: number;
  status: 'waiting' | 'offered' | 'converted' | 'expired' | 'left';
  created_at: string;
  position: number;
  user: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    is_verified: boolean;
  };
  offer: {
    id: string;
    origin_label: string;
    origin_city: string;
    dest_label: string;
    dest_city: string;
    depart_at: string;
    status: OfferStatus;
    seats_total: number;
  };
  active_offer: { id: string; status: string; expires_at: string } | null;
};

export type RideAdminReview = {
  id: string;
  rating: number;
  comment: string | null;
  categories: Record<string, number>;
  status: 'published' | 'hidden';
  author_role: 'driver' | 'passenger';
  created_at: string;
  reservation_id: string;
  author: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    avatar_path: string | null;
  };
  subject: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    avatar_path: string | null;
  };
  reservation: {
    origin_label: string;
    dest_label: string;
    depart_at: string;
    status: ReservationStatus;
  };
};

export type RideAdminRecurring = {
  id: string;
  role: 'driver' | 'passenger';
  scope: RideScope;
  origin_label: string;
  origin_city: string;
  dest_label: string;
  dest_city: string;
  weekdays: number[];
  depart_time: string;
  return_time: string | null;
  seats: number;
  price_per_seat_cents: number | null;
  is_active: boolean;
  paused_dates: string[];
  paused_until: string | null;
  created_at: string;
  user: {
    id: string;
    username: string;
    first_name: string | null;
    last_name: string | null;
    identity_status?: string;
    driver_status?: string;
  };
  generated_offers: number;
};
