import { useQuery } from '@tanstack/react-query';

import type { Result } from '@/utils/result';

import * as safety from '../services/safety-service';
import type {
  AdminReport,
  AdminReportDetail,
  AdminTicket,
  AgeOverview,
  AuditLogItem,
  ChildSafetyQueue,
  GuardianConsent,
  ReportDetail,
  ReportSummary,
  SafetyFaq,
  SafetyNotification,
  SafetyPolicy,
  SafetyState,
  StaffInfo,
  SupportReplyTemplate,
  TicketDetail,
  TicketSummary,
} from '../types';

export const safetyKeys = {
  state: ['safety', 'state'] as const,
  faqs: ['safety', 'faqs'] as const,
  policy: (slug: string) => ['safety', 'policy', slug] as const,
  tickets: ['safety', 'tickets'] as const,
  ticket: (id: string) => ['safety', 'ticket', id] as const,
  reports: ['safety', 'reports'] as const,
  report: (id: string) => ['safety', 'report', id] as const,
  notifications: ['safety', 'notifications'] as const,
  staff: ['safety', 'staff'] as const,
  adminTickets: (filters: unknown) => ['safety', 'admin', 'tickets', filters] as const,
  adminReports: (filters: unknown) => ['safety', 'admin', 'reports', filters] as const,
  adminReport: (id: string) => ['safety', 'admin', 'report', id] as const,
  childQueue: ['safety', 'admin', 'child-queue'] as const,
  ageOverview: ['safety', 'admin', 'age-overview'] as const,
  consents: (status: string) => ['safety', 'admin', 'consents', status] as const,
  audit: (entityType: string | null) => ['safety', 'admin', 'audit', entityType] as const,
  supportTemplates: ['safety', 'admin', 'support-templates'] as const,
};

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
};

export function useSafetyState() {
  return useQuery<SafetyState, Error, SafetyState, readonly unknown[]>({
    queryKey: safetyKeys.state,
    queryFn: async () => unwrap(await safety.fetchSafetyState()),
    staleTime: 60_000,
  });
}

export function useSafetyFaqs() {
  return useQuery<SafetyFaq[], Error>({
    queryKey: safetyKeys.faqs,
    queryFn: async () => unwrap(await safety.fetchFaqs()),
    staleTime: 10 * 60_000,
  });
}

export function useSafetyPolicy(slug: string) {
  return useQuery<SafetyPolicy | null, Error>({
    queryKey: safetyKeys.policy(slug),
    queryFn: async () => unwrap(await safety.fetchPolicy(slug)),
    staleTime: 10 * 60_000,
  });
}

export function useMyTickets() {
  return useQuery<TicketSummary[], Error>({
    queryKey: safetyKeys.tickets,
    queryFn: async () => unwrap(await safety.fetchMyTickets()),
  });
}

export function useTicket(ticketId: string | null | undefined) {
  return useQuery<TicketDetail, Error>({
    queryKey: safetyKeys.ticket(ticketId ?? 'none'),
    queryFn: async () => unwrap(await safety.fetchTicket(ticketId as string)),
    enabled: Boolean(ticketId),
    refetchInterval: 20_000,
  });
}

export function useMyReports() {
  return useQuery<ReportSummary[], Error>({
    queryKey: safetyKeys.reports,
    queryFn: async () => unwrap(await safety.fetchMyReports()),
  });
}

export function useMyReport(reportId: string | null | undefined) {
  return useQuery<ReportDetail, Error>({
    queryKey: safetyKeys.report(reportId ?? 'none'),
    queryFn: async () => unwrap(await safety.fetchMyReport(reportId as string)),
    enabled: Boolean(reportId),
  });
}

export function useSafetyNotifications() {
  return useQuery<SafetyNotification[], Error>({
    queryKey: safetyKeys.notifications,
    queryFn: async () => unwrap(await safety.fetchNotifications()),
    staleTime: 30_000,
  });
}

export function useStaffInfo() {
  return useQuery<StaffInfo, Error>({
    queryKey: safetyKeys.staff,
    queryFn: async () => unwrap(await safety.fetchStaffInfo()),
    staleTime: 5 * 60_000,
  });
}

export function useAdminTickets(filters: {
  status?: string | null;
  category?: string | null;
  search?: string | null;
  assigned?: 'all' | 'me' | 'unassigned';
}) {
  return useQuery<{ items: AdminTicket[]; total: number }, Error>({
    queryKey: safetyKeys.adminTickets(filters),
    queryFn: async () => unwrap(await safety.fetchAdminTickets({ ...filters, limit: 50 })),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useAdminReports(filters: {
  queue?: 'all' | 'new' | 'critical' | 'unassigned' | 'resolved' | 'child';
  targetType?: string | null;
}) {
  return useQuery<{ items: AdminReport[]; total: number }, Error>({
    queryKey: safetyKeys.adminReports(filters),
    queryFn: async () => unwrap(await safety.fetchAdminReports({ ...filters, limit: 50 })),
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export function useAdminReport(reportId: string | null | undefined) {
  return useQuery<AdminReportDetail, Error>({
    queryKey: safetyKeys.adminReport(reportId ?? 'none'),
    queryFn: async () => unwrap(await safety.fetchAdminReport(reportId as string)),
    enabled: Boolean(reportId),
  });
}

export function useChildSafetyQueue() {
  return useQuery<ChildSafetyQueue, Error>({
    queryKey: safetyKeys.childQueue,
    queryFn: async () => unwrap(await safety.fetchChildQueue()),
    refetchInterval: 30_000,
  });
}

export function useAgeOverview() {
  return useQuery<AgeOverview, Error>({
    queryKey: safetyKeys.ageOverview,
    queryFn: async () => unwrap(await safety.fetchAgeOverview()),
    staleTime: 30_000,
  });
}

export function useGuardianConsents(status: 'pending' | 'verified' | 'rejected' | 'revoked' | 'expired' | 'all') {
  return useQuery<GuardianConsent[], Error>({
    queryKey: safetyKeys.consents(status),
    queryFn: async () => {
      const result = await safety.fetchConsents(status);
      return unwrap(result).items ?? [];
    },
    staleTime: 30_000,
  });
}

export function useAuditLogs(entityType: string | null = null) {
  return useQuery<AuditLogItem[], Error>({
    queryKey: safetyKeys.audit(entityType),
    queryFn: async () => {
      const result = await safety.fetchAuditLogs(entityType);
      return unwrap(result).items ?? [];
    },
    staleTime: 60_000,
  });
}

export function useSupportTemplates() {
  return useQuery<SupportReplyTemplate[], Error>({
    queryKey: safetyKeys.supportTemplates,
    queryFn: async () => {
      const result = await safety.fetchSupportTemplates();
      return unwrap(result).items ?? [];
    },
    staleTime: 60_000,
  });
}

export { unwrap as unwrapSafetyResult };
