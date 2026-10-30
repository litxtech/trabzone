import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { useWebTracking } from '../hooks/use-accommodation';
import { PROPERTY_STATUS_LABELS, SOURCE_LABELS, formatMoneyCents, formatPercent } from '../utils/format';
import {
  AccCard,
  EmptyState,
  InlineError,
  InfoBanner,
  LoadingBlock,
  StatTile,
  StatusPill,
} from './AccommodationUI';

const SITE_URL = 'https://www.trabzoneapp.com';

export function WebTrackingCenter({ propertyId }: { propertyId: string }) {
  const { theme } = useTheme();
  const tracking = useWebTracking(propertyId);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = tracking.data;
  const url = data ? `${SITE_URL}/konaklama/${data.slug}` : null;

  const copy = async () => {
    if (!url) return;
    setError(null);
    try {
      await Clipboard.setStringAsync(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Bağlantı kopyalanamadı.');
    }
  };

  const open = async () => {
    if (!url) return;
    setError(null);
    try {
      if (Platform.OS === 'web') {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        await Linking.openURL(url);
      }
    } catch {
      setError('Bağlantı açılamadı.');
    }
  };

  if (tracking.isLoading) return <LoadingBlock height={240} />;
  if (tracking.isError || !data) {
    return (
      <InlineError
        message={tracking.error instanceof Error ? tracking.error.message : 'Web takip verileri yüklenemedi.'}
        onRetry={() => void tracking.refetch()}
      />
    );
  }

  const maxSource = Math.max(1, ...data.sources.map((entry) => entry.count));

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="h3">Web’den takip et</AppText>
          <AppText variant="caption" color="textTertiary">Tesis sayfası görüntüleme ve dönüşüm</AppText>
        </View>
        <StatusPill
          label={PROPERTY_STATUS_LABELS[data.status]}
          color={data.status === 'published' ? theme.colors.success : theme.colors.warning}
          background={data.status === 'published' ? theme.colors.successSoft : theme.colors.warningSoft}
        />
      </View>

      {data.status !== 'published' ? (
        <InfoBanner
          text="Tesis yayında değilken web bağlantısı ziyaretçilere kapalıdır. Doğrulama ve yayın onayı sonrası bağlantı aktif olur."
          tone="warning"
        />
      ) : null}

      {error ? <InlineError message={error} /> : null}

      <AccCard padding={12} style={styles.linkCard}>
        <View style={[styles.linkIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name="globe-outline" size={18} color={theme.colors.primary} />
        </View>
        <View style={styles.flex}>
          <AppText variant="caption" color="textTertiary">Tesis sayfası</AppText>
          <AppText variant="body" numberOfLines={1} selectable>{url}</AppText>
        </View>
        <View style={styles.linkActions}>
          <Button label={copied ? 'Kopyalandı' : 'Kopyala'} size="sm" variant="outline" fullWidth={false} onPress={() => void copy()} />
          <Button label="Aç" size="sm" fullWidth={false} onPress={() => void open()} />
        </View>
      </AccCard>

      <View style={styles.stats}>
        <View style={styles.statTile}>
          <StatTile label="Toplam görüntüleme" value={String(data.view_count)} icon="eye-outline" tone="primary" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Son 30 gün" value={String(data.last_30_days)} icon="calendar-outline" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Rezervasyon" value={String(data.reservation_count)} icon="bed-outline" tone="success" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Doğrudan web" value={String(data.direct_web_count)} icon="globe-outline" tone="accent" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Dönüşüm" value={formatPercent(data.conversion_rate)} icon="trending-up-outline" tone="warning" />
        </View>
        <View style={styles.statTile}>
          <StatTile label="Tamamlanan gelir" value={formatMoneyCents(data.completed_revenue_cents)} icon="cash-outline" tone="success" />
        </View>
      </View>

      <AccCard padding={13} style={styles.sources}>
        <AppText variant="bodyStrong">Rezervasyon kaynakları</AppText>
        {data.sources.length === 0 ? (
          <EmptyState icon="analytics-outline" title="Veri yok" message="Henüz rezervasyon kaynağı oluşmadı." compact />
        ) : (
          data.sources.map((source) => (
            <View key={source.source} style={styles.sourceRow}>
              <AppText variant="caption" color="textSecondary" style={styles.sourceLabel} numberOfLines={1}>
                {SOURCE_LABELS[source.source]}
              </AppText>
              <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.max(3, (source.count / maxSource) * 100)}%`,
                      backgroundColor: source.source === 'trabzone' ? theme.colors.primary : theme.colors.accent,
                    },
                  ]}
                />
              </View>
              <AppText variant="caption" color="text" style={styles.count}>{source.count}</AppText>
            </View>
          ))
        )}
        <AppText variant="caption" color="textTertiary">
          Görüntüleme verileri yalnızca “Web’den takip” ayarı açıkken toplanır. Kişisel veriler anonimleştirilir.
        </AppText>
      </AccCard>

      <InfoBanner text="Tesis sayfasını sosyal medyada paylaşarak doğrudan rezervasyon alabilirsin. Trabzone kaynaklı rezervasyonlarda %10 komisyon uygulanır; doğrudan web ve telefon rezervasyonlarında komisyon alınmaz." />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  linkIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  linkActions: { flexDirection: 'row', gap: 6 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { width: '32%', minWidth: 150, flexGrow: 1 },
  sources: { gap: 7 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceLabel: { width: 100 },
  barTrack: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  count: { width: 28, textAlign: 'right' },
});
