import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type {
  ComplaintCategory,
  ComplaintChannel,
  ComplaintPriority,
  ComplaintStatus,
} from '../types';
import type { StatusTone } from './format';

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  cleanliness: 'Temizlik',
  noise: 'Gürültü',
  staff: 'Personel',
  maintenance: 'Teknik arıza',
  billing: 'Ücret / fatura',
  food: 'Yeme & içme',
  safety: 'Güvenlik',
  check_in: 'Giriş / çıkış',
  amenity: 'Olanak / hizmet',
  other: 'Diğer',
};

export const COMPLAINT_CATEGORY_ICONS: Record<
  ComplaintCategory,
  ComponentProps<typeof Ionicons>['name']
> = {
  cleanliness: 'sparkles-outline',
  noise: 'volume-high-outline',
  staff: 'people-outline',
  maintenance: 'construct-outline',
  billing: 'card-outline',
  food: 'restaurant-outline',
  safety: 'shield-checkmark-outline',
  check_in: 'log-in-outline',
  amenity: 'water-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

export const COMPLAINT_PRIORITY_LABELS: Record<ComplaintPriority, string> = {
  low: 'Düşük',
  normal: 'Normal',
  high: 'Yüksek',
  urgent: 'Acil',
};

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: 'Açık',
  in_progress: 'İşlemde',
  waiting_guest: 'Misafir bekleniyor',
  escalated: 'Eskalasyon',
  resolved: 'Çözüldü',
  closed: 'Kapalı',
};

export const COMPLAINT_CHANNEL_LABELS: Record<ComplaintChannel, string> = {
  front_desk: 'Ön büro',
  phone: 'Telefon',
  email: 'E-posta',
  whatsapp: 'WhatsApp',
  guest_app: 'Misafir uygulaması',
  review: 'Yorum',
  other: 'Diğer',
};

export const COMPLAINT_STATUS_OPTIONS: { value: ComplaintStatus | 'all' | 'active'; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'active', label: 'Açık talepler' },
  { value: 'open', label: 'Açık' },
  { value: 'in_progress', label: 'İşlemde' },
  { value: 'waiting_guest', label: 'Misafir bekleniyor' },
  { value: 'escalated', label: 'Eskalasyon' },
  { value: 'resolved', label: 'Çözüldü' },
  { value: 'closed', label: 'Kapalı' },
];

export const COMPLAINT_PRIORITY_OPTIONS: { value: ComplaintPriority; label: string }[] = [
  { value: 'low', label: 'Düşük' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Yüksek' },
  { value: 'urgent', label: 'Acil' },
];

export const COMPLAINT_CATEGORY_OPTIONS = (
  Object.keys(COMPLAINT_CATEGORY_LABELS) as ComplaintCategory[]
).map((value) => ({ value, label: COMPLAINT_CATEGORY_LABELS[value] }));

const COMPLAINT_TONES: Record<ComplaintStatus, StatusTone> = {
  open: { label: 'Açık', short: 'AÇK', color: '#FBBF24', background: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,0.42)' },
  in_progress: { label: 'İşlemde', short: 'İŞL', color: '#7DD3FC', background: 'rgba(14,165,233,0.18)', border: 'rgba(125,211,252,0.42)' },
  waiting_guest: { label: 'Misafir bekleniyor', short: 'MBK', color: '#C4B5FD', background: 'rgba(128,87,244,0.18)', border: 'rgba(196,181,253,0.42)' },
  escalated: { label: 'Eskalasyon', short: 'ESK', color: '#FDA4AF', background: 'rgba(244,63,94,0.18)', border: 'rgba(253,164,175,0.48)' },
  resolved: { label: 'Çözüldü', short: 'ÇÖZ', color: '#3DD68C', background: 'rgba(22,163,74,0.18)', border: 'rgba(61,214,140,0.42)' },
  closed: { label: 'Kapalı', short: 'KPL', color: '#9AA6BF', background: 'rgba(148,163,184,0.16)', border: 'rgba(148,163,184,0.32)' },
};

const PRIORITY_TONES: Record<ComplaintPriority, StatusTone> = {
  low: { label: 'Düşük', short: 'DÜŞ', color: '#9AA6BF', background: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.30)' },
  normal: { label: 'Normal', short: 'NRM', color: '#7DD3FC', background: 'rgba(14,165,233,0.16)', border: 'rgba(125,211,252,0.38)' },
  high: { label: 'Yüksek', short: 'YÜK', color: '#FBBF24', background: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,0.42)' },
  urgent: { label: 'Acil', short: 'ACL', color: '#FF8085', background: 'rgba(229,72,77,0.20)', border: 'rgba(229,72,77,0.46)' },
};

export function complaintTone(status: ComplaintStatus): StatusTone {
  return COMPLAINT_TONES[status] ?? COMPLAINT_TONES.open;
}

export function complaintPriorityTone(priority: ComplaintPriority): StatusTone {
  return PRIORITY_TONES[priority] ?? PRIORITY_TONES.normal;
}

export const ACTIVE_COMPLAINT_STATUSES: ComplaintStatus[] = [
  'open',
  'in_progress',
  'waiting_guest',
  'escalated',
];

export function isComplaintActive(status: ComplaintStatus): boolean {
  return ACTIVE_COMPLAINT_STATUSES.includes(status);
}

export type SlaInfo = {
  label: string;
  /** Kalan süre negatifse SLA aşılmıştır. */
  overdue: boolean;
  minutes: number;
};

/** SLA etiketi: "2 sa 15 dk kaldı" / "45 dk gecikti". */
export function slaInfo(dueAt: string | null | undefined): SlaInfo {
  if (!dueAt) return { label: 'SLA tanımsız', overdue: false, minutes: 0 };
  const minutes = Math.round((new Date(dueAt).getTime() - Date.now()) / 60_000);
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const chunk = hours > 0 ? `${hours} sa ${mins} dk` : `${mins} dk`;
  return {
    label: minutes < 0 ? `${chunk} gecikti` : `${chunk} kaldı`,
    overdue: minutes < 0,
    minutes,
  };
}

/** İlk yanıt / çözüm süresini okunabilir biçime çevirir. */
export function durationLabel(minutes: number | null | undefined): string {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} dk`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (hours < 24) return mins > 0 ? `${hours} sa ${mins} dk` : `${hours} sa`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest > 0 ? `${days} gün ${rest} sa` : `${days} gün`;
}
