import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr, formatSlaRemaining } from '@/utils/date';

import { SUPPORT_CATEGORY_MAP } from '../constants';
import type { TicketSummary } from '../types';
import { TicketStatusPill } from './StatusPill';

type Props = {
  ticket: TicketSummary;
  onPress: () => void;
};

export function TicketCard({ ticket, onPress }: Props) {
  const { theme } = useTheme();
  const category = SUPPORT_CATEGORY_MAP[ticket.category_code];
  const sla = formatSlaRemaining(ticket.sla_due_at);
  const open = ticket.status_code !== 'resolved' && ticket.status_code !== 'closed';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${ticket.subject}, ${ticket.ticket_no}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          opacity: pressed ? 0.8 : 1,
        },
        theme.shadows.card,
      ]}
    >
      <View style={styles.topRow}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor:
                ticket.category_code === 'child_safety'
                  ? theme.colors.dangerSoft
                  : theme.colors.primarySoft,
            },
          ]}
        >
          <Ionicons
            name={category?.icon ?? 'help-circle-outline'}
            size={20}
            color={ticket.category_code === 'child_safety' ? theme.colors.danger : theme.colors.primaryDeep}
          />
        </View>

        <View style={styles.titleBlock}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {ticket.subject}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            {ticket.ticket_no} · {category?.label ?? 'Destek'}
          </AppText>
        </View>

        {ticket.unread > 0 ? (
          <View style={[styles.unread, { backgroundColor: theme.colors.danger }]}>
            <AppText variant="caption" color="#FFFFFF">
              {ticket.unread > 9 ? '9+' : ticket.unread}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.bottomRow}>
        <TicketStatusPill status={ticket.status_code} />
        <View style={styles.meta}>
          {open && sla ? (
            <AppText
              variant="caption"
              color={sla.expired ? 'danger' : sla.urgent ? 'warning' : 'textTertiary'}
            >
              {sla.label}
            </AppText>
          ) : (
            <AppText variant="caption" color="textTertiary">
              {formatRelativeTr(ticket.last_message_at ?? ticket.created_at)}
            </AppText>
          )}
          <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 12, borderWidth: StyleSheet.hairlineWidth },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, gap: 3 },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
