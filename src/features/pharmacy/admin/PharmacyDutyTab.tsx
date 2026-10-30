import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useAdminPharmacies,
  useAdminPharmacyDuty,
  useAdminPharmacyOverview,
  useDebounced,
  useDeleteAdminPharmacyDuty,
  useResolveAdminPharmacyUnmatched,
  useUpsertAdminPharmacyDuty,
  useUpdateAdminPharmacySettings,
} from '../hooks/use-pharmacy';
import type { PharmacyShiftStatus } from '../types';
import {
  adminPharmacyStyles,
  dutyStatusMeta,
  EmptyHint,
  formatClock,
  formatDateTime,
  formatDutyDate,
  Pill,
  RowCard,
} from './shared';

const STATUS_OPTIONS: { key: PharmacyShiftStatus; label: string }[] = [
  { key: 'confirmed', label: 'Doğrulandı' },
  { key: 'unverified', label: 'Doğrulanmadı' },
  { key: 'conflict', label: 'Çelişki' },
  { key: 'cancelled', label: 'İptal' },
];

export function istanbulToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function PharmacyDutyTab({ canManage }: { canManage: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const [date, setDate] = useState(istanbulToday());
  const [dateInput, setDateInput] = useState(istanbulToday());
  const duty = useAdminPharmacyDuty(date);
  const overview = useAdminPharmacyOverview();
  const upsert = useUpsertAdminPharmacyDuty();
  const remove = useDeleteAdminPharmacyDuty();
  const resolve = useResolveAdminPharmacyUnmatched();
  const settings = useUpdateAdminPharmacySettings();

  const [pickerQuery, setPickerQuery] = useState('');
  const debouncedPicker = useDebounced(pickerQuery, 300);
  const picker = useAdminPharmacies(
    useMemo(
      () => ({ query: debouncedPicker.trim() || null, limit: 8, offset: 0 }),
      [debouncedPicker],
    ),
    debouncedPicker.trim().length >= 2,
  );
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('08:00');
  const [status, setStatus] = useState<PharmacyShiftStatus>('confirmed');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const [staleHours, setStaleHours] = useState('18');
  const [notifyHour, setNotifyHour] = useState('9');
  const [requireVerified, setRequireVerified] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  useEffect(() => {
    const value = overview.data?.settings;
    if (!value) {
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    setStaleHours(String(value.stale_after_hours));
    setNotifyHour(String(value.default_notify_hour));
    setRequireVerified(value.require_verified_duty);
    setNotificationsEnabled(overview.data?.notifications.global_enabled ?? true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [overview.data]);

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateInput) && !Number.isNaN(new Date(`${dateInput}T00:00:00+03:00`).getTime());
  const timeValid = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end);

  async function addDuty() {
    if (!placeId) {
      toast.error('Önce bir eczane seçin.');
      return;
    }
    if (!timeValid) {
      toast.error('Saatler SS:DD biçiminde olmalı (örn. 18:00).');
      return;
    }
    try {
      await upsert.mutateAsync({
        placeId,
        dutyDate: date,
        startTime: start,
        endTime: end,
        status,
        sourceId,
        note: note.trim() || null,
      });
      toast.success('Nöbet kaydı kaydedildi.');
      setNote('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nöbet kaydı eklenemedi.');
    }
  }

  async function deleteDuty(id: string) {
    try {
      await remove.mutateAsync(id);
      toast.success('Nöbet kaydı silindi.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kayıt silinemedi.');
    }
  }

  async function resolveUnmatched(id: string, decision: 'link' | 'reject') {
    if (decision === 'link' && !placeId) {
      toast.error('Bağlamak için önce soldaki formdan eczane seçin.');
      return;
    }
    try {
      await resolve.mutateAsync({ id, decision, placeId: decision === 'link' ? placeId : null });
      toast.success(decision === 'link' ? 'Kayıt eczaneye bağlandı.' : 'Eşleşmeyen kayıt reddedildi.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Karar kaydedilemedi.');
    }
  }

  async function saveSettings() {
    const staleValue = Number(staleHours);
    const hourValue = Number(notifyHour);
    if (!Number.isFinite(staleValue) || staleValue < 1 || staleValue > 168) {
      toast.error('Tazelik eşiği 1–168 saat arasında olmalı.');
      return;
    }
    if (!Number.isInteger(hourValue) || hourValue < 0 || hourValue > 23) {
      toast.error('Varsayılan bildirim saati 0–23 arasında olmalı.');
      return;
    }
    try {
      await settings.mutateAsync({
        stale_after_hours: staleValue,
        default_notify_hour: hourValue,
        require_verified_duty: requireVerified,
        notifications_enabled: notificationsEnabled,
      });
      toast.success('Eczane veri ayarları güncellendi.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ayarlar güncellenemedi.');
    }
  }

  return (
    <View style={adminPharmacyStyles.stack}>
      <AdminSection
        title="Nöbet yönetimi"
        subtitle="Tarih seçin; kaynak uyuşmazlıkları ve eşleşmeyen kayıtlar aynı ekranda görünür"
      >
        <View style={[adminPharmacyStyles.inline, { justifyContent: 'space-between' }]}>
          <TextField
            label="Nöbet tarihi (YYYY-AA-GG)"
            value={dateInput}
            onChangeText={setDateInput}
            containerStyle={{ flexBasis: 220, flexGrow: 1 }}
            placeholder="2026-10-28"
          />
          <Button
            label="Tarihi aç"
            size="sm"
            fullWidth={false}
            variant="secondary"
            disabled={!dateValid}
            onPress={() => setDate(dateInput)}
          />
        </View>
        {!dateValid ? (
          <AppText variant="caption" color="danger">
            Tarih biçimi geçersiz.
          </AppText>
        ) : null}
        <View style={adminPharmacyStyles.inline}>
          <Pill icon="calendar-outline" label={formatDutyDate(duty.data?.date ?? date)} />
          {duty.data ? (
            <Pill
              icon="list-outline"
              label={`${duty.data.items.length} nöbet kaydı`}
              tone={duty.data.items.length > 0 ? 'success' : 'warning'}
            />
          ) : null}
          {duty.data?.unmatched.length ? (
            <Pill
              icon="alert-circle-outline"
              label={`${duty.data.unmatched.length} eşleşmeyen`}
              tone="warning"
            />
          ) : null}
        </View>
        <AppText variant="caption" color="textTertiary">
          Nöbet listesinde görünmek eczanenin fiziksel olarak açık olduğunun canlı teyidi değildir.
          Kaynak tazeliği eşiği aşıldığında kullanıcı ekranları &quot;doğrulanamadı&quot; gösterir.
        </AppText>
      </AdminSection>

      <AdminSection
        title="Nöbet kaydı ekle"
        subtitle="Trabzon genelinde tek bir sabit nöbet saati varsayılmaz"
      >
        <TextField
          label="Eczane ara"
          placeholder="En az 2 karakter"
          value={pickerQuery}
          onChangeText={setPickerQuery}
          leftIcon="search-outline"
          autoCapitalize="none"
        />
        {placeId ? (
          <View style={[adminPharmacyStyles.inline, { justifyContent: 'space-between' }]}>
            <Badge label={`Seçili: ${placeName}`} tone="primary" />
            <Button
              label="Seçimi temizle"
              size="sm"
              variant="ghost"
              fullWidth={false}
              onPress={() => {
                setPlaceId(null);
                setPlaceName('');
              }}
            />
          </View>
        ) : picker.isFetching ? (
          <AppText variant="caption" color="textTertiary">
            Eczaneler aranıyor…
          </AppText>
        ) : (picker.data?.items.length ?? 0) === 0 ? (
          <AppText variant="caption" color="textTertiary">
            {debouncedPicker.trim().length >= 2
              ? 'Eşleşen eczane yok. Eczane envanterde yoksa nöbet kaydı eklenemez.'
              : 'Eczane aramak için en az 2 karakter yazın.'}
          </AppText>
        ) : (
          <View style={adminPharmacyStyles.stack}>
            {picker.data?.items.map((item) => (
              <RowCard
                key={item.id}
                onPress={() => {
                  setPlaceId(item.id);
                  setPlaceName(item.name);
                  setPickerQuery('');
                }}
                title={item.name}
                subtitle={[item.neighborhood, item.district].filter(Boolean).join(' · ') || 'Konum bilinmiyor'}
                badges={item.data_verified_at ? <Badge label="Doğrulandı" tone="success" /> : <Badge label="Doğrulanmadı" tone="warning" />}
              />
            ))}
          </View>
        )}
        <View style={adminPharmacyStyles.formRow}>
          <TextField
            label="Başlangıç"
            value={start}
            onChangeText={setStart}
            containerStyle={adminPharmacyStyles.grow}
            placeholder="18:00"
          />
          <TextField
            label="Bitiş (ertesi gün olabilir)"
            value={end}
            onChangeText={setEnd}
            containerStyle={adminPharmacyStyles.grow}
            placeholder="08:00"
          />
        </View>
        <View style={{ gap: 8 }}>
          <AppText variant="caption" color="textTertiary">
            Kayıt durumu
          </AppText>
          <FilterChips
            options={STATUS_OPTIONS.map((item) => ({ key: item.key, label: item.label }))}
            value={status}
            onChange={setStatus}
          />
        </View>
        {(duty.data?.sources.length ?? 0) > 0 ? (
          <View style={{ gap: 8 }}>
            <AppText variant="caption" color="textTertiary">
              Kaynak
            </AppText>
            <FilterChips
              options={[
                { key: 'none', label: 'Kaynak yok' },
                ...(duty.data?.sources ?? []).map((item) => ({
                  key: item.id,
                  label: item.name,
                })),
              ]}
              value={sourceId ?? 'none'}
              onChange={(next) => setSourceId(next === 'none' ? null : next)}
            />
          </View>
        ) : null}
        <TextField
          label="Not"
          value={note}
          onChangeText={setNote}
          placeholder="Örn. kaynak güncellemesi, telefonla doğrulama"
        />
        <Button
          label="Nöbet kaydını ekle"
          size="sm"
          fullWidth={false}
          loading={upsert.isPending}
          disabled={!canManage || !placeId || !dateValid}
          onPress={() => void addDuty()}
        />
      </AdminSection>

      {duty.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : duty.isError ? (
        <EmptyHint
          icon="cloud-offline-outline"
          title="Nöbet listesi yüklenemedi"
          text={duty.error instanceof Error ? duty.error.message : undefined}
        />
      ) : (
        <>
          <AdminSection
            title="Seçili günün nöbet kayıtları"
            subtitle={formatDutyDate(duty.data?.date ?? date)}
          >
            {(duty.data?.items.length ?? 0) === 0 ? (
              <EmptyHint
                icon="moon-outline"
                title="Bu tarih için nöbet kaydı yok"
                text="Kayıt yoksa kullanıcıya hiçbir eczane nöbetçi olarak gösterilmez."
              />
            ) : (
              <View style={adminPharmacyStyles.stack}>
                {duty.data?.items.map((item) => {
                  const meta = dutyStatusMeta(item.status);
                  return (
                    <RowCard
                      key={item.id}
                      title={item.name}
                      subtitle={
                        [item.neighborhood, item.district].filter(Boolean).join(' · ') ||
                        'Konum bilinmiyor'
                      }
                      badges={
                        <>
                          <Badge label={meta.label} tone={meta.tone} />
                          {item.source_name ? (
                            <Badge label={item.source_name} tone="neutral" />
                          ) : (
                            <Badge label="Kaynak yok" tone="neutral" />
                          )}
                        </>
                      }
                      meta={
                        <>
                          <Pill
                            icon="time-outline"
                            label={`${formatClock(item.starts_at)} – ${formatClock(item.ends_at)}`}
                          />
                          <Pill
                            icon="download-outline"
                            label={`Çekildi: ${formatDateTime(item.fetched_at)}`}
                          />
                          <Pill
                            icon="shield-checkmark-outline"
                            label={
                              item.verified_at
                                ? `Doğrulama: ${formatDateTime(item.verified_at)}`
                                : 'Doğrulanmadı'
                            }
                            tone={item.verified_at ? 'success' : 'warning'}
                          />
                        </>
                      }
                      actions={
                        canManage ? (
                          <Button
                            label="Sil"
                            size="sm"
                            variant="ghost"
                            fullWidth={false}
                            loading={remove.isPending}
                            onPress={() => void deleteDuty(item.id)}
                          />
                        ) : null
                      }
                    />
                  );
                })}
              </View>
            )}
          </AdminSection>

          {(duty.data?.unmatched.length ?? 0) > 0 ? (
            <AdminSection
              title="Eşleşmeyen nöbet kayıtları"
              subtitle="Kaynak kaydı hiçbir eczane ile güvenle eşleşmedi; körlemesine birleştirme yapılmaz"
            >
              <View style={adminPharmacyStyles.stack}>
                {duty.data?.unmatched.map((item) => (
                  <RowCard
                    key={item.id}
                    title={item.raw_name}
                    subtitle={[item.raw_neighborhood, item.raw_district].filter(Boolean).join(' · ')}
                    badges={<Badge label={item.status} tone="warning" />}
                    meta={<Pill icon="calendar-outline" label={formatDutyDate(item.duty_date)} />}
                    actions={
                      canManage ? (
                        <>
                          <Button
                            label="Seçili eczaneye bağla"
                            size="sm"
                            variant="secondary"
                            fullWidth={false}
                            loading={resolve.isPending}
                            onPress={() => void resolveUnmatched(item.id, 'link')}
                          />
                          <Button
                            label="Reddet"
                            size="sm"
                            variant="ghost"
                            fullWidth={false}
                            onPress={() => void resolveUnmatched(item.id, 'reject')}
                          />
                        </>
                      ) : null
                    }
                  />
                ))}
              </View>
            </AdminSection>
          ) : null}
        </>
      )}

      <AdminSection
        title="Veri tazeliği ve bildirim varsayılanları"
        subtitle="Eski liste bugünün kesin listesi olarak gösterilmez"
      >
        <View style={adminPharmacyStyles.formRow}>
          <TextField
            label="Tazelik eşiği (saat)"
            value={staleHours}
            onChangeText={setStaleHours}
            keyboardType="number-pad"
            containerStyle={adminPharmacyStyles.grow}
          />
          <TextField
            label="Varsayılan bildirim saati"
            value={notifyHour}
            onChangeText={setNotifyHour}
            keyboardType="number-pad"
            containerStyle={adminPharmacyStyles.grow}
          />
        </View>
        <View style={adminPharmacyStyles.inline}>
          <Button
            label={requireVerified ? 'Yalnızca doğrulanmış nöbet: Açık' : 'Yalnızca doğrulanmış nöbet: Kapalı'}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => setRequireVerified((value) => !value)}
          />
          <Button
            label={notificationsEnabled ? 'Eczane bildirimleri: Açık' : 'Eczane bildirimleri: Kapalı'}
            size="sm"
            variant="secondary"
            fullWidth={false}
            onPress={() => setNotificationsEnabled((value) => !value)}
          />
        </View>
        <Button
          label="Ayarları kaydet"
          size="sm"
          fullWidth={false}
          loading={settings.isPending}
          disabled={!canManage}
          onPress={() => void saveSettings()}
        />
        {!canManage ? (
          <AppText variant="caption" color="warning">
            Ayarları değiştirmek için pharmacy.manage izni gerekir.
          </AppText>
        ) : null}
      </AdminSection>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 24, alignItems: 'center' },
});
