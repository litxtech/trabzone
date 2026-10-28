import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

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
  formatVideoSize,
  generateVideoPoster,
  prepareVideoForUpload,
} from '@/features/media/video-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useCreatePost, usePost, useUpdatePost } from '@/features/feed/hooks/use-feed';
import type { FeedPost, PostVisibility } from '@/features/feed/services/feed-service';
import { PlaceTagPicker, PlaceTagRow } from '@/features/explore/components/PlaceTagPicker';
import { linkPlaceContent } from '@/features/explore/services/explore-service';
import type { ExploreSearchItem } from '@/features/explore/types';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { PROVINCES } from '@/features/profile/constants/regions';
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
};

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
  const params = useLocalSearchParams<{ postId?: string; media?: string; draft?: string }>();
  const editingId = typeof params.postId === 'string' && params.postId ? params.postId : null;

  const { data: existing, isLoading } = usePost(editingId ?? '');
  const initialAssets = useMemo(() => parseDraft(params.draft), [params.draft]);

  if (editingId && !existing) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader title="Gönderiyi düzenle" onBack={() => router.back()} />
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
    />
  );
}

function ComposePostForm({
  editingId,
  existing,
  initialAssets,
}: {
  editingId: string | null;
  existing: FeedPost | null;
  initialAssets: DraftAsset[];
}) {
  const { theme } = useTheme();
  const router = useRouter();

  const { data: profile } = useMyProfile();
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();

  const [body, setBody] = useState(existing?.body ?? '');
  const [visibility, setVisibility] = useState<PostVisibility>(existing?.visibility ?? 'public');
  const [city, setCity] = useState<string | null>(existing?.city ?? null);
  const [assets, setAssets] = useState<DraftAsset[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  /**
   * Video seçilir seçilmez arka planda hazırlanır. Böylece "Paylaş"a
   * basıldığında bekleme süresi yalnızca yükleme olur.
   */
  const [preparedVideos, setPreparedVideos] = useState<
    Record<string, { ratio: number; size: number | null }>
  >({});
  const [cityOpen, setCityOpen] = useState(false);
  const [placeTag, setPlaceTag] = useState<ExploreSearchItem | null>(null);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(
    editingId !== null || initialAssets.length > 0,
  );
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const draftKey = profile?.id ? `${DRAFT_KEY}:${profile.id}` : null;

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
    async (userId: string): Promise<UploadedMedia[] | null> => {
      const total = assets.length;
      if (total === 0) {
        return [];
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
            onProgress: (stage, ratio) => {
              setProgressLabel(
                stage === 'preparing'
                  ? `Video hazırlanıyor ${slot}/${total}`
                  : `Video yükleniyor ${slot}/${total}`,
              );
              setRatio(stage === 'preparing' ? ratio * 0.9 : 0.9 + ratio * 0.1);
            },
          });
          if (!result.ok) {
            Alert.alert('Yükleme başarısız', result.error.message);
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
          onProgress: (_stage, ratio) => setRatio(ratio),
        });
        if (!result.ok) {
          Alert.alert('Yükleme başarısız', result.error.message);
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
        while (!failed) {
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
            router.back();
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
    try {
      const media = await uploadAll(profile.id);
      if (!media) {
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
      if (placeTag) {
        try {
          await linkPlaceContent(String(placeTag.id), { postId });
        } catch (error) {
          Alert.alert(
            'Gönderi yayınlandı',
            `Gönderi paylaşıldı ancak işletme etiketi eklenemedi: ${toMessage(error)}`,
          );
        }
      }
      haptics.success();
      if (draftKey) {
        await AsyncStorage.removeItem(draftKey).catch(() => undefined);
      }
      setDraftSavedAt(null);
      setAssets([]);
      setBody('');
      router.replace(`/post/${postId}` as never);
    } catch (error) {
      Alert.alert('Paylaşılamadı', toMessage(error));
    } finally {
      setUploading(false);
      setProgressLabel(null);
      setUploadProgress(0);
    }
  }, [
    assets,
    body,
    city,
    createPost,
    draftKey,
    editingId,
    existingMedia,
    placeTag,
    profile,
    router,
    updatePost,
    uploadAll,
    visibility,
  ]);

  const busy = uploading || createPost.isPending || updatePost.isPending;
  const canInteract = !busy;

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
      router.back();
    } catch {
      Alert.alert('Taslak kaydedilemedi', 'Bağlantını kontrol edip yeniden dene.');
    }
  }, [draftKey, persistDraft, router]);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll keyboardAware>
      <ScreenHeader
        title={editingId ? 'Gönderiyi düzenle' : 'Yeni gönderi'}
        subtitle={editingId ? 'Metni ve görünürlüğü güncelle' : 'Topluluğunla bir şey paylaş'}
        onBack={() => router.back()}
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
          <View style={styles.mediaGrid}>
            {existingMedia.map((item) => (
              <View key={item.id} style={[styles.mediaCell, { borderRadius: theme.radius.md }]}>
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
            <View style={styles.mediaGrid}>
              {assets.map((asset, index) => (
                <View key={asset.key} style={[styles.mediaCell, { borderRadius: theme.radius.md }]}>
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
        <View style={styles.segmentRow}>
          {(
            [
              { key: 'public', label: 'Herkes', icon: 'globe-outline' },
              { key: 'followers', label: 'Takipçiler', icon: 'people-outline' },
            ] as const
          ).map((option) => {
            const active = visibility === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={option.label}
                onPress={() => setVisibility(option.key)}
                style={({ pressed }) => [
                  styles.segment,
                  {
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={option.icon}
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

      {!editingId ? (
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
  mediaCell: { width: '31.5%', aspectRatio: 1, overflow: 'hidden', backgroundColor: '#00000010' },
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
  progress: {
    gap: 8,
    padding: 12,
    borderRadius: 14,
    marginTop: 14,
  },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
