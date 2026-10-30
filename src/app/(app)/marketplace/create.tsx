import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ActionSheet,
  AppText,
  Button,
  IconButton,
  Screen,
  SelectSheet,
  TextField,
} from '@/components/ui';
import { useExploreBootstrap } from '@/features/explore/hooks/use-explore';
import { pickMedia, type PickSource } from '@/features/media/media-picker';
import { publicMediaUrl, uploadMedia } from '@/features/media/media-service';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import {
  useCreateListingV2,
  useMarketCategories,
  useMarketListing,
  useUpdateListingV2,
} from '@/features/marketplace/hooks/use-marketplace-catalog';
import {
  deleteMarketDraft,
  listMarketDrafts,
  saveMarketDraft,
} from '@/features/marketplace/services/market-drafts';
import {
  CONDITION_LABELS,
  formatMarketPrice,
  type CategoryNode,
  type ListingMediaInput,
  type ListingV2Input,
  type MarketFormField,
  type MarketListing,
} from '@/features/marketplace/services/marketplace-catalog-service';
import { useTheme } from '@/theme/ThemeProvider';
import { toMessage } from '@/utils/error-message';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

const STEPS = ['Kategori', 'Bilgiler', 'Fiyat', 'Medya', 'Konum', 'Önizleme', 'Yayınla'] as const;
const MAX_MEDIA = 12;
const MAX_VIDEOS = 3;

const KINDS = [
  { key: 'product', label: 'Ürün', icon: 'bag-handle-outline' },
  { key: 'real_estate', label: 'Emlak', icon: 'home-outline' },
  { key: 'vehicle', label: 'Araç', icon: 'car-sport-outline' },
  { key: 'service', label: 'Hizmet', icon: 'construct-outline' },
] as const;

type WizardKind = (typeof KINDS)[number]['key'];

type DraftMedia = {
  key: string;
  uri: string;
  kind: 'image' | 'video';
  path: string | null;
  thumbPath: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  mime: string | null;
  fileName: string | null;
  status: 'idle' | 'uploading' | 'done' | 'failed';
  progress: number;
};

type FormSnapshot = {
  kind: WizardKind;
  categoryId: string | null;
  rootSlug: string | null;
  title: string;
  description: string;
  condition: 'new' | 'like_new' | 'good' | 'fair';
  stock: string;
  price: string;
  pricePeriod: 'total' | 'month' | 'hour' | 'service';
  attributes: Record<string, string | boolean>;
  media: DraftMedia[];
  coverKey: string | null;
  districtId: number | null;
  neighborhoodId: number | null;
  lat: number | null;
  lng: number | null;
  hideExactLocation: boolean;
  contactPhone: string;
  callAllowed: boolean;
};

function initialSnapshot(initial: MarketListing | null): FormSnapshot {
  const attributes: Record<string, string | boolean> = {};
  if (initial) {
    Object.entries(initial.attributes ?? {}).forEach(([key, value]) => {
      if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        attributes[key] = typeof value === 'number' ? String(value) : value;
      }
    });
  }
  return {
    kind: (initial?.category_kind as WizardKind) ?? 'product',
    categoryId: initial?.category_slug ? null : null,
    rootSlug: initial?.category_path[0] ?? null,
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    condition: (initial?.condition as FormSnapshot['condition']) ?? 'good',
    stock: String(initial?.stock ?? 1),
    price: initial ? String(Math.round(initial.price_cents / 100)) : '',
    pricePeriod: (initial?.price_period as FormSnapshot['pricePeriod']) ?? 'total',
    attributes,
    media:
      initial?.media.map((item) => ({
        key: item.id,
        uri: publicMediaUrl('listing-images', item.thumb_path ?? item.storage_path) ?? '',
        kind: item.kind,
        path: item.storage_path,
        thumbPath: item.thumb_path,
        width: item.width,
        height: item.height,
        durationMs: item.duration_ms,
        mime: null,
        fileName: null,
        status: 'done' as const,
        progress: 1,
      })) ?? [],
    coverKey: initial?.media.find((item) => item.is_cover)?.id ?? initial?.media[0]?.id ?? null,
    districtId: initial?.district_id ?? null,
    neighborhoodId: initial?.neighborhood_id ?? null,
    lat: initial?.lat ?? null,
    lng: initial?.lng ?? null,
    hideExactLocation: initial?.hide_exact_location ?? true,
    contactPhone:
      typeof initial?.contact_prefs?.phone === 'string' ? String(initial.contact_prefs.phone) : '',
    callAllowed: Boolean(initial?.contact_prefs?.calls),
  };
}

function parsePriceCents(value: string): number | null {
  const cleaned = value.replace(/[^\d]/g, '');
  if (!cleaned) {
    return null;
  }
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return Math.round(amount * 100);
}

function findNode(nodes: CategoryNode[], id: string | null): CategoryNode | null {
  if (!id) {
    return null;
  }
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

function flattenDescendants(node: CategoryNode): CategoryNode[] {
  return node.children.flatMap((child) => [child, ...flattenDescendants(child)]);
}

async function makeImageThumb(uri: string): Promise<string | null> {
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: 720, height: null });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.78, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return null;
  }
}

export default function MarketListingCreatorScreen() {
  const params = useLocalSearchParams<{ id?: string; draftId?: string }>();
  const editingId = typeof params.id === 'string' && params.id ? params.id : null;
  const draftId = typeof params.draftId === 'string' && params.draftId ? params.draftId : null;
  const detail = useMarketListing(editingId);

  if (editingId && detail.isLoading) {
    return <CreatorSkeleton />;
  }

  return (
    <MarketListingWizard
      key={editingId ?? draftId ?? 'new'}
      editingId={editingId}
      draftId={draftId}
      initial={detail.data?.listing ?? null}
    />
  );
}

function CreatorSkeleton() {
  const { theme } = useTheme();
  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={[styles.skeleton, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.skeletonBar, { backgroundColor: theme.colors.surfaceMuted }]} />
        <View style={styles.skeletonBody}>
          {[0, 1, 2, 3].map((key) => (
            <View
              key={key}
              style={[styles.skeletonRow, { backgroundColor: theme.colors.surfaceMuted }]}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}

function MarketListingWizard({
  editingId,
  draftId,
  initial,
}: {
  editingId: string | null;
  draftId: string | null;
  initial: MarketListing | null;
}) {
  const router = useRouter();
  const { theme, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const tree = useMarketCategories();
  const bootstrap = useExploreBootstrap();
  const profile = useMyProfile();
  const create = useCreateListingV2();
  const update = useUpdateListingV2(editingId ?? '');
  const snapshot = useMemo(() => initialSnapshot(initial), [initial]);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormSnapshot>(snapshot);
  const [ready, setReady] = useState(!draftId);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [mediaSourceOpen, setMediaSourceOpen] = useState(false);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [neighborhoodOpen, setNeighborhoodOpen] = useState(false);
  const [attributeSheet, setAttributeSheet] = useState<MarketFormField | null>(null);
  const [localDraftId, setLocalDraftId] = useState(() => draftId ?? `draft-${Date.now()}`);

  const set = useCallback(<K extends keyof FormSnapshot>(key: K, value: FormSnapshot[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  /* ------------------------- düzenleme / taslak yükleme ------------------------- */

  useEffect(() => {
    if (!initial) {
      return;
    }
    const next = initialSnapshot(initial);
    const category = findNode(tree.data ?? [], initial.category_id ?? null);
    // Düzenleme yüklemesi kategori ağacı geldiğinde bir kez senkronlanır.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((current) => ({
      ...next,
      categoryId: category?.id ?? initial.category_id ?? null,
      rootSlug: category?.path_slugs[0] ?? next.rootSlug,
    }));
  }, [initial, tree.data]);

  useEffect(() => {
    if (!draftId) {
      return;
    }
    let alive = true;
    void listMarketDrafts().then((drafts) => {
      if (!alive) {
        return;
      }
      const draft = drafts.find((entry) => entry.id === draftId);
      if (draft) {
        const payload = draft.payload as Partial<FormSnapshot>;
        setForm((current) => ({
          ...current,
          ...payload,
          media: Array.isArray(payload.media) ? (payload.media as DraftMedia[]) : current.media,
          attributes:
            payload.attributes && typeof payload.attributes === 'object'
              ? (payload.attributes as Record<string, string | boolean>)
              : current.attributes,
        }));
        setLocalDraftId(draft.id);
      }
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [draftId]);

  const treeReady = !tree.isLoading;
  const roots = useMemo(
    () => (tree.data ?? []).filter((node) => node.kind === form.kind),
    [form.kind, tree.data],
  );
  const root = useMemo(
    () => roots.find((node) => node.slug === form.rootSlug) ?? null,
    [form.rootSlug, roots],
  );
  const selected = useMemo(
    () => findNode(tree.data ?? [], form.categoryId),
    [form.categoryId, tree.data],
  );
  const categoryOptions = useMemo(() => (root ? [root, ...flattenDescendants(root)] : []), [root]);
  const formFields = useMemo(() => {
    const own = selected?.form_schema?.fields ?? [];
    if (own.length) {
      return own;
    }
    return root?.form_schema?.fields ?? [];
  }, [root?.form_schema?.fields, selected?.form_schema?.fields]);
  const priceRequired = (root?.form_schema?.price_mode ?? 'required') === 'required';

  const district = useMemo(
    () => bootstrap.data?.districts.find((entry) => entry.id === form.districtId) ?? null,
    [bootstrap.data?.districts, form.districtId],
  );
  const neighborhood = useMemo(
    () => district?.neighborhoods.find((entry) => entry.id === form.neighborhoodId) ?? null,
    [district?.neighborhoods, form.neighborhoodId],
  );
  const mapPoint =
    form.lat != null && form.lng != null
      ? { lat: form.lat, lng: form.lng }
      : district?.lat != null && district.lng != null
        ? { lat: district.lat, lng: district.lng }
        : { lat: 41.0027, lng: 39.7168 };
  const coverMedia = useMemo(
    () => form.media.find((item) => item.key === form.coverKey) ?? form.media[0] ?? null,
    [form.coverKey, form.media],
  );

  /* ------------------------------- otomatik taslak ------------------------------- */

  useEffect(() => {
    if (!ready || editingId) {
      return;
    }
    const timer = setTimeout(() => {
      void saveMarketDraft({
        id: localDraftId,
        title: form.title.trim() || 'Başlıksız taslak',
        category_name: selected?.name ?? 'Kategori seçilmedi',
        kind: form.kind,
        cover_uri: coverMedia?.uri ?? null,
        updated_at: new Date().toISOString(),
        payload: form as unknown as Record<string, unknown>,
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [coverMedia?.uri, editingId, form, localDraftId, ready, selected?.name]);

  const saveDraftNow = async () => {
    if (editingId) {
      Alert.alert(
        'Taslak',
        'Yayındaki bir ilan yerel taslak olarak kaydedilmez. Değişiklikleri kaydetmek için “Güncelle”yi kullan.',
      );
      return;
    }
    await saveMarketDraft({
      id: localDraftId,
      title: form.title.trim() || 'Başlıksız taslak',
      category_name: selected?.name ?? 'Kategori seçilmedi',
      kind: form.kind,
      cover_uri: coverMedia?.uri ?? null,
      updated_at: new Date().toISOString(),
      payload: form as unknown as Record<string, unknown>,
    });
    haptics.success();
    Alert.alert('Taslak kaydedildi', 'İlanlarım > Taslak bölümünden devam edebilirsin.', [
      { text: 'Tamam', onPress: () => router.back() },
    ]);
  };

  /* --------------------------------- kategori --------------------------------- */

  const selectKind = (kind: WizardKind) => {
    haptics.selection();
    setForm((current) => ({
      ...current,
      kind,
      categoryId: null,
      rootSlug: null,
      attributes: {},
      pricePeriod: kind === 'real_estate' ? 'month' : kind === 'service' ? 'service' : 'total',
    }));
    setError(null);
  };

  const selectRoot = (node: CategoryNode) => {
    haptics.selection();
    setForm((current) => ({
      ...current,
      rootSlug: node.slug,
      categoryId: node.id,
      attributes: categoryDefaults(node, current.attributes),
      pricePeriod: inferPricePeriod(node, current.kind),
    }));
    setError(null);
  };

  const selectCategory = (node: CategoryNode) => {
    haptics.selection();
    setForm((current) => ({
      ...current,
      categoryId: node.id,
      rootSlug: node.path_slugs[0] ?? node.slug,
      attributes: categoryDefaults(node, current.attributes),
      pricePeriod: inferPricePeriod(node, current.kind),
    }));
    setError(null);
  };

  /* ---------------------------------- medya ---------------------------------- */

  const addMedia = async (source: PickSource) => {
    setMediaSourceOpen(false);
    const remaining = MAX_MEDIA - form.media.length;
    if (remaining <= 0) {
      Alert.alert('Medya sınırı', `En fazla ${MAX_MEDIA} fotoğraf/video ekleyebilirsin.`);
      return;
    }
    try {
      const picked = await pickMedia({
        source,
        kind: 'all',
        multiple: source === 'library',
        limit: remaining,
        maxVideoDuration: 180,
      });
      if (!picked?.length) {
        return;
      }
      const videoCount = form.media.filter((item) => item.kind === 'video').length;
      const allowed = picked.filter((asset, index) => {
        if (asset.mediaType === 'video') {
          return videoCount + index < MAX_VIDEOS;
        }
        return true;
      });
      const next: DraftMedia[] = allowed.slice(0, remaining).map((asset, index) => ({
        key: `local-${Date.now()}-${index}`,
        uri: asset.uri,
        kind: asset.mediaType === 'video' ? 'video' : 'image',
        path: null,
        thumbPath: null,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        mime: asset.mimeType,
        fileName: asset.fileName,
        status: 'idle',
        progress: 0,
      }));
      if (allowed.length < picked.length) {
        Alert.alert(
          'Bazı dosyalar eklenmedi',
          `En fazla ${MAX_VIDEOS} video ve ${MAX_MEDIA} medya eklenebilir.`,
        );
      }
      setForm((current) => ({
        ...current,
        media: [...current.media, ...next],
        coverKey: current.coverKey ?? next[0]?.key ?? null,
      }));
    } catch (pickError) {
      Alert.alert('Medya eklenemedi', toMessage(pickError));
    }
  };

  const removeMedia = (key: string) => {
    haptics.selection();
    setForm((current) => {
      const media = current.media.filter((item) => item.key !== key);
      return {
        ...current,
        media,
        coverKey: current.coverKey === key ? (media[0]?.key ?? null) : current.coverKey,
      };
    });
  };

  const moveMedia = (key: string, direction: -1 | 1) => {
    haptics.selection();
    setForm((current) => {
      const media = [...current.media];
      const index = media.findIndex((item) => item.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= media.length) {
        return current;
      }
      const moving = media[index];
      const displaced = media[target];
      if (!moving || !displaced) {
        return current;
      }
      media[index] = displaced;
      media[target] = moving;
      return { ...current, media };
    });
  };

  /* --------------------------------- doğrulama --------------------------------- */

  const validateStep = (index: number): string | null => {
    if (index === 0 && !form.categoryId) {
      return 'Devam etmek için bir kategori seç.';
    }
    if (index === 1) {
      if (form.title.trim().length < 5) {
        return 'Başlık en az 5 karakter olmalı.';
      }
      if (form.title.trim().length > 140) {
        return 'Başlık en fazla 140 karakter olabilir.';
      }
    }
    if (index === 2) {
      if (priceRequired && !parsePriceCents(form.price)) {
        return 'Geçerli bir fiyat gir.';
      }
      if (form.price && !parsePriceCents(form.price)) {
        return 'Fiyat yalnızca rakamlardan oluşmalı.';
      }
      for (const field of formFields) {
        if (field.required) {
          const value = form.attributes[field.key];
          if (value == null || value === '' || value === false) {
            return `${field.label} alanı zorunlu.`;
          }
        }
      }
    }
    if (index === 3 && form.media.length === 0) {
      return 'En az bir fotoğraf ekle.';
    }
    if (index === 4) {
      if (!form.districtId) {
        return 'İlçe seçmelisin. Trabzon dışına ilan verilemez.';
      }
      if (form.callAllowed && !form.contactPhone.trim()) {
        return 'Arama izni için telefon numarası gir.';
      }
      if (form.contactPhone && form.contactPhone.replace(/[^\d]/g, '').length < 10) {
        return 'Telefon numarası en az 10 haneli olmalı.';
      }
    }
    return null;
  };

  const next = () => {
    const message = validateStep(step);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const back = () => {
    if (step === 0) {
      router.back();
      return;
    }
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
  };

  /* --------------------------------- yayınlama --------------------------------- */

  const uploadAll = async (userId: string): Promise<ListingMediaInput[]> => {
    const ordered = [...form.media];
    const coverIndex = ordered.findIndex((item) => item.key === form.coverKey);
    if (coverIndex > 0) {
      const [cover] = ordered.splice(coverIndex, 1);
      if (cover) {
        ordered.unshift(cover);
      }
    }
    const payloads: ListingMediaInput[] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      if (!item) {
        continue;
      }
      if (item.path) {
        payloads.push({
          storage_path: item.path,
          thumb_path: item.thumbPath,
          kind: item.kind,
          width: item.width,
          height: item.height,
          duration_ms: item.durationMs,
          is_cover: index === 0,
          processing_status: 'ready',
        });
        continue;
      }
      setStage(`Medya yükleniyor (${index + 1}/${ordered.length})`);
      const patchMedia = (patch: Partial<DraftMedia>) => {
        setForm((current) => ({
          ...current,
          media: current.media.map((entry) =>
            entry.key === item.key ? { ...entry, ...patch } : entry,
          ),
        }));
      };
      patchMedia({ status: 'uploading', progress: 0.05 });
      const uploaded = await uploadMedia({
        bucket: 'listing-images',
        folder: userId,
        uri: item.uri,
        mime: item.mime,
        fileName: item.fileName,
        width: item.width,
        height: item.height,
        durationMs: item.durationMs,
        compressImages: true,
        compressVideos: true,
        onProgress: (uploadStage, ratio) =>
          patchMedia({
            status: uploadStage === 'uploading' ? 'uploading' : 'idle',
            progress: ratio,
          }),
      });
      if (!uploaded.ok) {
        patchMedia({ status: 'failed', progress: 0 });
        throw new Error(uploaded.error.message);
      }
      let thumbPath = uploaded.data.thumbnailPath ?? null;
      if (item.kind === 'image') {
        const thumbUri = await makeImageThumb(item.uri);
        if (thumbUri) {
          const thumbUpload = await uploadMedia({
            bucket: 'listing-images',
            folder: userId,
            uri: thumbUri,
            compressImages: true,
          });
          if (thumbUpload.ok) {
            thumbPath = thumbUpload.data.path;
          }
        }
      }
      patchMedia({
        path: uploaded.data.path,
        thumbPath,
        width: uploaded.data.width,
        height: uploaded.data.height,
        status: 'done',
        progress: 1,
      });
      payloads.push({
        storage_path: uploaded.data.path,
        thumb_path: thumbPath,
        kind: item.kind,
        width: uploaded.data.width,
        height: uploaded.data.height,
        duration_ms: uploaded.data.durationMs,
        is_cover: index === 0,
        processing_status: 'ready',
      });
    }
    return payloads;
  };

  const publish = async () => {
    if (!accepted) {
      setError('Yayınlamak için ilan kurallarını onaylamalısın.');
      return;
    }
    for (let index = 0; index <= 4; index += 1) {
      const message = validateStep(index);
      if (message) {
        setStep(index);
        setError(message);
        return;
      }
    }
    if (!form.categoryId) {
      setError('Kategori seçmelisin.');
      setStep(0);
      return;
    }
    if (!profile.data?.id) {
      setError('Oturum bilgisi bulunamadı. Tekrar giriş yap.');
      return;
    }

    setPublishing(true);
    setError(null);
    try {
      const media = await uploadAll(profile.data.id);
      const attributes: Record<string, unknown> = {};
      formFields.forEach((field) => {
        const value = form.attributes[field.key];
        if (value == null || value === '') {
          return;
        }
        attributes[field.key] =
          field.type === 'number' && typeof value === 'string' ? Number(value) : value;
      });
      if (form.kind === 'real_estate') {
        attributes.listing_kind =
          form.attributes.listing_kind ?? (form.pricePeriod === 'month' ? 'rent' : 'sale');
      }
      const payload: ListingV2Input = {
        ...(editingId ? { id: editingId } : {}),
        title: form.title.trim(),
        description: form.description.trim() || null,
        category_id: form.categoryId,
        price_cents: parsePriceCents(form.price) ?? 0,
        currency: 'TRY',
        price_period: form.pricePeriod,
        condition: form.condition,
        stock: Math.max(0, Number(form.stock) || 1),
        attributes,
        hide_exact_location: form.hideExactLocation,
        contact_prefs: {
          chat: true,
          phone: form.contactPhone.trim() || null,
          calls: form.callAllowed && Boolean(form.contactPhone.trim()),
        },
        location: {
          district_id: form.districtId,
          neighborhood_id: form.neighborhoodId,
          lat: form.lat,
          lng: form.lng,
        },
        media,
      };
      setStage(editingId ? 'İlan güncelleniyor' : 'İlan oluşturuluyor');
      const result = editingId
        ? await update.mutateAsync(payload)
        : await create.mutateAsync(payload);
      if (!editingId) {
        await deleteMarketDraft(localDraftId);
      }
      haptics.success();
      setStage(null);
      setPublishing(false);
      Alert.alert(
        editingId ? 'İlan güncellendi' : 'İlan yayınlandı',
        'İlanın Trabzone Marketplace’te yayında. Onay beklemez; yayındaki ilanını dilediğin an düzenleyebilirsin.',
        [
          {
            text: 'İlanı gör',
            onPress: () => router.replace(`/marketplace/${result.id}` as never),
          },
        ],
      );
    } catch (publishError) {
      setStage(null);
      setPublishing(false);
      setError(toMessage(publishError));
    }
  };

  /* ---------------------------------- render ---------------------------------- */

  const canPublish = ready && treeReady;

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <IconButton
            name="chevron-back"
            accessibilityLabel="Geri"
            variant="surface"
            size={20}
            onPress={back}
          />
          <View style={styles.flex}>
            <AppText variant="h3" numberOfLines={1}>
              {editingId ? 'İlanı düzenle' : 'Yeni ilan'}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              Adım {step + 1} / {STEPS.length} · {STEPS[step]}
            </AppText>
          </View>
          {!editingId ? (
            <IconButton
              name="bookmark-outline"
              accessibilityLabel="Taslak kaydet"
              variant="surface"
              size={18}
              onPress={() => void saveDraftNow()}
            />
          ) : null}
        </View>

        <View style={styles.progress}>
          {STEPS.map((label, index) => (
            <View
              key={label}
              style={[
                styles.progressSegment,
                {
                  backgroundColor: index <= step ? theme.colors.primary : theme.colors.surfaceMuted,
                },
              ]}
            />
          ))}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {error ? (
            <View
              style={[
                styles.errorCard,
                { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}

          {step === 0 ? (
            <CategoryStep
              kind={form.kind}
              roots={roots}
              root={root}
              options={categoryOptions}
              selectedId={form.categoryId}
              onKind={selectKind}
              onRoot={selectRoot}
              onSelect={selectCategory}
              loading={!treeReady}
            />
          ) : null}

          {step === 1 ? <BasicsStep form={form} set={set} /> : null}

          {step === 2 ? (
            <PriceStep
              form={form}
              set={set}
              fields={formFields}
              priceRequired={priceRequired}
              onOpenAttribute={setAttributeSheet}
            />
          ) : null}

          {step === 3 ? (
            <MediaStep
              media={form.media}
              coverKey={form.coverKey}
              onAdd={() => setMediaSourceOpen(true)}
              onRemove={removeMedia}
              onCover={(key) => set('coverKey', key)}
              onMove={moveMedia}
            />
          ) : null}

          {step === 4 ? (
            <LocationStep
              form={form}
              set={set}
              districtName={district?.name ?? null}
              neighborhoodName={neighborhood?.name ?? null}
              onDistrict={() => setDistrictOpen(true)}
              onNeighborhood={() => setNeighborhoodOpen(true)}
              mapPoint={mapPoint}
              dark={scheme === 'dark'}
              onMapPress={(point) => {
                set('lat', point.lat);
                set('lng', point.lng);
              }}
            />
          ) : null}

          {step === 5 ? (
            <PreviewStep
              form={form}
              categoryName={selected?.name ?? root?.name ?? 'Kategori'}
              categoryPath={selected?.path_names.join(' › ') ?? root?.name ?? ''}
              fields={formFields}
              coverMedia={coverMedia}
              districtName={district?.name ?? null}
              neighborhoodName={neighborhood?.name ?? null}
            />
          ) : null}

          {step === 6 ? (
            <PublishStep
              form={form}
              editing={Boolean(editingId)}
              accepted={accepted}
              onAccepted={setAccepted}
              categoryName={selected?.name ?? root?.name ?? 'Kategori'}
              districtName={district?.name ?? null}
              publishing={publishing}
              stage={stage}
            />
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              paddingBottom: insets.bottom + 10,
            },
          ]}
        >
          {step > 0 ? (
            <Button
              label="Geri"
              variant="outline"
              size="md"
              fullWidth={false}
              style={styles.backButton}
              onPress={back}
            />
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button
              label="Devam"
              size="md"
              style={styles.flex}
              disabled={!canPublish}
              rightIcon={<Ionicons name="arrow-forward" size={16} color={theme.colors.onPrimary} />}
              onPress={next}
            />
          ) : (
            <Button
              label={editingId ? 'Güncelle' : 'Yayınla'}
              size="md"
              style={styles.flex}
              loading={publishing}
              disabled={!accepted || publishing}
              onPress={() => void publish()}
            />
          )}
        </View>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={mediaSourceOpen}
        title="Medya ekle"
        message={`${form.media.length}/${MAX_MEDIA} medya · en fazla ${MAX_VIDEOS} video`}
        items={[
          { key: 'library', label: 'Galeriden seç', icon: 'images-outline' },
          { key: 'camera', label: 'Kamerayla çek', icon: 'camera-outline' },
        ]}
        onClose={() => setMediaSourceOpen(false)}
        onSelect={(key) => void addMedia(key as PickSource)}
      />

      <SelectSheet
        visible={districtOpen}
        title="İlçe seç"
        options={(bootstrap.data?.districts ?? []).map((entry) => entry.name)}
        value={district?.name ?? null}
        onClose={() => setDistrictOpen(false)}
        onSelect={(name) => {
          const found = bootstrap.data?.districts.find((entry) => entry.name === name) ?? null;
          setDistrictOpen(false);
          setForm((current) => ({
            ...current,
            districtId: found?.id ?? null,
            neighborhoodId: null,
            lat: found?.lat ?? current.lat,
            lng: found?.lng ?? current.lng,
          }));
        }}
      />

      <SelectSheet
        visible={neighborhoodOpen}
        title="Mahalle seç"
        options={(district?.neighborhoods ?? []).map((entry) => entry.name)}
        value={neighborhood?.name ?? null}
        emptyLabel="Bu ilçe için mahalle kaydı yok."
        onClose={() => setNeighborhoodOpen(false)}
        onSelect={(name) => {
          const found = district?.neighborhoods.find((entry) => entry.name === name) ?? null;
          setNeighborhoodOpen(false);
          set('neighborhoodId', found?.id ?? null);
        }}
      />

      <SelectSheet
        visible={Boolean(attributeSheet)}
        title={attributeSheet?.label ?? 'Seçim'}
        options={attributeSheet?.options ?? []}
        value={attributeSheet ? String(form.attributes[attributeSheet.key] ?? '') : null}
        onClose={() => setAttributeSheet(null)}
        onSelect={(value) => {
          if (attributeSheet) {
            set('attributes', { ...form.attributes, [attributeSheet.key]: value });
          }
          setAttributeSheet(null);
        }}
      />
    </Screen>
  );
}

/* ---------------------------------- adımlar ---------------------------------- */

function CategoryStep({
  kind,
  roots,
  root,
  options,
  selectedId,
  onKind,
  onRoot,
  onSelect,
  loading,
}: {
  kind: WizardKind;
  roots: CategoryNode[];
  root: CategoryNode | null;
  options: CategoryNode[];
  selectedId: string | null;
  onKind: (kind: WizardKind) => void;
  onRoot: (node: CategoryNode) => void;
  onSelect: (node: CategoryNode) => void;
  loading: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.step}>
      <SectionTitle title="Ne satıyorsun?" body="Kategori, ilan formunun alanlarını belirler." />
      <View style={styles.kindGrid}>
        {KINDS.map((entry) => {
          const active = kind === entry.key;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onKind(entry.key)}
              style={[
                styles.kindCard,
                {
                  backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                  borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                },
              ]}
            >
              <Ionicons
                name={entry.icon}
                size={20}
                color={active ? theme.colors.onPrimary : theme.colors.primaryDeep}
              />
              <AppText variant="label" color={active ? 'onPrimary' : 'text'}>
                {entry.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <SectionTitle
        title="Ana kategori"
        body="Önce ana başlığı seç, sonra alt kategoriyi netleştir."
      />
      {loading ? (
        <View style={styles.loadingList}>
          {[0, 1, 2].map((key) => (
            <View
              key={key}
              style={[styles.loadingRow, { backgroundColor: theme.colors.surfaceMuted }]}
            />
          ))}
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalChips}
        >
          {roots.map((node) => {
            const active = root?.id === node.id;
            return (
              <Pressable
                key={node.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onRoot(node)}
                style={[
                  styles.rootChip,
                  {
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={(node.icon as never) ?? 'pricetag-outline'}
                  size={15}
                  color={active ? theme.colors.primaryDeep : theme.colors.textSecondary}
                />
                <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                  {node.name}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {root ? (
        <View
          style={[
            styles.categoryList,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          {options.map((node) => {
            const depth = Math.max(node.path_slugs.length - root.path_slugs.length || 0, 0);
            const active = selectedId === node.id;
            return (
              <Pressable
                key={node.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(node)}
                style={[
                  styles.categoryRow,
                  {
                    paddingLeft: 12 + depth * 14,
                    backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                  },
                ]}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={17}
                  color={active ? theme.colors.primaryDeep : theme.colors.textTertiary}
                />
                <View style={styles.flex}>
                  <AppText variant="body" color={active ? 'primaryDeep' : 'text'} numberOfLines={1}>
                    {node.name}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {node.path_names.join(' › ')} · {node.listing_count} ilan
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View
          style={[
            styles.hintCard,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="git-branch-outline" size={17} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Yukarıdan bir ana kategori seçtiğinde tüm alt kategoriler ve “Diğer” seçeneği burada
            listelenir.
          </AppText>
        </View>
      )}
    </View>
  );
}

function BasicsStep({
  form,
  set,
}: {
  form: FormSnapshot;
  set: <K extends keyof FormSnapshot>(key: K, value: FormSnapshot[K]) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.step}>
      <SectionTitle
        title="İlanın temel bilgileri"
        body="Açık ve dürüst bir başlık, doğru alıcıyı getirir."
      />
      <TextField
        label="İlan başlığı"
        value={form.title}
        onChangeText={(value) => set('title', value)}
        placeholder="Örn. iPhone 16 Pro Max 256 GB"
        maxLength={140}
        hint={`${form.title.length}/140`}
      />
      <TextField
        label="Açıklama"
        value={form.description}
        onChangeText={(value) => set('description', value)}
        placeholder="Ürünün durumu, kullanım süresi, teslim bilgisi…"
        multiline
        maxLength={8000}
        numberOfLines={6}
        containerStyle={styles.descriptionInput}
      />

      {form.kind === 'product' || form.kind === 'vehicle' ? (
        <View style={styles.fieldGroup}>
          <AppText variant="label" color="textSecondary">
            Ürün durumu
          </AppText>
          <View style={styles.chipWrap}>
            {(['new', 'like_new', 'good', 'fair'] as const).map((condition) => {
              const active = form.condition === condition;
              return (
                <Pressable
                  key={condition}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => set('condition', condition)}
                  style={[
                    styles.choiceChip,
                    {
                      backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                      borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                    {CONDITION_LABELS[condition]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {form.kind === 'product' ? (
        <View style={styles.fieldGroup}>
          <AppText variant="label" color="textSecondary">
            Stok adedi
          </AppText>
          <View style={styles.stepper}>
            <IconButton
              name="remove"
              accessibilityLabel="Stok azalt"
              variant="surface"
              size={18}
              onPress={() => set('stock', String(Math.max(0, Number(form.stock || 1) - 1)))}
            />
            <TextField
              value={form.stock}
              onChangeText={(value) => set('stock', value.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              containerStyle={styles.stockInput}
            />
            <IconButton
              name="add"
              accessibilityLabel="Stok artır"
              variant="surface"
              size={18}
              onPress={() => set('stock', String(Math.min(999, Number(form.stock || 0) + 1)))}
            />
          </View>
        </View>
      ) : null}

      {form.kind === 'real_estate' || form.kind === 'vehicle' ? (
        <View
          style={[
            styles.verifyCard,
            { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.success },
          ]}
        >
          <Ionicons name="flash-outline" size={18} color={theme.colors.success} />
          <View style={styles.flex}>
            <AppText variant="label">Anında yayın</AppText>
            <AppText variant="caption" color="textSecondary">
              Emlak ve araç ilanların da onay beklemeden yayınlanır. Doğrulama belgesi eklersen
              ilanın yayında kalır, inceleme sonucu ayrıca bildirilir.
            </AppText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PriceStep({
  form,
  set,
  fields,
  priceRequired,
  onOpenAttribute,
}: {
  form: FormSnapshot;
  set: <K extends keyof FormSnapshot>(key: K, value: FormSnapshot[K]) => void;
  fields: MarketFormField[];
  priceRequired: boolean;
  onOpenAttribute: (field: MarketFormField) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.step}>
      <SectionTitle
        title="Fiyat ve özellikler"
        body={
          priceRequired
            ? 'Bu kategoride fiyat zorunlu.'
            : 'Fiyat vermek istemiyorsan boş bırakabilirsin.'
        }
      />
      <TextField
        label={priceRequired ? 'Fiyat (TL)' : 'Fiyat (TL, isteğe bağlı)'}
        value={form.price}
        onChangeText={(value) => set('price', value.replace(/[^0-9]/g, ''))}
        placeholder="0"
        keyboardType="number-pad"
        leftIcon="cash-outline"
      />

      {form.kind === 'real_estate' ? (
        <View style={styles.fieldGroup}>
          <AppText variant="label" color="textSecondary">
            İlan türü
          </AppText>
          <View style={styles.chipWrap}>
            {[
              { key: 'rent', label: 'Kiralık', period: 'month' as const },
              { key: 'sale', label: 'Satılık', period: 'total' as const },
              { key: 'transfer', label: 'Devren', period: 'total' as const },
            ].map((option) => {
              const active = form.attributes.listing_kind === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() =>
                    setFormPatch(set, {
                      pricePeriod: option.period,
                      attributes: { ...form.attributes, listing_kind: option.key },
                    })
                  }
                  style={[
                    styles.choiceChip,
                    {
                      backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                      borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {form.kind === 'real_estate' || form.kind === 'service' ? (
        <View style={styles.fieldGroup}>
          <AppText variant="label" color="textSecondary">
            Fiyat dönemi
          </AppText>
          <View style={styles.chipWrap}>
            {(
              [
                { key: 'total', label: 'Toplam' },
                { key: 'month', label: 'Aylık' },
                { key: 'hour', label: 'Saatlik' },
                { key: 'service', label: 'Hizmet başı' },
              ] as const
            ).map((option) => {
              const active = form.pricePeriod === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => set('pricePeriod', option.key)}
                  style={[
                    styles.choiceChip,
                    {
                      backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                      borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {fields.length ? (
        <View style={styles.fieldGroup}>
          <SectionTitle
            title="Kategoriye özel alanlar"
            body="Bu alanlar seçtiğin kategoriye göre otomatik değişir."
          />
          {fields.map((field) => {
            const value = form.attributes[field.key];
            if (field.type === 'boolean') {
              const active = value === true;
              return (
                <Pressable
                  key={field.key}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: active }}
                  onPress={() => set('attributes', { ...form.attributes, [field.key]: !active })}
                  style={[
                    styles.switchRow,
                    { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                  ]}
                >
                  <View style={styles.flex}>
                    <AppText variant="body">{field.label}</AppText>
                    {field.required ? (
                      <AppText variant="caption" color="textTertiary">
                        Zorunlu
                      </AppText>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.switch,
                      {
                        backgroundColor: active ? theme.colors.primary : theme.colors.borderStrong,
                      },
                    ]}
                  >
                    <View
                      style={[styles.knob, { alignSelf: active ? 'flex-end' : 'flex-start' }]}
                    />
                  </View>
                </Pressable>
              );
            }
            if (field.type === 'select') {
              return (
                <Pressable
                  key={field.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${field.label} seç`}
                  onPress={() => onOpenAttribute(field)}
                  style={[
                    styles.selectRow,
                    { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
                  ]}
                >
                  <View style={styles.flex}>
                    <AppText variant="caption" color="textTertiary">
                      {field.label}
                      {field.required ? ' *' : ''}
                    </AppText>
                    <AppText variant="body" color={value ? 'text' : 'textTertiary'}>
                      {value ? String(value) : 'Seç'}
                    </AppText>
                  </View>
                  <Ionicons name="chevron-down" size={15} color={theme.colors.textTertiary} />
                </Pressable>
              );
            }
            return (
              <TextField
                key={field.key}
                label={`${field.label}${field.required ? ' *' : ''}`}
                value={typeof value === 'string' ? value : ''}
                onChangeText={(nextValue) =>
                  set('attributes', {
                    ...form.attributes,
                    [field.key]:
                      field.type === 'number' ? nextValue.replace(/[^0-9.,]/g, '') : nextValue,
                  })
                }
                keyboardType={field.type === 'number' ? 'number-pad' : 'default'}
                placeholder={field.placeholder}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function setFormPatch(
  set: <K extends keyof FormSnapshot>(key: K, value: FormSnapshot[K]) => void,
  patch: Partial<FormSnapshot>,
) {
  (Object.keys(patch) as (keyof FormSnapshot)[]).forEach((key) => {
    set(key, patch[key] as FormSnapshot[typeof key]);
  });
}

function MediaStep({
  media,
  coverKey,
  onAdd,
  onRemove,
  onCover,
  onMove,
}: {
  media: DraftMedia[];
  coverKey: string | null;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onCover: (key: string) => void;
  onMove: (key: string, direction: -1 | 1) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.step}>
      <SectionTitle
        title="Fotoğraf ve video"
        body={`İlk ${MAX_MEDIA} medya eklenebilir. İlk sıradaki fotoğraf kapak olur; istediğini kapak seçebilirsin.`}
      />
      <View style={styles.mediaGrid}>
        {media.map((item, index) => (
          <View key={item.key} style={[styles.mediaCell, { borderColor: theme.colors.border }]}>
            <Image source={{ uri: item.uri }} style={styles.mediaImage} contentFit="cover" />
            <View style={styles.mediaOrder}>
              <AppText variant="caption" color="#FFFFFF">
                {index + 1}
              </AppText>
            </View>
            {item.kind === 'video' ? (
              <View style={styles.videoMark}>
                <Ionicons name="play" size={10} color="#FFFFFF" />
                <AppText variant="caption" color="#FFFFFF">
                  Video
                </AppText>
              </View>
            ) : null}
            {coverKey === item.key ? (
              <View style={styles.coverMark}>
                <Ionicons name="star" size={10} color="#FFFFFF" />
                <AppText variant="caption" color="#FFFFFF">
                  Kapak
                </AppText>
              </View>
            ) : null}
            <View style={styles.mediaTools}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kapak yap"
                hitSlop={6}
                onPress={() => onCover(item.key)}
                style={styles.mediaTool}
              >
                <Ionicons name="star-outline" size={12} color="#FFFFFF" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sola taşı"
                disabled={index === 0}
                hitSlop={6}
                onPress={() => onMove(item.key, -1)}
                style={[styles.mediaTool, index === 0 ? styles.disabled : null]}
              >
                <Ionicons name="chevron-back" size={12} color="#FFFFFF" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sağa taşı"
                disabled={index === media.length - 1}
                hitSlop={6}
                onPress={() => onMove(item.key, 1)}
                style={[styles.mediaTool, index === media.length - 1 ? styles.disabled : null]}
              >
                <Ionicons name="chevron-forward" size={12} color="#FFFFFF" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Medyayı kaldır"
                hitSlop={6}
                onPress={() => onRemove(item.key)}
                style={styles.mediaTool}
              >
                <Ionicons name="close" size={12} color="#FFFFFF" />
              </Pressable>
            </View>
            {item.status === 'failed' ? (
              <View style={styles.failedMark}>
                <Ionicons name="alert-circle" size={13} color="#FFFFFF" />
              </View>
            ) : null}
          </View>
        ))}

        {media.length < MAX_MEDIA ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Medya ekle"
            onPress={onAdd}
            style={[
              styles.addCell,
              { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
            ]}
          >
            <Ionicons name="add" size={24} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="textTertiary">
              Ekle
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <View
        style={[
          styles.hintCard,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <Ionicons name="information-circle-outline" size={16} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          Fotoğraflar yüksek çözünürlükte saklanır; kartlarda hızlı küçük sürümler kullanılır.
        </AppText>
      </View>
    </View>
  );
}

function LocationStep({
  form,
  set,
  districtName,
  neighborhoodName,
  onDistrict,
  onNeighborhood,
  mapPoint,
  dark,
  onMapPress,
}: {
  form: FormSnapshot;
  set: <K extends keyof FormSnapshot>(key: K, value: FormSnapshot[K]) => void;
  districtName: string | null;
  neighborhoodName: string | null;
  onDistrict: () => void;
  onNeighborhood: () => void;
  mapPoint: { lat: number; lng: number };
  dark: boolean;
  onMapPress: (point: { lat: number; lng: number }) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.step}>
      <SectionTitle title="Konum" body="İlk hizmet bölgesi Trabzon. İlçe ve mahalle zorunlu." />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="İlçe seç"
        onPress={onDistrict}
        style={[
          styles.selectRow,
          { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        ]}
      >
        <View style={styles.flex}>
          <AppText variant="caption" color="textTertiary">
            İlçe *
          </AppText>
          <AppText variant="body" color={districtName ? 'text' : 'textTertiary'}>
            {districtName ?? 'İlçe seç'}
          </AppText>
        </View>
        <Ionicons name="chevron-down" size={15} color={theme.colors.textTertiary} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mahalle seç"
        onPress={onNeighborhood}
        style={[
          styles.selectRow,
          { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        ]}
      >
        <View style={styles.flex}>
          <AppText variant="caption" color="textTertiary">
            Mahalle
          </AppText>
          <AppText variant="body" color={neighborhoodName ? 'text' : 'textTertiary'}>
            {neighborhoodName ?? (form.districtId ? 'Mahalle seç' : 'Önce ilçe seç')}
          </AppText>
        </View>
        <Ionicons name="chevron-down" size={15} color={theme.colors.textTertiary} />
      </Pressable>

      <View style={[styles.mapWrap, { borderColor: theme.colors.border }]}>
        <MapCanvas
          initialCamera={{ ...mapPoint, zoom: 13 }}
          markers={[
            {
              id: 'picked',
              kind:
                form.kind === 'real_estate'
                  ? 'real_estate'
                  : form.kind === 'vehicle'
                    ? 'ride_offer'
                    : 'place',
              lat: mapPoint.lat,
              lng: mapPoint.lng,
              title: 'İlan konumu',
              precise: !form.hideExactLocation,
            },
          ]}
          dark={dark}
          onMarkerPress={() => undefined}
          onCameraChange={() => undefined}
          onMapPress={onMapPress}
        />
      </View>
      <View style={styles.coordinateRow}>
        <AppText variant="caption" color="textTertiary">
          {form.lat != null && form.lng != null
            ? `${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}`
            : 'Haritaya dokunarak yaklaşık konum seçebilirsin.'}
        </AppText>
        {form.lat != null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Seçilen konumu sıfırla"
            onPress={() => {
              set('lat', null);
              set('lng', null);
            }}
          >
            <AppText variant="caption" color="primaryDeep">
              Sıfırla
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: form.hideExactLocation }}
        onPress={() => set('hideExactLocation', !form.hideExactLocation)}
        style={[
          styles.switchRow,
          { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        ]}
      >
        <View style={styles.flex}>
          <AppText variant="body">Tam adresi gizle</AppText>
          <AppText variant="caption" color="textTertiary">
            Konutlarda önerilir; haritada yaklaşık bölge gösterilir.
          </AppText>
        </View>
        <View
          style={[
            styles.switch,
            {
              backgroundColor: form.hideExactLocation
                ? theme.colors.primary
                : theme.colors.borderStrong,
            },
          ]}
        >
          <View
            style={[styles.knob, { alignSelf: form.hideExactLocation ? 'flex-end' : 'flex-start' }]}
          />
        </View>
      </Pressable>

      <SectionTitle title="İletişim tercihleri" body="Telefon yalnızca izin verirsen gösterilir." />
      <TextField
        label="Telefon (isteğe bağlı)"
        value={form.contactPhone}
        onChangeText={(value) => set('contactPhone', value.replace(/[^0-9+ ]/g, ''))}
        keyboardType="phone-pad"
        placeholder="05xx xxx xx xx"
        leftIcon="call-outline"
      />
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: form.callAllowed }}
        onPress={() => set('callAllowed', !form.callAllowed)}
        style={[
          styles.switchRow,
          { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        ]}
      >
        <View style={styles.flex}>
          <AppText variant="body">Arama izni</AppText>
          <AppText variant="caption" color="textTertiary">
            Alıcılar “Ara” butonuyla sana ulaşabilir.
          </AppText>
        </View>
        <View
          style={[
            styles.switch,
            {
              backgroundColor: form.callAllowed ? theme.colors.primary : theme.colors.borderStrong,
            },
          ]}
        >
          <View
            style={[styles.knob, { alignSelf: form.callAllowed ? 'flex-end' : 'flex-start' }]}
          />
        </View>
      </Pressable>
    </View>
  );
}

function PreviewStep({
  form,
  categoryName,
  categoryPath,
  fields,
  coverMedia,
  districtName,
  neighborhoodName,
}: {
  form: FormSnapshot;
  categoryName: string;
  categoryPath: string;
  fields: MarketFormField[];
  coverMedia: DraftMedia | null;
  districtName: string | null;
  neighborhoodName: string | null;
}) {
  const { theme } = useTheme();
  const attributeEntries = fields
    .map((field) => ({
      label: field.label,
      value: formatAttribute(field, form.attributes[field.key]),
    }))
    .filter((entry) => entry.value);
  return (
    <View style={styles.step}>
      <SectionTitle
        title="İlan önizlemesi"
        body="Yayınlamadan önce ilanın nasıl görüneceğini kontrol et."
      />
      <View
        style={[
          styles.previewCard,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <View style={[styles.previewCover, { backgroundColor: theme.colors.surfaceMuted }]}>
          {coverMedia ? (
            <Image
              source={{ uri: coverMedia.uri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <Ionicons name="image-outline" size={32} color={theme.colors.textTertiary} />
          )}
          {form.media.length > 1 ? (
            <View style={styles.previewCount}>
              <Ionicons name="images" size={11} color="#FFFFFF" />
              <AppText variant="caption" color="#FFFFFF">
                {form.media.length}
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.previewBody}>
          <AppText variant="caption" color="primaryDeep" numberOfLines={1}>
            {categoryPath || categoryName}
          </AppText>
          <AppText variant="title" numberOfLines={2}>
            {form.title.trim() || 'İlan başlığı'}
          </AppText>
          <AppText variant="h2" color="primaryDeep">
            {formatMarketPrice(parsePriceCents(form.price) ?? 0, 'TRY', form.pricePeriod)}
          </AppText>
          <View style={styles.previewLocation}>
            <Ionicons name="location-outline" size={12} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary">
              {[neighborhoodName, districtName, 'Trabzon'].filter(Boolean).join(', ') ||
                'Konum seçilmedi'}
            </AppText>
          </View>
        </View>
      </View>

      {form.description.trim() ? (
        <View style={styles.previewSection}>
          <AppText variant="label" color="textSecondary">
            Açıklama
          </AppText>
          <AppText variant="body" color="textSecondary">
            {form.description.trim()}
          </AppText>
        </View>
      ) : null}

      {attributeEntries.length ? (
        <View style={styles.previewSection}>
          <AppText variant="label" color="textSecondary">
            Özellikler
          </AppText>
          <View style={styles.attrGrid}>
            {attributeEntries.map((entry) => (
              <View
                key={entry.label}
                style={[
                  styles.attrCell,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <AppText variant="caption" color="textTertiary">
                  {entry.label}
                </AppText>
                <AppText variant="caption" color="text">
                  {entry.value}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PublishStep({
  form,
  editing,
  accepted,
  onAccepted,
  categoryName,
  districtName,
  publishing,
  stage,
}: {
  form: FormSnapshot;
  editing: boolean;
  accepted: boolean;
  onAccepted: (value: boolean) => void;
  categoryName: string;
  districtName: string | null;
  publishing: boolean;
  stage: string | null;
}) {
  const { theme } = useTheme();
  const instantPublishKind = form.kind === 'real_estate' || form.kind === 'vehicle';
  return (
    <View style={styles.step}>
      <SectionTitle
        title={editing ? 'Değişiklikleri kaydet' : 'İlanı yayınla'}
        body="Son kontrol: bilgilerin doğru ve güncel olduğundan emin ol."
      />
      <View
        style={[
          styles.summaryCard,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <SummaryRow label="Kategori" value={categoryName} />
        <SummaryRow label="Konum" value={districtName ? `${districtName}, Trabzon` : 'Seçilmedi'} />
        <SummaryRow label="Medya" value={`${form.media.length} fotoğraf/video`} />
        <SummaryRow
          label="Fiyat"
          value={formatMarketPrice(parsePriceCents(form.price) ?? 0, 'TRY', form.pricePeriod)}
        />
        <SummaryRow
          label="İletişim"
          value={form.callAllowed ? 'Mesaj + telefon' : 'Yalnızca mesaj'}
          last
        />
      </View>

      {instantPublishKind ? (
        <View
          style={[
            styles.verifyCard,
            { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.success },
          ]}
        >
          <Ionicons name="flash-outline" size={18} color={theme.colors.success} />
          <View style={styles.flex}>
            <AppText variant="label">İlanın anında yayında</AppText>
            <AppText variant="caption" color="textSecondary">
              Emlak ve araç ilanları moderasyon onayı beklemez. Yayındaki ilanını dilediğin an
              düzenleyebilir, doğrulama belgesi ekleyebilirsin.
            </AppText>
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.legalCard,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          onPress={() => onAccepted(!accepted)}
          style={styles.checkRow}
        >
          <Ionicons
            name={accepted ? 'checkbox' : 'square-outline'}
            size={22}
            color={accepted ? theme.colors.primaryDeep : theme.colors.textTertiary}
          />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            İlanın doğru bilgiler içerdiğini, Trabzone ilan kurallarına ve yürürlükteki mevzuata
            uygun olduğunu onaylıyorum.
          </AppText>
        </Pressable>
      </View>

      {publishing ? (
        <View style={styles.publishing}>
          <Ionicons name="cloud-upload-outline" size={18} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="textSecondary">
            {stage ?? 'Hazırlanıyor…'}
          </AppText>
        </View>
      ) : null}

      <AppText variant="caption" color="textTertiary" align="center">
        {editing
          ? 'Güncelleme sonrası ilan yeniden moderasyon kontrolünden geçebilir.'
          : 'Yayınlama ücretsizdir. İlanın 30 gün boyunca yayında kalır.'}
      </AppText>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.summaryRow,
        !last
          ? { borderBottomColor: theme.colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }
          : null,
      ]}
    >
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText
        variant="caption"
        color="textSecondary"
        style={styles.summaryValue}
        numberOfLines={2}
      >
        {value}
      </AppText>
    </View>
  );
}

function SectionTitle({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="h3">{title}</AppText>
      {body ? (
        <AppText variant="caption" color="textTertiary">
          {body}
        </AppText>
      ) : null}
    </View>
  );
}

function formatAttribute(
  field: MarketFormField,
  value: string | boolean | undefined,
): string | null {
  if (value == null || value === '' || value === false) {
    return null;
  }
  if (field.type === 'boolean') {
    return value === true ? 'Evet' : null;
  }
  return String(value);
}

function categoryDefaults(node: CategoryNode, current: Record<string, string | boolean>) {
  if (node.kind !== 'real_estate') {
    return current;
  }
  const path = node.path_names.join(' ').toLocaleLowerCase('tr-TR');
  const listingKind = path.includes('kiralık')
    ? 'rent'
    : path.includes('devren')
      ? 'transfer'
      : path.includes('satılık')
        ? 'sale'
        : current.listing_kind;
  return listingKind ? { ...current, listing_kind: listingKind } : current;
}

function inferPricePeriod(node: CategoryNode, kind: WizardKind): FormSnapshot['pricePeriod'] {
  if (kind === 'service') {
    return 'service';
  }
  if (kind !== 'real_estate') {
    return 'total';
  }
  const path = node.path_names.join(' ').toLocaleLowerCase('tr-TR');
  return path.includes('kiralık') ? 'month' : 'total';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 8,
  },
  progress: { flexDirection: 'row', gap: 4, paddingHorizontal: 18, paddingBottom: 10 },
  progressSegment: { flex: 1, height: 4, borderRadius: 2 },
  content: { paddingHorizontal: 18, paddingBottom: 24 },
  step: { gap: 14 },
  sectionTitle: { gap: 2, marginTop: 2 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    marginBottom: 10,
  },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindCard: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  loadingList: { gap: 7 },
  loadingRow: { height: 44, borderRadius: 12 },
  horizontalChips: { gap: 7, paddingRight: 12 },
  rootChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 38,
  },
  categoryList: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 10,
    paddingRight: 12,
    minHeight: 50,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  descriptionInput: { minHeight: 120 },
  fieldGroup: { gap: 9 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choiceChip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 37,
    justifyContent: 'center',
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stockInput: { width: 84 },
  verifyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 58,
  },
  switch: { width: 42, height: 25, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#FFFFFF' },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 54,
  },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaCell: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    backgroundColor: '#0B1020',
  },
  mediaImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  mediaOrder: {
    position: 'absolute',
    top: 4,
    left: 4,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,10,22,0.62)',
  },
  videoMark: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(4,10,22,0.6)',
  },
  coverMark: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(65,105,245,0.85)',
  },
  mediaTools: {
    position: 'absolute',
    top: 3,
    right: 3,
    flexDirection: 'row',
    gap: 2,
  },
  mediaTool: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,10,22,0.55)',
  },
  disabled: { opacity: 0.35 },
  failedMark: {
    position: 'absolute',
    top: '44%',
    left: '44%',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(196,42,54,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCell: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mapWrap: {
    height: 210,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  coordinateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  previewCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  previewCover: { height: 190, alignItems: 'center', justifyContent: 'center' },
  previewCount: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(4,10,22,0.6)',
  },
  previewBody: { padding: 12, gap: 4 },
  previewLocation: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  previewSection: { gap: 6 },
  attrGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  attrCell: {
    width: '48.7%',
    padding: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  summaryCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11 },
  summaryValue: { flex: 1, textAlign: 'right' },
  legalCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  publishing: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  backButton: { paddingHorizontal: 20 },
  skeleton: { flex: 1 },
  skeletonBar: { height: 52, margin: 14, borderRadius: 14 },
  skeletonBody: { paddingHorizontal: 18, gap: 12 },
  skeletonRow: { height: 76, borderRadius: 16 },
});
