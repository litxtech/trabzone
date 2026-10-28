import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminNewsSourceBodySave,
  useAdminNewsSourceEnrich,
} from '@/features/admin/hooks/use-admin-news';
import { useNewsDetail } from '@/features/news/hooks/use-news-reader';
import type { NewsDetail, NewsEditorialQueueItem } from '@/features/news/types';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Kaynak haberin editoryal gövdesini düzenler.
 *
 * Kaydetme sunucudaki `admin_news_source_save` RPC'sine gider; her değişiklik
 * `news_article_revisions` tablosuna sürüm olarak yazılır. AI ile genişletme
 * yalnızca yeni doğrulanmış kaynak bulunduğunda çalışır.
 */
export function NewsSourceEditModal({
  visible,
  item,
  onClose,
}: {
  visible: boolean;
  item: NewsEditorialQueueItem | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const detail = useNewsDetail(item?.post_id ?? '');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
          ]}
        >
          <View style={[styles.header, { borderColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="h2">Haber metnini düzenle</AppText>
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                {item?.title ?? 'Yükleniyor…'}
              </AppText>
            </View>
            <Badge
              label={`${item?.word_count ?? 0} kelime`}
              tone={(item?.word_count ?? 0) < 250 ? 'warning' : 'success'}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons name="close" size={20} color={theme.colors.text} />
            </Pressable>
          </View>

          {detail.data && item ? (
            <SourceEditor
              key={`${item.post_id}-${detail.data.updated_at ?? ''}-${detail.data.word_count}`}
              detail={detail.data}
              item={item}
              onClose={onClose}
              onRefetch={() => void detail.refetch()}
            />
          ) : (
            <View style={styles.center}>
              <AppText variant="caption" color="textTertiary">
                {detail.isError ? 'Mevcut metin getirilemedi.' : 'Mevcut metin getiriliyor…'}
              </AppText>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SourceEditor({
  detail,
  item,
  onClose,
  onRefetch,
}: {
  detail: NewsDetail;
  item: NewsEditorialQueueItem;
  onClose: () => void;
  onRefetch: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useAdminNewsSourceBodySave();
  const enrich = useAdminNewsSourceEnrich();
  const [title, setTitle] = useState(detail.title);
  const [summary, setSummary] = useState(detail.summary ?? '');
  const [lead, setLead] = useState(detail.lead ?? '');
  const [body, setBody] = useState(detail.body);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const runEnrich = async () => {
    setError(null);
    try {
      const result = await enrich.mutateAsync(item.post_id);
      if (result.ok !== true) {
        toast.error(String(result.message ?? 'Haber yeterli doğrulanmış kaynakla genişletilemedi.'));
        return;
      }
      const saved = (result.saved ?? {}) as Record<string, unknown>;
      toast.success(
        `Haber ${String(saved.word_count ?? '')} kelimeyle güncellendi (sürüm ${String(saved.version ?? '')}).`,
      );
      onRefetch();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Genişletme tamamlanamadı.');
    }
  };

  const runSave = async () => {
    if (body.trim().length < 600) {
      setError('Gövde en az 600 karakter olmalı. Kaynak yetmiyorsa haberi zorla uzatmayın.');
      return;
    }
    setError(null);
    try {
      const result = await save.mutateAsync({
        postId: item.post_id,
        payload: {
          title: title.trim(),
          summary: summary.trim() || null,
          lead: lead.trim() || null,
          body: body.trim(),
          body_format: body.trim().length > 3200 ? 'extended' : 'standard',
          change_reason: reason.trim() || 'Editör düzenlemesi',
        },
        reason: reason.trim() || null,
      });
      toast.success(
        `Haber kaydedildi · ${String(result.word_count ?? '')} kelime · sürüm ${String(result.version ?? '')}.`,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Haber kaydedilemedi.');
    }
  };

  const busy = save.isPending || enrich.isPending;

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.note, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Yalnızca doğrulanmış kaynak bilgilerini kullanın. AI ile genişletme, yeni doğrulanmış
            kaynak bulamazsa metni değiştirmez.
          </AppText>
        </View>

        <TextField label="Başlık" value={title} onChangeText={setTitle} maxLength={180} />
        <TextField
          label="Spot / özet"
          value={summary}
          onChangeText={setSummary}
          multiline
          style={styles.smallInput}
          maxLength={600}
        />
        <TextField
          label="Giriş paragrafı"
          value={lead}
          onChangeText={setLead}
          multiline
          style={styles.smallInput}
          maxLength={1400}
        />
        <TextField
          label="Gövde (Markdown alt başlık destekler)"
          value={body}
          onChangeText={setBody}
          multiline
          style={styles.bodyInput}
        />
        <TextField
          label="Değişiklik gerekçesi (sürüm kaydına yazılır)"
          value={reason}
          onChangeText={setReason}
          maxLength={240}
        />

        {error ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.colors.divider }]}>
        <Button
          label="AI ile kaynaklarla genişlet"
          size="sm"
          variant="secondary"
          fullWidth={false}
          loading={enrich.isPending}
          disabled={busy}
          onPress={() => void runEnrich()}
        />
        <Button
          label="Sürüm olarak kaydet"
          size="sm"
          fullWidth={false}
          loading={save.isPending}
          disabled={busy}
          onPress={() => void runSave()}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  sheet: {
    width: '100%',
    maxWidth: 880,
    height: '92%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  close: { padding: 6 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, borderRadius: 12 },
  smallInput: { minHeight: 84 },
  bodyInput: { minHeight: 360 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  flex: { flex: 1 },
});
