import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { AppText, Avatar, Button, Screen, ScreenHeader } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { VideoThumbnail } from '@/features/media/components/VideoThumbnail';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import {
  publicMediaUrl,
  uploadMedia,
  uploadVideoWithPoster,
  type UploadedMedia,
} from '@/features/media/media-service';
import {
  cancelVideoPreparation,
  formatVideoSize,
  generateVideoPoster,
  prepareVideoForUpload,
} from '@/features/media/video-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useCreatePost, usePost, useUpdatePost } from '@/features/feed/hooks/use-feed';
import type { FeedPost, PostVisibility } from '@/features/feed/services/feed-service';
import { useDeferredExit } from '@/hooks/use-deferred-exit';
import { useMeasuredWidth } from '@/hooks/use-measured-width';
import { useSafetyState } from '@/features/safety/hooks/use-safety';
import { PlaceTagPicker, PlaceTagRow } from '@/features/explore/components/PlaceTagPicker';
import { linkPlaceContent } from '@/features/explore/services/explore-service';
import type { ExploreSearchItem } from '@/features/explore/types';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { PROVINCES } from '@/features/profile/constants/regions';
import { attachFanMedia } from '@/features/sports/services/sports-service';
import type { FanCategory } from '@/features/sports/types';
import { useTheme } from '@/theme/ThemeProvider';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';

const MAX_MEDIA = 10;
const MAX_BODY = 2000;
const DRAFT_KEY = 'trabzone.compose.post.draft.v1';

type DraftAsset = {
  key: string;
  uri: string;
  mediaType: 'image' | 'video';
  mimeType: string | null;
  fileName: string | null;
  /** Video için yerel kapak. `undefined`: henüz üretilmedi, `null`: üretilemedi. */
  thumbnailUri?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  uploaded?: UploadedMedia;
};

type SavedPostDraft = {
  version: 1;
  body: string;
  visibility: PostVisibility;
  city: string | null;
  assets: DraftAsset[];
  savedAt: number;
};

type DraftPayload = {
  uri: string;
  mediaType: 'image' | 'video';
  mimeType: string | null;
  fileName: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
};

function finiteOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** "+" menüsünden galeride seçilen medyayı taşıyan parametreyi çözer. */
function parseDraft(raw: string | undefined): DraftAsset[] {
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is DraftPayload => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const candidate = item as Partial<DraftPayload>;
        return (
          typeof candidate.uri === 'string' &&
          (candidate.mediaType === 'image' || candidate.mediaType === 'video')
        );
      })
      .slice(0, MAX_MEDIA)
      .map((item, index) => ({
        key: `draft-${index}-${item.uri}`,
        uri: item.uri,
        mediaType: item.mediaType,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : null,
        fileName: typeof item.fileName === 'string' ? item.fileName : null,
        // Meta veri taşınırsa "Paylaş" anında native okuma beklenmez ve
        // sıkıştırma bit hızı doğru seçilir.
        durationMs: finiteOrNull(item.durationMs),
        width: finiteOrNull(item.width),
        height: finiteOrNull(item.height),
        fileSize: finiteOrNull(item.fileSize),
      }));
  } catch {
    return [];
  }
}

function readSavedDraft(raw: string | null): SavedPostDraft | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SavedPostDraft> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const body = typeof parsed.body === 'string' ? parsed.body.slice(0, MAX_BODY) : '';
    const visibility: PostVisibility = parsed.visibility === 'followers' ? 'followers' : 'public';
    const city = typeof parsed.city === 'string' ? parsed.city : null;
    const assets = Array.isArray(parsed.assets)
      ? parsed.assets
          .filter((item): item is DraftAsset => {
            if (!item || typeof item !== 'object') {
              return false;
            }
            const candidate = item as Partial<DraftAsset>;
            return (
              typeof candidate.uri === 'string' &&
              (candidate.mediaType === 'image' || candidate.mediaType === 'video')
            );
          })
          .slice(0, MAX_MEDIA)
          .map((item, index) => ({
            key: typeof item.key === 'string' ? item.key : `saved-${index}`,
            uri: item.uri,
            mediaType: item.mediaType,
            mimeType: typeof item.mimeType === 'string' ? item.mimeType : null,
            fileName: typeof item.fileName === 'string' ? item.fileName : null,
            durationMs: finiteOrNull(item.durationMs),
            width: finiteOrNull(item.width),
            height: finiteOrNull(item.height),
            fileSize: finiteOrNull(item.fileSize),
          }))
      : [];
    if (!body.trim() && !city && assets.length === 0) {
      return null;
    }
    return { version: 1, body, visibility, city, assets, savedAt: parsed.savedAt ?? 0 };
  } catch {
    return null;
  }
}

export default function ComposePostScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    postId?: string;
    media?: string;
    draft?: string;
    fixture?: string;
    fanCategory?: string;
  }>();
  const editingId = typeof params.postId === 'string' && params.postId ? params.postId : null;
  const matchTag = useMemo(() => parseMatchTag(params.fixture, params.fanCategory), [params.fixture, params.fanCategory]);

  const { data: existing, isLoading } = usePost(editingId ?? '');
  const initialAssets = useMemo(() => parseDraft(params.draft), [params.draft]);

  // Doğrudan bağlantıyla gelindiğinde geri gidilecek ekran olmayabilir.
  const leaveEditor = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/feed' as never);
  };

  if (editingId && !existing) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader title="Gönderiyi düzenle" onBack={leaveEditor} />
        <View style={styles.loadingBox}>
          {isLoading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <AppText variant="body" color="textSecondary" align="center">
              Gönderi yüklenemedi.
            </AppText>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <ComposePostForm
      // Düzenlenecek gönderi değiştiğinde form durumunun sıfırlanmasını sağlar.
      key={editingId ?? 'new'}
      editingId={editingId}
      existing={existing ?? null}
      initialAssets={initialAssets}
      matchTag={editingId ? null : matchTag}
    />
  );
}

type MatchTag = { fixtureId: number; category: FanCategory };

const FAN_CATEGORY_LABELS: Record<FanCategory, string> = {
  prematch: 'Maç öncesi',
  stadium: 'Stattan',
  video: 'Video',
  watch_party: 'Maç izleme',
  celebration: 'Kutlama',
  opinion: 'Yorum',
};

function parseMatchTag(fixture: unknown, category: unknown): MatchTag | null {
  const id = Number(fixture);
  if (!Number.isSafeInteger(id) || id === 0) return null;
  const cat = typeof category === 'string' && category in FAN_CATEGORY_LABELS ? (category as FanCategory) : 'prematch';
  return { fixtureId: id, category: cat };
}

function ComposePostForm({
  editingId,
  existing,
  initialAssets,
  matchTag,
}: {
  editingId: string | null;
  existing: FeedPost | null;
  initialAssets: DraftAsset[];
  matchTag: MatchTag | null;
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
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();

  /**
   * Paylaşım ekranından çıkış niyeti.
   *
   * `router.replace`/`router.back` doğrudan çağrılmıyor: ekranda kaydedilmemiş
   * içerik varken `usePreventRemove` bu navigasyonu engelliyor. Önce çıkış
   * niyeti state'e yazılır, engel kalktıktan sonra effect gerçek navigasyonu
   * yapar. Paylaşım başarılı olduğunda da aynı yol kullanılır, aksi halde
   * "Paylaş" sonrası ekran açık kalırdı.
   */
  const [exit, setExit] = useState<{ replace: string } | { back: true } | null>(null);
  // Onaydan sonra engellenen geri hareketini güvenli biçimde tamamlar.
  const { approved: approvedExit, dispatchAfterApproval } = useDeferredExit();

  const [body, setBody] = useState(existing?.body ?? '');
  const [visibilityInput, setVisibility] = useState<PostVisibility>(existing?.visibility ?? 'public');
  const [cityInput, setCity] = useState<string | null>(existing?.city ?? null);
  // Kısıtlanmış (18 yaş altı) hesapta görünürlük ve konum sunucuda zorunlu
  // olarak kapatılır; arayüz de aynı kuralı önceden uygular.
  const { data: safetyState } = useSafetyState();
  const restricted = safetyState?.is_child_protected ?? false;
  const [assets, setAssets] = useState<DraftAsset[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  /** Süren paylaşımın iptal anahtarı; "İptal" bunu tetikler. */
  const uploadAbort = useRef<AbortController | null>(null);
  /**
   * Video seçilir seçilmez arka planda hazırlanır. Böylece "Paylaş"a
   * basıldığında bekleme süresi yalnızca yükleme olur.
   */
  const [preparedVideos, setPreparedVideos] = useState<
    Record<string, { ratio: number; size: number | null }>
  >({});
  const [cityOpen, setCityOpen] = useState(false);
  const [placeTagInput, setPlaceTag] = useState<ExploreSearchItem | null>(null);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(
    editingId !== null || initialAssets.length > 0,
  );
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const draftKey = profile?.id ? `${DRAFT_KEY}:${profile.id}` : null;

  // Kısıtlanmış hesapta herkese açık görünürlük, şehir ve mekân etiketi
  // kullanılamaz. Sunucu da bu değerleri zorla kapatır. Kısıt, state'e yazmak
  // yerine değerler türetilerek uygulanır; böylece taslak geri yüklemesi ya da
  // güvenlik durumunun sonradan gelmesi kısıtı atlatamaz.
  const visibility: PostVisibility = restricted ? 'followers' : visibilityInput;
  const city = restricted ? null : cityInput;
  const placeTag = restricted ? null : placeTagInput;

  // Yeni gönderi taslağını kullanıcıya özel olarak cihazda saklar.
  useEffect(() => {
    if (editingId || initialAssets.length > 0 || !draftKey) {
      return;
    }
    let active = true;
    void AsyncStorage.getItem(draftKey)
      .then((raw) => {
        if (!active) {
          return;
        }
        const saved = readSavedDraft(raw);
        if (!saved) {
          return;
        }
        setBody(saved.body);
        setVisibility(saved.visibility);
        setCity(saved.city);
        setAssets(saved.assets);
        setDraftSavedAt(saved.savedAt || Date.now());
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setDraftHydrated(true);
        }
      });
    return () => {
      active = false;
    };
  }, [draftKey, editingId, initialAssets.length]);

  const persistDraft = useCallback(async () => {
    if (!draftKey) {
      return null;
    }
    const trimmed = body.trim();
    if (!trimmed && !city && assets.length === 0) {
      await AsyncStorage.removeItem(draftKey);
      return null;
    }
    const payload: SavedPostDraft = {
      version: 1,
      body: trimmed,
      visibility,
      city,
      assets: assets.map((asset) => ({
        key: asset.key,
        uri: asset.uri,
        mediaType: asset.mediaType,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        durationMs: asset.durationMs ?? null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        fileSize: asset.fileSize ?? null,
      })),
      savedAt: Date.now(),
    };
    await AsyncStorage.setItem(draftKey, JSON.stringify(payload));
    return payload.savedAt;
  }, [assets, body, city, draftKey, visibility]);

  useEffect(() => {
    if (editingId || !draftHydrated || !draftKey || uploading) {
      return;
    }
    const timer = setTimeout(() => {
      void persistDraft()
        .then((savedAt) => {
          setDraftSavedAt(savedAt);
        })
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [draftHydrated, draftKey, editingId, persistDraft, uploading]);

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

  const addPicked = useCallback((picked: PickedAsset[]) => {
    setAssets((current) => [
      ...current,
      ...picked.map((asset) => ({
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

  // Seçilen videoların kapak karesini hemen üretir; paylaşım ekranı videoyu
  // indirmeden gerçek bir önizleme gösterir.
  useEffect(() => {
    if (editingId) {
      return;
    }
    const pending = assets.filter(
      (asset) => asset.mediaType === 'video' && asset.thumbnailUri === undefined,
    );
    if (pending.length === 0) {
      return;
    }
    let active = true;
    void (async () => {
      for (const asset of pending) {
        const poster = await generateVideoPoster(asset.uri);
        if (!active) {
          return;
        }
        setAssets((current) =>
          current.map((item) =>
            item.key === asset.key ? { ...item, thumbnailUri: poster?.uri ?? null } : item,
          ),
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [assets, editingId]);

  // Video sıkıştırmasını seçim anında başlatır. Sonuç video-service içinde
  // URI bazında önbelleklendiği için "Paylaş" aynı işi ikinci kez yapmaz.
  const videoSignature = useMemo(
    () =>
      assets
        .filter((asset) => asset.mediaType === 'video')
        .map((asset) => asset.uri)
        .join('|'),
    [assets],
  );

  useEffect(() => {
    if (editingId || !videoSignature) {
      return;
    }
    let active = true;
    const videos = assets.filter((asset) => asset.mediaType === 'video');
    for (const asset of videos) {
      void prepareVideoForUpload(
        {
          uri: asset.uri,
          durationMs: asset.durationMs,
          width: asset.width,
          height: asset.height,
          size: asset.fileSize,
        },
        {
          onProgress: (ratio) => {
            if (!active) {
              return;
            }
            setPreparedVideos((current) => {
              const existing = current[asset.key];
              const next = Math.max(existing?.ratio ?? 0, ratio);
              if (existing && existing.ratio === next) {
                return current;
              }
              return { ...current, [asset.key]: { ratio: next, size: existing?.size ?? null } };
            });
          },
        },
      )
        .then((prepared) => {
          if (!active) {
            return;
          }
          setPreparedVideos((current) => ({
            ...current,
            [asset.key]: { ratio: 1, size: prepared.size },
          }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
    // `assets` her kapak güncellemesinde değişir; sıkıştırmayı yalnızca video
    // listesi değiştiğinde tetiklemek için imza kullanılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, videoSignature]);

  const addFromLibrary = useCallback(
    async (kind: 'image' | 'video' | 'all') => {
      const picked = await pickMedia({
        source: 'library',
        kind,
        multiple: kind !== 'video',
        limit: MAX_MEDIA - assets.length,
      });
      if (!picked) {
        return;
      }
      addPicked(picked);
    },
    [addPicked, assets.length],
  );

  const takePhoto = useCallback(async () => {
    const picked = await pickMedia({ source: 'camera', kind: 'image' });
    if (picked?.length) {
      addPicked(picked);
    }
  }, [addPicked]);

  const removeAsset = (key: string) => {
    // Kaldırılan video arka planda sıkıştırılmaya devam etmesin.
    const target = assets.find((asset) => asset.key === key);
    if (target?.mediaType === 'video') {
      cancelVideoPreparation(target.uri);
    }
    setAssets((current) => current.filter((asset) => asset.key !== key));
  };

  const moveAsset = useCallback((key: string, direction: -1 | 1) => {
    setAssets((current) => {
      const index = current.findIndex((asset) => asset.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) {
        return current;
      }
      next.splice(target, 0, moved);
      return next;
    });
  }, []);

  const uploadAll = useCallback(
    async (userId: string, signal: AbortSignal): Promise<UploadedMedia[] | null> => {
      const total = assets.length;
      if (total === 0) {
        return [];
      }
      if (signal.aborted) {
        return null;
      }

      const uploaded: (UploadedMedia | null)[] = new Array<UploadedMedia | null>(total).fill(null);
      const ratios = new Array<number>(total).fill(0);
      let nextIndex = 0;
      let failed = false;

      const flushProgress = () => {
        const sum = ratios.reduce((acc, value) => acc + value, 0);
        setUploadProgress(Math.min(1, sum / total));
      };

      setUploadProgress(0);
      setProgressLabel('Medya hazırlanıyor');

      const uploadOne = async (index: number) => {
        const asset = assets[index]!;
        const slot = index + 1;
        const setRatio = (ratio: number) => {
          // Aynı medya için ilerleme geri gitmesin.
          ratios[index] = Math.min(1, Math.max(ratios[index] ?? 0, ratio));
          flushProgress();
        };

        if (asset.mediaType === 'video') {
          const result = await uploadVideoWithPoster({
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
              if (signal.aborted) {
                return;
              }
              setProgressLabel(
                stage === 'preparing'
                  ? `Video hazırlanıyor ${slot}/${total}`
                  : `Video yükleniyor ${slot}/${total}`,
              );
              setRatio(stage === 'preparing' ? ratio * 0.9 : 0.9 + ratio * 0.1);
            },
          });
          if (!result.ok) {
            // İptal bir hata değil: kullanıcı bilinçli olarak vazgeçti.
            if (result.error.code !== 'cancelled') {
              Alert.alert('Yükleme başarısız', result.error.message);
            }
            return null;
          }
          return result.data.video;
        }

        setProgressLabel(`Medya yükleniyor ${slot}/${total}`);
        const result = await uploadMedia({
          bucket: 'posts',
          folder: userId,
          uri: asset.uri,
          mime: asset.mimeType,
          fileName: asset.fileName,
          width: asset.width,
          height: asset.height,
          signal,
          onProgress: (_stage, ratio) => {
            if (!signal.aborted) {
              setRatio(ratio);
            }
          },
        });
        if (!result.ok) {
          if (result.error.code !== 'cancelled') {
            Alert.alert('Yükleme başarısız', result.error.message);
          }
          return null;
        }
        return result.data;
      };

      // Birden fazla fotoğrafı sırayla yüklemek, ağ ve kodlayıcı boşta
      // beklerken süreyi katlıyordu. Video varsa CPU'yu boğmamak için
      // eşzamanlılık düşük tutulur.
      const concurrency = Math.min(
        total,
        assets.some((asset) => asset.mediaType === 'video') ? 2 : 3,
      );

      const worker = async () => {
        while (!failed && !signal.aborted) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= total) {
            return;
          }
          const result = await uploadOne(index);
          if (!result) {
            failed = true;
            return;
          }
          uploaded[index] = result;
          ratios[index] = 1;
          flushProgress();
        }
      };

      await Promise.all(Array.from({ length: concurrency }, worker));

      if (failed) {
        return null;
      }

      const results = uploaded.filter((item): item is UploadedMedia => item !== null);
      if (results.length !== total) {
        return null;
      }

      setUploadProgress(1);
      return results;
    },
    [assets],
  );

  const submit = useCallback(async () => {
    const trimmed = body.trim();
    if (editingId) {
      if (!trimmed && existingMedia.length === 0) {
        Alert.alert('Gönderi boş', 'Bir metin yaz veya medya ekle.');
        return;
      }
      updatePost.mutate(
        { postId: editingId, body: trimmed || null, visibility },
        {
          onSuccess: () => {
            haptics.success();
            setExit({ back: true });
          },
          onError: (error) => Alert.alert('Güncellenemedi', toMessage(error)),
        },
      );
      return;
    }

    if (!trimmed && assets.length === 0) {
      Alert.alert('Gönderi boş', 'Bir metin yaz veya medya ekle.');
      return;
    }
    if (!profile?.id) {
      Alert.alert('Oturum gerekli', 'Gönderi paylaşmak için giriş yapmalısın.');
      return;
    }

    setUploading(true);
    setProgressLabel(assets.length > 0 ? 'Medya hazırlanıyor' : 'Paylaşılıyor');
    // Yükleme sürerken "İptal" bu sinyali tetikler: süren sıkıştırma ve ağ
    // isteği gerçekten durur, yarım dosya depoda bırakılmaz.
    const controller = new AbortController();
    uploadAbort.current = controller;
    try {
      const media = await uploadAll(profile.id, controller.signal);
      if (!media) {
        return;
      }
      if (controller.signal.aborted) {
        return;
      }
      const postId = await new Promise<string>((resolve, reject) => {
        createPost.mutate(
          {
            body: trimmed || null,
            visibility,
            city,
            media: media.map((item) => ({
              storage_path: item.path,
              thumbnail_path: item.thumbnailPath ?? null,
              media_type: item.mediaType,
              width: item.width,
              height: item.height,
              duration_ms: item.durationMs,
            })),
          },
          {
            onSuccess: resolve,
            onError: reject,
          },
        );
      });
      if (placeTag && !restricted) {
        try {
          await linkPlaceContent(String(placeTag.id), { postId });
        } catch (error) {
          Alert.alert(
            'Gönderi yayınlandı',
            `Gönderi paylaşıldı ancak işletme etiketi eklenemedi: ${toMessage(error)}`,
          );
        }
      }
      let matchRoute: string | null = null;
      if (matchTag && !restricted) {
        const attached = await attachFanMedia(matchTag.fixtureId, postId, matchTag.category);
        if (attached.ok) {
          matchRoute = `/trabzonspor/mac/${matchTag.fixtureId}?tab=fans`;
        } else {
          Alert.alert('Gönderi yayınlandı', `Gönderi paylaşıldı ancak maç sayfasına eklenemedi: ${attached.error.message}`);
        }
      }
      haptics.success();
      if (draftKey) {
        await AsyncStorage.removeItem(draftKey).catch(() => undefined);
      }
      setDraftSavedAt(null);
      setAssets([]);
      setBody('');
      setExit({ replace: matchRoute ?? `/post/${postId}` });
    } catch (error) {
      if (!controller.signal.aborted) {
        Alert.alert('Paylaşılamadı', toMessage(error));
      }
    } finally {
      // Kullanıcı iptal edip hemen yeniden paylaştıysa eski isteğin temizliği
      // yeni yüklemenin durumunu sıfırlamamalı.
      if (uploadAbort.current === controller) {
        uploadAbort.current = null;
        setUploading(false);
        setProgressLabel(null);
        setUploadProgress(0);
      }
    }
  }, [
    assets,
    body,
    city,
    createPost,
    draftKey,
    editingId,
    existingMedia,
    matchTag,
    placeTag,
    profile,
    restricted,
    updatePost,
    uploadAll,
    visibility,
  ]);

  const busy = uploading || createPost.isPending || updatePost.isPending;
  const canInteract = !busy;

  /** Kaydedilmemiş bir şey var mı? Çıkışta onay istemek için kullanılır. */
  const hasChanges = editingId
    ? body !== (existing?.body ?? '') || visibility !== (existing?.visibility ?? 'public')
    : body.trim().length > 0 || assets.length > 0 || city !== null || placeTag !== null;

  useEffect(() => {
    if (!exit) {
      return;
    }
    if ('back' in exit) {
      // Doğrudan bağlantıyla gelindiğinde geri gidilecek ekran olmayabilir.
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/feed' as never);
      }
      return;
    }
    router.replace(exit.replace as never);
  }, [exit, router]);

  const saveDraftAndClose = useCallback(async () => {
    if (!draftKey) {
      Alert.alert('Taslak kaydedilemedi', 'Hesap bilgilerin yükleniyor, birazdan yeniden dene.');
      return;
    }
    try {
      const savedAt = await persistDraft();
      if (savedAt) {
        haptics.success();
      }
      setExit({ back: true });
    } catch {
      Alert.alert('Taslak kaydedilemedi', 'Bağlantını kontrol edip yeniden dene.');
    }
  }, [draftKey, persistDraft]);

  /**
   * Arka planda başlamış video hazırlığını durdurur.
   *
   * Video seçildiği anda sıkıştırma başlıyor. Kullanıcı paylaşımdan
   * vazgeçtiğinde bu iş kendiliğinden bitene kadar çalışmaya devam ediyordu:
   * cihaz ısınıyor, pil tükeniyor ve native encoder açık kalıyordu.
   */
  const cancelVideoWork = useCallback(() => {
    for (const asset of assets) {
      if (asset.mediaType === 'video') {
        cancelVideoPreparation(asset.uri);
      }
    }
  }, [assets]);

  /** Yükleme sürerken gösterilen "İptal" düğmesi. */
  const cancelUpload = useCallback(() => {
    if (!uploadAbort.current) {
      return;
    }
    Alert.alert(
      'Yükleme iptal edilsin mi?',
      'Yüklenen medya silinir ve gönderi paylaşılmaz. Yazdıkların ekranda kalır.',
      [
        { text: 'Devam etsin', style: 'cancel' },
        {
          text: 'İptal et',
          style: 'destructive',
          onPress: () => {
            haptics.tap();
            uploadAbort.current?.abort();
            cancelVideoWork();
          },
        },
      ],
    );
  }, [cancelVideoWork]);

  /**
   * "İptal" akışı. Hem üst köşedeki düğme hem donanım/yüzey geri hareketi
   * buradan geçer; böylece hiçbir çıkış yolu içeriği sessizce silmez.
   */
  const requestCancel = useCallback(
    (proceed: () => void) => {
      if (busy) {
        Alert.alert(
          'Paylaşım sürüyor',
          'Yükleme tamamlanana kadar ekrandan ayrılamazsın. İstersen yüklemeyi iptal edebilirsin.',
          uploading
            ? [
                { text: 'Bekle', style: 'cancel' },
                {
                  text: 'Yüklemeyi iptal et',
                  style: 'destructive',
                  onPress: () => {
                    uploadAbort.current?.abort();
                    cancelVideoWork();
                  },
                },
              ]
            : [{ text: 'Tamam' }],
        );
        return;
      }
      if (!hasChanges) {
        cancelVideoWork();
        proceed();
        return;
      }
      if (editingId) {
        Alert.alert('Vazgeçilsin mi?', 'Yaptığın değişiklikler kaydedilmeyecek.', [
          { text: 'Düzenlemeye dön', style: 'cancel' },
          {
            text: 'Vazgeç',
            style: 'destructive',
            onPress: () => {
              cancelVideoWork();
              proceed();
            },
          },
        ]);
        return;
      }
      Alert.alert(
        'Paylaşımdan vazgeçilsin mi?',
        'Yazdıkların ve seçtiğin medya kaldırılacak. Devam etmek istersen taslak olarak saklayabilirsin.',
        [
          { text: 'Paylaşıma dön', style: 'cancel' },
          {
            text: 'Taslak olarak sakla',
            onPress: () => {
              void (async () => {
                try {
                  await persistDraft();
                  haptics.success();
                  cancelVideoWork();
                  proceed();
                } catch {
                  Alert.alert('Taslak kaydedilemedi', 'Bağlantını kontrol edip yeniden dene.');
                }
              })();
            },
          },
          {
            text: 'Sil ve çık',
            style: 'destructive',
            onPress: () => {
              cancelVideoWork();
              if (draftKey) {
                void AsyncStorage.removeItem(draftKey).catch(() => undefined);
              }
              proceed();
            },
          },
        ],
      );
    },
    [busy, cancelVideoWork, draftKey, editingId, hasChanges, persistDraft, uploading],
  );

  // Donanım geri tuşu, üst kenardan geri kaydırma ve başlıktaki geri oku
  // aynı onay akışına bağlanır.
  usePreventRemove(!exit && !approvedExit && (hasChanges || busy), ({ data }) => {
    requestCancel(() => dispatchAfterApproval(data.action));
  });

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll keyboardAware>
      <ScreenHeader
        title={editingId ? 'Gönderiyi düzenle' : 'Yeni gönderi'}
        subtitle={editingId ? 'Metni ve görünürlüğü güncelle' : 'Topluluğunla bir şey paylaş'}
        left={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Paylaşımdan vazgeç"
            disabled={busy}
            onPress={() => requestCancel(() => setExit({ back: true }))}
            style={({ pressed }) => [styles.cancel, { opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
          >
            <AppText variant="label" color="textSecondary">
              İptal
            </AppText>
          </Pressable>
        }
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editingId ? 'Gönderiyi kaydet' : 'Gönderiyi paylaş'}
            disabled={busy}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.publish,
              {
                backgroundColor: theme.colors.primary,
                opacity: busy ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.colors.onPrimary} />
            ) : (
              <AppText variant="label" color="onPrimary">
                {editingId ? 'Kaydet' : 'Paylaş'}
              </AppText>
            )}
          </Pressable>
        }
      />

      <View style={styles.authorRow}>
        <Avatar
          uri={profile ? mediaPublicUrl('avatar', profile.avatar_path) : null}
          name={profile ? `${profile.first_name} ${profile.last_name}` : 'Trabzone'}
          size={44}
        />
        <View style={styles.authorMeta}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {profile ? `${profile.first_name} ${profile.last_name}` : 'Sen'}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            @{profile?.username ?? 'trabzone'}
          </AppText>
        </View>
        {!editingId ? (
          <View
            style={[styles.draftStatus, { backgroundColor: theme.colors.surfaceMuted }]}
            accessibilityLabel={draftSavedAt ? 'Taslak kaydedildi' : 'Taslak otomatik kaydedilir'}
          >
            <Ionicons
              name={draftSavedAt ? 'cloud-done-outline' : 'cloud-upload-outline'}
              size={14}
              color={theme.colors.textTertiary}
            />
            <AppText variant="caption" color="textTertiary">
              {draftSavedAt ? 'Taslak kaydedildi' : 'Taslak'}
            </AppText>
          </View>
        ) : null}
      </View>

      <TextInput
        value={body}
        onChangeText={(value) => setBody(value.slice(0, MAX_BODY))}
        placeholder="Ne düşünüyorsun?"
        placeholderTextColor={theme.colors.textTertiary}
        multiline
        editable={canInteract}
        accessibilityLabel="Gönderi metni"
        style={[styles.bodyInput, { color: theme.colors.text }]}
      />
      <AppText variant="caption" color="textTertiary" align="right">
        {body.length}/{MAX_BODY}
      </AppText>

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
                    qualityLabel="1080p"
                    style={StyleSheet.absoluteFill}
                  />
                ) : (
                  <Image
                    source={{ uri: item.uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                )}
              </View>
            ))}
            <AppText variant="caption" color="textTertiary">
              Düzenleme sırasında medya değiştirilemez; yeni medya için gönderiyi silip yeniden
              paylaşabilirsin.
            </AppText>
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
                  {asset.mediaType === 'video' ? (
                    <VideoThumbnail
                      posterUri={asset.thumbnailUri}
                      durationMs={asset.durationMs}
                      qualityLabel="1080p"
                      style={StyleSheet.absoluteFill}
                    />
                  ) : (
                    <Image
                      source={{ uri: asset.uri }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                  )}
                  {asset.mediaType === 'video' ? (
                    <VideoPrepBadge
                      ratio={preparedVideos[asset.key]?.ratio ?? 0}
                      size={preparedVideos[asset.key]?.size ?? null}
                    />
                  ) : null}
                  {index === 0 ? (
                    <View style={styles.coverBadge}>
                      <AppText variant="caption" color="onPrimary">
                        Kapak
                      </AppText>
                    </View>
                  ) : null}
                  {assets.length > 1 ? (
                    <View style={styles.reorderRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Medyayı öne al"
                        disabled={index === 0}
                        onPress={() => moveAsset(asset.key, -1)}
                        style={[styles.reorderButton, index === 0 ? styles.reorderDisabled : null]}
                      >
                        <Ionicons name="chevron-back" size={13} color="#FFFFFF" />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Medyayı arkaya al"
                        disabled={index === assets.length - 1}
                        onPress={() => moveAsset(asset.key, 1)}
                        style={[
                          styles.reorderButton,
                          index === assets.length - 1 ? styles.reorderDisabled : null,
                        ]}
                      >
                        <Ionicons name="chevron-forward" size={13} color="#FFFFFF" />
                      </Pressable>
                    </View>
                  ) : null}
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

          {assets.length < MAX_MEDIA ? (
            <View style={styles.pickRow}>
              <PickerAction
                icon="images-outline"
                label="Galeri"
                onPress={() => void addFromLibrary('all')}
              />
              <PickerAction icon="camera-outline" label="Kamera" onPress={() => void takePhoto()} />
              <PickerAction
                icon="videocam-outline"
                label="Video"
                onPress={() => void addFromLibrary('video')}
              />
            </View>
          ) : (
            <AppText variant="caption" color="textTertiary">
              En fazla {MAX_MEDIA} medya ekleyebilirsin.
            </AppText>
          )}

          {assets.some((asset) => asset.mediaType === 'video') ? (
            <View style={[styles.videoHint, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="sparkles-outline" size={14} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep" style={styles.videoHintText}>
                Süre sınırı yok. Hangi boyutta olursa olsun video paylaşılmadan önce otomatik
                sıkıştırılır; seçtiğin anda arka planda başlar.
              </AppText>
            </View>
          ) : null}
        </>
      )}

      <View style={styles.optionGroup}>
        <AppText variant="label" color="textSecondary">
          Görünürlük
        </AppText>
        {restricted ? (
          <View style={[styles.restrictedNote, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="shield-checkmark" size={15} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep" style={styles.optionLabel}>
              Çocuk Hesabı: Gönderilerin yalnızca arkadaşların tarafından görülebilir. Herkese açık
              paylaşım ve konum etiketi bu hesapta kapalıdır.
            </AppText>
          </View>
        ) : null}
        <View style={styles.segmentRow}>
          {(
            restricted
              ? [{ key: 'followers', label: 'Arkadaşlar', icon: 'people-outline' }]
              : [
                  { key: 'public', label: 'Herkes', icon: 'globe-outline' },
                  { key: 'followers', label: 'Takipçiler', icon: 'people-outline' },
                ]
          ).map((option) => {
            const active = visibility === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: restricted }}
                accessibilityLabel={option.label}
                disabled={restricted}
                onPress={() => setVisibility(option.key as PostVisibility)}
                style={({ pressed }) => [
                  styles.segment,
                  {
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    opacity: (pressed || restricted) ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={option.icon as React.ComponentProps<typeof Ionicons>['name']}
                  size={15}
                  color={active ? theme.colors.primaryDeep : theme.colors.textSecondary}
                />
                <AppText variant="label" color={active ? 'primaryDeep' : 'textSecondary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {!restricted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Şehir ekle"
          onPress={() => setCityOpen(true)}
          style={({ pressed }) => [
            styles.optionRow,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons name="location-outline" size={18} color={theme.colors.textSecondary} />
          <AppText variant="body" color={city ? 'text' : 'textTertiary'} style={styles.optionLabel}>
            {city ?? 'Şehir ekle (isteğe bağlı)'}
          </AppText>
          {city ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Şehri kaldır"
              onPress={() => setCity(null)}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
            </Pressable>
          ) : (
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
          )}
        </Pressable>
      ) : null}

      {matchTag && !restricted ? (
        <View style={[styles.matchTag, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="football-outline" size={18} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="primaryDeep" style={styles.optionLabel}>
            Maç Arenası · Taraftarlar ({FAN_CATEGORY_LABELS[matchTag.category]}). Gönderi herkese açık olmalı; TV veya
            maç yayını görüntüsü paylaşma.
          </AppText>
        </View>
      ) : null}

      {!editingId && !restricted ? (
        <PlaceTagRow
          value={placeTag}
          onPress={() => setPlacePickerOpen(true)}
          onClear={() => setPlaceTag(null)}
        />
      ) : null}

      {progressLabel ? (
        <View style={[styles.progress, { backgroundColor: theme.colors.primarySoft }]}>
          <View style={styles.progressHeader}>
            <ActivityIndicator size="small" color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep" style={styles.progressLabel}>
              {progressLabel}
            </AppText>
            {uploadProgress > 0 ? (
              <AppText variant="caption" color="primaryDeep">
                %{Math.round(uploadProgress * 100)}
              </AppText>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yüklemeyi iptal et"
              hitSlop={8}
              onPress={cancelUpload}
              style={({ pressed }) => [
                styles.progressCancel,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.primary,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="close" size={12} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="primaryDeep">
                İptal
              </AppText>
            </Pressable>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: theme.colors.surface }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: theme.colors.primary,
                  width: `${Math.max(uploadProgress, 0.06) * 100}%` as `${number}%`,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      {!editingId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Taslak olarak kaydet ve çık"
          disabled={busy}
          onPress={() => void saveDraftAndClose()}
          style={({ pressed }) => [styles.draftButton, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="bookmark-outline" size={17} color={theme.colors.textSecondary} />
          <AppText variant="label" color="textSecondary">
            Taslak olarak kaydet
          </AppText>
        </Pressable>
      ) : null}

      {!editingId ? (
        <Button
          label="Gönderiyi paylaş"
          onPress={() => void submit()}
          loading={busy}
          size="lg"
          style={styles.submit}
        />
      ) : (
        <Button
          label="Değişiklikleri kaydet"
          onPress={() => void submit()}
          loading={busy}
          size="lg"
          style={styles.submit}
        />
      )}

      <PlaceTagPicker
        visible={placePickerOpen}
        selectedId={placeTag ? String(placeTag.id) : null}
        onClose={() => setPlacePickerOpen(false)}
        onSelect={setPlaceTag}
        onClear={() => setPlaceTag(null)}
      />

      <SelectSheet
        visible={cityOpen}
        title="Şehir seç"
        options={PROVINCES}
        value={city}
        onClose={() => setCityOpen(false)}
        onSelect={(value) => {
          setCity(value);
          setCityOpen(false);
        }}
      />
    </Screen>
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

function VideoPrepBadge({ ratio, size }: { ratio: number; size: number | null }) {
  const sizeLabel = formatVideoSize(size);
  return (
    <View style={styles.prepBadge}>
      <AppText variant="caption" color="onPrimary" style={styles.prepBadgeText}>
        {ratio >= 1
          ? `Hazır${sizeLabel ? ` · ${sizeLabel}` : ''}`
          : `Hazırlanıyor %${Math.round(ratio * 100)}`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  cancel: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: 4,
  },
  publish: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    minWidth: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  authorMeta: { flex: 1, gap: 2 },
  draftStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  bodyInput: {
    fontSize: 17,
    lineHeight: 25,
    minHeight: 108,
    marginTop: 8,
    textAlignVertical: 'top',
  },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  mediaCell: { width: '31.5%', overflow: 'hidden', backgroundColor: '#00000010' },
  videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
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
  coverBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(9,14,28,0.65)',
  },
  prepBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(9,14,28,0.65)',
    maxWidth: '90%',
  },
  prepBadgeText: { fontSize: 9.5, lineHeight: 13 },
  reorderRow: {
    position: 'absolute',
    left: 5,
    right: 5,
    bottom: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reorderButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(9,14,28,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderDisabled: { opacity: 0.3 },
  pickRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  videoHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 10,
    borderRadius: 12,
    marginTop: 10,
  },
  videoHintText: { flex: 1, lineHeight: 17 },
  pickerAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionGroup: { gap: 8, marginTop: 22 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  restrictedNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 12 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
  },
  optionLabel: { flex: 1 },
  matchTag: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12 },
  progress: {
    gap: 8,
    padding: 12,
    borderRadius: 14,
    marginTop: 14,
  },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressCancel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 26,
  },
  progressLabel: { flex: 1 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  draftButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    marginTop: 18,
  },
  submit: { marginTop: 22 },
});
