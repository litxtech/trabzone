import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton, TextField } from '@/components/ui';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import { uploadMedia } from '@/features/media/media-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useExploreBootstrap, useSubmitPlaceSuggestion } from '../hooks/use-explore';
import type { LatLng } from '../types';
import { MAP_DEFAULT_CAMERA } from '@/features/map/constants';
import { LocationPickerModal } from './LocationPickerModal';

type Props = {
  visible: boolean;
  initial?: LatLng | null;
  onClose: () => void;
  onSubmitted: () => void;
};

type PickerKey = 'category' | 'district' | 'neighborhood' | null;

/** Haritada olmayan bir işletmeyi önerir. Doğrudan yayınlanmaz; moderasyon kuyruğuna gider. */
export function PlaceSuggestModal({ visible, initial, onClose, onSubmitted }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const bootstrap = useExploreBootstrap();
  const profile = useMyProfile();
  const submit = useSubmitPlaceSuggestion();

  const [name, setName] = useState('');
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [neighborhoodId, setNeighborhoodId] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [point, setPoint] = useState<LatLng>(
    initial ?? { lat: MAP_DEFAULT_CAMERA.lat, lng: MAP_DEFAULT_CAMERA.lng },
  );
  const [media, setMedia] = useState<PickedAsset[]>([]);
  const [picker, setPicker] = useState<PickerKey>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const flat: { slug: string; name: string; icon: string | null }[] = [];
    for (const category of bootstrap.data?.place_categories ?? []) {
      flat.push({ slug: category.slug, name: category.name, icon: category.icon });
      for (const child of category.children ?? []) {
        flat.push({ slug: child.slug, name: `${category.name} · ${child.name}`, icon: child.icon });
      }
    }
    return flat;
  }, [bootstrap.data?.place_categories]);

  const districts = bootstrap.data?.districts ?? [];
  const district = districts.find((item) => item.id === districtId) ?? null;
  const neighborhoods = district?.neighborhoods ?? [];
  const category = categories.find((item) => item.slug === categorySlug) ?? null;
  const neighborhood = neighborhoods.find((item) => item.id === neighborhoodId) ?? null;

  const reset = () => {
    setName('');
    setCategorySlug(null);
    setDistrictId(null);
    setNeighborhoodId(null);
    setAddress('');
    setDescription('');
    setPhone('');
    setMedia([]);
    setError(null);
    setStage(null);
  };

  const close = () => {
    if (busy) {
      return;
    }
    reset();
    onClose();
  };

  const pickPhotos = async (source: 'library' | 'camera') => {
    const picked = await pickMedia({
      source,
      kind: 'image',
      multiple: source === 'library',
      limit: Math.max(1, 4 - media.length),
    });
    if (picked && picked.length > 0) {
      setMedia((current) => [...current, ...picked].slice(0, 4));
    }
  };

  const valid = name.trim().length >= 2 && Boolean(categorySlug) && Boolean(districtId) && address.trim().length >= 3;

  const send = async () => {
    if (!valid || !profile.data || !categorySlug || !districtId) {
      setError('İşletme adı, kategori, ilçe ve adres zorunludur.');
      return;
    }

    setBusy(true);
    setError(null);
    const uploaded: { kind: 'image'; storage_path: string }[] = [];

    for (let index = 0; index < media.length; index += 1) {
      const asset = media[index]!;
      setStage(`Fotoğraf yükleniyor ${index + 1}/${media.length}`);
      const result = await uploadMedia({
        bucket: 'place-media',
        folder: profile.data.id,
        uri: asset.uri,
        mime: asset.mimeType,
        fileName: asset.fileName,
        compressImages: true,
      });
      if (!result.ok) {
        setBusy(false);
        setStage(null);
        setError(result.error.message || 'Fotoğraf yüklenemedi.');
        return;
      }
      uploaded.push({ kind: 'image', storage_path: result.data.path });
    }

    setStage('Öneri gönderiliyor');
    submit.mutate(
      {
        name: name.trim(),
        category_slug: categorySlug,
        district_id: districtId,
        neighborhood_id: neighborhoodId,
        address: address.trim(),
        description: description.trim() || null,
        phone: phone.trim() || null,
        lat: point.lat,
        lng: point.lng,
        media: uploaded.length > 0 ? uploaded : undefined,
      },
      {
        onSuccess: () => {
          haptics.success();
          setBusy(false);
          setStage(null);
          reset();
          Alert.alert(
            'Önerin alındı',
            'Eklediğin yer hemen yayınlanmaz. Yönetim ekibi mükerrer kayıt, konum ve içerik kontrolünden sonra onaylarsa haritada görünür.',
            [{ text: 'Tamam', onPress: onSubmitted }],
          );
        },
        onError: (mutationError) => {
          setBusy(false);
          setStage(null);
          setError(mutationError.message || 'Öneri gönderilemedi.');
        },
      },
    );
  };

  const selectOptions: { key: Exclude<PickerKey, null>; title: string; options: { id: string; label: string; sub?: string }[] } | null =
    picker === 'category'
      ? {
          key: 'category',
          title: 'Kategori seç',
          options: categories.map((item) => ({ id: item.slug, label: item.name })),
        }
      : picker === 'district'
        ? {
            key: 'district',
            title: 'İlçe seç',
            options: districts.map((item) => ({ id: String(item.id), label: item.name })),
          }
        : picker === 'neighborhood'
          ? {
              key: 'neighborhood',
              title: 'Mahalle seç',
              options: neighborhoods.map((item) => ({ id: String(item.id), label: item.name })),
            }
          : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: theme.colors.background, paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <IconButton name="close" accessibilityLabel="Öneri formunu kapat" variant="surface" size={18} onPress={close} />
          <View style={styles.flex}>
            <AppText variant="h3">Haritaya yer ekle</AppText>
            <AppText variant="caption" color="textTertiary">
              Öneriler yalnızca moderasyon onayından sonra yayınlanır
            </AppText>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TextField
            label="İşletme adı *"
            value={name}
            onChangeText={setName}
            placeholder="Örn. Uzungöl Kahvaltı Evi"
            maxLength={120}
            editable={!busy}
          />

          <PickerField
            label="Kategori *"
            value={category?.name ?? null}
            placeholder="Kategori seç"
            onPress={() => setPicker('category')}
          />

          <PickerField
            label="İlçe *"
            value={district?.name ?? null}
            placeholder="İlçe seç"
            onPress={() => setPicker('district')}
          />

          <PickerField
            label="Mahalle"
            value={neighborhood?.name ?? null}
            placeholder={district ? 'Mahalle seç' : 'Önce ilçe seç'}
            disabled={!district}
            onPress={() => setPicker('neighborhood')}
          />

          <TextField
            label="Adres *"
            value={address}
            onChangeText={setAddress}
            placeholder="Cadde, sokak, no"
            maxLength={240}
            leftIcon="location-outline"
            editable={!busy}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Haritadan konum seç"
            onPress={() => setLocationOpen(true)}
            disabled={busy}
            style={[
              styles.location,
              { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
            ]}
          >
            <View style={[styles.locationIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="map-outline" size={19} color={theme.colors.primaryDeep} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">Haritadan konum seç</AppText>
              <AppText variant="caption" color="textTertiary">
                {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
              </AppText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
          </Pressable>

          <TextField
            label="Telefon"
            value={phone}
            onChangeText={setPhone}
            placeholder="İşletmenin kamuya açık numarası"
            keyboardType="phone-pad"
            maxLength={24}
            editable={!busy}
          />

          <TextField
            label="Açıklama"
            value={description}
            onChangeText={setDescription}
            placeholder="İşletme hakkında kısa bilgi"
            multiline
            maxLength={600}
            editable={!busy}
          />

          <View style={styles.mediaBlock}>
            <AppText variant="label" color="textSecondary">
              Fotoğraf (en fazla 4)
            </AppText>
            <View style={styles.mediaRow}>
              {media.map((asset, index) => (
                <View key={`${asset.uri}-${index}`} style={styles.mediaTile}>
                  <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Fotoğrafı kaldır"
                    hitSlop={6}
                    disabled={busy}
                    onPress={() => setMedia((current) => current.filter((_, i) => i !== index))}
                    style={styles.removeMedia}
                  >
                    <Ionicons name="close" size={12} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
              {media.length < 4 ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Galeriden fotoğraf ekle"
                    disabled={busy}
                    onPress={() => void pickPhotos('library')}
                    style={[styles.addMedia, { borderColor: theme.colors.borderStrong }]}
                  >
                    <Ionicons name="images-outline" size={20} color={theme.colors.primaryDeep} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Kameradan fotoğraf çek"
                    disabled={busy}
                    onPress={() => void pickPhotos('camera')}
                    style={[styles.addMedia, { borderColor: theme.colors.borderStrong }]}
                  >
                    <Ionicons name="camera-outline" size={20} color={theme.colors.primaryDeep} />
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>

          <View style={[styles.note, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="shield-checkmark-outline" size={16} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              Gönderdiğin konum ve fotoğraflar doğrulanmamış öneri olarak saklanır. Onaylanmadan
              “doğrulanmış işletme” olarak gösterilmez.
            </AppText>
          </View>

          {error ? (
            <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider, paddingBottom: insets.bottom + 12 },
          ]}
        >
          {stage ? (
            <View style={styles.stageRow}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <AppText variant="caption" color="textSecondary">
                {stage}
              </AppText>
            </View>
          ) : null}
          <Button label="Öneriyi gönder" onPress={() => void send()} loading={busy} disabled={!valid || busy} />
        </View>

        {selectOptions ? (
          <View style={StyleSheet.absoluteFill}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Seçimi kapat"
              style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
              onPress={() => setPicker(null)}
            />
            <View
              style={[
                styles.optionsSheet,
                theme.shadows.sheet,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  paddingBottom: Math.max(insets.bottom, 12),
                },
              ]}
            >
              <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
              <View style={styles.optionsHead}>
                <AppText variant="h3" style={styles.flex}>
                  {selectOptions.title}
                </AppText>
                <IconButton name="close" accessibilityLabel="Kapat" size={18} onPress={() => setPicker(null)} />
              </View>
              <ScrollView style={styles.optionsList} keyboardShouldPersistTaps="handled">
                {selectOptions.options.length === 0 ? (
                  <AppText variant="caption" color="textTertiary" align="center" style={styles.optionsEmpty}>
                    Seçenek bulunamadı. Yönetim panelinden kategori/mahalle tanımlanması gerekebilir.
                  </AppText>
                ) : null}
                {selectOptions.options.map((option) => {
                  const selected =
                    picker === 'category'
                      ? categorySlug === option.id
                      : picker === 'district'
                        ? districtId === Number(option.id)
                        : neighborhoodId === Number(option.id);
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        if (picker === 'category') {
                          setCategorySlug(option.id);
                        } else if (picker === 'district') {
                          setDistrictId(Number(option.id));
                          setNeighborhoodId(null);
                        } else {
                          setNeighborhoodId(Number(option.id));
                        }
                        haptics.selection();
                        setPicker(null);
                      }}
                      style={({ pressed }) => [
                        styles.option,
                        {
                          borderColor: theme.colors.border,
                          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
                        },
                      ]}
                    >
                      <AppText variant="body" style={styles.flex}>
                        {option.label}
                      </AppText>
                      {selected ? <Ionicons name="checkmark" size={18} color={theme.colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        ) : null}

        <LocationPickerModal
          visible={locationOpen}
          embedded
          initial={point}
          title="İşletme konumu"
          onClose={() => setLocationOpen(false)}
          onConfirm={(next) => {
            setPoint(next);
            setLocationOpen(false);
          }}
        />
      </View>
    </Modal>
  );
}

function PickerField({
  label,
  value,
  placeholder,
  onPress,
  disabled,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        accessibilityState={{ disabled: Boolean(disabled) }}
        onPress={onPress}
        disabled={disabled}
        style={[
          styles.picker,
          {
            backgroundColor: theme.colors.inputBackground,
            borderColor: theme.colors.border,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <AppText variant="body" color={value ? 'text' : 'textTertiary'} style={styles.flex}>
          {value ?? placeholder}
        </AppText>
        <Ionicons name="chevron-down" size={16} color={theme.colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 8, gap: 12 },
  picker: {
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  location: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  locationIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mediaBlock: { gap: 6 },
  mediaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaTile: { width: 72, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0B1220' },
  removeMedia: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  addMedia: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { flexDirection: 'row', gap: 8, padding: 11, borderRadius: 14 },
  error: { flexDirection: 'row', gap: 6, padding: 10, borderRadius: 12, alignItems: 'center' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  optionsSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '72%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  optionsHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  optionsList: { maxHeight: 420 },
  optionsEmpty: { paddingVertical: 26 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
