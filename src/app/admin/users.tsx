import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText, Avatar, Badge, Button, IconButton } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
  Pager,
} from '@/features/admin/components/AdminPage';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useAdminUser, useAdminUserAction, useAdminUsers } from '@/features/admin/hooks/use-admin';
import type { AdminUser, AdminUserDetail, UserAction } from '@/features/admin/types';
import { formatPrice } from '@/features/marketplace/services/marketplace-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr, formatRelativeTr } from '@/utils/date';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { key: 'all', label: 'Tümü' },
  { key: 'active', label: 'Aktif' },
  { key: 'suspended', label: 'Askıda' },
  { key: 'banned', label: 'Yasaklı' },
  { key: 'restricted', label: 'Kısıtlı' },
  { key: 'deleted', label: 'Silinmiş' },
] as const;

type StatusKey = (typeof STATUS_OPTIONS)[number]['key'];
type VerifyKey = 'all' | 'verified' | 'unverified';

const statusTone = (
  status: AdminUser['status_label'],
): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (status === 'active') return 'success';
  if (status === 'restricted') return 'warning';
  if (status === 'suspended' || status === 'banned') return 'danger';
  return 'neutral';
};

const statusLabel = (status: AdminUser['status_label']) => {
  switch (status) {
    case 'active':
      return 'Aktif';
    case 'suspended':
      return 'Askıda';
    case 'banned':
      return 'Yasaklı';
    case 'restricted':
      return 'Kısıtlı';
    case 'deleted':
      return 'Silinmiş';
    default:
      return status;
  }
};

export default function AdminUsersScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const toast = useAdminToast();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusKey>('all');
  const [verify, setVerify] = useState<VerifyKey>('all');
  const [onlyNew, setOnlyNew] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      query: query.trim() || undefined,
      status: status === 'all' ? null : status,
      verified: verify === 'all' ? null : verify === 'verified',
      onlyNew,
      from: from || null,
      to: to || null,
      limit: PAGE_SIZE,
      offset,
    }),
    [query, status, verify, onlyNew, from, to, offset],
  );

  const users = useAdminUsers(filters);

  const apply = (updater: () => void) => {
    updater();
    setOffset(0);
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'user',
      label: 'Kullanıcı',
      width: 2.2,
      render: (row) => (
        <View style={styles.userCell}>
          <Avatar
            uri={mediaPublicUrl('avatar', row.avatar_path)}
            name={row.display_name}
            size={32}
          />
          <View style={{ minWidth: 0 }}>
            <View style={styles.nameRow}>
              <AppText variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
                {row.display_name || '—'}
              </AppText>
              {row.is_verified ? (
                <Ionicons name="checkmark-circle" size={12} color="#3B82F6" />
              ) : null}
            </View>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              @{row.username}
            </AppText>
          </View>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 0.8,
      render: (row) => (
        <Badge label={statusLabel(row.status_label)} tone={statusTone(row.status_label)} />
      ),
    },
    {
      key: 'content',
      label: 'İçerik',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {row.posts_count} gönderi · {row.reels_count} reels · {row.listings_count} ilan
        </AppText>
      ),
    },
    {
      key: 'audience',
      label: 'Takipçi',
      width: 0.6,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {row.followers_count.toLocaleString('tr-TR')}
        </AppText>
      ),
    },
    {
      key: 'reports',
      label: 'Şikâyet',
      width: 0.5,
      hideOnMobile: true,
      render: (row) =>
        row.report_count > 0 ? (
          <Badge label={String(row.report_count)} tone="danger" />
        ) : (
          <AppText variant="caption" color="textTertiary">
            —
          </AppText>
        ),
    },
    {
      key: 'lastSeen',
      label: 'Son etkinlik',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textTertiary">
          {row.last_seen_at ? formatRelativeTr(row.last_seen_at) : 'Hiç'}
        </AppText>
      ),
    },
    {
      key: 'created',
      label: 'Kayıt',
      width: 0.8,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textTertiary">
          {formatDateTr(row.created_at)}
        </AppText>
      ),
    },
  ];

  return (
    <AdminPage
      title="Kullanıcı Yönetimi"
      subtitle="Hesap durumu, doğrulama, içerik hacmi ve şikâyet geçmişini tek yerden yönetin."
      refreshing={users.isRefetching}
      onRefresh={() => void users.refetch()}
      actions={<Badge label={`${users.data?.total ?? 0} kullanıcı`} tone="neutral" />}
    >
      <AdminSection
        title="Arama ve filtreler"
        subtitle="Kullanıcı ID, ad, kullanıcı adı veya e-posta ile arayın."
      >
        <AdminToolbar>
          <View
            style={[
              styles.searchWrap,
              { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground },
            ]}
          >
            <Ionicons name="search" size={15} color={theme.colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={(value) => apply(() => setQuery(value))}
              placeholder="Ara: @kullanıcı, e-posta, UUID…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.searchInput, { color: theme.colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? (
              <IconButton
                accessibilityLabel="Aramayı temizle"
                name="close-circle"
                size={15}
                onPress={() => apply(() => setQuery(''))}
              />
            ) : null}
          </View>
          <Button
            label={onlyNew ? 'Yeni kayıtlar: açık' : 'Yeni kayıtlar'}
            size="sm"
            variant={onlyNew ? 'primary' : 'outline'}
            fullWidth={false}
            leftIcon={
              <Ionicons
                name="sparkles-outline"
                size={14}
                color={onlyNew ? theme.colors.onPrimary : theme.colors.text}
              />
            }
            onPress={() => apply(() => setOnlyNew((value) => !value))}
          />
        </AdminToolbar>

        <View style={styles.filterGroup}>
          <AppText variant="caption" color="textTertiary">
            Hesap durumu
          </AppText>
          <FilterChips
            options={STATUS_OPTIONS.map((option) => ({ key: option.key, label: option.label }))}
            value={status}
            onChange={(value) => apply(() => setStatus(value))}
          />
        </View>

        <View style={styles.filterGroup}>
          <AppText variant="caption" color="textTertiary">
            Doğrulama
          </AppText>
          <FilterChips
            options={[
              { key: 'all' as const, label: 'Tümü' },
              { key: 'verified' as const, label: 'Doğrulanmış' },
              { key: 'unverified' as const, label: 'Doğrulanmamış' },
            ]}
            value={verify}
            onChange={(value) => apply(() => setVerify(value))}
          />
        </View>

        <View style={styles.dateRow}>
          <DateField
            label="Kayıt başlangıcı"
            value={from}
            onChange={(value) => apply(() => setFrom(value))}
          />
          <DateField
            label="Kayıt bitişi"
            value={to}
            onChange={(value) => apply(() => setTo(value))}
          />
          {from || to || query || onlyNew || status !== 'all' || verify !== 'all' ? (
            <Button
              label="Filtreleri temizle"
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={() =>
                apply(() => {
                  setQuery('');
                  setStatus('all');
                  setVerify('all');
                  setOnlyNew(false);
                  setFrom('');
                  setTo('');
                })
              }
            />
          ) : null}
        </View>
      </AdminSection>

      {users.isError ? (
        <View style={[styles.errorCard, { backgroundColor: theme.colors.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={19} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={{ flex: 1 }}>
            Kullanıcı listesi yüklenemedi. Yetkinizi kontrol edin.
          </AppText>
          <Button
            label="Yenile"
            size="sm"
            variant="outline"
            fullWidth={false}
            onPress={() => void users.refetch()}
          />
        </View>
      ) : null}

      <DataTable
        columns={columns}
        rows={users.data?.items ?? []}
        keyExtractor={(row) => row.id}
        loading={users.isLoading}
        onRowPress={(row) => setSelectedId(row.id)}
        empty={
          <View style={[styles.empty, { borderColor: theme.colors.border }]}>
            <Ionicons name="people-outline" size={22} color={theme.colors.textTertiary} />
            <AppText variant="body" color="textSecondary">
              Bu filtrelerle kullanıcı bulunamadı.
            </AppText>
          </View>
        }
      />

      {users.data ? (
        <Pager
          total={users.data.total}
          limit={users.data.limit}
          offset={users.data.offset}
          onChange={setOffset}
        />
      ) : null}

      <AppText variant="caption" color="textTertiary">
        Şifreler ve kimlik doğrulama sırları hiçbir zaman yönetim panelinde görüntülenmez. Hassas
        işlemler gerekçe ile denetim kaydına yazılır.
      </AppText>

      <UserDrawer
        userId={selectedId}
        onClose={() => setSelectedId(null)}
        onOpenContent={(kind) => {
          setSelectedId(null);
          router.push(`/admin/${kind}` as never);
        }}
        onChanged={(message) => {
          toast.success(message);
          void users.refetch();
        }}
      />
    </AdminPage>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 3 }}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.colors.textTertiary}
        style={[
          styles.dateInput,
          {
            backgroundColor: theme.colors.inputBackground,
            borderColor: theme.colors.border,
            color: theme.colors.text,
          },
        ]}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

type ActionKey = UserAction | null;

function UserDrawer({
  userId,
  onClose,
  onChanged,
  onOpenContent,
}: {
  userId: string | null;
  onClose: () => void;
  onChanged: (message: string) => void;
  onOpenContent: (kind: 'posts' | 'reels' | 'marketplace' | 'reports') => void;
}) {
  const { theme } = useTheme();
  const user = useAdminUser(userId);
  const action = useAdminUserAction();
  const toast = useAdminToast();
  const [pending, setPending] = useState<ActionKey>(null);
  const [days, setDays] = useState(7);

  return (
    <>
      <Modal visible={Boolean(userId)} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={onClose}
          />
          <View
            style={[
              styles.drawer,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View style={[styles.drawerHead, { borderColor: theme.colors.divider }]}>
              <AppText variant="h3">Kullanıcı dosyası</AppText>
              <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
            </View>

            {user.isLoading ? (
              <View style={styles.drawerLoading}>
                <ActivityIndicator color={theme.colors.primary} />
                <AppText variant="caption" color="textTertiary">
                  Profil yükleniyor…
                </AppText>
              </View>
            ) : user.isError || !user.data ? (
              <View style={styles.drawerLoading}>
                <Ionicons name="alert-circle-outline" size={22} color={theme.colors.danger} />
                <AppText variant="caption" color="danger">
                  Kullanıcı ayrıntısı yüklenemedi.
                </AppText>
                <Button
                  label="Yenile"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => void user.refetch()}
                />
              </View>
            ) : (
              <UserDetailBody
                detail={user.data}
                busy={action.isPending}
                onAction={(next) => {
                  setDays(7);
                  setPending(next);
                }}
                onOpenContent={onOpenContent}
              />
            )}
          </View>
        </View>
      </Modal>

      <ReasonDialogBridge
        open={pending}
        userId={userId}
        detail={user.data}
        days={days}
        setDays={setDays}
        loading={action.isPending}
        onCancel={() => setPending(null)}
        onConfirm={async ({ reason }) => {
          if (!pending || !userId) return;
          try {
            await action.mutateAsync({
              userId,
              action: pending,
              reason,
              days: pending === 'suspend' ? days : null,
            });
            setPending(null);
            onChanged(
              pending === 'suspend'
                ? `Hesap ${days} gün süreyle askıya alındı.`
                : pending === 'ban'
                  ? 'Hesap kalıcı olarak kapatıldı.'
                  : 'İşlem tamamlandı ve denetim kaydına yazıldı.',
            );
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
          }
        }}
      />
    </>
  );
}

function ReasonDialogBridge({
  open,
  detail,
  days,
  setDays,
  onCancel,
  onConfirm,
  loading,
}: {
  open: ActionKey;
  userId: string | null;
  detail: AdminUserDetail | undefined;
  days: number;
  setDays: (value: number) => void;
  onCancel: () => void;
  onConfirm: (input: { reason: string; amountCents: number | null }) => void;
  loading: boolean;
}) {
  const { theme } = useTheme();
  const labels: Record<
    Exclude<ActionKey, null>,
    { title: string; description: string; confirm: string; danger: boolean }
  > = {
    warn: {
      title: 'Kullanıcıya uyarı gönder',
      description: 'Uyarı kullanıcıya bildirim olarak iletilir ve hesap geçmişine işlenir.',
      confirm: 'Uyarı gönder',
      danger: false,
    },
    suspend: {
      title: 'Hesabı geçici olarak askıya al',
      description: 'Seçilen süre boyunca hesap oturumları kısıtlanır; kullanıcı bilgilendirilir.',
      confirm: 'Askıya al',
      danger: true,
    },
    ban: {
      title: 'Kalıcı hesap yasağı',
      description:
        'Hesap kalıcı olarak kapatılır. Bu işlem geri alınabilir ancak denetim kaydı kalır.',
      confirm: 'Kalıcı olarak kapat',
      danger: true,
    },
    restrict: {
      title: 'Hesabı kısıtla',
      description: 'Hesap açık kalır; bazı yayınlama ve etkileşim özellikleri kısıtlanır.',
      confirm: 'Kısıtla',
      danger: true,
    },
    reactivate: {
      title: 'Hesabı yeniden etkinleştir',
      description: 'Askı ve kısıtlamalar kaldırılır, hesap normal duruma döner.',
      confirm: 'Etkinleştir',
      danger: false,
    },
    verify: {
      title: 'Kullanıcıyı doğrula',
      description: 'Mavi doğrulama rozeti eklenir. Doğrulama politikasına uygunluğu teyit edin.',
      confirm: 'Doğrula',
      danger: false,
    },
    unverify: {
      title: 'Doğrulamayı kaldır',
      description: 'Kullanıcının doğrulama rozeti kaldırılır.',
      confirm: 'Kaldır',
      danger: true,
    },
    remove_avatar: {
      title: 'Profil görselini kaldır',
      description: 'Uygunsuz profil görseli kaldırılır ve kullanıcı bilgilendirilir.',
      confirm: 'Görseli kaldır',
      danger: true,
    },
    request_deletion: {
      title: 'Hesap silme süreci başlat',
      description: '30 günlük silme takvimi başlatılır. Yasal saklama yükümlülükleri korunur.',
      confirm: 'Süreci başlat',
      danger: true,
    },
    restore_deleted: {
      title: 'Hesabı geri yükle',
      description: 'Silme süreci iptal edilir ve hesap yeniden etkinleştirilir.',
      confirm: 'Geri yükle',
      danger: false,
    },
  };

  const config = open ? labels[open] : null;
  const requiresReason = open ? !['reactivate', 'verify', 'unverify'].includes(open) : true;

  return (
    <ReasonDialog
      visible={Boolean(open)}
      title={config?.title ?? ''}
      description={
        open === 'suspend' && detail
          ? `${detail.profile.display_name} (@${detail.profile.username}) için süre seçin.`
          : config?.description
      }
      confirmLabel={config?.confirm}
      destructive={config?.danger}
      requireReason={requiresReason}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      extra={
        open === 'suspend' ? (
          <View style={{ gap: 6 }}>
            <AppText variant="caption" color="textTertiary">
              Askı süresi
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[1, 7, 30, 90, 365].map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  onPress={() => setDays(option)}
                  style={{
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: option === days ? theme.colors.primary : theme.colors.border,
                    backgroundColor: option === days ? theme.colors.primarySoft : 'transparent',
                  }}
                >
                  <AppText
                    variant="caption"
                    color={option === days ? 'primaryDeep' : 'textSecondary'}
                  >
                    {option} gün
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null
      }
    />
  );
}

function UserDetailBody({
  detail,
  busy,
  onAction,
  onOpenContent,
}: {
  detail: AdminUserDetail;
  busy: boolean;
  onAction: (action: Exclude<ActionKey, null>) => void;
  onOpenContent: (kind: 'posts' | 'reels' | 'marketplace' | 'reports') => void;
}) {
  const { theme } = useTheme();
  const profile = detail.profile;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.drawerContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.profileHead}>
        <Avatar
          uri={mediaPublicUrl('avatar', profile.avatar_path)}
          name={profile.display_name}
          size={56}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.nameRow}>
            <AppText variant="h3">{profile.display_name || profile.username}</AppText>
            {profile.is_verified ? (
              <Ionicons name="checkmark-circle" size={16} color="#3B82F6" />
            ) : null}
          </View>
          <AppText variant="caption" color="textSecondary">
            @{profile.username} · {profile.email ?? 'e-posta yok'}
          </AppText>
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
            <Badge
              label={statusLabel(profile.account_status as AdminUser['status_label'])}
              tone={statusTone(profile.account_status as AdminUser['status_label'])}
            />
            {profile.country_code ? <Badge label={profile.country_code} tone="neutral" /> : null}
            {profile.city ? <Badge label={profile.city} tone="neutral" /> : null}
          </View>
        </View>
      </View>

      <View style={styles.metaGrid}>
        <Meta label="Kullanıcı ID" value={profile.id} mono />
        <Meta label="Kayıt" value={formatDateTr(profile.created_at)} />
        <Meta label="Son görülme" value={formatRelativeTr(profile.last_seen_at) || '—'} />
        <Meta
          label="Takipçi / takip"
          value={`${profile.followers_count} / ${profile.following_count}`}
        />
        <Meta label="Uyarı" value={String(profile.warning_count)} />
        <Meta
          label="Askı bitişi"
          value={profile.suspended_until ? formatDateTr(profile.suspended_until) : '—'}
        />
      </View>

      <View style={styles.countRow}>
        <Count label="Gönderi" value={detail.counts.posts} />
        <Count label="Reels" value={detail.counts.reels} />
        <Count label="Hikâye" value={detail.counts.stories} />
        <Count label="İlan" value={detail.counts.listings} />
        <Count label="Şikâyet" value={detail.counts.reports_against} />
        <Count label="Destek" value={detail.counts.tickets} />
      </View>

      {profile.bio ? (
        <View style={[styles.bio, { backgroundColor: theme.colors.surfaceMuted }]}>
          <AppText variant="caption" color="textSecondary">
            {profile.bio}
          </AppText>
        </View>
      ) : null}

      <View style={styles.actionGrid}>
        <ActionButton
          icon="checkmark-circle-outline"
          label={profile.is_verified ? 'Doğrulamayı kaldır' : 'Kullanıcıyı doğrula'}
          tone="primary"
          disabled={busy}
          onPress={() => onAction(profile.is_verified ? 'unverify' : 'verify')}
        />
        <ActionButton
          icon="warning-outline"
          label="Uyarı gönder"
          tone="warning"
          disabled={busy}
          onPress={() => onAction('warn')}
        />
        <ActionButton
          icon="pause-circle-outline"
          label="Askıya al"
          tone="warning"
          disabled={busy}
          onPress={() => onAction('suspend')}
        />
        <ActionButton
          icon="remove-circle-outline"
          label="Kısıtla"
          tone="warning"
          disabled={busy}
          onPress={() => onAction('restrict')}
        />
        <ActionButton
          icon="ban-outline"
          label="Kalıcı yasak"
          tone="danger"
          disabled={busy}
          onPress={() => onAction('ban')}
        />
        <ActionButton
          icon="play-circle-outline"
          label="Yeniden etkinleştir"
          tone="success"
          disabled={busy}
          onPress={() => onAction('reactivate')}
        />
        <ActionButton
          icon="image-outline"
          label="Profil görselini kaldır"
          tone="danger"
          disabled={busy}
          onPress={() => onAction('remove_avatar')}
        />
        <ActionButton
          icon="trash-outline"
          label={profile.deletion_requested_at ? 'Silme sürecini geri al' : 'Silme süreci başlat'}
          tone="danger"
          disabled={busy}
          onPress={() =>
            onAction(profile.deletion_requested_at ? 'restore_deleted' : 'request_deletion')
          }
        />
      </View>

      <View style={styles.quickLinks}>
        <QuickLink label="Gönderileri incele" onPress={() => onOpenContent('posts')} />
        <QuickLink label="Reels incele" onPress={() => onOpenContent('reels')} />
        <QuickLink label="İlanları incele" onPress={() => onOpenContent('marketplace')} />
        <QuickLink label="Şikâyet geçmişi" onPress={() => onOpenContent('reports')} />
      </View>

      <DrawerSection title="Son gönderiler">
        {detail.recent_posts.length === 0 ? (
          <EmptyLine text="Gönderi yok." />
        ) : (
          detail.recent_posts.map((post) => (
            <View key={post.id} style={[styles.listRow, { borderColor: theme.colors.divider }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" numberOfLines={2}>
                  {post.body || '(medya gönderisi)'}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {formatDateTr(post.created_at)} · {post.like_count} beğeni · {post.comment_count}{' '}
                  yorum
                </AppText>
              </View>
              <Badge
                label={post.moderation_status}
                tone={post.moderation_status === 'visible' ? 'success' : 'warning'}
              />
            </View>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Son Reels">
        {detail.recent_reels.length === 0 ? (
          <EmptyLine text="Reels yok." />
        ) : (
          detail.recent_reels.map((reel) => (
            <View key={reel.id} style={[styles.listRow, { borderColor: theme.colors.divider }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" numberOfLines={1}>
                  {reel.caption || '(açıklamasız)'}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {formatDateTr(reel.created_at)} · {reel.view_count} izlenme
                </AppText>
              </View>
              <Badge label={reel.moderation_status} tone="neutral" />
            </View>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Son ilanlar">
        {detail.recent_listings.length === 0 ? (
          <EmptyLine text="İlan yok." />
        ) : (
          detail.recent_listings.map((listing) => (
            <View key={listing.id} style={[styles.listRow, { borderColor: theme.colors.divider }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" numberOfLines={1}>
                  {listing.title}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {formatPrice(listing.price_cents, listing.currency)} ·{' '}
                  {formatDateTr(listing.created_at)}
                </AppText>
              </View>
              <Badge label={listing.status} tone="neutral" />
            </View>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Şikâyet geçmişi">
        {detail.recent_reports.length === 0 ? (
          <EmptyLine text="Şikâyet yok." />
        ) : (
          detail.recent_reports.map((report) => (
            <View key={report.id} style={[styles.listRow, { borderColor: theme.colors.divider }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption">{report.report_no}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {report.target_type} · {report.reason_category} ·{' '}
                  {formatDateTr(report.created_at)}
                </AppText>
              </View>
              <Badge
                label={report.priority}
                tone={
                  report.priority === 'critical'
                    ? 'danger'
                    : report.status_code === 'resolved'
                      ? 'success'
                      : 'warning'
                }
              />
            </View>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Son yönetici işlemleri">
        {detail.recent_actions.length === 0 ? (
          <EmptyLine text="Kayıt yok." />
        ) : (
          detail.recent_actions.map((entry) => (
            <View
              key={String(entry.id)}
              style={[styles.listRow, { borderColor: theme.colors.divider }]}
            >
              <View style={{ flex: 1 }}>
                <AppText variant="caption">{entry.action_label}</AppText>
                <AppText variant="caption" color="textTertiary">
                  {entry.actor_name ?? 'Sistem'} · {formatDateTr(entry.created_at)}
                </AppText>
              </View>
            </View>
          ))
        )}
      </DrawerSection>

      <AppText variant="caption" color="textTertiary">
        E-posta ve IP gibi kişisel veriler yalnızca yetkili personele, işlem amacıyla gösterilir.
        Mesaj içerikleri bu dosyada yer almaz.
      </AppText>
    </ScrollView>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.meta}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText
        variant="caption"
        numberOfLines={2}
        style={{ fontWeight: '600', fontFamily: mono ? 'monospace' : undefined }}
      >
        {value}
      </AppText>
    </View>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.count, { backgroundColor: theme.colors.surfaceMuted }]}>
      <AppText variant="bodyStrong">{value}</AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  tone,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  tone: 'primary' | 'warning' | 'danger' | 'success';
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const color =
    tone === 'danger'
      ? theme.colors.danger
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'success'
          ? theme.colors.success
          : theme.colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={color} />
      <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function QuickLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickLink,
        {
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.primarySoft : 'transparent',
        },
      ]}
    >
      <AppText variant="caption" color="primaryDeep">
        {label}
      </AppText>
      <Ionicons name="arrow-forward" size={12} color={theme.colors.primaryDeep} />
    </Pressable>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.drawerSection}>
      <AppText variant="bodyStrong">{title}</AppText>
      <View>{children}</View>
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <AppText variant="caption" color="textTertiary">
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  userCell: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  searchWrap: {
    flexGrow: 1,
    flexBasis: 260,
    height: 38,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    minWidth: 220,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 6, outlineStyle: 'none' } as never,
  filterGroup: { gap: 5 },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' },
  dateInput: {
    height: 35,
    minWidth: 130,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    fontSize: 12,
    outlineStyle: 'none',
  } as never,
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 10 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  modalRoot: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  drawer: {
    width: '100%',
    maxWidth: 620,
    height: '100%',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  drawerHead: {
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  drawerLoading: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40 },
  drawerContent: { padding: 14, gap: 12, paddingBottom: 40 },
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meta: {
    minWidth: 130,
    flexGrow: 1,
    flexBasis: 140,
    gap: 1,
  },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  count: {
    flexGrow: 1,
    flexBasis: 76,
    borderRadius: 9,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 0,
  },
  bio: { borderRadius: 9, padding: 9 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionButton: {
    flexGrow: 1,
    flexBasis: 160,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
  },
  quickLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  drawerSection: { gap: 5 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
