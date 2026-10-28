import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Result } from '@/utils/result';

import * as safety from '../services/safety-service';
import type { SafetyBucket } from '../services/safety-service';
import type {
  Attachment,
  ReportDraft,
  ReportStatusCode,
  SupportCategoryCode,
  TicketPriority,
  TicketStatusCode,
} from '../types';
import { safetyKeys } from './use-safety';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
};

export function useSetBirthDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (birthDate: string) => unwrap(await safety.setBirthDate(birthDate)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.state });
    },
  });
}

export function useUpdateChildSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof safety.updateChildSettings>[0]) =>
      unwrap(await safety.updateChildSettings(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.state });
    },
  });
}

export function useRequestGuardianConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof safety.requestGuardianConsent>[0]) =>
      unwrap(await safety.requestGuardianConsent(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.state });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.notifications });
    },
  });
}

export function useRevokeGuardianConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await safety.revokeGuardianConsent()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.state });
    },
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      category: SupportCategoryCode;
      subject: string;
      body: string;
      attachments?: Attachment[];
    }) => unwrap(await safety.createTicket(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.tickets });
    },
  });
}

export function useSendTicketMessage(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: string; attachments?: Attachment[] }) =>
      unwrap(await safety.sendTicketMessage(ticketId, input.body, input.attachments)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.ticket(ticketId) });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.tickets });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.state });
    },
  });
}

export function useSetTicketStatus(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: 'close' | 'reopen') =>
      unwrap(await safety.setTicketStatus(ticketId, action)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.ticket(ticketId) });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.tickets });
    },
  });
}

/** Liste ekranlarindan talep kapatmak icin kimligi parametre olarak alir. */
export function useCloseTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; action?: 'close' | 'reopen' }) =>
      unwrap(await safety.setTicketStatus(input.ticketId, input.action ?? 'close')),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.ticket(variables.ticketId) });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.tickets });
    },
  });
}

export function useCreateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: ReportDraft & {
        reasonCode: string;
        childReasonCode?: string | null;
        description?: string;
        attachments?: Attachment[];
      },
    ) => unwrap(await safety.createReport(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.reports });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.state });
    },
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await safety.markNotificationsRead();
      if (!result.ok) {
        throw result.error;
      }
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.state });
    },
  });
}

export function useUploadAttachment() {
  return useMutation({
    mutationFn: async (input: {
      bucket: SafetyBucket;
      uri: string;
      name: string;
      mime: string;
      size?: number;
    }) => unwrap(await safety.uploadSafetyAttachment(input)),
  });
}

// -----------------------------------------------------------------------------
// Moderasyon
// -----------------------------------------------------------------------------

export function useAdminUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ticketId: string;
      status?: TicketStatusCode | null;
      priority?: TicketPriority | null;
      assignTo?: string | null;
      assignSelf?: boolean;
    }) => unwrap(await safety.adminUpdateTicket(input)),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'tickets'] });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.ticket(variables.ticketId) });
    },
  });
}

export function useAdminReplyTicket(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Parameters<typeof safety.adminReplyTicket>[0], 'ticketId'>) =>
      unwrap(await safety.adminReplyTicket({ ...input, ticketId })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.ticket(ticketId) });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'tickets'] });
    },
  });
}

export function useSaveSupportTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof safety.adminSaveSupportTemplate>[0]) =>
      unwrap(await safety.adminSaveSupportTemplate(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.supportTemplates });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'audit'] });
    },
  });
}

export function useAdminReportAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof safety.adminReportAction>[0]) =>
      unwrap(await safety.adminReportAction(input)),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.adminReport(variables.reportId) });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'reports'] });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.childQueue });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'audit'] });
    },
  });
}

export function useAdminAssignReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { reportId: string; assignSelf?: boolean }) =>
      unwrap(await safety.adminAssignReport(input.reportId, input.assignSelf ?? true)),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.adminReport(variables.reportId) });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'reports'] });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.childQueue });
    },
  });
}

export function useAdminAssignChildCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { caseId: string; assignSelf?: boolean }) =>
      unwrap(await safety.adminAssignChildCase(input.caseId, input.assignSelf ?? true)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.childQueue });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'audit'] });
    },
  });
}

export function useAdminResolveChildCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      caseId: string;
      status: 'investigating' | 'resolved' | 'closed';
      note?: string;
    }) => unwrap(await safety.adminResolveChildCase(input.caseId, input.status, input.note)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.childQueue });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'audit'] });
    },
  });
}

export function useAdminDecideConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      consentId: string;
      status: 'verified' | 'rejected' | 'revoked' | 'expired';
      note?: string;
    }) => unwrap(await safety.adminDecideConsent(input.consentId, input.status, input.note)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'consents'] });
      void queryClient.invalidateQueries({ queryKey: safetyKeys.ageOverview });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'audit'] });
    },
  });
}

export function useAdminOverrideAge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; birthDate: string; note?: string }) =>
      unwrap(await safety.adminOverrideAge(input.userId, input.birthDate, input.note)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: safetyKeys.ageOverview });
      void queryClient.invalidateQueries({ queryKey: ['safety', 'admin', 'audit'] });
    },
  });
}

export type ReportActionInput = {
  reportId: string;
  action: 'start_review' | 'apply_action' | 'dismiss' | 'resolve' | 'close' | 'reopen';
  noteInternal?: string;
  notePublic?: string;
  contentAction?: string;
  statusCode?: ReportStatusCode;
};
