import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAccommodationDocuments,
  useAttachDocument,
  useCreateDocument,
  useReservations,
} from '../hooks/use-accommodation';
import {
  accommodationDocumentUrl,
  uploadAccommodationDocument,
} from '../services/accommodation-media-service';
import type { AccommodationDocument } from '../types';
import {
  formatDate,
  formatDateTime,
  formatMoneyCents,
  reservationTone,
} from '../utils/format';
import { exportDocumentPdf } from '../utils/pdf-excel-export';
import {
  AccCard,
  Chip,
  EmptyState,
  InlineError,
  InfoBanner,
  KeyValueRow,
  LoadingBlock,
  ModalSheet,
  StatusPill,
} from './AccommodationUI';

type KindFilter = 'all' | 'reservation' | 'invoice' | 'receipt' | 'statement';
type DocKind = Exclude<KindFilter, 'all'>;

const KIND_LABELS: Record<DocKind, string> = {
  reservation: 'Rezervasyon belgesi',
  invoice: 'Fatura',
  receipt: 'Fiş / makbuz',
  statement: 'Ekstre',
};

const KIND_ICONS: Record<DocKind, React.ComponentProps<typeof Ionicons>['name']> = {
  reservation: 'calendar-outline',
  invoice: 'document-text-outline',
  receipt: 'receipt-outline',
  statement: 'list-outline',
};

function snapshotObject(document: AccommodationDocument, key: string): Record<string, unknown> | null {
  const value = document.snapshot?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function DocumentsCenter({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const [filter, setFilter] = useState<KindFilter>('all');
  const documents = useAccommodationDocuments(propertyId, filter);
  const create = useCreateDocument(propertyId);
  const attach = useAttachDocument();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DocKind>('invoice');
  const [title, setTitle] = useState('');
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [reservationQuery, setReservationQuery] = useState('');
  const [detail, setDetail] = useState<AccommodationDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reservations = useReservations(propertyId, { status: 'all', limit: 100 });
  const reservationRows = useMemo(() => {
    const rows = reservations.data?.items ?? [];
    const query = reservationQuery.trim().toLocaleLowerCase('tr');
    if (!query) return rows.slice(0, 8);
    return rows
      .filter(
        (row) =>
          row.guest_name.toLocaleLowerCase('tr').includes(query) ||
          row.code.toLocaleLowerCase('tr').includes(query),
      )
      .slice(0, 8);
  }, [reservations.data?.items, reservationQuery]);

  const items = documents.data?.items ?? [];
  const selectedReservation = reservations.data?.items.find((row) => row.id === reservationId) ?? null;

  const openCreate = () => {
    setKind('invoice');
    setTitle('');
    setReservationId(null);
    setReservationQuery('');
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    if (kind !== 'statement' && !reservationId) {
      setError('Bu belge türü için rezervasyon seçmelisin.');
      return;
    }
    try {
      await create.mutateAsync({
        kind,
        reservationId,
        title: title.trim() || null,
      });
      setOpen(false);
      void documents.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Belge oluşturulamadı.');
    }
  };

  const generatePdf = async (document: AccommodationDocument) => {
    setBusyId(document.id);
    setError(null);
    try {
      const result = await exportDocumentPdf(document);
      if (!result.ok) setError(result.error.message);
    } finally {
      setBusyId(null);
    }
  };

  const openStoredFile = async (document: AccommodationDocument) => {
    if (!document.storage_path) {
      setError('Bu belgeye ekli dosya yok. Yeni bir dosya ekleyebilir veya PDF oluşturabilirsin.');
      return;
    }
    const url = await accommodationDocumentUrl(document.storage_path);
    if (!url) {
      setError('Belge bağlantısı oluşturulamadı.');
      return;
    }
    await Linking.openURL(url);
  };

  const pickFile = async (document: AccommodationDocument) => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusyId(document.id);
    try {
      const uploaded = await uploadAccommodationDocument({
        propertyId,
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? 'application/pdf',
        size: asset.size ?? null,
      });
      if (!uploaded.ok) {
        setError(uploaded.error.message);
        return;
      }
      await attach.mutateAsync({ documentId: document.id, storagePath: uploaded.data.path });
      void documents.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dosya eklenemedi.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Fatura ve belgeler</AppText>
          <AppText variant="caption" color="textTertiary">
            {items.length} belge · değiştirilemez anlık görüntü
          </AppText>
        </View>
        <Button
          label="Belge oluştur"
          size="sm"
          fullWidth={false}
          leftIcon={<Ionicons name="document-text-outline" size={15} color={theme.colors.onPrimary} />}
          onPress={openCreate}
        />
      </View>

      <View style={styles.filters}>
        {(
          [
            { value: 'all', label: 'Tümü' },
            { value: 'reservation', label: 'Rezervasyon' },
            { value: 'invoice', label: 'Fatura' },
            { value: 'receipt', label: 'Fiş' },
            { value: 'statement', label: 'Ekstre' },
          ] as { value: KindFilter; label: string }[]
        ).map((entry) => (
          <Chip
            key={entry.value}
            label={entry.label}
            active={filter === entry.value}
            onPress={() => setFilter(entry.value)}
          />
        ))}
      </View>

      {error ? <InlineError message={error} /> : null}

      {documents.isLoading ? (
        <LoadingBlock height={220} />
      ) : documents.isError ? (
        <InlineError
          message={documents.error instanceof Error ? documents.error.message : 'Belgeler yüklenemedi.'}
          onRetry={() => void documents.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="Belge yok"
          message="Rezervasyon, fatura veya ekstre belgesi oluştur. Belge oluşturulduğu andaki tesis ve rezervasyon bilgilerini saklar."
          compact
        />
      ) : (
        <View style={styles.list}>
          {items.map((document) => {
            const snapshotReservation = snapshotObject(document, 'reservation');
            return (
              <AccCard key={document.id} padding={12} style={styles.row}>
                <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name={KIND_ICONS[document.kind]} size={17} color={theme.colors.primary} />
                </View>
                <View style={styles.flex}>
                  <View style={styles.titleRow}>
                    <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                      {document.title}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {document.number}
                    </AppText>
                  </View>
                  <View style={styles.metaRow}>
                    <AppText variant="caption" color="textSecondary">
                      {KIND_LABELS[document.kind]}
                    </AppText>
                    <AppText variant="caption" color="textTertiary">
                      {formatDateTime(document.issued_at)}
                    </AppText>
                    {document.guest_name ? (
                      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                        {document.guest_name}
                      </AppText>
                    ) : null}
                    {document.storage_path ? (
                      <View style={styles.attached}>
                        <Ionicons name="attach" size={10} color={theme.colors.success} />
                        <AppText variant="caption" style={[styles.tiny, { color: theme.colors.success }]}>
                          Dosya ekli
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  {snapshotReservation ? (
                    <View style={styles.metaRow}>
                      <StatusPill
                        label={String(snapshotReservation.payment_status === 'paid' ? 'Ödendi' : snapshotReservation.payment_status === 'partial' ? 'Kısmi' : 'Ödenmedi')}
                        color={theme.colors.textSecondary}
                        background={theme.colors.surfaceMuted}
                      />
                      <AppText variant="caption" color="textTertiary">
                        {String(snapshotReservation.code ?? '')} · {String(snapshotReservation.check_in ?? '')} → {String(snapshotReservation.check_out ?? '')}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <View style={styles.amountCol}>
                  <AppText variant="bodyStrong">{formatMoneyCents(document.total_cents)}</AppText>
                  <View style={styles.rowActions}>
                    <IconButton icon="eye-outline" label="Detay" onPress={() => setDetail(document)} />
                    <IconButton icon="download-outline" label="PDF" busy={busyId === document.id} onPress={() => void generatePdf(document)} />
                    <IconButton
                      icon={document.storage_path ? 'open-outline' : 'attach-outline'}
                      label={document.storage_path ? 'Dosyayı aç' : 'Dosya ekle'}
                      busy={busyId === document.id}
                      onPress={() => void (document.storage_path ? openStoredFile(document) : pickFile(document))}
                    />
                  </View>
                </View>
              </AccCard>
            );
          })}
        </View>
      )}

      <InfoBanner text="Belgeler oluşturuldukları andaki bilgileri anlık görüntü olarak saklar. Rezervasyon veya fiyatlar sonradan değişse bile geçmiş belge içeriği değişmez; bu nedenle mali kayıtlar denetlenebilir kalır." />

      <ModalSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Yeni belge"
        subtitle="Belge türü ve ilgili rezervasyon"
        maxWidth={520}
        footer={<Button label="Oluştur" loading={create.isPending} onPress={() => void submit()} />}
      >
        <View style={{ gap: 11 }}>
          {error ? <InlineError message={error} /> : null}
          <View>
            <AppText variant="label" color="textSecondary" style={styles.fieldLabel}>Belge türü</AppText>
            <View style={styles.filters}>
              {(Object.keys(KIND_LABELS) as DocKind[]).map((value) => (
                <Chip key={value} label={KIND_LABELS[value]} active={kind === value} onPress={() => setKind(value)} />
              ))}
            </View>
          </View>
          <TextField
            label="Belge başlığı (opsiyonel)"
            value={title}
            onChangeText={setTitle}
            placeholder={KIND_LABELS[kind]}
          />

          {kind !== 'statement' ? (
            <View>
              <TextField
                label="Rezervasyon ara"
                value={reservationQuery}
                onChangeText={setReservationQuery}
                placeholder="Misafir adı veya rezervasyon kodu"
              />
              <View style={[styles.reservationList, { borderColor: theme.colors.border }]}>
                {reservationRows.length === 0 ? (
                  <AppText variant="caption" color="textTertiary" style={styles.noRows}>
                    Eşleşen rezervasyon bulunamadı.
                  </AppText>
                ) : (
                  reservationRows.map((row) => {
                    const active = row.id === reservationId;
                    return (
                      <Pressable
                        key={row.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setReservationId(row.id)}
                        style={[
                          styles.reservationRow,
                          {
                            backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                            borderBottomColor: theme.colors.divider,
                          },
                        ]}
                      >
                        <View style={styles.flex}>
                          <AppText variant="caption" color="text" numberOfLines={1}>{row.guest_name}</AppText>
                          <AppText variant="caption" color="textTertiary" style={styles.tiny}>
                            {row.code} · {formatDate(row.check_in)} → {formatDate(row.check_out)}
                          </AppText>
                        </View>
                        <StatusPill
                          label={reservationTone(row.status).label}
                          color={reservationTone(row.status).color}
                          background={reservationTone(row.status).background}
                        />
                      </Pressable>
                    );
                  })
                )}
              </View>
              {selectedReservation ? (
                <AppText variant="caption" color="textSecondary" style={styles.selectedHint}>
                  Seçili: {selectedReservation.guest_name} · {formatMoneyCents(selectedReservation.total_cents)}
                </AppText>
              ) : null}
            </View>
          ) : (
            <InfoBanner text="Ekstre için rezervasyon seçimi zorunlu değildir; tesisin o güne kadarki kayıtları belgeye işlenir." />
          )}
        </View>
      </ModalSheet>

      <ModalSheet
        visible={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title ?? 'Belge'}
        subtitle={detail?.number}
        maxWidth={560}
        footer={
          detail ? (
            <View style={styles.modalFooter}>
              <Button label="Kapat" variant="ghost" fullWidth={false} onPress={() => setDetail(null)} />
              <Button label="PDF oluştur" fullWidth={false} loading={busyId === detail.id} onPress={() => void generatePdf(detail)} />
            </View>
          ) : undefined
        }
      >
        {detail ? (
          <View style={{ gap: 8 }}>
            <KeyValueRow label="Tür" value={KIND_LABELS[detail.kind]} />
            <KeyValueRow label="Düzenlenme" value={formatDateTime(detail.issued_at)} />
            <KeyValueRow label="Toplam" value={formatMoneyCents(detail.total_cents)} />
            {detail.guest_name ? <KeyValueRow label="Misafir" value={detail.guest_name} /> : null}
            {detail.reservation_code ? <KeyValueRow label="Rezervasyon" value={detail.reservation_code} /> : null}
            {snapshotObject(detail, 'property') ? (
              <>
                <AppText variant="label" color="textSecondary" style={styles.section}>Tesis bilgileri</AppText>
                {Object.entries(snapshotObject(detail, 'property') ?? {}).map(([key, value]) =>
                  value ? <KeyValueRow key={key} label={key} value={String(value)} /> : null,
                )}
              </>
            ) : null}
            {snapshotObject(detail, 'reservation') ? (
              <>
                <AppText variant="label" color="textSecondary" style={styles.section}>Rezervasyon</AppText>
                {Object.entries(snapshotObject(detail, 'reservation') ?? {}).map(([key, value]) =>
                  value === null || value === undefined || value === '' ? null : (
                    <KeyValueRow key={key} label={key} value={String(value)} />
                  ),
                )}
              </>
            ) : null}
            <AppText variant="caption" color="textTertiary">
              Belge oluşturulduğu andaki verileri saklar ve sonradan değiştirilemez.
            </AppText>
          </View>
        ) : null}
      </ModalSheet>
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { opacity: busy ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={15} color={theme.colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  filters: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  list: { gap: 7 },
  row: { flexDirection: 'row', gap: 9, alignItems: 'center', flexWrap: 'wrap' },
  icon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 1 },
  tiny: { fontSize: 9 },
  attached: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  amountCol: { alignItems: 'flex-end', gap: 3 },
  rowActions: { flexDirection: 'row', gap: 2 },
  iconButton: { padding: 4, borderRadius: 6 },
  fieldLabel: { marginBottom: 6 },
  reservationList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, marginTop: 6, overflow: 'hidden' },
  reservationRow: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  noRows: { padding: 10 },
  selectedHint: { marginTop: 6 },
  modalFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  section: { marginTop: 8 },
});
