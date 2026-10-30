import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError, type AppErrorCode } from '@/services/errors';

type Mapping = { code: AppErrorCode; message: string };

/**
 * RPC'ler `raise exception 'token'` ile konusur. Bu tablo token'lari
 * kullaniciya gosterilebilir Turkce mesajlara cevirir; boylece ham
 * Postgres metni arayuzde gorunmez.
 */
const TOKENS: Record<string, Mapping> = {
  not_allowed: { code: 'forbidden', message: 'Bu işlem için yetkin yok.' },
  blocked: { code: 'forbidden', message: 'Bu kullanıcıyla etkileşim kurulamıyor.' },
  messaging_not_allowed: { code: 'forbidden', message: 'Bu kullanıcıya mesaj gönderemezsin.' },
  member_not_allowed: { code: 'forbidden', message: 'Bu kullanıcı gruba eklenemiyor.' },
  calling_not_allowed: { code: 'forbidden', message: 'Bu kullanıcıyı arayamazsın.' },
  comments_disabled: { code: 'forbidden', message: 'Bu gönderide yorumlar kapalı.' },
  comments_friends_only: { code: 'forbidden', message: 'Yorumlar yalnızca arkadaşlara açık.' },
  profile_restricted: { code: 'forbidden', message: 'Bu profil içeriği gizli.' },

  post_not_found: { code: 'not_found', message: 'Gönderi bulunamadı. Silinmiş olabilir.' },
  reel_not_found: { code: 'not_found', message: 'Reels videosu bulunamadı. Silinmiş olabilir.' },
  story_not_found: { code: 'not_found', message: 'Hikâye bulunamadı. Süresi dolmuş olabilir.' },
  listing_not_found: { code: 'not_found', message: 'İlan bulunamadı. Kaldırılmış olabilir.' },
  listing_unavailable: { code: 'not_found', message: 'Bu ilan artık satışta değil.' },
  order_not_found: { code: 'not_found', message: 'Sipariş bulunamadı.' },
  call_not_found: { code: 'not_found', message: 'Arama bulunamadı.' },
  member_not_found: { code: 'not_found', message: 'Kullanıcı bulunamadı.' },
  seller_not_found: { code: 'not_found', message: 'Satıcı bulunamadı.' },
  user_not_found: { code: 'not_found', message: 'Kullanıcı bulunamadı.' },
  not_demo_user: {
    code: 'forbidden',
    message: 'Bu hesap örnek kullanıcı değil. Yalnızca demo hesaplar bu ekrandan silinebilir.',
  },
  invalid_demo_module: { code: 'invalid_input', message: 'Geçersiz örnek veri modülü.' },
  demo_module_required: { code: 'invalid_input', message: 'En az bir modül seçilmeli.' },
  trabzon_city_missing: {
    code: 'not_found',
    message: 'Trabzon şehir kaydı bulunamadı. Coğrafi veri seed’i uygulanmamış olabilir.',
  },

  empty_post: { code: 'invalid_input', message: 'Gönderi boş olamaz.' },
  body_too_long: { code: 'invalid_input', message: 'Metin çok uzun. Kısaltıp tekrar dene.' },
  too_many_media: { code: 'invalid_input', message: 'En fazla 10 medya ekleyebilirsin.' },
  invalid_media: { code: 'invalid_input', message: 'Medya yüklenemedi. Tekrar dene.' },
  invalid_media_type: { code: 'invalid_input', message: 'Desteklenmeyen medya türü.' },
  invalid_media_path: { code: 'invalid_input', message: 'Medya yüklemesi doğrulanamadı.' },
  invalid_visibility: { code: 'invalid_input', message: 'Geçersiz görünürlük seçimi.' },
  invalid_comment: { code: 'invalid_input', message: 'Yorum 1-1000 karakter olmalı.' },
  invalid_parent: { code: 'invalid_input', message: 'Yanıtlanan yorum bulunamadı.' },
  invalid_filter: { code: 'invalid_input', message: 'Geçersiz akış filtresi.' },
  invalid_kind: { code: 'invalid_input', message: 'Geçersiz içerik türü.' },
  invalid_sort: { code: 'invalid_input', message: 'Geçersiz sıralama.' },
  invalid_target: { code: 'invalid_input', message: 'Geçersiz kullanıcı.' },
  invalid_items: { code: 'invalid_input', message: 'Sepet boş veya geçersiz.' },
  invalid_contact: { code: 'invalid_input', message: 'İletişim bilgileri geçersiz.' },
  invalid_price: { code: 'invalid_input', message: 'Fiyat geçersiz.' },
  invalid_stock: { code: 'invalid_input', message: 'Adet geçersiz.' },
  invalid_condition: { code: 'invalid_input', message: 'Ürün durumu geçersiz.' },
  invalid_title: { code: 'invalid_input', message: 'Başlık 3-120 karakter olmalı.' },
  invalid_category: { code: 'invalid_input', message: 'Kategori bulunamadı.' },
  invalid_name: { code: 'invalid_input', message: 'Kategori adı 2-60 karakter olmalı.' },
  invalid_slug: {
    code: 'invalid_input',
    message: 'Kategori adresi yalnızca küçük harf, rakam ve tire içerebilir (2-40 karakter).',
  },
  duplicate_slug: { code: 'duplicate', message: 'Bu kategori adresi (slug) zaten kullanılıyor.' },
  category_not_found: { code: 'not_found', message: 'Kategori bulunamadı.' },
  category_has_children: {
    code: 'invalid_input',
    message: 'Alt kategorisi olan bir kategori silinemez. Önce alt kategorileri kaldır.',
  },
  category_in_use: {
    code: 'invalid_input',
    message: 'İlanı olan bir kategori silinemez. Kategoriyi pasife alabilirsin.',
  },
  insufficient_privilege: { code: 'forbidden', message: 'Bu işlem için yetkin yok.' },
  not_authenticated: { code: 'forbidden', message: 'Oturum bulunamadı. Tekrar giriş yapmalısın.' },
  invalid_images: { code: 'invalid_input', message: 'En fazla 8 görsel ekleyebilirsin.' },
  invalid_rating: { code: 'invalid_input', message: 'Puan 1-5 arasında olmalı.' },
  description_too_long: { code: 'invalid_input', message: 'Açıklama çok uzun.' },
  caption_too_long: { code: 'invalid_input', message: 'Açıklama en fazla 200 karakter olabilir.' },
  insufficient_stock: { code: 'invalid_input', message: 'Yeterli stok yok.' },
  single_seller_per_order: { code: 'invalid_input', message: 'Bir siparişte tek satıcı olabilir.' },
  cannot_buy_own_listing: { code: 'invalid_input', message: 'Kendi ilanını satın alamazsın.' },
  order_not_delivered: {
    code: 'invalid_input',
    message: 'Değerlendirme için teslim edilmiş olmalı.',
  },
  empty_message: { code: 'invalid_input', message: 'Mesaj boş olamaz.' },
  invalid_reply: { code: 'invalid_input', message: 'Yanıtlanan mesaj bulunamadı.' },
  invalid_members: { code: 'invalid_input', message: 'Grup için en az 1 kişi seç.' },
  invalid_media_meta: { code: 'invalid_input', message: 'Medya bilgisi geçersiz.' },
  invalid_audio: { code: 'invalid_input', message: 'Ses bilgisi çok uzun.' },
  invalid_title_group: { code: 'invalid_input', message: 'Grup adı geçersiz.' },
  story_limit: { code: 'invalid_input', message: 'Aynı anda en fazla 20 hikâye paylaşabilirsin.' },
  group_calls_unsupported: {
    code: 'invalid_input',
    message: 'Grup aramaları henüz desteklenmiyor.',
  },
  callee_missing: { code: 'not_found', message: 'Aranacak kişi bulunamadı.' },
  call_already_answered: { code: 'invalid_input', message: 'Bu arama zaten yanıtlandı.' },
  not_a_group: { code: 'invalid_input', message: 'Bu sohbet bir grup değil.' },
  invalid_transition: {
    code: 'invalid_input',
    message: 'Sipariş bu adımdan bu duruma geçirilemez.',
  },
  invalid_status: { code: 'invalid_input', message: 'Geçersiz durum.' },
  invalid_body: { code: 'invalid_input', message: 'Mesaj 1-4000 karakter olmalı.' },
  unsupported_kind: { code: 'invalid_input', message: 'Yalnızca metin mesajları düzenlenebilir.' },

  rate_limited: {
    code: 'rate_limited',
    message: 'Çok fazla işlem yaptın. Biraz sonra tekrar dene.',
  },

  // --- Yolculuk paylaşımı -------------------------------------------------
  identity_required: {
    code: 'forbidden',
    message:
      'Kimlik doğrulaman onaylanmadan bu işlemi yapamazsın. Doğrulama ekranından belge gönder.',
  },
  identity_not_approved: {
    code: 'forbidden',
    message: 'Kimlik doğrulaman henüz onaylanmadı. Onay sonrası tekrar dene.',
  },
  verification_required: {
    code: 'forbidden',
    message: 'Önce kimlik doğrulamanı tamamlaman gerekiyor.',
  },
  license_required: {
    code: 'forbidden',
    message: 'Sürücü belgesi onaylanmadan sürücü başvurusu yapılamaz.',
  },
  driver_verification_required: {
    code: 'forbidden',
    message: 'Sürücü doğrulaman onaylanmadan ilan yayınlayamazsın.',
  },
  driver_not_approved: {
    code: 'forbidden',
    message: 'Sürücü başvurun onaylanmadan bu işlemi yapamazsın.',
  },
  verification_already_approved: {
    code: 'duplicate',
    message: 'Bu belge zaten onaylı. Yenilemek için geçerlilik bitişini bekle.',
  },
  invalid_verification_kind: { code: 'invalid_input', message: 'Geçersiz belge türü.' },
  invalid_document_path: {
    code: 'invalid_input',
    message: 'Belge yolu doğrulanamadı. Dosyayı yeniden yükleyip tekrar dene.',
  },
  invalid_document_kind: { code: 'invalid_input', message: 'Geçersiz araç belgesi türü.' },
  required_documents_missing: {
    code: 'invalid_input',
    message: 'Araç için ruhsat ve sigorta belgesi yüklenmeli.',
  },
  vehicle_required: { code: 'invalid_input', message: 'Önce garajına bir araç eklemelisin.' },
  vehicle_not_found: { code: 'not_found', message: 'Araç bulunamadı.' },
  vehicle_not_approved: {
    code: 'forbidden',
    message: 'Seçtiğin araç kullanılamıyor (pasif, reddedilmiş veya askıda). Garajdan başka bir araç seç.',
  },
  vehicle_has_active_offers: {
    code: 'invalid_input',
    message: 'Bu araca bağlı aktif ilanlar var. Önce ilanları kapatmalısın.',
  },
  vehicle_capacity_conflict: {
    code: 'invalid_input',
    message: 'Yeni araç mevcut rezervasyonların koltuk ihtiyacını karşılamıyor.',
  },
  vehicle_accessibility_conflict: {
    code: 'invalid_input',
    message: 'Yeni araç mevcut rezervasyonlardaki erişilebilirlik koşullarını karşılamıyor.',
  },
  vehicle_accessibility_mismatch: {
    code: 'invalid_input',
    message: 'Araçtaki erişilebilirlik özellikleri ilanla uyuşmuyor.',
  },
  invalid_plate: { code: 'invalid_input', message: 'Plaka formatı geçersiz. Örnek: 61 TZ 610.' },
  invalid_vehicle: { code: 'invalid_input', message: 'Araç bilgileri eksik veya geçersiz.' },
  invalid_vehicle_year: { code: 'invalid_input', message: 'Model yılı geçersiz.' },
  invalid_seat_capacity: { code: 'invalid_input', message: 'Koltuk kapasitesi geçersiz.' },
  invalid_fuel_type: { code: 'invalid_input', message: 'Yakıt türü geçersiz.' },
  invalid_luggage: { code: 'invalid_input', message: 'Bagaj seçimi geçersiz.' },
  invalid_scope: { code: 'invalid_input', message: 'Yolculuk kapsamı geçersiz.' },
  invalid_mode: { code: 'invalid_input', message: 'Yolculuk tipi geçersiz.' },
  invalid_route_mode: { code: 'invalid_input', message: 'Rota tipi geçersiz.' },
  invalid_booking_mode: { code: 'invalid_input', message: 'Rezervasyon yöntemi geçersiz.' },
  invalid_depart_at: { code: 'invalid_input', message: 'Kalkış zamanı geçersiz.' },
  invalid_depart_time: { code: 'invalid_input', message: 'Kalkış saati geçersiz.' },
  invalid_depart_window: { code: 'invalid_input', message: 'Kalkış zaman aralığı geçersiz.' },
  depart_in_past: { code: 'invalid_input', message: 'Kalkış zamanı geçmişte olamaz.' },
  too_early_to_start: {
    code: 'invalid_input',
    message: 'Yolculuğu başlatmak için kalkış saatine çok erken.',
  },
  invalid_date: { code: 'invalid_input', message: 'Tarih geçersiz.' },
  invalid_city: { code: 'invalid_input', message: 'Şehir bilgisi geçersiz.' },
  invalid_location: { code: 'invalid_input', message: 'Konum bilgisi geçersiz.' },
  invalid_label: { code: 'invalid_input', message: 'Durak adı geçersiz.' },
  invalid_route: { code: 'invalid_input', message: 'Güzergâh geçersiz.' },
  too_many_stops: { code: 'invalid_input', message: 'Ara durak sayısı sınırı aşıldı.' },
  detour_required: {
    code: 'invalid_input',
    message: 'Esnek rota için kabul edilen sapma miktarını belirtmelisin.',
  },
  invalid_weekdays: { code: 'invalid_input', message: 'Haftanın günleri geçersiz.' },
  invalid_party_size: { code: 'invalid_input', message: 'Yolcu sayısı geçersiz.' },
  invalid_seat_count: { code: 'invalid_input', message: 'Koltuk sayısı geçersiz.' },
  invalid_segment: { code: 'invalid_input', message: 'Biniş ve iniş noktası sırası geçersiz.' },
  invalid_payment_method: { code: 'invalid_input', message: 'Ödeme yöntemi geçersiz.' },
  payments_disabled: {
    code: 'invalid_input',
    message: 'Kartla ödeme henüz etkin değil. Şimdilik yolculuk sırasında ödeme seçeneğini kullan.',
  },
  passenger_count_mismatch: {
    code: 'invalid_input',
    message: 'Yolcu sayısı ile koltuk sayısı uyuşmuyor.',
  },
  seat_count_mismatch: {
    code: 'invalid_input',
    message: 'Seçilen koltuk sayısı yolcu sayısıyla uyuşmuyor.',
  },
  seat_unavailable: { code: 'invalid_input', message: 'Seçtiğin koltuklardan biri artık dolu.' },
  no_seats_available: {
    code: 'invalid_input',
    message: 'Bu bölümde boş koltuk kalmadı. Bekleme listesine katılabilirsin.',
  },
  seats_available: {
    code: 'invalid_input',
    message: 'Koltuk bulundu; bekleme listesine gerek yok.',
  },
  cannot_reserve_own_offer: {
    code: 'invalid_input',
    message: 'Kendi ilanına rezervasyon yapamazsın.',
  },
  cannot_join_own_offer: {
    code: 'invalid_input',
    message: 'Kendi ilanının bekleme listesine katılamazsın.',
  },
  offer_not_found: {
    code: 'not_found',
    message: 'Yolculuk ilanı bulunamadı. Kaldırılmış olabilir.',
  },
  offer_unavailable: {
    code: 'not_found',
    message: 'Bu yolculuk artık rezervasyona açık değil.',
  },
  segment_already_passed: {
    code: 'invalid_input',
    message: 'Seçtiğin biniş noktasından yolculuk zaten geçmiş.',
  },
  trip_already_started: { code: 'invalid_input', message: 'Yolculuk zaten başlatıldı.' },
  trip_not_started: { code: 'invalid_input', message: 'Önce yolculuğu başlatmalısın.' },
  reservation_not_found: { code: 'not_found', message: 'Rezervasyon bulunamadı.' },
  invalid_boarding_code: {
    code: 'invalid_input',
    message: 'Biniş kodu hatalı. Yolcudan kodu tekrar isteyin.',
  },
  invalid_alighting_code: {
    code: 'invalid_input',
    message: 'İniş kodu hatalı. Yolcudan kodu tekrar isteyin.',
  },
  request_not_found: { code: 'not_found', message: 'Yolcu talebi bulunamadı.' },
  schedule_not_found: { code: 'not_found', message: 'Düzenli yolculuk planı bulunamadı.' },
  favorite_not_found: { code: 'not_found', message: 'Favori güzergâh bulunamadı.' },
  share_not_found: {
    code: 'not_found',
    message: 'Konum paylaşım bağlantısı bulunamadı veya süresi doldu.',
  },
  contact_not_found: { code: 'not_found', message: 'Güvenilir kişi bulunamadı.' },
  recurring_day_has_reservations: {
    code: 'invalid_input',
    message: 'Bu günde aktif rezervasyon var. Önce rezervasyonları iptal etmelisin.',
  },
  invalid_party_size_count: { code: 'invalid_input', message: 'Yolcu sayısı geçersiz.' },
  note_too_short: { code: 'invalid_input', message: 'Açıklama çok kısa.' },
  description_too_short: { code: 'invalid_input', message: 'Açıklama çok kısa.' },
  invalid_contact_name: { code: 'invalid_input', message: 'Kişi adı geçersiz.' },
  invalid_contact_phone: { code: 'invalid_input', message: 'Telefon numarası geçersiz.' },
  contact_limit: { code: 'invalid_input', message: 'Güvenilir kişi sınırına ulaştın.' },
  invalid_incident_kind: { code: 'invalid_input', message: 'Olay türü geçersiz.' },
  invalid_dispute_category: { code: 'invalid_input', message: 'Uyuşmazlık kategorisi geçersiz.' },
  invalid_refund_amount: { code: 'invalid_input', message: 'İade tutarı geçersiz.' },
  dispute_already_open: {
    code: 'duplicate',
    message: 'Bu rezervasyon için açık bir uyuşmazlık var.',
  },
  dispute_already_closed: { code: 'invalid_input', message: 'Bu uyuşmazlık zaten kapatıldı.' },
  dispute_not_allowed: { code: 'forbidden', message: 'Bu rezervasyon için uyuşmazlık açamazsın.' },
  dispute_not_found: { code: 'not_found', message: 'Uyuşmazlık kaydı bulunamadı.' },
  review_not_allowed: {
    code: 'invalid_input',
    message: 'Değerlendirme yalnızca tamamlanan yolculuklar için yapılabilir.',
  },
  review_already_submitted: {
    code: 'duplicate',
    message: 'Bu yolculuk için değerlendirmen kaydedildi.',
  },
  no_verified_payment: {
    code: 'invalid_input',
    message: 'Doğrulanmış bir ödeme kaydı olmadan iade işlemi yapılamaz.',
  },
  reason_required: { code: 'invalid_input', message: 'İşlem için gerekçe yazmalısın.' },
  resolution_required: {
    code: 'invalid_input',
    message: 'Kapatmak için bir çözüm notu yazmalısın.',
  },
  legal_approval_required: {
    code: 'forbidden',
    message: 'Bu ayar hukuki onay ve ödeme kuruluşu yetkisi tamamlanmadan değiştirilemez.',
  },
  invalid_setting_key: { code: 'invalid_input', message: 'Ayar anahtarı geçersiz.' },
  invalid_setting_value: { code: 'invalid_input', message: 'Ayar değeri geçersiz.' },
  setting_not_found: { code: 'not_found', message: 'Ayar bulunamadı.' },
  waitlist_offer_expired: {
    code: 'invalid_input',
    message: 'Koltuk teklifinin süresi doldu. Bekleme listesinde tekrar sıraya girebilirsin.',
  },
  waitlist_offer_not_found: { code: 'not_found', message: 'Koltuk teklifi bulunamadı.' },

  // --- Etkileşim haritası --------------------------------------------------
  invalid_payload: { code: 'invalid_input', message: 'Harita tercihleri geçersiz.' },
  invalid_map_precision: { code: 'invalid_input', message: 'Konum hassasiyeti seçimi geçersiz.' },
  invalid_map_mode: { code: 'invalid_input', message: 'Harita modu geçersiz.' },
  invalid_map_density: { code: 'invalid_input', message: 'Harita yoğunluğu geçersiz.' },
  invalid_share_duration: {
    code: 'invalid_input',
    message: 'Paylaşım süresi 15 dakika ile 24 saat arasında olmalı.',
  },
  location_required: {
    code: 'invalid_input',
    message: 'Konum paylaşımı için cihaz konumu gerekli.',
  },
  invalid_coordinates: { code: 'invalid_input', message: 'Konum koordinatları geçersiz.' },
  invalid_audience: { code: 'invalid_input', message: 'Konum paylaşım kitlesi geçersiz.' },
  viewer_required: {
    code: 'invalid_input',
    message: '“Seçtiğim kişiler” için en az bir arkadaş seçmelisin.',
  },
  share_not_active: {
    code: 'not_found',
    message: 'Aktif konum paylaşımı yok. Paylaşımı yeniden başlat.',
  },
  title_required: { code: 'invalid_input', message: 'Yer adı boş olamaz.' },
  invalid_collection: { code: 'invalid_input', message: 'Koleksiyon türü geçersiz.' },
  label_required: { code: 'invalid_input', message: 'Bölge adı boş olamaz.' },
  invalid_notify_mode: { code: 'invalid_input', message: 'Bildirim tercihi geçersiz.' },

  // --- Keşfet / işletme / emlak -------------------------------------------
  service_area_unavailable: {
    code: 'not_found',
    message: 'Hizmet bölgesi henüz yapılandırılmadı. Lütfen daha sonra tekrar dene.',
  },
  place_not_found: { code: 'not_found', message: 'İşletme bulunamadı. Kaldırılmış olabilir.' },
  review_not_found: { code: 'not_found', message: 'Yorum bulunamadı. Silinmiş olabilir.' },
  invalid_reply_body: { code: 'invalid_input', message: 'İşletme yanıtı 2-1200 karakter olmalı.' },
  reply_not_found: { code: 'not_found', message: 'İşletme yanıtı bulunamadı.' },
  media_not_found: { code: 'not_found', message: 'Medya kaydı bulunamadı.' },
  suggestion_not_found: { code: 'not_found', message: 'İşletme önerisi bulunamadı.' },
  claim_not_found: { code: 'not_found', message: 'Sahiplenme başvurusu bulunamadı.' },
  verification_not_found: { code: 'not_found', message: 'Doğrulama kaydı bulunamadı.' },
  saved_search_not_found: { code: 'not_found', message: 'Kaydedilen arama bulunamadı.' },
  already_reviewed: {
    code: 'invalid_input',
    message: 'Bu kayıt zaten incelenmiş. Listeyi yenileyip tekrar dene.',
  },
  invalid_decision: { code: 'invalid_input', message: 'Geçersiz karar.' },
  invalid_action: { code: 'invalid_input', message: 'Geçersiz işlem.' },
  invalid_reason: { code: 'invalid_input', message: 'Şikâyet gerekçesi geçersiz.' },
  invalid_target_type: { code: 'invalid_input', message: 'Şikâyet hedefi geçersiz.' },
  invalid_evidence: { code: 'invalid_input', message: 'Sahiplenme kanıt türü geçersiz.' },
  evidence_required: {
    code: 'invalid_input',
    message: 'Sahiplenme için belge veya açıklayıcı kanıt gerekli.',
  },
  claim_already_pending: {
    code: 'duplicate',
    message: 'Bu işletme için zaten bekleyen bir sahiplenme başvurun var.',
  },
  already_manager: {
    code: 'duplicate',
    message: 'Bu işletmeyi zaten yönetiyorsun.',
  },
  invalid_district: { code: 'invalid_input', message: 'İlçe seçimi geçersiz.' },
  invalid_neighborhood: { code: 'invalid_input', message: 'Mahalle seçimi geçersiz.' },
  outside_service_area: {
    code: 'invalid_input',
    message: 'Seçilen konum Trabzon hizmet bölgesinin dışında.',
  },
  invalid_currency: { code: 'invalid_input', message: 'Para birimi geçersiz.' },
  invalid_owner_type: { code: 'invalid_input', message: 'İlan sahibi türü geçersiz.' },
  invalid_listing_kind: { code: 'invalid_input', message: 'İlan türü geçersiz.' },
  invalid_room_count: { code: 'invalid_input', message: 'Oda sayısı geçersiz.' },
  invalid_area: { code: 'invalid_input', message: 'Metrekare bilgisi geçersiz.' },
  invalid_polygon: { code: 'invalid_input', message: 'Çizilen alan geçerli bir kapalı alan değil.' },
  polygon_too_small: { code: 'invalid_input', message: 'Çizilen alan çok küçük. Daha geniş bir alan çiz.' },
  polygon_too_large: { code: 'invalid_input', message: 'Çizilen alan çok büyük. Daha küçük bir alan çiz.' },
  too_many_points: { code: 'invalid_input', message: 'Çizim çok fazla nokta içeriyor.' },
  media_required: {
    code: 'invalid_input',
    message: 'Yayınlamak için en az bir fotoğraf yüklemelisin.',
  },
  authority_document_required: {
    code: 'invalid_input',
    message: 'Emlak ofisi/işletme ilanı için yetki belgesi veya referans numarası gerekli.',
  },
  eids_not_configured: {
    code: 'forbidden',
    message:
      'Resmî EİDS entegrasyonu henüz yapılandırılmadı. Bu nedenle ilan doğrulanamaz ve yayınlanamaz.',
  },
  eids_verification_required: {
    code: 'forbidden',
    message: 'İlan yayınlanmadan önce EİDS doğrulaması tamamlanmalı.',
  },
  verification_expired: {
    code: 'forbidden',
    message: 'Doğrulamanın süresi doldu. Yayınlamak için doğrulamayı yenile.',
  },
  listing_not_publishable: {
    code: 'invalid_input',
    message: 'İlan yayın koşullarını karşılamıyor.',
  },
  invalid_expiry: { code: 'invalid_input', message: 'İlan yayın süresi geçersiz.' },
  last_notified_recently: {
    code: 'rate_limited',
    message: 'Bu arama için yakın zamanda bildirim gönderildi.',
  },

  // --- Haber API merkezi ---------------------------------------------------
  connection_not_found: { code: 'not_found', message: 'Haber kaynağı bulunamadı.' },
  connection_untested: {
    code: 'invalid_input',
    message: 'Kaynağı açmadan önce bağlantıyı test etmelisin. Test başarılı olmadan otomatik çekim başlamaz.',
  },
  mapping_incomplete: {
    code: 'invalid_input',
    message: 'Başlık ve haber adresi alan eşleştirmeleri zorunlu. Eksik eşleştirmeyi tamamla.',
  },
  connection_inactive: {
    code: 'invalid_input',
    message: 'Kaynak aktif değil. Önce kaynağı aç, sonra otomatik yayını etkinleştir.',
  },
  connection_is_deleting: {
    code: 'invalid_input',
    message: 'Bu kaynak silme işleminde. İşlem bitmeden düzenlenemez.',
  },
  publish_mode_not_permitted: {
    code: 'forbidden',
    message: 'Seçilen yayın modu bu kaynağın lisans ve izin durumuyla uyumlu değil.',
  },
  publish_mode_discovery: {
    code: 'invalid_input',
    message: 'Keşif modundaki kaynak yayın yapmaz. Otomatik yayın için başka bir mod seç.',
  },
  publisher_missing: {
    code: 'invalid_input',
    message: 'Yayın için bir kaynak profili veya hesap seçmelisin.',
  },
  confirmation_mismatch: {
    code: 'invalid_input',
    message: 'Onay için kaynak adını tam olarak yazmalısın.',
  },
  deletion_in_progress: {
    code: 'duplicate',
    message: 'Bu kaynak için zaten süren bir silme işlemi var. Bitmesini bekle.',
  },
  invalid_connector: { code: 'invalid_input', message: 'Desteklenmeyen kaynak türü.' },
  invalid_rows: { code: 'invalid_input', message: 'Gönderilen satırlar geçersiz.' },
  invalid_field_key: { code: 'invalid_input', message: 'Geçersiz alan anahtarı.' },
  invalid_source_path: {
    code: 'invalid_input',
    message: 'Alan yolu geçersiz. Yalnızca harf, rakam, nokta, tire ve köşeli parantez kullan.',
  },
  item_not_found: { code: 'not_found', message: 'Haber kaydı bulunamadı.' },
  item_not_rejectable: {
    code: 'invalid_input',
    message: 'Bu haber artık reddedilemez. Listeyi yenileyip tekrar dene.',
  },
  job_not_found: { code: 'not_found', message: 'Silme işi bulunamadı.' },
  source_profile_unbound: {
    code: 'invalid_input',
    message: 'Doğrulanmış profil için önce bir Trabzone hesabı bağlamalısın.',
  },
  verification_note_required: {
    code: 'invalid_input',
    message: 'Doğrulama için kısa bir doğrulama notu yazmalısın.',
  },
  publisher_inactive: {
    code: 'invalid_input',
    message: 'Seçilen hesap aktif değil. Başka bir yayın hesabı seç.',
  },
  feed_url_required: { code: 'invalid_input', message: 'Feed veya API adresi zorunlu.' },

  // --- Eczane rehberi ------------------------------------------------------
  pharmacy_not_found: { code: 'not_found', message: 'Eczane bulunamadı. Kayıt kaldırılmış olabilir.' },
  pharmacy_profile_missing: {
    code: 'not_found',
    message: 'Eczanenin rehber profili bulunamadı. Yönetici profil oluşturmalı.',
  },
  source_not_found: { code: 'not_found', message: 'Veri kaynağı bulunamadı.' },
  record_not_found: { code: 'not_found', message: 'Kayıt bulunamadı. Liste eskimiş olabilir.' },
  sensitive_personal_data: {
    code: 'invalid_input',
    message:
      'Yorumda reçete, TC kimlik numarası veya kişisel sağlık bilgisi paylaşılamaz. Bu tür bilgileri kaldırıp tekrar dene.',
  },
  unknown_neighborhood: {
    code: 'invalid_input',
    message: 'Seçilen mahalle eczane kayıtlarında bulunamadı. Başka bir mahalle seç.',
  },
  district_required_for_neighborhood: {
    code: 'invalid_input',
    message: 'Mahalle bildirimi için önce ilçe seçmelisin.',
  },
  notifications_disabled: {
    code: 'forbidden',
    message: 'Eczane nöbet bildirimleri şu anda kapalı. Yönetici etkinleştirdikten sonra tekrar dene.',
  },
  invalid_window: {
    code: 'invalid_input',
    message: 'Nöbet bitişi başlangıçtan en fazla 30 saat sonra olabilir.',
  },
  coordinates_out_of_bounds: {
    code: 'invalid_input',
    message: 'Girilen koordinatlar Trabzon sınırlarının dışında.',
  },
  coordinates_required: {
    code: 'invalid_input',
    message: 'Haritada işaretlemek için enlem ve boylam birlikte girilmeli.',
  },
  secret_must_be_env_name: {
    code: 'invalid_input',
    message:
      'API anahtarı buraya yazılmaz. Yalnızca sunucudaki ortam değişkeninin adı girilebilir (örn. COLLECTAPI_KEY).',
  },
  invalid_bbox: { code: 'invalid_input', message: 'Harita alanı geçersiz. Haritayı yenileyip tekrar dene.' },
  missing_fields: { code: 'invalid_input', message: 'Zorunlu alanlar eksik.' },

  // --- Deprem Merkezi -----------------------------------------------------
  earthquake_not_found: { code: 'not_found', message: 'Bu deprem kaydı bulunamadı.' },
  earthquake_removed: {
    code: 'not_found',
    message: 'Bu deprem kaydı kaynak tarafından geri çekildiği veya geçersiz bulunduğu için kaldırıldı.',
  },
  invalid_region: { code: 'invalid_input', message: 'Geçersiz bölge seçimi.' },
  region_disabled: { code: 'invalid_input', message: 'Bu bölge seçeneği şu anda kapalı.' },
  invalid_radius: { code: 'invalid_input', message: 'Mesafe 50, 100, 150 veya 250 km olabilir.' },
  invalid_magnitude: { code: 'invalid_input', message: 'Geçersiz büyüklük eşiği.' },
  invalid_quiet_hours: { code: 'invalid_input', message: 'Sessiz saatler 0–23 arasında olmalı.' },
  invalid_push_token: { code: 'invalid_input', message: 'Bildirim cihaz kaydı geçersiz.' },
  invalid_platform: { code: 'invalid_input', message: 'Desteklenmeyen platform.' },
  primary_required: { code: 'invalid_input', message: 'Bir birincil veri kaynağı seçili kalmalı.' },
  duplicate_source: {
    code: 'invalid_input',
    message: 'İki kayıt aynı kaynaktan geliyor; aynı deprem olarak birleştirilemez.',
  },
  invalid_range: { code: 'invalid_input', message: 'Bitiş tarihi başlangıçtan sonra olmalı.' },
  range_too_large: { code: 'invalid_input', message: 'Tarih aralığı en fazla 10 yıl olabilir.' },
  invalid_order: { code: 'invalid_input', message: 'Geçersiz sıralama.' },
  invalid_source: { code: 'invalid_input', message: 'Geçersiz veri kaynağı.' },
  invalid_bucket: { code: 'invalid_input', message: 'Geçersiz zaman aralığı.' },
  invalid_provider: { code: 'invalid_input', message: 'Geçersiz veri kaynağı.' },
  invalid_permission: { code: 'invalid_input', message: 'Geçersiz yetki.' },

  // --- Trabzonspor Maç Arenası ---------------------------------------------
  account_inactive: { code: 'forbidden', message: 'Hesabın aktif değil. Bu işlemi yapamazsın.' },
  comments_locked: { code: 'forbidden', message: 'Bu maçın yorumları moderasyon nedeniyle kilitlendi.' },
  comment_not_found: { code: 'not_found', message: 'Yorum bulunamadı. Silinmiş olabilir.' },
  content_not_found: { code: 'not_found', message: 'İçerik bulunamadı veya herkese açık değil.' },
  invalid_content_type: { code: 'invalid_input', message: 'Geçersiz içerik türü.' },
  sports_chat_closed: { code: 'forbidden', message: 'Canlı sohbet şu anda mesaj gönderimine kapalı.' },
  sports_chat_sanctioned: {
    code: 'forbidden',
    message: 'Moderasyon kararı nedeniyle bu sohbette şu an mesaj gönderemezsin.',
  },
  sports_chat_child_protected: {
    code: 'forbidden',
    message: 'Hesap güvenlik ayarların herkese açık canlı sohbete mesaj göndermeye izin vermiyor.',
  },
  sports_chat_invalid_length: { code: 'invalid_input', message: 'Mesaj boş olamaz veya çok uzun.' },
  sports_chat_link_blocked: { code: 'invalid_input', message: 'Canlı sohbette bağlantı paylaşılamaz.' },
  sports_chat_spam: { code: 'invalid_input', message: 'Mesaj tekrar eden karakterler içeriyor.' },
  sports_chat_blocked_term: { code: 'invalid_input', message: 'Mesaj topluluk kurallarına aykırı ifade içeriyor.' },
  sports_chat_slow_mode: {
    code: 'rate_limited',
    message: 'Yavaş mod açık. Bir sonraki mesaj için biraz bekle.',
  },
  sports_chat_duplicate: { code: 'duplicate', message: 'Aynı mesajı kısa süre içinde tekrar gönderemezsin.' },
  sports_chat_invalid_reply: { code: 'invalid_input', message: 'Yanıtlanan mesaj artık görünmüyor.' },
  sports_poll_closed: { code: 'invalid_input', message: 'Bu anket oylamaya kapalı.' },
  sports_poll_already_voted: {
    code: 'duplicate',
    message: 'Bu ankette oyunu kullandın; oy değişikliğine izin verilmiyor veya hakkın doldu.',
  },
  sports_poll_invalid_options: { code: 'invalid_input', message: 'Anket için 2-6 benzersiz seçenek gerekli.' },
  sports_media_not_public: {
    code: 'invalid_input',
    message: 'Taraftar alanına yalnızca herkese açık gönderiler eklenebilir.',
  },
  sports_media_required: { code: 'invalid_input', message: 'Bu kategori için fotoğraf veya video eklemelisin.' },
  sports_media_window: {
    code: 'invalid_input',
    message: 'Gönderiler yalnızca maçtan 3 gün önce ile 3 gün sonra arasında eklenebilir.',
  },
  sports_reason_required: { code: 'invalid_input', message: 'İşlem için en az 5 karakterlik bir gerekçe yaz.' },
  sports_setting_not_allowed: { code: 'invalid_input', message: 'Bu ayar panelden değiştirilemez.' },
  sports_team_not_configured: {
    code: 'invalid_input',
    message: 'Takım henüz doğrulanmadı. API bağlantısını kurup takım aramasını çalıştır.',
  },
  sports_team_unknown: {
    code: 'not_found',
    message: 'Takım API aramasından gelen adaylar arasında yok. Önce takım aramasını çalıştır.',
  },
  sports_invalid_payload: { code: 'invalid_input', message: 'Veri sağlayıcı yanıtı geçersiz.' },

  // --- Konaklama / otel yönetimi -------------------------------------------
  property_not_found: { code: 'not_found', message: 'Tesis bulunamadı. Kaldırılmış olabilir.' },
  property_not_verified: {
    code: 'forbidden',
    message: 'Tesis doğrulanmadan rezervasyona açılamaz. Önce tesis doğrulamasını tamamla.',
  },
  property_not_published: { code: 'not_found', message: 'Bu tesis şu anda yayında değil.' },
  property_required: { code: 'invalid_input', message: 'Önce tesis bilgilerini kaydetmelisin.' },
  property_not_submittable: {
    code: 'invalid_input',
    message: 'Tesis doğrulamaya gönderilemiyor. Eksik belge veya bilgileri tamamla.',
  },
  verification_pending: {
    code: 'invalid_input',
    message: 'Tesis doğrulaması zaten inceleniyor. Sonucu beklemelisin.',
  },
  already_verified: { code: 'duplicate', message: 'Bu tesis zaten doğrulanmış.' },
  only_owner: { code: 'forbidden', message: 'Bu işlemi yalnızca tesis sahibi yapabilir.' },
  cannot_change_owner: { code: 'forbidden', message: 'Tesis sahibi bu ekrandan değiştirilemez.' },
  room_type_not_found: { code: 'not_found', message: 'Oda tipi bulunamadı.' },
  rate_plan_not_found: { code: 'not_found', message: 'Fiyat planı bulunamadı.' },
  room_not_found: { code: 'not_found', message: 'Oda bulunamadı.' },
  room_unavailable: {
    code: 'invalid_input',
    message: 'Seçilen oda bu tarihlerde dolu veya bakımda. Başka bir oda seç.',
  },
  duplicate_room_number: { code: 'duplicate', message: 'Bu oda numarası zaten kullanılıyor.' },
  room_number_required: { code: 'invalid_input', message: 'Oda numarası zorunlu.' },
  guest_name_required: { code: 'invalid_input', message: 'Misafir adı zorunlu.' },
  guest_not_found: { code: 'not_found', message: 'Misafir kaydı bulunamadı.' },
  source_required: {
    code: 'invalid_input',
    message: 'Rezervasyon kaynağı seçilmeli (Trabzone, telefon, resepsiyon vb.).',
  },
  invalid_dates: { code: 'invalid_input', message: 'Tarihler geçersiz. Çıkış, girişten sonra olmalı.' },
  invalid_date_range: { code: 'invalid_input', message: 'Tarih aralığı geçersiz.' },
  invalid_occupancy: { code: 'invalid_input', message: 'Kişi sayısı oda kapasitesini aşıyor.' },
  capacity_exceeded: { code: 'invalid_input', message: 'Seçilen kişi sayısı oda kapasitesini aşıyor.' },
  min_stay_not_met: {
    code: 'invalid_input',
    message: 'Seçilen tarihler için minimum konaklama gecesi karşılanmıyor.',
  },
  max_stay_exceeded: { code: 'invalid_input', message: 'Konaklama maksimum gece sınırını aşıyor.' },
  sold_out: { code: 'invalid_input', message: 'Bu tarihlerde uygun oda kalmadı.' },
  no_availability: { code: 'invalid_input', message: 'Bu tarihlerde müsaitlik yok.' },
  dates_closed: {
    code: 'invalid_input',
    message: 'Seçilen tarihler satışa kapalı veya giriş/çıkışa kapalı.',
  },
  booking_closed: { code: 'invalid_input', message: 'Bu rezervasyon şu anda kabul edilmiyor.' },
  rate_closed: { code: 'invalid_input', message: 'Bu fiyat planı seçilen tarihlerde kapalı.' },
  campaign_not_found: { code: 'not_found', message: 'Kampanya bulunamadı.' },
  campaign_not_started: { code: 'invalid_input', message: 'Kampanya henüz başlamadı.' },
  campaign_expired: { code: 'invalid_input', message: 'Kampanyanın süresi doldu.' },
  campaign_quota_exceeded: { code: 'invalid_input', message: 'Kampanya kontenjanı doldu.' },
  cash_account_not_found: { code: 'not_found', message: 'Kasa hesabı bulunamadı.' },
  cash_account_required: { code: 'invalid_input', message: 'Önce bir kasa hesabı tanımla.' },
  transaction_not_found: { code: 'not_found', message: 'Kasa hareketi bulunamadı.' },
  already_reversed: {
    code: 'duplicate',
    message: 'Bu kasa hareketi zaten ters kayıtla düzeltilmiş.',
  },
  reverse_of_reverse: { code: 'invalid_input', message: 'Ters kayıt işlemi ters kayıtla düzeltilemez.' },
  insufficient_balance: { code: 'invalid_input', message: 'Kasa bakiyesi bu işlem için yetersiz.' },
  folio_not_found: { code: 'not_found', message: 'Folio kaydı bulunamadı.' },
  task_not_found: { code: 'not_found', message: 'Kat hizmetleri görevi bulunamadı.' },
  block_not_found: { code: 'not_found', message: 'Oda blokesi bulunamadı.' },
  block_conflict: { code: 'invalid_input', message: 'Bu tarihlerde zaten bloke veya rezervasyon var.' },
  staff_not_found: { code: 'not_found', message: 'Personel kaydı bulunamadı.' },
  staff_limit_reached: { code: 'invalid_input', message: 'Personel ekleme sınırına ulaşıldı.' },
  cannot_remove_owner: { code: 'forbidden', message: 'Tesis sahibi personel listesinden çıkarılamaz.' },
  document_not_found: { code: 'not_found', message: 'Belge bulunamadı.' },
  document_locked: {
    code: 'forbidden',
    message: 'Kesinleşmiş belge değiştirilemez. Yeni bir belge oluştur.',
  },
  reservation_locked: {
    code: 'forbidden',
    message: 'Bu rezervasyon kesinleştiği için doğrudan değiştirilemez. İptal veya düzeltme işlemi kullan.',
  },
  reservation_not_editable: {
    code: 'forbidden',
    message: 'Bu rezervasyonun durumu düzenlemeye uygun değil.',
  },
  reservation_has_payments: {
    code: 'forbidden',
    message: 'Ödeme alınmış rezervasyon silinemez. İptal veya ters kayıt kullan.',
  },
  reservation_has_folio: {
    code: 'forbidden',
    message: 'Folio hareketi olan rezervasyon silinemez. İptal veya düzeltme kullan.',
  },
  hold_expired: {
    code: 'invalid_input',
    message: 'Rezervasyon için ayrılan süre doldu. Müsaitliği yeniden kontrol et.',
  },
  review_hidden: { code: 'forbidden', message: 'Bu değerlendirme yayından kaldırılmış.' },
  message_thread_closed: { code: 'forbidden', message: 'Bu mesaj konuşması kapatılmış.' },
};

const RATE_LIMIT_PREFIX = 'rate_limited:';

export function rpcError(error: PostgrestError | null | undefined): AppError {
  if (!error) {
    return appError('unknown');
  }

  const raw = (error.message ?? '').trim();
  const token = raw.split(/\s/)[0] ?? '';
  const known = token ? TOKENS[token] : undefined;
  if (known) {
    return appError(known.code, known.message);
  }

  if (raw.startsWith(RATE_LIMIT_PREFIX) || error.code === '53400') {
    return appError('rate_limited');
  }

  if (error.code === '42501') {
    return appError('forbidden');
  }
  if (error.code === 'P0002') {
    return appError('not_found');
  }
  if (error.code === '23505') {
    return appError('duplicate');
  }
  if (error.code === '23514' || error.code === '22023' || error.code === '22P02') {
    return appError('invalid_input');
  }

  if (/fetch|network|timeout|offline/i.test(raw)) {
    return appError('network');
  }

  return appError('unknown');
}
