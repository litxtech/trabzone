import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useSession } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAccommodationComplaint,
  useAccommodationComplaints,
  useComplaintAssignees,
  useCreateComplaint,
  useEscalateComplaint,
  useSendComplaintMessage,
  useUpdateComplaint,
} from '../hooks/use-accommodation';
import type {
  Complaint,
  ComplaintCategory,
  ComplaintChannel,
  ComplaintDetail,
  ComplaintPriority,
  ComplaintStatus,
} from '../types';
import {
  COMPLAINT_CATEGORY_ICONS,
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_CATEGORY_OPTIONS,
  COMPLAINT_CHANNEL_LABELS,
  COMPLAINT_PRIORITY_OPTIONS,
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUS_OPTIONS,
  complaintPriorityTone,
  complaintTone,
  durationLabel,
  slaInfo,
} from '../utils/complaints';
import { formatDateTime, relativeTime } from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
  StatTile,
  StatusPill,
} from './AccommodationUI';

type StatusFilter = ComplaintStatus | 'all' | 'active';

const EVENT_LABELS: Record<string, string> = {
  'complaint.created': 'Talep oluşturuldu',
  'complaint.message': 'Mesaj eklendi',
  'complaint.updated': 'Talep güncellendi',
  'complaint.escalated': 'Trabzone desteğine eskale edildi',
  'complaint.rated': 'Misafir memnuniyeti puanlandı',
};

export function ComplaintsCenter({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [priority, setPriority] = useState<ComplaintPriority | 'all'>('all');
  const [category, setCategory] = useState<ComplaintCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const complaints = useAccommodationComplaints(propertyId, {
    status,
    priority: priority === 'all' ? null : priority,
    category: category === 'all' ? null : category,
    query: debounced || null,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = complaints.data?.items ?? [];
  const stats = complaints.data?.stats;
  const activeFilters =
    status !== 'active' || priority !== 'all' || category !== 'all' || debounced.length > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Şikayet ve destek yönetimi</AppText>
          <AppText variant="caption" color="textTertiary">
            Misafir sorunlarını kaydet, SLA ile takip et ve çözüme ulaştır
          </AppText>
        </View>
        <Button
          label="Yeni kayıt"
          size="sm"
          fullWidth={false}
          onPress={() => setCreateOpen(true)}
        />
      </View>

      <View style={styles.stats}>
        <View style={styles.statTile}>
          <StatTile
            label="Açık talep"
            value={String(stats?.active ?? 0)}
            icon="alert-circle-outline"
            tone={stats && stats.active > 0 ? 'warning' : 'default'}
          />
        </View>
        <View style={styles.statTile}>
          <StatTile
            label="Geciken SLA"
            value={String(stats?.overdue ?? 0)}
            icon="timer-outline"
            tone={stats && stats.overdue > 0 ? 'danger' : 'default'}
          />
        </View>
        <View style={styles.statTile}>
          <StatTile
            label="Bugün çözülen"
            value={String(stats?.resolved_today ?? 0)}
            icon="checkmark-done-outline"
            tone="success"
          />
        </View>
        <View style={styles.statTile}>
          <StatTile
            label="Memnuniyet"
            value={
              stats && stats.satisfaction_count > 0
                ? `${Number(stats.satisfaction).toFixed(1)}/5`
                : '—'
            }
            icon="happy-outline"
            tone="success"
          />
        </View>
      </View>

      <View style={[styles.summaryStrip, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
        <SummaryItem label="İlk yanıt" value={durationLabel(stats?.avg_first_response_minutes)} />
        <SummaryItem label="Ortalama çözüm" value={durationLabel(stats?.avg_resolution_minutes)} />
        <SummaryItem label="Atanmamış" value={String(stats?.unassigned ?? 0)} />
        <SummaryItem label="Eskalasyon" value={String(stats?.escalated ?? 0)} />
      </View>

      <View style={styles.filters}>
        {COMPLAINT_STATUS_OPTIONS.map((entry) => (
          <Chip
            key={entry.value}
            label={entry.label}
            active={status === entry.value}
            onPress={() => setStatus(entry.value)}
          />
        ))}
      </View>

      <View style={styles.filters}>
        <Chip label="Tüm öncelikler" active={priority === 'all'} onPress={() => setPriority('all')} />
        {COMPLAINT_PRIORITY_OPTIONS.map((entry) => (
          <Chip
            key={entry.value}
            label={entry.label}
            active={priority === entry.value}
            onPress={() => setPriority(entry.value)}
          />
        ))}
      </View>

      <View style={styles.filters}>
        <Chip label="Tüm kategoriler" active={category === 'all'} onPress={() => setCategory('all')} />
        {COMPLAINT_CATEGORY_OPTIONS.map((entry) => (
          <Chip
            key={entry.value}
            label={entry.label}
            icon={COMPLAINT_CATEGORY_ICONS[entry.value]}
            active={category === entry.value}
            onPress={() => setCategory(entry.value)}
          />
        ))}
      </View>

      <TextField
        placeholder="Talep no, konu, misafir, oda veya telefon ara"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        returnKeyType="search"
      />

      {error ? <InlineError message={error} /> : null}

      {complaints.isLoading ? (
        <LoadingBlock height={240} />
      ) : complaints.isError ? (
        <InlineError
          message={
            complaints.error instanceof Error ? complaints.error.message : 'Talepler yüklenemedi.'
          }
          onRetry={() => void complaints.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title={activeFilters ? 'Filtreye uygun talep yok' : 'Açık talep yok'}
          message={
            activeFilters
              ? 'Filtreleri temizleyerek tüm talepleri görebilirsin.'
              : 'Misafirler uygulama üzerinden sorun bildirdiğinde veya ön bürodan kayıt açtığında talepler burada listelenir.'
          }
          compact
        />
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <ComplaintCard
              key={item.id}
              item={item}
              onPress={() => {
                setError(null);
                setSelectedId(item.id);
              }}
            />
          ))}
        </View>
      )}

      <InfoBanner text="SLA süreleri önceliğe göre hesaplanır: acil 2 saat, yüksek 6 saat, normal 24 saat, düşük 72 saat. Geciken talepler listede öne çıkar ve misafir yanıtları anlık bildirim olarak gönderilir." />

      <ComplaintCreateSheet
        key={createOpen ? 'open' : 'closed'}
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        propertyId={propertyId}
        onCreated={(complaint) => {
          setCreateOpen(false);
          setSelectedId(complaint.id);
          void complaints.refetch();
        }}
      />

      <ComplaintDetailSheet
        key={selectedId ?? 'none'}
        complaintId={selectedId}
        propertyId={propertyId}
        onClose={() => setSelectedId(null)}
      />
    </View>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <AppText variant="caption" color="textTertiary" style={styles.tiny}>{label}</AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

function ComplaintCard({ item, onPress }: { item: Complaint; onPress: () => void }) {
  const { theme } = useTheme();
  const tone = complaintTone(item.status);
  const priorityTone = complaintPriorityTone(item.priority);
  const sla = slaInfo(item.due_at);
  const active = !['resolved', 'closed'].includes(item.status);
  const slaColor = !active ? theme.colors.textTertiary : sla.overdue ? theme.colors.danger : theme.colors.textSecondary;

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <AccCard padding={13} style={styles.card}>
        <View style={styles.cardRow}>
          <View style={[styles.priorityBar, { backgroundColor: priorityTone.color }]} />
          <View style={styles.flex}>
            <View style={styles.cardTop}>
              <AppText variant="caption" color="textTertiary">{item.reference}</AppText>
              <StatusPill label={tone.label} color={tone.color} background={tone.background} border={tone.border} />
              <StatusPill
                label={priorityTone.label}
                color={priorityTone.color}
                background={priorityTone.background}
                border={priorityTone.border}
              />
              {item.unread_count > 0 ? (
                <View style={[styles.unreadDot, { backgroundColor: theme.colors.danger }]}>
                  <AppText variant="caption" style={styles.unreadText}>{item.unread_count}</AppText>
                </View>
              ) : null}
            </View>

            <AppText variant="bodyStrong" numberOfLines={2}>{item.subject}</AppText>

            <View style={styles.metaRow}>
              <Ionicons name={COMPLAINT_CATEGORY_ICONS[item.category]} size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary">
                {COMPLAINT_CATEGORY_LABELS[item.category]}
              </AppText>
              <AppText variant="caption" color="textTertiary">·</AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.flex}>
                {item.guest_name}
                {item.room_number ? ` · Oda ${item.room_number}` : ''}
                {item.reservation_code ? ` · ${item.reservation_code}` : ''}
              </AppText>
            </View>

            <View style={styles.metaRow}>
              <Ionicons name="timer-outline" size={12} color={slaColor} />
              <AppText variant="caption" style={{ color: slaColor }}>{sla.label}</AppText>
              <AppText variant="caption" color="textTertiary">·</AppText>
              <Ionicons name="person-outline" size={12} color={theme.colors.textTertiary} />
              <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.flex}>
                {item.assigned_name ?? 'Atanmamış'}
              </AppText>
              <AppText variant="caption" color="textTertiary">{relativeTime(item.last_activity_at)}</AppText>
            </View>

            {item.last_message ? (
              <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                “{item.last_message}”
              </AppText>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
        </View>
      </AccCard>
    </Pressable>
  );
}

function ComplaintCreateSheet({
  visible,
  onClose,
  propertyId,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: string;
  onCreated: (complaint: ComplaintDetail) => void;
}) {
  const { theme } = useTheme();
  const create = useCreateComplaint(propertyId);
  const assignees = useComplaintAssignees(propertyId, visible);
  const session = useSession();
  const userId = session?.user?.id ?? null;

  const [guestName, setGuestName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [category, setCategory] = useState<ComplaintCategory>('other');
  const [priority, setPriority] = useState<ComplaintPriority>('normal');
  const [channel, setChannel] = useState<ComplaintChannel>('front_desk');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (subject.trim().length < 3) {
      setError('Konu en az 3 karakter olmalı.');
      return;
    }
    if (!description.trim()) {
      setError('Sorun açıklaması zorunlu.');
      return;
    }
    setError(null);
    try {
      const result = await create.mutateAsync({
        guest_name: guestName.trim() || null,
        guest_phone: guestPhone.trim() || null,
        room_number: roomNumber.trim() || null,
        category,
        channel,
        priority,
        subject: subject.trim(),
        description: description.trim(),
        assigned_to: assignedTo,
      });
      onCreated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Talep kaydedilemedi.');
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Yeni şikayet / destek kaydı"
      subtitle="Ön büro, telefon veya misafir bildirimi"
      maxWidth={560}
      footer={<Button label="Talebi oluştur" loading={create.isPending} onPress={() => void submit()} />}
    >
      <View style={styles.form}>
        <InfoBanner text="Misafir uygulamasından gelen talepler otomatik olarak rezervasyon ve oda bilgisiyle eşleşir. Burada telefon veya ön büro üzerinden gelen sorunları kaydedebilirsin." />

        <TextField label="Konu" value={subject} onChangeText={setSubject} placeholder="Örn. Banyoda sıcak su yok" />
        <TextField
          label="Sorun açıklaması"
          value={description}
          onChangeText={setDescription}
          placeholder="Misafirin bildirdiği sorunu ve ilk müdahaleyi yaz"
          multiline
          numberOfLines={4}
        />

        <View>
          <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Kategori</AppText>
          <View style={styles.filters}>
            {COMPLAINT_CATEGORY_OPTIONS.map((entry) => (
              <Chip
                key={entry.value}
                label={entry.label}
                icon={COMPLAINT_CATEGORY_ICONS[entry.value]}
                active={category === entry.value}
                onPress={() => setCategory(entry.value)}
              />
            ))}
          </View>
        </View>

        <View>
          <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Öncelik</AppText>
          <View style={styles.filters}>
            {COMPLAINT_PRIORITY_OPTIONS.map((entry) => (
              <Chip
                key={entry.value}
                label={entry.label}
                active={priority === entry.value}
                onPress={() => setPriority(entry.value)}
              />
            ))}
          </View>
          <AppText variant="caption" color="textTertiary" style={styles.hint}>
            {priority === 'urgent'
              ? 'Acil talepler 2 saat içinde yanıtlanmalı.'
              : priority === 'high'
                ? 'Yüksek öncelikli talepler 6 saat içinde yanıtlanmalı.'
                : priority === 'normal'
                  ? 'Normal talepler 24 saat içinde yanıtlanmalı.'
                  : 'Düşük öncelikli talepler 72 saat içinde yanıtlanmalı.'}
          </AppText>
        </View>

        <View>
          <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Bildirim kanalı</AppText>
          <View style={styles.filters}>
            {(Object.keys(COMPLAINT_CHANNEL_LABELS) as ComplaintChannel[]).map((key) => (
              <Chip
                key={key}
                label={COMPLAINT_CHANNEL_LABELS[key]}
                active={channel === key}
                onPress={() => setChannel(key)}
              />
            ))}
          </View>
        </View>

        <View style={styles.twoCols}>
          <View style={styles.flex}>
            <TextField label="Misafir adı" value={guestName} onChangeText={setGuestName} placeholder="Ad Soyad" />
          </View>
          <View style={styles.flex}>
            <TextField label="Oda" value={roomNumber} onChangeText={setRoomNumber} placeholder="Örn. 204" />
          </View>
        </View>
        <TextField
          label="Telefon (opsiyonel)"
          value={guestPhone}
          onChangeText={setGuestPhone}
          keyboardType="phone-pad"
          placeholder="05xx xxx xx xx"
        />

        <View>
          <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Sorumlu personel</AppText>
          <View style={styles.filters}>
            <Chip label="Atanmamış" active={!assignedTo} onPress={() => setAssignedTo(null)} />
            {userId ? (
              <Chip label="Bana ata" active={assignedTo === userId} onPress={() => setAssignedTo(userId)} />
            ) : null}
            {(assignees.data?.items ?? []).map((entry) => (
              <Chip
                key={entry.user_id}
                label={entry.name}
                active={assignedTo === entry.user_id}
                onPress={() => setAssignedTo(entry.user_id)}
              />
            ))}
          </View>
        </View>

        {error ? <InlineError message={error} /> : null}
        <View style={[styles.quote, { backgroundColor: theme.colors.surfaceMuted }]}>
          <AppText variant="caption" color="textTertiary">
            Kayıt oluşturulduğunda sorumluya ve tesis yöneticilerine bildirim gider; talep numarası ile takip edilir.
          </AppText>
        </View>
      </View>
    </ModalSheet>
  );
}

function ComplaintDetailSheet({
  complaintId,
  propertyId,
  onClose,
}: {
  complaintId: string | null;
  propertyId: string;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const detail = useAccommodationComplaint(complaintId);
  const assignees = useComplaintAssignees(propertyId, Boolean(complaintId));
  const session = useSession();
  const userId = session?.user?.id ?? null;
  const update = useUpdateComplaint();
  const send = useSendComplaintMessage();
  const escalate = useEscalateComplaint();

  const [resolution, setResolution] = useState<string | null>(null);
  const [compensation, setCompensation] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateNote, setEscalateNote] = useState('');

  const data = detail.data;
  const resolutionValue = resolution ?? data?.resolution ?? '';
  const compensationValue =
    compensation ?? (data?.compensation_cents ? String(data.compensation_cents) : '');

  const patch = async (payload: Record<string, unknown>) => {
    if (!data) return;
    setError(null);
    try {
      await update.mutateAsync({ complaintId: data.id, patch: payload });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Talep güncellenemedi.');
    }
  };

  const changeStatus = async (status: ComplaintStatus) => {
    if (!data) return;
    if (status === 'resolved' || status === 'closed') {
      if (!resolutionValue.trim()) {
        setError('Çözüme ulaşmak için çözüm notu yazmalısın.');
        return;
      }
      await patch({
        status,
        resolution: resolutionValue.trim(),
        compensation_cents: parseCompensation(compensationValue),
      });
      return;
    }
    await patch({ status });
  };

  const saveResolution = async () => {
    if (!data) return;
    setError(null);
    try {
      await update.mutateAsync({
        complaintId: data.id,
        patch: {
          resolution: resolutionValue.trim() || null,
          compensation_cents: parseCompensation(compensationValue),
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Çözüm kaydedilemedi.');
    }
  };

  const sendMessage = async () => {
    if (!data) return;
    if (!body.trim()) {
      setError('Mesaj boş olamaz.');
      return;
    }
    setError(null);
    try {
      await send.mutateAsync({ complaintId: data.id, body: body.trim(), internal });
      setBody('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mesaj gönderilemedi.');
    }
  };

  const submitEscalation = async () => {
    if (!data) return;
    setError(null);
    try {
      await escalate.mutateAsync({ complaintId: data.id, note: escalateNote.trim() || null });
      setEscalateOpen(false);
      setEscalateNote('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Eskalasyon yapılamadı.');
    }
  };

  const tone = data ? complaintTone(data.status) : null;
  const priorityTone = data ? complaintPriorityTone(data.priority) : null;
  const sla = data ? slaInfo(data.due_at) : null;

  return (
    <ModalSheet
      visible={Boolean(complaintId)}
      onClose={onClose}
      title={data ? `${data.reference} · ${COMPLAINT_CATEGORY_LABELS[data.category]}` : 'Şikayet detayı'}
      subtitle={data ? `${data.guest_name}${data.room_number ? ` · Oda ${data.room_number}` : ''}` : undefined}
      maxWidth={720}
      footer={
        data && data.can_manage ? (
          <View style={styles.footerRow}>
            <Button
              label="Çözümü kaydet"
              variant="outline"
              size="sm"
              fullWidth={false}
              loading={update.isPending}
              onPress={() => void saveResolution()}
              style={styles.flex}
            />
            <Button
              label={escalateOpen ? 'Eskalasyonu kapat' : 'Eskale et'}
              variant="ghost"
              size="sm"
              fullWidth={false}
              onPress={() => setEscalateOpen((current) => !current)}
              style={styles.flex}
            />
          </View>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <LoadingBlock height={240} />
      ) : detail.isError || !data || !tone || !priorityTone || !sla ? (
        <InlineError
          message={detail.error instanceof Error ? detail.error.message : 'Talep detayı yüklenemedi.'}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <View style={styles.detailWrap}>
          <View style={styles.detailTop}>
            <StatusPill label={tone.label} color={tone.color} background={tone.background} border={tone.border} />
            <StatusPill
              label={priorityTone.label}
              color={priorityTone.color}
              background={priorityTone.background}
              border={priorityTone.border}
            />
            {!['resolved', 'closed'].includes(data.status) ? (
              <View
                style={[
                  styles.slaPill,
                  {
                    backgroundColor: sla.overdue ? theme.colors.dangerSoft : theme.colors.surfaceMuted,
                    borderColor: sla.overdue ? theme.colors.danger : theme.colors.border,
                  },
                ]}
              >
                <Ionicons name="timer-outline" size={12} color={sla.overdue ? theme.colors.danger : theme.colors.textSecondary} />
                <AppText variant="caption" style={{ color: sla.overdue ? theme.colors.danger : theme.colors.textSecondary }}>
                  {sla.label}
                </AppText>
              </View>
            ) : null}
          </View>

          <View>
            <AppText variant="h3">{data.subject}</AppText>
            <AppText variant="body" color="textSecondary" style={styles.description}>{data.description}</AppText>
          </View>

          <View style={[styles.infoGrid, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
            <InfoCell label="Kanal" value={COMPLAINT_CHANNEL_LABELS[data.channel]} />
            <InfoCell label="Oluşturma" value={formatDateTime(data.created_at)} />
            <InfoCell label="Rezervasyon" value={data.reservation_code ?? 'Bağlı değil'} />
            <InfoCell label="Telefon" value={data.guest_phone ?? '—'} />
            <InfoCell label="İlk yanıt" value={data.first_response_at ? formatDateTime(data.first_response_at) : 'Bekliyor'} />
            <InfoCell label="Sorumlu" value={data.assigned_name ?? 'Atanmamış'} />
          </View>

          {data.can_manage ? (
            <>
              <View>
                <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Durum</AppText>
                <View style={styles.filters}>
                  {COMPLAINT_STATUS_OPTIONS.filter((entry) => entry.value !== 'all' && entry.value !== 'active').map((entry) => (
                    <Chip
                      key={entry.value}
                      label={entry.label}
                      active={data.status === entry.value}
                      onPress={() => void changeStatus(entry.value as ComplaintStatus)}
                    />
                  ))}
                </View>
              </View>

              <View>
                <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Öncelik</AppText>
                <View style={styles.filters}>
                  {COMPLAINT_PRIORITY_OPTIONS.map((entry) => (
                    <Chip
                      key={entry.value}
                      label={entry.label}
                      active={data.priority === entry.value}
                      onPress={() => void patch({ priority: entry.value })}
                    />
                  ))}
                </View>
              </View>

              <View>
                <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Sorumlu personel</AppText>
                <View style={styles.filters}>
                  <Chip
                    label="Atanmamış"
                    active={!data.assigned_to}
                    onPress={() => void patch({ assigned_to: null })}
                  />
                  {userId && userId !== data.assigned_to ? (
                    <Chip label="Bana ata" active={false} onPress={() => void patch({ assigned_to: userId })} />
                  ) : null}
                  {(assignees.data?.items ?? []).map((entry) => (
                    <Chip
                      key={entry.user_id}
                      label={entry.name}
                      active={data.assigned_to === entry.user_id}
                      onPress={() => void patch({ assigned_to: entry.user_id })}
                    />
                  ))}
                </View>
              </View>

              <View style={styles.twoCols}>
                <View style={styles.flex}>
                  <TextField
                    label="Çözüm notu"
                    value={resolutionValue}
                    onChangeText={setResolution}
                    placeholder="Sorunun nasıl çözüldüğünü yaz"
                    multiline
                    numberOfLines={3}
                  />
                </View>
                <View style={styles.compensationField}>
                  <TextField
                    label="Tazminat (kuruş)"
                    value={compensationValue}
                    onChangeText={setCompensation}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                  <AppText variant="caption" color="textTertiary" style={styles.hint}>
                    {compensationValue
                      ? `${(parseCompensation(compensationValue) / 100).toFixed(2)} ₺`
                      : 'Tazminat yok'}
                  </AppText>
                </View>
              </View>
            </>
          ) : data.resolution ? (
            <View style={[styles.quote, { backgroundColor: theme.colors.successSoft }]}>
              <AppText variant="caption" color="textSecondary">Çözüm: {data.resolution}</AppText>
            </View>
          ) : null}

          {escalateOpen ? (
            <View style={[styles.escalateBox, { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft }]}>
              <AppText variant="bodyStrong" color="danger">Trabzone desteğine eskalasyon</AppText>
              <AppText variant="caption" color="textSecondary">
                Talep acil önceliğe yükseltilir, tesis sahibi ve Trabzone yöneticileri bilgilendirilir. Arabuluculuk gerektiren uyuşmazlıklar için kullan.
              </AppText>
              <TextField
                label="Eskalasyon notu"
                value={escalateNote}
                onChangeText={setEscalateNote}
                placeholder="Misafir beklentisi veya tesisin yanıtı"
                multiline
              />
              <Button
                label="Eskalasyonu gönder"
                variant="danger"
                size="sm"
                loading={escalate.isPending}
                onPress={() => void submitEscalation()}
              />
            </View>
          ) : null}

          <View style={[styles.threadHead, { borderTopColor: theme.colors.divider }]}>
            <AppText variant="bodyStrong">Yazışma</AppText>
            <AppText variant="caption" color="textTertiary">
              {data.messages.length} mesaj · {data.can_reply ? 'yanıtlanabilir' : 'kapalı'}
            </AppText>
          </View>

          <View style={styles.thread}>
            {data.messages.length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Henüz yazışma yok. Misafire ilk yanıtı vererek süreci başlat.
              </AppText>
            ) : (
              data.messages.map((message) => {
                const isStaff = message.author_role !== 'guest';
                const bubbleColor = message.internal
                  ? theme.colors.warningSoft
                  : isStaff
                    ? theme.colors.primarySoft
                    : theme.colors.surfaceMuted;
                return (
                  <View
                    key={message.id}
                    style={[
                      styles.message,
                      {
                        backgroundColor: bubbleColor,
                        alignSelf: isStaff ? 'flex-end' : 'flex-start',
                        borderColor: message.internal ? theme.colors.warning : theme.colors.border,
                      },
                    ]}
                  >
                    <View style={styles.messageHead}>
                      <AppText variant="caption" color="textSecondary" style={styles.messageAuthor}>
                        {message.author_role === 'system' ? 'Sistem' : message.author_name}
                      </AppText>
                      {message.internal ? (
                        <AppText variant="caption" color="warning" style={styles.tiny}>İç not</AppText>
                      ) : null}
                      <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                        {formatDateTime(message.created_at)}
                      </AppText>
                    </View>
                    <AppText variant="body" color="text">{message.body}</AppText>
                  </View>
                );
              })
            )}
          </View>

          {data.can_reply ? (
            <View style={styles.composer}>
              <TextField
                label={internal ? 'İç not (misafir görmez)' : 'Misafire yanıt'}
                value={body}
                onChangeText={setBody}
                placeholder={internal ? 'Ekip için not yaz' : 'Profesyonel ve çözüm odaklı yanıt yaz'}
                multiline
                numberOfLines={3}
              />
              <View style={styles.composerActions}>
                {data.can_manage ? (
                  <Chip
                    label={internal ? 'İç not açık' : 'İç not'}
                    icon="lock-closed-outline"
                    active={internal}
                    onPress={() => setInternal((current) => !current)}
                  />
                ) : null}
                <Button
                  label={internal ? 'Notu kaydet' : 'Yanıtı gönder'}
                  size="sm"
                  fullWidth={false}
                  loading={send.isPending}
                  onPress={() => void sendMessage()}
                />
              </View>
            </View>
          ) : null}

          {data.can_manage ? (
            <View style={styles.threadHead}>
              <AppText variant="bodyStrong">Zaman çizelgesi</AppText>
              <AppText variant="caption" color="textTertiary">{data.events.length} işlem</AppText>
            </View>
          ) : null}
          {data.can_manage ? (
            <View style={styles.timeline}>
              {data.events.slice(0, 8).map((event) => (
                <View key={event.id} style={styles.eventRow}>
                  <View style={[styles.eventDot, { backgroundColor: theme.colors.primary }]} />
                  <View style={styles.flex}>
                    <AppText variant="caption" color="textSecondary">
                      {EVENT_LABELS[event.action] ?? event.action}
                      {event.actor_name ? ` · ${event.actor_name}` : ''}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                      {formatDateTime(event.created_at)}
                      {event.from_status && event.to_status && event.from_status !== event.to_status
                        ? ` · ${COMPLAINT_STATUS_LABELS[event.from_status]} → ${COMPLAINT_STATUS_LABELS[event.to_status]}`
                        : ''}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {data.satisfaction ? (
            <View style={[styles.quote, { backgroundColor: theme.colors.successSoft }]}>
              <View style={styles.satisfactionRow}>
                <Ionicons name="happy-outline" size={16} color={theme.colors.success} />
                <AppText variant="bodyStrong" color="success">
                  Misafir memnuniyeti: {data.satisfaction}/5
                </AppText>
              </View>
              {data.satisfaction_comment ? (
                <AppText variant="caption" color="textSecondary">“{data.satisfaction_comment}”</AppText>
              ) : null}
            </View>
          ) : null}

          {error ? <InlineError message={error} /> : null}
        </View>
      )}
    </ModalSheet>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoCell}>
      <AppText variant="caption" color="textTertiary" style={styles.tiny}>{label}</AppText>
      <AppText variant="caption" color="textSecondary" numberOfLines={2}>{value}</AppText>
    </View>
  );
}

function parseCompensation(value: string): number {
  const parsed = Number(String(value).replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { width: '23.4%', minWidth: 140, flexGrow: 1 },
  summaryStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summaryItem: { flex: 1, minWidth: 90, gap: 1 },
  filters: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  list: { gap: 8 },
  card: { gap: 6 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  priorityBar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  unreadDot: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unreadText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  form: { gap: 12 },
  fieldLabel: { marginBottom: 5 },
  hint: { marginTop: 3 },
  twoCols: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  quote: { padding: 9, borderRadius: 8 },
  footerRow: { flexDirection: 'row', gap: 8 },
  detailWrap: { gap: 12 },
  detailTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  slaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  description: { marginTop: 4 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  infoCell: { minWidth: '30%', flexGrow: 1, gap: 1 },
  compensationField: { width: 130, gap: 2 },
  escalateBox: { gap: 8, padding: 11, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  threadHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  thread: { gap: 8 },
  message: { maxWidth: '88%', gap: 3, padding: 9, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  messageHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  messageAuthor: { fontWeight: '600' },
  composer: { gap: 8 },
  composerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  timeline: { gap: 8 },
  eventRow: { flexDirection: 'row', gap: 8 },
  eventDot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
  satisfactionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tiny: { fontSize: 10 },
});
