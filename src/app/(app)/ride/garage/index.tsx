import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { useRemoveVehicle, useRideVehicles } from '@/features/ride/hooks/use-ride';
import { rideVehiclePhotoUrl } from '@/features/ride/services/ride-service';
import { formatDate } from '@/features/ride/utils/format';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Yayında',
  approved: 'Onaylı',
  rejected: 'Reddedildi',
  suspended: 'Askıda',
};

const DOC_LABEL: Record<string, string> = {
  registration: 'Ruhsat',
  insurance: 'Sigorta',
  inspection: 'Muayene',
  authorization: 'Yetki belgesi',
};

export default function GarageScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const vehicles = useRideVehicles();
  const remove = useRemoveVehicle();

  const confirmRemove = (id: string, plate: string) => {
    Alert.alert(
      'Araç kaldırılsın mı?',
      `${plate} plakalı araç pasife alınacak. Devam eden rezervasyonların kapasite koşulları kontrol edilir.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: () =>
            remove.mutate(id, {
              onError: (cause) => Alert.alert('Araç kaldırılamadı', cause.message),
            }),
        },
      ],
    );
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Garajım"
        subtitle="Araçlar, belgeler ve doğrulama durumları"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Araç ekle"
            onPress={() => router.navigate('/ride/garage/create' as never)}
            style={[styles.iconBtn, { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border }]}
          >
            <Ionicons name="add" size={20} color={theme.colors.primaryDeep} />
          </Pressable>
        }
      />

      <Card padding={13} tone="muted">
        <View style={styles.infoRow}>
          <Ionicons name="shield-checkmark-outline" size={17} color={theme.colors.primaryDeep} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Aracını eklediğin an yolculuk ilanı yayınlayabilirsin; araç onayı beklemezsin.
            Ruhsat, sigorta ve muayene belgelerini yine de garajdan yükleyip geçerlilik
            tarihlerini takip edebilirsin.
          </AppText>
        </View>
      </Card>

      {vehicles.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.primary} /></View>
      ) : vehicles.isError ? (
        <RideEmptyState
          icon="cloud-offline-outline"
          title="Garaj yüklenemedi"
          message={vehicles.error.message}
          action={<Button label="Tekrar dene" variant="secondary" onPress={() => void vehicles.refetch()} />}
        />
      ) : (vehicles.data?.length ?? 0) === 0 ? (
        <RideEmptyState
          icon="car-sport-outline"
          title="Henüz araç yok"
          message="Sürücü ilanı yayınlamak için aracını ekle ve belgelerini yükle. Belgeler özel kovada saklanır."
          action={<Button label="Araç ekle" onPress={() => router.navigate('/ride/garage/create' as never)} />}
        />
      ) : (
        <View style={styles.list}>
          {vehicles.data?.map((vehicle) => {
            const photo = rideVehiclePhotoUrl(vehicle.photo_paths?.[0]);
            const docs = vehicle.documents ?? [];
            return (
              <Card key={vehicle.id} padding={0} style={styles.card}>
                <View style={styles.photoWrap}>
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" transition={180} />
                  ) : (
                    <View style={[styles.photo, styles.photoFallback, { backgroundColor: theme.colors.primarySoft }]}>
                      <Ionicons name="car-sport" size={34} color={theme.colors.primaryDeep} />
                    </View>
                  )}
                  <View style={styles.photoTop}>
                    <Badge
                      label={STATUS_LABEL[vehicle.status] ?? vehicle.status}
                      tone={
                        vehicle.status === 'approved' || vehicle.status === 'pending'
                          ? 'success'
                          : vehicle.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    />
                    {!vehicle.is_active ? <Badge label="Pasif" tone="neutral" /> : null}
                  </View>
                </View>

                <View style={styles.body}>
                  <View style={styles.headRow}>
                    <View style={styles.flex}>
                      <AppText variant="h3">{vehicle.make} {vehicle.model}</AppText>
                      <AppText variant="caption" color="textTertiary">
                        {vehicle.year} · {vehicle.color} · {vehicle.plate}
                      </AppText>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Aracı düzenle"
                      onPress={() => router.navigate({ pathname: '/ride/garage/create', params: { id: vehicle.id } } as never)}
                      style={[styles.smallIcon, { backgroundColor: theme.colors.surfaceMuted }]}
                    >
                      <Ionicons name="create-outline" size={17} color={theme.colors.text} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Aracı kaldır"
                      onPress={() => confirmRemove(vehicle.id, vehicle.plate)}
                      style={[styles.smallIcon, { backgroundColor: theme.colors.surfaceMuted }]}
                    >
                      <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
                    </Pressable>
                  </View>

                  <View style={styles.badges}>
                    <Badge label={`${vehicle.seat_capacity} koltuk`} tone="neutral" />
                    <Badge label={vehicle.luggage_capacity === 'large' ? 'Büyük bagaj' : vehicle.luggage_capacity === 'small' ? 'Küçük bagaj' : 'Orta bagaj'} tone="neutral" />
                    {vehicle.has_ac ? <Badge label="Klima" tone="primary" /> : null}
                    {vehicle.accessibility?.wheelchair ? <Badge label="Erişilebilir" tone="accent" /> : null}
                  </View>

                  {vehicle.reject_reason ? (
                    <AppText variant="caption" color="danger">{vehicle.reject_reason}</AppText>
                  ) : null}

                  <View style={styles.docs}>
                    <AppText variant="caption" color="textSecondary">Belgeler</AppText>
                    {docs.length === 0 ? (
                      <AppText variant="caption" color="textTertiary">
                        Belge yüklenmedi. İlan yayınlanamaz.
                      </AppText>
                    ) : (
                      docs.map((doc) => (
                        <View key={doc.id} style={styles.docRow}>
                          <Ionicons
                            name={doc.status === 'approved' ? 'checkmark-circle' : doc.status === 'rejected' ? 'close-circle' : 'time-outline'}
                            size={15}
                            color={doc.status === 'approved' ? theme.colors.success : doc.status === 'rejected' ? theme.colors.danger : theme.colors.warning}
                          />
                          <AppText variant="caption" color="textSecondary" style={styles.flex}>
                            {DOC_LABEL[doc.kind] ?? doc.kind}
                            {doc.expires_at ? ` · ${formatDate(doc.expires_at)}` : ''}
                          </AppText>
                          <Badge
                            label={STATUS_LABEL[doc.status] ?? doc.status}
                            tone={doc.status === 'approved' ? 'success' : doc.status === 'rejected' ? 'danger' : 'warning'}
                          />
                        </View>
                      ))
                    )}
                    <Button
                      label="Belge ekle / yenile"
                      size="sm"
                      variant="secondary"
                      onPress={() => router.navigate({ pathname: '/ride/garage/create', params: { id: vehicle.id } } as never)}
                    />
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <Button
        label="Yeni araç ekle"
        leftIcon={<Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />}
        onPress={() => router.navigate('/ride/garage/create' as never)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  center: { paddingVertical: 50, alignItems: 'center' },
  list: { gap: 12 },
  card: { overflow: 'hidden' },
  photoWrap: { height: 150, position: 'relative' },
  photo: { width: '100%', height: '100%' },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  photoTop: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  body: { padding: 14, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  docs: { gap: 7 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
