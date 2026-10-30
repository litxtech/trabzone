import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { unwrap } from '@/utils/result';

import * as admin from '../services/admin-service';
import { adminKeys } from '../services/admin-service';
import * as mfa from '../services/mfa-service';
import type {
  ContentAction,
  ContentKind,
  OrderAction,
  UserAction,
  UserFilters,
} from '../types';

export function useAdminMe() {
  return useQuery({
    queryKey: adminKeys.me,
    queryFn: async () => unwrap(await admin.fetchAdminMe()),
    staleTime: 60_000,
  });
}

/**
 * Yönetici oturumunu sunucuda görünür kılar. İlk açılışta ve ardından beş
 * dakikada bir çalışır; böylece Güvenlik Merkezi canlı oturumları gösterir ve
 * iptal edilen oturumlar sonraki yönetici RPC'lerinde reddedilir.
 */
export function useAdminSessionHeartbeat(enabled: boolean, userAgent?: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const touch = () => {
      void admin.touchSession(userAgent ?? null).then((result) => {
        if (!cancelled && result.ok) {
          void client.invalidateQueries({ queryKey: adminKeys.sessions });
          void client.invalidateQueries({ queryKey: adminKeys.security });
        }
      });
    };
    touch();
    const interval = setInterval(touch, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [client, enabled, userAgent]);
}

export function useShellCounts() {
  return useQuery({
    queryKey: adminKeys.shell,
    queryFn: async () => unwrap(await admin.fetchShellCounts()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useAdminOverview(from: string, to: string) {
  return useQuery({
    queryKey: adminKeys.overview({ from, to }),
    queryFn: async () => unwrap(await admin.fetchOverview(from, to)),
    staleTime: 60_000,
  });
}

export function useAdminUsers(filters: UserFilters) {
  return useQuery({
    queryKey: adminKeys.users(filters),
    queryFn: async () => unwrap(await admin.fetchUsers(filters)),
    placeholderData: (previous) => previous,
  });
}

export function useAdminUser(userId: string | null | undefined) {
  return useQuery({
    queryKey: adminKeys.user(userId ?? 'none'),
    queryFn: async () => unwrap(await admin.fetchUserDetail(userId as string)),
    enabled: Boolean(userId),
  });
}

export function useAdminUserAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      action: UserAction;
      reason: string | null;
      days?: number | null;
    }) =>
      unwrap(await admin.userAction(input.userId, input.action, input.reason, input.days ?? null)),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      void client.invalidateQueries({ queryKey: adminKeys.user(variables.userId) });
      void client.invalidateQueries({ queryKey: adminKeys.shell });
    },
  });
}

export function useAdminPosts(params: {
  query?: string;
  status?: string | null;
  featured?: boolean | null;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminKeys.posts(params),
    queryFn: async () => unwrap(await admin.fetchPosts(params)),
    placeholderData: (previous) => previous,
  });
}

export function useAdminReels(params: {
  query?: string;
  status?: string | null;
  moderation?: string | null;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminKeys.reels(params),
    queryFn: async () => unwrap(await admin.fetchReels(params)),
    placeholderData: (previous) => previous,
  });
}

export function useAdminStories(params: {
  query?: string;
  status?: string | null;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminKeys.stories(params),
    queryFn: async () => unwrap(await admin.fetchStories(params)),
    placeholderData: (previous) => previous,
  });
}

export function useAdminComments(params: {
  query?: string;
  status?: string | null;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminKeys.comments(params),
    queryFn: async () => unwrap(await admin.fetchComments(params)),
    placeholderData: (previous) => previous,
  });
}

export function useContentAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      kind: ContentKind;
      id: string;
      action: ContentAction;
      reason: string | null;
    }) => unwrap(await admin.contentAction(input.kind, input.id, input.action, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin'] });
      // Moderasyon uygulanan içerik uygulama akışlarında da anında düşsün;
      // aksi hâlde kaldırılan hikâye/gönderi önbellekten görünmeye devam eder.
      void client.invalidateQueries({ queryKey: ['stories'] });
      void client.invalidateQueries({ queryKey: ['feed'] });
      void client.invalidateQueries({ queryKey: ['reels'] });
    },
  });
}

export function useMarketplaceOverview() {
  return useQuery({
    queryKey: adminKeys.market,
    queryFn: async () => unwrap(await admin.fetchMarketplaceOverview()),
    staleTime: 60_000,
  });
}

export function useAdminOrders(params: {
  status?: string | null;
  query?: string | null;
  payment?: string | null;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminKeys.orders(params),
    queryFn: async () => unwrap(await admin.fetchOrders(params)),
    placeholderData: (previous) => previous,
  });
}

export function useAdminOrder(orderId: string | null | undefined) {
  return useQuery({
    queryKey: adminKeys.order(orderId ?? 'none'),
    queryFn: async () => unwrap(await admin.fetchOrderDetail(orderId as string)),
    enabled: Boolean(orderId),
  });
}

export function useOrderAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      orderId: string;
      action: OrderAction;
      reason: string | null;
      amountCents?: number | null;
    }) =>
      unwrap(
        await admin.orderAction(input.orderId, input.action, input.reason, input.amountCents ?? null),
      ),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: adminKeys.order(variables.orderId) });
      void client.invalidateQueries({ queryKey: ['admin', 'orders'] });
      void client.invalidateQueries({ queryKey: adminKeys.market });
      void client.invalidateQueries({ queryKey: ['admin', 'finance'] });
    },
  });
}

export function useCommissionSettings() {
  return useQuery({
    queryKey: adminKeys.commissions,
    queryFn: async () => unwrap(await admin.fetchCommissionSettings()),
    staleTime: 60_000,
  });
}

export function useCommissionSet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rateBps: number; categoryId: string | null; reason: string }) =>
      unwrap(await admin.setCommission(input.rateBps, input.categoryId, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.commissions });
      void client.invalidateQueries({ queryKey: adminKeys.market });
    },
  });
}

export function useFinanceOverview(from: string, to: string) {
  return useQuery({
    queryKey: adminKeys.finance({ from, to }),
    queryFn: async () => unwrap(await admin.fetchFinanceOverview(from, to)),
    staleTime: 60_000,
  });
}

export function useFinanceTransactions(params: {
  kind?: string;
  status?: string;
  from: string;
  to: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminKeys.financeTx(params),
    queryFn: async () => unwrap(await admin.fetchFinanceTransactions(params)),
    placeholderData: (previous) => previous,
  });
}

export function useMessagingOverview(from: string, to: string) {
  return useQuery({
    queryKey: adminKeys.messaging({ from, to }),
    queryFn: async () => unwrap(await admin.fetchMessagingOverview(from, to)),
    staleTime: 60_000,
  });
}

export function useMessageReports(queue: string, limit = 20, offset = 0) {
  return useQuery({
    queryKey: [...adminKeys.messageReports(queue), limit, offset],
    queryFn: async () => unwrap(await admin.fetchMessageReports(queue, limit, offset)),
    placeholderData: (previous) => previous,
  });
}

export function useMessageReportDetail() {
  return useMutation({
    mutationFn: async (input: { reportId: string; reason: string }) =>
      unwrap(await admin.fetchMessageReportDetail(input.reportId, input.reason)),
  });
}

export function useCampaigns(status: string | null, search: string, limit = 25, offset = 0) {
  return useQuery({
    queryKey: adminKeys.campaigns({ status, search, limit, offset }),
    queryFn: async () => unwrap(await admin.fetchCampaigns(status, search, limit, offset)),
    placeholderData: (previous) => previous,
  });
}

export function useAudiencePreview(audience: Record<string, unknown> | null) {
  return useQuery({
    queryKey: adminKeys.audience(audience),
    queryFn: async () => unwrap(await admin.previewAudience(audience as Record<string, unknown>)),
    enabled: Boolean(audience?.type),
    staleTime: 30_000,
  });
}

export function useCampaignSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof admin.saveCampaign>[0]) =>
      unwrap(await admin.saveCampaign(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      void client.invalidateQueries({ queryKey: adminKeys.shell });
    },
  });
}

export function useCampaignCancel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) =>
      unwrap(await admin.cancelCampaign(input.id, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
    },
  });
}

export function useCmsPages(search: string, status: string | null, limit = 50, offset = 0) {
  return useQuery({
    queryKey: adminKeys.cmsPages({ search, status, limit, offset }),
    queryFn: async () => unwrap(await admin.fetchCmsPages(search, status, limit, offset)),
    placeholderData: (previous) => previous,
  });
}

export function useCmsPage(slug: string | null | undefined) {
  return useQuery({
    queryKey: adminKeys.cmsPage(slug ?? 'none'),
    queryFn: async () => unwrap(await admin.fetchCmsPage(slug as string)),
    enabled: Boolean(slug),
  });
}

export function useCmsPageSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof admin.saveCmsPage>[0]) =>
      unwrap(await admin.saveCmsPage(input)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'cms'] });
      void client.invalidateQueries({ queryKey: ['admin', 'cms-page'] });
    },
  });
}

export function useCmsPageArchive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { slug: string; reason: string }) =>
      unwrap(await admin.archiveCmsPage(input.slug, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'cms'] });
      void client.invalidateQueries({ queryKey: ['admin', 'cms-page'] });
    },
  });
}

export function useAnnouncements() {
  return useQuery({
    queryKey: adminKeys.announcements,
    queryFn: async () => unwrap(await admin.fetchAnnouncements()),
    staleTime: 30_000,
  });
}

export function useAnnouncementSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof admin.saveAnnouncement>[0]) =>
      unwrap(await admin.saveAnnouncement(input)),
    onSuccess: () => void client.invalidateQueries({ queryKey: adminKeys.announcements }),
  });
}

export function useAnnouncementToggle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; active: boolean; reason: string }) =>
      unwrap(await admin.toggleAnnouncement(input.id, input.active, input.reason)),
    onSuccess: () => void client.invalidateQueries({ queryKey: adminKeys.announcements }),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: async () => unwrap(await admin.fetchSettings()),
    staleTime: 60_000,
  });
}

export function useSettingSet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; value: unknown; reason: string }) =>
      unwrap(await admin.setSetting(input.key, input.value, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.settings });
      void client.invalidateQueries({ queryKey: adminKeys.security });
    },
  });
}

export function useFeatureFlags() {
  return useQuery({
    queryKey: adminKeys.flags,
    queryFn: async () => unwrap(await admin.fetchFeatureFlags()),
    staleTime: 30_000,
  });
}

export function useFeatureFlagSet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; enabled: boolean; reason: string }) =>
      unwrap(await admin.setFeatureFlag(input.key, input.enabled, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.flags });
      void client.invalidateQueries({ queryKey: adminKeys.shell });
    },
  });
}

export function useApprovalDecide() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { approvalId: string; approve: boolean; reason: string }) =>
      unwrap(await admin.decideApproval(input.approvalId, input.approve, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.flags });
      void client.invalidateQueries({ queryKey: adminKeys.shell });
    },
  });
}

export function useRolesOverview() {
  return useQuery({
    queryKey: adminKeys.roles,
    queryFn: async () => unwrap(await admin.fetchRoleOverview()),
    staleTime: 60_000,
  });
}

export function useRolePermissionsSet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { roleKey: string; permissions: string[]; reason: string }) =>
      unwrap(await admin.setRolePermissions(input.roleKey, input.permissions, input.reason)),
    onSuccess: () => void client.invalidateQueries({ queryKey: adminKeys.roles }),
  });
}

export function useRevokeRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; roleKey: string; reason: string }) =>
      unwrap(await admin.revokeRole(input.userId, input.roleKey, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.roles });
      void client.invalidateQueries({ queryKey: adminKeys.staff });
    },
  });
}

export function useStaff() {
  return useQuery({
    queryKey: adminKeys.staff,
    queryFn: async () => unwrap(await admin.fetchStaff()),
    staleTime: 60_000,
  });
}

export function useAssignRole() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; roleKey: string }) =>
      unwrap(await admin.assignRole(input.userId, input.roleKey)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.roles });
      void client.invalidateQueries({ queryKey: adminKeys.staff });
    },
  });
}

export function useFindUser(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['admin', 'find-user', trimmed] as const,
    queryFn: async () => unwrap(await admin.findUser(trimmed)),
    enabled: trimmed.length >= 2,
    staleTime: 15_000,
  });
}

export function useSecurityOverview() {
  return useQuery({
    queryKey: adminKeys.security,
    queryFn: async () => unwrap(await admin.fetchSecurityOverview()),
    staleTime: 30_000,
  });
}

export function useAdminSessions() {
  return useQuery({
    queryKey: adminKeys.sessions,
    queryFn: async () => (await unwrap(await admin.fetchSessions())).items,
    staleTime: 15_000,
  });
}

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; reason: string }) =>
      unwrap(await admin.revokeSession(input.sessionId, input.reason)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.sessions });
      void client.invalidateQueries({ queryKey: adminKeys.security });
    },
  });
}

export function useMfaStatus() {
  return useQuery({
    queryKey: adminKeys.mfa,
    queryFn: async () => unwrap(await mfa.fetchMfaStatus()),
    staleTime: 30_000,
  });
}

export function useEnrollMfa() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await mfa.enrollTotp()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.mfa });
    },
  });
}

export function useVerifyMfa() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { factorId: string; code: string }) =>
      unwrap(await mfa.verifyTotp(input.factorId, input.code)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.mfa });
      void client.invalidateQueries({ queryKey: adminKeys.me });
    },
  });
}

export function useUnenrollMfa() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (factorId: string) => unwrap(await mfa.unenrollFactor(factorId)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.mfa });
    },
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: adminKeys.system,
    queryFn: async () => unwrap(await admin.fetchSystemHealth()),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useAuditCenter(params: {
  actionCode?: string | null;
  targetType?: string | null;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminKeys.audit(params),
    queryFn: async () => unwrap(await admin.fetchAuditCenter(params)),
    placeholderData: (previous) => previous,
  });
}

export function useReportCatalog() {
  return useQuery({
    queryKey: adminKeys.reportCatalog,
    queryFn: async () => unwrap(await admin.fetchReportCatalog()),
    staleTime: 5 * 60_000,
  });
}

export function useReportPreview(input: {
  key: string | null;
  from: string;
  to: string;
  filters?: Record<string, string>;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: adminKeys.reportPreview(input),
    queryFn: async () =>
      unwrap(
        await admin.previewReport({
          key: input.key as string,
          from: input.from,
          to: input.to,
          filters: input.filters,
          limit: input.limit,
          offset: input.offset,
        }),
      ),
    enabled: Boolean(input.key),
    placeholderData: (previous) => previous,
  });
}

export function useReportExport() {
  return useMutation({
    mutationFn: async (input: {
      key: string;
      from: string;
      to: string;
      filters?: Record<string, string>;
    }) =>
      unwrap(
        await admin.exportReportRows(input.key, input.from, input.to, input.filters ?? {}),
      ),
  });
}

export function useSupportTemplates() {
  return useQuery({
    queryKey: adminKeys.supportTemplates,
    queryFn: async () => unwrap(await admin.fetchSupportTemplates()),
    staleTime: 60_000,
  });
}

export function useSupportTemplateSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof admin.saveSupportTemplate>[0]) =>
      unwrap(await admin.saveSupportTemplate(input)),
    onSuccess: () => void client.invalidateQueries({ queryKey: adminKeys.supportTemplates }),
  });
}

export { adminKeys };
