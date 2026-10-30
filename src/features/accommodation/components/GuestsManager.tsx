import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useGuestDetail,
  useGuests,
  useSaveGuest,
} from '../hooks/use-accommodation';
import type { GuestRow } from '../types';
import { formatDate, formatMoneyCents } from '../utils/format';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  StatTile,
} from './AccommodationUI';

export function GuestsManager({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const guests = useGuests(propertyId, query.trim() || undefined);
  const save = useSaveGuest(propertyId);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GuestRow | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useGuestDetail(detailId);

  const items = guests.data?.items ?? [];
  const total = guests.data?.total ?? 0;
  const totalSpent = items.reduce((sum, guest) => sum + guest.total_spent_cents, 0);
  const totalOpen = items.reduce((sum, guest) => sum + guest.open_balance_cents, 0);

  const openCreate = () => {
    setEditing(null);
    setFullName('');
    setPhone('');
    setEmail('');
    setNotes('');
    setConsent(true);
    setError(null);
    setOpen(true);
  };

  const openEdit = (guest: GuestRow) => {
    setEditing(guest);
    setFullName(guest.full_name);
    setPhone(guest.phone ?? '');
    setEmail(guest.email ?? '');
    setNotes(guest.notes ?? '');
    setConsent(guest.contact_consent);
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    if (fullName.trim().length < 2) {
      setError('Misafir adı en az 2 karakter olmalı.');
      return;
    }
    try {
      await save.mutateAsync({
        id: editing?.id,
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
        contact_consent: consent,
      });
      setOpen(false);
      void guests.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Misafir kaydedilemedi.');
    }
  };

  const detailReservations = (() => {
    const raw = detail.data?.reservations;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  })();

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Misafirler</AppText>
          <AppText variant="caption" color="textTertiary">{total} kayıtlı misafir</AppText>
        </View>
        <Button
          label="Misafir ekle"
          size="sm"
          fullWidth={false}
          leftIcon={<Ionicons name="person-add-outline" size={15} color={theme.colors.onPrimary} />}
          onPress={openCreate}
        />
      </View>

      <View style={styles.stats}>
        <View style={styles.statTile}>
          <StatTile label="Kayıtlı misafir" value={String(total)} icon="people-outline" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Toplam harcama" value={formatMoneyCents(totalSpent)} icon="cash-outline" tone="success" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Açık bakiye" value={formatMoneyCents(totalOpen)} icon="alert-circle-outline" tone="danger" />
        </View>
      </View>

      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder="Misafir adı, telefon veya e-posta ara"
        leftIcon="search-outline"
        autoCorrect={false}
      />

      {error ? <InlineError message={error} /> : null}

      {guests.isLoading ? (
        <LoadingBlock height={220} />
      ) : guests.isError ? (
        <InlineError
          message={guests.error instanceof Error ? guests.error.message : 'Misafirler yüklenemedi.'}
          onRetry={() => void guests.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="Misafir yok"
          message="Rezervasyon oluşturduğunda misafir kaydı otomatik oluşur. Manuel olarak da ekleyebilirsin."
          compact
        />
      ) : (
        <View style={styles.grid}>
          {items.map((guest) => (
            <View key={guest.id}>
              <AccCard padding={12} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}>
                    <AppText variant="bodyStrong" color="primary">{guest.full_name.slice(0, 1).toUpperCase()}</AppText>
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>{guest.full_name}</AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {guest.phone ?? guest.email ?? 'İletişim yok'}
                    </AppText>
                  </View>
                </View>
                <View style={styles.metaRow}>
                  <AppText variant="caption" color="textSecondary">{guest.reservation_count} konaklama</AppText>
                  {guest.last_stay ? (
                    <AppText variant="caption" color="textTertiary">Son: {formatDate(guest.last_stay)}</AppText>
                  ) : null}
                </View>
                <View style={styles.moneyRow}>
                  <AppText variant="caption" color="textSecondary">Harcama {formatMoneyCents(guest.total_spent_cents)}</AppText>
                  {guest.open_balance_cents > 0 ? (
                    <AppText variant="caption" color="danger">Açık {formatMoneyCents(guest.open_balance_cents)}</AppText>
                  ) : null}
                </View>
                {guest.notes ? (
                  <AppText variant="caption" color="textTertiary" numberOfLines={2}>{guest.notes}</AppText>
                ) : null}
                <View style={[styles.cardFooter, { borderTopColor: theme.colors.divider }]}>
                  <Button label="Geçmiş" size="sm" variant="ghost" fullWidth={false} onPress={() => setDetailId(guest.id)} />
                  <Button label="Düzenle" size="sm" variant="ghost" fullWidth={false} onPress={() => openEdit(guest)} />
                </View>
              </AccCard>
            </View>
          ))}
        </View>
      )}

      <InfoBanner text="Misafir kişisel verileri yalnızca gerekli personel tarafından görüntülenir. Pazarlama izni olmayan misafirlere ticari ileti gönderilmez. Kimlik bildirim yükümlülükleri için ayrı ve yetkili sistem entegrasyonu gerekir." />

      <ModalSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Misafiri düzenle' : 'Yeni misafir'}
        maxWidth={500}
        footer={<Button label="Kaydet" loading={save.isPending} onPress={() => void submit()} />}
      >
        <View style={{ gap: 10 }}>
          {error ? <InlineError message={error} /> : null}
          <TextField label="Ad soyad" value={fullName} onChangeText={setFullName} />
          <TextField label="Telefon" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <TextField label="E-posta" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextField label="Not" value={notes} onChangeText={setNotes} multiline numberOfLines={3} />
          <Chip
            label="Ticari ileti izni var"
            active={consent}
            onPress={() => setConsent((value) => !value)}
          />
        </View>
      </ModalSheet>

      <ModalSheet
        visible={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={loadingDetailName(detail.data, detailId, items)}
        subtitle="Misafir geçmişi"
        maxWidth={560}
      >
        {detail.isLoading ? (
          <LoadingBlock height={140} />
        ) : detail.isError ? (
          <InlineError message="Misafir detayı yüklenemedi." onRetry={() => void detail.refetch()} />
        ) : (
          <View style={{ gap: 7 }}>
            <KeyValueRow label="Telefon" value={String(detail.data?.phone ?? '—')} />
            <KeyValueRow label="E-posta" value={String(detail.data?.email ?? '—')} />
            <KeyValueRow label="Ticari ileti izni" value={detail.data?.contact_consent ? 'Var' : 'Yok'} />
            <KeyValueRow label="Notlar" value={String(detail.data?.notes ?? '—')} />
            <AppText variant="label" color="textSecondary" style={styles.section}>Konaklama geçmişi</AppText>
            {detailReservations.length === 0 ? (
              <AppText variant="caption" color="textTertiary">Konaklama kaydı yok.</AppText>
            ) : (
              detailReservations.map((row, index) => (
                <View key={String(row.id ?? index)} style={[styles.historyRow, { borderBottomColor: theme.colors.divider }]}>
                  <View style={styles.flex}>
                    <AppText variant="caption" color="text">{String(row.code ?? '')} · {String(row.status ?? '')}</AppText>
                    <AppText variant="caption" color="textTertiary">
                      {String(row.check_in ?? '')} → {String(row.check_out ?? '')}
                    </AppText>
                  </View>
                  <AppText variant="caption" color="textSecondary">
                    {formatMoneyCents(Number(row.total_cents ?? 0))}
                  </AppText>
                </View>
              ))
            )}
          </View>
        )}
      </ModalSheet>
    </View>
  );
}

function loadingDetailName(
  data: Record<string, unknown> | undefined,
  id: string | null,
  items: GuestRow[],
): string {
  if (data && typeof data.full_name === 'string') return data.full_name;
  return items.find((guest) => guest.id === id)?.full_name ?? 'Misafir';
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { width: '32%', minWidth: 150, flexGrow: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '32%', minWidth: 250, flexGrow: 1, gap: 5 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardFooter: { flexDirection: 'row', gap: 2, paddingTop: 5, marginTop: 2, borderTopWidth: StyleSheet.hairlineWidth },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  moneyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  section: { marginTop: 8 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
