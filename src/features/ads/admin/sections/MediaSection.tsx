import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppImage, AppText, Button } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useTheme } from '@/theme/ThemeProvider';

import { PremiumGlassAdBanner } from '../../components/PremiumGlassAdBanner';
import { AdMediaField } from '../components/AdMediaField';
import { useAdMedia, useAdMediaArchive } from '../hooks';
import { formatDateShort } from '../labels';
import type { AdMediaAsset } from '../types';

const VARIANTS: { key: string; label: string }[] = [
  { key: '', label: 'Tümü' },
  { key: 'banner', label: 'Banner' },
  { key: 'mobile', label: 'Mobil' },
  { key: 'web', label: 'Web' },
  { key: 'cover', label: 'Kapak' },
  { key: 'gallery', label: 'Galeri' },
  { key: 'video', label: 'Video' },
];

export function MediaSection({ canManage }: { canManage: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [variant, setVariant] = useState('');
  const [uploadVariant, setUploadVariant] = useState<AdMediaAsset['variant']>('banner');
  const [lastUrl, setLastUrl] = useState('');
  const [preview, setPreview] = useState<AdMediaAsset | null>(null);
  const media = useAdMedia(variant || null);
  const archive = useAdMediaArchive();

  return (
    <AdminSection
      title="Medya kütüphanesi"
      subtitle="Dosyalar Cloudflare R2'de saklanır ve CDN üzerinden önbelleklenir. Banner için 3:1 kırpma ve metin güvenli alanı önizlemesi kullanılabilir."
    >
      {canManage ? (
        <View style={[styles.upload, { borderColor: theme.colors.border }]}>
          <FilterChips
            options={VARIANTS.filter((item) => item.key).map((item) => ({ key: item.key, label: item.label }))}
            value={uploadVariant}
            onChange={(value) => setUploadVariant(value as AdMediaAsset['variant'])}
          />
          <AdMediaField
            label="Yeni medya"
            value={lastUrl}
            onChange={setLastUrl}
            variant={uploadVariant}
            crop={['banner', 'mobile', 'web'].includes(uploadVariant)}
            hint="Yükleme sonrası kütüphaneye otomatik eklenir."
          />
          {lastUrl && uploadVariant !== 'video' ? (
            <View style={styles.previewBox}>
              <PremiumGlassAdBanner
                width={340}
                title="Metin güvenli alanı önizlemesi"
                description="Başlık ve açıklama bu kesikli alanın içinde kalmalı."
                ctaLabel="İncele"
                businessName="İşletme adı"
                imageUrl={lastUrl}
                showSafeArea
              />
            </View>
          ) : null}
        </View>
      ) : null}

      <FilterChips options={VARIANTS} value={variant} onChange={setVariant} />
      <View style={styles.grid}>
        {(media.data?.items ?? []).map((item) => (
          <View key={item.id} style={[styles.tile, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
            <View style={[styles.image, { backgroundColor: theme.colors.surfaceMuted }]}>
              {item.media_type === 'image' ? (
                <AppImage source={{ uri: item.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="videocam-outline" size={26} color={theme.colors.textSecondary} />
              )}
            </View>
            <AppText variant="caption" numberOfLines={1}>
              {item.label ?? item.variant}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {item.variant}
              {item.width && item.height ? ` · ${item.width}×${item.height}` : ''} · {formatDateShort(item.created_at)}
            </AppText>
            <View style={styles.tileActions}>
              {item.media_type === 'image' ? (
                <Button label="Önizle" size="sm" variant="ghost" fullWidth={false} onPress={() => setPreview(item)} />
              ) : null}
              {canManage ? (
                <Button
                  label="Arşivle"
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  onPress={() =>
                    void archive
                      .mutateAsync(item.id)
                      .then(() => toast.success('Medya arşivlendi.'))
                      .catch((error: Error) => toast.error(error.message))
                  }
                />
              ) : null}
            </View>
          </View>
        ))}
        {media.data && media.data.items.length === 0 ? (
          <AppText variant="body" color="textSecondary">
            Bu türde medya yok.
          </AppText>
        ) : null}
      </View>
      {preview ? (
        <View style={styles.previewBox}>
          <AppText variant="title">Banner önizlemesi</AppText>
          <PremiumGlassAdBanner
            width={360}
            title={preview.label ?? 'Örnek başlık'}
            description="Örnek açıklama metni"
            ctaLabel="İncele"
            businessName="İşletme"
            imageUrl={preview.url}
            showSafeArea
          />
          <Button label="Kapat" size="sm" variant="ghost" fullWidth={false} onPress={() => setPreview(null)} />
        </View>
      ) : null}
    </AdminSection>
  );
}

const styles = StyleSheet.create({
  upload: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 10 },
  previewBox: { gap: 8, alignItems: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: 200, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 8, gap: 4 },
  image: { height: 66, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tileActions: { flexDirection: 'row', gap: 4 },
});
