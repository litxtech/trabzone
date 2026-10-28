export type LiveThreadStatus = 'waiting' | 'active' | 'closed';

export type LiveAuthorRole = 'user' | 'agent' | 'system';

export type LiveAttachment = {
  path: string;
  name: string;
  mime: string;
  size?: number;
};

export type LiveMessage = {
  id: string;
  author_id: string | null;
  author_role: LiveAuthorRole;
  body: string;
  attachments: LiveAttachment[];
  read_at: string | null;
  created_at: string;
};

export type LiveThreadSummary = {
  id: string;
  thread_no: string;
  status: LiveThreadStatus;
  category: string;
  subject: string | null;
  last_message_at: string;
  created_at: string;
  unread: number;
};

export type LiveThread = {
  id: string;
  thread_no: string;
  status: LiveThreadStatus;
  category: string;
  subject: string | null;
  priority: string;
  assigned_to: string | null;
  created_at: string;
  last_message_at: string;
  can_reply: boolean;
  messages: LiveMessage[];
};

export type LivePresence = {
  online: boolean;
  agents_online: number;
  checked_at: string;
};

export type StartedThread = {
  id: string;
  thread_no: string;
  status: LiveThreadStatus;
  created: boolean;
};

export type AgentThread = {
  id: string;
  thread_no: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  status: LiveThreadStatus;
  category: string;
  subject: string | null;
  priority: string;
  assigned_to: string | null;
  last_message_at: string;
  created_at: string;
  last_message: string | null;
  unread: number;
};

export type AgentThreadList = {
  total: number;
  agents_online: number;
  items: AgentThread[];
};

export const LIVE_CATEGORIES = [
  { code: 'account', label: 'Hesabım' },
  { code: 'login', label: 'Giriş Problemleri' },
  { code: 'register', label: 'Kayıt Problemleri' },
  { code: 'marketplace', label: 'Marketplace' },
  { code: 'real_estate', label: 'Emlak İlanları' },
  { code: 'messaging', label: 'Mesajlaşma' },
  { code: 'reels', label: 'Reels ve Gönderiler' },
  { code: 'business', label: 'İşletmeler' },
  { code: 'map', label: 'Harita' },
  { code: 'security', label: 'Güvenlik' },
  { code: 'child_safety', label: 'Çocuk Güvenliği' },
  { code: 'privacy', label: 'Gizlilik' },
  { code: 'deletion', label: 'Hesap Silme' },
  { code: 'technical', label: 'Teknik Sorunlar' },
  { code: 'other', label: 'Diğer' },
] as const;
