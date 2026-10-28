import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import {
  useAdminClaims,
  useAdminExploreMutation,
  useAdminPlaceMedia,
  useAdminPlaceReviews,
  useAdminReports,
  useAdminSuggestions,
  useExploreBootstrap,
} from '@/features/explore/hooks/use-explore';
import * as api from '@/features/explore/services/explore-service';
import { publicMediaUrl } from '@/features/media/media-service';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminEmptyState, AdminQueryState } from './AdminExploreShared';
import {
  CLAIM_STATUS_LABELS,
  formatDate,
  formatNumber,
  MODERATION_STATUS_LABELS,
  REPORT_REASON_LABELS,
  REPORT_TARGET_LABELS,
  statusLabel,
  SUGGESTION_STATUS_LABELS,
} from './labels';

type ReviewTarget =
  | { kind: 'suggestion'; id: string; decision: 'approve' | 'reject' | 'duplicate'; title: string }
  | { kind: 'claim'; id: string; decision: 'approve' | 'reject'; title: string }
  | { kind: 'media'; id: string; decision: 'approve' | 'reject'; title: string }
  | { kind: 'review'; id: string; decision: 'hide' | 'delete'; title: string }
  | { kind: 'report'; id: string; decision: 'resolve' | 'dismiss'; title: string };

export function SuggestionsPanel({ canModerate }: { canModerate: boolean }) {
  const { theme } = useTheme();
  const bootstrap = useExploreBootstrap();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'duplicate'>('pending');
  const query = useAdminSuggestions(status);
  const mutation = useAdminExploreMutation(
    (input: { id: string; decision: 'approve' | 'reject' | 'duplicate'; note: string }) =>
      api.adminReviewSuggestion(input.id, input.decision, input.note),
  );
  const [dialog, setDialog] = useState<Extract<ReviewTarget, { kind: 'suggestion' }> | null>(null);

  const districtName = (id: number) =>
    bootstrap.data?.districts.find((item) => item.id === id)?.name ?? `#${id}`;

  return (
    <>
      <AdminSection
        title="Kullanıcı yer önerileri"
        subtitle="Onaylanan öneri yayınlanmış işletme olur. Mükerrer veya yetersiz kayıt reddedilir."
        action={<Badge label={`${formatNumber(query.data?.total ?? 0)} kayıt`} tone="primary" />}
      >
        <FilterChips
          options={[
            { key: 'pending', label: 'Bekleyen' },
            { key: 'approved', label: 'Onaylanan' },
            { key: 'rejected', label: 'Reddedilen' },
            { key: 'duplicate', label: 'Mükerrer' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {(query.data?.items.length ?? 0) === 0 ? (
            <AdminEmptyState
              icon="location-outline"
              title="Bekleyen yer önerisi yok"
              text="Kullanıcıların haritaya eklediği yeni yerler burada listelenir."
            />
          ) : (
            <View style={styles.list}>
              {query.data?.items.map((item) => {
                const payload = item.payload;
                const photos = payload.photo_paths ?? [];
                const videos = payload.video_paths ?? [];
                return (
                  <View key={item.id} style={[styles.card, { borderColor: theme.colors.border }]}>
                    <View style={styles.cardHead}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <AppText variant="bodyStrong">{payload.name}</AppText>
                        <AppText variant="caption" color="textTertiary">
                          {payload.category_slug} · {districtName(payload.district_id)} ·{' '}
                          {payload.address || 'Adres yok'}
                        </AppText>
                        <AppText variant="caption" color="textTertiary" style={styles.mono}>
                          {payload.lat.toFixed(5)}, {payload.lng.toFixed(5)} · {item.submitter ? `@${item.submitter}` : 'Kullanıcı'} ·{' '}
                          {formatDate(item.created_at)}
                        </AppText>
                      </View>
                      <Badge
                        label={statusLabel(item.status, SUGGESTION_STATUS_LABELS)}
                        tone={item.status === 'approved' ? 'success' : item.status === 'pending' ? 'warning' : 'neutral'}
                      />
                    </View>

                    {payload.description ? (
                      <AppText variant="caption" color="textSecondary" numberOfLines={3}>
                        {payload.description}
                      </AppText>
                    ) : null}

                    {photos.length + videos.length > 0 ? (
                      <View style={styles.mediaRow}>
                        {photos.slice(0, 4).map((path) => {
                          const url = publicMediaUrl('place-media', path);
                          return (
                            <View key={path} style={[styles.thumb, { backgroundColor: theme.colors.surfaceMuted }]}>
                              {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                            </View>
                          );
                        })}
                        {videos.length > 0 ? (
                          <Badge label={`${videos.length} video`} tone="accent" />
                        ) : null}
                      </View>
                    ) : null}

                    {item.status === 'pending' ? (
                      <View style={styles.actions}>
                        <Button
                          label="Onayla ve yayınla"
                          size="sm"
                          variant="primary"
                          fullWidth={false}
                          disabled={!canModerate}
                          onPress={() =>
                            setDialog({ kind: 'suggestion', id: item.id, decision: 'approve', title: payload.name })
                          }
                        />
                        <Button
                          label="Mükerrer"
                          size="sm"
                          variant="outline"
                          fullWidth={false}
                          disabled={!canModerate}
                          onPress={() =>
                            setDialog({ kind: 'suggestion', id: item.id, decision: 'duplicate', title: payload.name })
                          }
                        />
                        <Button
                          label="Reddet"
                          size="sm"
                          variant="outline"
                          fullWidth={false}
                          disabled={!canModerate}
                          onPress={() =>
                            setDialog({ kind: 'suggestion', id: item.id, decision: 'reject', title: payload.name })
                          }
                        />
                      </View>
                    ) : (
                      <AppText variant="caption" color="textTertiary">
                        {item.review_note || 'İnceleme notu yok.'}
                      </AppText>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </AdminQueryState>
      </AdminSection>

      <ReasonDialog
        visible={dialog !== null}
        title={
          dialog?.decision === 'approve'
            ? 'Yer önerisini onayla'
            : dialog?.decision === 'duplicate'
              ? 'Mükerrer olarak işaretle'
              : 'Yer önerisini reddet'
        }
        description={
          dialog
            ? `${dialog.title} için kararın kullanıcıya bildirilecek ve denetim kaydına yazılacak.`
            : undefined
        }
        confirmLabel={dialog?.decision === 'approve' ? 'Onayla ve yayınla' : 'Kararı uygula'}
        destructive={dialog?.decision === 'reject'}
        loading={mutation.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={({ reason }) => {
          if (!dialog) return;
          mutation.mutate(
            { id: dialog.id, decision: dialog.decision, note: reason },
            {
              onSuccess: () => {
                setDialog(null);
                void query.refetch();
              },
              onError: (cause) => Alert.alert('İşlem tamamlanamadı', cause.message),
            },
          );
        }}
      />
    </>
  );
}

export function ClaimsPanel({ canModerate }: { canModerate: boolean }) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const query = useAdminClaims(status);
  const mutation = useAdminExploreMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note: string }) =>
      api.adminReviewClaim(input.id, input.decision, input.note),
  );
  const [dialog, setDialog] = useState<Extract<ReviewTarget, { kind: 'claim' }> | null>(null);

  return (
    <>
      <AdminSection
        title="İşletme sahiplenme başvuruları"
        subtitle="Telefon numarası bilmek tek başına doğrulama sayılmaz. Belge ve kayıt kanıtı birlikte incelenmelidir."
        action={<Badge label={`${formatNumber(query.data?.total ?? 0)} başvuru`} tone="primary" />}
      >
        <FilterChips
          options={[
            { key: 'pending', label: 'Bekleyen' },
            { key: 'approved', label: 'Onaylanan' },
            { key: 'rejected', label: 'Reddedilen' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {(query.data?.items.length ?? 0) === 0 ? (
            <AdminEmptyState
              icon="shield-checkmark-outline"
              title="Bekleyen sahiplenme yok"
              text="İşletme sahiplerinin doğrulama başvuruları burada görünür."
            />
          ) : (
            <View style={styles.list}>
              {query.data?.items.map((item) => (
                <View key={item.id} style={[styles.card, { borderColor: theme.colors.border }]}>
                  <View style={styles.cardHead}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodyStrong">{item.place_name}</AppText>
                      <AppText variant="caption" color="textTertiary">
                        {item.place_district || 'İlçe yok'} · Başvuran: {item.applicant ? `@${item.applicant}` : 'Bilinmiyor'}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {item.evidence_type} · {formatDate(item.created_at)}
                      </AppText>
                    </View>
                    <Badge
                      label={statusLabel(item.status, CLAIM_STATUS_LABELS)}
                      tone={item.status === 'approved' ? 'success' : item.status === 'pending' ? 'warning' : 'danger'}
                    />
                  </View>

                  <View style={[styles.evidence, { borderColor: theme.colors.divider }]}>
                    <AppText variant="caption" color="textTertiary">
                      Kanıt metni
                    </AppText>
                    <AppText variant="caption" color="textSecondary">
                      {item.evidence_text || '—'}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" style={styles.mono}>
                      Belge yolu: {item.document_path || 'yok'}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      İletişim: {item.contact_phone || '—'} · {item.contact_email || '—'}
                    </AppText>
                  </View>

                  {item.status === 'pending' ? (
                    <View style={styles.actions}>
                      <Button
                        label="Sahiplenmeyi onayla"
                        size="sm"
                        fullWidth={false}
                        disabled={!canModerate}
                        onPress={() => setDialog({ kind: 'claim', id: item.id, decision: 'approve', title: item.place_name })}
                      />
                      <Button
                        label="Reddet"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        disabled={!canModerate}
                        onPress={() => setDialog({ kind: 'claim', id: item.id, decision: 'reject', title: item.place_name })}
                      />
                    </View>
                  ) : (
                    <AppText variant="caption" color="textTertiary">
                      {item.review_note || 'İnceleme notu yok.'}
                    </AppText>
                  )}
                </View>
              ))}
            </View>
          )}
        </AdminQueryState>
      </AdminSection>

      <ReasonDialog
        visible={dialog !== null}
        title={dialog?.decision === 'approve' ? 'Sahiplenmeyi onayla' : 'Sahiplenmeyi reddet'}
        description={
          dialog
            ? `${dialog.title} için başvuru sahibi bilgilendirilecek ve bu karar denetim kaydına yazılacak.`
            : undefined
        }
        confirmLabel={dialog?.decision === 'approve' ? 'Onayla' : 'Reddet'}
        destructive={dialog?.decision === 'reject'}
        loading={mutation.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={({ reason }) => {
          if (!dialog) return;
          mutation.mutate(
            { id: dialog.id, decision: dialog.decision, note: reason },
            {
              onSuccess: () => {
                setDialog(null);
                void query.refetch();
              },
              onError: (cause) => Alert.alert('İşlem tamamlanamadı', cause.message),
            },
          );
        }}
      />
    </>
  );
}

export function PlaceMediaPanel({ canModerate }: { canModerate: boolean }) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const query = useAdminPlaceMedia(status);
  const mutation = useAdminExploreMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note: string }) =>
      api.adminReviewPlaceMedia(input.id, input.decision, input.note),
  );
  const [dialog, setDialog] = useState<Extract<ReviewTarget, { kind: 'media' }> | null>(null);

  return (
    <>
      <AdminSection
        title="İşletme medyası moderasyonu"
        subtitle="Kullanıcı fotoğrafları ve videoları. Reddedilen medya işletme galerisinde yayınlanmaz."
        action={<Badge label={`${query.data?.items.length ?? 0} medya`} tone="primary" />}
      >
        <FilterChips
          options={[
            { key: 'pending', label: 'Bekleyen' },
            { key: 'approved', label: 'Onaylanan' },
            { key: 'rejected', label: 'Reddedilen' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {(query.data?.items.length ?? 0) === 0 ? (
            <AdminEmptyState
              icon="images-outline"
              title="Bekleyen medya yok"
              text="Yeni yüklenen işletme fotoğraf ve videoları burada incelenir."
            />
          ) : (
            <View style={styles.mediaGrid}>
              {query.data?.items.map((item) => {
                const url = publicMediaUrl('place-media', item.storage_path);
                return (
                  <View key={item.id} style={[styles.mediaCard, { borderColor: theme.colors.border }]}>
                    <View style={[styles.mediaThumb, { backgroundColor: theme.colors.surfaceMuted }]}>
                      {item.kind === 'image' && url ? (
                        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <Ionicons name="videocam-outline" size={24} color={theme.colors.textTertiary} />
                      )}
                    </View>
                    <View style={{ padding: 8, gap: 4 }}>
                      <AppText variant="caption" numberOfLines={1}>
                        {item.place_name || item.listing_title || 'Medya'}
                      </AppText>
                      <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                        {item.caption || (item.uploader ? `@${item.uploader}` : 'Yükleyen bilinmiyor')}
                      </AppText>
                      <Badge
                        label={statusLabel(item.status, MODERATION_STATUS_LABELS)}
                        tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'warning'}
                      />
                      {item.status === 'pending' ? (
                        <View style={styles.actions}>
                          <SmallButton
                            label="Onayla"
                            disabled={!canModerate}
                            onPress={() => setDialog({ kind: 'media', id: item.id, decision: 'approve', title: item.place_name || 'Medya' })}
                          />
                          <SmallButton
                            label="Reddet"
                            disabled={!canModerate}
                            destructive
                            onPress={() => setDialog({ kind: 'media', id: item.id, decision: 'reject', title: item.place_name || 'Medya' })}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </AdminQueryState>
      </AdminSection>

      <ReasonDialog
        visible={dialog !== null}
        title={dialog?.decision === 'approve' ? 'Medyayı onayla' : 'Medyayı reddet'}
        description={dialog ? `${dialog.title} için karar denetim kaydına yazılacak.` : undefined}
        confirmLabel={dialog?.decision === 'approve' ? 'Onayla' : 'Reddet'}
        destructive={dialog?.decision === 'reject'}
        loading={mutation.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={({ reason }) => {
          if (!dialog) return;
          mutation.mutate(
            { id: dialog.id, decision: dialog.decision, note: reason },
            {
              onSuccess: () => {
                setDialog(null);
                void query.refetch();
              },
              onError: (cause) => Alert.alert('İşlem tamamlanamadı', cause.message),
            },
          );
        }}
      />
    </>
  );
}

export function PlaceReviewsPanel({ canModerate }: { canModerate: boolean }) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<'all' | 'visible' | 'hidden'>('all');
  const query = useAdminPlaceReviews(status === 'all' ? null : status);
  const mutation = useAdminExploreMutation(
    (input: { id: string; action: 'hide' | 'delete'; note: string }) =>
      api.adminModeratePlaceReview(input.id, input.action, input.note),
  );
  const [dialog, setDialog] = useState<Extract<ReviewTarget, { kind: 'review' }> | null>(null);

  return (
    <>
      <AdminSection
        title="İşletme yorumları"
        subtitle="İşletme sahipleri gerçek yorumları silemez. Yalnızca yetkili moderasyon gizleyebilir."
        action={<Badge label={`${query.data?.items.length ?? 0} yorum`} tone="primary" />}
      >
        <FilterChips
          options={[
            { key: 'all', label: 'Tümü' },
            { key: 'visible', label: 'Görünür' },
            { key: 'hidden', label: 'Gizlenen' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {(query.data?.items.length ?? 0) === 0 ? (
            <AdminEmptyState
              icon="chatbubble-outline"
              title="Yorum yok"
              text="Seçili durumda işletme yorumu bulunmuyor."
              tone="neutral"
            />
          ) : (
            <View style={styles.list}>
              {query.data?.items.map((item) => (
                <View key={item.id} style={[styles.card, { borderColor: theme.colors.border }]}>
                  <View style={styles.cardHead}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodyStrong">{item.place_name}</AppText>
                      <AppText variant="caption" color="textTertiary">
                        {item.author ? `@${item.author}` : 'Kullanıcı'} · {item.rating} yıldız · {formatDate(item.created_at)}
                      </AppText>
                    </View>
                    <Badge label={item.status} tone={item.status === 'hidden' ? 'warning' : 'success'} />
                  </View>
                  <AppText variant="caption" color="textSecondary">
                    {item.body || 'Yorum metni yok.'}
                  </AppText>
                  <View style={styles.actions}>
                    <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
                      {formatNumber(item.helpful_count)} faydalı bulma
                    </AppText>
                    {item.status !== 'hidden' ? (
                      <Button
                        label="Yorumu gizle"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        disabled={!canModerate}
                        onPress={() => setDialog({ kind: 'review', id: item.id, decision: 'hide', title: item.place_name })}
                      />
                    ) : null}
                    <Button
                      label="Kalıcı sil"
                      size="sm"
                      variant="danger"
                      fullWidth={false}
                      disabled={!canModerate}
                      onPress={() => setDialog({ kind: 'review', id: item.id, decision: 'delete', title: item.place_name })}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </AdminQueryState>
      </AdminSection>

      <ReasonDialog
        visible={dialog !== null}
        title={dialog?.decision === 'delete' ? 'Yorumu kalıcı sil' : 'Yorumu gizle'}
        description={dialog ? `${dialog.title} yorumuna uygulanacak işlem denetim kaydına yazılacak.` : undefined}
        confirmLabel={dialog?.decision === 'delete' ? 'Kalıcı sil' : 'Gizle'}
        destructive={dialog?.decision === 'delete'}
        loading={mutation.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={({ reason }) => {
          if (!dialog) return;
          mutation.mutate(
            { id: dialog.id, action: dialog.decision, note: reason },
            {
              onSuccess: () => {
                setDialog(null);
                void query.refetch();
              },
              onError: (cause) => Alert.alert('İşlem tamamlanamadı', cause.message),
            },
          );
        }}
      />
    </>
  );
}

export function ExploreReportsPanel({
  canModerate,
  scope = 'all',
}: {
  canModerate: boolean;
  /** Emlak yöneticisi yalnızca emlak hedefli bildirimleri görür. */
  scope?: 'all' | 'real_estate';
}) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<'pending' | 'resolved' | 'dismissed'>('pending');
  const query = useAdminReports(status);
  const items = (query.data?.items ?? []).filter(
    (item) => scope === 'all' || item.target_type.startsWith('real_estate'),
  );
  const mutation = useAdminExploreMutation(
    (input: { id: string; decision: 'resolve' | 'dismiss'; note: string }) =>
      api.adminReviewReport({
        reportId: input.id,
        decision: input.decision,
        action: input.decision === 'resolve' ? 'remove' : 'none',
        note: input.note,
      }),
  );
  const [dialog, setDialog] = useState<Extract<ReviewTarget, { kind: 'report' }> | null>(null);

  return (
    <>
      <AdminSection
        title={scope === 'real_estate' ? 'Emlak şikâyetleri' : 'Harita ve emlak şikâyetleri'}
        subtitle={
          scope === 'real_estate'
            ? 'Emlak ilanı ve medyasına gelen bildirimler. Kararlar denetim kaydına yazılır.'
            : 'İşletme, medya ve emlak ilanlarına gelen bildirimler. Kararlar denetim kaydına yazılır.'
        }
        action={<Badge label={`${items.length} bildirim`} tone="primary" />}
      >
        <FilterChips
          options={[
            { key: 'pending', label: 'Bekleyen' },
            { key: 'resolved', label: 'Çözülen' },
            { key: 'dismissed', label: 'Reddedilen' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <AdminQueryState
          loading={query.isLoading}
          error={query.isError ? query.error.message : null}
          onRetry={() => void query.refetch()}
        >
          {items.length === 0 ? (
            <AdminEmptyState
              icon="flag-outline"
              title="Bekleyen şikâyet yok"
              text={
                scope === 'real_estate'
                  ? 'Emlak içerikleriyle ilgili yeni bildirim bulunmuyor.'
                  : 'Harita ve emlak içerikleriyle ilgili yeni bildirim bulunmuyor.'
              }
            />
          ) : (
            <View style={styles.list}>
              {items.map((item) => (
                <View key={item.id} style={[styles.card, { borderColor: theme.colors.border }]}>
                  <View style={styles.cardHead}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodyStrong">
                        {REPORT_REASON_LABELS[item.reason] ?? item.reason}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {REPORT_TARGET_LABELS[item.target_type] ?? item.target_type} ·{' '}
                        {item.target_label || item.target_id.slice(0, 8)} ·{' '}
                        {item.reporter ? `@${item.reporter}` : 'Bildiren bilinmiyor'}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        {formatDate(item.created_at)}
                      </AppText>
                    </View>
                    <Badge label={item.status} tone={item.status === 'pending' ? 'warning' : 'neutral'} />
                  </View>
                  {item.details ? (
                    <AppText variant="caption" color="textSecondary">
                      {item.details}
                    </AppText>
                  ) : null}
                  {item.status === 'pending' ? (
                    <View style={styles.actions}>
                      <Button
                        label="Bildirimi kabul et ve içeriği kaldır"
                        size="sm"
                        fullWidth={false}
                        disabled={!canModerate}
                        onPress={() => setDialog({ kind: 'report', id: item.id, decision: 'resolve', title: item.target_label || item.target_type })}
                      />
                      <Button
                        label="Reddet"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        disabled={!canModerate}
                        onPress={() => setDialog({ kind: 'report', id: item.id, decision: 'dismiss', title: item.target_label || item.target_type })}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </AdminQueryState>
      </AdminSection>

      <ReasonDialog
        visible={dialog !== null}
        title={dialog?.decision === 'resolve' ? 'Şikâyeti kabul et' : 'Şikâyeti reddet'}
        description={
          dialog
            ? `${dialog.title} için karar denetim kaydına yazılacak. Kabul edilirse hedef içerik kaldırılır.`
            : undefined
        }
        confirmLabel={dialog?.decision === 'resolve' ? 'Kabul et ve kaldır' : 'Reddet'}
        destructive={dialog?.decision === 'resolve'}
        loading={mutation.isPending}
        onCancel={() => setDialog(null)}
        onConfirm={({ reason }) => {
          if (!dialog) return;
          mutation.mutate(
            { id: dialog.id, decision: dialog.decision, note: reason },
            {
              onSuccess: () => {
                setDialog(null);
                void query.refetch();
              },
              onError: (cause) => Alert.alert('İşlem tamamlanamadı', cause.message),
            },
          );
        }}
      />
    </>
  );
}

function SmallButton({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.smallButton,
        {
          borderColor: destructive ? theme.colors.danger : theme.colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <AppText variant="caption" color={destructive ? 'danger' : 'primaryDeep'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: {
    padding: 11,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  evidence: { paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, gap: 2 },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  thumb: { width: 62, height: 62, borderRadius: 8, overflow: 'hidden' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaCard: {
    width: 210,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  mediaThumb: { height: 126, alignItems: 'center', justifyContent: 'center' },
  smallButton: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  mono: { fontFamily: 'monospace' },
});
