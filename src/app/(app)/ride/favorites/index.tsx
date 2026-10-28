import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { RideEmptyState } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { useFavorites, useRemoveFavorite, useSaveFavorite } from '@/features/ride/hooks/use-ride';
import { geocodePlace } from '@/features/ride/services/map-service';
import type { RideFavorite, RideScope } from '@/features/ride/types';
import { SCOPE_LABEL } from '@/features/ride/utils/format';

export default function RideFavoritesScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ origin?: string; dest?: string; scope?: string }>();
  const favorites = useFavorites();
  const save = useSaveFavorite();
  const remove = useRemoveFavorite();

  const [showForm, setShowForm] = useState(Boolean(params.origin || params.dest));
  const [scope, setScope] = useState<RideScope>(
    params.scope === 'intercity' ? 'intercity' : 'intracity',
  );
  const [label, setLabel] = useState('');
  const [originLabel, setOriginLabel] = useState(params.origin ?? '');
  const [originCity, setOriginCity] = useState('');
  const [destLabel, setDestLabel] = useState(params.dest ?? '');
  const [destCity, setDestCity] = useState('');
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    if (!originLabel.trim() || !destLabel.trim() || !originCity.trim() || !destCity.trim()) {
      setError('Güzergâh ve şehir alanlarını doldur.');
      return;
    }
    try {
      const [originResult, destResult] = await Promise.all([
        geocodePlace(`${originLabel}, ${originCity}`),
        geocodePlace(`${destLabel}, ${destCity}`),
      ]);
      await save.mutateAsync({
        label: label.trim() || `${originCity} → ${destCity}`,
        scope,
        originLabel: originLabel.trim(),
        originCity: originCity.trim(),
        originLat: originResult.ok ? originResult.data.lat : null,
        originLng: originResult.ok ? originResult.data.lng : null,
        destLabel: destLabel.trim(),
        destCity: destCity.trim(),
        destLat: destResult.ok ? destResult.data.lat : null,
        destLng: destResult.ok ? destResult.data.lng : null,
        alertEnabled,
      });
      setShowForm(false);
      setLabel('');
    } catch (cause) {
      setError(errorMessage(cause, 'Güzergâh kaydedilemedi.'));
    }
  };

  const toggleAlert = (favorite: RideFavorite) => {
    save.mutate({
      id: favorite.id,
      label: favorite.label,
      scope: favorite.scope,
      originLabel: favorite.origin_label,
      originCity: favorite.origin_city,
      originLat: favorite.origin_lat,
      originLng: favorite.origin_lng,
      destLabel: favorite.dest_label,
      destCity: favorite.dest_city,
      destLat: favorite.dest_lat,
      destLng: favorite.dest_lng,
      alertEnabled: !favorite.alert_enabled,
    });
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Favori güzergâhlar"
        subtitle="Sık kullandığın rotalar ve uygun yolculuk bildirimleri"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showForm ? 'Formu kapat' : 'Güzergâh ekle'}
            onPress={() => setShowForm((value) => !value)}
            style={[
              styles.iconBtn,
              { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons
              name={showForm ? 'close' : 'add'}
              size={20}
              color={theme.colors.primaryDeep}
            />
          </Pressable>
        }
      />

      {showForm ? (
        <Card padding={15} style={styles.form}>
          <AppText variant="title">Güzergâh kaydet</AppText>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Etiket (Ev → İş)"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <View style={styles.optionRow}>
            {(['intracity', 'intercity'] as RideScope[]).map((item) => {
              const active = scope === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setScope(item)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active
                        ? theme.colors.primarySoft
                        : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'primaryDeep' : 'textSecondary'}>
                    {SCOPE_LABEL[item]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={originLabel}
            onChangeText={setOriginLabel}
            placeholder="Kalkış noktası"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <TextInput
            value={originCity}
            onChangeText={setOriginCity}
            placeholder="Kalkış şehri"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <TextInput
            value={destLabel}
            onChangeText={setDestLabel}
            placeholder="Varış noktası"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <TextInput
            value={destCity}
            onChangeText={setDestCity}
            placeholder="Varış şehri"
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
          <View style={styles.switchRow}>
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              Uygun yolculuk çıktığında bildir
            </AppText>
            <Switch
              value={alertEnabled}
              onValueChange={setAlertEnabled}
              trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
              thumbColor={alertEnabled ? theme.colors.primary : theme.colors.textTertiary}
            />
          </View>
          {error ? (
            <AppText variant="caption" color="danger">
              {error}
            </AppText>
          ) : null}
          <Button
            label="Güzergâhı kaydet"
            loading={save.isPending}
            onPress={() => void handleSave()}
          />
        </Card>
      ) : null}

      {favorites.isLoading ? (
        <Card padding={18}>
          <AppText variant="body" color="textSecondary">
            Yükleniyor…
          </AppText>
        </Card>
      ) : favorites.isError ? (
        <RideEmptyState
          icon="cloud-offline-outline"
          title="Favoriler yüklenemedi"
          message={favorites.error.message}
          action={
            <Button
              label="Tekrar dene"
              variant="secondary"
              onPress={() => void favorites.refetch()}
            />
          }
        />
      ) : (favorites.data?.length ?? 0) === 0 ? (
        <RideEmptyState
          icon="bookmark-outline"
          title="Favori güzergâh yok"
          message="Sık kullandığın rotayı kaydet; uygun yolculuk yayınlandığında bildirim al."
          action={<Button label="Güzergâh ekle" onPress={() => setShowForm(true)} />}
        />
      ) : (
        <View style={styles.list}>
          {favorites.data?.map((favorite) => (
            <Card key={favorite.id} padding={14} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.mark, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="bookmark" size={16} color={theme.colors.primaryDeep} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="label" numberOfLines={1}>
                    {favorite.label}
                  </AppText>
                  <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                    {favorite.origin_label} → {favorite.dest_label}
                  </AppText>
                </View>
                <Badge label={SCOPE_LABEL[favorite.scope]} tone="neutral" />
              </View>
              <View style={styles.cardFoot}>
                <View style={styles.switchRow}>
                  <Ionicons
                    name={favorite.alert_enabled ? 'notifications' : 'notifications-off-outline'}
                    size={15}
                    color={
                      favorite.alert_enabled ? theme.colors.primary : theme.colors.textTertiary
                    }
                  />
                  <AppText variant="caption" color="textTertiary">
                    {favorite.alert_enabled ? 'Bildirim açık' : 'Bildirim kapalı'}
                  </AppText>
                  <Switch
                    value={favorite.alert_enabled}
                    onValueChange={() => toggleAlert(favorite)}
                    trackColor={{
                      false: theme.colors.surfaceMuted,
                      true: theme.colors.primarySoft,
                    }}
                    thumbColor={
                      favorite.alert_enabled ? theme.colors.primary : theme.colors.textTertiary
                    }
                  />
                </View>
                <View style={styles.flex} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bu güzergâhta ara"
                  onPress={() =>
                    router.navigate({
                      pathname: '/ride/search',
                      params: {
                        origin: favorite.origin_city,
                        dest: favorite.dest_city,
                        scope: favorite.scope,
                      },
                    } as never)
                  }
                  style={[styles.smallBtn, { backgroundColor: theme.colors.primarySoft }]}
                >
                  <Ionicons name="search" size={16} color={theme.colors.primaryDeep} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Favoriyi kaldır"
                  onPress={() => remove.mutate(favorite.id)}
                  style={[styles.smallBtn, { backgroundColor: theme.colors.surfaceMuted }]}
                >
                  <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      )}
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
  form: { gap: 9 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  optionRow: { flexDirection: 'row', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  list: { gap: 10 },
  card: { gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
