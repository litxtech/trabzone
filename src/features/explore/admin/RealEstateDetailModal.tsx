import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Badge, Button } from '@/components/ui';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import {
  useAdminExploreMutation,
  useAdminRealEstateDetail,
} from '@/features/explore/hooks/use-explore';
import * as api from '@/features/explore/services/explore-service';
import { formatPrice } from '@/features/explore/utils/format';
import { publicMediaUrl } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminDetailModal, AdminEmptyState, AdminQueryState, DetailField } from './AdminExploreShared';
import {
  EIDS_LABELS,
  EIDS_TONES,
  formatDate,
  formatNumber,
  LISTING_KIND_LABELS,
  MODERATION_STATUS_LABELS,
  OWNER_TYPE_LABELS,
  RE_STATUS_LABELS,
  RE_STATUS_TONES,
  statusLabel,
  toneFor,
  VERIFICATION_LABELS,
  VERIFICATION_TONES,
} from './labels';

type Props = {
  listingId: string | null;
  canPublish: boolean;
  canModerate: boolean;
  onClose: () => void;
};

export function RealEstateDetailModal({ listingId, canPublish, canModerate, onClose }: Props) {
  const { theme } = useTheme();
  const query = useAdminRealEstateDetail(listingId);
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const publish = useAdminExploreMutation((input: { id: string; days: number }) =>
    api.adminPublishRealEstate(input.id, input.days),
  );
  const statusMutation = useAdminExploreMutation(
    (input: { id: string; status: string; reason: string }) =>
      api.adminSetRealEstateStatus(input.id, input.status, input.reason),
  );
  const mediaMutation = useAdminExploreMutation(
    (input: { id: string; decision: 'approve' | 'reject' }) =>
      api.adminReviewRealEstateMedia(input.id, input.decision, 'Emlak medyası moderasyonu'),
  );

  const data = query.data;
  const approvedImages = data?.media.filter((item) => item.status === 'approved' && item.kind === 'image').length ?? 0;
  const publishEligible =
    Boolean(data) &&
    data?.eids_enabled === true &&
    data?.verification_status === 'verified' &&
    data?.eids_status === 'verified' &&
    approvedImages > 0 &&
    ['pending_verification', 'pending_moderation', 'rejected', 'expired'].includes(data?.status ?? '');

  const refresh = () => void query.refetch();

  return (
    <>
      <AdminDetailModal
        visible={Boolean(listingId)}
        title={data?.title ?? 'Emlak ilanı'}
        subtitle={
          data
            ? `${statusLabel(data.listing_kind, LISTING_KIND_LABELS)} · ${data.category?.name ?? 'Kategori yok'} · ${[data.district, data.neighborhood].filter(Boolean).join(' / ') || 'Konum yok'}`
            : 'Sunucudan yükleniyor…'
        }
        onClose={onClose}
        maxWidth={860}
        footer={
          <>
            <Button label="Kapat" size="sm" variant="secondary" fullWidth={false} onPress={onClose} />
            {canModerate && data ? (
              <Button
                label="Durum değiştir"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={() => setStatusOpen(true)}
              />
            ) : null}
            {canPublish && data ? (
              <Button
                label="İlanı yayınla"
                size="sm"
                fullWidth={false}
                disabled={!publishEligible}
                onPress={() => setPublishOpen(true)}
              />
            ) : null}
          </>
        }
      >
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={refresh}
        >
          {data ? (
            <>
              <View style={styles.badges}>
                <Badge
                  label={statusLabel(data.status, RE_STATUS_LABELS)}
                  tone={toneFor(data.status, RE_STATUS_TONES)}
                />
                <Badge
                  label={statusLabel(data.verification_status, VERIFICATION_LABELS)}
                  tone={toneFor(data.verification_status, VERIFICATION_TONES)}
                />
                <Badge
                  label={statusLabel(data.eids_status, EIDS_LABELS)}
                  tone={toneFor(data.eids_status, EIDS_TONES)}
                />
                {data.eids_enabled ? null : <Badge label="EİDS anahtarı kapalı" tone="danger" />}
              </View>

              <View style={styles.factGrid}>
                <DetailField
                  label="Fiyat"
                  value={formatPrice(data.price_cents, data.currency, data.price_period)}
                />
                <DetailField label="İlan türü" value={LISTING_KIND_LABELS[data.listing_kind] ?? data.listing_kind} />
                <DetailField label="Sahip türü" value={OWNER_TYPE_LABELS[data.owner_type] ?? data.owner_type} />
                <DetailField
                  label="İlan sahibi"
                  value={data.owner ? `@${data.owner.username}` : '—'}
                />
                <DetailField label="İlçe / mahalle" value={[data.district, data.neighborhood].filter(Boolean).join(' / ') || '—'} />
                <DetailField label="Açık adres (özel)" value={data.address_private || data.address_text || '—'} />
                <DetailField
                  label="Gerçek konum"
                  value={`${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`}
                  mono
                />
                <DetailField
                  label="Herkese açık konum"
                  value={
                    data.public_lat != null && data.public_lng != null
                      ? `${data.public_lat.toFixed(6)}, ${data.public_lng.toFixed(6)}`
                      : 'Yok'
                  }
                  mono
                />
                <DetailField label="Konum gizleme" value={data.hide_exact_location ? 'Açık (yaklaşık)' : 'Kapalı'} />
                <DetailField
                  label="Alan"
                  value={[data.gross_m2 ? `${formatNumber(data.gross_m2)} brüt` : null, data.net_m2 ? `${formatNumber(data.net_m2)} net` : null]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                />
                <DetailField label="Oda" value={data.room_count != null ? String(data.room_count) : '—'} />
                <DetailField label="Bina yaşı" value={data.building_age != null ? String(data.building_age) : '—'} />
                <DetailField label="Görüntülenme" value={`${formatNumber(data.view_count)} · ${formatNumber(data.favorite_count)} favori`} />
                <DetailField label="Yayın tarihi" value={formatDate(data.published_at)} />
                <DetailField label="Bitiş tarihi" value={formatDate(data.expires_at)} />
                <DetailField label="Oluşturulma" value={formatDate(data.created_at)} />
              </View>

              {data.rejection_reason ? (
                <View style={[styles.notice, { backgroundColor: theme.colors.dangerSoft }]}>
                  <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
                  <AppText variant="caption" color="danger" style={{ flex: 1 }}>
                    Ret gerekçesi: {data.rejection_reason}
                  </AppText>
                </View>
              ) : null}

              {!publishEligible && data.status !== 'published' ? (
                <View style={[styles.notice, { backgroundColor: theme.colors.warningSoft }]}>
                  <Ionicons name="shield-outline" size={16} color={theme.colors.warning} />
                  <AppText variant="caption" color="textSecondary" style={{ flex: 1 }}>
                    Yayın koşulları: EİDS anahtarı etkin, kimlik + yetki doğrulaması onaylı ve en az
                    bir onaylı fotoğraf. Eksik olan koşul tamamlanmadan yayınlama sunucu tarafında da
                    reddedilir.
                  </AppText>
                </View>
              ) : null}

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
                    text="Yayın için en az bir onaylı fotoğraf gerekir."
                    tone="neutral"
                  />
                ) : (
                  <View style={styles.mediaGrid}>
                    {data.media.map((item) => {
                      const url = publicMediaUrl('real-estate-media', item.storage_path);
                      return (
                        <View key={item.id} style={[styles.mediaCard, { borderColor: theme.colors.border }]}>
                          <View style={[styles.mediaThumb, { backgroundColor: theme.colors.surfaceMuted }]}>
                            {item.kind === 'image' && url ? (
                              <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                            ) : (
                              <Ionicons name="videocam-outline" size={24} color={theme.colors.textTertiary} />
                            )}
                            {item.cover ? (
                              <View style={[styles.coverBadge, { backgroundColor: theme.colors.primary }]}>
                                <Ionicons name="star" size={10} color={theme.colors.onPrimary} />
                              </View>
                            ) : null}
                          </View>
                          <View style={{ padding: 7, gap: 4 }}>
                            <Badge
                              label={statusLabel(item.status, MODERATION_STATUS_LABELS)}
                              tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}
                            />
                            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                              {item.kind === 'video' ? 'Video' : 'Fotoğraf'}
                            </AppText>
                            {item.status === 'pending' && canModerate ? (
                              <View style={styles.mediaActions}>
                                <Button
                                  label="Onayla"
                                  size="sm"
                                  variant="secondary"
                                  fullWidth={false}
                                  onPress={() =>
                                    mediaMutation.mutate(
                                      { id: item.id, decision: 'approve' },
                                      { onSuccess: refresh, onError: (cause) => Alert.alert('Onaylanamadı', cause.message) },
                                    )
                                  }
                                />
                                <Button
                                  label="Reddet"
                                  size="sm"
                                  variant="outline"
                                  fullWidth={false}
                                  onPress={() =>
                                    mediaMutation.mutate(
                                      { id: item.id, decision: 'reject' },
                                      { onSuccess: refresh, onError: (cause) => Alert.alert('Reddedilemedi', cause.message) },
                                    )
                                  }
                                />
                              </View>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </Section>

              <Section title={`EİDS doğrulama geçmişi (${data.verifications.length})`}>
                {data.verifications.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Doğrulama kaydı yok.
                  </AppText>
                ) : (
                  data.verifications.map((item) => (
                    <View key={item.id} style={[styles.row, { borderColor: theme.colors.border }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="bodyStrong">
                          {item.kind} · {item.reference_no || 'Referans yok'}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {formatDate(item.created_at)} · {item.note || 'Not yok'}
                        </AppText>
                        <AppText variant="caption" color="textTertiary" style={styles.mono}>
                          Belge yolu: {item.document_path || 'yok'}
                        </AppText>
                      </View>
                      <Badge
                        label={item.status === 'approved' ? 'Onaylı' : item.status === 'pending' ? 'Bekliyor' : 'Reddedildi'}
                        tone={item.status === 'approved' ? 'success' : item.status === 'pending' ? 'warning' : 'danger'}
                      />
                    </View>
                  ))
                )}
              </Section>

              <Section title={`Moderasyon geçmişi (${data.moderation.length})`}>
                {data.moderation.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Moderasyon kaydı yok.
                  </AppText>
                ) : (
                  data.moderation.map((item) => (
                    <View key={item.id} style={[styles.row, { borderColor: theme.colors.border }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="caption" color="textSecondary">
                          {item.action} · {formatDate(item.created_at)}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {item.reason || 'Gerekçe yok'}
                        </AppText>
                      </View>
                    </View>
                  ))
                )}
              </Section>

              {data.reports.length > 0 ? (
                <Section title={`Şikâyetler (${data.reports.length})`}>
                  {data.reports.map((item) => (
                    <View key={item.id} style={[styles.row, { borderColor: theme.colors.border }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="caption" color="textSecondary">
                          {item.reason} · {formatDate(item.created_at)}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {item.details || 'Detay yok'}
                        </AppText>
                      </View>
                      <Badge label={item.status} tone={item.status === 'pending' ? 'warning' : 'neutral'} />
                    </View>
                  ))}
                </Section>
              ) : null}
            </>
          ) : null}
        </AdminQueryState>
      </AdminDetailModal>

      <ActionSheet
        visible={statusOpen}
        title="İlan durumunu değiştir"
        message="Ret, kaldırma ve arşiv işlemlerinde gerekçe zorunludur."
        items={['pending_verification', 'pending_moderation', 'rejected', 'expired', 'archived', 'removed']
          .filter((item) => item !== data?.status)
          .map((item) => ({
            key: item,
            label: RE_STATUS_LABELS[item] ?? item,
            icon: 'swap-horizontal-outline' as const,
            destructive: item === 'rejected' || item === 'removed',
          }))}
        onSelect={(key) => {
          setStatusOpen(false);
          setStatusTarget(key);
        }}
        onClose={() => setStatusOpen(false)}
      />

      <ReasonDialog
        visible={Boolean(statusTarget)}
        title="İlan durumunu güncelle"
        description={
          statusTarget ? `Yeni durum: ${RE_STATUS_LABELS[statusTarget] ?? statusTarget}.` : undefined
        }
        confirmLabel="Durumu uygula"
        destructive={statusTarget === 'rejected' || statusTarget === 'removed'}
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

      <ReasonDialog
        visible={publishOpen}
        title="İlanı yayınla"
        description={
          data
            ? `${data.title} yayınlanacak. EİDS doğrulaması ve onaylı medya sunucuda yeniden kontrol edilir.`
            : undefined
        }
        confirmLabel="Yayınla"
        loading={publish.isPending}
        onCancel={() => setPublishOpen(false)}
        onConfirm={() => {
          if (!data) return;
          publish.mutate(
            { id: data.id, days: 60 },
            {
              onSuccess: () => {
                setPublishOpen(false);
                refresh();
              },
              onError: (cause) => Alert.alert('Yayınlanamadı', cause.message),
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

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10 },
  description: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  section: { paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 9 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  mediaCard: {
    width: 166,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  mediaThumb: { height: 100, alignItems: 'center', justifyContent: 'center' },
  coverBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaActions: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mono: { fontFamily: 'monospace' },
});
