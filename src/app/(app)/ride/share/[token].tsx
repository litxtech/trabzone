import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, Skeleton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { RideHeader } from '@/features/ride/components/RideHeader';
import { useLocationShareView } from '@/features/ride/hooks/use-ride';
import { staticPointMapUrl } from '@/features/ride/services/map-service';
import {
  OFFER_STATUS_LABEL,
  STATUS_TONE,
  formatDateTime,
  formatDuration,
} from '@/features/ride/utils/format';

/**
 * Süreli canlı konum bağlantısının karşı tarafı (`/ride/share/{token}`).
 *
 * Bu ekran olmadan `ride/trips/[id]` ekranında kopyalanan bağlantı 404
 * veriyordu. Token'ı doğrulayan tek yer `ride_location_share_view` RPC'si;
 * RPC oturum istediği için AuthGate girişten sonra aynı adrese geri döner.
 *
 * Konum 20 saniyede bir tazelenir. Süre dolduğunda/gizlendiyse RPC hata
 * verir; ekran bunu "bağlantı artık geçerli değil" olarak gösterir ve
 * uydurma bir konum çizmez.
 */
export default function RideShareScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const share = useLocationShareView(token ?? null);
  const data = share.data ?? null;

  const mapUrl = useMemo(() => {
    if (!data || data.lat == null || data.lng == null) {
      return null;
    }
    return staticPointMapUrl({ lat: data.lat, lng: data.lng, width: 760, height: 420 });
  }, [data]);

  const remaining = data ? formatRemaining(data.expires_at) : null;

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <RideHeader
        title="Canlı konum"
        subtitle={data ? `${data.shared_by} paylaştı` : 'Süreli bağlantı'}
      />

      {!token ? (
        <StatusCard
          icon="link-outline"
          title="Bağlantı eksik"
          body="Adres geçersiz. Paylaşan kişiden bağlantıyı yeniden göndermesini iste."
          onPress={() => router.replace('/ride' as never)}
        />
      ) : share.isLoading ? (
        <View style={styles.loading}>
          <Skeleton height={210} radius={16} />
          <Skeleton height={92} radius={16} />
          <Skeleton height={64} radius={16} />
        </View>
      ) : share.isError || !data ? (
        <StatusCard
          icon="time-outline"
          title="Bu bağlantı artık geçerli değil"
          body={
            // Ağ hatası ile süre dolmasını ayır: kullanıcı boşuna bağlantı
            // istemesin, sayfayı yenilemesi yeterli olabilir.
            share.isError
              ? errorMessage(share.error, 'Bağlantı okunamadı. İnternet bağlantını kontrol et.')
              : 'Bağlantının süresi dolmuş veya paylaşan kişi iptal etmiş olabilir.'
          }
          onPress={() => (share.isError ? void share.refetch() : router.replace('/ride' as never))}
          actionLabel={share.isError ? 'Yeniden dene' : 'Yolculuklara git'}
        />
      ) : (
        <>
          {mapUrl ? (
            <View style={[styles.mapWrap, { borderRadius: theme.radius.lg }]}>
              <Image
                source={{ uri: mapUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                cachePolicy="none"
              />
              <View style={styles.mapBadge}>
                <Badge label={remaining ? `Kalan ${remaining}` : 'Canlı'} tone="success" />
              </View>
            </View>
          ) : (
            <Card style={styles.mapFallback}>
              <Ionicons name="location-outline" size={22} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="textSecondary" style={styles.center}>
                {data.lat == null || data.lng == null
                  ? 'Sürücü henüz konum göndermedi. Yolculuk başladığında burada görünecek.'
                  : 'Harita yapılandırılmadığı için konum koordinat olarak gösteriliyor.'}
              </AppText>
              {data.lat != null && data.lng != null ? (
                <AppText variant="bodyStrong">
                  {data.lat.toFixed(5)}, {data.lng.toFixed(5)}
                </AppText>
              ) : null}
            </Card>
          )}

          <Card style={styles.card}>
            <View style={styles.row}>
              <Badge
                label={OFFER_STATUS_LABEL[data.offer_status as keyof typeof OFFER_STATUS_LABEL] ?? 'Yolculuk'}
                tone={STATUS_TONE[data.offer_status] ?? 'neutral'}
              />
              {data.speed_kmh != null ? (
                <Badge label={`${Math.round(data.speed_kmh)} km/s`} tone="neutral" />
              ) : null}
            </View>
            <View style={styles.routeRow}>
              <View style={styles.routeCols}>
                <AppText variant="caption" color="textTertiary">
                  Nereden
                </AppText>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {data.origin_label || '—'}
                </AppText>
              </View>
              <Ionicons name="arrow-forward" size={16} color={theme.colors.textTertiary} />
              <View style={styles.routeCols}>
                <AppText variant="caption" color="textTertiary">
                  Nereye
                </AppText>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {data.dest_label || '—'}
                </AppText>
              </View>
            </View>
            <InfoRow icon="calendar-outline" label="Kalkış" value={formatDateTime(data.depart_at)} />
            <InfoRow
              icon="sync-outline"
              label="Son güncelleme"
              value={data.updated_at ? formatDateTime(data.updated_at) : 'Konum bekleniyor'}
            />
            <InfoRow
              icon="hourglass-outline"
              label="Bağlantı bitişi"
              value={
                remaining
                  ? `${formatDateTime(data.expires_at)} · ${remaining}`
                  : formatDateTime(data.expires_at)
              }
            />
          </Card>

          <Button
            label="Konumu yenile"
            variant="outline"
            size="sm"
            fullWidth={false}
            loading={share.isFetching}
            leftIcon={<Ionicons name="refresh" size={15} color={theme.colors.primaryDeep} />}
            onPress={() => void share.refetch()}
          />

          <View style={styles.noteRow}>
            <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary" style={styles.flex}>
              {data.note ||
                'Bu bağlantı sürelidir ve yalnızca paylaşan kişinin onayıyla oluşturulmuştur.'}
            </AppText>
          </View>
        </>
      )}
    </Screen>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={15} color={theme.colors.textTertiary} />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="caption" color="text">
        {value}
      </AppText>
    </View>
  );
}

function StatusCard({
  icon,
  title,
  body,
  actionLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel?: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Card style={styles.status}>
      <Ionicons name={icon} size={30} color={theme.colors.textTertiary} />
      <AppText variant="bodyStrong">{title}</AppText>
      <AppText variant="caption" color="textSecondary" style={styles.center}>
        {body}
      </AppText>
      <Pressable accessibilityRole="button" onPress={onPress}>
        <AppText variant="caption" color="primary">
          {actionLabel ?? 'Geri dön'}
        </AppText>
      </Pressable>
    </Card>
  );
}

/** Kalan süreyi "1 sa 20 dk" biçiminde yazar; süre geçmişse null döner. */
function formatRemaining(iso: string): string | null {
  const diff = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) {
    return null;
  }
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) {
    return `${minutes} dk`;
  }
  return formatDuration(minutes);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  loading: { gap: 12, marginTop: 12 },
  mapWrap: { height: 210, overflow: 'hidden', marginTop: 8, backgroundColor: '#0B1220' },
  mapBadge: { position: 'absolute', top: 10, left: 10 },
  mapFallback: { alignItems: 'center', gap: 8, marginTop: 8, paddingVertical: 26 },
  card: { gap: 10, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeCols: { flex: 1, gap: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 14 },
  status: { alignItems: 'center', gap: 8, marginTop: 16, paddingVertical: 26 },
});
