import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminSection } from '@/features/admin/components/AdminPage';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminExploreOverview } from '@/features/explore/hooks/use-explore';
import { useTheme } from '@/theme/ThemeProvider';

import { formatNumber } from './labels';
import { AdminQueryState } from './AdminExploreShared';

const QUEUE_KEYS = [
  ['place_suggestions', 'Yer önerisi'],
  ['place_claims', 'Sahiplenme'],
  ['place_media', 'İşletme medyası'],
  ['place_reports', 'İşletme şikâyeti'],
  ['re_listings', 'Emlak ilanı'],
  ['re_verifications', 'EİDS doğrulama'],
  ['re_media', 'Emlak medyası'],
  ['re_reports', 'Emlak şikâyeti'],
] as const;

export function ExploreOverviewPanel() {
  const { theme } = useTheme();
  const router = useRouter();
  const query = useAdminExploreOverview();

  const data = query.data;
  const totalQueue = data
    ? Object.values(data.queue).reduce((sum, value) => sum + value, 0)
    : 0;

  return (
    <AdminQueryState
      loading={query.isLoading}
      error={query.isError ? query.error.message : null}
      onRetry={() => void query.refetch()}
    >
      {data ? (
        <>
          <StatGrid>
            <StatCard
              label="Toplam işletme"
              value={formatNumber(data.places.total)}
              icon="storefront-outline"
              hint={`${formatNumber(data.places.published)} yayında · ${formatNumber(data.places.pending)} onay bekliyor`}
            />
            <StatCard
              label="Doğrulanmış işletme"
              value={formatNumber(data.places.verified)}
              icon="shield-checkmark-outline"
              tone="success"
              hint="Kullanıcı ve sahip doğrulaması tamamlanmış"
            />
            <StatCard
              label="Fotoğrafsız işletme"
              value={formatNumber(data.places.without_photo)}
              icon="image-outline"
              tone={data.places.without_photo > 0 ? 'warning' : 'success'}
              hint={`${formatNumber(data.places.missing_address)} kayıtta adres eksik`}
            />
            <StatCard
              label="Moderasyon kuyruğu"
              value={formatNumber(totalQueue)}
              icon="layers-outline"
              tone={totalQueue > 0 ? 'warning' : 'success'}
              hint="İşletme + emlak bekleyen işlemler"
            />
            <StatCard
              label="Emlak ilanı"
              value={formatNumber(data.real_estate.total)}
              icon="home-outline"
              tone="accent"
              hint={`${formatNumber(data.real_estate.published)} yayında · ${formatNumber(data.real_estate.pending)} doğrulama bekliyor`}
            />
            <StatCard
              label="Kategori"
              value={`${formatNumber(data.categories.place)} / ${formatNumber(data.categories.real_estate)}`}
              icon="pricetags-outline"
              hint="İşletme / emlak kategorisi"
            />
          </StatGrid>

          <AdminSection
            title="Bekleyen işlemler"
            subtitle="Her sayaç ilgili moderasyon sekmesindeki gerçek kayıt sayısıdır."
            action={<Badge label={`${formatNumber(totalQueue)} toplam`} tone={totalQueue > 0 ? 'warning' : 'success'} />}
          >
            <View style={styles.queueGrid}>
              {QUEUE_KEYS.map(([key, label]) => {
                const value = data.queue[key] ?? 0;
                return (
                  <View
                    key={key}
                    style={[
                      styles.queueCard,
                      {
                        backgroundColor: value > 0 ? theme.colors.warningSoft : theme.colors.surfaceMuted,
                        borderColor: value > 0 ? theme.colors.warning : theme.colors.border,
                      },
                    ]}
                  >
                    <AppText variant="h3" color={value > 0 ? 'warning' : 'textTertiary'}>
                      {formatNumber(value)}
                    </AppText>
                    <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                      {label}
                    </AppText>
                  </View>
                );
              })}
            </View>
          </AdminSection>

          <AdminSection
            title="Hizmet bölgesi ve yasal durum"
            subtitle="Trabzon dışına yayın açılmaz. Doğrulama anahtarı kapalıyken ilan yayınlanamaz."
          >
            <View style={styles.factRow}>
              <Fact
                icon="location-outline"
                label="İlçe"
                value={formatNumber(data.districts)}
                hint="Trabzon hizmet sınırı"
              />
              <Fact
                icon="shield-checkmark-outline"
                label="EİDS doğrulama"
                value={data.eids_enabled ? 'Etkin' : 'Kapalı'}
                hint={
                  data.eids_enabled
                    ? 'Doğrulama kayıtları incelenebilir'
                    : 'Onaylama ve yayınlama sunucu tarafında engelli'
                }
                tone={data.eids_enabled ? 'success' : 'warning'}
              />
              <Fact
                icon="key-outline"
                label="Yetkileriniz"
                value={String(Object.values(data.permissions).filter(Boolean).length)}
                hint="Harita ve emlak izin anahtarı"
              />
            </View>
          </AdminSection>

          <View style={styles.links}>
            <Button
              label="İşletme ve harita yönetimi"
              variant="secondary"
              size="sm"
              fullWidth={false}
              leftIcon={<Ionicons name="map-outline" size={15} color={theme.colors.primaryDeep} />}
              onPress={() => router.push('/admin/explore' as never)}
            />
            <Button
              label="Emlak yönetimi"
              variant="secondary"
              size="sm"
              fullWidth={false}
              leftIcon={<Ionicons name="home-outline" size={15} color={theme.colors.primaryDeep} />}
              onPress={() => router.push('/admin/real-estate' as never)}
            />
            <Button
              label="Harita veri sağlığı"
              variant="outline"
              size="sm"
              fullWidth={false}
              leftIcon={<Ionicons name="pulse-outline" size={15} color={theme.colors.text} />}
              onPress={() => router.push('/admin/explore-health' as never)}
            />
          </View>
        </>
      ) : null}
    </AdminQueryState>
  );
}

function Fact({
  icon,
  label,
  value,
  hint,
  tone = 'primary',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  hint: string;
  tone?: 'primary' | 'success' | 'warning';
}) {
  const { theme } = useTheme();
  const color =
    tone === 'success' ? theme.colors.success : tone === 'warning' ? theme.colors.warning : theme.colors.primary;
  return (
    <View style={[styles.fact, { borderColor: theme.colors.border }]}>
      <View style={[styles.factIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color="textTertiary">
          {label}
        </AppText>
        <AppText variant="bodyStrong">{value}</AppText>
        <AppText variant="caption" color="textTertiary">
          {hint}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  queueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  queueCard: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 132,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    gap: 2,
  },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fact: {
    flexGrow: 1,
    flexBasis: 240,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  factIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
