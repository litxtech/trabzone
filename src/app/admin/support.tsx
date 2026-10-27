import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Card, TextField } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { TicketStatusPill } from '@/features/safety/components/StatusPill';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_MAP,
  TICKET_STATUS,
} from '@/features/safety/constants';
import { useAdminTickets } from '@/features/safety/hooks/use-safety';
import type { TicketStatusCode } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr, formatSlaRemaining } from '@/utils/date';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

type Filter = 'all' | TicketStatusCode;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'received', label: 'Alındı' },
  { key: 'under_review', label: 'İnceleniyor' },
  { key: 'awaiting_user', label: 'Yanıt bekleniyor' },
  { key: 'info_required', label: 'Bilgi gerekli' },
  { key: 'priority_review', label: 'Öncelikli' },
  { key: 'resolved', label: 'Çözüldü' },
];

export default function AdminSupportQueueScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [assigned, setAssigned] = useState<'all' | 'me' | 'unassigned'>('all');

  const debouncedSearch = useDebouncedValue(search, 350);

  const { data, isLoading, isError, refetch, isRefetching } = useAdminTickets({
    status: filter === 'all' ? null : filter,
    category,
    search: debouncedSearch,
    assigned,
  });

  const tickets = data?.items ?? [];
  const overdue = tickets.filter((ticket) => ticket.overdue).length;

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Destek talepleri"
        subtitle={`${data?.total ?? 0} kayıt${overdue > 0 ? ` · ${overdue} gecikmiş` : ''}`}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yenile"
            onPress={() => void refetch()}
            style={styles.refresh}
          >
            {isRefetching ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Ionicons name="refresh-outline" size={19} color={theme.colors.textSecondary} />
            )}
          </Pressable>
        }
      />

      <TextField
        placeholder="Talep no, konu veya kullanıcı ara"
        value={search}
        onChangeText={setSearch}
        leftIcon="search-outline"
        autoCorrect={false}
        autoCapitalize="none"
      />

      <View style={styles.filters}>
        {FILTERS.map((item) => {
          const active = filter === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(item.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                  borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.filters}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: assigned === 'all' }}
          onPress={() => setAssigned('all')}
          style={[
            styles.chip,
            {
              backgroundColor: assigned === 'all' ? theme.colors.accentSoft : theme.colors.surface,
              borderColor: assigned === 'all' ? theme.colors.accent : theme.colors.border,
            },
          ]}
        >
          <AppText variant="caption" color={assigned === 'all' ? 'accent' : 'textSecondary'}>
            Atama: Tümü
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: assigned === 'me' }}
          onPress={() => setAssigned('me')}
          style={[
            styles.chip,
            {
              backgroundColor: assigned === 'me' ? theme.colors.accentSoft : theme.colors.surface,
              borderColor: assigned === 'me' ? theme.colors.accent : theme.colors.border,
            },
          ]}
        >
          <AppText variant="caption" color={assigned === 'me' ? 'accent' : 'textSecondary'}>
            Bende
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: assigned === 'unassigned' }}
          onPress={() => setAssigned('unassigned')}
          style={[
            styles.chip,
            {
              backgroundColor:
                assigned === 'unassigned' ? theme.colors.accentSoft : theme.colors.surface,
              borderColor: assigned === 'unassigned' ? theme.colors.accent : theme.colors.border,
            },
          ]}
        >
          <AppText variant="caption" color={assigned === 'unassigned' ? 'accent' : 'textSecondary'}>
            Atanmamış
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kategori filtresini temizle"
          onPress={() => setCategory(null)}
          style={[
            styles.chip,
            {
              backgroundColor: category ? theme.colors.primarySoft : theme.colors.surface,
              borderColor: category ? theme.colors.primary : theme.colors.border,
            },
          ]}
        >
          <AppText variant="caption" color={category ? 'primaryDeep' : 'textSecondary'}>
            {category ? SUPPORT_CATEGORY_MAP[category as keyof typeof SUPPORT_CATEGORY_MAP]?.label : 'Kategori'}
          </AppText>
          {category ? <Ionicons name="close" size={12} color={theme.colors.primaryDeep} /> : null}
        </Pressable>
      </View>

      <View style={styles.categoryRow}>
        {SUPPORT_CATEGORIES.filter((item) =>
          filter === 'all' ? ['child_safety', 'account_access', 'technical'].includes(item.code) : true,
        )
          .slice(0, 6)
          .map((item) => {
            const active = category === item.code;
            return (
              <Pressable
                key={item.code}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setCategory(active ? null : item.code)}
                style={[
                  styles.miniChip,
                  {
                    backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surfaceMuted,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : isError ? (
        <SafetyEmptyState
          icon="cloud-offline-outline"
          title="Kuyruk yüklenemedi"
          body="Yetkin olduğundan emin ol ve tekrar dene."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      ) : tickets.length === 0 ? (
        <SafetyEmptyState
          icon="checkmark-done-outline"
          title="Bu filtrede talep yok"
          body="Farklı bir durum veya kategori seçebilirsin."
        />
      ) : (
        <View style={styles.list}>
          {tickets.map((ticket) => {
            const sla = formatSlaRemaining(ticket.sla_due_at);
            const categoryMeta = SUPPORT_CATEGORY_MAP[ticket.category_code];
            const isChild = ticket.category_code === 'child_safety';
            return (
              <Pressable
                key={ticket.id}
                accessibilityRole="button"
                accessibilityLabel={`${ticket.ticket_no} ${ticket.subject}`}
                onPress={() => router.push(`/admin/ticket/${ticket.id}`)}
                style={({ pressed }) => [
                  styles.ticket,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: ticket.overdue
                      ? theme.colors.danger
                      : isChild
                        ? theme.colors.warning
                        : theme.colors.border,
                    borderRadius: theme.radius.md,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={styles.ticketHead}>
                  <View
                    style={[
                      styles.ticketIcon,
                      {
                        backgroundColor: isChild ? theme.colors.dangerSoft : theme.colors.primarySoft,
                      },
                    ]}
                  >
                    <Ionicons
                      name={categoryMeta?.icon ?? 'help-circle-outline'}
                      size={17}
                      color={isChild ? theme.colors.danger : theme.colors.primaryDeep}
                    />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {ticket.subject}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {ticket.ticket_no} · {ticket.user_name ?? 'Kullanıcı'} ·{' '}
                      {formatRelativeTr(ticket.created_at)}
                    </AppText>
                  </View>
                  <TicketStatusPill status={ticket.status_code} />
                </View>

                <View style={styles.ticketFoot}>
                  <View style={styles.badgeRow}>
                    {ticket.priority !== 'normal' ? (
                      <Badge
                        label={ticket.priority === 'urgent' ? 'Acil' : 'Yüksek'}
                        tone={ticket.priority === 'urgent' ? 'danger' : 'warning'}
                      />
                    ) : null}
                    {ticket.assignee_name ? (
                      <Badge label={ticket.assignee_name} tone="neutral" />
                    ) : (
                      <Badge label="Atanmamış" tone="neutral" />
                    )}
                  </View>
                  {sla ? (
                    <AppText
                      variant="caption"
                      color={sla.expired ? 'danger' : sla.urgent ? 'warning' : 'textTertiary'}
                    >
                      {sla.label}
                    </AppText>
                  ) : null}
                </View>

                <AppText variant="caption" color="textTertiary">
                  {TICKET_STATUS[ticket.status_code]?.hint ?? ''}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      )}

      <Card tone="muted" elevated={false} style={styles.legend}>
        <AppText variant="caption" color="textSecondary">
          Destek hedefi: normal talepler 24 saat, çocuk güvenliği talepleri 30 dakika. Gecikmiş
          talepler kırmızı çerçeveyle işaretlenir.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  refresh: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  miniChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  list: { gap: 9, marginTop: 14 },
  ticket: { padding: 12, gap: 8, borderWidth: 1 },
  ticketHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ticketIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  ticketFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, flex: 1 },
  center: { alignItems: 'center', paddingVertical: 40 },
  legend: { marginTop: 16, padding: 12 },
});
