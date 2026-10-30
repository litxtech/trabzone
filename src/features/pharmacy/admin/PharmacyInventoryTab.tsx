import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAdminPharmacies,
  useAdminPharmacy,
  useDebounced,
  useUpdateAdminPharmacy,
} from '../hooks/use-pharmacy';
import type { AdminPharmacyFilters } from '../services/pharmacy-service';
import {
  adminPharmacyStyles,
  EmptyHint,
  formatDateTime,
  Pill,
  RowCard,
} from './shared';

type MissingFilter = NonNullable<AdminPharmacyFilters['missing']>;

const MISSING_OPTIONS: { key: MissingFilter | null; label: string }[] = [
  { key: null, label: 'Tümü' },
  { key: 'address', label: 'Eksik adres' },
  { key: 'phone', label: 'Eksik telefon' },
  { key: 'neighborhood', label: 'Eksik mahalle' },
  { key: 'hours', label: 'Eksik saat' },
  { key: 'coordinates', label: 'Eksik koordinat' },
  { key: 'verified', label: 'Doğrulanmamış' },
];

const PAGE_SIZE = 25;

export function PharmacyInventoryTab({
  canManage,
  districts,
}: {
  canManage: boolean;
  districts: string[];
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [query, setQuery] = useState('');
  const [district, setDistrict] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingFilter | null>(null);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounced = useDebounced(query, 350);

  const filters = useMemo<AdminPharmacyFilters>(
    () => ({
      district: district ?? null,
      query: debounced.trim() || null,
      missing,
      limit: PAGE_SIZE,
      offset,
    }),
    [district, debounced, missing, offset],
  );

  const list = useAdminPharmacies(filters);
  const detail = useAdminPharmacy(selectedId);
  const update = useUpdateAdminPharmacy(selectedId);

  const [form, setForm] = useState({
    neighborhood: '',
    address: '',
    phone: '',
    lat: '',
    lng: '',
    verified: false,
    dutyTracking: true,
    notes: '',
  });

  useEffect(() => {
    if (!detail.data) {
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    setForm({
      neighborhood: detail.data.neighborhood ?? '',
      address: detail.data.address ?? '',
      phone: detail.data.phone ?? '',
      lat: detail.data.lat != null ? String(detail.data.lat) : '',
      lng: detail.data.lng != null ? String(detail.data.lng) : '',
      verified: Boolean(detail.data.data_verified_at),
      dutyTracking: detail.data.duty_tracking,
      notes: detail.data.notes ?? '',
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [detail.data]);

  const invalidCoordinates =
    (form.lat.trim().length > 0) !== (form.lng.trim().length > 0) ||
    (form.lat.trim().length > 0 && Number.isNaN(Number(form.lat.replace(',', '.')))) ||
    (form.lng.trim().length > 0 && Number.isNaN(Number(form.lng.replace(',', '.'))));

  async function save() {
    if (!selectedId) {
      return;
    }
    if (invalidCoordinates) {
      toast.error('Enlem ve boylam birlikte, sayısal olarak girilmeli.');
      return;
    }
    try {
      await update.mutateAsync({
        neighborhood: form.neighborhood.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        notes: form.notes.trim(),
        verified: form.verified,
        duty_tracking: form.dutyTracking,
        ...(form.lat.trim() && form.lng.trim()
          ? {
              lat: Number(form.lat.replace(',', '.')),
              lng: Number(form.lng.replace(',', '.')),
            }
          : {}),
      });
      toast.success('Eczane kaydı güncellendi ve denetim kaydına yazıldı.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kayıt güncellenemedi.';
      toast.error(
        message.includes('coordinates_out_of_bounds')
          ? 'Koordinatlar Trabzon sınırları dışında görünüyor.'
          : message,
      );
    }
  }

  return (
    <View style={adminPharmacyStyles.stack}>
      <AdminSection
        title="Eczane envanteri"
        subtitle="Trabzon geneli eczane kayıtları, eksik alanlar ve doğrulama durumu"
      >
        <TextField
          label="Ara"
          placeholder="Eczane, mahalle veya adres"
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          leftIcon="search-outline"
          autoCapitalize="none"
        />
        <View style={{ gap: 8 }}>
          <AppText variant="caption" color="textTertiary">
            İlçe
          </AppText>
          <FilterChips
            options={[
              { key: 'all', label: 'Tüm ilçeler' },
              ...districts.map((item) => ({ key: item, label: item })),
            ]}
            value={district ?? 'all'}
            onChange={(next) => {
              setDistrict(next === 'all' ? null : next);
              setOffset(0);
            }}
          />
        </View>
        <View style={{ gap: 8 }}>
          <AppText variant="caption" color="textTertiary">
            Veri eksikliği
          </AppText>
          <FilterChips
            options={MISSING_OPTIONS.map((item) => ({
              key: item.key ?? 'none',
              label: item.label,
            }))}
            value={missing ?? 'none'}
            onChange={(next) => {
              setMissing(next === 'none' ? null : (next as MissingFilter));
              setOffset(0);
            }}
          />
        </View>
        <AppText variant="caption" color="textTertiary">
          Eksik alanlar gizlenmez; kayıtlar &quot;doğrulanmadı&quot; etiketiyle listelenir. Toplu
          eczane listesi yalnızca izinli kaynaklardan aktarılmalıdır.
        </AppText>
      </AdminSection>

      {selectedId ? (
        <AdminSection
          title={detail.data?.name ?? 'Eczane kaydı'}
          subtitle={
            detail.data
              ? `${detail.data.district ?? 'İlçe bilinmiyor'} · Son doğrulama: ${formatDateTime(
                  detail.data.data_verified_at,
                )}`
              : 'Kayıt yükleniyor…'
          }
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Düzenlemeyi kapat"
              onPress={() => setSelectedId(null)}
              hitSlop={8}
            >
              <Ionicons name="close-circle-outline" size={22} color={theme.colors.textTertiary} />
            </Pressable>
          }
        >
          {detail.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : detail.isError ? (
            <EmptyHint
              icon="cloud-offline-outline"
              title="Kayıt yüklenemedi"
              text={detail.error instanceof Error ? detail.error.message : undefined}
            />
          ) : (
            <>
              <View style={adminPharmacyStyles.formRow}>
                <TextField
                  label="Mahalle"
                  containerStyle={adminPharmacyStyles.grow}
                  value={form.neighborhood}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, neighborhood: value }))}
                />
                <TextField
                  label="Telefon"
                  containerStyle={adminPharmacyStyles.grow}
                  value={form.phone}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, phone: value }))}
                  keyboardType="phone-pad"
                  placeholder="+90…"
                />
              </View>
              <TextField
                label="Açık adres"
                value={form.address}
                onChangeText={(value) => setForm((prev) => ({ ...prev, address: value }))}
                multiline
              />
              <View style={adminPharmacyStyles.formRow}>
                <TextField
                  label="Enlem"
                  containerStyle={adminPharmacyStyles.grow}
                  value={form.lat}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, lat: value }))}
                  keyboardType="numbers-and-punctuation"
                  placeholder="40.99…"
                  error={invalidCoordinates ? 'Enlem ve boylam birlikte girilmeli' : null}
                />
                <TextField
                  label="Boylam"
                  containerStyle={adminPharmacyStyles.grow}
                  value={form.lng}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, lng: value }))}
                  keyboardType="numbers-and-punctuation"
                  placeholder="39.72…"
                />
              </View>
              <TextField
                label="Yönetici notu"
                value={form.notes}
                onChangeText={(value) => setForm((prev) => ({ ...prev, notes: value }))}
                multiline
                placeholder="Kaynak, doğrulama yöntemi veya eksik bilgi notu"
              />
              <View style={[adminPharmacyStyles.inline, { justifyContent: 'space-between' }]}>
                <ToggleRow
                  label="Veri doğrulandı"
                  hint="Yalnızca gerçekten kontrol edilen kayıtlar için işaretleyin"
                  value={form.verified}
                  onChange={(value) => setForm((prev) => ({ ...prev, verified: value }))}
                  disabled={!canManage}
                />
                <ToggleRow
                  label="Nöbet takibi"
                  hint="Bu eczane nöbet listelerinde izlenecek"
                  value={form.dutyTracking}
                  onChange={(value) => setForm((prev) => ({ ...prev, dutyTracking: value }))}
                  disabled={!canManage}
                />
              </View>
              <View style={styles.footer}>
                <AppText variant="caption" color="textTertiary" style={styles.flex}>
                  Güncelleme: {formatDateTime(detail.data?.updated_at)}
                </AppText>
                <Button
                  label="Kaydet"
                  size="sm"
                  fullWidth={false}
                  loading={update.isPending}
                  disabled={!canManage}
                  onPress={() => void save()}
                />
              </View>
              {!canManage ? (
                <AppText variant="caption" color="warning">
                  Kaydetmek için pharmacy.manage izni gerekir. Alanlar salt okunur.
                </AppText>
              ) : null}
            </>
          )}
        </AdminSection>
      ) : null}

      {list.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : list.isError ? (
        <EmptyHint
          icon="cloud-offline-outline"
          title="Envanter yüklenemedi"
          text={list.error instanceof Error ? list.error.message : undefined}
        />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyHint
          icon="medkit-outline"
          title="Bu filtreyle eczane bulunamadı"
          text="Arama veya filtreleri değiştirin. Envanterin tam olduğu iddia edilmez."
        />
      ) : (
        <View style={adminPharmacyStyles.stack}>
          {list.data?.items.map((item) => (
            <RowCard
              key={item.id}
              selected={selectedId === item.id}
              onPress={() => setSelectedId(item.id)}
              title={
                <>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {item.name}
                  </AppText>
                  <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                    {[item.neighborhood, item.district].filter(Boolean).join(' · ') || 'Konum bilinmiyor'}
                  </AppText>
                </>
              }
              badges={
                <>
                  {item.data_verified_at ? (
                    <Badge label="Doğrulandı" tone="success" />
                  ) : (
                    <Badge label="Doğrulanmadı" tone="warning" />
                  )}
                  {item.duty_rows === 0 ? <Badge label="Nöbet kaydı yok" tone="neutral" /> : null}
                </>
              }
              meta={
                <>
                  <Pill
                    icon={item.address ? 'location-outline' : 'alert-circle-outline'}
                    label={item.address ? 'Adres var' : 'Adres eksik'}
                    tone={item.address ? 'success' : 'warning'}
                  />
                  <Pill
                    icon={item.phone ? 'call-outline' : 'alert-circle-outline'}
                    label={item.phone ? 'Telefon var' : 'Telefon eksik'}
                    tone={item.phone ? 'success' : 'warning'}
                  />
                  <Pill
                    icon={item.lat != null && item.lng != null ? 'map-outline' : 'alert-circle-outline'}
                    label={item.lat != null && item.lng != null ? 'Koordinat var' : 'Koordinat eksik'}
                    tone={item.lat != null && item.lng != null ? 'success' : 'warning'}
                  />
                  <Pill
                    icon="time-outline"
                    label={`Son doğrulama: ${formatDateTime(item.data_verified_at)}`}
                  />
                </>
              }
            />
          ))}
          <Pager
            total={list.data?.total ?? 0}
            limit={PAGE_SIZE}
            offset={offset}
            onChange={setOffset}
          />
        </View>
      )}
    </View>
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
      style={[styles.toggle, { opacity: disabled ? 0.55 : 1 }]}
    >
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: value ? theme.colors.primary : 'transparent',
            borderColor: value ? theme.colors.primary : theme.colors.border,
          },
        ]}
      >
        {value ? <Ionicons name="checkmark" size={13} color={theme.colors.onPrimary} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { paddingVertical: 24, alignItems: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, flexBasis: 240, flexGrow: 1 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
