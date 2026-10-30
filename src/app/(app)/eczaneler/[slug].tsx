import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Pressable, ScrollView, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { AppText, Button, Card, IconButton, Screen, Skeleton } from '@/components/ui';
import { AddPlaceMediaModal } from '@/features/explore/components/AddPlaceMediaModal';
import { PharmacyGallery } from '@/features/pharmacy/components/PharmacyGallery';
import { PharmacyReviewSection } from '@/features/pharmacy/components/PharmacyReviewSection';
import { PharmacyStatusBadge } from '@/features/pharmacy/components/PharmacyStatusBadge';
import { usePharmacyDetail } from '@/features/pharmacy/hooks/use-pharmacy';
import { pharmacyKeys } from '@/features/pharmacy/services/pharmacy-service';
import type { PharmacyDetail, PharmacyWorkingHours } from '@/features/pharmacy/types';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import {
  describePharmacyState,
  dutyEndsNextDay,
  formatDateTimeIstanbul,
  formatDayMonth,
  formatDutyWindow,
  formatHourMinute,
  weekdayLabel,
} from '@/features/pharmacy/utils/status';
import { callPharmacy, openDirections } from '@/features/pharmacy/utils/actions';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

const DAY_NAMES: Record<string, string> = {
  '1': 'Pazartesi',
  '2': 'Salı',
  '3': 'Çarşamba',
  '4': 'Perşembe',
  '5': 'Cuma',
  '6': 'Cumartesi',
  '7': 'Pazar',
};

const SHIFT_STATUS_LABEL: Record<string, string> = {
  confirmed: 'Doğrulandı',
  unverified: 'Doğrulanmadı',
  conflict: 'Kaynak uyuşmazlığı',
  cancelled: 'İptal edildi',
};

export default function PharmacyDetailScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : null;
  const detail = usePharmacyDetail(slug);
  const profile = useMyProfile();
  const queryClient = useQueryClient();
  const [mediaOpen, setMediaOpen] = useState(false);

  const openMap = (item: PharmacyDetail) => {
    router.push({
      pathname: '/map',
      params: {
        lat: String(item.lat ?? ''),
        lng: String(item.lng ?? ''),
        label: item.name,
        zoom: '16',
        pharmacy: item.slug,
      },
    } as never);
  };

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <View style={styles.shell}>
      <View style={[styles.topBar, { borderColor: theme.colors.divider }]}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
          Eczane
        </AppText>
        <IconButton
          name="map-outline"
          accessibilityLabel="Eczane haritasını aç"
          variant="surface"
          size={19}
          onPress={() => router.push('/eczaneler/harita' as never)}
        />
      </View>

      {detail.isLoading ? (
        <View style={styles.loading}>
          <Skeleton height={110} radius={18} />
          <Skeleton height={86} radius={16} />
          <Skeleton height={120} radius={16} />
          <Skeleton height={120} radius={16} />
        </View>
      ) : detail.isError || !detail.data ? (
        <View style={styles.state}>
          <View style={[styles.stateIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="medkit-outline" size={24} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="h3" align="center">
            Eczane bulunamadı
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {detail.error?.message ?? 'Kayıt kaldırılmış olabilir. Listeye dönüp tekrar dene.'}
          </AppText>
          <Button
            label="Eczane listesine dön"
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => router.push('/eczaneler' as never)}
          />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <PharmacyGallery
            photos={detail.data.photos ?? []}
            coverPath={detail.data.cover_path}
            onAddPhoto={profile.data ? () => setMediaOpen(true) : undefined}
          />
          <PharmacyHeader detail={detail.data} onMap={() => openMap(detail.data as PharmacyDetail)} />
          <DutyCard detail={detail.data} />
          <ContactCard detail={detail.data} />
          <HoursCard
            hours={detail.data.working_hours}
            verified={detail.data.working_hours_verified}
          />
          <ScheduleCard detail={detail.data} />
          <SourceCard detail={detail.data} />
          <PharmacyReviewSection
            placeId={detail.data.id}
            pharmacyName={detail.data.name}
            rating={detail.data.rating}
            reviewCount={detail.data.review_count}
            ratingBreakdown={detail.data.rating_breakdown ?? {}}
          />
        </ScrollView>
      )}
      </View>

      {detail.data ? (
        <AddPlaceMediaModal
          visible={mediaOpen}
          placeId={detail.data.id}
          placeName={detail.data.name}
          onClose={() => setMediaOpen(false)}
          onUploaded={() => {
            setMediaOpen(false);
            void queryClient.invalidateQueries({ queryKey: pharmacyKeys.detail(detail.data!.slug) });
          }}
        />
      ) : null}
    </Screen>
  );
}

function PharmacyHeader({ detail, onMap }: { detail: PharmacyDetail; onMap: () => void }) {
  const { theme } = useTheme();
  const view = describePharmacyState(detail.state);
  const place = [detail.district, detail.neighborhood].filter(Boolean).join(' · ');

  return (
    <View style={styles.header}>
      <PharmacyStatusBadge state={detail.state} />
      <AppText variant="h2">{detail.name}</AppText>
      <View style={styles.metaRow}>
        <Ionicons name="location-outline" size={14} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          {place || 'İlçe bilgisi yok'}
        </AppText>
        {detail.neighborhood_verified ? (
          <View style={[styles.verifiedChip, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="shield-checkmark" size={10} color={theme.colors.success} />
            <AppText variant="caption" style={{ color: theme.colors.success }}>
              Mahalle doğrulandı
            </AppText>
          </View>
        ) : null}
      </View>
      {detail.rating != null && detail.review_count > 0 ? (
        <View style={styles.metaRow}>
          <Ionicons name="star" size={13} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary">
            {detail.rating.toFixed(1)} · {detail.review_count} değerlendirme
          </AppText>
        </View>
      ) : (
        <AppText variant="caption" color="textTertiary">
          Henüz değerlendirme yapılmadı
        </AppText>
      )}
      {view.detail ? (
        <AppText variant="body" color="textSecondary">
          {view.detail}
        </AppText>
      ) : null}

      <View style={styles.actionRow}>
        <Button
          label="Ara"
          size="sm"
          variant={detail.phone ? 'primary' : 'ghost'}
          disabled={!detail.phone}
          leftIcon={<Ionicons name="call" size={14} color="#FFFFFF" />}
          style={styles.actionButton}
          onPress={() => void callPharmacy(detail.phone)}
        />
        <Button
          label="Yol Tarifi"
          size="sm"
          variant="secondary"
          disabled={detail.lat == null || detail.lng == null}
          leftIcon={<Ionicons name="navigate" size={14} color={theme.colors.primaryDeep} />}
          style={styles.actionButton}
          onPress={() => openDirections(detail.lat, detail.lng, detail.name)}
        />
        <Button
          label="Harita"
          size="sm"
          variant="secondary"
          disabled={detail.lat == null || detail.lng == null}
          leftIcon={<Ionicons name="map" size={14} color={theme.colors.primaryDeep} />}
          style={styles.actionButton}
          onPress={onMap}
        />
      </View>
    </View>
  );
}

function DutyCard({ detail }: { detail: PharmacyDetail }) {
  const { theme } = useTheme();
  const view = describePharmacyState(detail.state);
  const shift = detail.state?.shift;
  const active = view.onDutyNow;

  return (
    <Card
      padding={14}
      style={{
        borderColor: active ? `${theme.colors.success}55` : theme.colors.border,
        backgroundColor: active ? theme.colors.successSoft : theme.colors.surface,
      }}
    >
      <View style={styles.cardHead}>
        <Ionicons
          name={active ? 'moon' : 'time-outline'}
          size={15}
          color={active ? theme.colors.success : theme.colors.primaryDeep}
        />
        <AppText variant="bodyStrong" style={styles.flex}>
          {view.label}
        </AppText>
        {shift ? (
          <AppText variant="caption" color="textTertiary">
            {formatDayMonth(shift.starts_at)}
          </AppText>
        ) : null}
      </View>

      {shift ? (
        <>
          <AppText variant="h3">
            {formatDutyWindow(shift.starts_at, shift.ends_at)}
            {dutyEndsNextDay(shift) ? ' (ertesi gün)' : ''}
          </AppText>
          <View style={styles.metaRow}>
            <Ionicons
              name={shift.verified ? 'shield-checkmark-outline' : 'alert-circle-outline'}
              size={13}
              color={shift.verified ? theme.colors.success : theme.colors.warning}
            />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {shift.verified ? 'Nöbet kaydı doğrulandı' : 'Nöbet kaydı henüz doğrulanmadı'}
              {shift.source_name ? ` · ${shift.source_name}` : ''}
            </AppText>
          </View>
        </>
      ) : (
        <AppText variant="body" color="textSecondary">
          {view.detail ?? 'Bugün için yayımlanmış nöbet kaydı yok.'}
        </AppText>
      )}

      {view.caveat ? (
        <AppText variant="caption" color="textTertiary">
          {view.caveat}
        </AppText>
      ) : null}
      {detail.state?.stale ? (
        <View style={styles.metaRow}>
          <Ionicons name="warning-outline" size={13} color={theme.colors.warning} />
          <AppText variant="caption" color="warning" style={styles.flex}>
            Kaynak tazelik eşiğini aştı; bu kayıt bugünün kesin listesi olmayabilir.
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

function ContactCard({ detail }: { detail: PharmacyDetail }) {
  const { theme } = useTheme();
  return (
    <Card padding={14}>
      <AppText variant="bodyStrong">Adres ve iletişim</AppText>
      {detail.address ? (
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={15} color={theme.colors.textTertiary} />
          <AppText variant="body" color="textSecondary" style={styles.flex}>
            {detail.address}
          </AppText>
        </View>
      ) : (
        <View style={styles.metaRow}>
          <Ionicons name="alert-circle-outline" size={15} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex}>
            Açık adres henüz doğrulanmadı. Haritadaki konumu kullanabilirsin.
          </AppText>
        </View>
      )}

      {detail.phone ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Eczaneyi ara: ${detail.phone}`}
          onPress={() => {
            haptics.tap();
            void callPharmacy(detail.phone);
          }}
          style={[styles.phoneRow, { borderColor: theme.colors.border }]}
        >
          <Ionicons name="call-outline" size={15} color={theme.colors.primaryDeep} />
          <AppText variant="body" color="primaryDeep" style={styles.flex}>
            {detail.phone}
          </AppText>
          <AppText variant="caption" color="textTertiary">
            Ara
          </AppText>
        </Pressable>
      ) : (
        <View style={styles.metaRow}>
          <Ionicons name="call-outline" size={15} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex}>
            Doğrulanmış telefon numarası bulunmuyor.
          </AppText>
        </View>
      )}

      {detail.lat != null && detail.lng != null ? (
        <AppText variant="caption" color="textTertiary">
          Koordinat: {detail.lat.toFixed(5)}, {detail.lng.toFixed(5)}
        </AppText>
      ) : (
        <AppText variant="caption" color="textTertiary">
          Koordinat bilgisi yok; haritada gösterilemez.
        </AppText>
      )}
    </Card>
  );
}

function HoursCard({
  hours,
  verified,
}: {
  hours: PharmacyWorkingHours | null;
  verified: boolean;
}) {
  const { theme } = useTheme();
  const entries = Object.keys(hours ?? {}).sort((a, b) => Number(a) - Number(b));
  const hasHours = entries.length > 0;

  return (
    <Card padding={14}>
      <View style={styles.cardHead}>
        <AppText variant="bodyStrong" style={styles.flex}>
          Çalışma saatleri
        </AppText>
        {hasHours ? (
          <View
            style={[
              styles.verifiedChip,
              {
                backgroundColor: verified ? theme.colors.successSoft : theme.colors.warningSoft,
              },
            ]}
          >
            <AppText
              variant="caption"
              style={{ color: verified ? theme.colors.success : theme.colors.warning }}
            >
              {verified ? 'Doğrulandı' : 'Doğrulanmadı'}
            </AppText>
          </View>
        ) : null}
      </View>

      {hasHours ? (
        entries.map((key) => {
          const slots = hours?.[key] ?? [];
          const text =
            slots.length > 0
              ? slots.map(([from, to]) => `${from}–${to}`).join(', ')
              : 'Kapalı';
          return (
            <View key={key} style={styles.hoursRow}>
              <AppText variant="caption" color="textTertiary" style={styles.dayLabel}>
                {DAY_NAMES[key] ?? key}
              </AppText>
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                {text}
              </AppText>
            </View>
          );
        })
      ) : (
        <View style={styles.metaRow}>
          <Ionicons name="alert-circle-outline" size={14} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex}>
            Bu eczane için doğrulanmış çalışma saati bilgisi yok. Durum gösterilirken saat
            tahmini yapılmaz.
          </AppText>
        </View>
      )}
    </Card>
  );
}

function ScheduleCard({ detail }: { detail: PharmacyDetail }) {
  const { theme } = useTheme();
  const rows = detail.duty ?? [];

  return (
    <Card padding={14}>
      <AppText variant="bodyStrong">Nöbet takvimi</AppText>
      {rows.length === 0 ? (
        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={14} color={theme.colors.textTertiary} />
          <AppText variant="caption" color="textTertiary" style={styles.flex}>
            Yakın dönem için yayımlanmış nöbet kaydı bulunmuyor.
          </AppText>
        </View>
      ) : (
        rows.map((row) => (
          <View key={row.id} style={[styles.shiftRow, { borderColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">
                {weekdayLabel(row.starts_at)}, {formatDayMonth(row.starts_at)}
              </AppText>
              <AppText variant="caption" color="textSecondary">
                {formatHourMinute(row.starts_at)} – {formatHourMinute(row.ends_at)}
                {dutyEndsNextDay(row) ? ' (ertesi gün)' : ''}
                {row.source_name ? ` · ${row.source_name}` : ''}
              </AppText>
            </View>
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor:
                    row.status === 'confirmed'
                      ? theme.colors.successSoft
                      : row.status === 'conflict'
                        ? theme.colors.dangerSoft
                        : theme.colors.warningSoft,
                },
              ]}
            >
              <AppText
                variant="caption"
                style={{
                  color:
                    row.status === 'confirmed'
                      ? theme.colors.success
                      : row.status === 'conflict'
                        ? theme.colors.danger
                        : theme.colors.warning,
                }}
              >
                {SHIFT_STATUS_LABEL[row.status] ?? row.status}
              </AppText>
            </View>
          </View>
        ))
      )}
    </Card>
  );
}

function SourceCard({ detail }: { detail: PharmacyDetail }) {
  const { theme } = useTheme();
  const inventoryLabel =
    detail.inventory_source === 'osm'
      ? 'OpenStreetMap (ODbL)'
      : detail.inventory_source === 'official_list'
        ? 'Yetkili kurum listesi'
        : detail.inventory_source === 'pharmacy_bulletin'
          ? 'Eczacı odası bülteni'
          : 'Elle doğrulanmış kayıt';

  return (
    <Card padding={14} tone="muted">
      <View style={styles.cardHead}>
        <Ionicons name="information-circle-outline" size={15} color={theme.colors.textSecondary} />
        <AppText variant="bodyStrong" style={styles.flex}>
          Veri kaynağı ve doğrulama
        </AppText>
      </View>
      <InfoLine label="Envanter kaynağı" value={inventoryLabel} />
      <InfoLine
        label="Veri doğrulaması"
        value={
          detail.data_verified_at
            ? formatDateTimeIstanbul(detail.data_verified_at)
            : 'Henüz doğrulanmadı'
        }
      />
      <InfoLine
        label="Nöbet doğrulaması"
        value={
          detail.duty_verified_at
            ? formatDateTimeIstanbul(detail.duty_verified_at)
            : 'Henüz doğrulanmadı'
        }
      />
      {detail.attribution_text ? (
        <AppText variant="caption" color="textTertiary">
          {detail.attribution_text}
        </AppText>
      ) : null}
      {detail.license_note ? (
        <AppText variant="caption" color="textTertiary">
          {detail.license_note}
        </AppText>
      ) : null}
      {detail.sources.length > 0 ? (
        <AppText variant="caption" color="textTertiary">
          Nöbet kaynağı: {detail.sources.map((source) => source.name).join(', ')}
        </AppText>
      ) : null}
      <AppText variant="caption" color="textTertiary">
        Sayfa üretimi: {formatDateTimeIstanbul(detail.generated_at)} (Europe/Istanbul)
      </AppText>
    </Card>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <AppText variant="caption" color="textTertiary" style={styles.infoLabel}>
        {label}
      </AppText>
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 40, gap: 12 },
  loading: { padding: 18, gap: 12 },
  header: { gap: 7 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  actionButton: { flex: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hoursRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dayLabel: { width: 74 },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  infoLine: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  infoLabel: { width: 122 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 26 },
  stateIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
