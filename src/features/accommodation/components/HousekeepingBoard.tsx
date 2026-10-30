import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useCreateHousekeepingTask,
  useHousekeeping,
  useSetRoomStatus,
  useTransitionHousekeepingTask,
} from '../hooks/use-accommodation';
import { uploadAccommodationMedia } from '../services/accommodation-media-service';
import type { HousekeepingRoom, HousekeepingStatus, RoomStatus } from '../types';
import {
  HOUSEKEEPING_STATUS_LABELS,
  ROOM_STATUS_OPTIONS,
  TASK_KIND_LABELS,
  formatDateLong,
  roomStatusTone,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  Chip,
  ChipsRow,
  DateField,
  EmptyState,
  InlineError,
  LoadingBlock,
  ModalSheet,
  StatusPill,
  ToggleRow,
} from './AccommodationUI';

type Filter = 'all' | 'pending' | 'in_progress' | 'done' | 'verified' | 'maintenance';

const TASK_FLOW: Record<HousekeepingStatus, { next: HousekeepingStatus | null; label: string }> = {
  pending: { next: 'in_progress', label: 'Başla' },
  in_progress: { next: 'done', label: 'Tamamla' },
  done: { next: 'verified', label: 'Kontrol et' },
  verified: { next: null, label: 'Tamamlandı' },
};

export function HousekeepingBoard({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [date, setDate] = useState(todayIso);
  const [filter, setFilter] = useState<Filter>('all');
  const [taskRoom, setTaskRoom] = useState<HousekeepingRoom | null>(null);
  const [roomStatusRoom, setRoomStatusRoom] = useState<HousekeepingRoom | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const housekeeping = useHousekeeping(propertyId, date);
  const transition = useTransitionHousekeepingTask();
  const setStatus = useSetRoomStatus();
  const items = housekeeping.data?.items ?? [];

  const counts = {
    all: items.length,
    pending: items.filter((item) => !item.task_status || item.task_status === 'pending').length,
    in_progress: items.filter((item) => item.task_status === 'in_progress').length,
    done: items.filter((item) => item.task_status === 'done').length,
    verified: items.filter((item) => item.task_status === 'verified').length,
    maintenance: items.filter((item) => item.task_kind === 'maintenance' || item.room_status === 'maintenance').length,
  };

  const filtered = items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'maintenance') return item.task_kind === 'maintenance' || item.room_status === 'maintenance';
    return item.task_status === filter || (!item.task_status && filter === 'pending');
  });

  const advance = async (room: HousekeepingRoom) => {
    if (!room.task_id || !room.task_status) return;
    const next = TASK_FLOW[room.task_status].next;
    if (!next) return;
    setBusy(room.task_id);
    setError(null);
    try {
      await transition.mutateAsync({ taskId: room.task_id, status: next });
      await housekeeping.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Görev güncellenemedi.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Kat hizmetleri</AppText>
          <AppText variant="caption" color="textTertiary">
            {formatDateLong(date)} · temizlik, kontrol ve bakım görevleri
          </AppText>
        </View>
        <View style={styles.dateBox}>
          <DateField label="Tarih" value={date} onChange={setDate} />
        </View>
      </View>

      <View style={styles.counters}>
        {[
          { label: 'Bekleyen', value: counts.pending, color: theme.colors.warning, filter: 'pending' as Filter },
          { label: 'Temizlikte', value: counts.in_progress, color: theme.colors.info, filter: 'in_progress' as Filter },
          { label: 'Kontrol', value: counts.done, color: theme.colors.accent, filter: 'done' as Filter },
          { label: 'Tamam', value: counts.verified, color: theme.colors.success, filter: 'verified' as Filter },
          { label: 'Bakım', value: counts.maintenance, color: theme.colors.danger, filter: 'maintenance' as Filter },
        ].map((counter) => (
          <Pressable
            key={counter.label}
            accessibilityRole="button"
            accessibilityLabel={`${counter.label}: ${counter.value}`}
            onPress={() => setFilter(counter.filter)}
            style={[
              styles.counter,
              {
                backgroundColor: filter === counter.filter ? `${counter.color}1A` : theme.colors.surface,
                borderColor: filter === counter.filter ? counter.color : theme.colors.border,
              },
            ]}
          >
            <View style={[styles.counterDot, { backgroundColor: counter.color }]} />
            <AppText variant="h3" style={styles.counterValue}>
              {counter.value}
            </AppText>
            <AppText variant="caption" color="textTertiary" style={styles.counterLabel}>
              {counter.label}
            </AppText>
          </Pressable>
        ))}
      </View>

      <ChipsRow>
        <Chip label="Tümü" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Temizlik bekleyen" active={filter === 'pending'} onPress={() => setFilter('pending')} />
        <Chip label="Temizlikte" active={filter === 'in_progress'} onPress={() => setFilter('in_progress')} />
        <Chip label="Kontrol bekleyen" active={filter === 'done'} onPress={() => setFilter('done')} />
        <Chip label="Tamamlanan" active={filter === 'verified'} onPress={() => setFilter('verified')} />
        <Chip label="Bakım" active={filter === 'maintenance'} onPress={() => setFilter('maintenance')} />
      </ChipsRow>

      {error ? <InlineError message={error} /> : null}

      {housekeeping.isLoading ? (
        <LoadingBlock height={160} />
      ) : housekeeping.isError ? (
        <InlineError
          message={housekeeping.error instanceof Error ? housekeeping.error.message : 'Kat hizmetleri yüklenemedi.'}
          onRetry={() => void housekeeping.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="sparkles-outline" title="Görev yok" message="Seçilen filtrede oda veya görev bulunmuyor." />
      ) : (
        <View style={styles.grid}>
          {filtered.map((room) => (
            <RoomTaskCard
              key={room.room_id}
              room={room}
              busy={busy === room.task_id}
              onAdvance={() => void advance(room)}
              onCreateTask={() => setTaskRoom(room)}
              onChangeStatus={() => setRoomStatusRoom(room)}
            />
          ))}
        </View>
      )}

      <TaskModal
        room={taskRoom}
        propertyId={propertyId}
        staff={housekeeping.data?.staff ?? []}
        onClose={() => setTaskRoom(null)}
        onSaved={() => {
          setTaskRoom(null);
          void housekeeping.refetch();
        }}
      />

      <RoomStatusModal
        room={roomStatusRoom}
        onClose={() => setRoomStatusRoom(null)}
        onSave={async (status) => {
          if (!roomStatusRoom) return;
          await setStatus.mutateAsync({ roomId: roomStatusRoom.room_id, status });
          setRoomStatusRoom(null);
          void housekeeping.refetch();
        }}
        loading={setStatus.isPending}
      />
    </View>
  );
}

function RoomTaskCard({
  room,
  busy,
  onAdvance,
  onCreateTask,
  onChangeStatus,
}: {
  room: HousekeepingRoom;
  busy: boolean;
  onAdvance: () => void;
  onCreateTask: () => void;
  onChangeStatus: () => void;
}) {
  const { theme } = useTheme();
  const roomTone = roomStatusTone(room.room_status);
  const taskStatus = room.task_status;
  const flow = taskStatus ? TASK_FLOW[taskStatus] : null;

  return (
    <AccCard padding={11} style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.roomBadge, { backgroundColor: roomTone.background, borderColor: roomTone.border }]}>
          <AppText variant="bodyStrong" style={{ color: roomTone.color }}>
            {room.number}
          </AppText>
        </View>
        <View style={styles.flex}>
          <AppText variant="caption" color="text" numberOfLines={1}>
            {room.room_type_name}
          </AppText>
          <AppText variant="caption" color="textTertiary" style={styles.tiny}>
            {room.floor ? `${room.floor}. kat · ` : ''}
            {roomTone.label}
          </AppText>
        </View>
        {room.arrival_today ? (
          <StatusPill
            label="Bugün giriş"
            icon="log-in-outline"
            color={theme.colors.primaryDeep}
            background={theme.colors.primarySoft}
          />
        ) : null}
      </View>

      {room.departure_today ? (
        <AppText variant="caption" color="warning">
          Bugün çıkış yapacak misafir var
        </AppText>
      ) : null}

      {room.task_id ? (
        <View style={styles.taskBlock}>
          <View style={styles.taskRow}>
            <StatusPill
              label={`${TASK_KIND_LABELS[room.task_kind ?? 'cleaning']} · ${
                room.task_status ? HOUSEKEEPING_STATUS_LABELS[room.task_status] : 'Bekliyor'
              }`}
              icon="sparkles-outline"
              color={theme.colors.textSecondary}
              background={theme.colors.surfaceMuted}
            />
            {room.assigned_name ? (
              <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
                {room.assigned_name}
              </AppText>
            ) : null}
          </View>
          {room.task_note ? (
            <AppText variant="caption" color="textSecondary" numberOfLines={2}>
              {room.task_note}
            </AppText>
          ) : null}
          {room.task_due_date ? (
            <AppText variant="caption" color="textTertiary">
              Bitiş: {room.task_due_date}
            </AppText>
          ) : null}
        </View>
      ) : (
        <AppText variant="caption" color="textTertiary">
          Açık görev yok.
        </AppText>
      )}

      {room.note ? (
        <AppText variant="caption" color="textTertiary" numberOfLines={2}>
          Not: {room.note}
        </AppText>
      ) : null}

      <View style={styles.cardActions}>
        <Button label="Oda durumu" variant="ghost" size="sm" fullWidth={false} onPress={onChangeStatus} />
        {flow?.next ? (
          <Button label={flow.label} size="sm" fullWidth={false} loading={busy} onPress={onAdvance} />
        ) : room.task_id ? (
          <StatusPill label="Görev tamam" color={theme.colors.success} background={theme.colors.successSoft} />
        ) : (
          <Button label="Görev ata" size="sm" fullWidth={false} onPress={onCreateTask} />
        )}
      </View>
    </AccCard>
  );
}

function TaskModal({
  room,
  propertyId,
  staff,
  onClose,
  onSaved,
}: {
  room: HousekeepingRoom | null;
  propertyId: string;
  staff: { user_id: string; name: string; role: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { theme } = useTheme();
  const create = useCreateHousekeepingTask(propertyId);
  const [kind, setKind] = useState<'cleaning' | 'maintenance' | 'inspection'>('cleaning');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState(todayIso());
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const save = async () => {
    if (!room) return;
    setSaving(true);
    setError(null);
    try {
      let photoPath: string | null = null;
      if (photoUri) {
        const uploaded = await uploadAccommodationMedia({
          propertyId,
          uri: photoUri,
          name: `kat-hizmetleri-${room.number}-${Date.now()}.jpg`,
          mime: 'image/jpeg',
          kind: 'image',
        });
        if (!uploaded.ok) {
          setError(uploaded.error.message);
          return;
        }
        photoPath = uploaded.data.path;
      }
      await create.mutateAsync({
        roomId: room.room_id,
        kind,
        assignedTo,
        note: note.trim() || null,
        dueDate,
        photoPath,
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Görev oluşturulamadı.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet
      visible={Boolean(room)}
      onClose={onClose}
      title={room ? `${room.number} · görev oluştur` : 'Görev oluştur'}
      subtitle={room ? room.room_type_name : undefined}
      maxWidth={560}
      footer={<Button label="Görevi oluştur" loading={saving} onPress={() => void save()} />}
    >
      <View style={{ gap: 10 }}>
        <ChipsRow>
          {(['cleaning', 'maintenance', 'inspection'] as const).map((value) => (
            <Chip
              key={value}
              label={TASK_KIND_LABELS[value]}
              active={kind === value}
              onPress={() => setKind(value)}
            />
          ))}
        </ChipsRow>
        <TextField label="Görev notu" value={note} onChangeText={setNote} placeholder="Temizlik kapsamı, arıza vb." multiline />
        <DateField label="Bitiş tarihi" value={dueDate} onChange={setDueDate} />
        <AppText variant="label" color="textSecondary">
          Personel ataması
        </AppText>
        <ChipsRow>
          <Chip label="Atanmadı" active={!assignedTo} onPress={() => setAssignedTo(null)} />
          {staff.map((member) => (
            <Chip
              key={member.user_id}
              label={member.name}
              active={assignedTo === member.user_id}
              onPress={() => setAssignedTo(member.user_id)}
            />
          ))}
        </ChipsRow>
        <Button
          label={photoUri ? 'Fotoğrafı değiştir' : 'Fotoğraf ekle (opsiyonel)'}
          variant="outline"
          onPress={() => void pickPhoto()}
        />
        {photoUri ? (
          <AppText variant="caption" color="success">
            Fotoğraf seçildi, görevle birlikte yüklenecek.
          </AppText>
        ) : null}
        {error ? <InlineError message={error} /> : null}
        <AppText variant="caption" color="textTertiary">
          Görev tamamlandığında oda otomatik olarak temiz sayılmaz; kontrol adımı kat hizmetleri tarafından onaylanmalıdır.
        </AppText>
        <View style={[styles.hintRow, { backgroundColor: theme.colors.surfaceMuted }]}>
          <Ionicons name="information-circle-outline" size={14} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex}>
            Bakım görevleri ilgili tarihlerde odayı satışa kapatabilir.
          </AppText>
        </View>
      </View>
    </ModalSheet>
  );
}

function RoomStatusModal({
  room,
  onClose,
  onSave,
  loading,
}: {
  room: HousekeepingRoom | null;
  onClose: () => void;
  onSave: (status: RoomStatus) => Promise<void>;
  loading: boolean;
}) {
  const [status, setStatus] = useState<RoomStatus>('clean');
  const [confirmedClean, setConfirmedClean] = useState(false);

  useEffect(() => {
    if (room) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(room.room_status);
      setConfirmedClean(room.room_status === 'clean');
    }
  }, [room]);

  const cleanNeedsConfirmation = status === 'clean' && !confirmedClean;

  return (
    <ModalSheet
      visible={Boolean(room)}
      onClose={onClose}
      title={room ? `${room.number} oda durumu` : 'Oda durumu'}
      maxWidth={520}
      footer={
        <Button
          label="Kaydet"
          loading={loading}
          disabled={cleanNeedsConfirmation}
          onPress={() => void onSave(status)}
        />
      }
    >
      <View style={{ gap: 8 }}>
        <AppText variant="caption" color="textTertiary">
          Oda durumunu değiştirmek operasyon ekranlarına anında yansır. Check-out sonrası oda otomatik temizlenmez; bekleyen temizlik görevi oluşur.
        </AppText>
        <ChipsRow>
          {ROOM_STATUS_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={status === option.value}
              onPress={() => {
                setStatus(option.value);
                setConfirmedClean(option.value !== 'clean');
              }}
            />
          ))}
        </ChipsRow>
        {cleanNeedsConfirmation ? (
          <ToggleRow
            label="Oda gerçekten temiz ve kontrol edildi"
            description="Temiz işaretlemeden önce kat hizmetleri kontrolü gerekir"
            value={confirmedClean}
            onChange={setConfirmedClean}
          />
        ) : null}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' },
  dateBox: { minWidth: 180 },
  counters: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  counter: { flex: 1, minWidth: 82, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 9, gap: 1 },
  counterDot: { width: 6, height: 6, borderRadius: 3 },
  counterValue: { fontSize: 19, lineHeight: 23 },
  counterLabel: { fontSize: 9 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '32.4%', minWidth: 250, gap: 7 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  roomBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, minWidth: 44, alignItems: 'center' },
  tiny: { fontSize: 9 },
  taskBlock: { gap: 3 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  hintRow: { flexDirection: 'row', gap: 6, alignItems: 'center', padding: 8, borderRadius: 8 },
});
