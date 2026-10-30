import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAdminPharmacyReports,
  useAdminPharmacyReviews,
  useDebounced,
  useModerateAdminPharmacyReview,
} from '../hooks/use-pharmacy';
import type { PharmacyAdminReview } from '../types';
import {
  adminPharmacyStyles,
  EmptyHint,
  formatDateTime,
  Pill,
  reviewStatusMeta,
  RowCard,
} from './shared';

const STATUS_FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'visible', label: 'Yayında' },
  { key: 'pending', label: 'İncelemede' },
  { key: 'hidden', label: 'Gizlendi' },
];

type PendingAction = {
  review: PharmacyAdminReview;
  action: 'hide' | 'restore' | 'delete' | 'warn';
};

export function PharmacyReviewsTab({ canModerate }: { canModerate: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 350);
  const reviews = useAdminPharmacyReviews(status === 'all' ? null : status, debounced.trim());
  const reports = useAdminPharmacyReports('pending');
  const moderate = useModerateAdminPharmacyReview();
  const [pending, setPending] = useState<PendingAction | null>(null);

  async function confirm(note: string) {
    if (!pending) {
      return;
    }
    try {
      await moderate.mutateAsync({
        reviewId: pending.review.id,
        action: pending.action,
        note: note || null,
      });
      toast.success('Moderasyon işlemi uygulandı ve denetim kaydına yazıldı.');
      setPending(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem uygulanamadı.');
    }
  }

  return (
    <View style={adminPharmacyStyles.stack}>
      <AdminSection
        title="Yorum moderasyonu"
        subtitle="Yalnızca kayıtlı Trabzone hesaplarından gelen değerlendirmeler; uydurma puan üretilmez"
      >
        <TextField
          label="Ara"
          placeholder="Eczane, kullanıcı veya yorum metni"
          value={search}
          onChangeText={setSearch}
          leftIcon="search-outline"
          autoCapitalize="none"
        />
        <FilterChips
          options={STATUS_FILTERS.map((item) => ({ key: item.key, label: item.label }))}
          value={status}
          onChange={setStatus}
        />
        <AppText variant="caption" color="textTertiary">
          Yorum metinleri kişisel sağlık bilgisi veya reçete içeriyorsa gizleyin. Google Haritalar
          yorumları izinsiz kopyalanamaz.
        </AppText>
      </AdminSection>

      {(reports.data?.items.length ?? 0) > 0 ? (
        <AdminSection
          title="Bekleyen şikâyetler"
          subtitle={`${reports.data?.items.length} şikâyet inceleme bekliyor`}
        >
          <View style={adminPharmacyStyles.stack}>
            {reports.data?.items.map((report) => (
              <RowCard
                key={report.id}
                title={report.pharmacy_name}
                subtitle={report.review_body ?? 'Yorum metni boş'}
                badges={<Badge label={report.reason} tone="warning" />}
                meta={
                  <>
                    <Pill icon="star-outline" label={`${report.review_rating}/5`} />
                    <Pill icon="time-outline" label={formatDateTime(report.created_at)} />
                    {report.details ? <Pill label={report.details} /> : null}
                  </>
                }
                actions={
                  canModerate ? (
                    <Button
                      label="Yorumu incele"
                      size="sm"
                      variant="secondary"
                      fullWidth={false}
                      onPress={() =>
                        setPending({
                          review: {
                            id: report.review_id,
                            place_id: '',
                            pharmacy_name: report.pharmacy_name,
                            pharmacy_slug: report.pharmacy_slug,
                            district: null,
                            rating: report.review_rating,
                            body: report.review_body,
                            status: 'visible',
                            helpful_count: 0,
                            created_at: report.created_at,
                            author_username: null,
                            author_display_name: null,
                            report_count: 1,
                          },
                          action: 'hide',
                        })
                      }
                    />
                  ) : null
                }
              />
            ))}
          </View>
        </AdminSection>
      ) : null}

      {reviews.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : reviews.isError ? (
        <EmptyHint
          icon="cloud-offline-outline"
          title="Yorumlar yüklenemedi"
          text={reviews.error instanceof Error ? reviews.error.message : undefined}
        />
      ) : (reviews.data?.items.length ?? 0) === 0 ? (
        <EmptyHint
          icon="chatbubble-ellipses-outline"
          title="Yorum bulunamadı"
          text="Yorum yoksa kullanıcı ekranında “Henüz değerlendirme yapılmadı” gösterilir."
        />
      ) : (
        <AdminSection title="Değerlendirmeler" subtitle={`${reviews.data?.total ?? 0} kayıt`}>
          <View style={adminPharmacyStyles.stack}>
            {reviews.data?.items.map((review) => {
              const meta = reviewStatusMeta(review.status);
              return (
                <RowCard
                  key={review.id}
                  title={review.pharmacy_name}
                  subtitle={review.body ?? 'Yorum metni yok'}
                  badges={
                    <>
                      <Badge label={meta.label} tone={meta.tone} />
                      <Badge label={`${review.rating}/5`} tone="primary" />
                      {review.report_count > 0 ? (
                        <Badge label={`${review.report_count} şikâyet`} tone="danger" />
                      ) : null}
                    </>
                  }
                  meta={
                    <>
                      <Pill
                        icon="person-outline"
                        label={
                          review.author_display_name ??
                          (review.author_username ? `@${review.author_username}` : 'Kullanıcı bilinmiyor')
                        }
                      />
                      <Pill icon="time-outline" label={formatDateTime(review.created_at)} />
                      <Pill icon="thumbs-up-outline" label={`${review.helpful_count} yararlı`} />
                      {review.district ? <Pill icon="location-outline" label={review.district} /> : null}
                    </>
                  }
                  actions={
                    canModerate ? (
                      <>
                        {review.status !== 'visible' ? (
                          <Button
                            label="Yayınla"
                            size="sm"
                            variant="secondary"
                            fullWidth={false}
                            onPress={() => setPending({ review, action: 'restore' })}
                          />
                        ) : (
                          <Button
                            label="Gizle"
                            size="sm"
                            variant="secondary"
                            fullWidth={false}
                            onPress={() => setPending({ review, action: 'hide' })}
                          />
                        )}
                        <Button
                          label="Uyar"
                          size="sm"
                          variant="ghost"
                          fullWidth={false}
                          onPress={() => setPending({ review, action: 'warn' })}
                        />
                        <Button
                          label="Sil"
                          size="sm"
                          variant="ghost"
                          fullWidth={false}
                          onPress={() => setPending({ review, action: 'delete' })}
                        />
                      </>
                    ) : null
                  }
                />
              );
            })}
          </View>
        </AdminSection>
      )}

      <ReasonDialog
        visible={Boolean(pending)}
        title={
          pending?.action === 'delete'
            ? 'Yorumu kalıcı olarak sil'
            : pending?.action === 'hide'
              ? 'Yorumu gizle'
              : pending?.action === 'warn'
                ? 'Kullanıcıyı uyar'
                : 'Yorumu yeniden yayınla'
        }
        description={
          pending
            ? `${pending.review.pharmacy_name} · ${pending.review.rating}/5 puanlı yorum. İşlem denetim kaydına yazılır.`
            : undefined
        }
        confirmLabel={pending?.action === 'delete' ? 'Sil' : 'Onayla'}
        destructive={pending?.action === 'delete' || pending?.action === 'hide'}
        requireReason={pending?.action !== 'restore'}
        loading={moderate.isPending}
        onCancel={() => setPending(null)}
        onConfirm={({ reason }) => void confirm(reason)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 24, alignItems: 'center' },
});
