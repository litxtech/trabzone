import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Image } from 'expo-image';
import { useLocalSearchParams, usePreventRemove } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  AppImage,
  AppText,
  Avatar,
  Button,
  Screen,
  ScreenHeader,
  TextField,
} from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { TRABZON_BOUNDS } from '@/features/explore/utils/geo';
import {
  useLiveNews,
  useLiveNewsAi,
  useCreateLiveNews,
  useUpdateLiveNews,
} from '@/features/live-news/hooks/use-live-news';
import {
  LIVE_NEWS_CATEGORIES,
  LIVE_NEWS_DISTRICTS,
  categoryLabel,
  type LiveNewsAiResult,
} from '@/features/live-news/services/live-news-service';
import type { LiveNewsCategory, LiveNewsItem, LiveNewsTarget } from '@/features/live-news/types';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import {
  publicMediaUrl,
  uploadMedia,
  uploadVideoWithPoster,
  type UploadedMedia,
} from '@/features/media/media-service';
import {
  cancelVideoPreparation,
  generateVideoPoster,
  prepareVideoForUpload,
} from '@/features/media/video-service';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useDeferredExit } from '@/hooks/use-deferred-exit';
import { useMeasuredWidth } from '@/hooks/use-measured-width';
import { useTheme } from '@/theme/ThemeProvider';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';

const MAX_MEDIA = 10;
const MAX_TITLE = 140;
const MAX_SUMMARY = 1200;

type DraftAsset = {
  key: string;
  uri: string;
  mediaType: 'image' | 'video';
  mimeType: string | null;
  fileName: string | null;
  thumbnailUri?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
};

type AiDraft = { title: string; summary: string; notes: string[] };

const TARGETS: { key: LiveNewsTarget; label: string; description: string }[] = [
  { key: 'feed', label: 'Sosyal akış', description: 'Ana akışta gönderi olarak görünür' },
  { key: 'live', label: 'Anlık Gelişmeler', description: 'Bölge ve ilçe filtrelerinde listelenir' },
  { key: 'reels', label: 'Reels', description: 'Aynı video, kopya oluşturmadan Reels’e eklenir' },
  { key: 'web', label: 'Web sayfası', description: 'Herkese açık deep link ve SEO sayfası' },
];

function newIdempotencyKey(): string {
  return `ln-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function mediaKindOf(assets: DraftAsset[]): 'text' | 'photo' | 'video' | 'mixed' {
  const hasPhoto = assets.some((asset) => asset.mediaType === 'image');
  const hasVideo = assets.some((asset) => asset.mediaType === 'video');
  if (hasPhoto && hasVideo) return 'mixed';
  if (hasVideo) return 'video';
  if (hasPhoto) return 'photo';
  return 'text';
}

export default function ComposeLiveNewsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ postId?: string }>();
  const editingId = typeof params.postId === 'string' && params.postId ? params.postId : null;
  const existingQuery = useLiveNews(editingId ?? '');

  // Doğrudan bağlantıyla gelindiğinde geri gidilecek ekran olmayabilir.
  const leaveEditor = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/feed' as never);
  };

  if (editingId && !existingQuery.data && !existingQuery.isError) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader title="Anlık haberi düzenle" onBack={leaveEditor} />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">
            Gelişme yükleniyor
          </AppText>
        </View>
      </Screen>
    );
  }

  if (editingId && existingQuery.isError) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader title="Anlık haberi düzenle" onBack={leaveEditor} />
        <View style={styles.center}>
          <AppText variant="body" color="textSecondary" align="center">
            Gelişme yüklenemedi. Bağlantını kontrol edip tekrar dene.
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <ComposeLiveNewsForm
      key={editingId ?? 'new'}
      editingId={editingId}
      existing={existingQuery.data ?? null}
    />
  );
}

function ComposeLiveNewsForm({
  editingId,
  existing,
}: {
  editingId: string | null;
  existing: LiveNewsItem | null;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();

  /**
   * Önizleme hücreleri kare ve üç sütunlu. Yüzde genişlik + `aspectRatio`
   * Yoga'da yüksekliği 0'a düşürebildiği için boyut ızgaranın ölçülen
   * genişliğinden sayısal olarak hesaplanır.
   */
  const mediaGrid = useMeasuredWidth(Math.max(1, Math.min(windowWidth - 40, 720)));
  const mediaCellSize = Math.max(48, Math.round(mediaGrid.width * 0.315));

  const { data: profile } = useMyProfile();
  const create = useCreateLiveNews();
  const update = useUpdateLiveNews();
  const ai = useLiveNewsAi();

  const [title, setTitle] = useState(existing?.live_news?.title ?? '');
  const [summary, setSummary] = useState(existing?.live_news?.summary ?? '');
  const [category, setCategory] = useState<LiveNewsCategory>(
    (existing?.live_news?.category as LiveNewsCategory | undefined) ?? 'guncel',
  );
  const [district, setDistrict] = useState<string | null>(existing?.live_news?.district ?? null);
  const [precision, setPrecision] = useState<'district' | 'approximate'>(
    existing?.live_news?.location_precision === 'approximate' ? 'approximate' : 'district',
  );
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [targets, setTargets] = useState<LiveNewsTarget[]>(
    (existing?.live_news?.publish_targets as LiveNewsTarget[] | undefined) ?? [
      'feed',
      'live',
      'web',
    ],
  );
  const [usageConsent, setUsageConsent] = useState(existing?.live_news?.usage_consent ?? false);
  const [assets, setAssets] = useState<DraftAsset[]>([]);
  const [posters, setPosters] = useState<Record<string, string | null>>({});

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]);
  const [aiHint, setAiHint] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const { approved: approvedExit, exitAfterApproval, dispatchAfterApproval } = useDeferredExit();
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  /**
   * Deep link veya bildirimle doğrudan besteciye gelindiğinde geri gidilecek
   * ekran olmayabilir; o durumda akışa dönülür. Aksi halde `router.back()`
   * işlenmeyen bir gezinme hareketi olarak sessizce yutulur ve ekran kapanmaz.
   */
  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/feed' as never);
  }, [router]);

  const existingMedia = useMemo(
    () =>
      (existing?.media ?? [])
        .map((item) => ({
          id: item.id,
          uri: publicMediaUrl('posts', item.storage_path) ?? '',
          posterUri: publicMediaUrl('posts', item.thumbnail_path),
          mediaType: item.media_type,
          durationMs: item.duration_ms,
        }))
        .filter((item) => item.uri),
    [existing?.media],
  );

  const hasVideo = useMemo(
    () =>
      assets.some((asset) => asset.mediaType === 'video') ||
      existingMedia.some((item) => item.mediaType === 'video'),
    [assets, existingMedia],
  );
  const mediaKind = mediaKindOf(assets);

  // Video hedefi yoksa Reels seçimi yayına ve önizlemeye taşınmaz.
  const effectiveTargets = useMemo(
    () => (hasVideo ? targets : targets.filter((target) => target !== 'reels')),
    [hasVideo, targets],
  );

  // Seçilen videoların kapağını hemen üret: önizleme video indirmeden görünür.
  useEffect(() => {
    const pending = assets.filter(
      (asset) => asset.mediaType === 'video' && posters[asset.key] === undefined,
    );
    if (pending.length === 0) return;
    let active = true;
    void (async () => {
      for (const asset of pending) {
        const poster = await generateVideoPoster(asset.uri);
        if (!active) return;
        setPosters((current) => ({ ...current, [asset.key]: poster?.uri ?? null }));
      }
    })();
    return () => {
      active = false;
    };
  }, [assets, posters]);

  // Sıkıştırmayı seçim anında başlat; yayın anında bekleme kısalır.
  const videoSignature = useMemo(
    () =>
      assets
        .filter((asset) => asset.mediaType === 'video')
        .map((asset) => asset.uri)
        .join('|'),
    [assets],
  );
  useEffect(() => {
    if (!videoSignature) return;
    for (const asset of assets.filter((item) => item.mediaType === 'video')) {
      void prepareVideoForUpload({
        uri: asset.uri,
        durationMs: asset.durationMs,
        width: asset.width,
        height: asset.height,
        size: asset.fileSize,
      }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoSignature]);

  const addPicked = useCallback((picked: PickedAsset[]) => {
    setAssets((current) => [
      ...current,
      ...picked.slice(0, Math.max(0, MAX_MEDIA - current.length)).map((asset) => ({
        key: `${asset.uri}-${Math.random().toString(36).slice(2, 7)}`,
        uri: asset.uri,
        mediaType: asset.mediaType,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        durationMs: asset.durationMs,
        width: asset.width,
        height: asset.height,
        fileSize: asset.fileSize,
      })),
    ]);
  }, []);

  const pick = useCallback(
    async (source: 'camera' | 'library', kind: 'image' | 'video' | 'all') => {
      if (editingId) return;
      const remaining = MAX_MEDIA - assets.length;
      if (remaining <= 0) {
        Alert.alert('Medya sınırı', `Bir anlık haberde en fazla ${MAX_MEDIA} medya olabilir.`);
        return;
      }
      const picked = await pickMedia({
        source,
        kind,
        multiple: source === 'library' && kind !== 'video',
        limit: remaining,
      });
      if (picked?.length) addPicked(picked);
    },
    [addPicked, assets.length, editingId],
  );

  const removeAsset = useCallback((key: string) => {
    setAssets((current) => {
      const target = current.find((asset) => asset.key === key);
      if (target?.mediaType === 'video') {
        cancelVideoPreparation(target.uri);
      }
      return current.filter((asset) => asset.key !== key);
    });
    setPosters((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const moveAsset = useCallback((key: string, direction: -1 | 1) => {
    setAssets((current) => {
      const index = current.findIndex((asset) => asset.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(target, 0, moved);
      return next;
    });
  }, []);

  const toggleTarget = useCallback((key: LiveNewsTarget) => {
    haptics.selection();
    setTargets((current) =>
      current.includes(key)
        ? current.length === 1
          ? current
          : current.filter((item) => item !== key)
        : [...current, key],
    );
  }, []);

  const chooseApproximateLocation = useCallback(async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Konum izni verilmedi',
          'Yaklaşık konum eklemek için izin gerekir. İlçe bilgisiyle devam edebilirsin.',
        );
        return;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const lat = current.coords.latitude;
      const lng = current.coords.longitude;
      if (
        lat < TRABZON_BOUNDS.south ||
        lat > TRABZON_BOUNDS.north ||
        lng < TRABZON_BOUNDS.west ||
        lng > TRABZON_BOUNDS.east
      ) {
        Alert.alert('Hizmet bölgesi dışındasın', 'Şu anda Trabzon sınırları dışındasın.');
        return;
      }
      setCoords({ lat, lng });
      setPrecision('approximate');
      haptics.success();
    } catch {
      Alert.alert('Konum alınamadı', 'Cihaz konumu okunamadı. İlçe bilgisiyle devam edebilirsin.');
    }
  }, []);

  const openLocationOptions = useCallback(() => {
    Alert.alert(
      'Konum bilgisi',
      'Kesin GPS koordinatların herkese açılmaz. Yaklaşık konum yaklaşık 1 km hassasiyetle saklanır.',
      [
        {
          text: 'İlçe yeterli',
          onPress: () => {
            setPrecision('district');
            setCoords(null);
          },
        },
        { text: 'Yaklaşık konum ekle', onPress: () => void chooseApproximateLocation() },
        { text: 'Vazgeç', style: 'cancel' },
      ],
    );
  }, [chooseApproximateLocation]);

  const applyAiResult = useCallback((action: string, result: LiveNewsAiResult) => {
    if (action === 'polish') {
      if (result.title && result.summary) {
        setAiDraft({
          title: result.title,
          summary: result.summary,
          notes: result.notes ?? [],
        });
      }
      return;
    }
    if (action === 'title') {
      setTitleSuggestions(result.titles ?? []);
      return;
    }
    if (action === 'category' && result.category) {
      setCategory(result.category);
      setAiHint(`Kategori önerisi uygulandı: ${categoryLabel(result.category)}.`);
      haptics.success();
      return;
    }
    if (action === 'district') {
      if (result.district) {
        setDistrict(result.district);
        setPrecision('district');
        setAiHint(
          `Metindeki yer ipucuna göre ilçe önerisi: ${result.district}. Konum uydurulmadı.`,
        );
        haptics.success();
      } else {
        setAiHint('Metinde net bir ilçe ipucu bulunamadı; ilçe değiştirilmedi.');
      }
    }
  }, []);

  const runAi = useCallback(
    async (action: 'polish' | 'title' | 'category' | 'district') => {
      const cleanTitle = title.trim();
      const cleanSummary = summary.trim();
      if (cleanTitle.length < 6 || (!cleanSummary && assets.length === 0)) {
        Alert.alert(
          'Önce birkaç bilgi yaz',
          'AI asistanı yalnızca senin yazdığın bilgileri düzenler. En az 6 karakterlik başlık ve kısa bir açıklama yaz.',
        );
        return;
      }
      haptics.tap();
      setAiHint(null);
      try {
        const result = await ai.mutateAsync({
          action,
          title: cleanTitle,
          summary: cleanSummary,
          district,
          mediaKind,
        });
        applyAiResult(action, result);
      } catch (error) {
        Alert.alert('AI asistanı', toMessage(error));
      }
    },
    [ai, applyAiResult, assets.length, district, mediaKind, summary, title],
  );

  const uploadAll = useCallback(
    async (userId: string, signal: AbortSignal): Promise<UploadedMedia[] | null> => {
      const total = assets.length;
      if (total === 0) return [];
      const results: (UploadedMedia | null)[] = new Array(total).fill(null);
      const ratios = new Array(total).fill(0);
      let failed = false;

      const flush = () => {
        setProgress(Math.min(1, ratios.reduce((sum, value) => sum + value, 0) / total));
      };
      setProgress(0);

      for (let index = 0; index < total; index += 1) {
        if (failed || signal.aborted) break;
        const asset = assets[index]!;
        const slot = index + 1;
        setProgressLabel(
          asset.mediaType === 'video'
            ? `Video hazırlanıyor ${slot}/${total}`
            : `Medya yükleniyor ${slot}/${total}`,
        );

        if (asset.mediaType === 'video') {
          const response = await uploadVideoWithPoster({
            bucket: 'posts',
            folder: userId,
            uri: asset.uri,
            mime: asset.mimeType,
            fileName: asset.fileName,
            durationMs: asset.durationMs,
            width: asset.width,
            height: asset.height,
            fileSize: asset.fileSize,
            signal,
            onProgress: (stage, ratio) => {
              if (signal.aborted) return;
              setProgressLabel(
                stage === 'preparing'
                  ? `Video hazırlanıyor ${slot}/${total}`
                  : `Video yükleniyor ${slot}/${total}`,
              );
              ratios[index] = stage === 'preparing' ? ratio * 0.9 : 0.9 + ratio * 0.1;
              flush();
            },
          });
          if (!response.ok) {
            if (response.error.code !== 'cancelled') {
              Alert.alert('Yükleme başarısız', response.error.message);
            }
            failed = true;
            break;
          }
          results[index] = response.data.video;
        } else {
          const response = await uploadMedia({
            bucket: 'posts',
            folder: userId,
            uri: asset.uri,
            mime: asset.mimeType,
            fileName: asset.fileName,
            width: asset.width,
            height: asset.height,
            signal,
            onProgress: (_stage, ratio) => {
              if (signal.aborted) return;
              ratios[index] = ratio;
              flush();
            },
          });
          if (!response.ok) {
            if (response.error.code !== 'cancelled') {
              Alert.alert('Yükleme başarısız', response.error.message);
            }
            failed = true;
            break;
          }
          results[index] = response.data;
        }
        ratios[index] = 1;
        flush();
      }

      if (failed || signal.aborted) return null;
      const uploaded = results.filter((item): item is UploadedMedia => item !== null);
      return uploaded.length === total ? uploaded : null;
    },
    [assets],
  );

  const submit = useCallback(async () => {
    const cleanTitle = title.trim();
    const cleanSummary = summary.trim();
    if (cleanTitle.length < 6) {
      Alert.alert('Başlık çok kısa', 'Anlık gelişme başlığı en az 6 karakter olmalı.');
      return;
    }
    if (!cleanSummary && assets.length === 0 && existingMedia.length === 0) {
      Alert.alert('İçerik boş', 'Bir açıklama yaz veya fotoğraf/video ekle.');
      return;
    }
    if (!profile?.id) {
      Alert.alert('Oturum gerekli', 'Anlık haber paylaşmak için giriş yapmalısın.');
      return;
    }

    if (editingId) {
      setUploading(true);
      try {
        await update.mutateAsync({
          postId: editingId,
          title: cleanTitle,
          summary: cleanSummary || null,
          category,
          district,
          publishTargets: effectiveTargets,
          usageConsent,
        });
        haptics.success();
        Alert.alert('Güncellendi', 'Doğrulama durumu yeniden incelenecek.', [
          { text: 'Tamam', onPress: () => exitAfterApproval(goBack) },
        ]);
      } catch (error) {
        Alert.alert('Güncellenemedi', toMessage(error));
      } finally {
        setUploading(false);
      }
      return;
    }

    setPreviewOpen(false);
    setUploading(true);
    setProgress(0);
    setProgressLabel(assets.length > 0 ? 'Medya hazırlanıyor' : 'Gelişme yayınlanıyor');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const uploaded = await uploadAll(profile.id, controller.signal);
      if (!uploaded || controller.signal.aborted) return;

      setProgressLabel('Gelişme kaydediliyor');
      const result = await create.mutateAsync({
        title: cleanTitle,
        summary: cleanSummary || null,
        category,
        district,
        locationPrecision: precision,
        latitude: precision === 'approximate' ? (coords?.lat ?? null) : null,
        longitude: precision === 'approximate' ? (coords?.lng ?? null) : null,
        media: uploaded.map((item) => ({
          storage_path: item.path,
          thumbnail_path: item.thumbnailPath ?? null,
          media_type: item.mediaType,
          width: item.width,
          height: item.height,
          duration_ms: item.durationMs,
        })),
        publishTargets: effectiveTargets,
        usageConsent,
        idempotencyKey: idempotencyKey.current,
      });

      haptics.success();
      const pending = result.moderation_status === 'pending';
      Alert.alert(
        pending ? 'İncelemeye alındı' : 'Anlık haber yayınlandı',
        pending
          ? 'Güvenlik kontrolü nedeniyle gelişmen bu kez editör onayına düşecek. Onaydan sonra akışta görünecek.'
          : 'Gelişmen seçtiğin alanlarda yayınlandı.',
        [
          {
            text: 'Tamam',
            onPress: () =>
              exitAfterApproval(() => router.replace(`/post/${result.post_id}` as never)),
          },
        ],
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        Alert.alert('Paylaşılamadı', toMessage(error));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setUploading(false);
        setProgress(0);
        setProgressLabel(null);
      }
    }
  }, [
    assets,
    category,
    coords,
    create,
    district,
    editingId,
    existingMedia.length,
    effectiveTargets,
    exitAfterApproval,
    goBack,
    precision,
    profile,
    router,
    summary,
    title,
    update,
    uploadAll,
    usageConsent,
  ]);

  const busy = uploading || create.isPending || update.isPending;
  // Düzenleme modunda ekran açılır açılmaz "değişiklik var" sayılmaz; aksi
  // halde kullanıcı hiçbir şey yazmadan çıkmak istediğinde de onay sorulur.
  const hasChanges = editingId
    ? title.trim() !== (existing?.live_news?.title ?? '') ||
      summary.trim() !== (existing?.live_news?.summary ?? '') ||
      category !== ((existing?.live_news?.category as LiveNewsCategory | undefined) ?? 'guncel') ||
      district !== (existing?.live_news?.district ?? null) ||
      effectiveTargets.join(',') !==
        (
          (existing?.live_news?.publish_targets as LiveNewsTarget[] | undefined) ?? [
            'feed',
            'live',
            'web',
          ]
        ).join(',') ||
      usageConsent !== (existing?.live_news?.usage_consent ?? false)
    : title.trim().length > 0 ||
      summary.trim().length > 0 ||
      assets.length > 0 ||
      district !== null;

  usePreventRemove(!approvedExit && (busy || hasChanges), ({ data }) => {
    Alert.alert('Vazgeçilsin mi?', 'Yazdıkların ve seçtiğin medya kaydedilmeyecek.', [
      { text: 'Devam et', style: 'cancel' },
      {
        text: 'Vazgeç',
        style: 'destructive',
        // Engel durumu render sonrası kalktığı için çıkış ertelenir.
        onPress: () => dispatchAfterApproval(data.action),
      },
    ]);
  });

  const cancelUpload = useCallback(() => {
    abortRef.current?.abort();
    for (const asset of assets) {
      if (asset.mediaType === 'video') cancelVideoPreparation(asset.uri);
    }
  }, [assets]);

  const close = useCallback(() => {
    if (busy) {
      Alert.alert('Paylaşım sürüyor', 'Yükleme tamamlanana kadar ekrandan ayrılamazsın.', [
        { text: 'Bekle', style: 'cancel' },
        { text: 'Yüklemeyi iptal et', style: 'destructive', onPress: cancelUpload },
      ]);
      return;
    }
    goBack();
  }, [busy, cancelUpload, goBack]);

  const previewItem = useMemo<PreviewData>(() => {
    const firstExisting = existingMedia[0];
    const firstDraft = assets[0];
    return {
      title: title.trim() || 'Anlık gelişme başlığı',
      summary: summary.trim() || null,
      category,
      district,
      mediaUri: firstDraft
        ? firstDraft.mediaType === 'video'
          ? (posters[firstDraft.key] ?? null)
          : firstDraft.uri
        : firstExisting?.mediaType === 'video'
          ? firstExisting.posterUri
          : (firstExisting?.uri ?? null),
      isVideo: firstDraft ? firstDraft.mediaType === 'video' : firstExisting?.mediaType === 'video',
      mediaCount: assets.length || existingMedia.length,
    };
  }, [assets, category, district, existingMedia, posters, summary, title]);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll keyboardAware>
      <ScreenHeader
        title={editingId ? 'Anlık haberi düzenle' : 'Anlık Haber'}
        subtitle={
          editingId
            ? 'Başlık ve ayrıntıyı güncelle; medya korunur'
            : 'Bulunduğun yerden gelişmeyi bildir'
        }
        left={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Vazgeç"
            onPress={close}
            disabled={busy}
            style={({ pressed }) => [styles.cancel, { opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
          >
            <AppText variant="label" color="textSecondary">
              İptal
            </AppText>
          </Pressable>
        }
        right={
          editingId ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yayın önizlemesi"
              onPress={() => {
                haptics.tap();
                setPreviewOpen(true);
              }}
              disabled={busy}
              style={({ pressed }) => [
                styles.previewButton,
                { opacity: busy ? 0.4 : pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="eye-outline" size={15} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep">
                Önizle
              </AppText>
            </Pressable>
          )
        }
      />

      <View style={styles.authorRow}>
        <Avatar
          uri={profile ? mediaPublicUrl('avatar', profile.avatar_path) : null}
          name={profile ? `${profile.first_name} ${profile.last_name}` : 'Trabzone'}
          size={42}
        />
        <View style={styles.authorText}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {profile ? `${profile.first_name} ${profile.last_name}` : 'Sen'}
          </AppText>
          <View style={[styles.citizenBadge, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="radio-outline" size={10} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep">
              Vatandaş Paylaşımı
            </AppText>
          </View>
        </View>
      </View>

      <TextField
        label="Başlık"
        value={title}
        onChangeText={(value) => setTitle(value.slice(0, MAX_TITLE))}
        placeholder="Örn. Ortahisar’da sağanak sonrası yol su altında"
        maxLength={MAX_TITLE}
        editable={!busy}
        containerStyle={styles.field}
      />

      <TextField
        label="Ayrıntı"
        value={summary}
        onChangeText={(value) => setSummary(value.slice(0, MAX_SUMMARY))}
        placeholder="Ne oldu, nerede, ne zaman? Bildiğin kadarıyla yaz."
        multiline
        maxLength={MAX_SUMMARY}
        editable={!busy}
        containerStyle={styles.field}
        hint={`${summary.length}/${MAX_SUMMARY} · Yalnızca gerçekten gördüğün bilgileri yaz`}
      />

      <View style={styles.aiRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="AI ile başlığı ve açıklamayı düzenle"
          disabled={busy || ai.isPending}
          onPress={() => void runAi('polish')}
          style={({ pressed }) => [
            styles.aiButton,
            {
              backgroundColor: theme.colors.primarySoft,
              borderColor: theme.colors.primary,
              opacity: busy || ai.isPending ? 0.5 : pressed ? 0.75 : 1,
            },
          ]}
        >
          {ai.isPending ? (
            <ActivityIndicator size="small" color={theme.colors.primaryDeep} />
          ) : (
            <Ionicons name="sparkles-outline" size={14} color={theme.colors.primaryDeep} />
          )}
          <AppText variant="caption" color="primaryDeep">
            AI ile düzenle
          </AppText>
        </Pressable>
        <AiMiniButton
          label="Başlık öner"
          onPress={() => void runAi('title')}
          disabled={busy || ai.isPending}
        />
        <AiMiniButton
          label="Kategori öner"
          onPress={() => void runAi('category')}
          disabled={busy || ai.isPending}
        />
        <AiMiniButton
          label="İlçe öner"
          onPress={() => void runAi('district')}
          disabled={busy || ai.isPending}
        />
      </View>
      <AppText variant="caption" color="textTertiary">
        AI yalnızca yazdıklarını düzenler; olay ayrıntısı, konum veya kişi uydurmaz.
      </AppText>

      {aiHint ? (
        <View style={[styles.hintBox, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Ionicons
            name="information-circle-outline"
            size={14}
            color={theme.colors.textSecondary}
          />
          <AppText variant="caption" color="textSecondary" style={styles.hintText}>
            {aiHint}
          </AppText>
        </View>
      ) : null}

      {titleSuggestions.length > 0 ? (
        <View style={[styles.suggestionBox, { borderColor: theme.colors.border }]}>
          <View style={styles.suggestionHead}>
            <AppText variant="label">Başlık önerileri</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Önerileri kapat"
              onPress={() => setTitleSuggestions([])}
            >
              <Ionicons name="close" size={16} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          {titleSuggestions.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              accessibilityLabel={suggestion}
              onPress={() => {
                setTitle(suggestion);
                setTitleSuggestions([]);
                haptics.success();
              }}
              style={({ pressed }) => [
                styles.suggestion,
                { backgroundColor: pressed ? theme.colors.primarySoft : 'transparent' },
              ]}
            >
              <AppText variant="caption" style={styles.suggestionText}>
                {suggestion}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {aiDraft ? (
        <View
          style={[
            styles.aiPreview,
            { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
          ]}
        >
          <View style={styles.suggestionHead}>
            <AppText variant="label" color="primaryDeep">
              AI önizlemesi
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="AI önizlemesini kapat"
              onPress={() => setAiDraft(null)}
            >
              <Ionicons name="close" size={16} color={theme.colors.primaryDeep} />
            </Pressable>
          </View>
          <AppText variant="bodyStrong">{aiDraft.title}</AppText>
          <AppText variant="caption" color="textSecondary">
            {aiDraft.summary}
          </AppText>
          {aiDraft.notes.map((note) => (
            <AppText key={note} variant="caption" color="textTertiary">
              · {note}
            </AppText>
          ))}
          <View style={styles.aiPreviewActions}>
            <Button label="Vazgeç" variant="ghost" size="sm" onPress={() => setAiDraft(null)} />
            <Button
              label="Uygula"
              size="sm"
              onPress={() => {
                setTitle(aiDraft.title);
                setSummary(aiDraft.summary);
                setAiDraft(null);
                haptics.success();
              }}
            />
          </View>
        </View>
      ) : null}

      {editingId ? (
        existingMedia.length > 0 ? (
          <View style={styles.mediaGrid} onLayout={mediaGrid.onLayout}>
            {existingMedia.map((item) => (
              <View
                key={item.id}
                style={[styles.mediaCell, { height: mediaCellSize, borderRadius: theme.radius.md }]}
              >
                {item.mediaType === 'video' ? (
                  <VideoThumbnail
                    posterUri={item.posterUri}
                    durationMs={item.durationMs}
                    style={StyleSheet.absoluteFill}
                  />
                ) : (
                  <AppImage source={{ uri: item.uri }} style={StyleSheet.absoluteFill} />
                )}
              </View>
            ))}
          </View>
        ) : null
      ) : (
        <>
          {assets.length > 0 ? (
            <View style={styles.mediaGrid} onLayout={mediaGrid.onLayout}>
              {assets.map((asset, index) => (
                <View
                  key={asset.key}
                  style={[
                    styles.mediaCell,
                    { height: mediaCellSize, borderRadius: theme.radius.md },
                  ]}
                >
                  <Pressable
                    accessibilityRole={asset.mediaType === 'video' ? 'button' : 'image'}
                    accessibilityLabel={
                      asset.mediaType === 'video' ? 'Videoyu önizle' : `Fotoğraf ${index + 1}`
                    }
                    onPress={() => {
                      if (asset.mediaType === 'video') setVideoPreview(asset.uri);
                    }}
                    style={StyleSheet.absoluteFill}
                  >
                    {asset.mediaType === 'video' ? (
                      <VideoThumbnail
                        posterUri={posters[asset.key]}
                        durationMs={asset.durationMs}
                        style={StyleSheet.absoluteFill}
                      />
                    ) : (
                      <Image
                        source={{ uri: asset.uri }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                      />
                    )}
                  </Pressable>
                  {index === 0 ? (
                    <View style={styles.coverBadge}>
                      <AppText variant="caption" color="onPrimary">
                        Kapak
                      </AppText>
                    </View>
                  ) : null}
                  <View style={styles.reorderRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Medyayı öne al"
                      disabled={index === 0}
                      onPress={() => moveAsset(asset.key, -1)}
                      style={[styles.miniButton, index === 0 ? styles.disabled : null]}
                    >
                      <Ionicons name="chevron-back" size={13} color="#FFFFFF" />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Medyayı arkaya al"
                      disabled={index === assets.length - 1}
                      onPress={() => moveAsset(asset.key, 1)}
                      style={[
                        styles.miniButton,
                        index === assets.length - 1 ? styles.disabled : null,
                      ]}
                    >
                      <Ionicons name="chevron-forward" size={13} color="#FFFFFF" />
                    </Pressable>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Medyayı kaldır"
                    onPress={() => removeAsset(asset.key)}
                    style={styles.removeMedia}
                  >
                    <Ionicons name="close" size={13} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.pickRow}>
            <PickerAction
              icon="images-outline"
              label="Galeri"
              onPress={() => void pick('library', 'all')}
            />
            <PickerAction
              icon="camera-outline"
              label="Fotoğraf"
              onPress={() => void pick('camera', 'image')}
            />
            <PickerAction
              icon="videocam-outline"
              label="Video çek"
              onPress={() => void pick('camera', 'video')}
            />
          </View>
          <AppText variant="caption" color="textTertiary">
            Fotoğraf ve videoyu aynı gönderide kullanabilirsin. Kapak, ilk medyadır.
          </AppText>
        </>
      )}

      <View style={styles.optionGroup}>
        <AppText variant="label" color="textSecondary">
          Kategori
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kategori seç"
          onPress={() => setCategoryOpen(true)}
          style={({ pressed }) => [
            styles.optionRow,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons name="pricetag-outline" size={18} color={theme.colors.textSecondary} />
          <AppText variant="body" style={styles.optionLabel}>
            {categoryLabel(category)}
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      </View>

      <View style={styles.optionGroup}>
        <AppText variant="label" color="textSecondary">
          Yer
        </AppText>
        <View style={styles.locationRow}>
          <View style={[styles.locationChip, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="business-outline" size={13} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              Trabzon
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="İlçe seç"
            onPress={() => setDistrictOpen(true)}
            style={({ pressed }) => [
              styles.locationChip,
              {
                backgroundColor: district ? theme.colors.primarySoft : theme.colors.surface,
                borderColor: district ? theme.colors.primary : theme.colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons
              name="location-outline"
              size={13}
              color={district ? theme.colors.primaryDeep : theme.colors.textSecondary}
            />
            <AppText variant="caption" color={district ? 'primaryDeep' : 'textSecondary'}>
              {district ?? 'İlçe seç (isteğe bağlı)'}
            </AppText>
            {district ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="İlçeyi kaldır"
                hitSlop={6}
                onPress={() => setDistrict(null)}
              >
                <Ionicons name="close-circle" size={14} color={theme.colors.primaryDeep} />
              </Pressable>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Konum tercihi"
            onPress={openLocationOptions}
            style={({ pressed }) => [
              styles.locationChip,
              {
                backgroundColor:
                  precision === 'approximate' ? theme.colors.primarySoft : theme.colors.surface,
                borderColor:
                  precision === 'approximate' ? theme.colors.primary : theme.colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons
              name={precision === 'approximate' ? 'navigate' : 'navigate-outline'}
              size={13}
              color={
                precision === 'approximate' ? theme.colors.primaryDeep : theme.colors.textSecondary
              }
            />
            <AppText
              variant="caption"
              color={precision === 'approximate' ? 'primaryDeep' : 'textSecondary'}
            >
              {precision === 'approximate' ? 'Yaklaşık konum (~1 km)' : 'Konum ekle'}
            </AppText>
          </Pressable>
        </View>
        <AppText variant="caption" color="textTertiary">
          Konum isteğe bağlıdır. Kesin GPS koordinatların hiçbir zaman herkese açık gösterilmez.
        </AppText>
      </View>

      <View style={styles.optionGroup}>
        <AppText variant="label" color="textSecondary">
          Yayın hedefleri
        </AppText>
        <View style={styles.targetGrid}>
          {TARGETS.map((target) => {
            const active = targets.includes(target.key);
            const disabled = target.key === 'reels' && !hasVideo;
            return (
              <Pressable
                key={target.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active, disabled }}
                accessibilityLabel={target.label}
                disabled={disabled || busy}
                onPress={() => toggleTarget(target.key)}
                style={({ pressed }) => [
                  styles.target,
                  {
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={17}
                  color={active ? theme.colors.primary : theme.colors.textTertiary}
                />
                <View style={styles.targetText}>
                  <AppText variant="caption" color={active ? 'primaryDeep' : 'text'}>
                    {target.label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                    {target.key === 'reels' && !hasVideo
                      ? 'Reels için en az bir video gerekir'
                      : target.description}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="caption" color="textTertiary">
          Profil ve ilçe akışı otomatik olarak bu içeriğe bağlanır; ayrı medya yüklenmez.
        </AppText>
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: usageConsent }}
        accessibilityLabel="Haber merkezinin medyamı kullanmasına izin ver"
        onPress={() => setUsageConsent((value) => !value)}
        style={({ pressed }) => [
          styles.consentRow,
          {
            borderColor: theme.colors.border,
            backgroundColor: usageConsent ? theme.colors.primarySoft : theme.colors.surface,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Ionicons
          name={usageConsent ? 'checkbox' : 'square-outline'}
          size={19}
          color={usageConsent ? theme.colors.primary : theme.colors.textTertiary}
        />
        <View style={styles.consentText}>
          <AppText variant="caption" color={usageConsent ? 'primaryDeep' : 'textSecondary'}>
            Trabzone Haber medyamı atıfla kullanabilir
          </AppText>
          <AppText variant="caption" color="textTertiary">
            İzin vermezsen içerik yalnızca senin adına yayında kalır; haber merkezi yeniden
            yayınlayamaz.
          </AppText>
        </View>
      </Pressable>

      {progressLabel ? (
        <View style={[styles.progressBox, { backgroundColor: theme.colors.primarySoft }]}>
          <View style={styles.progressHead}>
            <ActivityIndicator size="small" color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep" style={styles.progressText}>
              {progressLabel}
            </AppText>
            {progress > 0 ? (
              <AppText variant="caption" color="primaryDeep">
                %{Math.round(progress * 100)}
              </AppText>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yüklemeyi iptal et"
              onPress={cancelUpload}
              hitSlop={6}
            >
              <Ionicons name="close-circle" size={18} color={theme.colors.primaryDeep} />
            </Pressable>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: theme.colors.surface }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: theme.colors.primary,
                  width: `${Math.max(progress, 0.05) * 100}%` as `${number}%`,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      {!editingId ? (
        <Button
          label="Yayın önizlemesi"
          variant="secondary"
          onPress={() => {
            haptics.tap();
            setPreviewOpen(true);
          }}
          disabled={busy}
          style={styles.previewCta}
        />
      ) : null}

      <Button
        label={editingId ? 'Değişiklikleri kaydet' : 'Anlık haberi yayınla'}
        onPress={() => void submit()}
        loading={busy}
        size="lg"
        style={styles.submit}
        disabled={busy}
      />

      <AppText variant="caption" color="textTertiary" align="center" style={styles.footerNote}>
        Anlık haberler önce güvenlik kontrolünden geçer. Trafik kazası, yaralanma veya suç iddiası
        içeren paylaşımlar editör onayı bekleyebilir.
      </AppText>

      <SelectSheet
        visible={categoryOpen}
        title="Kategori seç"
        options={LIVE_NEWS_CATEGORIES.map((item) => item.label)}
        value={categoryLabel(category)}
        onClose={() => setCategoryOpen(false)}
        onSelect={(value) => {
          const found = LIVE_NEWS_CATEGORIES.find((item) => item.label === value);
          if (found) setCategory(found.key);
          setCategoryOpen(false);
        }}
      />

      <SelectSheet
        visible={districtOpen}
        title="İlçe seç"
        options={LIVE_NEWS_DISTRICTS}
        value={district}
        onClose={() => setDistrictOpen(false)}
        onSelect={(value) => {
          setDistrict(value);
          setDistrictOpen(false);
        }}
      />

      <LiveNewsPreviewModal
        visible={previewOpen}
        data={previewItem}
        targets={effectiveTargets}
        onClose={() => setPreviewOpen(false)}
        onPublish={() => void submit()}
        busy={busy}
      />

      <VideoModal uri={videoPreview} onClose={() => setVideoPreview(null)} />
    </Screen>
  );
}

type PreviewData = {
  title: string;
  summary: string | null;
  category: LiveNewsCategory;
  district: string | null;
  mediaUri: string | null;
  isVideo: boolean;
  mediaCount: number;
};

function LiveNewsPreviewModal({
  visible,
  data,
  targets,
  busy,
  onClose,
  onPublish,
}: {
  visible: boolean;
  data: PreviewData;
  targets: LiveNewsTarget[];
  busy: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.previewSheet,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl },
          ]}
        >
          <View style={styles.previewHead}>
            <View style={styles.suggestionHead}>
              <AppText variant="h3">Yayın önizlemesi</AppText>
              <AppText variant="caption" color="textTertiary">
                Vatandaş Paylaşımı
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Önizlemeyi kapat"
              onPress={onClose}
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.previewContent}
          >
            <View style={styles.previewCard}>
              <View style={styles.previewAvatarRow}>
                <View style={[styles.previewAvatar, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="person" size={18} color={theme.colors.primaryDeep} />
                </View>
                <View style={styles.previewMeta}>
                  <AppText variant="bodyStrong">Sen</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {data.district ?? 'Trabzon'} · şimdi
                  </AppText>
                </View>
                <View style={[styles.citizenBadge, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="radio-outline" size={10} color={theme.colors.primaryDeep} />
                  <AppText variant="caption" color="primaryDeep">
                    Vatandaş Paylaşımı
                  </AppText>
                </View>
              </View>

              {data.mediaUri ? (
                <View style={styles.previewMedia}>
                  <AppImage
                    source={{ uri: data.mediaUri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                  {data.isVideo ? (
                    <View style={styles.previewVideoBadge}>
                      <Ionicons name="play" size={16} color="#FFFFFF" />
                    </View>
                  ) : null}
                  {data.mediaCount > 1 ? (
                    <View style={styles.previewCount}>
                      <AppText variant="caption" color="#FFFFFF">
                        {data.mediaCount} medya
                      </AppText>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.previewText}>
                <View style={styles.chipRow}>
                  <View
                    style={[styles.previewChip, { backgroundColor: theme.colors.surfaceMuted }]}
                  >
                    <AppText variant="caption" color="textSecondary">
                      {categoryLabel(data.category)}
                    </AppText>
                  </View>
                  {data.district ? (
                    <View
                      style={[styles.previewChip, { backgroundColor: theme.colors.surfaceMuted }]}
                    >
                      <Ionicons
                        name="location-outline"
                        size={11}
                        color={theme.colors.textSecondary}
                      />
                      <AppText variant="caption" color="textSecondary">
                        {data.district}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <AppText variant="h2">{data.title}</AppText>
                {data.summary ? (
                  <AppText variant="body" color="textSecondary">
                    {data.summary}
                  </AppText>
                ) : null}
              </View>
            </View>

            <View style={styles.previewTargets}>
              <AppText variant="caption" color="textTertiary">
                Yayınlanacak alanlar
              </AppText>
              <View style={styles.chipRow}>
                {targets.map((target) => (
                  <View
                    key={target}
                    style={[styles.previewChip, { backgroundColor: theme.colors.primarySoft }]}
                  >
                    <AppText variant="caption" color="primaryDeep">
                      {TARGETS.find((item) => item.key === target)?.label ?? target}
                    </AppText>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.previewActions}>
            <Button
              label="Düzenlemeye dön"
              variant="secondary"
              onPress={onClose}
              style={styles.previewAction}
            />
            <Button
              label="Yayınla"
              onPress={onPublish}
              loading={busy}
              style={styles.previewAction}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function VideoModal({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const { theme } = useTheme();
  return (
    <Modal visible={Boolean(uri)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.videoRoot, { backgroundColor: '#000000' }]}>
        {uri ? <PreviewVideo uri={uri} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Video önizlemesini kapat"
          onPress={onClose}
          style={[styles.videoClose, { backgroundColor: theme.colors.surface }]}
        >
          <Ionicons name="close" size={20} color={theme.colors.text} />
        </Pressable>
      </View>
    </Modal>
  );
}

function PreviewVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
    />
  );
}

function AiMiniButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.aiMini,
        {
          borderColor: theme.colors.border,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </Pressable>
  );
}

function PickerAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pickerAction,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={19} color={theme.colors.primaryDeep} />
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  cancel: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  authorText: { flex: 1, gap: 3 },
  citizenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  field: { marginTop: 16 },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 12 },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  aiMini: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
  },
  hintText: { flex: 1, lineHeight: 16 },
  suggestionBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    gap: 8,
    marginTop: 10,
  },
  suggestionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  suggestion: { paddingVertical: 7, paddingHorizontal: 8, borderRadius: 8 },
  suggestionText: { lineHeight: 17 },
  aiPreview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 7,
    marginTop: 10,
  },
  aiPreviewActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  mediaCell: { width: '31.5%', overflow: 'hidden', backgroundColor: '#00000010' },
  coverBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(9,14,28,0.65)',
  },
  reorderRow: {
    position: 'absolute',
    left: 5,
    right: 5,
    bottom: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  miniButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(9,14,28,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.3 },
  removeMedia: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(9,14,28,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 6 },
  pickerAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionGroup: { gap: 8, marginTop: 20 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: { flex: 1 },
  locationRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  targetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  target: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  targetText: { flex: 1, gap: 2 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 18,
  },
  consentText: { flex: 1, gap: 3 },
  progressBox: { gap: 8, padding: 12, borderRadius: 14, marginTop: 14 },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressText: { flex: 1 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  previewCta: { marginTop: 18 },
  submit: { marginTop: 12 },
  footerNote: { marginTop: 14, lineHeight: 17 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  previewSheet: { maxHeight: '92%', padding: 16, gap: 12 },
  previewHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  previewContent: { gap: 12, paddingBottom: 4 },
  previewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    gap: 10,
  },
  previewAvatarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMeta: { flex: 1, gap: 1 },
  previewMedia: { width: '100%', aspectRatio: 1.1, borderRadius: 16, overflow: 'hidden' },
  previewVideoBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(6,10,20,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCount: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(6,10,20,0.6)',
  },
  previewText: { gap: 7 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  previewTargets: { gap: 6 },
  previewActions: { flexDirection: 'row', gap: 8 },
  previewAction: { flex: 1 },
  videoRoot: { flex: 1, justifyContent: 'center' },
  videoClose: {
    position: 'absolute',
    top: 54,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
