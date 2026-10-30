import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type {
  ChildReasonCode,
  CommentPolicy,
  ReportPriority,
  ReportStatusCode,
  ReportTargetType,
  SupportCategoryCode,
  TicketPriority,
  TicketStatusCode,
  CallPolicy,
  DmPolicy,
} from './types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const SUPPORT_EMAIL = 'support@litxtech.com';
export const SUPPORT_RESPONSE_TARGET_HOURS = 24;
export const CHILD_RESPONSE_TARGET_MINUTES = 30;

export type SupportCategory = {
  code: SupportCategoryCode;
  label: string;
  description: string;
  icon: IoniconName;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent';
};

export const SUPPORT_CATEGORIES: SupportCategory[] = [
  {
    code: 'account_access',
    label: 'Hesap ve giriş',
    description: 'Giriş, şifre ve doğrulama sorunları',
    icon: 'person-circle-outline',
    tone: 'primary',
  },
  {
    code: 'security_privacy',
    label: 'Güvenlik ve gizlilik',
    description: 'Gizlilik, engelleme ve hesap güvenliği',
    icon: 'shield-checkmark-outline',
    tone: 'success',
  },
  {
    code: 'technical',
    label: 'Teknik sorun',
    description: 'Hata, donma ve performans',
    icon: 'construct-outline',
    tone: 'neutral',
  },
  {
    code: 'content',
    label: 'İçerik',
    description: 'Gönderi, Reels ve yorumlar',
    icon: 'images-outline',
    tone: 'accent',
  },
  {
    code: 'messaging_calls',
    label: 'Mesaj ve aramalar',
    description: 'Sohbet, arama ve bildirimler',
    icon: 'chatbubbles-outline',
    tone: 'primary',
  },
  {
    code: 'payments',
    label: 'Ödeme ve satın alma',
    description: 'Abonelik ve işlem sorunları',
    icon: 'card-outline',
    tone: 'warning',
  },
  {
    code: 'notifications',
    label: 'Bildirimler',
    description: 'Bildirim gelmiyor veya geç geliyor',
    icon: 'notifications-outline',
    tone: 'neutral',
  },
  {
    code: 'child_safety',
    label: 'Çocuk güvenliği',
    description: 'Öncelikli ve gizli inceleme',
    icon: 'heart-circle-outline',
    tone: 'danger',
  },
  {
    code: 'other',
    label: 'Diğer',
    description: 'Listede olmayan bir konu',
    icon: 'ellipsis-horizontal-circle-outline',
    tone: 'neutral',
  },
];

export const SUPPORT_CATEGORY_MAP = Object.fromEntries(
  SUPPORT_CATEGORIES.map((category) => [category.code, category]),
) as Record<SupportCategoryCode, SupportCategory>;

export const TICKET_STATUS: Record<
  TicketStatusCode,
  { label: string; tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent'; hint: string }
> = {
  received: { label: 'Alındı', tone: 'primary', hint: 'Talebin sıraya alındı.' },
  under_review: { label: 'İnceleniyor', tone: 'warning', hint: 'Destek ekibimiz talebini inceliyor.' },
  awaiting_user: { label: 'Yanıt bekleniyor', tone: 'accent', hint: 'Ekibimiz senden bilgi bekliyor.' },
  info_required: { label: 'Bilgi gerekli', tone: 'warning', hint: 'Talebi sürdürmek için ek bilgi gerekiyor.' },
  priority_review: { label: 'Öncelikli inceleme', tone: 'danger', hint: 'Talebin öncelikli kuyrukta.' },
  resolved: { label: 'Çözüldü', tone: 'success', hint: 'Talebin çözüldü olarak işaretlendi.' },
  closed: { label: 'Kapatıldı', tone: 'neutral', hint: 'Talep kapatıldı.' },
};

export const REPORT_STATUS: Record<
  ReportStatusCode,
  { label: string; tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent' }
> = {
  received: { label: 'Alındı', tone: 'primary' },
  under_review: { label: 'İnceleniyor', tone: 'warning' },
  action_taken: { label: 'İşlem uygulandı', tone: 'accent' },
  resolved: { label: 'Sonuçlandırıldı', tone: 'success' },
  dismissed: { label: 'Kural ihlali yok', tone: 'neutral' },
  closed: { label: 'Kapatıldı', tone: 'neutral' },
};

export const PRIORITY_LABEL: Record<ReportPriority | TicketPriority | string, string> = {
  normal: 'Normal',
  high: 'Yüksek',
  urgent: 'Acil',
  critical: 'Kritik',
};

export const REPORT_TARGET_LABEL: Record<ReportTargetType, string> = {
  user: 'Kullanıcı',
  profile: 'Profil',
  post: 'Gönderi',
  reel: 'Reels',
  comment: 'Yorum',
  message: 'Mesaj',
  map_share: 'Konum paylaşımı',
  live: 'Canlı yayın',
  call: 'Arama',
  room: 'Sesli oda',
  story: 'Hikâye',
  listing: 'Marketplace ilanı',
  other: 'İçerik',
};

export const REPORT_TARGET_ICON: Record<ReportTargetType, IoniconName> = {
  user: 'person-outline',
  profile: 'person-circle-outline',
  post: 'image-outline',
  reel: 'play-circle-outline',
  comment: 'chatbubble-ellipses-outline',
  message: 'mail-outline',
  map_share: 'location-outline',
  live: 'radio-outline',
  call: 'call-outline',
  room: 'mic-outline',
  story: 'albums-outline',
  listing: 'pricetag-outline',
  other: 'flag-outline',
};

export type ReportReason = {
  code: string;
  label: string;
  description: string;
  icon: IoniconName;
  urgent?: boolean;
};

export const REPORT_REASONS: ReportReason[] = [
  {
    code: 'child_safety',
    label: 'Çocuk güvenliği ve istismarı',
    description: '18 yaş altı birinin güvenliği risk altında',
    icon: 'shield-half-outline',
    urgent: true,
  },
  {
    code: 'sexual_content',
    label: 'Cinsel içerik veya çıplaklık',
    description: 'Uygunsuz görsel veya cinsel içerik',
    icon: 'eye-off-outline',
  },
  {
    code: 'harassment',
    label: 'Taciz veya zorbalık',
    description: 'Rahatsız edici, aşağılayıcı davranış',
    icon: 'hand-left-outline',
  },
  {
    code: 'hate_speech',
    label: 'Nefret söylemi',
    description: 'Kimliğe yönelik ayrımcı veya nefret içeren sözler',
    icon: 'megaphone-outline',
  },
  {
    code: 'violence_threat',
    label: 'Şiddet veya tehdit',
    description: 'Fiziksel zarar tehdidi ya da şiddet içeriği',
    icon: 'warning-outline',
  },
  {
    code: 'fraud_fake_account',
    label: 'Dolandırıcılık veya sahte hesap',
    description: 'Sahte profil, dolandırıcılık girişimi',
    icon: 'finger-print-outline',
  },
  {
    code: 'personal_info',
    label: 'Kişisel bilgi paylaşımı',
    description: 'İzinsiz telefon, adres veya kimlik paylaşımı',
    icon: 'id-card-outline',
  },
  {
    code: 'spam_misleading',
    label: 'Spam veya yanıltıcı içerik',
    description: 'İstenmeyen, aldatıcı veya tekrarlayan içerik',
    icon: 'mail-unread-outline',
  },
  {
    code: 'self_harm',
    label: 'İntihar veya kendine zarar',
    description: 'Kişinin kendisine zarar verme riski',
    icon: 'medkit-outline',
    urgent: true,
  },
  {
    code: 'other',
    label: 'Diğer',
    description: 'Yukarıdakilere uymayan bir sorun',
    icon: 'ellipsis-horizontal-outline',
  },
];

export const CHILD_REASONS: (ReportReason & { code: ChildReasonCode; critical: boolean })[] = [
  {
    code: 'child_sexual_exploitation',
    label: 'Cinsel istismar veya sömürü',
    description: 'Çocuğun cinsel içerikte kullanılması veya sömürülmesi',
    icon: 'alert-circle-outline',
    urgent: true,
    critical: true,
  },
  {
    code: 'child_grooming',
    label: 'Uygunsuz yaklaşım veya kandırma',
    description: 'Çocuğa güven kazanıp uygunsuz iletişim kurma girişimi',
    icon: 'people-outline',
    urgent: true,
    critical: true,
  },
  {
    code: 'child_immediate_danger',
    label: 'Acil tehlike',
    description: 'Çocuğun fiziksel olarak tehlikede olması',
    icon: 'alert-circle-outline',
    urgent: true,
    critical: true,
  },
  {
    code: 'child_sextortion',
    label: 'Cinsel şantaj veya tehdit',
    description: 'Çocuğa yönelik cinsel içerikli şantaj',
    icon: 'lock-closed-outline',
    urgent: true,
    critical: true,
  },
  {
    code: 'child_trafficking',
    label: 'Çocuk ticareti',
    description: 'İstismar amacıyla yönlendirme veya kaçırma girişimi',
    icon: 'navigate-outline',
    urgent: true,
    critical: true,
  },
  {
    code: 'child_bullying',
    label: 'Zorbalık veya taciz',
    description: 'Akran zorbalığı, tehdit veya aşağılama',
    icon: 'chatbubble-ellipses-outline',
    urgent: false,
    critical: false,
  },
  {
    code: 'child_privacy',
    label: 'Özel bilgilerin paylaşımı',
    description: 'Çocuğun adresi, okulu veya kimliğinin ifşası',
    icon: 'eye-off-outline',
    urgent: false,
    critical: false,
  },
  {
    code: 'child_self_harm',
    label: 'Kendine zarar vermeye teşvik',
    description: 'Çocuğun kendine zarar vermesine yönlendirme',
    icon: 'heart-dislike-outline',
    urgent: true,
    critical: true,
  },
  {
    code: 'child_other',
    label: 'Diğer çocuk güvenliği sorunu',
    description: 'Listede olmayan ancak çocuğu etkileyen bir durum',
    icon: 'ellipsis-horizontal-outline',
    urgent: false,
    critical: false,
  },
];

export const CHILD_REASON_MAP = Object.fromEntries(
  CHILD_REASONS.map((reason) => [reason.code, reason]),
) as Record<ChildReasonCode, (typeof CHILD_REASONS)[number]>;

export const DM_POLICY_OPTIONS: { value: DmPolicy; label: string; hint: string }[] = [
  { value: 'friends', label: 'Sadece arkadaşlar', hint: 'Önerilen: tanımadığın kişiler mesaj atamaz.' },
  { value: 'nobody', label: 'Kimse', hint: 'Mesajlar tamamen kapatılır.' },
];

export const CALL_POLICY_OPTIONS: { value: CallPolicy; label: string; hint: string }[] = [
  { value: 'friends', label: 'Sadece arkadaşlar', hint: 'Önerilen: tanımadığın kişiler arayamaz.' },
  { value: 'nobody', label: 'Kimse', hint: 'Aramalar tamamen kapatılır.' },
];

export const COMMENT_POLICY_OPTIONS: { value: CommentPolicy; label: string; hint: string }[] = [
  { value: 'friends', label: 'Sadece arkadaşlar', hint: 'Yorumlar arkadaşlarınla sınırlıdır.' },
  { value: 'nobody', label: 'Kimse', hint: 'Yorumlar kapatılır.' },
];

export const CHILD_PROTECTED_EXPLANATION = [
  {
    icon: 'lock-closed-outline' as IoniconName,
    title: 'Profilin gizli kalır',
    body: 'Hesabın 18 yaşına gelene kadar yalnızca arkadaşlarına görünür. Profilini herkese açamazsın.',
  },
  {
    icon: 'document-text-outline' as IoniconName,
    title: 'Gönderilerin sınırlı paylaşılır',
    body: 'Gönderilerin ve Reels videoların yalnızca arkadaşlarına görünür; keşfet akışında yabancılara önerilmez.',
  },
  {
    icon: 'chatbubbles-outline' as IoniconName,
    title: 'Tanımadığın kişiler ulaşamaz',
    body: 'Mesaj, arama ve yorumlar varsayılan olarak arkadaşlarınla sınırlıdır. Bu korumayı gevşetemezsin.',
  },
  {
    icon: 'location-outline' as IoniconName,
    title: 'Konumun paylaşılmaz',
    body: 'Canlı konum, şehir ve mekân etiketi gönderilere eklenemez; haritada görünme kapalıdır.',
  },
  {
    icon: 'shield-checkmark-outline' as IoniconName,
    title: 'Sadece sen, arkadaşların ve yönetim görür',
    body: 'Çocuk Hesabı rozetini yabancılar göremez; yalnızca sen, arkadaşların ve yetkili moderasyon ekibi görür.',
  },
];

export const SAFETY_COMMITMENTS = [
  'Çocuk güvenliği bildirimleri 30 dakika içinde öncelikli kuyruğa alınır.',
  'Cinsel istismar ve acil tehlike bildirimleri en üst öncelikle incelenir.',
  'İnceleme sürecinde ekran görüntüleri ve mesajlar yalnızca yetkili ekip tarafından görülür.',
  'Bildirimi yapan kişinin kimliği, bildirdiği kişiye asla açıklanmaz.',
  'Gerektiğinde yetkili kurumlarla yasal çerçevede iş birliği yapılır.',
];
