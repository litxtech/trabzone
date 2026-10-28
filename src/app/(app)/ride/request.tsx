import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { RideSection } from '@/features/ride/components/RideBits';
import { RideHeader } from '@/features/ride/components/RideHeader';
import { useCreateRideRequest } from '@/features/ride/hooks/use-ride';
import { geocodePlace } from '@/features/ride/services/map-service';
import type { RideScope } from '@/features/ride/types';
import { formatDateTime, toIsoFromLocal } from '@/features/ride/utils/format';

export default function CreateRideRequestScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ origin?: string; dest?: string; scope?: string }>();
  const create = useCreateRideRequest();

  const now = new Date();
  const [scope, setScope] = useState<RideScope>(
    params.scope === 'intercity' ? 'intercity' : 'intracity',
  );
  const [originLabel, setOriginLabel] = useState(params.origin ?? '');
  const [originCity, setOriginCity] = useState('');
  const [destLabel, setDestLabel] = useState(params.dest ?? '');
  const [destCity, setDestCity] = useState('');
  const [earliestDate, setEarliestDate] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  );
  const [earliestTime, setEarliestTime] = useState(
    `${String(Math.min(23, now.getHours() + 1)).padStart(2, '0')}:00`,
  );
  const [latestDate, setLatestDate] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  );
  const [latestTime, setLatestTime] = useState('23:30');
  const [partySize, setPartySize] = useState(1);
  const [luggage, setLuggage] = useState<'small' | 'medium' | 'large'>('medium');
  const [notes, setNotes] = useState('');
  const [mandatory, setMandatory] = useState({
    ac: false,
    no_smoking: true,
    women_only: false,
    accessible: false,
    child_seat: false,
  });
  const [wishes, setWishes] = useState({
    quiet: false,
    pets: false,
    breaks: true,
    charging: false,
  });
  const [created, setCreated] = useState<{ id: string; earliest: string; latest: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const toggleMandatory = (key: keyof typeof mandatory) =>
    setMandatory((current) => ({ ...current, [key]: !current[key] }));

  const handleCreate = async () => {
    setError(null);
    if (!originLabel.trim() || !originCity.trim() || !destLabel.trim() || !destCity.trim()) {
      setError('Kalkış ve varış noktalarını şehir bilgisiyle doldur.');
      return;
    }
    const earliest = toIsoFromLocal(earliestDate, earliestTime);
    const latest = toIsoFromLocal(latestDate, latestTime);
    if (!earliest || !latest) {
      setError('Tarih ve saat biçimini kontrol et.');
      return;
    }
    if (new Date(latest).getTime() <= new Date(earliest).getTime()) {
      setError('En geç kalkış, en erken kalkıştan sonra olmalı.');
      return;
    }
    try {
      const [originResult, destResult] = await Promise.all([
        geocodePlace(`${originLabel}, ${originCity}`),
        geocodePlace(`${destLabel}, ${destCity}`),
      ]);
      const request = await create.mutateAsync({
        scope,
        originLabel: originLabel.trim(),
        originCity: originCity.trim(),
        originLat: originResult.ok ? originResult.data.lat : null,
        originLng: originResult.ok ? originResult.data.lng : null,
        destLabel: destLabel.trim(),
        destCity: destCity.trim(),
        destLat: destResult.ok ? destResult.data.lat : null,
        destLng: destResult.ok ? destResult.data.lng : null,
        earliestDepart: earliest,
        latestDepart: latest,
        partySize,
        luggage,
        preferences: {
          ...wishes,
          child_seat: mandatory.child_seat,
          women_only: mandatory.women_only,
          accessible_required: mandatory.accessible,
        },
        mandatory,
        notes: notes.trim() || null,
      });
      setCreated({ id: request.id, earliest, latest });
    } catch (cause) {
      setError(errorMessage(cause, 'Yolcu talebi oluşturulamadı.'));
    }
  };

  if (created) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
        <RideHeader
          title="Talebin yayında"
          subtitle="Sürücüler talebini eşleştirme motorunda görebilir."
        />
        <Card padding={18} style={styles.success}>
          <View style={[styles.successIcon, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="checkmark-circle" size={40} color={theme.colors.success} />
          </View>
          <AppText variant="h2" align="center">
            Talebin oluşturuldu
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {formatDateTime(created.earliest)} – {formatDateTime(created.latest)} aralığında{' '}
            {partySize} kişi için sürücü eşleştirmesi yapılacak.
          </AppText>
          <Button
            label="Taleplerime git"
            onPress={() => router.replace('/ride/requests' as never)}
          />
          <Button
            label="Yolculuk ara"
            variant="secondary"
            onPress={() => router.replace({ pathname: '/ride/search', params: { scope } } as never)}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Yolcu talebi oluştur"
        subtitle="Sürücüler uygun güzergâhı bulduğunda eşleşir"
      />

      <View style={styles.optionRow}>
        {(['intracity', 'intercity'] as RideScope[]).map((item) => {
          const active = scope === item;
          return (
            <Pressable
              key={item}
              onPress={() => setScope(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.option,
                {
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                },
              ]}
            >
              <Ionicons
                name={item === 'intracity' ? 'business-outline' : 'trail-sign-outline'}
                size={16}
                color={active ? theme.colors.primaryDeep : theme.colors.textSecondary}
              />
              <AppText variant="label" color={active ? 'primaryDeep' : 'textSecondary'}>
                {item === 'intracity' ? 'Şehir içi' : 'Şehirler arası'}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <Card padding={16}>
        <RideSection
          bare
          title="Nereden, nereye?"
          subtitle="Hassas adresin herkese açık ilanda gösterilmez."
        >
          <View style={styles.fieldGroup}>
            <TextInput
              value={originLabel}
              onChangeText={setOriginLabel}
              placeholder="Nereden gitmek istiyorsun?"
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
          </View>
          <View style={styles.fieldGroup}>
            <TextInput
              value={destLabel}
              onChangeText={setDestLabel}
              placeholder="Nereye gitmek istiyorsun?"
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
          </View>
        </RideSection>
      </Card>

      <Card padding={16}>
        <RideSection
          bare
          title="Ne zaman?"
          subtitle="Saat esnekliği eşleştirme puanını doğrudan etkiler."
        >
          <AppText variant="caption" color="textSecondary">
            En erken kalkış
          </AppText>
          <View style={styles.split}>
            <TextInput
              value={earliestDate}
              onChangeText={setEarliestDate}
              placeholder="YYYY-AA-GG"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                styles.flex,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
            <TextInput
              value={earliestTime}
              onChangeText={setEarliestTime}
              placeholder="SS:DD"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                styles.timeInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
          </View>
          <AppText variant="caption" color="textSecondary">
            En geç kalkış
          </AppText>
          <View style={styles.split}>
            <TextInput
              value={latestDate}
              onChangeText={setLatestDate}
              placeholder="YYYY-AA-GG"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                styles.flex,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
            <TextInput
              value={latestTime}
              onChangeText={setLatestTime}
              placeholder="SS:DD"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                styles.timeInput,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
          </View>
          <View style={styles.counterRow}>
            <AppText variant="body" color="textSecondary">
              Kaç kişi?
            </AppText>
            <View style={styles.counter}>
              <Pressable
                onPress={() => setPartySize((value) => Math.max(1, value - 1))}
                style={[styles.stepBtn, { borderColor: theme.colors.border }]}
              >
                <Ionicons name="remove" size={15} color={theme.colors.text} />
              </Pressable>
              <AppText variant="h3">{partySize}</AppText>
              <Pressable
                onPress={() => setPartySize((value) => Math.min(8, value + 1))}
                style={[styles.stepBtn, { borderColor: theme.colors.border }]}
              >
                <Ionicons name="add" size={15} color={theme.colors.text} />
              </Pressable>
            </View>
          </View>
          <View style={styles.chips}>
            {(['small', 'medium', 'large'] as const).map((item) => {
              const active = luggage === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setLuggage(item)}
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
                    {item === 'small' ? 'Az bagaj' : item === 'medium' ? 'Orta bagaj' : 'Çok bagaj'}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </RideSection>
      </Card>

      <Card padding={16}>
        <RideSection
          bare
          title="Zorunlu tercihler"
          subtitle="Bu koşulları karşılamayan sürücüler eşleşmez."
        >
          {[
            { key: 'ac' as const, label: 'Klima zorunlu' },
            { key: 'no_smoking' as const, label: 'Sigarasız araç' },
            { key: 'women_only' as const, label: 'Yalnızca kadın sürücü' },
            { key: 'accessible' as const, label: 'Erişilebilir araç' },
            { key: 'child_seat' as const, label: 'Çocuk koltuğu' },
          ].map((item) => (
            <View key={item.key} style={styles.switchRow}>
              <AppText variant="body" color="textSecondary" style={styles.flex}>
                {item.label}
              </AppText>
              <Switch
                value={mandatory[item.key]}
                onValueChange={() => toggleMandatory(item.key)}
                trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primarySoft }}
                thumbColor={mandatory[item.key] ? theme.colors.primary : theme.colors.textTertiary}
              />
            </View>
          ))}
          <AppText variant="caption" color="textTertiary">
            Tercih edilenler
          </AppText>
          <View style={styles.chips}>
            {[
              { key: 'quiet' as const, label: 'Sessiz' },
              { key: 'pets' as const, label: 'Evcil hayvan' },
              { key: 'breaks' as const, label: 'Mola' },
              { key: 'charging' as const, label: 'Şarj' },
            ].map((item) => {
              const active = wishes[item.key];
              return (
                <Pressable
                  key={item.key}
                  onPress={() =>
                    setWishes((current) => ({ ...current, [item.key]: !current[item.key] }))
                  }
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
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Sürücülere not (biniş noktası, bagaj, esneklik vb.)"
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            style={[
              styles.input,
              styles.noteInput,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
              },
            ]}
          />
        </RideSection>
      </Card>

      {error ? (
        <Card padding={12} tone="muted">
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        </Card>
      ) : null}

      <Button
        label="Talebi yayınla"
        size="lg"
        loading={create.isPending}
        onPress={() => void handleCreate()}
      />
      <AppText variant="caption" color="textTertiary" align="center">
        Talebin gerçek veritabanına yazılır ve sürücülerin eşleştirme sonuçlarında görünür.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  optionRow: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 13,
    borderWidth: 1,
    paddingVertical: 10,
  },
  fieldGroup: { gap: 7 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  timeInput: { width: 86 },
  noteInput: { minHeight: 74, textAlignVertical: 'top' },
  split: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  success: { gap: 14, alignItems: 'stretch', marginTop: 20 },
  successIcon: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
