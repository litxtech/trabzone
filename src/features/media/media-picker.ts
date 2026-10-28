import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

export type PickedAsset = {
  uri: string;
  mediaType: 'image' | 'video';
  mimeType: string | null;
  fileName: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fileSize: number | null;
};

export type PickSource = 'library' | 'camera';
export type PickKind = 'image' | 'video' | 'all';

async function ensurePermission(source: PickSource): Promise<boolean> {
  const current =
    source === 'camera'
      ? await ImagePicker.getCameraPermissionsAsync()
      : await ImagePicker.getMediaLibraryPermissionsAsync();

  if (current.granted) {
    return true;
  }

  const asked =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (asked.granted) {
    return true;
  }

  if (!asked.canAskAgain) {
    Alert.alert(
      source === 'camera' ? 'Kamera izni gerekli' : 'Galeri izni gerekli',
      'İzin vermediğin için medya seçemiyoruz. Ayarlardan izni açabilirsin.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Ayarları aç', onPress: () => void Linking.openSettings() },
      ],
    );
  }

  return false;
}

function toAsset(asset: ImagePicker.ImagePickerAsset): PickedAsset {
  return {
    uri: asset.uri,
    mediaType: asset.type === 'video' ? 'video' : 'image',
    mimeType: asset.mimeType ?? null,
    fileName: asset.fileName ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    durationMs: asset.duration ?? null,
    fileSize: asset.fileSize ?? null,
  };
}

/**
 * Galeriden veya kameradan medya seçer. Iptal/izin reddi `null` doner;
 * hata durumlari cagiran ekranda ele alinir.
 */
export async function pickMedia(options: {
  source: PickSource;
  kind: PickKind;
  multiple?: boolean;
  limit?: number;
  /**
   * Video kayıt üst sınırı (saniye). Verilmezse süre sınırı uygulanmaz;
   * videolar paylaşımdan önce otomatik sıkıştırılır.
   */
  maxVideoDuration?: number;
}): Promise<PickedAsset[] | null> {
  const allowed = await ensurePermission(options.source);
  if (!allowed) {
    return null;
  }

  const mediaTypes: ImagePicker.MediaType[] =
    options.kind === 'all'
      ? ['images', 'videos']
      : options.kind === 'video'
        ? ['videos']
        : ['images'];
  const maxVideoDuration =
    options.maxVideoDuration && options.maxVideoDuration > 0 ? options.maxVideoDuration : undefined;

  const result =
    options.source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes,
          quality: 0.9,
          videoMaxDuration: maxVideoDuration,
          // Kamerada en yüksek kalite yakalanır; sıkıştırma paylaşım
          // öncesinde yapılır.
          videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes,
          quality: 0.9,
          allowsMultipleSelection: options.multiple ?? false,
          selectionLimit: options.multiple ? Math.min(options.limit ?? 10, 10) : 1,
          videoMaxDuration: maxVideoDuration,
          orderedSelection: true,
        });

  if (result.canceled) {
    return null;
  }

  return result.assets.slice(0, options.multiple ? (options.limit ?? 10) : 1).map(toAsset);
}
