import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState, type ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

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
import { useAdminReels, useContentAction } from '@/features/admin/hooks/use-admin';
import type { ContentAction, ContentReel } from '@/features/admin/types';
import { publicMediaUrl } from '@/features/media/media-service';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

const PAGE_SIZE = 20;
const number = (value: number) => new Intl.NumberFormat('tr-TR').format(value);

const modLabel = (status: string) =>
  status === 'visible'
    ? 'Görünür'
    : status === 'hidden'
      ? 'Gizli'
      : status === 'removed'
        ? 'Kaldırıldı'
        : status;
const modTone = (status: string): 'success' | 'warning' | 'danger' =>
  status === 'visible' ? 'success' : status === 'hidden' ? 'warning' : 'danger';

export default function AdminReelsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [query, setQuery] = useState('');
  const [moderation, setModeration] = useState<'all' | 'visible' | 'hidden' | 'removed'>('all');
  const [processing, setProcessing] = useState<'all' | 'ready' | 'processing'>('all');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ContentReel | null>(null);
  const [pending, setPending] = useState<ContentAction | null>(null);
  /** Moderasyon videosu panelin içinde oynatılır; tarayıcıya çıkılmaz. */
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const action = useContentAction();

  const closeDrawer = () => {
    setVideoUri(null);
    setSelected(null);
  };

  const reels = useAdminReels({
    query: query.trim() || undefined,
    status: processing === 'all' ? null : processing === 'ready' ? 'ready' : 'processing',
    moderation: moderation === 'all' ? null : moderation,
    limit: PAGE_SIZE,
    offset,
  });

  const columns: Column<ContentReel>[] = [
    {
      key: 'reel',
      label: 'Reels',
      width: 2.6,
      render: (row) => (
        <View style={styles.reelCell}>
          <MediaThumb bucket="reels" path={row.cover_path} icon="videocam-outline" size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="caption" numberOfLines={2}>
              {row.caption || '(açıklamasız)'}
            </AppText>
            <View style={styles.badgeRow}>
              <Badge
                label={row.status === 'ready' ? 'Hazır' : 'İşleniyor'}
                tone={row.status === 'ready' ? 'success' : 'warning'}
              />
              {row.is_featured ? <Badge label="Öne çıkan" tone="accent" /> : null}
              {row.report_count > 0 ? (
                <Badge label={`${row.report_count} şikâyet`} tone="danger" />
              ) : null}
            </View>
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
        />
      ),
    },
    {
      key: 'views',
      label: 'İzlenme',
      width: 0.6,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {number(row.view_count)}
        </AppText>
      ),
    },
    {
      key: 'engagement',
      label: 'Etkileşim',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textTertiary">
          {number(row.like_count)} beğeni · {number(row.comment_count)} yorum
        </AppText>
      ),
    },
    {
      key: 'status',
      label: 'Moderasyon',
      width: 0.7,
      render: (row) => (
        <Badge label={modLabel(row.moderation_status)} tone={modTone(row.moderation_status)} />
      ),
    },
  ];

  const submit = async (reason: string) => {
    if (!selected || !pending) return;
    try {
      await action.mutateAsync({ kind: 'reel', id: selected.id, action: pending, reason });
      setPending(null);
      setSelected(null);
      toast.success('Reels moderasyonu uygulandı.');
      void reels.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    }
  };

  const tech = reels.data?.tech;

  return (
    <AdminPage
      title="Reels ve Medya Yönetimi"
      subtitle="Video moderasyonu, işleme sağlığı ve öne çıkan içerik kontrolü."
      refreshing={reels.isRefetching}
      onRefresh={() => void reels.refetch()}
      actions={<Badge label={`${reels.data?.total ?? 0} video`} tone="neutral" />}
    >
      <StatGrid>
        <StatCard
          label="Yayına hazır video"
          value={number(tech?.ready ?? 0)}
          icon="checkmark-circle-outline"
          tone="success"
          hint="İşleme tamamlandı"
        />
        <StatCard
          label="İşleniyor"
          value={number(tech?.processing ?? 0)}
          icon="hourglass-outline"
          tone="warning"
          hint="Kuyrukta veya dönüştürülüyor"
        />
        <StatCard
          label="Son 24 saatte başarısız"
          value={number(tech?.failed_24h ?? 0)}
          icon="alert-circle-outline"
          tone={tech?.failed_24h ? 'danger' : 'primary'}
          hint="Yükleme/işleme hatası"
        />
      </StatGrid>

      <AdminSection title="Arama ve filtreler" subtitle="Video ID, açıklama veya sahip ile arayın.">
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
              placeholder="Açıklama, @kullanıcı veya video ID…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.searchInput, { color: theme.colors.text }]}
            />
          </View>
        </AdminToolbar>
        <View style={styles.filterGroup}>
          <FilterChips
            options={[
              { key: 'all' as const, label: 'Tüm durumlar' },
              { key: 'ready' as const, label: 'Hazır' },
              { key: 'processing' as const, label: 'İşleniyor' },
            ]}
            value={processing}
            onChange={(value) => {
              setProcessing(value);
              setOffset(0);
            }}
          />
        </View>
        <FilterChips
          options={[
            { key: 'all' as const, label: 'Tüm moderasyon' },
            { key: 'visible' as const, label: 'Görünür' },
            { key: 'hidden' as const, label: 'Gizli' },
            { key: 'removed' as const, label: 'Kaldırılan' },
          ]}
          value={moderation}
          onChange={(value) => {
            setModeration(value);
            setOffset(0);
          }}
        />
      </AdminSection>

      <DataTable
        columns={columns}
        rows={reels.data?.items ?? []}
        keyExtractor={(row) => row.id}
        loading={reels.isLoading}
        onRowPress={setSelected}
        empty={
          <View style={[styles.empty, { borderColor: theme.colors.border }]}>
            <Ionicons name="videocam-outline" size={22} color={theme.colors.textTertiary} />
            <AppText variant="body" color="textSecondary">
              Reels bulunamadı.
            </AppText>
          </View>
        }
      />

      {reels.data ? (
        <Pager
          total={reels.data.total}
          limit={reels.data.limit}
          offset={reels.data.offset}
          onChange={setOffset}
        />
      ) : null}

      <Modal
        visible={Boolean(selected)}
        transparent
        animationType="fade"
        onRequestClose={closeDrawer}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={closeDrawer}
          />
          <View
            style={[
              styles.drawer,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.drawerHead, { borderColor: theme.colors.divider }]}>
              <AppText variant="h3">Reels incelemesi</AppText>
              <IconButton
                accessibilityLabel="Kapat"
                name="close"
                size={18}
                onPress={closeDrawer}
              />
            </View>
            {selected ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.drawerContent}
              >
                <View style={styles.previewRow}>
                  <MediaThumb
                    bucket="reels"
                    path={selected.cover_path}
                    icon="videocam-outline"
                    size={112}
                    radius={12}
                  />
                  <View style={{ flex: 1, gap: 4 }}>
                    <PersonCell
                      name={selected.author_name}
                      username={selected.author_username}
                      avatar={selected.author_avatar}
                    />
                    <View style={styles.badgeRow}>
                      <Badge
                        label={modLabel(selected.moderation_status)}
                        tone={modTone(selected.moderation_status)}
                      />
                      <Badge
                        label={selected.status === 'ready' ? 'Hazır' : 'İşleniyor'}
                        tone={selected.status === 'ready' ? 'success' : 'warning'}
                      />
                      {selected.is_featured ? <Badge label="Öne çıkan" tone="accent" /> : null}
                    </View>
                    <AppText variant="caption" color="textSecondary" numberOfLines={4}>
                      {selected.caption || '(açıklamasız)'}
                    </AppText>
                  </View>
                </View>

                <View style={styles.metaGrid}>
                  <Meta label="Video ID" value={selected.id} mono />
                  <Meta label="Yayın" value={formatDateTr(selected.created_at)} />
                  <Meta
                    label="Süre"
                    value={
                      selected.duration_ms ? `${Math.round(selected.duration_ms / 1000)} sn` : '—'
                    }
                  />
                  <Meta label="Ses" value={selected.audio_title ?? '—'} />
                  <Meta label="İzlenme" value={number(selected.view_count)} />
                  <Meta label="Beğeni" value={number(selected.like_count)} />
                  <Meta label="Yorum" value={number(selected.comment_count)} />
                  <Meta label="Paylaşım" value={number(selected.share_count)} />
                </View>

                {selected.video_path ? (
                  <Button
                    label="Videoyu güvenli görüntüle"
                    size="sm"
                    variant="secondary"
                    leftIcon={<Ionicons name="play-outline" size={14} color={theme.colors.text} />}
                    onPress={() => {
                      const url = publicMediaUrl('reels', selected.video_path);
                      if (url) {
                        setVideoUri(url);
                      }
                    }}
                  />
                ) : null}

                {videoUri ? <InlineReelVideo uri={videoUri} /> : null}

                <View style={styles.actionGrid}>
                  <ActionButton
                    icon={
                      selected.moderation_status === 'hidden' ? 'eye-outline' : 'eye-off-outline'
                    }
                    label={
                      selected.moderation_status === 'hidden' ? 'Gizlemeyi kaldır' : 'Videoyu gizle'
                    }
                    onPress={() =>
                      setPending(selected.moderation_status === 'hidden' ? 'restore' : 'hide')
                    }
                  />
                  <ActionButton
                    icon="trash-outline"
                    label={
                      selected.moderation_status === 'removed'
                        ? 'Kaldırmayı geri al'
                        : 'Videoyu kaldır'
                    }
                    tone="danger"
                    onPress={() =>
                      setPending(selected.moderation_status === 'removed' ? 'restore' : 'remove')
                    }
                  />
                  <ActionButton
                    icon={selected.comments_locked ? 'lock-open-outline' : 'lock-closed-outline'}
                    label={selected.comments_locked ? 'Yorumları aç' : 'Yorumları kilitle'}
                    onPress={() =>
                      setPending(selected.comments_locked ? 'unlock_comments' : 'lock_comments')
                    }
                  />
                  <ActionButton
                    icon="star-outline"
                    label={selected.is_featured ? 'Öne çıkarmayı kaldır' : 'Öne çıkar'}
                    onPress={() => setPending(selected.is_featured ? 'unfeature' : 'feature')}
                  />
                </View>

                <AppText variant="caption" color="textTertiary">
                  İşleme hatası olan videolar için teknik durum yukarıda raporlanır. Medya dosyaları
                  yalnızca yetkili personel tarafından görüntülenebilir.
                </AppText>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <ReasonDialog
        visible={Boolean(pending)}
        title={
          pending === 'remove'
            ? 'Videoyu kaldır'
            : pending === 'hide'
              ? 'Videoyu gizle'
              : pending === 'restore'
                ? 'İçeriği geri yükle'
                : 'Reels ayarını değiştir'
        }
        description="İşlem video sahibine bildirilir ve denetim kaydına yazılır."
        confirmLabel="Uygula"
        destructive={pending === 'remove'}
        requireReason={pending === 'remove' || pending === 'hide'}
        loading={action.isPending}
        onCancel={() => setPending(null)}
        onConfirm={({ reason }) => void submit(reason)}
      />
    </AdminPage>
  );
}

/**
 * Moderasyon videosunu panelin içinde oynatır.
 *
 * Önceki sürüm videoyu cihaz tarayıcısında açıyordu; inceleme akışından
 * çıkılıyor ve herkese açık medya adresi tarayıcı geçmişine düşüyordu.
 */
function InlineReelVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = false;
  });

  useEffect(() => {
    try {
      player.play();
    } catch {
      // Otomatik oynatma engellenmiş olabilir; kullanıcı kontrolleri kullanır.
    }
  }, [player]);

  return (
    <View style={styles.videoWrap}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls
        surfaceType="textureView"
      />
    </View>
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

function ActionButton({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
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
  reelCell: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  videoWrap: {
    height: 320,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#04060C',
  },
  video: { width: '100%', height: '100%' },
  badgeRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
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
    maxWidth: 600,
    height: '100%',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  drawerHead: {
    height: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  drawerContent: { padding: 14, gap: 12, paddingBottom: 40 },
  previewRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meta: { minWidth: 120, flexGrow: 1, flexBasis: 130, gap: 1 },
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
});
