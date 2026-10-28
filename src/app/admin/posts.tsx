import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';
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
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { MediaThumb, PersonCell } from '@/features/admin/components/Media';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminComments,
  useAdminPosts,
  useContentAction,
} from '@/features/admin/hooks/use-admin';
import type { ContentAction, ContentComment, ContentPost } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

const PAGE_SIZE = 20;

function statusTone(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'visible') return 'success';
  if (status === 'hidden') return 'warning';
  return 'danger';
}

function statusLabel(status: string) {
  if (status === 'visible') return 'Görünür';
  if (status === 'hidden') return 'Gizli';
  if (status === 'removed') return 'Kaldırıldı';
  return status;
}

export default function AdminPostsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'visible' | 'hidden' | 'removed'>('all');
  const [featured, setFeatured] = useState<'all' | 'featured'>('all');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ContentPost | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const posts = useAdminPosts({
    query: query.trim() || undefined,
    status: status === 'all' ? null : status,
    featured: featured === 'all' ? null : true,
    limit: PAGE_SIZE,
    offset,
  });

  const columns: Column<ContentPost>[] = [
    {
      key: 'post',
      label: 'Gönderi',
      width: 2.4,
      render: (row) => (
        <View style={styles.postCell}>
          <MediaThumb bucket="posts" path={row.media[0]?.path} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="caption" numberOfLines={2}>
              {row.body || '(yalnızca medya)'}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {row.media.length} medya · {formatDateTr(row.created_at)}
            </AppText>
          </View>
        </View>
      ),
    },
    {
      key: 'author',
      label: 'Sahip',
      width: 1.3,
      render: (row) => (
        <PersonCell
          name={row.author_name}
          username={row.author_username}
          avatar={row.author_avatar}
          verified={row.author_verified}
        />
      ),
    },
    {
      key: 'metrics',
      label: 'Etkileşim',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {row.like_count} beğeni · {row.comment_count} yorum
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
      key: 'status',
      label: 'Durum',
      width: 0.7,
      render: (row) => (
        <View style={{ gap: 3 }}>
          <Badge
            label={statusLabel(row.moderation_status)}
            tone={statusTone(row.moderation_status)}
          />
          {row.is_featured ? <Badge label="Öne çıkan" tone="accent" /> : null}
        </View>
      ),
    },
  ];

  return (
    <AdminPage
      title="Sosyal Akış Yönetimi"
      subtitle="Herkese açık gönderileri inceleyin, gizleyin, kaldırın ve yorumları yönetin."
      refreshing={posts.isRefetching}
      onRefresh={() => void posts.refetch()}
      actions={
        <>
          <Badge label={`${posts.data?.total ?? 0} gönderi`} tone="neutral" />
          <Button
            label="Yorum kuyruğu"
            size="sm"
            variant="secondary"
            fullWidth={false}
            leftIcon={<Ionicons name="chatbubbles-outline" size={14} color={theme.colors.text} />}
            onPress={() => setCommentsOpen(true)}
          />
        </>
      }
    >
      <AdminSection title="Arama ve filtreler" subtitle="İçerik metni veya yazar ile arayın.">
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
              placeholder="Gönderi metni, kullanıcı adı…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.searchInput, { color: theme.colors.text }]}
            />
          </View>
        </AdminToolbar>
        <FilterChips
          options={[
            { key: 'all' as const, label: 'Tümü' },
            { key: 'visible' as const, label: 'Görünür' },
            { key: 'hidden' as const, label: 'Gizli' },
            { key: 'removed' as const, label: 'Kaldırılan' },
          ]}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setOffset(0);
          }}
        />
        <FilterChips
          options={[
            { key: 'all' as const, label: 'Tüm gönderiler' },
            { key: 'featured' as const, label: 'Öne çıkanlar' },
          ]}
          value={featured}
          onChange={(value) => {
            setFeatured(value);
            setOffset(0);
          }}
        />
      </AdminSection>

      <DataTable
        columns={columns}
        rows={posts.data?.items ?? []}
        keyExtractor={(row) => row.id}
        loading={posts.isLoading}
        onRowPress={setSelected}
        empty={
          <View style={[styles.empty, { borderColor: theme.colors.border }]}>
            <Ionicons name="newspaper-outline" size={22} color={theme.colors.textTertiary} />
            <AppText variant="body" color="textSecondary">
              Gönderi bulunamadı.
            </AppText>
          </View>
        }
      />

      {posts.data ? (
        <Pager
          total={posts.data.total}
          limit={posts.data.limit}
          offset={posts.data.offset}
          onChange={setOffset}
        />
      ) : null}

      <AppText variant="caption" color="textTertiary">
        Kaldırılan içerikler veritabanında saklanır; geri yükleme işlemleri gerekçe ve denetim kaydı
        gerektirir. İçerik sahibine otomatik bildirim gönderilir.
      </AppText>

      <PostDrawer
        post={selected}
        onClose={() => setSelected(null)}
        onDone={(message) => {
          toast.success(message);
          void posts.refetch();
          setSelected(null);
        }}
      />

      <CommentsModal
        visible={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        onDone={(message) => {
          toast.success(message);
        }}
      />
    </AdminPage>
  );
}

function PostDrawer({
  post,
  onClose,
  onDone,
}: {
  post: ContentPost | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { theme } = useTheme();
  const action = useContentAction();
  const toast = useAdminToast();
  const [pending, setPending] = useState<ContentAction | null>(null);

  const submit = async (reason: string) => {
    if (!post || !pending) return;
    try {
      await action.mutateAsync({ kind: 'post', id: post.id, action: pending, reason });
      setPending(null);
      onDone(
        pending === 'remove'
          ? 'Gönderi kaldırıldı.'
          : pending === 'hide'
            ? 'Gönderi gizlendi.'
            : pending === 'restore'
              ? 'Gönderi geri yüklendi.'
              : 'Gönderi ayarı güncellendi.',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    }
  };

  return (
    <>
      <Modal visible={Boolean(post)} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={onClose}
          />
          <View
            style={[
              styles.drawer,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.drawerHead, { borderColor: theme.colors.divider }]}>
              <AppText variant="h3">Gönderi incelemesi</AppText>
              <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
            </View>
            {post ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.drawerContent}
              >
                <View style={styles.authorRow}>
                  <PersonCell
                    name={post.author_name}
                    username={post.author_username}
                    avatar={post.author_avatar}
                    verified={post.author_verified}
                  />
                  <Badge
                    label={statusLabel(post.moderation_status)}
                    tone={statusTone(post.moderation_status)}
                  />
                </View>
                <View style={styles.metaGrid}>
                  <Meta label="Gönderi ID" value={post.id} mono />
                  <Meta label="Oluşturulma" value={formatDateTr(post.created_at)} />
                  <Meta label="Görünürlük" value={post.visibility} />
                  <Meta label="Şehir" value={post.city ?? '—'} />
                </View>
                {post.body ? (
                  <View style={[styles.bodyBox, { backgroundColor: theme.colors.surfaceMuted }]}>
                    <AppText variant="body">{post.body}</AppText>
                  </View>
                ) : null}
                {post.media.length > 0 ? (
                  <View style={styles.mediaRow}>
                    {post.media.slice(0, 6).map((item) => (
                      <MediaThumb
                        key={item.path}
                        bucket="posts"
                        path={item.path}
                        size={92}
                        radius={10}
                      />
                    ))}
                  </View>
                ) : null}
                <View style={styles.metricRow}>
                  <Metric label="Beğeni" value={post.like_count} />
                  <Metric label="Yorum" value={post.comment_count} />
                  <Metric label="Kaydetme" value={post.save_count} />
                  <Metric label="Paylaşım" value={post.share_count} />
                  <Metric
                    label="Şikâyet"
                    value={post.report_count}
                    danger={post.report_count > 0}
                  />
                </View>

                <View style={styles.actionGrid}>
                  <ActionButton
                    label={
                      post.moderation_status === 'hidden' ? 'Gizlemeyi kaldır' : 'Gönderiyi gizle'
                    }
                    icon="eye-off-outline"
                    onPress={() =>
                      setPending(post.moderation_status === 'hidden' ? 'restore' : 'hide')
                    }
                  />
                  <ActionButton
                    label={
                      post.moderation_status === 'removed'
                        ? 'Kaldırmayı geri al'
                        : 'Gönderiyi kaldır'
                    }
                    icon="trash-outline"
                    tone="danger"
                    onPress={() =>
                      setPending(post.moderation_status === 'removed' ? 'restore' : 'remove')
                    }
                  />
                  <ActionButton
                    label={post.comments_locked ? 'Yorumları aç' : 'Yorumları kilitle'}
                    icon={post.comments_locked ? 'lock-open-outline' : 'lock-closed-outline'}
                    onPress={() =>
                      setPending(post.comments_locked ? 'unlock_comments' : 'lock_comments')
                    }
                  />
                  <ActionButton
                    label={post.is_featured ? 'Öne çıkarmayı kaldır' : 'Öne çıkar'}
                    icon="star-outline"
                    onPress={() => setPending(post.is_featured ? 'unfeature' : 'feature')}
                  />
                </View>
                <AppText variant="caption" color="textTertiary">
                  Gizleme ve kaldırma işlemleri gerekçe ister. Kaldırılan içerik, saklama politikası
                  süresince yetkili ekip tarafından geri yüklenebilir.
                </AppText>
              </ScrollView>
            ) : (
              <ActivityIndicator style={{ marginTop: 30 }} color={theme.colors.primary} />
            )}
          </View>
        </View>
      </Modal>

      <ReasonDialog
        visible={Boolean(pending)}
        title={
          pending === 'remove'
            ? 'Gönderiyi kaldır'
            : pending === 'hide'
              ? 'Gönderiyi gizle'
              : pending === 'restore'
                ? 'İçeriği geri yükle'
                : 'Gönderi ayarını değiştir'
        }
        description="İşlem, içerik sahibine bildirilir ve denetim kaydına yazılır."
        confirmLabel="Uygula"
        destructive={pending === 'remove'}
        requireReason={pending === 'remove' || pending === 'hide'}
        loading={action.isPending}
        onCancel={() => setPending(null)}
        onConfirm={({ reason }) => void submit(reason)}
      />
    </>
  );
}

function CommentsModal({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [status, setStatus] = useState<'all' | 'visible' | 'hidden' | 'removed'>('all');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ContentComment | null>(null);
  const [pending, setPending] = useState<ContentAction | null>(null);
  const comments = useAdminComments({
    query: query.trim() || undefined,
    status: status === 'all' ? null : status,
    limit: 25,
    offset,
  });
  const action = useContentAction();

  const submit = async (reason: string) => {
    if (!selected || !pending) return;
    try {
      await action.mutateAsync({ kind: 'comment', id: selected.id, action: pending, reason });
      setPending(null);
      setSelected(null);
      onDone('Yorum moderasyonu uygulandı.');
      void comments.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    }
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalCenter}>
          <Pressable
            accessibilityLabel="Kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={onClose}
          />
          <View
            style={[
              styles.commentsPanel,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.drawerHead, { borderColor: theme.colors.divider }]}>
              <View style={{ flex: 1 }}>
                <AppText variant="h3">Yorum moderasyonu</AppText>
                <AppText variant="caption" color="textTertiary">
                  Gönderi ve Reels yorumları birleşik kuyrukta
                </AppText>
              </View>
              <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
            </View>
            <View style={{ padding: 12, gap: 8 }}>
              <View
                style={[
                  styles.searchWrap,
                  {
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.inputBackground,
                  },
                ]}
              >
                <Ionicons name="search" size={15} color={theme.colors.textTertiary} />
                <TextInput
                  value={query}
                  onChangeText={(value) => {
                    setQuery(value);
                    setOffset(0);
                  }}
                  placeholder="Yorum veya yazar ara…"
                  placeholderTextColor={theme.colors.textTertiary}
                  style={[styles.searchInput, { color: theme.colors.text }]}
                />
              </View>
              <FilterChips
                options={[
                  { key: 'all' as const, label: 'Tümü' },
                  { key: 'visible' as const, label: 'Görünür' },
                  { key: 'hidden' as const, label: 'Gizli' },
                  { key: 'removed' as const, label: 'Kaldırılan' },
                ]}
                value={status}
                onChange={(value) => {
                  setStatus(value);
                  setOffset(0);
                }}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
            >
              {comments.isLoading ? (
                <ActivityIndicator style={{ marginVertical: 30 }} color={theme.colors.primary} />
              ) : (comments.data?.items.length ?? 0) === 0 ? (
                <AppText
                  variant="caption"
                  color="textTertiary"
                  style={{ paddingVertical: 24, textAlign: 'center' }}
                >
                  Yorum bulunamadı.
                </AppText>
              ) : (
                comments.data?.items.map((comment) => (
                  <View
                    key={`${comment.kind}-${comment.id}`}
                    style={[styles.commentRow, { borderColor: theme.colors.divider }]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="caption" style={{ fontWeight: '600' }}>
                        @{comment.author_username} · {comment.parent_label}
                      </AppText>
                      <AppText variant="caption" color="textSecondary">
                        {comment.body}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {formatDateTr(comment.created_at)} · {comment.report_count} şikâyet
                      </AppText>
                    </View>
                    <Badge
                      label={statusLabel(comment.moderation_status)}
                      tone={statusTone(comment.moderation_status)}
                    />
                    <View style={{ gap: 5 }}>
                      {comment.moderation_status !== 'visible' ? (
                        <Button
                          label="Geri yükle"
                          size="sm"
                          variant="outline"
                          fullWidth={false}
                          onPress={() => {
                            setSelected(comment);
                            setPending('restore');
                          }}
                        />
                      ) : null}
                      <Button
                        label="Kaldır"
                        size="sm"
                        variant="danger"
                        fullWidth={false}
                        onPress={() => {
                          setSelected(comment);
                          setPending('remove');
                        }}
                      />
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
            {comments.data ? (
              <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                <Pager
                  total={comments.data.total}
                  limit={comments.data.limit}
                  offset={comments.data.offset}
                  onChange={setOffset}
                />
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <ReasonDialog
        visible={Boolean(pending)}
        title={pending === 'remove' ? 'Yorumu kaldır' : 'Yorumu geri yükle'}
        description="Yorum moderasyonu denetim kaydına yazılır."
        destructive={pending === 'remove'}
        requireReason={pending === 'remove'}
        loading={action.isPending}
        confirmLabel="Uygula"
        onCancel={() => setPending(null)}
        onConfirm={({ reason }) => void submit(reason)}
      />
    </>
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
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  tone?: 'danger';
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          borderColor: theme.colors.border,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={15}
        color={tone === 'danger' ? theme.colors.danger : theme.colors.primary}
      />
      <AppText variant="caption" style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  postCell: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
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
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  modalRoot: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  modalCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  drawer: {
    width: '100%',
    maxWidth: 600,
    height: '100%',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  commentsPanel: {
    width: '100%',
    maxWidth: 780,
    maxHeight: '88%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flex: 1,
  },
  drawerHead: {
    height: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    gap: 10,
  },
  drawerContent: { padding: 14, gap: 12, paddingBottom: 40 },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meta: { minWidth: 130, flexGrow: 1, flexBasis: 140, gap: 1 },
  bodyBox: { borderRadius: 9, padding: 10 },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metric: { flexGrow: 1, flexBasis: 74, alignItems: 'center', borderRadius: 9, paddingVertical: 7 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionButton: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
});
