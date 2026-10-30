import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText, Badge, Button, IconButton } from '@/components/ui';
import {
  AdminPage,
  AdminSection,
  AdminToolbar,
  FilterChips,
  Pager,
} from '@/features/admin/components/AdminPage';
import { MediaThumb, PersonCell } from '@/features/admin/components/Media';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminLiveNews,
  useAdminLiveNewsAction,
  useAdminLiveNewsDetail,
  useAdminLiveNewsStats,
} from '@/features/live-news/hooks/use-live-news';
import {
  LIVE_NEWS_CATEGORIES,
  LIVE_NEWS_VERIFICATION_LABELS,
  categoryLabel,
} from '@/features/live-news/services/live-news-service';
import type {
  AdminLiveNewsListItem,
  AdminLiveNewsState,
  LiveNewsVerificationStatus,
} from '@/features/live-news/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr, formatRelativeTr } from '@/utils/date';

const PAGE_SIZE = 20;

const STATE_FILTERS: { key: AdminLiveNewsState; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'pending', label: 'Bekleyen' },
  { key: 'visible', label: 'Görünür' },
  { key: 'reviewing', label: 'İnceleniyor' },
  { key: 'verified', label: 'Doğrulanan' },
  { key: 'reported', label: 'Şikâyet' },
  { key: 'newsroom', label: 'Haber Merkezi' },
  { key: 'hidden', label: 'Gizli' },
  { key: 'removed', label: 'Kaldırılan' },
];

function moderationTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'visible') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'hidden') return 'warning';
  if (status === 'removed') return 'danger';
  return 'neutral';
}

function moderationLabel(status: string): string {
  if (status === 'visible') return 'Görünür';
  if (status === 'pending') return 'Bekliyor';
  if (status === 'hidden') return 'Gizli';
  if (status === 'removed') return 'Kaldırıldı';
  return status;
}

function verificationTone(status: string): 'success' | 'warning' | 'danger' | 'accent' | 'neutral' {
  if (status === 'verified') return 'success';
  if (status === 'reviewing') return 'warning';
  if (status === 'corrected') return 'accent';
  if (status === 'unverified') return 'danger';
  if (status === 'removed') return 'danger';
  return 'neutral';
}

export default function AdminLiveNewsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<AdminLiveNewsState>('pending');
  const [category, setCategory] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stats = useAdminLiveNewsStats();
  const list = useAdminLiveNews({
    state,
    category: category === 'all' ? null : (category as never),
    query: query.trim() || null,
    limit: PAGE_SIZE,
    offset,
  });

  const statItems = useMemo(
    () => [
      { key: 'pending', label: 'Bekleyen', value: stats.data?.pending ?? 0, tone: 'warning' as const },
      { key: 'today', label: 'Bugün', value: stats.data?.today ?? 0, tone: 'accent' as const },
      { key: 'visible', label: 'Yayında', value: stats.data?.visible ?? 0, tone: 'success' as const },
      { key: 'verified', label: 'Doğrulanan', value: stats.data?.verified ?? 0, tone: 'success' as const },
      { key: 'reported', label: 'Şikâyet', value: stats.data?.reported ?? 0, tone: 'danger' as const },
      { key: 'newsroom', label: 'Havuz', value: stats.data?.newsroom ?? 0, tone: 'neutral' as const },
    ],
    [stats.data],
  );

  return (
    <AdminPage
      title="Anlık Haber Yönetimi"
      subtitle="Vatandaş gelişmelerini doğrula, moderasyon uygula ve haber merkezine aktar."
      refreshing={list.isRefetching || stats.isRefetching}
      onRefresh={() => {
        void list.refetch();
        void stats.refetch();
      }}
      actions={<Badge label={`${list.data?.total ?? 0} kayıt`} tone="neutral" />}
    >
      <View style={styles.statRow}>
        {statItems.map((item) => (
          <View
            key={item.key}
            style={[
              styles.statCard,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Badge label={item.label} tone={item.tone} />
            <AppText variant="h3">{item.value}</AppText>
          </View>
        ))}
      </View>

      <AdminSection
        title="Vatandaş Haber Havuzu"
        subtitle="Başlık, kullanıcı adı veya açıklama ile arayın."
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
              onChangeText={(value) => {
                setQuery(value);
                setOffset(0);
              }}
              placeholder="Başlık, kullanıcı adı…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.searchInput, { color: theme.colors.text }]}
            />
          </View>
        </AdminToolbar>
        <FilterChips options={STATE_FILTERS} value={state} onChange={(value) => {
          setState(value);
          setOffset(0);
        }} />
        <FilterChips
          options={[
            { key: 'all', label: 'Tüm kategoriler' },
            ...LIVE_NEWS_CATEGORIES.map((item) => ({ key: item.key, label: item.label })),
          ]}
          value={category}
          onChange={(value) => {
            setCategory(value);
            setOffset(0);
          }}
        />
      </AdminSection>

      {list.isLoading ? (
        <ActivityIndicator color={theme.colors.primary} style={styles.loader} />
      ) : list.isError ? (
        <AppText variant="body" color="danger" align="center">
          Liste yüklenemedi. Bağlantını kontrol edip tekrar dene.
        </AppText>
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <View style={[styles.empty, { borderColor: theme.colors.border }]}>
          <Ionicons name="radio-outline" size={24} color={theme.colors.textTertiary} />
          <AppText variant="body" color="textSecondary">
            Bu filtrede anlık haber bulunamadı.
          </AppText>
        </View>
      ) : (
        <View style={styles.list}>
          {list.data?.items.map((item) => (
            <AdminLiveNewsRow key={item.post_id} item={item} onPress={() => setSelectedId(item.post_id)} />
          ))}
        </View>
      )}

      {list.data ? (
        <Pager total={list.data.total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
      ) : null}

      <AppText variant="caption" color="textTertiary">
        Tüm doğrulama ve moderasyon işlemleri denetim kaydına yazılır. “Doğrulandı” rozeti yalnızca
        editör doğrulamasıyla verilir; AI veya beğeni sayısı tek başına yeterli değildir.
      </AppText>

      <AdminLiveNewsDrawer
        postId={selectedId}
        onClose={() => setSelectedId(null)}
        onDone={(message) => {
          toast.success(message);
          void list.refetch();
          void stats.refetch();
        }}
      />
    </AdminPage>
  );
}

function AdminLiveNewsRow({
  item,
  onPress,
}: {
  item: AdminLiveNewsListItem;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} — incele`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        },
      ]}
    >
      <MediaThumb bucket="posts" path={item.media_path} size={58} radius={10} />
      <View style={styles.rowText}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {item.title}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          @{item.author_username} · {item.district ?? 'Trabzon'} · {formatRelativeTr(item.created_at)}
        </AppText>
        <View style={styles.badgeRow}>
          <Badge label={moderationLabel(item.moderation_status)} tone={moderationTone(item.moderation_status)} />
          <Badge
            label={LIVE_NEWS_VERIFICATION_LABELS[item.verification_status]}
            tone={verificationTone(item.verification_status)}
          />
          {item.reports_count > 0 ? <Badge label={`${item.reports_count} şikâyet`} tone="danger" /> : null}
          {item.risk_level === 'high' ? <Badge label="Yüksek risk" tone="danger" /> : null}
        </View>
        <AppText variant="caption" color="textTertiary">
          {item.view_count} tekil görüntüleme · {item.like_count} beğeni · {item.comment_count} yorum
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

type DialogAction =
  | 'approve'
  | 'hide'
  | 'remove'
  | 'request_correction'
  | 'set_verification'
  | 'send_to_newsroom'
  | 'request_evidence'
  | 'notify_user'
  | 'sanction_user';

type DialogState = {
  action: DialogAction;
  title: string;
  description: string;
  requireReason?: boolean;
  requireMessage?: boolean;
  force?: boolean;
};

function AdminLiveNewsDrawer({
  postId,
  onClose,
  onDone,
}: {
  postId: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const detail = useAdminLiveNewsDetail(postId);
  const action = useAdminLiveNewsAction();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [verification, setVerification] = useState<LiveNewsVerificationStatus>('verified');
  const [sanction, setSanction] = useState<'warn' | 'suspend' | 'restrict'>('warn');
  const [days, setDays] = useState('7');

  const openDialog = (state: DialogState) => {
    setReason('');
    setMessage('');
    setVerification('verified');
    setSanction('warn');
    setDialog(state);
  };

  const runAction = async () => {
    if (!postId || !dialog) return;
    if (dialog.requireReason && reason.trim().length < 3) {
      toast.error('En az 3 karakterlik bir gerekçe yaz.');
      return;
    }
    if (dialog.requireMessage && message.trim().length < 3) {
      toast.error('Kullanıcıya gönderilecek mesajı yaz.');
      return;
    }
    try {
      await action.mutateAsync({
        postId,
        action: dialog.action,
        reason: reason.trim() || null,
        payload: {
          ...(dialog.action === 'set_verification' ? { status: verification } : {}),
          ...(reason.trim() ? { note: reason.trim() } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
          ...(dialog.action === 'send_to_newsroom' ? { force: Boolean(dialog.force) } : {}),
          ...(dialog.action === 'sanction_user'
            ? { sanction, days: sanction === 'warn' ? undefined : Number(days) || 7 }
            : {}),
        },
      });
      toast.success('İşlem uygulandı ve denetim kaydına yazıldı.');
      setDialog(null);
      onDone('Anlık haber güncellendi.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    }
  };

  const onSendToNewsroom = () => {
    if (!detail.data) return;
    if (!detail.data.live_news.usage_consent) {
      setDialog(null);
      toast.error('Kullanıcı yeniden yayın izni vermedi. Aktarım için “Yine de aktar” seçilmeli.');
      setDialog({
        action: 'send_to_newsroom',
        title: 'Kullanım izni yok',
        description:
          'Kullanıcı medyasının haber üretiminde kullanılmasına izin vermedi. Yalnızca inceleme amacıyla aktarılacak. Devam edilsin mi?',
        force: true,
      });
      return;
    }
    openDialog({
      action: 'send_to_newsroom',
      title: 'Haber merkezine aktar',
      description: 'İçerik Vatandaş Haber Havuzu’na taşınır; kullanıcı bilgilendirilir.',
    });
  };

  const meta = detail.data?.live_news;
  const post = detail.data?.post;

  return (
    <>
      <Modal visible={Boolean(postId)} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={onClose}
          />
          <View style={[styles.drawer, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={[styles.drawerHead, { borderColor: theme.colors.divider }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">Anlık haber incelemesi</AppText>
                <AppText variant="caption" color="textTertiary">
                  Kanonik içerik ID’si tüm yayın yüzeylerinde aynıdır
                </AppText>
              </View>
              <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
            </View>

            {detail.isLoading || !meta || !post ? (
              <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.primary} />
            ) : (
              <ScrollView contentContainerStyle={styles.drawerContent} keyboardShouldPersistTaps="handled">
                <View style={styles.authorRow}>
                  <PersonCell
                    name={`${post.author_first_name ?? ''} ${post.author_last_name ?? ''}`.trim() || post.author_username}
                    username={post.author_username}
                    avatar={post.author_avatar_path}
                  />
                  <Badge label={moderationLabel(meta.moderation_status)} tone={moderationTone(meta.moderation_status)} />
                </View>

                <View style={styles.metaGrid}>
                  <Meta label="Gönderi ID" value={post.id} mono />
                  <Meta label="Kanonik ID" value={meta.canonical_id} mono />
                  <Meta label="Yayın zamanı" value={meta.published_at ? formatDateTr(meta.published_at) : 'Yayınlanmadı'} />
                  <Meta label="Kategori" value={categoryLabel(meta.category)} />
                  <Meta label="İlçe" value={meta.district ?? '—'} />
                  <Meta label="Medya" value={meta.media_kind} />
                  <Meta label="Risk" value={meta.risk_level ?? '—'} />
                  <Meta label="Hedefler" value={meta.publish_targets.join(', ')} />
                </View>

                <View style={styles.badgeRow}>
                  <Badge
                    label={LIVE_NEWS_VERIFICATION_LABELS[meta.verification_status]}
                    tone={verificationTone(meta.verification_status)}
                  />
                  {meta.reel_id ? <Badge label="Reels bağlı" tone="accent" /> : null}
                  {meta.usage_consent ? <Badge label="Yeniden yayın izni var" tone="success" /> : <Badge label="Yeniden yayın izni yok" tone="warning" />}
                  {meta.newsroom_state !== 'none' ? <Badge label={`Havuz: ${meta.newsroom_state}`} tone="accent" /> : null}
                </View>

                <View style={[styles.bodyBox, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <AppText variant="bodyStrong">{meta.title}</AppText>
                  {meta.summary ? (
                    <AppText variant="body" color="textSecondary" style={styles.summary}>
                      {meta.summary}
                    </AppText>
                  ) : null}
                </View>

                {post.media.length > 0 ? (
                  <View style={styles.mediaRow}>
                    {post.media.slice(0, 6).map((item) => (
                      <MediaThumb key={item.id} bucket="posts" path={item.storage_path} size={92} radius={10} />
                    ))}
                  </View>
                ) : null}

                <View style={styles.metricRow}>
                  <Metric label="Tekil görüntüleme" value={post.view_count ?? 0} />
                  <Metric label="Beğeni" value={post.like_count ?? 0} />
                  <Metric label="Yorum" value={post.comment_count ?? 0} />
                  <Metric label="Şikâyet" value={meta.reports_count} danger={meta.reports_count > 0} />
                </View>

                {meta.risk_flags?.length ? (
                  <View style={[styles.riskBox, { backgroundColor: theme.colors.dangerSoft }]}>
                    <Ionicons name="warning-outline" size={15} color={theme.colors.danger} />
                    <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                      Risk sinyalleri: {meta.risk_flags.join(', ')}
                    </AppText>
                  </View>
                ) : null}

                {meta.verification_note ? (
                  <AppText variant="caption" color="textTertiary">
                    Son doğrulama notu: {meta.verification_note}
                  </AppText>
                ) : null}

                <View style={styles.actionGrid}>
                  <ActionButton label="Onayla ve yayınla" icon="checkmark-circle-outline" onPress={() => openDialog({
                    action: 'approve',
                    title: 'İçeriği onayla',
                    description: 'İçerik anlık gelişmelerde görünür olur ve yazar bilgilendirilir.',
                  })} />
                  <ActionButton label="Gizle" icon="eye-off-outline" onPress={() => openDialog({
                    action: 'hide',
                    title: 'İçeriği gizle',
                    description: 'İçerik tüm yayın yüzeylerinden kaldırılır; yazar bilgilendirilir.',
                  })} />
                  <ActionButton
                    label="Kaldır"
                    icon="trash-outline"
                    tone="danger"
                    onPress={() => openDialog({
                      action: 'remove',
                      title: 'İçeriği kaldır',
                      description: 'Bu işlem geri alınamaz biçimde yayından kaldırır ve gerekçe ister.',
                      requireReason: true,
                    })}
                  />
                  <ActionButton label="Düzeltme iste" icon="create-outline" onPress={() => openDialog({
                    action: 'request_correction',
                    title: 'Düzeltme iste',
                    description: 'Yazara düzeltme talebi ve editör notu gönderilir.',
                    requireReason: true,
                  })} />
                  <ActionButton label="Doğrulama durumu" icon="shield-checkmark-outline" onPress={() => openDialog({
                    action: 'set_verification',
                    title: 'Doğrulama durumunu güncelle',
                    description: 'Yalnızca editoryal inceleme sonucu bir durum seçin.',
                    requireReason: true,
                  })} />
                  <ActionButton
                    label="Haber merkezine aktar"
                    icon="newspaper-outline"
                    onPress={onSendToNewsroom}
                  />
                  <ActionButton label="Ek kanıt iste" icon="help-buoy-outline" onPress={() => openDialog({
                    action: 'request_evidence',
                    title: 'Ek kanıt iste',
                    description: 'Yazara ek görüntü, saat veya tanık bilgisi sorulur.',
                    requireMessage: true,
                  })} />
                  <ActionButton label="Kullanıcıya mesaj" icon="chatbubble-outline" onPress={() => openDialog({
                    action: 'notify_user',
                    title: 'Kullanıcıya bildirim gönder',
                    description: 'Mesaj yalnızca içerik sahibine iletilir.',
                    requireMessage: true,
                  })} />
                  <ActionButton
                    label="Yaptırım uygula"
                    icon="ban-outline"
                    tone="danger"
                    onPress={() => openDialog({
                      action: 'sanction_user',
                      title: 'Kullanıcıya yaptırım uygula',
                      description: 'Uyarı, kısıtlama veya askıya alma işlemi denetim kaydına yazılır.',
                      requireReason: true,
                    })}
                  />
                </View>

                {meta.reports.length > 0 ? (
                  <View style={styles.sectionGap}>
                    <AppText variant="label">Şikâyetler</AppText>
                    {meta.reports.map((report) => (
                      <AppText key={report.id} variant="caption" color="textSecondary">
                        {report.report_no ?? report.id.slice(0, 8)} · {report.reason} · {formatRelativeTr(report.created_at)}
                      </AppText>
                    ))}
                  </View>
                ) : null}

                {meta.history.length > 0 ? (
                  <View style={styles.sectionGap}>
                    <AppText variant="label">İşlem geçmişi</AppText>
                    {meta.history.map((entry) => (
                      <AppText key={entry.id} variant="caption" color="textSecondary">
                        {formatRelativeTr(entry.created_at)} · {entry.action_label}
                      </AppText>
                    ))}
                  </View>
                ) : null}

                <AppText variant="caption" color="textTertiary">
                  Doğrulama ve moderasyon kararları kullanıcıya bildirilir. “Doğrulandı” yalnızca
                  editör doğrulamasıyla verilir.
                </AppText>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(dialog)} transparent animationType="fade" onRequestClose={() => setDialog(null)}>
        <View style={styles.dialogRoot}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]} onPress={() => setDialog(null)} />
          <View style={[styles.dialog, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <AppText variant="h3">{dialog?.title ?? 'İşlem'}</AppText>
            <AppText variant="caption" color="textSecondary">
              {dialog?.description}
            </AppText>

            {dialog?.action === 'set_verification' ? (
              <FilterChips
                options={(['citizen', 'reviewing', 'verified', 'corrected', 'unverified', 'removed'] as const).map(
                  (status) => ({ key: status, label: LIVE_NEWS_VERIFICATION_LABELS[status] }),
                )}
                value={verification}
                onChange={setVerification}
              />
            ) : null}

            {dialog?.action === 'sanction_user' ? (
              <>
                <FilterChips
                  options={[
                    { key: 'warn' as const, label: 'Uyarı' },
                    { key: 'restrict' as const, label: 'Kısıtlama' },
                    { key: 'suspend' as const, label: 'Askıya al' },
                  ]}
                  value={sanction}
                  onChange={setSanction}
                />
                {sanction !== 'warn' ? (
                  <TextInput
                    value={days}
                    onChangeText={(value) => setDays(value.replace(/[^0-9]/g, '').slice(0, 3))}
                    keyboardType="number-pad"
                    placeholder="Gün sayısı"
                    placeholderTextColor={theme.colors.textTertiary}
                    style={[styles.dialogInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                  />
                ) : null}
              </>
            ) : null}

            {dialog?.requireMessage || dialog?.action === 'request_evidence' || dialog?.action === 'notify_user' ? (
              <TextInput
                value={message}
                onChangeText={setMessage}
                multiline
                placeholder="Kullanıcıya gönderilecek mesaj"
                placeholderTextColor={theme.colors.textTertiary}
                style={[styles.dialogInput, styles.dialogTextarea, { color: theme.colors.text, borderColor: theme.colors.border }]}
              />
            ) : null}

            {dialog?.requireReason || dialog?.action === 'hide' || dialog?.action === 'send_to_newsroom' ? (
              <TextInput
                value={reason}
                onChangeText={setReason}
                multiline
                placeholder={dialog.requireReason ? 'Gerekçe (zorunlu)' : 'Not (isteğe bağlı)'}
                placeholderTextColor={theme.colors.textTertiary}
                style={[styles.dialogInput, styles.dialogTextarea, { color: theme.colors.text, borderColor: theme.colors.border }]}
              />
            ) : null}

            <View style={styles.dialogActions}>
              <Button label="Vazgeç" variant="secondary" size="sm" fullWidth={false} onPress={() => setDialog(null)} />
              <Button
                label={dialog?.action === 'remove' ? 'Kaldır' : 'Uygula'}
                variant={dialog?.action === 'remove' || dialog?.action === 'sanction_user' ? 'danger' : 'primary'}
                size="sm"
                fullWidth={false}
                loading={action.isPending}
                onPress={() => void runAction()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.meta}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="caption" numberOfLines={2} style={{ fontFamily: mono ? 'monospace' : undefined }}>
        {value}
      </AppText>
    </View>
  );
}

function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: theme.colors.surfaceMuted }]}>
      <AppText variant="bodyStrong" color={danger ? 'danger' : 'text'}>
        {value}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  tone,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  tone?: 'danger';
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          borderColor: tone === 'danger' ? theme.colors.danger : theme.colors.border,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={tone === 'danger' ? theme.colors.danger : theme.colors.primary} />
      <AppText variant="caption" style={{ flex: 1 }} numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { flexGrow: 1, flexBasis: 120, gap: 8, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
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
  loader: { paddingVertical: 30 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  rowText: { flex: 1, gap: 3 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  modalRoot: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  drawer: { width: '100%', maxWidth: 680, height: '100%', borderLeftWidth: StyleSheet.hairlineWidth },
  drawerHead: {
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    gap: 10,
  },
  drawerContent: { padding: 14, gap: 12, paddingBottom: 44 },
  authorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meta: { minWidth: 130, flexGrow: 1, flexBasis: 140, gap: 1 },
  bodyBox: { borderRadius: 10, padding: 12, gap: 6 },
  summary: { lineHeight: 21 },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metric: { flexGrow: 1, flexBasis: 90, alignItems: 'center', borderRadius: 9, paddingVertical: 8 },
  riskBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 10, borderRadius: 10 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionButton: {
    flexGrow: 1,
    flexBasis: 190,
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
  },
  sectionGap: { gap: 3, marginTop: 6 },
  dialogRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  dialog: { width: '100%', maxWidth: 480, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  dialogChips: { gap: 6 },
  dialogInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  dialogTextarea: { minHeight: 76, textAlignVertical: 'top' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
});
