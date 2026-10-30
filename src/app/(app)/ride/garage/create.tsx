import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { RideHeader } from '@/features/ride/components/RideHeader';
import {
  useRideVehicles,
  useSaveVehicle,
  useSubmitVehicleDocument,
} from '@/features/ride/hooks/use-ride';
import {
  rideVehiclePhotoUrl,
  uploadRideDocument,
  uploadVehiclePhoto,
} from '@/features/ride/services/ride-service';
import {
  NEEDS_DEV_BUILD,
  loadDocumentPicker,
  loadImagePicker,
  preloadDocumentModules,
} from '@/features/ride/utils/native';
import { unwrap } from '@/utils/result';

type DocKind = 'registration' | 'insurance' | 'inspection' | 'authorization';

const DOC_LABEL: Record<DocKind, string> = {
  registration: 'Araç ruhsatı',
  insurance: 'Trafik sigortası',
  inspection: 'Muayene belgesi',
  authorization: 'Taşımacılık yetki belgesi',
};

export default function GarageCreateScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof params.id === 'string' ? params.id : null;
  const vehicles = useRideVehicles();
  const save = useSaveVehicle();
  const submitDoc = useSubmitVehicleDocument();

  const existing = useMemo(
    () => vehicles.data?.find((vehicle) => vehicle.id === editingId) ?? null,
    [editingId, vehicles.data],
  );

  const [savedId, setSavedId] = useState<string | null>(editingId);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [color, setColor] = useState('');
  const [plate, setPlate] = useState('');
  const [seatCapacity, setSeatCapacity] = useState(4);
  const [luggage, setLuggage] = useState<'small' | 'medium' | 'large'>('medium');
  const [hasAc, setHasAc] = useState(true);
  const [fuel, setFuel] = useState<'gasoline' | 'diesel' | 'lpg' | 'hybrid' | 'electric'>(
    'gasoline',
  );
  const [wheelchair, setWheelchair] = useState(false);
  const [childSeat, setChildSeat] = useState(false);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [docKind, setDocKind] = useState<DocKind>('registration');
  const [docExpiry, setDocExpiry] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editing form is hydrated once the async vehicle record arrives; this is
  // an intentional external-store sync, not a render-derived state update.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!existing) {
      return;
    }
    setMake(existing.make);
    setModel(existing.model);
    setYear(String(existing.year));
    setColor(existing.color);
    setPlate(existing.plate);
    setSeatCapacity(existing.seat_capacity);
    setLuggage(existing.luggage_capacity);
    setHasAc(existing.has_ac);
    setFuel(existing.fuel_type);
    setWheelchair(Boolean(existing.accessibility?.wheelchair));
    setChildSeat(Boolean(existing.accessibility?.child_seat));
    setPhotoPaths(existing.photo_paths ?? []);
    setSavedId(existing.id);
  }, [existing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Seçici modüller ekran açılırken ısıtılır; ilk dokunuşta bekleme olmaz.
  useEffect(() => {
    preloadDocumentModules();
    void loadImagePicker();
  }, []);

  const handleSave = async () => {
    setError(null);
    if (!make.trim() || !model.trim() || !plate.trim() || !color.trim()) {
      setError('Marka, model, renk ve plaka zorunlu.');
      return;
    }
    const yearNumber = Number(year);
    if (
      !Number.isInteger(yearNumber) ||
      yearNumber < 1980 ||
      yearNumber > new Date().getFullYear() + 1
    ) {
      setError('Geçerli bir model yılı gir.');
      return;
    }
    try {
      const result = await save.mutateAsync({
        id: savedId ?? undefined,
        make: make.trim(),
        model: model.trim(),
        year: yearNumber,
        color: color.trim(),
        plate: plate.trim().toUpperCase(),
        seatCapacity,
        luggageCapacity: luggage,
        hasAc,
        fuelType: fuel,
        accessibility: { wheelchair, child_seat: childSeat },
        photoPaths,
      });
      setSavedId(result.id);
      setNotice('Araç kaydedildi. Hemen yolculuk ilanı yayınlayabilirsin; belgeler ilanı engellemez.');
    } catch (cause) {
      setError(errorMessage(cause, 'Araç kaydedilemedi.'));
    }
  };

  const handlePickPhoto = async () => {
    setError(null);
    const ImagePicker = await loadImagePicker();
    if (!ImagePicker) {
      setError(NEEDS_DEV_BUILD);
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Araç fotoğrafı için galeri izni gerekli.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.82,
      allowsMultipleSelection: true,
      selectionLimit: 4,
    });
    if (picked.canceled || picked.assets.length === 0) {
      return;
    }
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const asset of picked.assets) {
        if (photoPaths.length + uploaded.length >= 4) {
          break;
        }
        const result = await uploadVehiclePhoto({
          uri: asset.uri,
          name: asset.fileName ?? 'arac.jpg',
          mime: asset.mimeType ?? 'image/jpeg',
          size: asset.fileSize ?? undefined,
        });
        uploaded.push((await unwrap(result)).path);
      }
      setPhotoPaths((current) => [...current, ...uploaded].slice(0, 4));
    } catch (cause) {
      setError(errorMessage(cause, 'Fotoğraf yüklenemedi.'));
    } finally {
      setUploading(false);
    }
  };

  const handleUploadDocument = async () => {
    setError(null);
    if (!savedId) {
      setError('Önce aracı kaydet.');
      return;
    }
    const DocumentPicker = await loadDocumentPicker();
    if (!DocumentPicker) {
      setError(NEEDS_DEV_BUILD);
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets[0]) {
      return;
    }
    const asset = picked.assets[0];
    setUploading(true);
    try {
      const result = await uploadRideDocument({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? 'application/pdf',
        size: asset.size ?? undefined,
      });
      const path = (await unwrap(result)).path;
      await submitDoc.mutateAsync({
        vehicleId: savedId,
        kind: docKind,
        documentPath: path,
        expiresAt: docExpiry ? new Date(`${docExpiry}T23:59:59`).toISOString() : null,
      });
      setNotice('Belge yüklendi ve incelemeye gönderildi.');
      setDocExpiry('');
    } catch (cause) {
      setError(errorMessage(cause, 'Belge yüklenemedi.'));
    } finally {
      setUploading(false);
    }
  };

  if (editingId && vehicles.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} padded>
        <RideHeader title="Araç düzenle" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title={existing ? 'Araç düzenle' : 'Yeni araç'}
        subtitle="Araç bilgileri · belgeler isteğe bağlı"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Garaja dön"
            onPress={() => router.replace('/ride/garage' as never)}
            style={[
              styles.iconBtn,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="grid-outline" size={18} color={theme.colors.text} />
          </Pressable>
        }
      />

      <Card padding={16} style={styles.form}>
        <AppText variant="title">Araç bilgileri</AppText>
        <View style={styles.split}>
          <TextInput
            value={make}
            onChangeText={setMake}
            placeholder="Marka"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              styles.flex,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <TextInput
            value={model}
            onChangeText={setModel}
            placeholder="Model"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              styles.flex,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
        </View>
        <View style={styles.split}>
          <TextInput
            value={year}
            onChangeText={setYear}
            placeholder="Model yılı"
            keyboardType="number-pad"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              styles.flex,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <TextInput
            value={color}
            onChangeText={setColor}
            placeholder="Renk"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              styles.flex,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
        </View>
        <TextInput
          value={plate}
          onChangeText={setPlate}
          placeholder="Plaka (34 ABC 123)"
          autoCapitalize="characters"
          placeholderTextColor={theme.colors.textTertiary}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.inputBackground,
            },
          ]}
        />

        <View style={styles.counterRow}>
          <AppText variant="body" color="textSecondary">
            Koltuk kapasitesi
          </AppText>
          <View style={styles.counter}>
            <Pressable
              onPress={() => setSeatCapacity((value) => Math.max(2, value - 1))}
              style={[styles.stepBtn, { borderColor: theme.colors.border }]}
            >
              <Ionicons name="remove" size={15} color={theme.colors.text} />
            </Pressable>
            <AppText variant="h3">{seatCapacity}</AppText>
            <Pressable
              onPress={() => setSeatCapacity((value) => Math.min(8, value + 1))}
              style={[styles.stepBtn, { borderColor: theme.colors.border }]}
            >
              <Ionicons name="add" size={15} color={theme.colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.chips}>
          {(['small', 'medium', 'large'] as const).map((item) => {
            const active = luggage === item;
            return (
              <Pressable
                key={item}
                onPress={() => setLuggage(item)}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceMuted,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                  {item === 'small'
                    ? 'Küçük bagaj'
                    : item === 'medium'
                      ? 'Orta bagaj'
                      : 'Büyük bagaj'}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.chips}>
          {(['gasoline', 'diesel', 'lpg', 'hybrid', 'electric'] as const).map((item) => {
            const active = fuel === item;
            return (
              <Pressable
                key={item}
                onPress={() => setFuel(item)}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? theme.colors.accent : theme.colors.border,
                    backgroundColor: active ? theme.colors.accentSoft : theme.colors.surfaceMuted,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'accent' : 'textSecondary'}>
                  {item === 'gasoline'
                    ? 'Benzin'
                    : item === 'diesel'
                      ? 'Dizel'
                      : item === 'lpg'
                        ? 'LPG'
                        : item === 'hybrid'
                          ? 'Hibrit'
                          : 'Elektrik'}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.switchRow}>
          <AppText variant="body" color="textSecondary" style={styles.flex}>
            Klima
          </AppText>
          <Switch
            value={hasAc}
            onValueChange={setHasAc}
            trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
            thumbColor={hasAc ? theme.colors.primary : theme.colors.textTertiary}
          />
        </View>
        <View style={styles.switchRow}>
          <AppText variant="body" color="textSecondary" style={styles.flex}>
            Tekerlekli sandalye erişimi
          </AppText>
          <Switch
            value={wheelchair}
            onValueChange={setWheelchair}
            trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
            thumbColor={wheelchair ? theme.colors.primary : theme.colors.textTertiary}
          />
        </View>
        <View style={styles.switchRow}>
          <AppText variant="body" color="textSecondary" style={styles.flex}>
            Çocuk koltuğu mevcut
          </AppText>
          <Switch
            value={childSeat}
            onValueChange={setChildSeat}
            trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
            thumbColor={childSeat ? theme.colors.primary : theme.colors.textTertiary}
          />
        </View>

        <AppText variant="caption" color="textSecondary">
          Araç fotoğrafları (en fazla 4)
        </AppText>
        <View style={styles.photos}>
          {photoPaths.map((path, index) => {
            const url = rideVehiclePhotoUrl(path);
            return (
              <View key={`${path}-${index}`} style={styles.photoBox}>
                {url ? (
                  <Image source={{ uri: url }} style={styles.photo} contentFit="cover" />
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fotoğrafı kaldır"
                  onPress={() => setPhotoPaths((current) => current.filter((_, i) => i !== index))}
                  style={[styles.removePhoto, { backgroundColor: theme.colors.overlay }]}
                >
                  <Ionicons name="close" size={13} color="#FFFFFF" />
                </Pressable>
              </View>
            );
          })}
          {photoPaths.length < 4 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fotoğraf ekle"
              onPress={() => void handlePickPhoto()}
              style={[styles.addPhoto, { borderColor: theme.colors.border }]}
            >
              <Ionicons name="camera-outline" size={20} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary">
                Ekle
              </AppText>
            </Pressable>
          ) : null}
        </View>
        {uploading ? (
          <View style={styles.uploading}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <AppText variant="caption" color="textTertiary">
              Yükleniyor…
            </AppText>
          </View>
        ) : null}

        {error ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : null}
        {notice ? (
          <AppText variant="caption" color="success">
            {notice}
          </AppText>
        ) : null}

        <Button
          label={savedId ? 'Araç bilgilerini güncelle' : 'Aracı kaydet'}
          loading={save.isPending}
          onPress={() => void handleSave()}
        />
      </Card>

      {savedId ? (
        <Card padding={16} style={styles.form}>
          <AppText variant="title">Belgeler</AppText>
          <AppText variant="caption" color="textTertiary">
            Belgeler isteğe bağlıdır; ilan yayınını engellemez. Yüklersen ruhsat, sigorta ve
            muayene geçerlilik tarihleri takip edilir. Belgeler özel `ride-documents` kovasında
            saklanır ve yalnızca yetkili inceleyiciler erişebilir.
          </AppText>
          <View style={styles.chips}>
            {(Object.keys(DOC_LABEL) as DocKind[]).map((item) => {
              const active = docKind === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setDocKind(item)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active
                        ? theme.colors.primarySoft
                        : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                    {DOC_LABEL[item]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={docExpiry}
            onChangeText={setDocExpiry}
            placeholder="Geçerlilik tarihi YYYY-AA-GG"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <Button
            label="Belge seç ve yükle"
            variant="secondary"
            loading={submitDoc.isPending || uploading}
            onPress={() => void handleUploadDocument()}
            leftIcon={
              <Ionicons name="cloud-upload-outline" size={17} color={theme.colors.primaryDeep} />
            }
          />

          <View style={styles.docs}>
            {(existing?.documents ?? []).map((doc) => (
              <View key={doc.id} style={[styles.docRow, { borderColor: theme.colors.border }]}>
                <Ionicons
                  name={
                    doc.status === 'approved'
                      ? 'checkmark-circle'
                      : doc.status === 'rejected'
                        ? 'close-circle'
                        : 'time-outline'
                  }
                  size={16}
                  color={
                    doc.status === 'approved'
                      ? theme.colors.success
                      : doc.status === 'rejected'
                        ? theme.colors.danger
                        : theme.colors.warning
                  }
                />
                <View style={styles.flex}>
                  <AppText variant="label" numberOfLines={1}>
                    {DOC_LABEL[doc.kind] ?? doc.kind}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {doc.expires_at
                      ? `Geçerlilik: ${new Date(doc.expires_at).toLocaleDateString('tr-TR')}`
                      : 'Geçerlilik tarihi yok'}
                  </AppText>
                </View>
                <Badge
                  label={
                    doc.status === 'approved'
                      ? 'Onaylı'
                      : doc.status === 'rejected'
                        ? 'Reddedildi'
                        : 'İnceleniyor'
                  }
                  tone={
                    doc.status === 'approved'
                      ? 'success'
                      : doc.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                  }
                />
              </View>
            ))}
            {(existing?.documents ?? []).length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Henüz belge yüklenmedi.
              </AppText>
            ) : null}
          </View>
        </Card>
      ) : null}

      <Card padding={12} tone="muted">
        <View style={styles.infoRow}>
          <Ionicons name="information-circle-outline" size={16} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Araç değişikliği mevcut rezervasyonların kapasite ve erişilebilirlik koşullarını
            etkiliyorsa onay alınmadan uygulanmaz. Önemli değişiklikler yolculara bildirilir.
          </AppText>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { paddingVertical: 60, alignItems: 'center' },
  form: { gap: 12 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  split: { flexDirection: 'row', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoBox: { width: 82, height: 64, borderRadius: 10, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  removePhoto: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 19,
    height: 19,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhoto: {
    width: 82,
    height: 64,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  uploading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  docs: { gap: 7 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});
