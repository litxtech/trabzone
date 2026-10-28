import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useState, type ComponentProps } from 'react';
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
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useAdminStories, useContentAction } from '@/features/admin/hooks/use-admin';
import type { ContentAction, ContentStory } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr, formatRelativeTr } from '@/utils/date';

const PAGE_SIZE = 20;

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

export default function AdminStoriesScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const toast = useAdminToast();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'visible' | 'hidden' | 'removed'>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ContentStory | null>(null);
  const [pending, setPending] = useState<ContentAction | null>(null);
  const action = useContentAction();

  const stories = useAdminStories({
    query: query.trim() || undefined,
    status: status === 'all' ? null : status,
    activeOnly,
    limit: PAGE_SIZE,
    offset,
  });

  const columns: Column<ContentStory>[] = [
    {
      key: 'story',
      label: 'Hikâye',
      width: 2.3,
      render: (row) => (
        <View style={styles.cell}>
          <MediaThumb bucket="stories" path={row.media_path} icon="albums-outline" size={46} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="caption" numberOfLines={2}>
              {row.caption || '(açıklamasız)'}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {row.media_type} · {formatRelativeTr(row.created_at)}
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
        />
      ),
    },
    {
      key: 'expires',
      label: 'Bitiş',
      width: 0.9,
      hideOnMobile: true,
      render: (row) => (
        <View style={{ gap: 2 }}>
          <Badge
            label={row.is_active ? 'Aktif' : 'Süresi doldu'}
            tone={row.is_active ? 'success' : 'neutral'}
          />
          <AppText variant="caption" color="textTertiary">
            {formatDateTr(row.expires_at)}
          </AppText>
        </View>
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
      label: 'Moderasyon',
      width: 0.7,
      render: (row) => (
        <View style={{ gap: 3 }}>
          <Badge label={modLabel(row.moderation_status)} tone={modTone(row.moderation_status)} />
          {row.is_featured ? <Badge label="Öne çıkan" tone="accent" /> : null}
        </View>
      ),
    },
  ];

  const submit = async (reason: string) => {
    if (!selected || !pending) return;
    try {
      await action.mutateAsync({ kind: 'story', id: selected.id, action: pending, reason });
      setPending(null);
      setSelected(null);
      toast.success('Hikâye moderasyonu uygulandı.');
      void stories.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    }
  };

  return (
    <AdminPage
      title="Hikâye Yönetimi"
      subtitle="Aktif hikâyeleri, şikâyetleri ve saklama politikasını izleyin."
      refreshing={stories.isRefetching}
      onRefresh={() => void stories.refetch()}
      actions={
        <Button
          label="Saklama ayarı"
          size="sm"
          variant="secondary"
          fullWidth={false}
          leftIcon={<Ionicons name="time-outline" size={14} color={theme.colors.text} />}
          onPress={() => router.push('/admin/settings' as never)}
        />
      }
    >
      <StatGrid>
        <StatCard
          label="Aktif hikâye"
          value={String(stories.data?.active_count ?? 0)}
          icon="albums-outline"
          tone="success"
          hint="Yayında olan hikâyeler"
        />
        <StatCard
          label="Saklama süresi"
          value={`${stories.data?.retention_hours ?? 24} sa`}
          icon="time-outline"
          hint="Otomatik yayından kaldırma"
        />
        <StatCard
          label="Listelenen"
          value={String(stories.data?.total ?? 0)}
          icon="list-outline"
          hint="Seçili filtreye göre"
        />
      </StatGrid>

      <AdminSection title="Arama ve filtreler" subtitle="Hikâye açıklaması veya sahip ile arayın.">
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
              placeholder="Açıklama veya @kullanıcı…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.searchInput, { color: theme.colors.text }]}
            />
          </View>
          <Button
            label={activeOnly ? 'Yalnızca aktif: açık' : 'Yalnızca aktif'}
            size="sm"
            variant={activeOnly ? 'primary' : 'outline'}
            fullWidth={false}
            onPress={() => {
              setActiveOnly((value) => !value);
              setOffset(0);
            }}
          />
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
      </AdminSection>

      <DataTable
        columns={columns}
        rows={stories.data?.items ?? []}
        keyExtractor={(row) => row.id}
        loading={stories.isLoading}
        onRowPress={setSelected}
        empty={
          <View style={[styles.empty, { borderColor: theme.colors.border }]}>
            <Ionicons name="albums-outline" size={22} color={theme.colors.textTertiary} />
            <AppText variant="body" color="textSecondary">
              Hikâye bulunamadı.
            </AppText>
          </View>
        }
      />

      {stories.data ? (
        <Pager
          total={stories.data.total}
          limit={stories.data.limit}
          offset={stories.data.offset}
          onChange={setOffset}
        />
      ) : null}

      <AppText variant="caption" color="textTertiary">
        Hikâyeler saklama süresi dolduğunda otomatik olarak yayından kaldırılır. Özel hikâye erişim
        kuralları moderasyon tarafından değiştirilmez.
      </AppText>

      <Modal
        visible={Boolean(selected)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Kapat"
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={() => setSelected(null)}
          />
          <View
            style={[
              styles.drawer,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.drawerHead, { borderColor: theme.colors.divider }]}>
              <AppText variant="h3">Hikâye incelemesi</AppText>
              <IconButton
                accessibilityLabel="Kapat"
                name="close"
                size={18}
                onPress={() => setSelected(null)}
              />
            </View>
            {selected ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.drawerContent}
              >
                {selected.media_type === 'video' ? (
                  <View
                    style={[
                      styles.mediaPlaceholder,
                      { backgroundColor: theme.colors.surfaceMuted },
                    ]}
                  >
                    <Ionicons name="videocam-outline" size={30} color={theme.colors.textTertiary} />
                    <AppText variant="caption" color="textTertiary">
                      Hikâye videosu
                    </AppText>
                  </View>
                ) : (
                  <MediaThumb
                    bucket="stories"
                    path={selected.media_path}
                    size={240}
                    radius={12}
                    icon="image-outline"
                  />
                )}
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
                    label={selected.is_active ? 'Aktif' : 'Süresi doldu'}
                    tone={selected.is_active ? 'success' : 'neutral'}
                  />
                  {selected.is_featured ? <Badge label="Öne çıkan" tone="accent" /> : null}
                  {selected.report_count > 0 ? (
                    <Badge label={`${selected.report_count} şikâyet`} tone="danger" />
                  ) : null}
                </View>
                <View style={styles.metaGrid}>
                  <Meta label="Hikâye ID" value={selected.id} mono />
                  <Meta label="Oluşturulma" value={formatDateTr(selected.created_at)} />
                  <Meta label="Bitiş" value={formatDateTr(selected.expires_at)} />
                  <Meta label="Medya türü" value={selected.media_type} />
                </View>
                {selected.caption ? (
                  <View style={[styles.bodyBox, { backgroundColor: theme.colors.surfaceMuted }]}>
                    <AppText variant="body">{selected.caption}</AppText>
                  </View>
                ) : null}
                <View style={styles.actionGrid}>
                  <ActionButton
                    icon={
                      selected.moderation_status === 'hidden' ? 'eye-outline' : 'eye-off-outline'
                    }
                    label={
                      selected.moderation_status === 'hidden'
                        ? 'Gizlemeyi kaldır'
                        : 'Hikâyeyi gizle'
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
                        : 'Hikâyeyi kaldır'
                    }
                    tone="danger"
                    onPress={() =>
                      setPending(selected.moderation_status === 'removed' ? 'restore' : 'remove')
                    }
                  />
                  <ActionButton
                    icon="star-outline"
                    label={selected.is_featured ? 'Öne çıkarmayı kaldır' : 'Öne çıkar'}
                    onPress={() => setPending(selected.is_featured ? 'unfeature' : 'feature')}
                  />
                </View>
                <AppText variant="caption" color="textTertiary">
                  Hikâye içerikleri yalnızca moderasyon amacıyla incelenir. Özel hesap erişim
                  kuralları bu ekrandan değiştirilemez.
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
            ? 'Hikâyeyi kaldır'
            : pending === 'hide'
              ? 'Hikâyeyi gizle'
              : 'Hikâye ayarını değiştir'
        }
        description="İşlem hikâye sahibine bildirilir ve denetim kaydına yazılır."
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
  cell: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
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
  drawer: {
    width: '100%',
    maxWidth: 560,
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
  drawerContent: { padding: 14, gap: 11, paddingBottom: 40 },
  badgeRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  mediaPlaceholder: {
    height: 180,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meta: { minWidth: 120, flexGrow: 1, flexBasis: 130, gap: 1 },
  bodyBox: { borderRadius: 9, padding: 10 },
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
