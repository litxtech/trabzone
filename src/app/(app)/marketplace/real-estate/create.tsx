import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppText,
  Badge,
  Button,
  IconButton,
  Screen,
  ScreenHeader,
  TextField,
} from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import {
  useAddRealEstateMedia,
  useCreateRealEstateDraft,
  useExploreBootstrap,
  useRealEstateDetail,
  useSetRealEstateCover,
  useSubmitRealEstateVerification,
  useUpdateRealEstate,
} from '@/features/explore/hooks/use-explore';
import { LocationPickerModal } from '@/features/explore/components/LocationPickerModal';
import type { RealEstateCategory } from '@/features/explore/types';
import { TRABZON_BOUNDS, isInsideTrabzon } from '@/features/explore/utils/geo';
import { pickMedia, type PickedAsset } from '@/features/media/media-picker';
import { publicMediaUrl, uploadMedia } from '@/features/media/media-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { formatPrice } from '@/features/explore/utils/format';
import { listingStatusLabel, parseInteger, parsePriceToCents } from '@/features/real-estate/labels';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

type OwnerType = 'owner' | 'agent' | 'business';
type Kind = 'rent' | 'sale' | 'transfer';

type MediaDraft = {
  key: string;
  uri: string;
  mediaType: 'image' | 'video';
  existing?: { id: string; kind: 'image' | 'video'; storage_path: string; cover: boolean };
};

const HEATING_OPTIONS = [
  { key: 'natural_gas', label: 'Doğalgaz' },
  { key: 'combi', label: 'Kombi' },
  { key: 'central', label: 'Merkezi' },
  { key: 'stove', label: 'Soba' },
  { key: 'air_conditioner', label: 'Klima' },
  { key: 'floor_heating', label: 'Yerden ısıtma' },
];

const OWNER_TYPES: { key: OwnerType; label: string; hint: string }[] = [
  { key: 'owner', label: 'Sahibinden', hint: 'Mal sahibi bireysel ilan' },
  { key: 'agent', label: 'Danışman', hint: 'Yetkili emlak danışmanı' },
  { key: 'business', label: 'İşletme', hint: 'Emlak işletmesi / ofis' },
];

const MAX_MEDIA = 12;

export default function RealEstateCreateScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof params.id === 'string' && params.id ? params.id : null;
  const router = useRouter();
  const { theme } = useTheme();

  const bootstrap = useExploreBootstrap();
  const existing = useRealEstateDetail(editingId);
  const profile = useMyProfile();
  const createDraft = useCreateRealEstateDraft();
  const updateListing = useUpdateRealEstate(editingId ?? '');
  const addMedia = useAddRealEstateMedia(editingId ?? '');
  const setCover = useSetRealEstateCover(editingId ?? '');
  const submitVerification = useSubmitRealEstateVerification(editingId ?? '');

  const [kind, setKind] = useState<Kind>('rent');
  const [category, setCategory] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<'TRY' | 'USD' | 'EUR' | 'GBP'>('TRY');
  const [ownerType, setOwnerType] = useState<OwnerType>('owner');
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [neighborhoodId, setNeighborhoodId] = useState<number | null>(null);
  const [addressText, setAddressText] = useState('');
  const [addressPrivate, setAddressPrivate] = useState('');
  const [hideExact, setHideExact] = useState(true);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [grossM2, setGrossM2] = useState('');
  const [netM2, setNetM2] = useState('');
  const [rooms, setRooms] = useState('');
  const [livingRooms, setLivingRooms] = useState('');
  const [buildingAge, setBuildingAge] = useState('');
  const [floorNo, setFloorNo] = useState('');
  const [totalFloors, setTotalFloors] = useState('');
  const [heating, setHeating] = useState<string | null>(null);
  const [furnished, setFurnished] = useState<boolean | null>(null);
  const [balcony, setBalcony] = useState<boolean | null>(null);
  const [parking, setParking] = useState<boolean | null>(null);
  const [elevator, setElevator] = useState<boolean | null>(null);
  const [deposit, setDeposit] = useState('');
  const [dues, setDues] = useState('');
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [media, setMedia] = useState<MediaDraft[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);
  const [referenceNo, setReferenceNo] = useState('');
  const [documentAsset, setDocumentAsset] = useState<PickedAsset | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [neighborhoodOpen, setNeighborhoodOpen] = useState(false);
  const [heatingOpen, setHeatingOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const districts = bootstrap.data?.districts ?? [];
  const allCategories = useMemo(
    () => bootstrap.data?.real_estate_categories ?? [],
    [bootstrap.data],
  );
  const categoryOptions = useMemo(
    () => flattenCategories(allCategories).filter((item) => item.listing_kind === kind),
    [allCategories, kind],
  );
  const selectedCategory = useMemo(
    () => flattenCategories(allCategories).find((item) => item.slug === category) ?? null,
    [allCategories, category],
  );
  const district = districts.find((item) => item.id === districtId) ?? null;
  const busy = Boolean(stage) || submitting;

  useEffect(() => {
    if (!existing.data || prefilled) return;
    const data = existing.data;
    // Düzenleme taslağı sunucudan bir kez doldurulur.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefilled(true);
    setKind(data.listing_kind);
    setCategory(data.category?.slug ?? null);
    setTitle(data.title);
    setDescription(data.description ?? '');
    setPrice(String(Math.round(data.price_cents / 100)));
    setCurrency((data.currency as typeof currency) ?? 'TRY');
    setOwnerType(data.owner_type);
    setDistrictId(data.district_id);
    setNeighborhoodId(data.neighborhood_id);
    setAddressText(data.address_text ?? '');
    setAddressPrivate(data.address_private ?? '');
    setHideExact(data.hide_exact_location);
    setPoint({ lat: data.lat, lng: data.lng });
    setGrossM2(data.gross_m2 ? String(data.gross_m2) : '');
    setNetM2(data.net_m2 ? String(data.net_m2) : '');
    setRooms(data.room_count != null ? String(data.room_count) : '');
    setLivingRooms(data.living_room_count != null ? String(data.living_room_count) : '');
    setBuildingAge(data.building_age != null ? String(data.building_age) : '');
    setFloorNo(data.floor_no != null ? String(data.floor_no) : '');
    setTotalFloors(data.total_floors != null ? String(data.total_floors) : '');
    setHeating(data.heating);
    setFurnished(data.furnished);
    setBalcony(data.balcony);
    setParking(data.parking);
    setElevator(data.elevator);
    setDeposit(data.deposit_cents ? String(Math.round(data.deposit_cents / 100)) : '');
    setDues(data.dues_cents ? String(Math.round(data.dues_cents / 100)) : '');
    const attr: Record<string, string> = {};
    for (const [key, value] of Object.entries(data.attributes ?? {})) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        attr[key] = String(value);
      }
    }
    setAttributes(attr);
    setMedia(
      data.media.map((item) => ({
        key: item.id,
        uri: publicMediaUrl('real-estate-media', item.storage_path) ?? '',
        mediaType: item.kind,
        existing: {
          id: item.id,
          kind: item.kind,
          storage_path: item.storage_path,
          cover: item.cover,
        },
      })),
    );
    setCoverIndex(
      Math.max(
        0,
        data.media.findIndex((item) => item.cover),
      ),
    );
  }, [existing.data, prefilled]);

  const switchKind = (next: Kind) => {
    setKind(next);
    setCategory(null);
    setAttributes({});
  };

  const pickAssets = async (source: 'library' | 'camera', assetKind: 'image' | 'video' | 'all') => {
    try {
      const picked = await pickMedia({
        source,
        kind: assetKind,
        multiple: source === 'library',
        limit: Math.max(1, MAX_MEDIA - media.length),
        maxVideoDuration: 120,
      });
      if (!picked || picked.length === 0) return;
      setMedia((current) => [
        ...current,
        ...picked.slice(0, MAX_MEDIA - current.length).map((asset, index) => ({
          key: `local-${Date.now()}-${index}`,
          uri: asset.uri,
          mediaType: asset.mediaType,
        })),
      ]);
    } catch (pickError) {
      Alert.alert(
        'Medya seçilemedi',
        pickError instanceof Error ? pickError.message : 'Tekrar dene.',
      );
    }
  };

  const pickDocument = async () => {
    try {
      const picked = await pickMedia({ source: 'library', kind: 'image', multiple: false });
      if (picked?.[0]) {
        setDocumentAsset(picked[0]);
      }
    } catch {
      Alert.alert('Belge seçilemedi', 'Belge fotoğrafını galeriden seçebilirsin.');
    }
  };

  const validate = (forSubmit: boolean) => {
    if (!selectedCategory) return 'Gayrimenkul kategorisi seç.';
    if (title.trim().length < 5) return 'Başlık en az 5 karakter olmalı.';
    const cents = parsePriceToCents(price);
    if (cents == null || cents <= 0) return 'Geçerli bir fiyat gir.';
    if (districtId == null) return 'İlçe seç.';
    if (!point || !isInsideTrabzon(point)) return 'Trabzon sınırları içinde bir konum seç.';
    if (media.length === 0 && forSubmit)
      return 'Doğrulamaya göndermek için en az bir fotoğraf ekle.';
    const gross = parseInteger(grossM2);
    const net = parseInteger(netM2);
    if (gross != null && net != null && net > gross)
      return 'Net metrekare brüt metrekareden büyük olamaz.';
    if (forSubmit && ownerType !== 'owner' && !referenceNo.trim() && !documentAsset) {
      return 'Danışman/işletme ilanlarında yetki belgesi fotoğrafı veya EİDS referans numarası zorunlu.';
    }
    return null;
  };

  const buildPayload = () => {
    const cents = parsePriceToCents(price) ?? 0;
    const attr: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (value.trim()) attr[key] = value.trim();
    }
    return {
      category_slug: selectedCategory?.slug,
      title: title.trim(),
      description: description.trim() || null,
      price_cents: cents,
      currency,
      price_period: kind === 'rent' ? 'month' : 'total',
      owner_type: ownerType,
      district_id: districtId,
      neighborhood_id: neighborhoodId,
      address_text: addressText.trim() || null,
      address_private: addressPrivate.trim() || null,
      hide_exact_location: hideExact,
      lat: point?.lat,
      lng: point?.lng,
      gross_m2: parseInteger(grossM2),
      net_m2: parseInteger(netM2),
      room_count: parseInteger(rooms),
      living_room_count: parseInteger(livingRooms),
      building_age: parseInteger(buildingAge),
      floor_no: parseInteger(floorNo),
      total_floors: parseInteger(totalFloors),
      heating,
      furnished,
      balcony,
      parking,
      elevator,
      deposit_cents: kind === 'rent' ? parsePriceToCents(deposit) : null,
      dues_cents: kind === 'rent' ? parsePriceToCents(dues) : null,
      attributes: attr,
    };
  };

  const uploadAll = async (listingId: string, userId: string) => {
    let added = 0;
    for (let index = 0; index < media.length; index += 1) {
      const item = media[index]!;
      if (item.existing) continue;
      setStage(`Medya yükleniyor ${index + 1}/${media.length}`);
      const uploaded = await uploadMedia({
        bucket: 'real-estate-media',
        folder: userId,
        uri: item.uri,
        mime: item.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
        compressImages: item.mediaType === 'image',
      });
      if (!uploaded.ok) {
        throw new Error(uploaded.error.message || 'Medya yüklenemedi.');
      }
      setStage(`Medya kaydediliyor ${index + 1}/${media.length}`);
      await addMedia.mutateAsync({
        listingId,
        kind: uploaded.data.mediaType,
        storagePath: uploaded.data.path,
        cover: index === coverIndex,
        sortOrder: index,
      });
      added += 1;
    }
    if (coverIndex >= 0) {
      const cover = media[coverIndex];
      if (cover?.existing && !cover.existing.cover) {
        await setCover.mutateAsync(cover.existing.id);
      }
    }
    void added;
  };

  const save = async (submit: boolean) => {
    setError(null);
    const invalid = validate(submit);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!profile.data?.id) {
      setError('Oturum bilgisi bulunamadı. Tekrar giriş yap.');
      return;
    }
    if (editingId && existing.data && !['draft', 'rejected'].includes(existing.data.status)) {
      setError('Yalnızca taslak veya reddedilmiş ilanlar düzenlenebilir.');
      return;
    }

    setSubmitting(true);
    let listingId = editingId;
    try {
      const payload = buildPayload();
      if (listingId) {
        await updateListing.mutateAsync(payload);
      } else {
        setStage('İlan taslağı oluşturuluyor…');
        const created = await createDraft.mutateAsync(payload);
        listingId = created.id;
      }

      await uploadAll(listingId, profile.data.id);

      if (submit) {
        setStage('EİDS doğrulama kuyruğuna gönderiliyor…');
        let documentPath: string | null = null;
        if (documentAsset) {
          setStage('Yetki belgesi yükleniyor…');
          const uploaded = await uploadMedia({
            bucket: 'real-estate-media',
            folder: profile.data.id,
            uri: documentAsset.uri,
            mime: 'image/jpeg',
            compressImages: true,
          });
          if (!uploaded.ok) throw new Error(uploaded.error.message);
          documentPath = uploaded.data.path;
        }
        const result = await submitVerification.mutateAsync({
          listingId,
          reference_no: referenceNo.trim() || null,
          document_path: documentPath,
        });
        haptics.success();
        setStage(null);
        setSubmitting(false);
        Alert.alert(
          result.eids_enabled ? 'Doğrulamaya gönderildi' : 'İlan doğrulama bekliyor',
          result.message,
          [
            {
              text: 'İlanı gör',
              onPress: () => router.replace(`/marketplace/real-estate/${listingId}` as never),
            },
          ],
        );
        return;
      }

      haptics.success();
      setStage(null);
      setSubmitting(false);
      Alert.alert(
        'Taslak kaydedildi',
        'İlan yayınlanmadı. Doğrulamaya göndermek için ilanı düzenleyebilirsin.',
        [
          {
            text: 'İlanı gör',
            onPress: () => router.replace(`/marketplace/real-estate/${listingId}` as never),
          },
        ],
      );
    } catch (cause) {
      setStage(null);
      setSubmitting(false);
      setError(cause instanceof Error ? cause.message : 'İlan kaydedilemedi.');
    }
  };

  if (editingId && existing.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <ScreenHeader title="İlanı düzenle" onBack={() => router.back()} />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.primary} />
          <AppText variant="caption" color="textTertiary">
            İlan yükleniyor…
          </AppText>
        </View>
      </Screen>
    );
  }

  const eidsEnabled = Boolean(bootstrap.data?.eids_enabled);
  const statusInfo = existing.data ? listingStatusLabel(existing.data.status) : null;
  const showResidential = !['arsa', 'tarla'].some((slug) => category?.includes(slug));
  const showCommercial = Boolean(
    category &&
    ['dukkan', 'magaza', 'ofis', 'depo', 'isyeri', 'otel', 'pansiyon'].some((slug) =>
      category.includes(slug),
    ),
  );
  const showTransfer = kind === 'transfer';

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <ScreenHeader
        title={editingId ? 'İlanı düzenle' : 'Yeni emlak ilanı'}
        subtitle="Trabzon · EİDS doğrulama akışı"
        onBack={() => router.back()}
      />

      <View
        style={[
          styles.eidsCard,
          { backgroundColor: eidsEnabled ? theme.colors.successSoft : theme.colors.warningSoft },
        ]}
      >
        <Ionicons
          name={eidsEnabled ? 'shield-checkmark-outline' : 'alert-circle-outline'}
          size={19}
          color={eidsEnabled ? theme.colors.success : theme.colors.warning}
        />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">
            {eidsEnabled ? 'EİDS doğrulaması etkin' : 'EİDS entegrasyonu henüz etkin değil'}
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {eidsEnabled
              ? 'İlan yalnızca kimlik ve ilan verme yetkisi doğrulandıktan sonra yayınlanır.'
              : 'İlan güvenli taslak/doğrulama bekleme durumunda kalır. Hiçbir ilan doğrulanmış gibi yayınlanmaz.'}
          </AppText>
        </View>
        {statusInfo ? <Badge label={statusInfo.label} tone={statusInfo.tone} /> : null}
      </View>

      <FormSection title="1. İlan türü" subtitle="Kategori listesi yönetim panelinden yönetilir.">
        <View style={styles.kindRow}>
          {(['rent', 'sale', 'transfer'] as Kind[]).map((item) => (
            <Chip
              key={item}
              label={item === 'rent' ? 'Kiralık' : item === 'sale' ? 'Satılık' : 'Devren'}
              active={kind === item}
              onPress={() => switchKind(item)}
              flex
            />
          ))}
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {categoryOptions.map((item) => (
            <Chip
              key={item.slug}
              label={item.name}
              icon={(item.icon as keyof typeof Ionicons.glyphMap | undefined) ?? 'home-outline'}
              active={category === item.slug}
              onPress={() => setCategory(item.slug)}
            />
          ))}
        </ScrollView>
        {categoryOptions.length === 0 ? (
          <AppText variant="caption" color="textTertiary">
            Bu tür için aktif kategori bulunamadı. Yönetim panelinden kategori eklenmeli.
          </AppText>
        ) : null}
      </FormSection>

      <FormSection title="2. Temel bilgiler">
        <TextField
          label="İlan başlığı"
          value={title}
          onChangeText={setTitle}
          placeholder="Örn. Ortahisar'da deniz manzaralı 3+1 daire"
          maxLength={160}
          editable={!busy}
        />
        <TextField
          label="Açıklama"
          value={description}
          onChangeText={setDescription}
          placeholder="Taşınmazın durumu, çevre olanakları, ulaşım…"
          multiline
          maxLength={8000}
          editable={!busy}
        />

        <View style={styles.row}>
          <TextField
            label={kind === 'rent' ? 'Aylık fiyat' : 'Satış / devir fiyatı'}
            value={price}
            onChangeText={setPrice}
            placeholder="25000"
            keyboardType="numeric"
            leftIcon="cash-outline"
            containerStyle={styles.flex}
            editable={!busy}
          />
          <View style={styles.currencyWrap}>
            {(['TRY', 'USD', 'EUR'] as const).map((item) => (
              <Chip
                key={item}
                label={item === 'TRY' ? '₺' : item === 'USD' ? '$' : '€'}
                active={currency === item}
                onPress={() => setCurrency(item)}
              />
            ))}
          </View>
        </View>
        {price ? (
          <AppText variant="caption" color="textTertiary">
            {formatPrice(
              parsePriceToCents(price) ?? 0,
              currency,
              kind === 'rent' ? 'month' : 'total',
            )}{' '}
            olarak gösterilecek.
          </AppText>
        ) : null}

        <AppText variant="label" color="textSecondary">
          İlan sahibi türü
        </AppText>
        <View style={styles.ownerRow}>
          {OWNER_TYPES.map((item) => {
            const active = ownerType === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                disabled={busy}
                onPress={() => setOwnerType(item.key)}
                style={[
                  styles.ownerCard,
                  {
                    borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                  },
                ]}
              >
                <AppText variant="bodyStrong" color={active ? 'primaryDeep' : 'text'}>
                  {item.label}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {item.hint}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </FormSection>

      <FormSection
        title="3. Konum"
        subtitle="İlan yalnızca Trabzon hizmet sınırları içinde oluşturulabilir."
      >
        <View style={styles.row}>
          <View style={styles.flex}>
            <FieldButton
              label="İlçe"
              value={district?.name ?? 'İlçe seç'}
              onPress={() => setDistrictOpen(true)}
              disabled={busy}
            />
          </View>
          <View style={styles.flex}>
            <FieldButton
              label="Mahalle"
              value={
                district?.neighborhoods.find((item) => item.id === neighborhoodId)?.name ??
                'Mahalle seç'
              }
              onPress={() => district && setNeighborhoodOpen(true)}
              disabled={!district || busy}
            />
          </View>
        </View>

        <TextField
          label="Açık adres (herkese görünür)"
          value={addressText}
          onChangeText={setAddressText}
          placeholder="Cadde / sokak, yaklaşık konum"
          maxLength={240}
          editable={!busy}
        />
        <TextField
          label="Özel adres (yalnızca sana görünür)"
          value={addressPrivate}
          onChangeText={setAddressPrivate}
          placeholder="Kapı no, daire, kat bilgisi"
          maxLength={240}
          editable={!busy}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Haritadan konum seç"
          onPress={() => setLocationOpen(true)}
          disabled={busy}
          style={[
            styles.mapPicker,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          <View style={[styles.mapPickerIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="map-outline" size={20} color={theme.colors.primaryDeep} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">
              {point ? 'Konum seçildi' : 'Haritadan konum seç'}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {point
                ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)} · Trabzon sınırları içinde`
                : `Trabzon · ${TRABZON_BOUNDS.south}–${TRABZON_BOUNDS.north} enlem aralığı`}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
        </Pressable>

        <ToggleRow
          label="Kesin konumu gizle"
          hint="Konutlarda yaklaşık ~110 m konum gösterilir; kapı numarası herkese açık olmaz."
          value={hideExact}
          onChange={setHideExact}
          disabled={busy}
        />
      </FormSection>

      <FormSection title="4. Taşınmaz özellikleri">
        <View style={styles.row}>
          <TextField
            label="Brüt m²"
            value={grossM2}
            onChangeText={setGrossM2}
            keyboardType="numeric"
            placeholder="140"
            containerStyle={styles.flex}
            editable={!busy}
          />
          <TextField
            label="Net m²"
            value={netM2}
            onChangeText={setNetM2}
            keyboardType="numeric"
            placeholder="120"
            containerStyle={styles.flex}
            editable={!busy}
          />
        </View>

        {showResidential ? (
          <View style={styles.row}>
            <TextField
              label="Oda sayısı"
              value={rooms}
              onChangeText={setRooms}
              keyboardType="numeric"
              placeholder="3"
              containerStyle={styles.flex}
              editable={!busy}
            />
            <TextField
              label="Salon"
              value={livingRooms}
              onChangeText={setLivingRooms}
              keyboardType="numeric"
              placeholder="1"
              containerStyle={styles.flex}
              editable={!busy}
            />
          </View>
        ) : null}

        <View style={styles.row}>
          <TextField
            label="Bina yaşı"
            value={buildingAge}
            onChangeText={setBuildingAge}
            keyboardType="numeric"
            placeholder="5"
            containerStyle={styles.flex}
            editable={!busy}
          />
          <TextField
            label="Bulunduğu kat"
            value={floorNo}
            onChangeText={setFloorNo}
            keyboardType="numeric"
            placeholder="3"
            containerStyle={styles.flex}
            editable={!busy}
          />
          <TextField
            label="Toplam kat"
            value={totalFloors}
            onChangeText={setTotalFloors}
            keyboardType="numeric"
            placeholder="8"
            containerStyle={styles.flex}
            editable={!busy}
          />
        </View>

        <FieldButton
          label="Isıtma"
          value={HEATING_OPTIONS.find((item) => item.key === heating)?.label ?? 'Seçilmedi'}
          onPress={() => setHeatingOpen(true)}
          disabled={busy}
        />

        <AppText variant="label" color="textSecondary">
          Olanaklar
        </AppText>
        <View style={styles.wrap}>
          <TriChip label="Eşyalı" value={furnished} onChange={setFurnished} disabled={busy} />
          <TriChip label="Balkon" value={balcony} onChange={setBalcony} disabled={busy} />
          <TriChip label="Otopark" value={parking} onChange={setParking} disabled={busy} />
          <TriChip label="Asansör" value={elevator} onChange={setElevator} disabled={busy} />
        </View>

        {kind === 'rent' ? (
          <View style={styles.row}>
            <TextField
              label="Depozito (₺)"
              value={deposit}
              onChangeText={setDeposit}
              keyboardType="numeric"
              placeholder="50000"
              containerStyle={styles.flex}
              editable={!busy}
            />
            <TextField
              label="Aidat (₺)"
              value={dues}
              onChangeText={setDues}
              keyboardType="numeric"
              placeholder="1500"
              containerStyle={styles.flex}
              editable={!busy}
            />
          </View>
        ) : null}

        {showCommercial ? (
          <View style={styles.extras}>
            <AppText variant="label" color="textSecondary">
              Ticari gayrimenkul detayları
            </AppText>
            <AttrField
              label="Cephe durumu"
              field="cephe_durumu"
              value={attributes.cephe_durumu ?? ''}
              onChange={(value) =>
                setAttributes((current) => ({ ...current, cephe_durumu: value }))
              }
              disabled={busy}
            />
            <AttrField
              label="Kullanım türü"
              field="kullanim_turu"
              value={attributes.kullanim_turu ?? ''}
              onChange={(value) =>
                setAttributes((current) => ({ ...current, kullanim_turu: value }))
              }
              disabled={busy}
            />
            <View style={styles.row}>
              <AttrField
                label="Depo alanı (m²)"
                field="depo_alani"
                value={attributes.depo_alani ?? ''}
                onChange={(value) =>
                  setAttributes((current) => ({ ...current, depo_alani: value }))
                }
                disabled={busy}
                flex
              />
              <AttrField
                label="Giriş durumu"
                field="giris_durumu"
                value={attributes.giris_durumu ?? ''}
                onChange={(value) =>
                  setAttributes((current) => ({ ...current, giris_durumu: value }))
                }
                disabled={busy}
                flex
              />
            </View>
            <AttrField
              label={kind === 'rent' ? 'Kiralama koşulları' : 'Satış koşulları'}
              field="kosullar"
              value={attributes.kosullar ?? ''}
              onChange={(value) => setAttributes((current) => ({ ...current, kosullar: value }))}
              disabled={busy}
            />
          </View>
        ) : null}

        {showTransfer ? (
          <View style={styles.extras}>
            <AppText variant="label" color="textSecondary">
              Devren işletme detayları
            </AppText>
            <AttrField
              label="Devir bedeli (₺)"
              field="devir_bedeli"
              value={attributes.devir_bedeli ?? ''}
              onChange={(value) =>
                setAttributes((current) => ({ ...current, devir_bedeli: value }))
              }
              disabled={busy}
            />
            <View style={styles.row}>
              <AttrField
                label="Çalışan sayısı"
                field="calisan_sayisi"
                value={attributes.calisan_sayisi ?? ''}
                onChange={(value) =>
                  setAttributes((current) => ({ ...current, calisan_sayisi: value }))
                }
                disabled={busy}
                flex
              />
              <AttrField
                label="Müşteri potansiyeli"
                field="musteri_potansiyeli"
                value={attributes.musteri_potansiyeli ?? ''}
                onChange={(value) =>
                  setAttributes((current) => ({ ...current, musteri_potansiyeli: value }))
                }
                disabled={busy}
                flex
              />
            </View>
          </View>
        ) : null}

        {!showResidential ? (
          <View style={styles.extras}>
            <AttrField
              label="İmar durumu"
              field="imar_durumu"
              value={attributes.imar_durumu ?? ''}
              onChange={(value) => setAttributes((current) => ({ ...current, imar_durumu: value }))}
              disabled={busy}
            />
            <AttrField
              label="Tapu durumu"
              field="tapu_durumu"
              value={attributes.tapu_durumu ?? ''}
              onChange={(value) => setAttributes((current) => ({ ...current, tapu_durumu: value }))}
              disabled={busy}
            />
          </View>
        ) : null}
      </FormSection>

      <FormSection
        title="5. Fotoğraf ve video"
        subtitle="İlk medya kapak olarak seçilir. Dosyalar gerçek depolama alanına yüklenir."
      >
        <View style={styles.mediaGrid}>
          {media.map((item, index) => {
            const isCover = index === coverIndex;
            return (
              <View
                key={item.key}
                style={[
                  styles.mediaTile,
                  { borderColor: isCover ? theme.colors.primaryDeep : theme.colors.border },
                ]}
              >
                {item.mediaType === 'video' ? (
                  <View style={styles.videoTile}>
                    <Ionicons name="videocam" size={22} color="#FFFFFF" />
                    <AppText variant="caption" color="#FFFFFF">
                      Video
                    </AppText>
                  </View>
                ) : (
                  <Image
                    source={{ uri: item.uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                )}
                {isCover ? (
                  <View style={styles.coverBadge}>
                    <AppText variant="caption" color="#FFFFFF" style={styles.coverText}>
                      Kapak
                    </AppText>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Kapak yap"
                  onPress={() => setCoverIndex(index)}
                  style={styles.coverButton}
                >
                  <Ionicons name={isCover ? 'star' : 'star-outline'} size={12} color="#FFFFFF" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Medyayı kaldır"
                  onPress={() => {
                    setMedia((current) => current.filter((_, i) => i !== index));
                    setCoverIndex((current) =>
                      current >= index ? Math.max(0, current - 1) : current,
                    );
                  }}
                  style={styles.removeMedia}
                >
                  <Ionicons name="close" size={12} color="#FFFFFF" />
                </Pressable>
              </View>
            );
          })}
          {media.length < MAX_MEDIA ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Galeriden medya ekle"
                disabled={busy}
                onPress={() => void pickAssets('library', 'all')}
                style={[styles.addTile, { borderColor: theme.colors.borderStrong }]}
              >
                <Ionicons name="images-outline" size={22} color={theme.colors.primaryDeep} />
                <AppText variant="caption" color="textTertiary">
                  Galeri
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Kameradan fotoğraf çek"
                disabled={busy}
                onPress={() => void pickAssets('camera', 'image')}
                style={[styles.addTile, { borderColor: theme.colors.borderStrong }]}
              >
                <Ionicons name="camera-outline" size={22} color={theme.colors.primaryDeep} />
                <AppText variant="caption" color="textTertiary">
                  Kamera
                </AppText>
              </Pressable>
            </>
          ) : null}
        </View>
        <AppText variant="caption" color="textTertiary">
          {media.length}/{MAX_MEDIA} medya · Kapak seçimi yıldızla yapılır.
        </AppText>
      </FormSection>

      <FormSection
        title="6. EİDS / yetki doğrulama"
        subtitle="Resmî entegrasyon olmadan hiçbir ilan doğrulanmış sayılmaz."
      >
        <TextField
          label="EİDS referans numarası (varsa)"
          value={referenceNo}
          onChangeText={setReferenceNo}
          placeholder="Doğrulama referansı"
          maxLength={120}
          editable={!busy}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yetki belgesi fotoğrafı seç"
          onPress={() => void pickDocument()}
          disabled={busy}
          style={[
            styles.documentRow,
            { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
          ]}
        >
          {documentAsset ? (
            <Image
              source={{ uri: documentAsset.uri }}
              style={styles.documentThumb}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.documentIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="document-attach-outline" size={20} color={theme.colors.primaryDeep} />
            </View>
          )}
          <View style={styles.flex}>
            <AppText variant="bodyStrong">
              {documentAsset ? 'Yetki belgesi seçildi' : 'Yetki belgesi / tapu fotoğrafı'}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {ownerType === 'owner'
                ? 'Sahibinden ilanlarda isteğe bağlı; admin doğrulaması için yükleyebilirsin.'
                : 'Danışman ve işletme ilanlarında referans veya belge zorunlu.'}
            </AppText>
          </View>
          {documentAsset ? (
            <IconButton
              name="trash-outline"
              accessibilityLabel="Belgeyi kaldır"
              size={17}
              onPress={() => setDocumentAsset(null)}
            />
          ) : (
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
          )}
        </Pressable>
        <View style={[styles.privacyNote, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Ionicons name="lock-closed-outline" size={16} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Belge yalnızca doğrulama kuyruğunda yetkili moderatörlere gösterilir; ilan galerisinde
            yayınlanmaz. API secret veya kimlik numarası istemciye yazılmaz.
          </AppText>
        </View>
      </FormSection>

      {error ? (
        <View
          style={[
            styles.error,
            { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
          <AppText variant="caption" color="danger" style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : null}

      {stage ? (
        <View style={styles.stageRow}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <AppText variant="caption" color="textSecondary">
            {stage}
          </AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={kind === 'rent' ? 'İlanı oluştur' : 'İlanı oluştur'}
          onPress={() => void save(true)}
          loading={submitting}
          disabled={busy}
        />
        <Button
          label="Taslak olarak kaydet"
          variant="outline"
          onPress={() => void save(false)}
          disabled={busy}
        />
        <AppText variant="caption" color="textTertiary" align="center">
          “İlanı oluştur” ilanı doğrulama kuyruğuna gönderir; EİDS onayı olmadan yayınlanmaz.
        </AppText>
      </View>

      <SelectSheet
        visible={districtOpen}
        title="İlçe seç"
        options={districts.map((item) => item.name)}
        value={district?.name ?? null}
        onClose={() => setDistrictOpen(false)}
        onSelect={(value) => {
          const match = districts.find((item) => item.name === value);
          setDistrictId(match?.id ?? null);
          setNeighborhoodId(null);
          setDistrictOpen(false);
        }}
      />
      <SelectSheet
        visible={neighborhoodOpen}
        title="Mahalle seç"
        options={(district?.neighborhoods ?? []).map((item) => item.name)}
        value={district?.neighborhoods.find((item) => item.id === neighborhoodId)?.name ?? null}
        onClose={() => setNeighborhoodOpen(false)}
        onSelect={(value) => {
          const match = district?.neighborhoods.find((item) => item.name === value);
          setNeighborhoodId(match?.id ?? null);
          setNeighborhoodOpen(false);
        }}
      />
      <SelectSheet
        visible={heatingOpen}
        title="Isıtma türü"
        options={HEATING_OPTIONS.map((item) => item.label)}
        value={HEATING_OPTIONS.find((item) => item.key === heating)?.label ?? null}
        onClose={() => setHeatingOpen(false)}
        onSelect={(value) => {
          const match = HEATING_OPTIONS.find((item) => item.label === value);
          setHeating(match?.key ?? null);
          setHeatingOpen(false);
        }}
      />
      <LocationPickerModal
        visible={locationOpen}
        initial={
          point ??
          (district?.lat && district?.lng ? { lat: district.lat, lng: district.lng } : null)
        }
        title="İlan konumunu belirle"
        onClose={() => setLocationOpen(false)}
        onConfirm={(next) => {
          setPoint(next);
          setLocationOpen(false);
        }}
      />
    </Screen>
  );
}

function FormSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.section,
        { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
      ]}
    >
      <View style={styles.sectionHead}>
        <AppText variant="h3">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" color="textTertiary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Chip({
  label,
  icon,
  active,
  onPress,
  flex = false,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  flex?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={[
        styles.chip,
        flex ? styles.flex : null,
        {
          backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
          borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
        },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={active ? theme.colors.onPrimary : theme.colors.textSecondary}
        />
      ) : null}
      <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function TriChip({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  disabled?: boolean;
}) {
  const next = value == null ? true : value ? false : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value == null ? 'belirtilmedi' : value ? 'var' : 'yok'}`}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={({ pressed }) => [styles.triChip, { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <AppText variant="caption" color="textSecondary">
        {label}: {value == null ? '—' : value ? 'Var' : 'Yok'}
      </AppText>
    </Pressable>
  );
}

function FieldButton({
  label,
  value,
  onPress,
  disabled,
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.fieldButton, { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <View
        style={[
          styles.fieldBox,
          { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
        ]}
      >
        <AppText
          variant="body"
          color={value.includes('seç') || value === 'Seçilmedi' ? 'textTertiary' : 'text'}
          numberOfLines={1}
          style={styles.flex}
        >
          {value}
        </AppText>
        <Ionicons name="chevron-down" size={15} color={theme.colors.textTertiary} />
      </View>
    </Pressable>
  );
}

function AttrField({
  label,
  value,
  onChange,
  disabled,
  flex = false,
}: {
  label: string;
  field: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  flex?: boolean;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={onChange}
      editable={!disabled}
      placeholder="Belirtilmedi"
      maxLength={160}
      containerStyle={flex ? styles.flex : undefined}
    />
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[
        styles.toggle,
        { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      </View>
      <View
        style={[
          styles.switchTrack,
          { backgroundColor: value ? theme.colors.primaryDeep : theme.colors.borderStrong },
        ]}
      >
        <View style={[styles.switchThumb, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

function flattenCategories(categories: RealEstateCategory[]): RealEstateCategory[] {
  const flat: RealEstateCategory[] = [];
  for (const category of categories) {
    if (category.children.length > 0) {
      flat.push(...category.children);
    } else {
      flat.push(category);
    }
  }
  return flat;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  eidsCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    borderRadius: 15,
    marginBottom: 12,
  },
  section: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 14,
    gap: 12,
    marginBottom: 14,
  },
  sectionHead: { gap: 2 },
  kindRow: { flexDirection: 'row', gap: 8 },
  chips: { gap: 7, paddingRight: 12, alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', gap: 9, alignItems: 'flex-end' },
  currencyWrap: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
  ownerRow: { flexDirection: 'row', gap: 7 },
  ownerCard: {
    flex: 1,
    padding: 10,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  mapPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mapPickerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  extras: { gap: 9, padding: 10, borderRadius: 13, backgroundColor: 'rgba(127,137,160,0.06)' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaTile: {
    width: 84,
    height: 84,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    backgroundColor: '#101B3B',
  },
  videoTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: '#101B3B',
  },
  coverBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(9,14,28,0.65)',
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  coverText: { fontSize: 9 },
  coverButton: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  removeMedia: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  addTile: {
    width: 84,
    height: 84,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  documentIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentThumb: { width: 42, height: 42, borderRadius: 10 },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    borderRadius: 12,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 8,
  },
  actions: { gap: 8, paddingBottom: 16 },
  fieldButton: { gap: 6 },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  triChip: {
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,137,160,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  switchTrack: { width: 42, height: 24, borderRadius: 12, padding: 2, justifyContent: 'center' },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
});
