import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import * as api from '@/features/explore/services/explore-service';
import { useAdminExploreMutation, useExploreBootstrap } from '@/features/explore/hooks/use-explore';
import type { AdminPlaceDetail, LatLng } from '@/features/explore/types';
import { TRABZON_BOUNDS } from '@/features/explore/utils/geo';
import { LocationPickerModal } from '@/features/explore/components/LocationPickerModal';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminDetailModal, DetailField } from './AdminExploreShared';
import {
  formatCoordinate,
  PLACE_STATUS_LABELS,
  VERIFICATION_LABELS,
} from './labels';

type Props = {
  visible: boolean;
  initial?: AdminPlaceDetail | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
};

const PLACE_STATUS_OPTIONS = ['draft', 'pending', 'published', 'rejected', 'archived', 'duplicate'];
const VERIFICATION_OPTIONS = ['unverified', 'pending', 'verified', 'rejected'];

function statusOptionLabel(value: string) {
  return PLACE_STATUS_LABELS[value] ?? value;
}

function verificationOptionLabel(value: string) {
  return VERIFICATION_LABELS[value] ?? value;
}

export function PlaceEditorModal({ visible, initial, canManage, onClose, onSaved }: Props) {
  const { theme } = useTheme();
  const bootstrap = useExploreBootstrap();
  const upsert = useAdminExploreMutation((payload: Record<string, unknown>) =>
    api.adminUpsertPlace(payload),
  );

  const [name, setName] = useState('');
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [neighborhoodId, setNeighborhoodId] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [addressPublic, setAddressPublic] = useState(true);
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('published');
  const [verification, setVerification] = useState('unverified');
  const [point, setPoint] = useState<LatLng | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [districtOpen, setDistrictOpen] = useState(false);
  const [neighborhoodOpen, setNeighborhoodOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const district = bootstrap.data?.districts.find((item) => item.id === districtId) ?? null;

  const categories = useMemo(() => {
    const roots = bootstrap.data?.place_categories ?? [];
    return roots.flatMap((root) => [root, ...(root.children ?? [])]);
  }, [bootstrap.data?.place_categories]);

  const category = categories.find((item) => item.slug === categorySlug) ?? null;
  const neighborhood = district?.neighborhoods.find((item) => item.id === neighborhoodId) ?? null;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!visible) return;
    setName(initial?.name ?? '');
    setCategorySlug(initial?.category?.slug ?? null);
    setDistrictId(initial?.district_id ?? null);
    setNeighborhoodId(initial?.neighborhood_id ?? null);
    setAddress(initial?.address ?? '');
    setAddressPublic(initial?.address_public ?? true);
    setPhone(initial?.phone ?? '');
    setWebsite(initial?.website ?? '');
    setDescription(initial?.description ?? '');
    setStatus(initial?.status ?? 'published');
    setVerification(initial?.verification_status ?? 'unverified');
    setPoint(
      initial && Number.isFinite(initial.lat) && Number.isFinite(initial.lng)
        ? { lat: initial.lat, lng: initial.lng }
        : null,
    );
    setError(null);
  }, [visible, initial]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = () => {
    if (!canManage) {
      setError('İşletme kaydetmek için map.manage izni gerekir.');
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError('İşletme adı en az 2 karakter olmalı.');
      return;
    }
    if (!district) {
      setError('İlçe seçmelisin.');
      return;
    }
    if (!point) {
      setError('Haritadan bir konum seçmelisin.');
      return;
    }
    if (
      point.lat < TRABZON_BOUNDS.south ||
      point.lat > TRABZON_BOUNDS.north ||
      point.lng < TRABZON_BOUNDS.west ||
      point.lng > TRABZON_BOUNDS.east
    ) {
      setError('Seçilen konum Trabzon hizmet sınırları dışında.');
      return;
    }

    setError(null);
    const payload: Record<string, unknown> = {
      name: trimmedName,
      category_slug: categorySlug,
      district_id: district.id,
      neighborhood_id: neighborhoodId,
      address: address.trim() || null,
      address_public: addressPublic,
      lat: point.lat,
      lng: point.lng,
      phone: phone.trim() || null,
      website: website.trim() || null,
      description: description.trim() || null,
      status,
      verification_status: verification,
    };
    if (initial?.id) {
      payload.id = initial.id;
    }

    upsert.mutate(payload, {
      onSuccess: () => {
        onSaved(initial?.id ? 'İşletme güncellendi ve denetim kaydı oluşturuldu.' : 'Yeni işletme kaydedildi.');
        onClose();
      },
      onError: (cause) => setError(cause.message),
    });
  };

  return (
    <>
      <AdminDetailModal
        visible={visible}
        title={initial ? 'İşletmeyi düzenle' : 'Haritaya işletme ekle'}
        subtitle="Konum Trabzon hizmet sınırı içinde olmalıdır. Kaydetme işlemi denetim kaydına yazılır."
        onClose={onClose}
        maxWidth={700}
        footer={
          <>
            <Button
              label="Vazgeç"
              size="sm"
              variant="secondary"
              fullWidth={false}
              onPress={onClose}
            />
            <Button
              label={initial ? 'Değişiklikleri kaydet' : 'İşletmeyi oluştur'}
              size="sm"
              fullWidth={false}
              loading={upsert.isPending}
              disabled={!canManage}
              onPress={submit}
            />
          </>
        }
      >
        <TextField
          label="İşletme adı"
          value={name}
          onChangeText={setName}
          placeholder="Örn. Trabzon Meydan Kahvecisi"
          maxLength={140}
        />

        <View style={styles.grid}>
          <SelectField
            label="Kategori"
            value={category?.name ?? 'Kategori seç'}
            onPress={() => setCategoryOpen(true)}
          />
          <SelectField
            label="İlçe"
            value={district?.name ?? 'İlçe seç'}
            onPress={() => setDistrictOpen(true)}
          />
          <SelectField
            label="Mahalle"
            value={neighborhood?.name ?? 'Mahalle seç (isteğe bağlı)'}
            onPress={() => setNeighborhoodOpen(true)}
            disabled={!district}
          />
        </View>

        <TextField
          label="Adres"
          value={address}
          onChangeText={setAddress}
          placeholder="Sokak, cadde, no"
          maxLength={320}
        />

        <View style={[styles.switchRow, { borderColor: theme.colors.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">Açık adres herkese gösterilsin</AppText>
            <AppText variant="caption" color="textTertiary">
              Kapatıldığında yalnızca ilçe/mahalle ve yaklaşık konum gösterilir.
            </AppText>
          </View>
          <Switch
            value={addressPublic}
            onValueChange={setAddressPublic}
            trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
            thumbColor={theme.colors.surface}
          />
        </View>

        <View style={styles.grid}>
          <TextField
            label="Telefon"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+90…"
          />
          <TextField
            label="Web sitesi"
            value={website}
            onChangeText={setWebsite}
            autoCapitalize="none"
            placeholder="https://…"
          />
        </View>

        <TextField
          label="Açıklama"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={2000}
          placeholder="İşletmenin kısa açıklaması"
        />

        <View style={[styles.locationBox, { borderColor: theme.colors.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">Harita konumu</AppText>
            <AppText variant="caption" color="textTertiary">
              {point
                ? `${formatCoordinate(point.lat)}, ${formatCoordinate(point.lng)}`
                : 'Konum seçilmedi. Kaydetmek için zorunludur.'}
            </AppText>
          </View>
          <Button
            label={point ? 'Konumu düzelt' : 'Haritadan seç'}
            size="sm"
            variant="secondary"
            fullWidth={false}
            leftIcon={<Ionicons name="map-outline" size={14} color={theme.colors.primaryDeep} />}
            onPress={() => setPickerOpen(true)}
          />
        </View>

        <View style={styles.grid}>
          <SelectField
            label="Yayın durumu"
            value={statusOptionLabel(status)}
            onPress={() => setStatusOpen(true)}
          />
          <SelectField
            label="Doğrulama durumu"
            value={verificationOptionLabel(verification)}
            onPress={() => setVerificationOpen(true)}
          />
        </View>

        <View style={styles.notice}>
          <Badge label="Yasal not" tone="warning" />
          <AppText variant="caption" color="textTertiary" style={{ flex: 1 }}>
            Doğrulanmış işletme işareti yalnızca gerçek sahiplenme/doğrulama kanıtı incelendikten
            sonra verilmelidir. Bu formdaki doğrulama seçimi denetim kaydına yazılır.
          </AppText>
        </View>

        {!canManage ? (
          <AppText variant="caption" color="danger">
            Salt görüntüleme: kaydetmek için map.manage izni gerekir.
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        ) : null}
      </AdminDetailModal>

      <LocationPickerModal
        visible={pickerOpen}
        initial={point}
        title="İşletme konumunu seç"
        onClose={() => setPickerOpen(false)}
        onConfirm={(next) => {
          setPoint(next);
          setPickerOpen(false);
        }}
      />

      <SelectSheet
        visible={categoryOpen}
        title="Kategori seç"
        options={categories.map((item) => item.name)}
        value={category?.name ?? null}
        onClose={() => setCategoryOpen(false)}
        onSelect={(label) => {
          const selected = categories.find((item) => item.name === label);
          setCategorySlug(selected?.slug ?? null);
          setCategoryOpen(false);
        }}
      />
      <SelectSheet
        visible={districtOpen}
        title="İlçe seç"
        options={(bootstrap.data?.districts ?? []).map((item) => item.name)}
        value={district?.name ?? null}
        onClose={() => setDistrictOpen(false)}
        onSelect={(label) => {
          const selected = bootstrap.data?.districts.find((item) => item.name === label);
          setDistrictId(selected?.id ?? null);
          setNeighborhoodId(null);
          setDistrictOpen(false);
        }}
      />
      <SelectSheet
        visible={neighborhoodOpen}
        title="Mahalle seç"
        options={(district?.neighborhoods ?? []).map((item) => item.name)}
        value={neighborhood?.name ?? null}
        onClose={() => setNeighborhoodOpen(false)}
        onSelect={(label) => {
          const selected = district?.neighborhoods.find((item) => item.name === label);
          setNeighborhoodId(selected?.id ?? null);
          setNeighborhoodOpen(false);
        }}
      />
      <SelectSheet
        visible={statusOpen}
        title="Yayın durumu"
        options={PLACE_STATUS_OPTIONS.map(statusOptionLabel)}
        value={statusOptionLabel(status)}
        onClose={() => setStatusOpen(false)}
        onSelect={(label) => {
          const selected = PLACE_STATUS_OPTIONS.find((item) => statusOptionLabel(item) === label);
          setStatus(selected ?? 'published');
          setStatusOpen(false);
        }}
      />
      <SelectSheet
        visible={verificationOpen}
        title="Doğrulama durumu"
        options={VERIFICATION_OPTIONS.map(verificationOptionLabel)}
        value={verificationOptionLabel(verification)}
        onClose={() => setVerificationOpen(false)}
        onSelect={(label) => {
          const selected = VERIFICATION_OPTIONS.find((item) => verificationOptionLabel(item) === label);
          setVerification(selected ?? 'unverified');
          setVerificationOpen(false);
        }}
      />
    </>
  );
}

function SelectField({
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
    <View style={{ flexGrow: 1, flexBasis: 200, gap: 6, opacity: disabled ? 0.5 : 1 }}>
      <AppText variant="label" color="textSecondary">
        {label}
      </AppText>
      <Button
        label={value}
        variant="outline"
        size="sm"
        fullWidth
        disabled={disabled}
        onPress={onPress}
        rightIcon={<Ionicons name="chevron-down" size={14} color={theme.colors.textTertiary} />}
      />
    </View>
  );
}

export function PlaceFacts({ detail }: { detail: AdminPlaceDetail }) {
  return (
    <View style={styles.factGrid}>
      <DetailField label="Kategori" value={detail.category?.name ?? '—'} />
      <DetailField label="İlçe / mahalle" value={[detail.district, detail.neighborhood].filter(Boolean).join(' / ') || '—'} />
      <DetailField label="Adres" value={detail.address || '—'} />
      <DetailField label="Açık adres" value={detail.address_public ? 'Herkese açık' : 'Gizli'} />
      <DetailField label="Konum" value={`${formatCoordinate(detail.lat)}, ${formatCoordinate(detail.lng)}`} mono />
      <DetailField label="Telefon" value={detail.phone || '—'} mono />
      <DetailField label="Sahip" value={detail.owner ? `@${detail.owner.username}` : 'Sahipsiz'} />
      <DetailField label="Veri kaynağı" value={detail.data_source || '—'} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  locationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
