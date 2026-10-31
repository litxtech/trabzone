import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText, Button, Screen, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import {
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  ModalSheet,
  StarRating,
  StatusPill,
} from '@/features/accommodation/components/AccommodationUI';
import { AURORA, AuroraBackdrop, GlassPill, IconSquare } from '@/features/accommodation/components/PremiumUI';
import {
  useAccommodationComplaint,
  useCreateGuestComplaint,
  useMyComplaints,
  useMyReservations,
  useRateComplaint,
  useSendComplaintMessage,
} from '@/features/accommodation/hooks/use-accommodation';
import { useAccommodationLayout } from '@/features/accommodation/hooks/use-accommodation-layout';
import type {
  ComplaintCategory,
  ComplaintDetail,
  ComplaintPriority,
  MyComplaint,
  MyReservation,
} from '@/features/accommodation/types';
import {
  COMPLAINT_CATEGORY_ICONS,
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_CATEGORY_OPTIONS,
  COMPLAINT_PRIORITY_LABELS,
  COMPLAINT_PRIORITY_OPTIONS,
  complaintPriorityTone,
  complaintTone,
  isComplaintActive,
} from '@/features/accommodation/utils/complaints';
import { formatDate, formatDateTime, relativeTime } from '@/features/accommodation/utils/format';

export default function GuestSupportScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const layout = useAccommodationLayout();
  const params = useLocalSearchParams<{ reservation?: string }>();
  const reservationId = typeof params.reservation === 'string' ? params.reservation : null;

  const [onlyThisStay, setOnlyThisStay] = useState(Boolean(reservationId));
  const reservations = useMyReservations();
  const complaints = useMyComplaints(onlyThisStay ? reservationId : null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createReservationId, setCreateReservationId] = useState<string | null>(reservationId);

  const items = useMemo(() => complaints.data?.items ?? [], [complaints.data]);

  const usableReservations = useMemo(
    () =>
      (reservations.data ?? []).filter(
        (item) => !['cancelled', 'declined', 'expired', 'draft'].includes(item.status),
      ),
    [reservations.data],
  );

  const selectedReservation = useMemo(
    () => usableReservations.find((item) => item.id === reservationId) ?? null,
    [usableReservations, reservationId],
  );

  const counts = useMemo(
    () => ({
      active: items.filter((item) => isComplaintActive(item.status)).length,
      resolved: items.filter((item) => item.status === 'resolved' || item.status === 'closed').length,
      unread: items.reduce((total, item) => total + item.unread_count, 0),
    }),
    [items],
  );

  return (
    <Screen
      scroll
      padded={false}
      edges={['top', 'left', 'right']}
      refreshControl={
        <RefreshControl
          refreshing={complaints.isRefetching && !complaints.isLoading}
          onRefresh={() => void complaints.refetch()}
          tintColor={theme.colors.primary}
        />
      }
    >
      <AuroraBackdrop style={styles.hero} colors={[AURORA.night, '#101A33', '#2A2350']}>
        <View style={styles.heroTop}>
          <IconSquare icon="chevron-back" accessibilityLabel="Geri" onPress={() => router.back()} />
          <View style={styles.heroBrand}>
            <AppText variant="overline" style={styles.brandOverline}>TRABZONE KONAKLAMA</AppText>
            <AppText variant="h3" style={styles.brandTitle}>Destek merkezi</AppText>
          </View>
          <IconSquare
            icon="add"
            accessibilityLabel="Yeni destek talebi"
            onPress={() => {
              setCreateReservationId(reservationId ?? usableReservations[0]?.id ?? null);
              setCreateOpen(true);
            }}
          />
        </View>

        <View style={styles.heroCopy}>
          <AppText variant="display" style={styles.heroTitle}>
            Sorununu bildir,{'\n'}çözümü takip et.
          </AppText>
          <AppText variant="caption" style={styles.heroSubtitle}>
            Konaklamanla ilgili temizlik, gürültü, teknik arıza veya ücret konularında otelden doğrudan destek al.
          </AppText>
        </View>

        <View style={styles.heroStats}>
          <GlassStat label="Açık talep" value={String(counts.active)} icon="alert-circle" />
          <GlassStat label="Çözülen" value={String(counts.resolved)} icon="checkmark-done" />
          <GlassStat label="Yeni yanıt" value={String(counts.unread)} icon="chatbubble" />
        </View>
      </AuroraBackdrop>

      <View
        style={[
          styles.body,
          { paddingHorizontal: layout.isDesktop ? 28 : theme.layout.screenPadding },
        ]}
      >
        <View style={styles.headRow}>
          <View style={styles.flex}>
            <AppText variant="h3">Taleplerim</AppText>
            <AppText variant="caption" color="textTertiary">
              {items.length} kayıt · otel yanıtları burada görünür
            </AppText>
          </View>
          <Button
            label="Sorun bildir"
            size="sm"
            fullWidth={false}
            onPress={() => {
              setCreateReservationId(reservationId ?? usableReservations[0]?.id ?? null);
              setCreateOpen(true);
            }}
          />
        </View>

        {reservationId ? (
          <View style={styles.filters}>
            <Chip
              label={selectedReservation ? `${selectedReservation.property.name}` : 'Bu konaklama'}
              icon="bed-outline"
              active={onlyThisStay}
              onPress={() => setOnlyThisStay(true)}
            />
            <Chip label="Tüm taleplerim" active={!onlyThisStay} onPress={() => setOnlyThisStay(false)} />
          </View>
        ) : null}

        {complaints.isLoading ? (
          <View style={styles.list}>
            <LoadingBlock height={120} />
            <LoadingBlock height={120} />
          </View>
        ) : complaints.isError ? (
          <InlineError
            message={complaints.error instanceof Error ? complaints.error.message : 'Talepler yüklenemedi.'}
            onRetry={() => void complaints.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="shield-checkmark-outline"
            title="Destek talebin yok"
            message="Konaklaman sırasında veya sonrasında bir sorun yaşarsan otelden doğrudan destek isteyebilirsin. Talebin otel yönetimine iletilir ve yanıtlar burada listelenir."
            actionLabel="Sorun bildir"
            onAction={() => {
              setCreateReservationId(reservationId ?? usableReservations[0]?.id ?? null);
              setCreateOpen(true);
            }}
          />
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <ComplaintRow key={item.id} item={item} onPress={() => setSelectedId(item.id)} />
            ))}
          </View>
        )}

        <InfoBanner text="Yanıt süreleri otelin öncelik tanımına göre hesaplanır. Acil güvenlik sorunlarında ayrıca tesis resepsiyonunu araman önerilir. Talebin çözüldüğünde 1–5 arasında memnuniyet puanı verebilirsin." />
      </View>

      <GuestComplaintDetail
        key={selectedId ?? 'none'}
        complaintId={selectedId}
        onClose={() => setSelectedId(null)}
      />

      <GuestComplaintCreate
        key={createOpen ? 'open' : 'closed'}
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        reservationId={createReservationId}
        reservations={usableReservations}
        onReservationChange={setCreateReservationId}
        onCreated={(created) => {
          setCreateOpen(false);
          setSelectedId(created.id);
          void complaints.refetch();
        }}
      />
    </Screen>
  );
}

function GlassStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <View style={styles.glassStat}>
      <Ionicons name={icon} size={15} color="rgba(255,255,255,0.85)" />
      <View>
        <AppText variant="bodyStrong" style={styles.glassValue}>{value}</AppText>
        <AppText variant="caption" style={styles.glassLabel}>{label}</AppText>
      </View>
    </View>
  );
}

function ComplaintRow({ item, onPress }: { item: MyComplaint; onPress: () => void }) {
  const { theme } = useTheme();
  const tone = complaintTone(item.status);
  const priorityTone = complaintPriorityTone(item.priority);

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
        ]}
      >
        <View style={styles.cardTop}>
          <AppText variant="caption" color="textTertiary">{item.reference}</AppText>
          <StatusPill label={tone.label} color={tone.color} background={tone.background} border={tone.border} />
          {['high', 'urgent'].includes(item.priority) ? (
            <StatusPill
              label={COMPLAINT_PRIORITY_LABELS[item.priority]}
              color={priorityTone.color}
              background={priorityTone.background}
              border={priorityTone.border}
            />
          ) : null}
          {item.unread_count > 0 ? (
            <View style={[styles.unread, { backgroundColor: theme.colors.danger }]}>
              <AppText variant="caption" style={styles.unreadText}>{item.unread_count}</AppText>
            </View>
          ) : null}
        </View>

        <AppText variant="bodyStrong" numberOfLines={2}>{item.subject}</AppText>
        <View style={styles.metaRow}>
          <Ionicons name={COMPLAINT_CATEGORY_ICONS[item.category]} size={12} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary">
            {COMPLAINT_CATEGORY_LABELS[item.category]}
            {item.property_name ? ` · ${item.property_name}` : ''}
            {item.room_number ? ` · Oda ${item.room_number}` : ''}
          </AppText>
        </View>
        {item.last_message ? (
          <AppText variant="caption" color="textSecondary" numberOfLines={1}>
            “{item.last_message}”
          </AppText>
        ) : null}
        <View style={styles.cardFooter}>
          <AppText variant="caption" color="textTertiary">{relativeTime(item.last_activity_at)}</AppText>
          {item.resolution ? (
            <AppText variant="caption" color="success" numberOfLines={1} style={styles.flex}>
              Çözüm: {item.resolution}
            </AppText>
          ) : null}
          <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
        </View>
      </View>
    </Pressable>
  );
}

function GuestComplaintDetail({
  complaintId,
  onClose,
}: {
  complaintId: string | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const detail = useAccommodationComplaint(complaintId);
  const send = useSendComplaintMessage();
  const rate = useRateComplaint();

  const [body, setBody] = useState('');
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const data = detail.data;

  const tone = data ? complaintTone(data.status) : null;
  const canRate =
    Boolean(data) &&
    ['resolved', 'closed'].includes(data?.status ?? '') &&
    !data?.satisfaction;

  const submit = async () => {
    if (!data) return;
    if (!body.trim()) {
      setError('Mesaj boş olamaz.');
      return;
    }
    setError(null);
    try {
      await send.mutateAsync({ complaintId: data.id, body: body.trim() });
      setBody('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mesaj gönderilemedi.');
    }
  };

  const submitRating = async () => {
    if (!data) return;
    setError(null);
    try {
      await rate.mutateAsync({ complaintId: data.id, score, comment: comment.trim() || null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Değerlendirme gönderilemedi.');
    }
  };

  return (
    <ModalSheet
      visible={Boolean(complaintId)}
      onClose={onClose}
      title={data ? data.subject : 'Destek talebi'}
      subtitle={data ? `${data.reference}${data.property_name ? ` · ${data.property_name}` : ''}` : undefined}
      maxWidth={620}
    >
      {detail.isLoading ? (
        <LoadingBlock height={220} />
      ) : detail.isError || !data || !tone ? (
        <InlineError
          message={detail.error instanceof Error ? detail.error.message : 'Talep detayı yüklenemedi.'}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <View style={styles.detailWrap}>
          <View style={styles.detailTop}>
            <StatusPill label={tone.label} color={tone.color} background={tone.background} border={tone.border} />
            <GlassPill icon="calendar-outline" label={formatDate(data.created_at.slice(0, 10))} />
            {data.reservation_code ? <GlassPill icon="bed-outline" label={data.reservation_code} /> : null}
          </View>

          <View style={[styles.panel, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
            <AppText variant="caption" color="textSecondary">{data.description}</AppText>
            {data.room_number ? (
              <AppText variant="caption" color="textTertiary" style={styles.metaRow}>
                Oda {data.room_number} · {COMPLAINT_CATEGORY_LABELS[data.category]}
              </AppText>
            ) : null}
          </View>

          {data.resolution ? (
            <View style={[styles.panel, { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.success }]}>
              <AppText variant="caption" color="success" style={styles.semibold}>Otelin çözümü</AppText>
              <AppText variant="body" color="textSecondary">{data.resolution}</AppText>
              {data.resolved_at ? (
                <AppText variant="caption" color="textTertiary">{formatDateTime(data.resolved_at)}</AppText>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.threadHead, { borderTopColor: theme.colors.divider }]}>
            <AppText variant="bodyStrong">Yazışma</AppText>
            <AppText variant="caption" color="textTertiary">{data.messages.length} mesaj</AppText>
          </View>

          <View style={styles.thread}>
            {data.messages.length === 0 ? (
              <AppText variant="caption" color="textTertiary">
                Otel henüz yanıt vermedi. Talebin iletildi; yanıt geldiğinde bildirim alacaksın.
              </AppText>
            ) : (
              data.messages.map((message) => {
                const mine = message.author_role === 'guest';
                const system = message.author_role === 'system';
                return (
                  <View
                    key={message.id}
                    style={[
                      styles.message,
                      {
                        alignSelf: system ? 'center' : mine ? 'flex-end' : 'flex-start',
                        backgroundColor: system
                          ? theme.colors.surfaceMuted
                          : mine
                            ? theme.colors.primarySoft
                            : theme.colors.surfaceMuted,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  >
                    <View style={styles.messageHead}>
                      <AppText variant="caption" color="textSecondary" style={styles.semibold}>
                        {system ? 'Sistem' : mine ? 'Sen' : message.author_name}
                      </AppText>
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
                label="Otelin yanıtına cevap yaz"
                value={body}
                onChangeText={setBody}
                placeholder="Ek bilgi, fotoğraf açıklaması veya talebinle ilgili not"
                multiline
                numberOfLines={3}
              />
              <Button label="Mesajı gönder" size="sm" loading={send.isPending} onPress={() => void submit()} />
            </View>
          ) : null}

          {canRate ? (
            <View style={[styles.panel, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary }]}>
              <AppText variant="bodyStrong" color="primaryDeep">Çözümden memnun kaldın mı?</AppText>
              <View style={styles.ratingRow}>
                <StarRating rating={score} size={26} onChange={setScore} />
                <AppText variant="caption" color="textSecondary">{score}/5</AppText>
              </View>
              <TextField
                label="Yorum (opsiyonel)"
                value={comment}
                onChangeText={setComment}
                placeholder="Deneyimini kısaca anlat"
                multiline
              />
              <Button
                label="Değerlendirmeyi gönder"
                size="sm"
                loading={rate.isPending}
                onPress={() => void submitRating()}
              />
            </View>
          ) : data.satisfaction ? (
            <View style={styles.ratingRow}>
              <Ionicons name="happy-outline" size={16} color={theme.colors.success} />
              <AppText variant="caption" color="textSecondary">
                Memnuniyetin: {data.satisfaction}/5
              </AppText>
            </View>
          ) : null}

          {error ? <InlineError message={error} /> : null}
        </View>
      )}
    </ModalSheet>
  );
}

function GuestComplaintCreate({
  visible,
  onClose,
  reservationId,
  reservations,
  onReservationChange,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  reservationId: string | null;
  reservations: MyReservation[];
  onReservationChange: (id: string) => void;
  onCreated: (complaint: ComplaintDetail) => void;
}) {
  const { theme } = useTheme();
  const create = useCreateGuestComplaint();

  const [category, setCategory] = useState<ComplaintCategory>('other');
  const [priority, setPriority] = useState<ComplaintPriority>('normal');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reservationId) {
      setError('Talep açmak için bir konaklama seçmelisin.');
      return;
    }
    if (subject.trim().length < 3) {
      setError('Konu en az 3 karakter olmalı.');
      return;
    }
    if (!description.trim()) {
      setError('Sorunu kısaca açıklamalısın.');
      return;
    }
    setError(null);
    try {
      const result = await create.mutateAsync({
        reservation_id: reservationId,
        category,
        priority,
        subject: subject.trim(),
        description: description.trim(),
      });
      onCreated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Talep oluşturulamadı.');
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Sorun bildir"
      subtitle="Talebin otel yönetimine iletilir"
      maxWidth={560}
      footer={<Button label="Talebi gönder" loading={create.isPending} onPress={() => void submit()} />}
    >
      <View style={styles.form}>
        <InfoBanner text="Konaklamanla ilgili sorunu net biçimde anlat. Talebin otelin destek kuyruğuna düşer; yanıtlar bu ekranda ve bildirim olarak gelir." />

        <View>
          <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Konaklama</AppText>
          {reservations.length === 0 ? (
            <AppText variant="caption" color="danger">
              Talep açmak için uygun bir konaklama bulunamadı.
            </AppText>
          ) : (
            <View style={styles.filters}>
              {reservations.map((reservation) => (
                <Chip
                  key={reservation.id}
                  label={`${reservation.property.name} · ${formatDate(reservation.check_in)}`}
                  active={reservationId === reservation.id}
                  onPress={() => onReservationChange(reservation.id)}
                />
              ))}
            </View>
          )}
        </View>

        <TextField
          label="Konu"
          value={subject}
          onChangeText={setSubject}
          placeholder="Örn. Klima çalışmıyor"
        />
        <TextField
          label="Sorunun ayrıntısı"
          value={description}
          onChangeText={setDescription}
          placeholder="Ne oldu, ne zaman oldu ve senden ne yapılmasını istiyorsun?"
          multiline
          numberOfLines={5}
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
            {COMPLAINT_PRIORITY_OPTIONS.filter((entry) => entry.value !== 'urgent').map((entry) => (
              <Chip
                key={entry.value}
                label={entry.label}
                active={priority === entry.value}
                onPress={() => setPriority(entry.value)}
              />
            ))}
          </View>
        </View>

        {error ? <InlineError message={error} /> : null}

        <View style={[styles.panel, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
          <AppText variant="caption" color="textTertiary">
            Talebin otel yönetimine iletildiğinde takip numarası oluşturulur. Otel yanıtladığında bildirim alırsın; çözüm sonrası memnuniyet puanı verebilirsin.
          </AppText>
        </View>
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: 8, paddingBottom: 24, gap: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  heroBrand: { flex: 1 },
  brandOverline: { color: 'rgba(255,255,255,0.6)', letterSpacing: 2, fontSize: 10 },
  brandTitle: { color: '#FFFFFF' },
  heroCopy: { paddingHorizontal: 20, gap: 6 },
  heroTitle: { color: '#FFFFFF', fontSize: 30, lineHeight: 36 },
  heroSubtitle: { color: 'rgba(255,255,255,0.72)', maxWidth: 560 },
  heroStats: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, flexWrap: 'wrap' },
  glassStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    flexGrow: 1,
    minWidth: 110,
  },
  glassValue: { color: '#FFFFFF' },
  glassLabel: { color: 'rgba(255,255,255,0.62)', fontSize: 10 },
  body: { gap: 12, paddingTop: 16, paddingBottom: 40 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  flex: { flex: 1 },
  filters: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  list: { gap: 9 },
  card: { gap: 6, padding: 13, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unread: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  unreadText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  detailWrap: { gap: 11 },
  detailTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  panel: { gap: 5, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  threadHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  thread: { gap: 8 },
  message: { maxWidth: '90%', gap: 3, padding: 9, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth },
  messageHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  composer: { gap: 8 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  form: { gap: 12 },
  fieldLabel: { marginBottom: 5 },
  semibold: { fontWeight: '600' },
  tiny: { fontSize: 10 },
});
