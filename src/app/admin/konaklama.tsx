import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { useTheme } from '@/theme/ThemeProvider';

import { ModalSheet } from '@/features/accommodation/components/AccommodationUI';
import {
  useAdminProperties,
  useReviewProperty,
} from '@/features/accommodation/hooks/use-accommodation';
import { accommodationDocumentUrl } from '@/features/accommodation/services/accommodation-media-service';
import type { AdminProperty } from '@/features/accommodation/types';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  VERIFICATION_STATUS_LABELS,
  formatDate,
} from '@/features/accommodation/utils/format';

type StatusFilter = 'pending' | 'published' | 'rejected' | 'all';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Onay bekleyen' },
  { key: 'published', label: 'Yayında' },
  { key: 'rejected', label: 'Reddedilen' },
  { key: 'all', label: 'Tümü' },
];

export default function AdminAccommodationScreen() {
  const { theme } = useTheme();
  const me = useAdminMe();
  const [status, setStatus] = useState<StatusFilter>('pending');
  const properties = useAdminProperties(status);
  const [selected, setSelected] = useState<AdminProperty | null>(null);

  const items = properties.data?.items ?? [];
  const counts = properties.data?.counts;

  if (!me.isLoading && me.data && !me.data.is_admin) {
    return (
      <AdminPage title="Konaklama doğrulama" subtitle="Bu ekran yalnızca yöneticilere açıktır.">
        <AdminSection title="Yetki gerekli">
          <AppText variant="body" color="textSecondary">
            Tesis doğrulama işlemleri için yönetici yetkisi gerekir.
          </AppText>
        </AdminSection>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="Konaklama doğrulama"
      subtitle="Tesis başvurularını, işletme belgelerini ve yayın durumunu incele. Doğrulanmamış tesis kamuya açık rezervasyon satışına açılmaz."
      refreshing={properties.isRefetching}
      onRefresh={() => void properties.refetch()}
      actions={
        <Badge
          label={counts ? `${counts.pending} onay bekliyor` : 'Yükleniyor…'}
          tone={counts && counts.pending > 0 ? 'warning' : 'neutral'}
        />
      }
    >
      <View style={styles.stats}>
        <StatCard label="Onay bekleyen" value={counts?.pending ?? 0} tone={theme.colors.warning} icon="hourglass-outline" />
        <StatCard label="Yayında" value={counts?.published ?? 0} tone={theme.colors.success} icon="checkmark-circle-outline" />
        <StatCard label="Reddedilen" value={counts?.rejected ?? 0} tone={theme.colors.danger} icon="close-circle-outline" />
        <StatCard label="Askıda" value={counts?.suspended ?? 0} tone={theme.colors.textTertiary} icon="pause-circle-outline" />
      </View>

      <FilterChips
        options={FILTERS.map((filter) => ({
          ...filter,
          count:
            filter.key === 'pending'
              ? counts?.pending
              : filter.key === 'published'
                ? counts?.published
                : filter.key === 'rejected'
                  ? counts?.rejected
                  : undefined,
        }))}
        value={status}
        onChange={setStatus}
      />

      {properties.isLoading ? (
        <AdminSection title="Başvurular yükleniyor">
          <AppText variant="caption" color="textTertiary">Tesis kayıtları getiriliyor…</AppText>
        </AdminSection>
      ) : properties.isError ? (
        <AdminSection title="Başvurular yüklenemedi">
          <AppText variant="caption" color="danger">
            {properties.error instanceof Error ? properties.error.message : 'Bilinmeyen hata'}
          </AppText>
          <Button label="Tekrar dene" size="sm" variant="outline" fullWidth={false} onPress={() => void properties.refetch()} />
        </AdminSection>
      ) : items.length === 0 ? (
        <AdminSection title="Kayıt yok" subtitle="Seçilen durumda tesis başvurusu bulunmuyor.">
          <AppText variant="caption" color="textTertiary">
            Yeni başvurular geldiğinde burada listelenir. Onay bekleyen sekmesini kontrol edebilirsin.
          </AppText>
        </AdminSection>
      ) : (
        <View style={styles.grid}>
          {items.map((property) => (
            <PropertyReviewCard
              key={property.id}
              property={property}
              onPress={() => setSelected(property)}
            />
          ))}
        </View>
      )}

      <ReviewModal key={selected?.id ?? 'none'} property={selected} onClose={() => setSelected(null)} />
    </AdminPage>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={16} color={tone} />
      </View>
      <AppText variant="h2" style={{ color: tone }}>{value}</AppText>
      <AppText variant="caption" color="textTertiary" numberOfLines={1}>{label}</AppText>
    </View>
  );
}

function PropertyReviewCard({ property, onPress }: { property: AdminProperty; onPress: () => void }) {
  const { theme } = useTheme();
  const pendingDocs = property.documents.filter((document) => document.status === 'pending').length;
  const tone =
    property.verification_status === 'verified'
      ? theme.colors.success
      : property.verification_status === 'rejected'
        ? theme.colors.danger
        : theme.colors.warning;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${property.name} başvurusunu incele`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="business-outline" size={18} color={theme.colors.primary} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={1}>{property.name}</AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {PROPERTY_TYPE_LABELS[property.property_type]}
            {property.district ? ` · ${property.district}` : ''}
          </AppText>
        </View>
        <View style={[styles.dot, { backgroundColor: tone }]} />
      </View>

      <View style={styles.metaRow}>
        <Badge label={PROPERTY_STATUS_LABELS[property.status]} tone="neutral" />
        <Badge
          label={VERIFICATION_STATUS_LABELS[property.verification_status]}
          tone={property.verification_status === 'verified' ? 'success' : 'warning'}
        />
        {pendingDocs > 0 ? <Badge label={`${pendingDocs} belge`} tone="warning" /> : null}
      </View>

      <View style={styles.metaRow}>
        <AppText variant="caption" color="textTertiary">
          {property.owner.display_name ?? property.owner.username}
        </AppText>
        <AppText variant="caption" color="textTertiary">·</AppText>
        <AppText variant="caption" color="textTertiary">{formatDate(property.created_at)}</AppText>
      </View>

      <View style={styles.metaRow}>
        <AppText variant="caption" color="textSecondary">
          {property.room_type_count} oda tipi · {property.room_count} fiziksel oda
        </AppText>
      </View>

      {property.missing.length > 0 ? (
        <AppText variant="caption" color="warning" numberOfLines={2}>
          Eksik: {property.missing.slice(0, 3).join(', ')}
          {property.missing.length > 3 ? ` +${property.missing.length - 3}` : ''}
        </AppText>
      ) : (
        <AppText variant="caption" color="success">Zorunlu bilgiler tamam</AppText>
      )}
    </Pressable>
  );
}

function ReviewModal({ property, onClose }: { property: AdminProperty | null; onClose: () => void }) {
  const { theme } = useTheme();
  const review = useReviewProperty();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);

  const close = () => {
    setNote('');
    setError(null);
    setConfirmReject(false);
    onClose();
  };

  if (!property) return null;

  const openDocument = async (path: string) => {
    setError(null);
    const url = await accommodationDocumentUrl(path);
    if (!url) {
      setError('Belge bağlantısı oluşturulamadı. Yetki veya depolama ayarını kontrol et.');
      return;
    }
    await Linking.openURL(url);
  };

  const decide = async (approve: boolean) => {
    setError(null);
    if (!approve && note.trim().length < 5) {
      setError('Reddetmek için en az 5 karakterlik bir gerekçe yazmalısın.');
      return;
    }
    try {
      await review.mutateAsync({ propertyId: property.id, approve, note: note.trim() || null });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    }
  };

  return (
    <ModalSheet
      visible={Boolean(property)}
      onClose={close}
      title={property.name}
      subtitle={`${PROPERTY_TYPE_LABELS[property.property_type]} · ${property.owner.display_name ?? property.owner.username}`}
      maxWidth={620}
      footer={
        <View style={styles.footer}>
          <Button
            label={confirmReject ? 'Reddi onayla' : 'Reddet'}
            variant="danger"
            fullWidth={false}
            loading={review.isPending}
            onPress={() => {
              if (confirmReject) void decide(false);
              else setConfirmReject(true);
            }}
          />
          <Button
            label="Doğrula ve yayınla"
            fullWidth={false}
            loading={review.isPending}
            disabled={property.missing.length > 0}
            onPress={() => void decide(true)}
          />
        </View>
      }
    >
      <View style={{ gap: 12 }}>
        {error ? (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger }]}>
            <AppText variant="caption" color="danger">{error}</AppText>
          </View>
        ) : null}

        <View style={styles.detailGrid}>
          <Detail label="Durum" value={PROPERTY_STATUS_LABELS[property.status]} />
          <Detail label="Doğrulama" value={VERIFICATION_STATUS_LABELS[property.verification_status]} />
          <Detail label="Tesis türü" value={PROPERTY_TYPE_LABELS[property.property_type]} />
          <Detail label="İlçe" value={property.district ?? '—'} />
          <Detail label="Telefon" value={property.phone ?? '—'} />
          <Detail label="E-posta" value={property.email ?? '—'} />
          <Detail label="Vergi no" value={property.tax_number ?? '—'} />
          <Detail label="Kapasite" value={`${property.room_type_count} tip / ${property.room_count} oda`} />
        </View>

        <View>
          <AppText variant="label" color="textSecondary" style={styles.blockLabel}>Adres</AppText>
          <AppText variant="body">{property.address ?? 'Adres girilmedi'}</AppText>
        </View>

        <View>
          <AppText variant="label" color="textSecondary" style={styles.blockLabel}>
            Eksik zorunlu bilgiler ({property.missing.length})
          </AppText>
          {property.missing.length === 0 ? (
            <AppText variant="caption" color="success">Tesis yayına hazır görünüyor.</AppText>
          ) : (
            <View style={styles.missingList}>
              {property.missing.map((missing) => (
                <View key={missing} style={[styles.missingChip, { backgroundColor: theme.colors.warningSoft }]}>
                  <Ionicons name="alert-circle-outline" size={11} color={theme.colors.warning} />
                  <AppText variant="caption" color="warning">{missing}</AppText>
                </View>
              ))}
            </View>
          )}
        </View>

        <View>
          <AppText variant="label" color="textSecondary" style={styles.blockLabel}>
            Belgeler ({property.documents.length})
          </AppText>
          {property.documents.length === 0 ? (
            <AppText variant="caption" color="warning">Belge yüklenmemiş. Doğrulama için gerekli belgeleri isteyin.</AppText>
          ) : (
            <View style={{ gap: 6 }}>
              {property.documents.map((document) => (
                <View key={document.id} style={[styles.docRow, { borderColor: theme.colors.border }]}>
                  <Ionicons name="document-text-outline" size={15} color={theme.colors.textSecondary} />
                  <View style={styles.flex}>
                    <AppText variant="caption" numberOfLines={1}>{document.title}</AppText>
                    <AppText variant="caption" color="textTertiary">
                      {document.kind} · {document.status === 'approved' ? 'Onaylı' : document.status === 'rejected' ? 'Reddedildi' : 'Bekliyor'}
                    </AppText>
                  </View>
                  <Button label="Aç" size="sm" variant="ghost" fullWidth={false} onPress={() => void openDocument(document.storage_path)} />
                </View>
              ))}
            </View>
          )}
        </View>

        {confirmReject ? (
          <View style={[styles.rejectBox, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="warning-outline" size={16} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={styles.flex}>
              Reddetme tesisin yayınını kaldırır ve doğrulama durumunu reddedildi yapar. Açıklama zorunludur.
            </AppText>
          </View>
        ) : null}

        <TextField
          label={confirmReject ? 'Red gerekçesi *' : 'Doğrulama notu'}
          value={note}
          onChangeText={setNote}
          placeholder="Belge eksikliği, adres uyuşmazlığı veya onay notu…"
          multiline
        />
      </View>
    </ModalSheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <AppText variant="caption" color="textTertiary">{label}</AppText>
      <AppText variant="caption" color="text" numberOfLines={2}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    flex: 1,
    minWidth: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 11,
    gap: 2,
  },
  statIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  card: {
    width: '32%',
    minWidth: 290,
    flexGrow: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 7,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  detail: { width: '31%', minWidth: 140, gap: 1 },
  blockLabel: { marginBottom: 4 },
  missingList: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  missingChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  rejectBox: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 8 },
  errorBox: { padding: 9, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  footer: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' },
});
