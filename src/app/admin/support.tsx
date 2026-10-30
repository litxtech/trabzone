import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
} from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_MAP, TICKET_STATUS } from '@/features/safety/constants';
import { useAdminTickets } from '@/features/safety/hooks/use-safety';
import type { AdminTicket, TicketStatusCode } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatRelativeTr, formatSlaRemaining } from '@/utils/date';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

type Filter = 'all' | TicketStatusCode;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'received', label: 'Alındı' },
  { key: 'under_review', label: 'İnceleniyor' },
  { key: 'awaiting_user', label: 'Yanıt bekleniyor' },
  { key: 'priority_review', label: 'Öncelikli' },
  { key: 'resolved', label: 'Çözüldü' },
];

const ASSIGN_OPTIONS: { key: 'all' | 'me' | 'unassigned'; label: string }[] = [
  { key: 'all', label: 'Tüm atamalar' },
  { key: 'me', label: 'Bende' },
  { key: 'unassigned', label: 'Atanmamış' },
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

  const tickets = useMemo(() => data?.items ?? [], [data]);
  const stats = useMemo(() => {
    const overdue = tickets.filter((ticket) => ticket.overdue).length;
    const unread = tickets.reduce((sum, ticket) => sum + (ticket.unread ?? 0), 0);
    const child = tickets.filter((ticket) => ticket.category_code === 'child_safety').length;
    const unassigned = tickets.filter((ticket) => !ticket.assignee_name).length;
    return { overdue, unread, child, unassigned };
  }, [tickets]);

  const columns: Column<AdminTicket>[] = [
    {
      key: 'ticket',
      label: 'Talep',
      width: 2,
      render: (row) => {
        const categoryMeta = SUPPORT_CATEGORY_MAP[row.category_code];
        return (
          <View style={styles.ticketCell}>
            <View
              style={[
                styles.ticketIcon,
                {
                  backgroundColor:
                    row.category_code === 'child_safety'
                      ? theme.colors.dangerSoft
                      : theme.colors.primarySoft,
                },
              ]}
            >
              <Ionicons
                name={categoryMeta?.icon ?? 'help-circle-outline'}
                size={15}
                color={row.category_code === 'child_safety' ? theme.colors.danger : theme.colors.primaryDeep}
              />
            </View>
            <View style={{ gap: 1, flex: 1 }}>
              <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
                {row.subject}
              </AppText>
              <AppText variant="caption" color="textTertiary" style={{ fontFamily: 'monospace' }} numberOfLines={1}>
                {row.ticket_no} · {formatRelativeTr(row.created_at)}
              </AppText>
            </View>
          </View>
        );
      },
    },
    {
      key: 'category',
      label: 'Kategori',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <Badge label={SUPPORT_CATEGORY_MAP[row.category_code]?.label ?? row.category_code} tone="neutral" />
      ),
    },
    {
      key: 'requester',
      label: 'Kullanıcı',
      width: 1,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {row.user_name ?? 'Kullanıcı'}
        </AppText>
      ),
    },
    {
      key: 'assignee',
      label: 'Atanan',
      width: 0.9,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <AppText variant="caption" color={row.assignee_name ? 'textSecondary' : 'textTertiary'} numberOfLines={1}>
            {row.assignee_name ?? 'Atanmamış'}
          </AppText>
          {row.unread > 0 ? <Badge label={`${row.unread} yeni`} tone="primary" /> : null}
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 1,
      render: (row) => {
        const meta = TICKET_STATUS[row.status_code];
        return (
          <View style={{ gap: 2, alignItems: 'flex-start' }}>
            <Badge label={meta?.label ?? row.status_code} tone={meta?.tone ?? 'neutral'} />
            {row.priority !== 'normal' ? (
              <Badge
                label={row.priority === 'urgent' ? 'Acil' : 'Yüksek'}
                tone={row.priority === 'urgent' ? 'danger' : 'warning'}
              />
            ) : null}
          </View>
        );
      },
    },
    {
      key: 'sla',
      label: 'SLA',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => {
        const sla = formatSlaRemaining(row.sla_due_at);
        return (
          <AppText
            variant="caption"
            color={sla?.expired ? 'danger' : sla?.urgent ? 'warning' : 'textSecondary'}
          >
            {sla?.label ?? 'Süre yok'}
          </AppText>
        );
      },
    },
    {
      key: 'action',
      label: '',
      width: 0.7,
      render: (row) => (
        <Button
          label="Yanıtla"
          size="sm"
          variant="secondary"
          fullWidth={false}
          onPress={() => router.push(`/admin/ticket/${row.id}`)}
        />
      ),
    },
  ];

  return (
    <AdminPage
      title="Destek talepleri"
      subtitle="Destek kuyruğu. SLA hedefi normal taleplerde 24 saat, çocuk güvenliği taleplerinde 30 dakikadır."
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
      actions={
        <Button
          label="Yanıt şablonları"
          size="sm"
          variant="secondary"
          fullWidth={false}
          leftIcon={<Ionicons name="chatbox-ellipses-outline" size={15} color={theme.colors.textSecondary} />}
          onPress={() => router.push('/admin/support-templates')}
        />
      }
    >
      <StatGrid>
        <StatCard label="Kuyruk" value={String(data?.total ?? 0)} icon="headset-outline" hint="Seçili filtre" />
        <StatCard label="Gecikmiş" value={String(stats.overdue)} icon="time-outline" tone={stats.overdue ? 'danger' : 'success'} hint={`${stats.unassigned} atanmamış`} />
        <StatCard label="Okunmamış" value={String(stats.unread)} icon="mail-unread-outline" tone={stats.unread ? 'warning' : 'success'} hint="Yeni kullanıcı mesajı" />
        <StatCard label="Çocuk güvenliği" value={String(stats.child)} icon="shield-half-outline" tone={stats.child ? 'danger' : 'success'} hint="30 dk SLA" />
      </StatGrid>

      <AdminSection
        title="Kuyruk"
        subtitle="Talep numarası, konu veya kullanıcı adıyla arayabilirsin."
        action={<Badge label={`${tickets.length} kayıt`} tone="primary" />}
      >
        <AdminToolbar>
          <View style={styles.searchWrap}>
            <TextField
              placeholder="Talep no, konu veya kullanıcı ara"
              value={search}
              onChangeText={setSearch}
              leftIcon="search-outline"
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
        </AdminToolbar>
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
        <FilterChips options={ASSIGN_OPTIONS} value={assigned} onChange={setAssigned} />
        <View style={styles.categoryRow}>
          <Button
            label="Kategori: tümü"
            size="sm"
            variant={category === null ? 'primary' : 'outline'}
            fullWidth={false}
            onPress={() => setCategory(null)}
          />
          {SUPPORT_CATEGORIES.slice(0, 6).map((item) => (
            <Button
              key={item.code}
              label={item.label}
              size="sm"
              variant={category === item.code ? 'primary' : 'outline'}
              fullWidth={false}
              onPress={() => setCategory(category === item.code ? null : item.code)}
            />
          ))}
        </View>
        <DataTable
          columns={columns}
          rows={tickets}
          keyExtractor={(row) => row.id}
          loading={isLoading}
          empty={
            <View style={styles.empty}>
              <Ionicons
                name={isError ? 'cloud-offline-outline' : 'checkmark-done-outline'}
                size={22}
                color={isError ? theme.colors.danger : theme.colors.success}
              />
              <AppText variant="caption" color="textSecondary">
                {isError
                  ? 'Kuyruk yüklenemedi. Yetkin olduğundan emin ol ve tekrar dene.'
                  : 'Bu filtrede talep yok.'}
              </AppText>
              {isError ? (
                <Button label="Tekrar dene" size="sm" variant="secondary" fullWidth={false} onPress={() => void refetch()} />
              ) : null}
            </View>
          }
        />
      </AdminSection>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  searchWrap: { flex: 1, minWidth: 240, maxWidth: 440 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  ticketCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 30 },
});
