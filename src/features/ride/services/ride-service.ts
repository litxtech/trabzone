import { Image } from 'react-native';

import { env } from '@/config/env';
import { appError, type AppErrorCode } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import {
  loadLegacyFileSystem,
  localFileSize,
  releaseTempFile,
  type LegacyFileSystem,
} from '@/features/media/local-file';
import { isR2Path, R2_ENABLED, r2PublicUrl, uploadToR2 } from '@/features/media/r2-service';

import type {
  EmergencyContact,
  LocationShare,
  LocationShareView,
  Paged,
  PriceHint,
  ReservationStatus,
  RideAdminAuditEntry,
  RideAdminDispute,
  RideAdminDriverApplication,
  RideAdminFinance,
  RideAdminIncident,
  RideAdminOffer,
  RideAdminOverview,
  RideAdminReservation,
  RideAdminRequest,
  RideAdminRecurring,
  RideAdminReview,
  RideAdminSettings,
  RideAdminVehicle,
  RideAdminVerification,
  RideAdminWaitlist,
  RideBookingMode,
  RideFavorite,
  RideMemberProfile,
  RideMode,
  RideMyOffer,
  RideOfferDetail,
  RidePublicConfig,
  RideRecurring,
  RideRequest,
  RideReservation,
  RideReviewsResponse,
  RideScope,
  RideSearchResponse,
  RideSosResult,
  RideTrackingSnapshot,
  RideTripDetail,
  RideVehicle,
  RideVisibility,
  RideWaitlistOffer,
  SeatAvailability,
  Verification,
  VerificationKind,
} from '../types';

type RpcArgs = Record<string, unknown>;

async function call<T>(fn: string, args: RpcArgs = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as T);
}

/**
 * Oturumdaki kullanıcı kimliği.
 *
 * Önce yerel oturum önbelleği okunur: `getUser()` her çağrıda ağ gider ve
 * bağlantı yavaşken belge yüklemesini gereksiz yere bekletiyordu. Önbellekte
 * oturum yoksa sunucuya sorulur.
 */
export async function currentRideUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const cached = data.session?.user?.id;
  if (cached) {
    return cached;
  }
  const { data: remote } = await supabase.auth.getUser();
  return remote.user?.id ?? null;
}

export const rideQueryKeys = {
  profile: ['ride', 'profile'] as const,
  vehicles: ['ride', 'vehicles'] as const,
  offer: (id: string) => ['ride', 'offer', id] as const,
  search: (filters: Record<string, unknown>) => ['ride', 'search', filters] as const,
  trips: (status?: string | null) => ['ride', 'trips', status ?? 'all'] as const,
  trip: (id: string) => ['ride', 'trip', id] as const,
  myOffers: ['ride', 'offers', 'mine'] as const,
  offerReservations: (id: string) => ['ride', 'offer', id, 'reservations'] as const,
  requests: ['ride', 'requests'] as const,
  favorites: ['ride', 'favorites'] as const,
  recurring: ['ride', 'recurring'] as const,
  contacts: ['ride', 'contacts'] as const,
  reviews: (userId: string) => ['ride', 'reviews', userId] as const,
  waitlistOffers: ['ride', 'waitlist', 'offers'] as const,
  locationShare: (token: string) => ['ride', 'share', token] as const,
  publicConfig: ['ride', 'public-config'] as const,
  admin: ['ride', 'admin'] as const,
};

export const getRidePublicConfig = () => call<RidePublicConfig>('ride_public_config');

// ---------------------------------------------------------------------------
// Profil ve doğrulama
// ---------------------------------------------------------------------------

export const getRideProfile = () => call<RideMemberProfile>('ride_my_profile');

export const submitVerification = (input: {
  kind: VerificationKind;
  documentPath: string;
  expiresAt?: string | null;
  meta?: Record<string, unknown>;
}) =>
  call<{ id: string; status: string }>('ride_verification_submit', {
    p_kind: input.kind,
    p_document_path: input.documentPath,
    // RPC `date` bekler; tam ISO zaman damgası bazı sürümlerde reddedilir.
    p_expires_at: input.expiresAt ? input.expiresAt.slice(0, 10) : null,
    p_meta: input.meta ?? {},
  });

export const applyDriver = (bio: string) =>
  call<{ driver_status: string }>('ride_driver_apply', { p_bio: bio });

// ---------------------------------------------------------------------------
// Garaj
// ---------------------------------------------------------------------------

export const listVehicles = () =>
  call<{ items: RideVehicle[] }>('ride_my_vehicles').then((result) =>
    result.ok ? ok(result.data.items) : result,
  );

export type VehicleInput = {
  id?: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  seatCapacity: number;
  luggageCapacity: 'small' | 'medium' | 'large';
  hasAc: boolean;
  fuelType: 'gasoline' | 'diesel' | 'lpg' | 'hybrid' | 'electric';
  accessibility: Record<string, unknown>;
  photoPaths?: string[];
};

export const saveVehicle = (input: VehicleInput) =>
  call<{ id: string }>('ride_vehicle_save', {
    p_payload: {
      id: input.id ?? null,
      make: input.make,
      model: input.model,
      year: input.year,
      color: input.color,
      plate: input.plate,
      seat_capacity: input.seatCapacity,
      luggage_capacity: input.luggageCapacity,
      has_ac: input.hasAc,
      fuel_type: input.fuelType,
      accessibility: input.accessibility,
      photo_paths: input.photoPaths ?? [],
    },
  });

export const removeVehicle = (vehicleId: string) =>
  call<{ ok: boolean }>('ride_vehicle_remove', { p_vehicle_id: vehicleId });

export const submitVehicleDocument = (input: {
  vehicleId: string;
  kind: 'registration' | 'insurance' | 'inspection' | 'authorization';
  documentPath: string;
  expiresAt?: string | null;
}) =>
  call<{ id: string; status: string }>('ride_vehicle_document_submit', {
    p_vehicle_id: input.vehicleId,
    p_kind: input.kind,
    p_document_path: input.documentPath,
    p_expires_at: input.expiresAt ? input.expiresAt.slice(0, 10) : null,
  });

const SAFE_NAME = /[^a-zA-Z0-9._-]/g;
/** `ride-documents` kovasındaki tek dosya sınırı (10 MB) ile aynı. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Kimlik belgesi görselleri bu uzun kenara indirilir; yazılar okunur kalır. */
const DOCUMENT_IMAGE_MAX_EDGE = 2000;
const DOCUMENT_IMAGE_QUALITY = 0.85;
/** Araç fotoğrafı kapak olarak kullanıldığı için daha küçük yeterli. */
const VEHICLE_IMAGE_MAX_EDGE = 1600;
const VEHICLE_IMAGE_QUALITY = 0.82;

type UploadBucket = 'ride-documents' | 'ride-vehicle-photos';

type UploadInput = {
  bucket: UploadBucket;
  path: string;
  uri: string;
  name: string;
  mime: string;
  onProgress?: (ratio: number) => void;
};

/** Depo yanıtındaki ham metni kullanıcıya gösterilebilir mesaja çevirir. */
function storageErrorMessage(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? '').toLowerCase();
  if (text.includes('bucket not found')) {
    return 'Belge deposu hazır değil. Daha sonra tekrar dene.';
  }
  if (
    text.includes('row-level security') ||
    text.includes('unauthorized') ||
    text.includes('invalid jwt') ||
    text.includes('jwt expired')
  ) {
    return 'Belge yükleme yetkin yok. Oturumu yenileyip tekrar dene.';
  }
  if (
    text.includes('exceeded the maximum allowed size') ||
    text.includes('too large') ||
    text.includes('payload too large')
  ) {
    return 'Dosya boyutu izin verilen sınırı aşıyor.';
  }
  if (text.includes('mime')) {
    return 'Bu dosya türü desteklenmiyor. PDF veya görsel yükle.';
  }
  return fallback;
}

const AUTH_STORAGE_ERROR = /jwt|unauthorized|row-level security|permission/i;

function storageError(raw: string | null | undefined, fallback: string) {
  const code: AppErrorCode = AUTH_STORAGE_ERROR.test(raw ?? '') ? 'forbidden' : 'unknown';
  return appError(code, storageErrorMessage(raw, fallback));
}

function imageDimensions(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve(width > 0 && height > 0 ? { width, height } : null),
      () => resolve(null),
    );
  });
}

/**
 * Belge görselini tek geçişte küçültüp JPEG'e çevirir.
 *
 * Telefon kamerasıyla çekilen bir kimlik fotoğrafı 6-12 MB olabiliyor; bu hem
 * 10 MB'lık depo sınırını aşıyor hem de yükleme süresini dakikalara çıkarıyordu.
 * 2000 px uzun kenar belge üzerindeki yazıları okunur tutar.
 */
async function compressDocumentImage(
  uri: string,
  maxEdge: number,
  quality: number,
): Promise<string | null> {
  try {
    const [{ ImageManipulator, SaveFormat }, dims] = await Promise.all([
      import('expo-image-manipulator'),
      imageDimensions(uri),
    ]);
    const context = ImageManipulator.manipulate(uri);
    if (dims) {
      const longest = Math.max(dims.width, dims.height);
      if (longest > maxEdge) {
        context.resize(
          dims.width >= dims.height ? { width: maxEdge } : { height: maxEdge },
        );
      }
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    // Manipülatör bu derlemede yoksa veya dosya bozuksa asıl dosya gönderilir.
    return null;
  }
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'belge';
}

type PreparedFile = {
  uri: string;
  name: string;
  mime: string;
  size: number | null;
  /** Sıkıştırma çıktıysa yükleme sonunda silinecek geçici dosya. */
  tempUri: string | null;
};

/** Yüklenmeden önce görselleri küçültür; PDF'ler olduğu gibi kalır. */
async function prepareFile(input: {
  uri: string;
  name: string;
  mime: string;
  size?: number | null;
  maxEdge: number;
  quality: number;
}): Promise<PreparedFile> {
  const original: PreparedFile = {
    uri: input.uri,
    name: input.name,
    mime: input.mime,
    size: input.size ?? null,
    tempUri: null,
  };
  if (!input.mime.startsWith('image/')) {
    return original;
  }
  const compressed = await compressDocumentImage(input.uri, input.maxEdge, input.quality);
  if (!compressed) {
    return original;
  }
  const size = await localFileSize(compressed);
  // Sıkıştırma kazanç sağlamadıysa (ör. zaten küçük JPEG) asıl dosya kalır.
  if (size !== null && original.size !== null && size >= original.size) {
    void releaseTempFile(compressed);
    return original;
  }
  return {
    uri: compressed,
    name: `${stripExtension(input.name)}.jpg`,
    mime: 'image/jpeg',
    size,
    tempUri: compressed,
  };
}

/**
 * Dosyayı imzalı adrese akıtarak yükler.
 *
 * Akış yolu dosyayı JS köprüsüne kopyalamaz ve gerçek ilerleme yüzdesi verir;
 * önceki multipart gövde tüm dosyayı bellekte yeniden yazıyordu. İmzalı adres
 * alınamazsa `null` döner ve çağıran ikili (binary) yola düşer.
 */
async function streamUpload(
  fs: LegacyFileSystem,
  input: UploadInput,
): Promise<Result<{ path: string }> | null> {
  let signedUrl: string | null = null;
  try {
    const { data, error } = await supabase.storage
      .from(input.bucket)
      .createSignedUploadUrl(input.path);
    signedUrl = error ? null : (data?.signedUrl ?? null);
  } catch {
    signedUrl = null;
  }
  if (!signedUrl) {
    return null;
  }

  try {
    const task = fs.createUploadTask(
      signedUrl,
      input.uri,
      {
        httpMethod: 'PUT',
        uploadType: fs.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'Content-Type': input.mime,
          'cache-control': 'max-age=31536000',
          'x-upsert': 'false',
          // İmzalı adres yetkilendirmeyi taşır; anahtar gateway için gerekli.
          Authorization: `Bearer ${env.supabasePublishableKey}`,
        },
      },
      (progress) => {
        if (progress.totalBytesExpectedToSend > 0) {
          input.onProgress?.(
            Math.min(0.99, progress.totalBytesSent / progress.totalBytesExpectedToSend),
          );
        }
      },
    );
    const result = await task.uploadAsync();
    if (result && result.status >= 200 && result.status < 300) {
      return ok({ path: input.path });
    }
    if (result && (result.status === 401 || result.status === 403)) {
      return fail(appError('forbidden'));
    }
    if (result && result.status === 413) {
      return fail(appError('invalid_input', 'Dosya boyutu izin verilen sınırı aşıyor.'));
    }
    if (result && result.status >= 400 && result.status < 500) {
      return fail(storageError(result.body, 'Belge yüklenemedi. Tekrar dene.'));
    }
    // Diğer durumlarda imzalı yol desteklenmiyor olabilir; ikili yola düş.
    return null;
  } catch {
    return null;
  }
}

/** Yedek yol: dosyayı tek parça ikili gövde olarak gönderir (web dahil). */
async function uploadBinary(input: UploadInput): Promise<Result<{ path: string }>> {
  let payload: ArrayBuffer;
  try {
    const response = await fetch(input.uri);
    payload = await response.arrayBuffer();
  } catch {
    return fail(appError('invalid_input', 'Dosya okunamadı. Tekrar dene.'));
  }
  if (payload.byteLength === 0) {
    return fail(appError('invalid_input', 'Dosya boş görünüyor. Başka bir belge seç.'));
  }
  if (payload.byteLength > MAX_DOCUMENT_BYTES) {
    return fail(appError('invalid_input', 'Belge boyutu 10 MB sınırını aşıyor.'));
  }

  input.onProgress?.(0.4);
  const { error } = await supabase.storage.from(input.bucket).upload(input.path, payload, {
    contentType: input.mime,
    upsert: false,
    cacheControl: '31536000',
  });
  if (error) {
    return fail(storageError(error.message, 'Belge yüklenemedi. Tekrar dene.'));
  }
  input.onProgress?.(1);
  return ok({ path: input.path });
}

async function uploadObject(input: UploadInput): Promise<Result<{ path: string }>> {
  const fs = await loadLegacyFileSystem();
  if (fs) {
    const streamed = await streamUpload(fs, input);
    if (streamed) {
      if (streamed.ok) {
        input.onProgress?.(1);
      }
      return streamed;
    }
  }
  return uploadBinary(input);
}

async function uploadFileToBucket(input: UploadInput): Promise<Result<{ path: string }>> {
  // Araç fotoğrafları herkese açıktır ve Cloudflare R2'de tutulur. Sürücü
  // belgeleri gizli kaldığı için Supabase Storage'da kalır (imzalı erişim).
  if (input.bucket === 'ride-vehicle-photos' && R2_ENABLED) {
    const r2Path = input.path.replace(/^([^/]+)\//, '$1/r2/');
    const uploaded = await uploadToR2({
      bucket: input.bucket,
      path: r2Path,
      uri: input.uri,
      contentType: input.mime,
      onProgress: input.onProgress,
    });
    return uploaded.ok ? ok({ path: uploaded.data.path }) : fail(uploaded.error);
  }

  const first = await uploadObject(input);
  if (first.ok || first.error.code !== 'forbidden') {
    return first;
  }
  // Jeton süresi dolmuş olabilir: bir kez yenileyip tekrar dene.
  await supabase.auth.refreshSession().catch(() => null);
  return uploadObject(input);
}

function buildStoragePath(
  userId: string,
  fileName: string,
  fallbackExtension: string,
  randomLength = 8,
) {
  const extension = (fileName.split('.').pop() ?? fallbackExtension).toLowerCase().slice(0, 6);
  const safe = fileName.replace(SAFE_NAME, '_').slice(0, 50) || `belge.${extension}`;
  const stamp = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 2 + randomLength)}`;
  return { path: `${userId}/${stamp}-${safe}`, extension };
}

/**
 * Gizli `ride-documents` kovasına belge yükler.
 *
 * Görseller önce 2000 px'e indirilip JPEG'e çevrilir (yükleme boyutu tipik
 * olarak 10-20 kat küçülür), sonra doğrudan depoya akıtılır. `onProgress`
 * yüzdeyi 0..1 aralığında bildirir.
 */
export async function uploadRideDocument(
  input: {
    uri: string;
    name: string;
    mime: string;
    size?: number;
  },
  onProgress?: (ratio: number) => void,
): Promise<Result<{ path: string }>> {
  const userId = await currentRideUserId();
  if (!userId) {
    return fail(appError('session_missing'));
  }
  if (input.size && input.size > MAX_DOCUMENT_BYTES) {
    return fail(appError('invalid_input', 'Belge boyutu 10 MB sınırını aşıyor.'));
  }

  const prepared = await prepareFile({
    uri: input.uri,
    name: input.name,
    mime: input.mime,
    size: input.size,
    maxEdge: DOCUMENT_IMAGE_MAX_EDGE,
    quality: DOCUMENT_IMAGE_QUALITY,
  });

  try {
    const size = prepared.size ?? (await localFileSize(prepared.uri));
    if (size !== null && size > MAX_DOCUMENT_BYTES) {
      return fail(appError('invalid_input', 'Belge boyutu 10 MB sınırını aşıyor.'));
    }
    const { path } = buildStoragePath(userId, prepared.name, 'bin');
    const uploaded = await uploadFileToBucket({
      bucket: 'ride-documents',
      path,
      uri: prepared.uri,
      name: prepared.name,
      mime: prepared.mime,
      onProgress,
    });
    return uploaded.ok ? ok({ path: uploaded.data.path }) : fail(uploaded.error);
  } finally {
    if (prepared.tempUri) {
      void releaseTempFile(prepared.tempUri);
    }
  }
}

export function rideVehiclePhotoUrl(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  // R2'ye taşınmış araç fotoğrafları aynı yol biçimini kullanır.
  if (isR2Path(path)) {
    return r2PublicUrl('ride-vehicle-photos', path);
  }
  const { data } = supabase.storage.from('ride-vehicle-photos').getPublicUrl(path);
  return data.publicUrl || null;
}

/** Belge görüntüleme: kısa ömürlü imzalı bağlantı üretir (sahibi veya `ride.verify`). */
export async function rideDocumentUrl(
  path: string,
  expiresIn = 120,
): Promise<Result<{ url: string }>> {
  const { data, error } = await supabase.storage
    .from('ride-documents')
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    return fail(
      appError('unknown', 'Belge bağlantısı oluşturulamadı. Yetkin yoksa belgeyi göremezsin.'),
    );
  }
  return ok({ url: data.signedUrl });
}

/** Araç fotoğrafını herkese açık kovaya yükler (yalnızca görsel). */
export async function uploadVehiclePhoto(
  input: {
    uri: string;
    name: string;
    mime: string;
    size?: number;
  },
  onProgress?: (ratio: number) => void,
): Promise<Result<{ path: string; publicUrl: string }>> {
  const userId = await currentRideUserId();
  if (!userId) {
    return fail(appError('session_missing'));
  }
  if (!input.mime.startsWith('image/')) {
    return fail(appError('invalid_input', 'Araç fotoğrafı yalnızca görsel olabilir.'));
  }
  if (input.size && input.size > 8 * 1024 * 1024) {
    return fail(appError('invalid_input', 'Fotoğraf 8 MB sınırını aşıyor.'));
  }

  const prepared = await prepareFile({
    uri: input.uri,
    name: input.name,
    mime: input.mime,
    size: input.size,
    maxEdge: VEHICLE_IMAGE_MAX_EDGE,
    quality: VEHICLE_IMAGE_QUALITY,
  });

  try {
    const { path } = buildStoragePath(userId, prepared.name, 'jpg', 6);
    const uploaded = await uploadFileToBucket({
      bucket: 'ride-vehicle-photos',
      path,
      uri: prepared.uri,
      name: prepared.name,
      mime: prepared.mime,
      onProgress,
    });
    if (!uploaded.ok) {
      return fail(uploaded.error);
    }
    return ok({
      path: uploaded.data.path,
      publicUrl: rideVehiclePhotoUrl(uploaded.data.path) ?? '',
    });
  } finally {
    if (prepared.tempUri) {
      void releaseTempFile(prepared.tempUri);
    }
  }
}

// ---------------------------------------------------------------------------
// İlanlar
// ---------------------------------------------------------------------------

export type OfferInput = {
  scope: RideScope;
  mode: RideMode;
  vehicleId: string;
  originLabel: string;
  originAddress?: string | null;
  originCity: string;
  originDistrict?: string | null;
  originLat?: number | null;
  originLng?: number | null;
  destLabel: string;
  destAddress?: string | null;
  destCity: string;
  destDistrict?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  departAt: string;
  departFlexMinutes: number;
  durationMinutes?: number | null;
  seatsTotal: number;
  pricePerSeatCents: number;
  luggage: 'small' | 'medium' | 'large';
  preferences: Record<string, unknown>;
  routeMode: 'fixed' | 'flexible';
  maxDetourMeters?: number | null;
  maxDetourMinutes?: number | null;
  bookingMode: RideBookingMode;
  visibility: RideVisibility;
  notes?: string | null;
  stops?: {
    label: string;
    city?: string | null;
    district?: string | null;
    lat?: number | null;
    lng?: number | null;
    arrive_offset_minutes?: number | null;
    is_public?: boolean;
  }[];
};

export const publishOffer = (input: OfferInput) =>
  call<RideOfferDetail>('ride_publish_offer', {
    p_payload: {
      scope: input.scope,
      mode: input.mode,
      vehicle_id: input.vehicleId,
      origin_label: input.originLabel,
      origin_address: input.originAddress ?? null,
      origin_city: input.originCity,
      origin_district: input.originDistrict ?? null,
      origin_lat: input.originLat ?? null,
      origin_lng: input.originLng ?? null,
      dest_label: input.destLabel,
      dest_address: input.destAddress ?? null,
      dest_city: input.destCity,
      dest_district: input.destDistrict ?? null,
      dest_lat: input.destLat ?? null,
      dest_lng: input.destLng ?? null,
      depart_at: input.departAt,
      depart_flex_minutes: input.departFlexMinutes,
      duration_minutes: input.durationMinutes ?? null,
      seats_total: input.seatsTotal,
      price_per_seat_cents: input.pricePerSeatCents,
      luggage: input.luggage,
      preferences: input.preferences,
      route_mode: input.routeMode,
      max_detour_meters: input.maxDetourMeters ?? null,
      max_detour_minutes: input.maxDetourMinutes ?? null,
      booking_mode: input.bookingMode,
      visibility: input.visibility,
      notes: input.notes ?? null,
      stops: input.stops ?? [],
    },
  });

export const getOffer = (offerId: string) =>
  call<RideOfferDetail>('ride_offer_detail', { p_offer_id: offerId });

export const getOfferAvailability = (offerId: string) =>
  call<SeatAvailability>('ride_offer_availability', { p_offer_id: offerId });

export const cancelOffer = (offerId: string, reason?: string) =>
  call<{ offer_id: string; status: string }>('ride_offer_cancel', {
    p_offer_id: offerId,
    p_reason: reason ?? null,
  });

export const startOffer = (offerId: string) =>
  call<{ offer_id: string; status: string }>('ride_offer_start', { p_offer_id: offerId });

export const completeOffer = (offerId: string) =>
  call<{ offer_id: string; status: string }>('ride_offer_complete', { p_offer_id: offerId });

export const getMyOffers = () =>
  call<{ items: RideMyOffer[] }>('ride_my_offers').then((result) =>
    result.ok ? ok(result.data.items) : result,
  );

export const getOfferReservations = (offerId: string) =>
  call<{ items: RideReservation[] }>('ride_offer_reservations', { p_offer_id: offerId }).then(
    (result) => (result.ok ? ok(result.data.items) : result),
  );

export type SearchFilters = {
  scope: RideScope | 'all';
  mode: RideMode | 'all';
  originCity?: string | null;
  destCity?: string | null;
  originLat?: number | null;
  originLng?: number | null;
  destLat?: number | null;
  destLng?: number | null;
  departFrom?: string | null;
  departTo?: string | null;
  seats?: number;
  maxPriceCents?: number | null;
  minRating?: number | null;
  hasAc?: boolean;
  noSmoking?: boolean;
  womenOnly?: boolean;
  accessible?: boolean;
  limit?: number;
  offset?: number;
};

export const searchOffers = (filters: SearchFilters) =>
  call<RideSearchResponse>('ride_search', {
    p_scope: filters.scope,
    p_mode: filters.mode,
    p_origin_lat: filters.originLat ?? null,
    p_origin_lng: filters.originLng ?? null,
    p_dest_lat: filters.destLat ?? null,
    p_dest_lng: filters.destLng ?? null,
    p_origin_city: filters.originCity ?? null,
    p_dest_city: filters.destCity ?? null,
    p_depart_from: filters.departFrom ?? null,
    p_depart_to: filters.departTo ?? null,
    p_seats: filters.seats ?? 1,
    p_max_price_cents: filters.maxPriceCents ?? null,
    p_filters: {
      min_rating: filters.minRating ?? null,
      has_ac: filters.hasAc ?? false,
      no_smoking: filters.noSmoking ?? false,
      women_only: filters.womenOnly ?? false,
      accessible: filters.accessible ?? false,
    },
    p_limit: filters.limit ?? 20,
    p_offset: filters.offset ?? 0,
  });

// ---------------------------------------------------------------------------
// Yolcu talepleri
// ---------------------------------------------------------------------------

export const createRideRequest = (input: {
  scope: RideScope;
  originLabel: string;
  originCity: string;
  originDistrict?: string | null;
  originLat?: number | null;
  originLng?: number | null;
  destLabel: string;
  destCity: string;
  destDistrict?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  earliestDepart: string;
  latestDepart: string;
  partySize: number;
  luggage: string;
  preferences: Record<string, unknown>;
  mandatory: Record<string, unknown>;
  notes?: string | null;
}) =>
  call<{ id: string }>('ride_create_request', {
    p_payload: {
      scope: input.scope,
      origin_label: input.originLabel,
      origin_city: input.originCity,
      origin_district: input.originDistrict ?? null,
      origin_lat: input.originLat ?? null,
      origin_lng: input.originLng ?? null,
      dest_label: input.destLabel,
      dest_city: input.destCity,
      dest_district: input.destDistrict ?? null,
      dest_lat: input.destLat ?? null,
      dest_lng: input.destLng ?? null,
      earliest_depart: input.earliestDepart,
      latest_depart: input.latestDepart,
      party_size: input.partySize,
      luggage: input.luggage,
      preferences: input.preferences,
      mandatory: input.mandatory,
      notes: input.notes ?? null,
    },
  });

export const getMyRequests = () =>
  call<{ items: RideRequest[] }>('ride_my_requests').then((result) =>
    result.ok ? ok(result.data.items) : result,
  );

export const closeRideRequest = (requestId: string) =>
  call<{ ok: boolean }>('ride_close_request', { p_request_id: requestId });

// ---------------------------------------------------------------------------
// Rezervasyonlar
// ---------------------------------------------------------------------------

export const reserveSeats = (input: {
  offerId: string;
  seats: number;
  pickupSeq: number;
  dropoffSeq: number;
  paymentMethod: 'cash' | 'card';
  passengers?: { user_id?: string | null; full_name: string }[];
  seatNumbers?: number[];
  note?: string | null;
  idempotencyKey: string;
}) =>
  call<{
    reservation: RideReservation;
    payment_required?: boolean;
    payment_id?: string | null;
    idempotent?: boolean;
  }>('ride_reserve', {
    p_offer_id: input.offerId,
    p_seats: input.seats,
    p_pickup_seq: input.pickupSeq,
    p_dropoff_seq: input.dropoffSeq,
    p_payment_method: input.paymentMethod,
    p_passengers: input.passengers ?? [],
    p_seat_numbers: input.seatNumbers ?? null,
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey,
  });

export const respondReservation = (reservationId: string, approve: boolean, reason?: string) =>
  call<{ reservation: RideReservation }>('ride_reservation_respond', {
    p_reservation_id: reservationId,
    p_approve: approve,
    p_reason: reason ?? null,
  });

export const cancelReservation = (reservationId: string, reason?: string) =>
  call<{ reservation?: RideReservation; refund_cents?: number }>('ride_reservation_cancel', {
    p_reservation_id: reservationId,
    p_reason: reason ?? null,
  });

export const boardPassenger = (reservationId: string, code: string) =>
  call<{ reservation: RideReservation }>('ride_reservation_board', {
    p_reservation_id: reservationId,
    p_code: code,
  });

export const alightPassenger = (reservationId: string, code?: string) =>
  call<{ reservation: RideReservation; seat_released?: boolean }>('ride_reservation_alight', {
    p_reservation_id: reservationId,
    p_code: code ?? null,
  });

export const getMyTrips = (status?: string | null) =>
  call<{ items: RideReservation[] }>('ride_my_trips', { p_status: status ?? null }).then(
    (result) => (result.ok ? ok(result.data.items) : result),
  );

export const getTripDetail = (reservationId: string) =>
  call<RideTripDetail>('ride_trip_detail', { p_reservation_id: reservationId });

export const joinWaitlist = (input: {
  offerId: string;
  seats?: number;
  pickupSeq?: number;
  dropoffSeq?: number | null;
}) =>
  call<{ id: string; position: number; status: string }>('ride_waitlist_join', {
    p_offer_id: input.offerId,
    p_seats: input.seats ?? 1,
    p_pickup_seq: input.pickupSeq ?? 0,
    p_dropoff_seq: input.dropoffSeq ?? null,
  });

export const leaveWaitlist = (offerId: string) =>
  call<{ ok: boolean }>('ride_waitlist_leave', { p_offer_id: offerId });

export const acceptWaitlistOffer = (waitlistOfferId: string) =>
  call<{ reservation_id?: string; reservation?: RideReservation }>('ride_waitlist_accept', {
    p_waitlist_offer_id: waitlistOfferId,
  });

export const listWaitlistOffers = () =>
  call<{ items: RideWaitlistOffer[] }>('ride_my_waitlist_offers').then((result) =>
    result.ok ? ok(result.data.items) : result,
  );

export const getPriceHint = (distanceMeters: number | null, seats = 3) =>
  call<PriceHint>('ride_price_hint', {
    p_distance_m: distanceMeters,
    p_seats: seats,
  });

// ---------------------------------------------------------------------------
// Canlı takip, güvenlik, konum paylaşımı
// ---------------------------------------------------------------------------

export const getTracking = (offerId: string) =>
  call<RideTrackingSnapshot>('ride_tracking_snapshot', { p_offer_id: offerId });

export const trackPosition = (input: {
  offerId: string;
  lat: number;
  lng: number;
  heading?: number | null;
  speedKmh?: number | null;
}) =>
  call<{ ok: boolean; deviation_meters?: number | null; incident_created?: boolean }>(
    'ride_track_position',
    {
      p_offer_id: input.offerId,
      p_lat: input.lat,
      p_lng: input.lng,
      p_heading: input.heading ?? null,
      p_speed_kmh: input.speedKmh ?? null,
    },
  );

export const sendSos = (input: {
  reservationId: string;
  lat?: number | null;
  lng?: number | null;
  note?: string | null;
}) =>
  call<RideSosResult>('ride_sos', {
    p_reservation_id: input.reservationId,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_note: input.note ?? null,
  });

export const reportSafetyIncident = (input: {
  reservationId: string;
  kind: 'harassment' | 'route_deviation' | 'long_stop' | 'connection_lost' | 'other';
  note: string;
  lat?: number | null;
  lng?: number | null;
}) =>
  call<{ incident_id: string; status: string }>('ride_safety_report', {
    p_reservation_id: input.reservationId,
    p_kind: input.kind,
    p_note: input.note,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
  });

export const openDispute = (input: {
  reservationId: string;
  category: 'no_show' | 'late' | 'route_change' | 'safety' | 'payment' | 'vehicle' | 'other';
  description: string;
}) =>
  call<{ id: string; status: string }>('ride_dispute_open', {
    p_reservation_id: input.reservationId,
    p_category: input.category,
    p_description: input.description,
  });

export const createLocationShare = (reservationId: string, minutes = 60) =>
  call<LocationShare>('ride_location_share_create', {
    p_reservation_id: reservationId,
    p_minutes: minutes,
  });

export const revokeLocationShare = (shareId: string) =>
  call<{ ok: boolean }>('ride_location_share_revoke', { p_share_id: shareId });

/**
 * Paylaşılan süreli konum bağlantısını okur. RPC oturum ister; bağlantıyı
 * açan kişi giriş yapmamışsa uygulama önce giriş ekranına yönlendirir.
 */
export const viewLocationShare = (token: string) =>
  call<LocationShareView>('ride_location_share_view', { p_token: token });

export const listEmergencyContacts = () =>
  call<{ items: EmergencyContact[] }>('ride_emergency_contacts_list').then((result) =>
    result.ok ? ok(result.data.items) : result,
  );

export const saveEmergencyContact = (input: {
  id?: string;
  name: string;
  phone: string;
  relation?: string | null;
  notifyOnSos: boolean;
}) =>
  call<{ id: string }>('ride_emergency_contact_save', {
    p_payload: {
      id: input.id ?? null,
      name: input.name,
      phone: input.phone,
      relation: input.relation ?? null,
      notify_on_sos: input.notifyOnSos,
    },
  });

export const removeEmergencyContact = (id: string) =>
  call<{ ok: boolean }>('ride_emergency_contact_remove', { p_id: id });

// ---------------------------------------------------------------------------
// Değerlendirme
// ---------------------------------------------------------------------------

export const submitReview = (input: {
  reservationId: string;
  rating: number;
  comment?: string | null;
  categories?: Record<string, number>;
}) =>
  call<{ id: string; rating: number }>('ride_review_submit', {
    p_reservation_id: input.reservationId,
    p_rating: input.rating,
    p_comment: input.comment ?? null,
    p_categories: input.categories ?? {},
  });

export const getReviews = (userId: string, limit = 10) =>
  call<RideReviewsResponse>('ride_reviews_for', {
    p_user_id: userId,
    p_limit: limit,
  });

// ---------------------------------------------------------------------------
// Favoriler ve düzenli yolculuklar
// ---------------------------------------------------------------------------

export const listFavorites = () =>
  call<{ items: RideFavorite[] }>('ride_favorites').then((result) =>
    result.ok ? ok(result.data.items) : result,
  );

export const saveFavorite = (input: {
  id?: string;
  label: string;
  scope: RideScope;
  originLabel: string;
  originCity: string;
  originLat?: number | null;
  originLng?: number | null;
  destLabel: string;
  destCity: string;
  destLat?: number | null;
  destLng?: number | null;
  alertEnabled: boolean;
}) =>
  call<{ id: string }>('ride_favorite_save', {
    p_payload: {
      id: input.id ?? null,
      label: input.label,
      scope: input.scope,
      origin_label: input.originLabel,
      origin_city: input.originCity,
      origin_lat: input.originLat ?? null,
      origin_lng: input.originLng ?? null,
      dest_label: input.destLabel,
      dest_city: input.destCity,
      dest_lat: input.destLat ?? null,
      dest_lng: input.destLng ?? null,
      alert_enabled: input.alertEnabled,
    },
  });

export const removeFavorite = (id: string) =>
  call<{ ok: boolean }>('ride_favorite_remove', { p_id: id });

export const listRecurring = () =>
  call<{ items: RideRecurring[] }>('ride_recurring_list').then((result) =>
    result.ok ? ok(result.data.items) : result,
  );

export type RecurringInput = {
  id?: string;
  role: 'driver' | 'passenger';
  scope: RideScope;
  originLabel: string;
  originCity: string;
  originLat?: number | null;
  originLng?: number | null;
  destLabel: string;
  destCity: string;
  destLat?: number | null;
  destLng?: number | null;
  weekdays: number[];
  departTime: string;
  returnTime?: string | null;
  seats: number;
  pricePerSeatCents?: number | null;
  preferences: Record<string, unknown>;
  vehicleId?: string | null;
  luggage: string;
  bookingMode: RideBookingMode;
  visibility: RideVisibility;
  /** Yalnızca güncellemede anlamlıdır: pasif planı yeniden başlatmak için true. */
  isActive?: boolean | null;
};

export const saveRecurring = (input: RecurringInput) =>
  call<{ id: string }>('ride_recurring_save', {
    p_payload: {
      id: input.id ?? null,
      role: input.role,
      scope: input.scope,
      origin_label: input.originLabel,
      origin_city: input.originCity,
      origin_lat: input.originLat ?? null,
      origin_lng: input.originLng ?? null,
      dest_label: input.destLabel,
      dest_city: input.destCity,
      dest_lat: input.destLat ?? null,
      dest_lng: input.destLng ?? null,
      weekdays: input.weekdays,
      depart_time: input.departTime,
      return_time: input.returnTime ?? null,
      seats: input.seats,
      price_per_seat_cents: input.pricePerSeatCents ?? null,
      preferences: input.preferences,
      vehicle_id: input.vehicleId ?? null,
      luggage: input.luggage,
      booking_mode: input.bookingMode,
      visibility: input.visibility,
      is_active: input.isActive ?? null,
    },
  });

export const removeRecurring = (id: string) =>
  call<{ ok: boolean }>('ride_recurring_remove', { p_id: id });

export const pauseRecurringDay = (id: string, date: string) =>
  call<{ ok: boolean }>('ride_recurring_pause_day', { p_id: id, p_date: date });

// ---------------------------------------------------------------------------
// Yönetim paneli
// ---------------------------------------------------------------------------

export const adminOverview = () => call<RideAdminOverview>('ride_admin_overview');

export const adminOffers = (input: {
  status?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminOffer>>('ride_admin_offers', {
    p_status: input.status ?? null,
    p_query: input.query ?? null,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminOfferAction = (
  offerId: string,
  action: 'cancel' | 'suspend_driver',
  reason: string,
) =>
  call<{ ok: boolean; affected: number }>('ride_admin_offer_action', {
    p_offer_id: offerId,
    p_action: action,
    p_reason: reason,
  });

export const adminReservations = (input: {
  status?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminReservation>>('ride_admin_reservations', {
    p_status: input.status ?? null,
    p_query: input.query ?? null,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminReservationAction = (reservationId: string, action: 'cancel', reason: string) =>
  call<{ ok: boolean; refund_requested_cents: number }>('ride_admin_reservation_action', {
    p_reservation_id: reservationId,
    p_action: action,
    p_reason: reason,
  });

export const adminVerifications = (input: {
  status?: string | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminVerification>>('ride_admin_verifications', {
    p_status: input.status ?? 'pending',
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminVerificationDecide = (input: {
  verificationId: string;
  approve: boolean;
  reason?: string | null;
  expiresAt?: string | null;
}) =>
  call<{ ok: boolean; status: string }>('ride_admin_verification_decide', {
    p_verification_id: input.verificationId,
    p_approve: input.approve,
    p_reason: input.reason ?? null,
    p_expires_at: input.expiresAt ?? null,
  });

export const adminDriverDecide = (userId: string, approve: boolean, reason?: string | null) =>
  call<{ ok: boolean; driver_status: string }>('ride_admin_driver_decide', {
    p_user_id: userId,
    p_approve: approve,
    p_reason: reason ?? null,
  });

export const adminDriverApplications = (input: {
  status?: string | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminDriverApplication>>('ride_admin_driver_applications', {
    p_status: input.status ?? 'pending',
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminVehicles = (input: { status?: string | null; limit?: number; offset?: number }) =>
  call<Paged<RideAdminVehicle>>('ride_admin_vehicles', {
    p_status: input.status ?? 'pending',
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminVehicleDocumentDecide = (input: {
  documentId: string;
  approve: boolean;
  reason?: string | null;
  expiresAt?: string | null;
}) =>
  call<{ ok: boolean }>('ride_admin_vehicle_document_decide', {
    p_document_id: input.documentId,
    p_approve: input.approve,
    p_reason: input.reason ?? null,
    p_expires_at: input.expiresAt ?? null,
  });

export const adminVehicleDecide = (vehicleId: string, approve: boolean, reason?: string | null) =>
  call<{ ok: boolean; status: string }>('ride_admin_vehicle_decide', {
    p_vehicle_id: vehicleId,
    p_approve: approve,
    p_reason: reason ?? null,
  });

export const adminDisputes = (input: { status?: string | null; limit?: number; offset?: number }) =>
  call<Paged<RideAdminDispute>>('ride_admin_disputes', {
    p_status: input.status ?? 'open',
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminDisputeDecide = (input: {
  disputeId: string;
  status: 'reviewing' | 'resolved' | 'rejected';
  resolution: string;
  refundCents?: number;
}) =>
  call<{ ok: boolean; status: string }>('ride_admin_dispute_decide', {
    p_dispute_id: input.disputeId,
    p_status: input.status,
    p_resolution: input.resolution,
    p_refund_cents: input.refundCents ?? 0,
  });

export const adminIncidents = (input: {
  status?: string | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminIncident>>('ride_admin_incidents', {
    p_status: input.status ?? null,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminIncidentAction = (
  incidentId: string,
  status: 'acknowledged' | 'resolved',
  note?: string,
) =>
  call<{ ok: boolean; status: string }>('ride_admin_incident_action', {
    p_incident_id: incidentId,
    p_status: status,
    p_note: note ?? null,
  });

export const adminFinance = () => call<RideAdminFinance>('ride_admin_finance', { p_limit: 100 });

export const adminRefundDecide = (refundId: string, approve: boolean, reason?: string) =>
  call<{ ok: boolean; status: string; note: string }>('ride_admin_refund_decide', {
    p_refund_id: refundId,
    p_approve: approve,
    p_reason: reason ?? null,
  });

export const adminSettings = () => call<RideAdminSettings>('ride_admin_settings_get');

export const adminSetSetting = (key: string, value: unknown) =>
  call<{ ok: boolean; key: string; value: unknown }>('ride_admin_setting_set', {
    p_key: key,
    p_value: value,
  });

export const adminAnalytics = (days = 30) =>
  call<import('../types').RideAdminAnalytics>('ride_admin_analytics', { p_days: days });

export const adminAudit = (limit = 50, offset = 0) =>
  call<{ items: RideAdminAuditEntry[]; limit: number; offset: number }>('ride_admin_audit_list', {
    p_limit: limit,
    p_offset: offset,
  });

export const adminRequests = (input: {
  status?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminRequest>>('ride_admin_requests', {
    p_status: input.status ?? null,
    p_query: input.query ?? null,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminRequestAction = (requestId: string, action: 'close' | 'expire', reason: string) =>
  call<{ ok: boolean; status: string }>('ride_admin_request_action', {
    p_request_id: requestId,
    p_action: action,
    p_reason: reason,
  });

export const adminWaitlists = (input: {
  status?: string | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminWaitlist>>('ride_admin_waitlists', {
    p_status: input.status ?? null,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminReviews = (input: {
  status?: string | null;
  query?: string | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminReview>>('ride_admin_reviews', {
    p_status: input.status ?? null,
    p_query: input.query ?? null,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export const adminReviewModerate = (reviewId: string, hide: boolean, reason: string) =>
  call<{ ok: boolean; status: string }>('ride_admin_review_moderate', {
    p_review_id: reviewId,
    p_hide: hide,
    p_reason: reason,
  });

export const adminRecurring = (input: {
  active?: boolean | null;
  limit?: number;
  offset?: number;
}) =>
  call<Paged<RideAdminRecurring>>('ride_admin_recurring', {
    p_active: input.active ?? null,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

export type { ReservationStatus, Verification };
