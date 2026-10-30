import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Card, IconButton, Screen } from '@/components/ui';
import { SelectSheet } from '@/components/ui/SelectSheet';
import {
  useLiveNewsPreferences,
  useSaveLiveNewsPreferences,
} from '@/features/live-news/hooks/use-live-news';
import { LIVE_NEWS_DISTRICTS } from '@/features/live-news/services/live-news-service';
import type { LiveNewsNotificationPreferences } from '@/features/live-news/types';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';
import { toMessage } from '@/utils/error-message';

const DEFAULTS: LiveNewsNotificationPreferences = {
  followed_people: true,
  district_updates: true,
  verified_only: false,
  district: null,
};

/**
 * Anlık gelişme bildirim tercihleri.
 *
 * Kullanıcı yalnızca ilgilendiği kaynakları seçer; her yeni içerik için
 * cihazlara global bildirim gönderilmez. `Yalnızca doğrulanmış` seçildiğinde
 * ilçe bildirimi doğrulama tamamlanmadan gönderilmez.
 */
export default function LiveNewsNotificationSettingsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const preferences = useLiveNewsPreferences();
  const save = useSaveLiveNewsPreferences();
  const [districtOpen, setDistrictOpen] = useState(false);
  const [draft, setDraft] = useState<LiveNewsNotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sunucu tercihleri yüklenene kadar güvenli varsayılanlar gösterilir; kullanıcı
  // bir anahtarı değiştirdiğinde iyimser taslak devreye girer.
  const prefs = draft ?? preferences.data ?? DEFAULTS;

  const update = (patch: Partial<LiveNewsNotificationPreferences>) => {
    const next = { ...prefs, ...patch };
    setDraft(next);
    setError(null);
    save.mutate(next, {
      onError: (cause) => {
        setDraft(null);
        setError(toMessage(cause));
      },
    });
  };

  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <View style={styles.header}>
        <IconButton
          name="chevron-back"
          accessibilityLabel="Geri"
          variant="surface"
          size={20}
          onPress={() => router.back()}
        />
        <AppText variant="h3">Anlık haber bildirimleri</AppText>
        <View style={styles.headerSpacer} />
      </View>

      {preferences.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <>
          <Card padding={0}>
            <ToggleRow
              icon="people-outline"
              title="Takip ettiğim kişiler"
              description="Takip ettiğin kullanıcı yeni bir anlık gelişme paylaştığında bildir."
              value={prefs.followed_people}
              onValueChange={(value) => update({ followed_people: value })}
            />
            <Divider />
            <ToggleRow
              icon="location-outline"
              title="İlçemdeki doğrulanmış gelişmeler"
              description="Seçtiğin ilçede yeni gelişme yayımlandığında bildir."
              value={prefs.district_updates}
              onValueChange={(value) => update({ district_updates: value })}
            />
            <Divider />
            <ToggleRow
              icon="checkmark-done-outline"
              title="Yalnızca doğrulanmış bilgiler"
              description="Doğrulama tamamlanmadan bildirim gönderilmez."
              value={prefs.verified_only}
              onValueChange={(value) => update({ verified_only: value })}
            />
          </Card>

          <View style={styles.section}>
            <AppText variant="overline" color="textTertiary" style={styles.sectionTitle}>
              BÖLGE
            </AppText>
            <Card padding={0}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Bildirim ilçesi seç"
                onPress={() => setDistrictOpen(true)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent' },
                ]}
              >
                <View style={[styles.rowIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
                  <Ionicons name="business-outline" size={18} color={theme.colors.primaryDeep} />
                </View>
                <View style={styles.rowText}>
                  <AppText variant="bodyStrong">Bildirim ilçesi</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Konum izni gerekmez; ilçeyi kendin seçersin.
                  </AppText>
                </View>
                <AppText variant="caption" color="primaryDeep">
                  {prefs.district ?? 'Tüm Trabzon'}
                </AppText>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
              </Pressable>
            </Card>
          </View>

          {error ? (
            <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.errorText}>
                {error}
              </AppText>
            </View>
          ) : null}

          <AppText variant="caption" color="textTertiary" style={styles.note}>
            Aynı gelişme için tekrar tekrar bildirim gönderilmez. Bildirimler yalnızca seçtiğin
            kaynaklara ve bölgeye göre sınırlandırılır.
          </AppText>
        </>
      )}

      <SelectSheet
        visible={districtOpen}
        title="Bildirim ilçesi"
        options={['Tüm Trabzon', ...LIVE_NEWS_DISTRICTS]}
        value={prefs.district ?? 'Tüm Trabzon'}
        onClose={() => setDistrictOpen(false)}
        onSelect={(value) => {
          update({ district: value === 'Tüm Trabzon' ? null : value });
          setDistrictOpen(false);
        }}
      />
    </Screen>
  );
}

function ToggleRow({
  icon,
  title,
  description,
  value,
  onValueChange,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={18} color={theme.colors.primaryDeep} />
      </View>
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color="textTertiary">
          {description}
        </AppText>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={title}
        trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
      />
    </View>
  );
}

function Divider() {
  const { theme } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 54,
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 16,
  },
  headerSpacer: { width: 44 },
  center: { paddingVertical: 40, alignItems: 'center' },
  section: { marginTop: 20, gap: 8 },
  sectionTitle: { paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 50,
  },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 11, borderRadius: 12, marginTop: 14 },
  errorText: { flex: 1, lineHeight: 17 },
  note: { marginTop: 16, paddingHorizontal: 4, lineHeight: 17 },
});
