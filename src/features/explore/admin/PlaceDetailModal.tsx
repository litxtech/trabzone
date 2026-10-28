import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Badge, Button } from '@/components/ui';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { LocationPickerModal } from '@/features/explore/components/LocationPickerModal';
import * as api from '@/features/explore/services/explore-service';
import {
  useAdminExploreMutation,
  useAdminPlaceDetail,
} from '@/features/explore/hooks/use-explore';
import type { AdminPlaceDetail, LatLng } from '@/features/explore/types';
import { publicMediaUrl } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminDetailModal, AdminEmptyState, AdminQueryState, DetailField } from './AdminExploreShared';
import { MergePlaceModal } from './MergePlaceModal';
import { PlaceEditorModal } from './PlaceEditorModal';
import {
  formatCoordinate,
  formatDate,
  formatNumber,
  MODERATION_STATUS_LABELS,
  PLACE_STATUS_LABELS,
  PLACE_STATUS_TONES,
  statusLabel,
  toneFor,
  VERIFICATION_LABELS,
  VERIFICATION_TONES,
} from './labels';

type Props = {
  placeId: string | null;
  canManage: boolean;
  canModerate: boolean;
  onClose: () => void;
};

export function PlaceDetailModal({ placeId, canManage, canModerate, onClose }: Props) {
  const { theme } = useTheme();
  const detail = useAdminPlaceDetail(placeId);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [verifyDialog, setVerifyDialog] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<string | null>(null);

  const statusMutation = useAdminExploreMutation(
    (input: { id: string; status: string; reason: string }) =>
      api.adminSetPlaceStatus(input.id, input.status, input.reason),
  );
  const verifyMutation = useAdminExploreMutation(
    (input: { id: string; verified: boolean; reason: string }) =>
      api.adminVerifyPlace(input.id, input.verified, input.reason),
  );
  const moveMutation = useAdminExploreMutation(
    (input: { id: string; point: LatLng }) =>
      api.adminMovePlace(input.id, input.point.lat, input.point.lng, 'Harita yönetimi konum düzeltmesi'),
  );
  const mediaMutation = useAdminExploreMutation(
    (input: { id: string; decision: 'approve' | 'reject' }) =>
      api.adminReviewPlaceMedia(input.id, input.decision, 'Harita yönetimi medya incelemesi'),
  );

  const data = detail.data;
  const pendingClaims = data?.claims.filter((claim) => claim.status === 'pending').length ?? 0;

  const refresh = () => void detail.refetch();

  return (
    <>
      <AdminDetailModal
        visible={Boolean(placeId)}
        title={data?.name ?? 'İşletme detayı'}
        subtitle={
          data
            ? `${data.category?.name ?? 'Kategori yok'} · ${[data.district, data.neighborhood].filter(Boolean).join(' / ') || 'Konum yok'}`
            : 'Sunucudan yükleniyor…'
        }
        onClose={onClose}
        footer={
          <>
            <Button label="Kapat" size="sm" variant="secondary" fullWidth={false} onPress={onClose} />
            {canModerate && data ? (
              <Button
                label={data.is_verified ? 'Doğrulamayı kaldır' : 'İşletmeyi doğrula'}
                size="sm"
                variant={data.is_verified ? 'outline' : 'primary'}
                fullWidth={false}
                onPress={() => setVerifyDialog(true)}
              />
            ) : null}
            {canManage && data ? (
              <>
                <Button
                  label="Konumu düzelt"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setPickerOpen(true)}
                />
                <Button
                  label="Durum değiştir"
                  size="sm"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => setStatusOpen(true)}
                />
                <Button label="Düzenle" size="sm" fullWidth={false} onPress={() => setEditing(true)} />
                <Button
                  label="Mükerrer birleştir"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  onPress={() => setMergeOpen(true)}
                />
              </>
            ) : null}
          </>
        }
      >
        <AdminQueryState
          loading={detail.isLoading}
          error={detail.isError ? detail.error.message : null}
          onRetry={refresh}
        >
          {data ? (
            <>
              <View style={styles.badges}>
                <Badge
                  label={statusLabel(data.status, PLACE_STATUS_LABELS)}
                  tone={toneFor(data.status, PLACE_STATUS_TONES)}
                />
                <Badge
                  label={statusLabel(data.verification_status, VERIFICATION_LABELS)}
                  tone={toneFor(data.verification_status, VERIFICATION_TONES)}
                />
                {pendingClaims > 0 ? (
                  <Badge label={`${pendingClaims} sahiplenme bekliyor`} tone="warning" />
                ) : null}
              </View>

              <View style={styles.factGrid}>
                <DetailField label="Kategori" value={data.category?.name ?? '—'} />
                <DetailField
                  label="İlçe / mahalle"
                  value={[data.district, data.neighborhood].filter(Boolean).join(' / ') || '—'}
                />
                <DetailField label="Adres" value={data.address || '—'} />
                <DetailField label="Açık adres" value={data.address_public ? 'Herkese açık' : 'Gizli'} />
                <DetailField
                  label="Konum"
                  value={`${formatCoordinate(data.lat)}, ${formatCoordinate(data.lng)}`}
                  mono
                />
                <DetailField label="Telefon" value={data.phone || '—'} mono />
                <DetailField label="Web sitesi" value={data.website || '—'} />
                <DetailField label="Sahip" value={data.owner ? `@${data.owner.username}` : 'Sahipsiz'} />
                <DetailField label="Veri kaynağı" value={data.data_source || '—'} />
                <DetailField
                  label="Puan / yorum"
                  value={`${data.rating_avg != null ? data.rating_avg.toFixed(1) : '—'} · ${formatNumber(data.review_count)}`}
                />
                <DetailField
                  label="Medya"
                  value={`${formatNumber(data.photo_count)} foto · ${formatNumber(data.video_count)} video`}
                />
                <DetailField label="Son güncelleme" value={formatDate(data.updated_at)} />
              </View>

              {data.description ? (
                <View style={[styles.description, { borderColor: theme.colors.border }]}>
                  <AppText variant="caption" color="textTertiary">
                    Açıklama
                  </AppText>
                  <AppText variant="body" color="textSecondary">
                    {data.description}
                  </AppText>
                </View>
              ) : null}

              <Section title={`Medya (${data.media.length})`}>
                {data.media.length === 0 ? (
                  <AdminEmptyState
                    icon="image-outline"
                    title="Medya yok"
                    text="Bu işletme için henüz yüklenmiş fotoğraf veya video yok."
                    tone="neutral"
                  />
                ) : (
                  <View style={styles.mediaGrid}>
                    {data.media.map((item) => {
                      const url = publicMediaUrl('place-media', item.storage_path);
                      return (
                        <View
                          key={item.id}
                          style={[styles.mediaCard, { borderColor: theme.colors.border }]}
                        >
                          <View style={[styles.mediaThumb, { backgroundColor: theme.colors.surfaceMuted }]}>
                            {item.kind === 'image' && url ? (
                              <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                            ) : (
                              <Ionicons
                                name={item.kind === 'video' ? 'videocam-outline' : 'image-outline'}
                                size={24}
                                color={theme.colors.textTertiary}
                              />
                            )}
                          </View>
                          <View style={styles.mediaMeta}>
                            <Badge
                              label={statusLabel(item.status, MODERATION_STATUS_LABELS)}
                              tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}
                            />
                            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                              {item.caption || (item.kind === 'video' ? 'Video' : 'Fotoğraf')}
                            </AppText>
                          </View>
                          {item.status === 'pending' && canModerate ? (
                            <View style={styles.mediaActions}>
                              <SmallAction
                                label="Onayla"
                                icon="checkmark"
                                onPress={() =>
                                  mediaMutation.mutate(
                                    { id: item.id, decision: 'approve' },
                                    {
                                      onSuccess: refresh,
                                      onError: (cause) => Alert.alert('Onaylanamadı', cause.message),
                                    },
                                  )
                                }
                              />
                              <SmallAction
                                label="Reddet"
                                icon="close"
                                destructive
                                onPress={() =>
                                  mediaMutation.mutate(
                                    { id: item.id, decision: 'reject' },
                                    {
                                      onSuccess: refresh,
                                      onError: (cause) => Alert.alert('Reddedilemedi', cause.message),
                                    },
                                  )
                                }
                              />
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                )}
              </Section>

              <Section title={`Sahiplenme talepleri (${data.claims.length})`}>
                {data.claims.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Sahiplenme talebi yok.
                  </AppText>
                ) : (
                  data.claims.map((claim) => (
                    <View key={claim.id} style={[styles.row, { borderColor: theme.colors.border }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="bodyStrong">
                          {claim.applicant ? `@${claim.applicant}` : 'Başvuran bilgisi'} · {claim.evidence_type}
                        </AppText>
                        <AppText variant="caption" color="textSecondary">
                          {claim.evidence_text}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {formatDate(claim.created_at)}
                        </AppText>
                      </View>
                      <Badge
                        label={claim.status === 'approved' ? 'Onaylandı' : claim.status === 'pending' ? 'Bekliyor' : 'Reddedildi'}
                        tone={claim.status === 'approved' ? 'success' : claim.status === 'pending' ? 'warning' : 'danger'}
                      />
                    </View>
                  ))
                )}
              </Section>

              <Section title={`Son yorumlar (${data.reviews.length})`}>
                {data.reviews.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Yorum yok.
                  </AppText>
                ) : (
                  data.reviews.map((review) => (
                    <View key={review.id} style={[styles.row, { borderColor: theme.colors.border }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="caption" color="textSecondary">
                          {review.author ? `@${review.author}` : 'Kullanıcı'} · {review.rating} yıldız
                        </AppText>
                        <AppText variant="caption" color="textTertiary" numberOfLines={3}>
                          {review.body || 'Metin yok'}
                        </AppText>
                      </View>
                      <Badge label={review.status} tone={review.status === 'visible' || review.status === 'published' ? 'success' : 'warning'} />
                    </View>
                  ))
                )}
              </Section>
            </>
          ) : null}
        </AdminQueryState>
      </AdminDetailModal>

      {data ? (
        <>
          <PlaceEditorModal
            visible={editing}
            initial={data as AdminPlaceDetail}
            canManage={canManage}
            onClose={() => setEditing(false)}
            onSaved={(message) => {
              Alert.alert('Kaydedildi', message);
              refresh();
            }}
          />
          {mergeOpen ? (
            <MergePlaceModal
              source={data}
              onClose={() => setMergeOpen(false)}
              onMerged={() => {
                setMergeOpen(false);
                refresh();
                onClose();
              }}
            />
          ) : null}
          <LocationPickerModal
            visible={pickerOpen}
            initial={{ lat: data.lat, lng: data.lng }}
            title="İşletme konumunu düzelt"
            confirmLabel="Konumu kaydet"
            onClose={() => setPickerOpen(false)}
            onConfirm={(next) => {
              moveMutation.mutate(
                { id: data.id, point: next },
                {
                  onSuccess: () => {
                    setPickerOpen(false);
                    refresh();
                  },
                  onError: (cause) => Alert.alert('Konum güncellenemedi', cause.message),
                },
              );
            }}
          />
        </>
      ) : null}

      <ActionSheet
        visible={statusOpen}
        title="Yayın durumunu değiştir"
        message="Durum değişikliği gerekçesiyle birlikte denetim kaydına yazılır."
        items={['published', 'pending', 'draft', 'rejected', 'archived']
          .filter((item) => item !== data?.status)
          .map((item) => ({
            key: item,
            label: PLACE_STATUS_LABELS[item] ?? item,
            icon: 'swap-horizontal-outline' as const,
          }))}
        onSelect={(key) => {
          setStatusOpen(false);
          setStatusTarget(key);
        }}
        onClose={() => setStatusOpen(false)}
      />

      <ReasonDialog
        visible={verifyDialog}
        title={data?.is_verified ? 'Doğrulamayı kaldır' : 'İşletmeyi doğrula'}
        description={
          data?.is_verified
            ? 'Doğrulama kaldırıldığında işletme doğrulanmış rozetini kaybeder.'
            : 'Yalnızca gerçek sahiplik veya işletme belgesi incelendikten sonra onaylayın.'
        }
        confirmLabel={data?.is_verified ? 'Doğrulamayı kaldır' : 'Doğrula'}
        destructive={Boolean(data?.is_verified)}
        loading={verifyMutation.isPending}
        onCancel={() => setVerifyDialog(false)}
        onConfirm={({ reason }) => {
          if (!data) return;
          verifyMutation.mutate(
            { id: data.id, verified: !data.is_verified, reason },
            {
              onSuccess: () => {
                setVerifyDialog(false);
                refresh();
              },
              onError: (cause) => Alert.alert('İşlem tamamlanamadı', cause.message),
            },
          );
        }}
      />

      <ReasonDialog
        visible={Boolean(statusTarget)}
        title="Yayın durumunu güncelle"
        description={
          statusTarget
            ? `Yeni durum: ${PLACE_STATUS_LABELS[statusTarget] ?? statusTarget}.`
            : undefined
        }
        confirmLabel="Durumu uygula"
        destructive={statusTarget === 'rejected' || statusTarget === 'archived'}
        loading={statusMutation.isPending}
        onCancel={() => setStatusTarget(null)}
        onConfirm={({ reason }) => {
          if (!data || !statusTarget) return;
          statusMutation.mutate(
            { id: data.id, status: statusTarget, reason },
            {
              onSuccess: () => {
                setStatusTarget(null);
                refresh();
              },
              onError: (cause) => Alert.alert('Durum güncellenemedi', cause.message),
            },
          );
        }}
      />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.section, { borderColor: theme.colors.divider }]}>
      <AppText variant="title">{title}</AppText>
      {children}
    </View>
  );
}

function SmallAction({
  label,
  icon,
  onPress,
  destructive,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  destructive?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallAction,
        {
          borderColor: destructive ? theme.colors.danger : theme.colors.border,
          backgroundColor: pressed
            ? destructive
              ? theme.colors.dangerSoft
              : theme.colors.primarySoft
            : theme.colors.surface,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={13}
        color={destructive ? theme.colors.danger : theme.colors.primaryDeep}
      />
      <AppText variant="caption" color={destructive ? 'danger' : 'primaryDeep'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  description: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  section: { paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 9 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  mediaCard: {
    width: 162,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  mediaThumb: { height: 96, alignItems: 'center', justifyContent: 'center' },
  mediaMeta: { padding: 7, gap: 4 },
  mediaActions: { flexDirection: 'row', gap: 5, paddingHorizontal: 7, paddingBottom: 7 },
  smallAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
