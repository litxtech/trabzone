import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useArchiveRoom,
  useArchiveRoomType,
  usePropertyInventory,
  useSaveRoom,
  useSaveRoomType,
} from '../hooks/use-accommodation';
import type { ManagedRoom, ManagedRoomType } from '../types';
import {
  ROOM_STATUS_OPTIONS,
  formatMoneyCents,
  parseMoneyToCents,
  roomStatusTone,
} from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
  StatusPill,
} from './AccommodationUI';

type Section = 'types' | 'rooms';

type TypeForm = {
  name: string;
  description: string;
  adults: string;
  children: string;
  bed: string;
  size: string;
  view: string;
  basePrice: string;
  balcony: boolean;
  airConditioning: boolean;
  wifi: boolean;
  breakfast: boolean;
  active: boolean;
};

type RoomForm = {
  number: string;
  roomTypeId: string | null;
  floor: string;
  status: ManagedRoom['status'];
  note: string;
  active: boolean;
};

const EMPTY_TYPE: TypeForm = {
  name: '',
  description: '',
  adults: '2',
  children: '0',
  bed: '',
  size: '',
  view: '',
  basePrice: '',
  balcony: false,
  airConditioning: true,
  wifi: true,
  breakfast: false,
  active: true,
};

const EMPTY_ROOM: RoomForm = {
  number: '',
  roomTypeId: null,
  floor: '',
  status: 'clean',
  note: '',
  active: true,
};

export function RoomsManager({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const inventory = usePropertyInventory(propertyId);
  const saveType = useSaveRoomType(propertyId);
  const saveRoom = useSaveRoom(propertyId);
  const archiveType = useArchiveRoomType();
  const archiveRoom = useArchiveRoom();

  const [section, setSection] = useState<Section>('types');
  const [typeOpen, setTypeOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [typeForm, setTypeForm] = useState<TypeForm>(EMPTY_TYPE);
  const [roomForm, setRoomForm] = useState<RoomForm>(EMPTY_ROOM);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archivingType, setArchivingType] = useState<ManagedRoomType | null>(null);
  const [archivingRoom, setArchivingRoom] = useState<ManagedRoom | null>(null);

  const types = inventory.data?.room_types ?? [];
  const rooms = inventory.data?.rooms ?? [];

  const roomsByType = useMemo(() => {
    const map = new Map<string, ManagedRoom[]>();
    for (const room of rooms) {
      const list = map.get(room.room_type_id) ?? [];
      list.push(room);
      map.set(room.room_type_id, list);
    }
    return map;
  }, [rooms]);

  const patchType = <K extends keyof TypeForm>(key: K, value: TypeForm[K]) =>
    setTypeForm((current) => ({ ...current, [key]: value }));
  const patchRoom = <K extends keyof RoomForm>(key: K, value: RoomForm[K]) =>
    setRoomForm((current) => ({ ...current, [key]: value }));

  const openType = (type?: ManagedRoomType) => {
    setError(null);
    setEditingTypeId(type?.id ?? null);
    setTypeForm(
      type
        ? {
            name: type.name,
            description: type.description ?? '',
            adults: String(type.capacity_adults),
            children: String(type.capacity_children),
            bed: type.bed_setup ?? '',
            size: type.size_m2 ? String(type.size_m2) : '',
            view: type.view ?? '',
            basePrice: String(type.base_price_cents / 100),
            balcony: type.balcony,
            airConditioning: type.air_conditioning,
            wifi: type.wifi,
            breakfast: type.breakfast,
            active: type.active,
          }
        : { ...EMPTY_TYPE, basePrice: '' },
    );
    setTypeOpen(true);
  };

  const openRoom = (room?: ManagedRoom) => {
    setError(null);
    setEditingRoomId(room?.id ?? null);
    setRoomForm(
      room
        ? {
            number: room.number,
            roomTypeId: room.room_type_id,
            floor: room.floor ?? '',
            status: room.status,
            note: room.housekeeping_note ?? '',
            active: room.active,
          }
        : { ...EMPTY_ROOM, roomTypeId: types[0]?.id ?? null },
    );
    setRoomOpen(true);
  };

  const submitType = async () => {
    setError(null);
    if (typeForm.name.trim().length < 2) {
      setError('Oda tipi adı en az 2 karakter olmalı.');
      return;
    }
    const adults = Number(typeForm.adults);
    const children = Number(typeForm.children);
    const price = parseMoneyToCents(typeForm.basePrice);
    if (!Number.isFinite(adults) || adults < 1) {
      setError('Yetişkin kapasitesi en az 1 olmalı.');
      return;
    }
    if (!Number.isFinite(children) || children < 0) {
      setError('Çocuk kapasitesi geçerli değil.');
      return;
    }
    if (price === null || price < 0) {
      setError('Baz fiyat geçerli değil.');
      return;
    }
    try {
      await saveType.mutateAsync({
        id: editingTypeId ?? undefined,
        name: typeForm.name.trim(),
        description: typeForm.description.trim() || null,
        capacity_adults: Math.round(adults),
        capacity_children: Math.round(children),
        bed_setup: typeForm.bed.trim() || null,
        size_m2: typeForm.size.trim() ? Number(typeForm.size.replace(',', '.')) : null,
        view: typeForm.view.trim() || null,
        base_price_cents: price,
        balcony: typeForm.balcony,
        air_conditioning: typeForm.airConditioning,
        wifi: typeForm.wifi,
        breakfast: typeForm.breakfast,
        active: typeForm.active,
      });
      setTypeOpen(false);
      void inventory.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Oda tipi kaydedilemedi.');
    }
  };

  const submitRoom = async () => {
    setError(null);
    if (!roomForm.roomTypeId) {
      setError('Oda tipi seçmelisin.');
      return;
    }
    if (roomForm.number.trim().length === 0) {
      setError('Oda numarası gerekli.');
      return;
    }
    try {
      await saveRoom.mutateAsync({
        id: editingRoomId ?? undefined,
        room_type_id: roomForm.roomTypeId,
        number: roomForm.number.trim(),
        floor: roomForm.floor.trim() || null,
        status: roomForm.status,
        housekeeping_note: roomForm.note.trim() || null,
        active: roomForm.active,
      });
      setRoomOpen(false);
      void inventory.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Oda kaydedilemedi.');
    }
  };

  if (inventory.isLoading) return <LoadingBlock height={260} />;
  if (inventory.isError) {
    return (
      <InlineError
        message={inventory.error instanceof Error ? inventory.error.message : 'Oda envanteri yüklenemedi.'}
        onRetry={() => void inventory.refetch()}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Odalar</AppText>
          <AppText variant="caption" color="textTertiary">
            {types.length} oda tipi · {rooms.length} fiziksel oda
          </AppText>
        </View>
        <Button
          label={section === 'types' ? 'Oda tipi ekle' : 'Oda ekle'}
          size="sm"
          fullWidth={false}
          leftIcon={<Ionicons name="add" size={15} color={theme.colors.onPrimary} />}
          disabled={section === 'rooms' && types.length === 0}
          onPress={() => (section === 'types' ? openType() : openRoom())}
        />
      </View>

      <View style={styles.filters}>
        <Chip label="Oda Tipleri" active={section === 'types'} onPress={() => setSection('types')} />
        <Chip label="Fiziksel Odalar" active={section === 'rooms'} onPress={() => setSection('rooms')} />
      </View>

      {error ? <InlineError message={error} /> : null}

      {section === 'types' ? (
        types.length === 0 ? (
          <EmptyState
            icon="bed-outline"
            title="Oda tipi yok"
            message="Standart, deluxe veya süit gibi oda tiplerini oluştur. Her tipin kendi kapasitesi ve baz fiyatı olur."
            compact
          />
        ) : (
          <View style={styles.grid}>
            {types.map((type) => {
              const typeRooms = roomsByType.get(type.id) ?? [];
              return (
                <AccCard key={type.id} padding={12} style={styles.typeCard}>
                  <View style={styles.typeTop}>
                    <View style={[styles.typeIcon, { backgroundColor: theme.colors.primarySoft }]}>
                      <Ionicons name="bed-outline" size={17} color={theme.colors.primary} />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="bodyStrong" numberOfLines={1}>{type.name}</AppText>
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        {type.capacity_adults}+{type.capacity_children} kişi
                        {type.size_m2 ? ` · ${type.size_m2} m²` : ''}
                        {type.view ? ` · ${type.view}` : ''}
                      </AppText>
                    </View>
                    <StatusPill
                      label={type.active ? 'Aktif' : 'Pasif'}
                      color={type.active ? theme.colors.success : theme.colors.textTertiary}
                      background={type.active ? theme.colors.successSoft : theme.colors.surfaceMuted}
                    />
                  </View>
                  <View style={styles.priceRow}>
                    <AppText variant="h3" color="primary">{formatMoneyCents(type.base_price_cents)}</AppText>
                    <AppText variant="caption" color="textTertiary">baz gecelik fiyat</AppText>
                  </View>
                  <View style={styles.features}>
                    {[
                      { label: 'Balkon', active: type.balcony },
                      { label: 'Klima', active: type.air_conditioning },
                      { label: 'Wi-Fi', active: type.wifi },
                      { label: 'Kahvaltı', active: type.breakfast },
                    ].map((feature) => (
                      <View
                        key={feature.label}
                        style={[
                          styles.feature,
                          { backgroundColor: feature.active ? theme.colors.successSoft : theme.colors.surfaceMuted },
                        ]}
                      >
                        <Ionicons
                          name={feature.active ? 'checkmark' : 'close'}
                          size={10}
                          color={feature.active ? theme.colors.success : theme.colors.textTertiary}
                        />
                        <AppText variant="caption" style={[styles.tiny, { color: feature.active ? theme.colors.success : theme.colors.textTertiary }]}>
                          {feature.label}
                        </AppText>
                      </View>
                    ))}
                  </View>
                  <View style={styles.roomSummary}>
                    <Ionicons name="grid-outline" size={12} color={theme.colors.textTertiary} />
                    <AppText variant="caption" color="textTertiary">
                      {type.room_count} fiziksel oda
                      {typeRooms.length > 0 ? ` · ${typeRooms.map((room) => room.number).slice(0, 6).join(', ')}` : ''}
                    </AppText>
                  </View>
                  <View style={[styles.cardFooter, { borderTopColor: theme.colors.divider }]}>
                    <Button label="Düzenle" size="sm" variant="ghost" fullWidth={false} onPress={() => openType(type)} />
                    <Button
                      label="Oda ekle"
                      size="sm"
                      variant="ghost"
                      fullWidth={false}
                      onPress={() => {
                        setSection('rooms');
                        openRoom();
                        setRoomForm((current) => ({ ...current, roomTypeId: type.id }));
                      }}
                    />
                    <Button label="Arşivle" size="sm" variant="ghost" fullWidth={false} onPress={() => setArchivingType(type)} />
                  </View>
                </AccCard>
              );
            })}
          </View>
        )
      ) : rooms.length === 0 ? (
        <EmptyState
          icon="grid-outline"
          title="Fiziksel oda yok"
          message="Oda numaralarını ekleyerek takvim ve kat hizmetleri yönetimini aktifleştir."
          compact
        />
      ) : (
        <View style={styles.roomGrid}>
          {rooms.map((room) => {
            const tone = roomStatusTone(room.status);
            return (
              <AccCard key={room.id} padding={11} style={styles.roomCard}>
                <View style={styles.roomTop}>
                  <View>
                    <AppText variant="h3">{room.number}</AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {room.room_type_name}{room.floor ? ` · ${room.floor}. kat` : ''}
                    </AppText>
                  </View>
                  <StatusPill label={tone.label} color={tone.color} background={tone.background} />
                </View>
                {room.housekeeping_note ? (
                  <AppText variant="caption" color="textTertiary" numberOfLines={2}>{room.housekeeping_note}</AppText>
                ) : null}
                <View style={styles.roomActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Odayı düzenle"
                    onPress={() => openRoom(room)}
                    style={styles.roomAction}
                  >
                    <Ionicons name="create-outline" size={15} color={theme.colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Odayı arşivle"
                    onPress={() => setArchivingRoom(room)}
                    style={styles.roomAction}
                  >
                    <Ionicons name="archive-outline" size={15} color={theme.colors.danger} />
                  </Pressable>
                </View>
              </AccCard>
            );
          })}
        </View>
      )}

      <InfoBanner text="Oda tipi ile fiziksel oda farklı kavramlardır. Aynı oda tipi birden fazla fiyat planıyla satılabilir; ancak aynı fiziksel oda aynı tarihte iki kez satılamaz. Çakışan rezervasyon sunucu tarafında engellenir." />

      <ModalSheet
        visible={typeOpen}
        onClose={() => setTypeOpen(false)}
        title={editingTypeId ? 'Oda tipini düzenle' : 'Yeni oda tipi'}
        maxWidth={560}
        footer={<Button label="Kaydet" loading={saveType.isPending} onPress={() => void submitType()} />}
      >
        <View style={{ gap: 10 }}>
          {error ? <InlineError message={error} /> : null}
          <TextField label="Oda tipi adı" value={typeForm.name} onChangeText={(value) => patchType('name', value)} placeholder="Deluxe Deniz Manzaralı" />
          <TextField label="Açıklama" value={typeForm.description} onChangeText={(value) => patchType('description', value)} multiline numberOfLines={3} />
          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <TextField label="Yetişkin" value={typeForm.adults} onChangeText={(value) => patchType('adults', value.replace(/[^\d]/g, ''))} keyboardType="number-pad" />
            </View>
            <View style={styles.flex}>
              <TextField label="Çocuk" value={typeForm.children} onChangeText={(value) => patchType('children', value.replace(/[^\d]/g, ''))} keyboardType="number-pad" />
            </View>
            <View style={styles.flex}>
              <TextField label="m²" value={typeForm.size} onChangeText={(value) => patchType('size', value.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" />
            </View>
          </View>
          <View style={styles.twoCols}>
            <View style={styles.flex}>
              <TextField label="Yatak düzeni" value={typeForm.bed} onChangeText={(value) => patchType('bed', value)} placeholder="1 çift kişilik" />
            </View>
            <View style={styles.flex}>
              <TextField label="Manzara" value={typeForm.view} onChangeText={(value) => patchType('view', value)} placeholder="Deniz" />
            </View>
          </View>
          <TextField
            label="Baz gecelik fiyat (₺)"
            value={typeForm.basePrice}
            onChangeText={(value) => patchType('basePrice', value.replace(/[^\d.,]/g, ''))}
            keyboardType="decimal-pad"
          />
          <View style={styles.chips}>
            {(
              [
                { key: 'balcony', label: 'Balkon' },
                { key: 'airConditioning', label: 'Klima' },
                { key: 'wifi', label: 'Wi-Fi' },
                { key: 'breakfast', label: 'Kahvaltı' },
                { key: 'active', label: 'Aktif' },
              ] as { key: 'balcony' | 'airConditioning' | 'wifi' | 'breakfast' | 'active'; label: string }[]
            ).map((entry) => (
              <Chip
                key={entry.key}
                label={entry.label}
                active={typeForm[entry.key]}
                onPress={() => patchType(entry.key, !typeForm[entry.key])}
              />
            ))}
          </View>
        </View>
      </ModalSheet>

      <ModalSheet
        visible={roomOpen}
        onClose={() => setRoomOpen(false)}
        title={editingRoomId ? 'Odayı düzenle' : 'Yeni fiziksel oda'}
        maxWidth={520}
        footer={<Button label="Kaydet" loading={saveRoom.isPending} onPress={() => void submitRoom()} />}
      >
        <View style={{ gap: 10 }}>
          {error ? <InlineError message={error} /> : null}
          <TextField label="Oda numarası" value={roomForm.number} onChangeText={(value) => patchRoom('number', value)} placeholder="101" />
          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Oda tipi</AppText>
            <View style={styles.chips}>
              {types.map((type) => (
                <Chip
                  key={type.id}
                  label={type.name}
                  active={roomForm.roomTypeId === type.id}
                  onPress={() => patchRoom('roomTypeId', type.id)}
                />
              ))}
            </View>
          </View>
          <TextField label="Kat" value={roomForm.floor} onChangeText={(value) => patchRoom('floor', value)} placeholder="1" />
          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Oda durumu</AppText>
            <View style={styles.chips}>
              {ROOM_STATUS_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  active={roomForm.status === option.value}
                  onPress={() => patchRoom('status', option.value)}
                />
              ))}
            </View>
          </View>
          <TextField label="Kat hizmetleri notu" value={roomForm.note} onChangeText={(value) => patchRoom('note', value)} multiline numberOfLines={2} />
          <Chip label="Aktif" active={roomForm.active} onPress={() => patchRoom('active', !roomForm.active)} />
        </View>
      </ModalSheet>

      <ModalSheet
        visible={Boolean(archivingType)}
        onClose={() => setArchivingType(null)}
        title="Oda tipini arşivle"
        subtitle={archivingType?.name}
        maxWidth={420}
        footer={
          <View style={styles.modalFooter}>
            <Button label="Vazgeç" variant="ghost" fullWidth={false} onPress={() => setArchivingType(null)} />
            <Button
              label="Arşivle"
              variant="danger"
              fullWidth={false}
              loading={archiveType.isPending}
              onPress={async () => {
                if (!archivingType) return;
                try {
                  await archiveType.mutateAsync(archivingType.id);
                  setArchivingType(null);
                  void inventory.refetch();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Oda tipi arşivlenemedi.');
                }
              }}
            />
          </View>
        }
      >
        <AppText variant="body" color="textSecondary">
          Oda tipi satıştan kaldırılır. Mevcut rezervasyonlar ve fiziksel odalar korunur. Geçmiş kayıtlar denetim amacıyla saklanır.
        </AppText>
      </ModalSheet>

      <ModalSheet
        visible={Boolean(archivingRoom)}
        onClose={() => setArchivingRoom(null)}
        title="Odayı arşivle"
        subtitle={archivingRoom ? `Oda ${archivingRoom.number}` : undefined}
        maxWidth={420}
        footer={
          <View style={styles.modalFooter}>
            <Button label="Vazgeç" variant="ghost" fullWidth={false} onPress={() => setArchivingRoom(null)} />
            <Button
              label="Arşivle"
              variant="danger"
              fullWidth={false}
              loading={archiveRoom.isPending}
              onPress={async () => {
                if (!archivingRoom) return;
                try {
                  await archiveRoom.mutateAsync(archivingRoom.id);
                  setArchivingRoom(null);
                  void inventory.refetch();
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : 'Oda arşivlenemedi.');
                }
              }}
            />
          </View>
        }
      >
        <AppText variant="body" color="textSecondary">
          Oda yeni satışlara kapatılır. Geçmiş rezervasyonlar ve finansal kayıtlar etkilenmez.
        </AppText>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  filters: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeCard: { width: '32%', minWidth: 270, flexGrow: 1, gap: 6 },
  typeTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  features: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  tiny: { fontSize: 9 },
  roomSummary: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  cardFooter: { flexDirection: 'row', gap: 2, paddingTop: 6, marginTop: 2, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  roomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  roomCard: { width: '19%', minWidth: 150, flexGrow: 1, gap: 5 },
  roomTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 },
  roomActions: { flexDirection: 'row', gap: 4, justifyContent: 'flex-end' },
  roomAction: { padding: 4, borderRadius: 6 },
  twoCols: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  fieldLabel: { marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
