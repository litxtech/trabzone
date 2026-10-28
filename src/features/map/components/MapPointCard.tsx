import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Share, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button } from '@/components/ui';
import { env } from '@/config/env';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { formatDateTime, formatMoney } from '@/features/ride/utils/format';
import { useTheme } from '@/theme/ThemeProvider';

import { MAP_KIND_ICON, MAP_KIND_LABEL } from '../constants';
import type { MapPoint } from '../types';
import { markerTone, formatRelativeTime, toneColor } from '../utils/map-theme';

function str(meta: Record<string, unknown> | undefined, key: string): string | null {
  const value = meta?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(meta: Record<string, unknown> | undefined, key: string): number | null {
  const value = meta?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function Chip({ label, tone }: { label: string; tone?: 'neutral' | 'success' | 'warning' }) {
  const { theme } = useTheme();
  const color =
    tone === 'success' ? theme.colors.success : tone === 'warning' ? theme.colors.warning : theme.colors.textSecondary;
  return (
    <View style={[styles.chip, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
      <AppText variant="caption" style={{ color }}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * Seçili harita işaretinin detay kartı. Her tür kendi modülüne yönlendirir;
 * rezervasyon, mesajlaşma ve profil ekranları yeniden yazılmaz.
 */
export function MapPointCard({
  point,
  onLeave,
  onZoomIn,
  onDirections,
}: {
  point: MapPoint;
  onLeave: () => void;
  onZoomIn: () => void;
  onDirections: (target: { lat: number; lng: number }) => void;
}) {
  const { theme } = useTheme();
  const tone = toneColor(theme, markerTone(point.kind));
  const kindLabel = MAP_KIND_LABEL[point.kind] ?? 'Harita';
  const icon = point.kind === 'cluster' ? 'albums-outline' : MAP_KIND_ICON[point.kind] ?? 'location';

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={[styles.iconWrap, { backgroundColor: `${tone}22` }]}>
          <Ionicons name={icon} size={18} color={tone} />
        </View>
        <View style={styles.flex}>
          <AppText variant="caption" style={{ color: tone }}>
            {kindLabel}
            {point.kind === 'friend' && point.precise === false ? ' · yaklaşık konum' : ''}
          </AppText>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {point.title}
          </AppText>
          {point.subtitle ? (
            <AppText variant="caption" color="textSecondary" numberOfLines={2}>
              {point.subtitle}
            </AppText>
          ) : null}
        </View>
        <Button label="Kapat" variant="ghost" size="sm" fullWidth={false} onPress={onLeave} />
      </View>

      {point.kind === 'cluster' ? (
        <View style={styles.block}>
          <AppText variant="caption" color="textSecondary">
            Bu bölgede {point.count ?? 0} işaret var. Ayrıntı için yakınlaştır.
          </AppText>
          <Button label="Bölgeye yakınlaş" size="sm" leftIcon={<Ionicons name="add" size={16} color={theme.colors.onPrimary} />} onPress={onZoomIn} />
        </View>
      ) : null}

      {point.kind === 'friend' ? (
        <FriendBody point={point} onClose={onLeave} />
      ) : point.kind === 'ride_offer' ? (
        <RideOfferBody point={point} onLeave={onLeave} onDirections={onDirections} />
      ) : point.kind === 'ride_request' ? (
        <RideRequestBody point={point} onLeave={onLeave} />
      ) : null}

      {point.kind !== 'friend' && point.kind !== 'cluster' ? (
        <Button
          label="Konum bağlantısını paylaş"
          variant="ghost"
          size="sm"
          leftIcon={<Ionicons name="share-outline" size={15} color={theme.colors.primaryDeep} />}
          onPress={() => {
            const link = `${env.appUrl}/map?lat=${point.lat}&lng=${point.lng}&label=${encodeURIComponent(point.title)}`;
            void Share.share({ message: `${point.title} · Trabzone Haritası ${link}`, url: link });
          }}
        />
      ) : null}
    </View>
  );
}

function FriendBody({ point, onClose }: { point: MapPoint; onClose: () => void }) {
  const { theme } = useTheme();
  const router = useRouter();
  const avatar = mediaPublicUrl('avatar', point.avatarPath) ?? point.avatarUrl ?? null;

  return (
    <View style={styles.block}>
      <View style={styles.personRow}>
        <Avatar uri={avatar} name={point.title} size={46} ring />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">{point.title}</AppText>
          {point.username ? (
            <AppText variant="caption" color="textTertiary">
              @{point.username}
            </AppText>
          ) : null}
          <View style={styles.chipRow}>
            <Chip label={point.precise ? 'Hassas konum izniyle' : 'Yaklaşık bölge'} tone={point.precise ? 'success' : 'neutral'} />
            {point.updatedAt ? <Chip label={formatRelativeTime(point.updatedAt) ?? ''} /> : null}
          </View>
        </View>
      </View>

      <AppText variant="caption" color="textTertiary">
        Konum yalnızca paylaşım izni açıkken ve süresi dolmadan görünür. Arkadaş olmak otomatik konum paylaşımı değildir.
      </AppText>

      <View style={styles.actionRow}>
        <Button
          label="Profili aç"
          size="sm"
          style={styles.action}
          onPress={() => {
            onClose();
            if (point.username) {
              router.push(`/profile/${point.username}`);
            }
          }}
          disabled={!point.username}
        />
        <Button
          label="Mesaj"
          variant="secondary"
          size="sm"
          style={styles.action}
          rightIcon={<Ionicons name="chatbubble-outline" size={15} color={theme.colors.primaryDeep} />}
          onPress={() => {
            onClose();
            router.push('/messages');
          }}
        />
      </View>
    </View>
  );
}

function RideOfferBody({
  point,
  onLeave,
  onDirections,
}: {
  point: MapPoint;
  onLeave: () => void;
  onDirections: (target: { lat: number; lng: number }) => void;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const seats = num(point.meta, 'seats');
  const price = num(point.meta, 'price_cents');
  const currency = str(point.meta, 'currency') ?? 'TRY';
  const driver = str(point.meta, 'driver') ?? 'Sürücü';
  const avatar = mediaPublicUrl('avatar', str(point.meta, 'driver_avatar'));
  const verified = point.meta?.verified === true;
  const destLat = num(point.meta, 'dest_lat');
  const destLng = num(point.meta, 'dest_lng');
  const depart = str(point.meta, 'depart_at');

  return (
    <View style={styles.block}>
      <View style={styles.personRow}>
        <Avatar uri={avatar} name={driver} size={40} />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <AppText variant="bodyStrong">{driver}</AppText>
            {verified ? <Ionicons name="shield-checkmark" size={14} color={theme.colors.success} /> : null}
          </View>
          <AppText variant="caption" color="textTertiary">
            {depart ? formatDateTime(depart) : 'Kalkış zamanı ilanda'}
          </AppText>
        </View>
      </View>

      <View style={styles.chipRow}>
        <Chip label={seats != null ? `${seats} koltuk` : 'Koltuk bilgisi ilanda'} />
        <Chip label={formatMoney(price, currency)} tone="success" />
        <Chip label={point.meta?.scope === 'intercity' ? 'Şehirler arası' : 'Şehir içi'} />
      </View>

      <AppText variant="caption" color="textTertiary">
        Koltuk, ücret ve rezervasyon aynı Yolculuk Paylaşımı modülünde yönetilir; haritada ikinci bir rezervasyon oluşturulmaz.
      </AppText>

      <View style={styles.actionRow}>
        <Button
          label="Rezervasyon ekranı"
          size="sm"
          style={styles.action}
          onPress={() => {
            onLeave();
            router.push(`/ride/offers/${point.id}` as never);
          }}
        />
        <Button
          label="Güzergâh"
          variant="secondary"
          size="sm"
          style={styles.action}
          disabled={destLat == null || destLng == null}
          onPress={() => {
            if (destLat != null && destLng != null) {
              onDirections({ lat: destLat, lng: destLng });
            }
          }}
        />
      </View>
    </View>
  );
}

function RideRequestBody({ point, onLeave }: { point: MapPoint; onLeave: () => void }) {
  const router = useRouter();
  const party = num(point.meta, 'party_size');
  const earliest = str(point.meta, 'earliest_depart');
  const latest = str(point.meta, 'latest_depart');
  const scope = point.meta?.scope === 'intercity' ? 'intercity' : 'intracity';
  const dest = str(point.meta, 'dest_label');

  return (
    <View style={styles.block}>
      <View style={styles.chipRow}>
        <Chip label={party != null ? `${party} yolcu` : 'Yolcu sayısı ilanda'} />
        {earliest ? <Chip label={formatDateTime(earliest)} /> : null}
        <Chip label={scope === 'intercity' ? 'Şehirler arası' : 'Şehir içi'} />
      </View>

      <AppText variant="caption" color="textTertiary">
        {latest ? `En geç ${formatDateTime(latest)} · ` : ''}
        Eşleşen sürücü ilanları Yolculuk Paylaşımı aramasında listelenir.
      </AppText>

      <Button
        label="Uygun yolculukları ara"
        size="sm"
        onPress={() => {
          onLeave();
          router.push({
            pathname: '/ride/search',
            params: {
              scope,
              origin: point.title.split('→')[0]?.trim() ?? '',
              ...(dest ? { dest } : {}),
            },
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  block: { gap: 10 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  actionRow: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
