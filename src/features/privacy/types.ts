export type PrivacyRequestType =
  | 'access'
  | 'copy'
  | 'rectify'
  | 'erase'
  | 'object'
  | 'restrict'
  | 'consent_withdraw'
  | 'other';

export type PrivacyRequestStatus =
  | 'received'
  | 'verification_pending'
  | 'in_review'
  | 'awaiting_user'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type PrivacyRequestSummary = {
  id: string;
  request_no: string;
  request_type: PrivacyRequestType;
  subject: string;
  status: PrivacyRequestStatus;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  response_summary: string | null;
};

export type PrivacyRequestHistoryItem = {
  status: PrivacyRequestStatus;
  note: string | null;
  actor_role: string;
  created_at: string;
};

export type PrivacyRequestDetail = PrivacyRequestSummary & {
  details: string;
  history: PrivacyRequestHistoryItem[];
};

export type AdminPrivacyRequest = PrivacyRequestDetail & {
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  email: string | null;
  assigned_to: string | null;
};

export type AdminPrivacyRequestList = {
  total: number;
  items: AdminPrivacyRequest[];
};

export const PRIVACY_REQUEST_TYPES: {
  code: PrivacyRequestType;
  label: string;
  hint: string;
}[] = [
  { code: 'access', label: 'Verilerimi görüntülemek istiyorum', hint: 'Hesabınızda işlenen verilerin kapsamını öğrenin.' },
  { code: 'copy', label: 'Verilerimin kopyasını talep ediyorum', hint: 'Taşınabilir formatta veri kopyası.' },
  { code: 'rectify', label: 'Yanlış bilgilerimi düzeltmek istiyorum', hint: 'Hatalı veya eksik verinin düzeltilmesi.' },
  { code: 'erase', label: 'Belirli verilerimin silinmesini istiyorum', hint: 'Hesabınızı silmeden seçili verilerin kaldırılması.' },
  { code: 'object', label: 'Veri işlemeye itiraz etmek istiyorum', hint: 'Belirli bir işleme faaliyetine itiraz.' },
  { code: 'restrict', label: 'Veri işlemenin kısıtlanmasını istiyorum', hint: 'İşlemenin geçici olarak sınırlandırılması.' },
  { code: 'consent_withdraw', label: 'Rızamı geri çekmek istiyorum', hint: 'Açık rızaya dayalı işlemler için.' },
  { code: 'other', label: 'Diğer KVKK başvurusu', hint: 'Yukarıdakilere uymayan talepler.' },
];

export const PRIVACY_STATUS_LABELS: Record<PrivacyRequestStatus, string> = {
  received: 'Alındı',
  verification_pending: 'Doğrulama bekleniyor',
  in_review: 'İncelemede',
  awaiting_user: 'Sizden bilgi bekleniyor',
  completed: 'Tamamlandı',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
};
