import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAddFolioItem,
  useAvailableRooms,
  useCashOverview,
  useCreateDocument,
  usePropertyInventory,
  useReservation,
  useTransitionReservation,
  useUpdateReservation,
} from '../hooks/use-accommodation';
import type { ReservationAction, ReservationDetail } from '../types';
import { exportDocumentPdf } from '../utils/pdf-excel-export';
import {
  BOOKING_MODE_LABELS,
  SOURCE_LABELS,
  centsToInput,
  formatDate,
  formatDateTime,
  formatMoneyCents,
  guestCount,
  nightsBetween,
  parseMoneyToCents,
  paymentStatusLabel,
  paymentTone,
  reservationTone,
  todayIso,
} from '../utils/format';
import {
  AccCard,
  Chip,
  ChipsRow,
  DateField,
  InfoBanner,
  InlineError,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  MoneyText,
  StatusPill,
} from './AccommodationUI';

const ACTION_LABELS: Record<ReservationAction, string> = {
  confirm: 'Onayla',
  decline: 'Reddet',
  cancel: 'İptal et',
  no_show: 'No-show işaretle',
  mark_arrival: 'Giriş bekleniyor',
  check_in: 'Giriş yap',
  mark_staying: 'Konaklıyor',
  check_out: 'Çıkış yap',
  complete: 'Tamamla',
  dispute: 'Uyuşmazlık aç',
  change_pending: 'Değişiklik bekliyor',
  resolve_dispute: 'Uyuşmazlığı çöz',
};

const DESTRUCTIVE: ReservationAction[] = ['decline', 'cancel', 'no_show', 'dispute', 'change_pending'];

export function ReservationDetailModal({
  reservationId,
  propertyId,
  onClose,
  onChanged,
  onOpenMessages,
}: {
  reservationId: string | null;
  propertyId: string;
  onClose: () => void;
  onChanged?: (reservation: ReservationDetail) => void;
  onOpenMessages?: (reservationId: string) => void;
}) {
  const { theme } = useTheme();
  const detail = useReservation(reservationId);
  const inventory = usePropertyInventory(propertyId);
  const cash = useCashOverview(propertyId);
  const transition = useTransitionReservation();
  const update = useUpdateReservation();
  const addFolio = useAddFolioItem(propertyId);
  const createDocument = useCreateDocument(propertyId);

  const [editMode, setEditMode] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [checkIn, setCheckIn] = useState(todayIso());
  const [checkOut, setCheckOut] = useState('');
  const [roomTypeId, setRoomTypeId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [ratePlanId, setRatePlanId] = useState<string | null>(null);
  const [nightlyPrice, setNightlyPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [action, setAction] = useState<ReservationAction | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentKind, setPaymentKind] = useState<'payment' | 'charge' | 'refund'>('payment');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'pos' | 'bank'>('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [cashAccountId, setCashAccountId] = useState<string | null>(null);
  /** Ödeme alındı kaydını geri alma (iade) onay paneli. */
  const [paymentCancelOpen, setPaymentCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  const data = detail.data;

  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGuestName(data.guest_name);
    setGuestPhone(data.guest_phone ?? '');
    setGuestEmail(data.guest_email ?? '');
    setAdults(String(data.adults));
    setChildren(String(data.children));
    setCheckIn(data.check_in);
    setCheckOut(data.check_out);
    setRoomTypeId(data.room_type_id);
    setRoomId(data.room_id);
    setRatePlanId(data.rate_plan_id);
    setNightlyPrice(String(data.nightly_price_cents / 100));
    setDiscount(
      data.discount_cents > 0 ? (data.discount_cents / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '',
    );
    setNotes(data.notes ?? '');
    setInternalNotes(data.internal_notes ?? '');
    setEditMode(false);
    setAction(null);
    setPaymentOpen(false);
    setPaymentCancelOpen(false);
    setError(null);
    setInfo(null);
  }, [data?.id]);

  const roomTypes = inventory.data?.room_types ?? [];
  const plans = useMemo(
    () =>
      (inventory.data?.rate_plans ?? []).filter(
        (plan) => plan.room_type_id == null || plan.room_type_id === roomTypeId,
      ),
    [inventory.data?.rate_plans, roomTypeId],
  );
  const rooms = (inventory.data?.rooms ?? []).filter((room) => room.room_type_id === roomTypeId);
  const availability = useAvailableRooms(
    editMode && roomTypeId && checkOut && checkOut > checkIn
      ? { propertyId, roomTypeId, from: checkIn, to: checkOut, excludeReservationId: data?.id }
      : null,
  );

  const close = () => {
    setEditMode(false);
    setAction(null);
    setPaymentOpen(false);
    setPaymentCancelOpen(false);
    setError(null);
    setInfo(null);
    onClose();
  };

  const refresh = async () => {
    const result = await detail.refetch();
    if (result.data) onChanged?.(result.data);
  };

  const doAction = async () => {
    if (!data || !action) return;
    setError(null);
    try {
      const result = await transition.mutateAsync({ id: data.id, action, note: actionNote.trim() || undefined });
      setAction(null);
      setActionNote('');
      setInfo('Rezervasyon durumu güncellendi.');
      onChanged?.(result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Durum değiştirilemedi.');
    }
  };

  const saveEdit = async () => {
    if (!data) return;
    setError(null);
    if (!guestName.trim()) {
      setError('Misafir adı boş olamaz.');
      return;
    }
    if (!checkOut || nightsBetween(checkIn, checkOut) <= 0) {
      setError('Geçerli bir giriş ve çıkış tarihi seç.');
      return;
    }
    if (!roomTypeId || !ratePlanId) {
      setError('Oda tipi ve fiyat planı zorunludur.');
      return;
    }
    try {
      const result = await update.mutateAsync({
        id: data.id,
        payload: {
          guestName: guestName.trim(),
          guestPhone: guestPhone.trim() || null,
          guestEmail: guestEmail.trim() || null,
          adults: Math.max(1, Number(adults) || 1),
          children: Math.max(0, Number(children) || 0),
          checkIn,
          checkOut,
          roomTypeId,
          roomId,
          ratePlanId,
          nightlyPriceCents: parseMoneyToCents(nightlyPrice) ?? data.nightly_price_cents,
          discountCents: parseMoneyToCents(discount) ?? 0,
          notes: notes.trim() || null,
          internalNotes: internalNotes.trim() || null,
        },
      });
      setEditMode(false);
      setInfo('Rezervasyon güncellendi.');
      onChanged?.(result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Rezervasyon güncellenemedi.');
    }
  };

  const remainingCents = data ? Math.max(0, data.total_cents - data.paid_cents) : 0;

  /**
   * "Ödeme alındı" kısayolu: kalan bakiyeyi peşin doldurur. Tahsilat
   * kaydedildiğinde rezervasyonun ödeme durumu sunucuda otomatik güncellenir.
   */
  const openPaymentPanel = (kind: 'payment' | 'refund' = 'payment') => {
    if (!data) return;
    const seed = kind === 'payment' ? remainingCents : data.paid_cents;
    setPaymentKind(kind);
    setPaymentAmount(seed > 0 ? centsToInput(seed) : '');
    setPaymentMethod('cash');
    setPaymentNote('');
    setPaymentOpen(true);
    setPaymentCancelOpen(false);
    setAction(null);
    setError(null);
    setInfo(null);
  };

  const addPayment = async () => {
    if (!data) return;
    setError(null);
    const amount = parseMoneyToCents(paymentAmount);
    if (!amount || amount <= 0) {
      setError('Geçerli bir tutar gir.');
      return;
    }
    /*
     * Hesap seçilmediyse ödeme yöntemine uyan ilk kasa hesabı kullanılır.
     * Aksi halde tahsilat rezervasyona işleniyor ama kasaya düşmüyordu.
     */
    const accountKind = paymentKind === 'charge' ? 'cash' : paymentMethod;
    const accountId =
      cashAccountId ??
      (cash.data?.accounts ?? []).find((account) => account.kind === accountKind)?.id ??
      null;
    try {
      await addFolio.mutateAsync({
        reservationId: data.id,
        kind: paymentKind,
        category: paymentKind === 'payment' ? paymentMethod : paymentKind === 'refund' ? 'other' : 'extra',
        amountCents: amount,
        description: paymentNote.trim() || (paymentKind === 'payment' ? 'Rezervasyon tahsilatı' : paymentKind === 'refund' ? 'İade' : 'Ek hizmet'),
        method: paymentKind === 'payment' || paymentKind === 'refund' ? paymentMethod : null,
        cashAccountId: paymentKind === 'payment' || paymentKind === 'refund' ? accountId : null,
        occurredOn: todayIso(),
      });
      setPaymentAmount('');
      setPaymentNote('');
      setPaymentOpen(false);
      setInfo('Kasa hareketi kaydedildi.');
      // Ödeme sonrası detay açık kalır: kalan bakiye ve ödeme durumu güncellenir.
      await detail.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ödeme kaydedilemedi.');
    }
  };

  /**
   * "Ödeme alındı" işlemini geri alır: tahsil edilen tutar kadar iade
   * hareketi yazar. Sunucu paid_cents değerini ve ödeme durumunu günceller;
   * böylece kayıt silinmeden izlenebilir kalır.
   */
  const cancelPayment = async () => {
    if (!data || data.paid_cents <= 0) return;
    setError(null);
    // Tahsilatın yapıldığı yöntem/kasa hesabı bulunursa iade aynı hesaba işlenir.
    const lastPayment = [...data.folio].reverse().find((item) => item.kind === 'payment');
    const method = (lastPayment?.method as 'cash' | 'pos' | 'bank' | null) ?? 'cash';
    const accountId =
      cashAccountId ?? (cash.data?.accounts ?? []).find((account) => account.kind === method)?.id ?? null;
    try {
      await addFolio.mutateAsync({
        reservationId: data.id,
        kind: 'refund',
        category: 'other',
        amountCents: data.paid_cents,
        description: 'Ödeme alındı iptali',
        method,
        cashAccountId: accountId,
        occurredOn: todayIso(),
      });
      setPaymentCancelOpen(false);
      setPaymentOpen(false);
      setInfo('Ödeme alındı iptal edildi.');
      await detail.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ödeme iptal edilemedi.');
    }
  };

  const createReservationDocument = async () => {
    if (!data) return;
    setDocumentLoading(true);
    setError(null);
    try {
      const document = await createDocument.mutateAsync({
        kind: 'reservation',
        reservationId: data.id,
        title: `${data.code} · ${data.guest_name}`,
      });
      const exported = await exportDocumentPdf(document);
      if (!exported.ok) {
        setError(exported.error.message);
      } else {
        setInfo('Rezervasyon belgesi oluşturuldu.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Belge oluşturulamadı.');
    } finally {
      setDocumentLoading(false);
    }
  };

  const tone = data ? reservationTone(data.status) : null;
  const payment = data ? paymentTone(data.payment_status) : null;

  return (
    <ModalSheet
      visible={Boolean(reservationId)}
      onClose={close}
      title={data ? `${data.guest_name}` : 'Rezervasyon'}
      subtitle={data ? `${data.code} · ${formatDate(data.check_in)} → ${formatDate(data.check_out)}` : undefined}
      maxWidth={860}
      footer={
        data ? (
          <View style={styles.footer}>
            <Button
              label="Belge oluştur"
              variant="outline"
              leftIcon={<Ionicons name="document-text-outline" size={16} color={theme.colors.text} />}
              loading={documentLoading}
              onPress={() => void createReservationDocument()}
              style={styles.footerButton}
            />
            {onOpenMessages ? (
              <Button
                label="Mesaj"
                variant="outline"
                leftIcon={<Ionicons name="chatbubble-outline" size={16} color={theme.colors.text} />}
                onPress={() => onOpenMessages(data.id)}
                style={styles.footerButton}
              />
            ) : null}
            <Button
              label={editMode ? 'Düzenlemeyi kapat' : 'Düzenle'}
              variant={editMode ? 'secondary' : 'primary'}
              onPress={() => {
                setEditMode((current) => !current);
                setAction(null);
                setPaymentOpen(false);
                setPaymentCancelOpen(false);
                setError(null);
              }}
              style={styles.footerButton}
            />
          </View>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <LoadingBlock height={220} />
      ) : detail.isError || !data ? (
        <InlineError
          message={detail.error instanceof Error ? detail.error.message : 'Rezervasyon yüklenemedi.'}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <View style={styles.wrap}>
          <View style={styles.statusRow}>
            {tone ? <StatusPill label={tone.label} icon="ellipse" color={tone.color} background={tone.background} border={tone.border} /> : null}
            {payment ? <StatusPill label={paymentStatusLabel(data.payment_status)} color={payment.color} background={payment.background} /> : null}
            <StatusPill label={SOURCE_LABELS[data.source]} color={theme.colors.textSecondary} background={theme.colors.surfaceMuted} />
            <StatusPill label={BOOKING_MODE_LABELS[data.booking_mode]} color={theme.colors.primaryDeep} background={theme.colors.primarySoft} />
          </View>

          {info ? <InfoBanner tone="success" text={info} /> : null}
          {error ? <InlineError message={error} /> : null}

          {!editMode ? (
            <>
              <View style={styles.infoGrid}>
                <AccCard padding={13} style={styles.flex}>
                  <AppText variant="overline" color="primaryDeep">
                    KONAKLAMA
                  </AppText>
                  <KeyValueRow label="Giriş" value={`${formatDate(data.check_in)} · ${data.property_id ? '' : ''}${data.nights} gece`} />
                  <KeyValueRow label="Çıkış" value={formatDate(data.check_out)} />
                  <KeyValueRow label="Oda tipi" value={data.room_type_name} />
                  <KeyValueRow label="Oda" value={data.room_number ?? 'Atanmadı'} />
                  <KeyValueRow label="Fiyat planı" value={data.rate_plan_name} />
                  <KeyValueRow label="Misafir" value={guestCount(data.adults, data.children)} />
                  <KeyValueRow label="Gecelik" value={formatMoneyCents(data.nightly_price_cents, data.currency)} />
                </AccCard>
                <AccCard padding={13} style={styles.flex}>
                  <AppText variant="overline" color="primaryDeep">
                    FİNANS
                  </AppText>
                  <KeyValueRow label="Toplam" value={<MoneyText cents={data.total_cents} currency={data.currency} variant="bodyStrong" />} />
                  <KeyValueRow label="Tahsil edilen" value={formatMoneyCents(data.paid_cents, data.currency)} />
                  <KeyValueRow label="Kalan bakiye" value={formatMoneyCents(Math.max(0, data.total_cents - data.paid_cents), data.currency)} />
                  <KeyValueRow label="İndirim" value={formatMoneyCents(data.discount_cents, data.currency)} />
                  <KeyValueRow label="Komisyon" value={`${formatMoneyCents(data.commission_cents, data.currency)} (%${data.commission_rate})`} />
                  <KeyValueRow label="Ödeme durumu" value={paymentStatusLabel(data.payment_status)} />
                </AccCard>
              </View>

              <AccCard padding={13}>
                <AppText variant="overline" color="primaryDeep">
                  MİSAFİR
                </AppText>
                <KeyValueRow label="Ad soyad" value={data.guest_name} />
                {data.guest_phone ? <KeyValueRow label="Telefon" value={data.guest_phone} /> : null}
                {data.guest_email ? <KeyValueRow label="E-posta" value={data.guest_email} /> : null}
                {data.notes ? <KeyValueRow label="Misafir notu" value={data.notes} /> : null}
                {data.internal_notes ? <KeyValueRow label="İç not" value={data.internal_notes} /> : null}
                {data.hold_expires_at ? <KeyValueRow label="Onay / tutma süresi" value={formatDateTime(data.hold_expires_at)} /> : null}
              </AccCard>

              <View style={styles.quickActions}>
                {data.allowed_actions.map((allowed) => (
                  <Pressable
                    key={allowed}
                    accessibilityRole="button"
                    accessibilityLabel={ACTION_LABELS[allowed]}
                    onPress={() => {
                      setAction(allowed);
                      setActionNote('');
                      setError(null);
                    }}
                    style={[
                      styles.actionButton,
                      {
                        backgroundColor: DESTRUCTIVE.includes(allowed) ? theme.colors.dangerSoft : theme.colors.primarySoft,
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        allowed === 'check_in'
                          ? 'log-in-outline'
                          : allowed === 'check_out'
                            ? 'log-out-outline'
                            : allowed === 'cancel'
                              ? 'close-circle-outline'
                              : allowed === 'confirm'
                                ? 'checkmark-circle-outline'
                                : allowed === 'no_show'
                                  ? 'person-remove-outline'
                                  : 'swap-horizontal-outline'
                      }
                      size={15}
                      color={DESTRUCTIVE.includes(allowed) ? theme.colors.danger : theme.colors.primaryDeep}
                    />
                    <AppText
                      variant="caption"
                      color={DESTRUCTIVE.includes(allowed) ? 'danger' : 'primaryDeep'}
                      style={styles.actionLabel}
                    >
                      {ACTION_LABELS[allowed]}
                    </AppText>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ödeme alındı"
                  onPress={() => {
                    if (remainingCents > 0) {
                      openPaymentPanel('payment');
                    } else if (data.paid_cents > 0) {
                      // Tahsilat tamamsa aynı düğme iptal onayını açar.
                      setPaymentOpen(false);
                      setPaymentCancelOpen(true);
                      setAction(null);
                      setError(null);
                    }
                  }}
                  style={[
                    styles.actionButton,
                    {
                      backgroundColor:
                        remainingCents > 0 ? theme.colors.successSoft : theme.colors.primarySoft,
                    },
                  ]}
                >
                  <Ionicons
                    name={remainingCents > 0 ? 'cash' : 'checkmark-done'}
                    size={15}
                    color={remainingCents > 0 ? theme.colors.success : theme.colors.primaryDeep}
                  />
                  <AppText
                    variant="caption"
                    color={remainingCents > 0 ? 'success' : 'primaryDeep'}
                    style={styles.actionLabel}
                  >
                    Ödeme alındı
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ödeme ekle"
                  onPress={() => {
                    openPaymentPanel('payment');
                    setPaymentAmount('');
                  }}
                  style={[styles.actionButton, { backgroundColor: theme.colors.successSoft }]}
                >
                  <Ionicons name="cash-outline" size={15} color={theme.colors.success} />
                  <AppText variant="caption" color="success" style={styles.actionLabel}>
                    Ödeme / gider
                  </AppText>
                </Pressable>
              </View>

              {action ? (
                <AccCard padding={13} style={[styles.actionPanel, { borderColor: theme.colors.borderStrong }]}>
                  <AppText variant="bodyStrong">{ACTION_LABELS[action]} işlemi</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {DESTRUCTIVE.includes(action)
                      ? 'Bu işlem rezervasyon durumunu değiştirir ve işlem geçmişine kaydedilir. Finansal kayıtlar silinmez.'
                      : 'Durum geçişi merkezi sunucu kurallarıyla doğrulanır.'}
                  </AppText>
                  <TextField
                    label="İşlem notu (opsiyonel)"
                    value={actionNote}
                    onChangeText={setActionNote}
                    placeholder="Misafir talebi, açıklama…"
                  />
                  <View style={styles.buttonRow}>
                    <Button label="Vazgeç" variant="outline" onPress={() => setAction(null)} style={styles.flex} />
                    <Button
                      label="Onayla"
                      variant={DESTRUCTIVE.includes(action) ? 'danger' : 'primary'}
                      loading={transition.isPending}
                      onPress={() => void doAction()}
                      style={styles.flex}
                    />
                  </View>
                </AccCard>
              ) : null}

              {paymentOpen ? (
                <AccCard padding={13} style={[styles.actionPanel, { borderColor: theme.colors.borderStrong }]}>
                  <AppText variant="bodyStrong">Kasa hareketi</AppText>
                  <ChipsRow>
                    <Chip label="Tahsilat" active={paymentKind === 'payment'} onPress={() => setPaymentKind('payment')} />
                    <Chip label="Ek gider" active={paymentKind === 'charge'} onPress={() => setPaymentKind('charge')} />
                    <Chip label="İade" active={paymentKind === 'refund'} onPress={() => setPaymentKind('refund')} />
                  </ChipsRow>
                  <TextField
                    label="Tutar (₺)"
                    value={paymentAmount}
                    onChangeText={(next) => setPaymentAmount(next.replace(/[^\d.,]/g, ''))}
                    keyboardType="decimal-pad"
                  />
                  {paymentKind !== 'charge' ? (
                    <ChipsRow>
                      <Chip label="Nakit" active={paymentMethod === 'cash'} onPress={() => setPaymentMethod('cash')} />
                      <Chip label="POS" active={paymentMethod === 'pos'} onPress={() => setPaymentMethod('pos')} />
                      <Chip label="Banka" active={paymentMethod === 'bank'} onPress={() => setPaymentMethod('bank')} />
                    </ChipsRow>
                  ) : null}
                  {(cash.data?.accounts ?? []).length > 0 ? (
                    <ChipsRow>
                      {(cash.data?.accounts ?? [])
                        .filter((account) =>
                          paymentKind === 'charge'
                            ? account.kind === 'cash'
                            : paymentMethod === 'cash'
                              ? account.kind === 'cash'
                              : paymentMethod === 'pos'
                                ? account.kind === 'pos'
                                : account.kind === 'bank',
                        )
                        .map((account) => (
                          <Chip
                            key={account.id}
                            label={account.name}
                            active={cashAccountId === account.id}
                            onPress={() => setCashAccountId(account.id)}
                          />
                        ))}
                    </ChipsRow>
                  ) : null}
                  <TextField
                    label="Açıklama"
                    value={paymentNote}
                    onChangeText={setPaymentNote}
                    placeholder="Tahsilat / ek hizmet açıklaması"
                  />
                  <View style={styles.buttonRow}>
                    <Button label="Vazgeç" variant="outline" onPress={() => setPaymentOpen(false)} style={styles.flex} />
                    <Button label="Kaydet" loading={addFolio.isPending} onPress={() => void addPayment()} style={styles.flex} />
                  </View>
                </AccCard>
              ) : null}

              {paymentCancelOpen ? (
                <AccCard padding={13} style={[styles.actionPanel, { borderColor: theme.colors.danger }]}>
                  <AppText variant="bodyStrong">Ödeme alındı iptal edilsin mi?</AppText>
                  <AppText variant="caption" color="textTertiary">
                    {formatMoneyCents(data.paid_cents, data.currency)} tutarındaki tahsilat iade
                    hareketi olarak kaydedilir; rezervasyonun ödeme durumu yeniden hesaplanır.
                    Kayıt silinmez, işlem geçmişinde iz kalır.
                  </AppText>
                  <View style={styles.buttonRow}>
                    <Button
                      label="Vazgeç"
                      variant="outline"
                      onPress={() => setPaymentCancelOpen(false)}
                      style={styles.flex}
                    />
                    <Button
                      label="Ödeme alındı iptal"
                      variant="danger"
                      loading={addFolio.isPending}
                      onPress={() => void cancelPayment()}
                      style={styles.flex}
                    />
                  </View>
                </AccCard>
              ) : null}

              <View style={{ gap: 6 }}>
                <AppText variant="bodyStrong">İşlem geçmişi</AppText>
                {data.history.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Henüz durum geçmişi yok.
                  </AppText>
                ) : (
                  data.history.map((entry, index) => (
                    <View key={`${entry.to_status}-${index}`} style={styles.historyRow}>
                      <View style={[styles.historyDot, { backgroundColor: reservationTone(entry.to_status as never).color }]} />
                      <View style={styles.flex}>
                        <AppText variant="caption" color="textSecondary">
                          {reservationTone(entry.to_status as never).label}
                          {entry.from_status ? ` ← ${reservationTone(entry.from_status as never).label}` : ''}
                        </AppText>
                        {entry.note ? (
                          <AppText variant="caption" color="textTertiary">
                            {entry.note}
                          </AppText>
                        ) : null}
                      </View>
                      <View style={styles.historyMeta}>
                        {entry.actor_name ? (
                          <AppText variant="caption" color="textTertiary">
                            {entry.actor_name}
                          </AppText>
                        ) : null}
                        <AppText variant="caption" color="textTertiary">
                          {formatDateTime(entry.created_at)}
                        </AppText>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {data.folio.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <AppText variant="bodyStrong">Hesap hareketleri</AppText>
                  {data.folio.map((item) => (
                    <View key={item.id} style={styles.folioRow}>
                      <View style={styles.flex}>
                        <AppText variant="caption" color="textSecondary">
                          {item.description ?? item.category}
                        </AppText>
                        <AppText variant="caption" color="textTertiary">
                          {formatDate(item.occurred_on)} · {item.method ?? item.kind}
                        </AppText>
                      </View>
                      <AppText
                        variant="caption"
                        color={item.kind === 'payment' ? 'success' : item.kind === 'refund' ? 'danger' : 'text'}
                      >
                        {item.kind === 'payment' ? '+' : item.kind === 'refund' ? '-' : ''}
                        {formatMoneyCents(item.amount_cents, item.currency)}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.editForm}>
              <InfoBanner text="Tarih, oda veya fiyat değişikliği sunucuda müsaitlik ve çakışma kontrolünden geçer. Dış kanal rezervasyonlarında kısıtlar uygulanabilir." />

              <AccCard padding={13} style={[styles.actionPanel, { borderColor: theme.colors.borderStrong }]}>
                <AppText variant="overline" color="primaryDeep">
                  ÖDEME
                </AppText>
                <KeyValueRow
                  label="Tahsil edilen"
                  value={formatMoneyCents(data.paid_cents, data.currency)}
                />
                <KeyValueRow
                  label="Kalan bakiye"
                  value={formatMoneyCents(remainingCents, data.currency)}
                />
                {data.paid_cents > 0 ? (
                  paymentCancelOpen ? (
                    <View style={styles.buttonRow}>
                      <Button
                        label="Vazgeç"
                        variant="outline"
                        onPress={() => setPaymentCancelOpen(false)}
                        style={styles.flex}
                      />
                      <Button
                        label="Ödeme alındı iptal"
                        variant="danger"
                        loading={addFolio.isPending}
                        onPress={() => void cancelPayment()}
                        style={styles.flex}
                      />
                    </View>
                  ) : (
                    <Button
                      label="Ödeme alındı iptal"
                      variant="outline"
                      leftIcon={
                        <Ionicons name="close-circle-outline" size={16} color={theme.colors.danger} />
                      }
                      onPress={() => setPaymentCancelOpen(true)}
                    />
                  )
                ) : (
                  <AppText variant="caption" color="textTertiary">
                    Tahsil edilmiş ödeme yok. Ödeme almak için üstteki Ödeme alındı düğmesini kullan.
                  </AppText>
                )}
                {remainingCents > 0 ? (
                  <Button
                    label="Ödeme alındı"
                    size="sm"
                    variant="outline"
                    leftIcon={<Ionicons name="cash-outline" size={16} color={theme.colors.success} />}
                    onPress={() => {
                      setEditMode(false);
                      openPaymentPanel('payment');
                    }}
                  />
                ) : null}
              </AccCard>

              <View style={styles.row}>
                <TextField label="Misafir adı" value={guestName} onChangeText={setGuestName} containerStyle={styles.flex} />
                <TextField label="Telefon" value={guestPhone} onChangeText={setGuestPhone} keyboardType="phone-pad" containerStyle={styles.flex} />
              </View>
              <TextField label="E-posta" value={guestEmail} onChangeText={setGuestEmail} autoCapitalize="none" keyboardType="email-address" />
              <View style={styles.row}>
                <TextField label="Yetişkin" value={adults} onChangeText={(next) => setAdults(next.replace(/\D/g, ''))} keyboardType="number-pad" containerStyle={styles.flex} />
                <TextField label="Çocuk" value={children} onChangeText={(next) => setChildren(next.replace(/\D/g, ''))} keyboardType="number-pad" containerStyle={styles.flex} />
              </View>
              <DateField
                label="Konaklama tarihleri"
                mode="range"
                value={checkIn}
                endValue={checkOut}
                onChange={setCheckIn}
                onEndChange={(next) => setCheckOut(next)}
                hint={checkOut ? `${nightsBetween(checkIn, checkOut)} gece` : 'Çıkış seç'}
              />
              <AppText variant="label" color="textSecondary">
                Oda tipi
              </AppText>
              <ChipsRow>
                {roomTypes.map((roomType) => (
                  <Chip
                    key={roomType.id}
                    label={roomType.name}
                    active={roomTypeId === roomType.id}
                    onPress={() => {
                      setRoomTypeId(roomType.id);
                      setRoomId(null);
                      setRatePlanId(null);
                    }}
                  />
                ))}
              </ChipsRow>
              <AppText variant="label" color="textSecondary">
                Oda
              </AppText>
              <ChipsRow>
                <Chip label="Atanmadı" active={!roomId} onPress={() => setRoomId(null)} />
                {rooms.map((room) => {
                  const availabilityInfo = availability.data?.find((item) => item.id === room.id);
                  const busy = availabilityInfo?.busy ?? false;
                  return (
                    <Chip
                      key={room.id}
                      label={`${room.number}${busy ? ' · dolu' : ''}`}
                      active={roomId === room.id}
                      onPress={() => {
                        if (!busy) setRoomId(room.id);
                      }}
                    />
                  );
                })}
              </ChipsRow>
              <AppText variant="label" color="textSecondary">
                Fiyat planı
              </AppText>
              <ChipsRow>
                {plans.map((plan) => (
                  <Chip
                    key={plan.id}
                    label={plan.name}
                    active={ratePlanId === plan.id}
                    onPress={() => setRatePlanId(plan.id)}
                  />
                ))}
              </ChipsRow>
              <View style={styles.row}>
                <TextField label="Gecelik fiyat (₺)" value={nightlyPrice} onChangeText={(next) => setNightlyPrice(next.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" containerStyle={styles.flex} />
                <TextField label="İndirim (₺)" value={discount} onChangeText={(next) => setDiscount(next.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" containerStyle={styles.flex} />
              </View>
              <TextField label="Misafir notu" value={notes} onChangeText={setNotes} multiline />
              <TextField label="İç not" value={internalNotes} onChangeText={setInternalNotes} multiline />
              <View style={styles.buttonRow}>
                <Button label="Vazgeç" variant="outline" onPress={() => setEditMode(false)} style={styles.flex} />
                <Button label="Değişiklikleri kaydet" loading={update.isPending} onPress={() => void saveEdit()} style={styles.flex} />
              </View>
            </View>
          )}
        </View>
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { gap: 10 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  infoGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 36, borderRadius: 9 },
  actionLabel: { fontSize: 10 },
  actionPanel: { gap: 9, borderWidth: StyleSheet.hairlineWidth },
  buttonRow: { flexDirection: 'row', gap: 8 },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 4 },
  historyDot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
  historyMeta: { alignItems: 'flex-end', gap: 1 },
  folioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  editForm: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  footer: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  footerButton: { flexGrow: 1, flexBasis: 140 },
});
