import { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

import { useNewsApiItem, useNewsApiItemAction } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import { ReasonDialog } from '../ReasonDialog';

import { NewsModalShell } from './NewsModalShell';
import { EmptyHint, InfoRow, ItemStatusBadge, newsApiStyles } from './shared';

export function NewsItemDetailModal({
  visible,
  itemId,
  canManage,
  onClose,
}: {
  visible: boolean;
  itemId: string | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const item = useNewsApiItem(visible ? itemId : null);
  const action = useNewsApiItemAction();
  const [reasonMode, setReasonMode] = useState<'reject' | 'remove' | null>(null);
  const [approveNote, setApproveNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const detail = item.data;

  const runAction = async (kind: 'reject' | 'remove', reason: string) => {
    if (!itemId) return;
    try {
      await action.mutateAsync({ kind, itemId, reason });
      toast.success(kind === 'remove' ? 'Haber kaldırıldı ve sitemap güncellendi.' : 'Haber reddedildi.');
      setReasonMode(null);
      onClose();
    } catch (actionError) {
      setError(errorMessage(actionError, 'İşlem tamamlanamadı.'));
    }
  };

  const approve = async () => {
    if (!itemId) return;
    setError(null);
    try {
      await action.mutateAsync({ kind: 'approve', itemId, note: approveNote.trim() || null });
      toast.success('Haber yayımlandı.');
      setApproveNote('');
      onClose();
    } catch (approveError) {
      setError(errorMessage(approveError, 'Yayınlama tamamlanamadı.'));
    }
  };

  return (
    <>
      <NewsModalShell
        visible={visible}
        title={detail?.title ?? 'Haber detayı'}
        subtitle={detail ? `${detail.source_name ?? 'Kaynak'} · ${detail.external_id ?? detail.id}` : undefined}
        onClose={onClose}
        footer={
          detail && canManage ? (
            <>
              <Button
                label="Reddet"
                size="sm"
                variant="ghost"
                fullWidth={false}
                disabled={detail.status === 'removed'}
                onPress={() => setReasonMode('reject')}
              />
              <Button
                label="Kaldır"
                size="sm"
                variant="danger"
                fullWidth={false}
                disabled={detail.status === 'removed'}
                onPress={() => setReasonMode('remove')}
              />
              <Button
                label="Yayınla"
                size="sm"
                fullWidth={false}
                loading={action.isPending}
                disabled={detail.status === 'published' || detail.status === 'removed'}
                onPress={() => void approve()}
              />
            </>
          ) : (
            <Button label="Kapat" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
          )
        }
      >
        {item.isLoading ? (
          <ActivityIndicator />
        ) : !detail ? (
          <EmptyHint text="Haber bulunamadı." icon="alert-circle-outline" />
        ) : (
          <>
            <View style={newsApiStyles.row}>
              <ItemStatusBadge status={detail.status} />
              {detail.category_slug ? <Badge label={detail.category_slug} tone="primary" /> : null}
              {detail.district ? <Badge label={detail.district} tone="neutral" /> : null}
              {detail.mode ? <Badge label={detail.mode} tone="accent" /> : null}
              {detail.license_snapshot?.['can_republish_text'] === true ? <Badge label="Tam metin izni" tone="success" /> : null}
            </View>

            {detail.image_url ? (
              <View style={[styles.media, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}>
                <AppText variant="caption" color="textTertiary">
                  Görsel: {detail.image_storage_path ? 'depoda' : 'uzak kaynakta'}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {detail.image_url}
                </AppText>
              </View>
            ) : null}

            {detail.summary ? (
              <View style={[styles.card, { borderColor: theme.colors.border }]}>
                <AppText variant="label">Özet</AppText>
                <AppText variant="body" color="textSecondary">
                  {detail.summary}
                </AppText>
              </View>
            ) : null}

            {detail.body ? (
              <View style={[styles.card, { borderColor: theme.colors.border }]}>
                <AppText variant="label">Haber metni</AppText>
                <AppText variant="body" color="textSecondary" numberOfLines={18}>
                  {detail.body}
                </AppText>
              </View>
            ) : null}

            <View>
              <InfoRow label="Kaynak haber ID" value={detail.external_id ?? '—'} />
              <InfoRow label="Orijinal URL" value={detail.canonical_url ?? '—'} />
              <InfoRow label="Yayın tarihi" value={detail.published_at ? formatDateTimeTr(detail.published_at) : '—'} />
              <InfoRow label="İlk görülme" value={formatDateTimeTr(detail.first_seen_at)} />
              <InfoRow label="Yazar" value={detail.author ?? '—'} />
              <InfoRow label="Engel nedeni" value={detail.block_reason ?? '—'} />
              <InfoRow label="Kaldırılma" value={detail.removed_at ? `${formatDateTimeTr(detail.removed_at)} · ${detail.removed_reason ?? ''}` : '—'} />
              <InfoRow label="Sosyal gönderi" value={detail.post_id ?? '—'} />
              <InfoRow label="Gönderi durumu" value={detail.post_status ?? '—'} />
            </View>

            {detail.canonical_url ? (
              <Button
                label="Orijinal haberi aç"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={() => void Linking.openURL(detail.canonical_url as string)}
              />
            ) : null}

            {canManage && detail.status !== 'published' && detail.status !== 'removed' ? (
              <View style={[styles.card, { borderColor: theme.colors.border }]}>
                <AppText variant="caption" color="textTertiary">
                  Yayın, kaynak lisansı ve yayın modu kapılarından geçerse Trabzone akışına gönderilir.
                </AppText>
                <TextField
                  label="Yayın notu (opsiyonel)"
                  value={approveNote}
                  onChangeText={setApproveNote}
                  placeholder="Editör notu"
                />
                <Button label="Yayınla" size="sm" fullWidth={false} loading={action.isPending} onPress={() => void approve()} />
              </View>
            ) : null}

            {error ? (
              <AppText variant="caption" color="danger">
                {error}
              </AppText>
            ) : null}
          </>
        )}
      </NewsModalShell>

      <ReasonDialog
        visible={reasonMode !== null}
        title={reasonMode === 'remove' ? 'Haberi kaldır' : 'Haberi reddet'}
        description={
          reasonMode === 'remove'
            ? 'Haber yayından kaldırılır, münhasırsa sosyal gönderi kaldırılır ve sitemap kaydı düşer.'
            : 'Haber yayın kuyruğundan çıkarılır ve reddedildi olarak işaretlenir.'
        }
        confirmLabel={reasonMode === 'remove' ? 'Kaldır' : 'Reddet'}
        destructive
        loading={action.isPending}
        onCancel={() => setReasonMode(null)}
        onConfirm={({ reason }) => {
          if (reasonMode) void runAction(reasonMode, reason);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 6 },
  media: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11, gap: 3 },
});
