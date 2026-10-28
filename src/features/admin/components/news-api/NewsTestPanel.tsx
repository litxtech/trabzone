import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { useNewsApiTest } from '../../hooks/use-admin-news-api';
import type { NewsTestInput } from '../../services/news-api-service';
import type { NewsTestResult } from '@/features/news-api/types';

import { EmptyHint, InfoRow, newsApiStyles } from './shared';

function formatLabel(format: string | null | undefined) {
  if (!format) return '—';
  const map: Record<string, string> = {
    rss: 'RSS 2.0',
    atom: 'Atom',
    xml: 'XML',
    json_feed: 'JSON Feed',
    rest_json: 'REST JSON',
    json: 'JSON',
  };
  return map[format] ?? format.toUpperCase();
}

export function NewsTestResultView({ result }: { result: NewsTestResult }) {
  const { theme } = useTheme();
  return (
    <View style={newsApiStyles.gap}>
      <View style={newsApiStyles.row}>
        <Badge label={result.ok ? 'Bağlantı başarılı' : 'Bağlantı başarısız'} tone={result.ok ? 'success' : 'danger'} />
        <Badge label={`HTTP ${result.http_status ?? '—'}`} tone={result.http_status && result.http_status < 400 ? 'neutral' : 'danger'} />
        <Badge label={`${result.response_ms ?? 0} ms`} tone="neutral" />
        <Badge label={formatLabel(result.format)} tone="accent" />
        <Badge label={`${result.item_count} haber`} tone="primary" />
      </View>

      <View>
        <InfoRow label="Kimlik doğrulama" value={result.auth_ok == null ? 'Gerekmiyor' : result.auth_ok ? 'Başarılı' : 'Başarısız'} />
        <InfoRow label="Feed başlığı" value={result.feed_title || '—'} />
        <InfoRow label="İçerik türü" value={result.content_type || '—'} />
        <InfoRow label="Boyut" value={result.bytes ? `${new Intl.NumberFormat('tr-TR').format(result.bytes)} bayt` : '—'} />
        <InfoRow label="Sayfalama" value={result.pagination?.kind === 'next_url' ? 'next_url destekli' : 'Tek sayfa'} />
        <InfoRow
          label="Son hata"
          value={
            result.error ? (
              <AppText variant="caption" color="danger">
                {result.error}
              </AppText>
            ) : (
              'Yok'
            )
          }
        />
      </View>

      {result.fields.length > 0 ? (
        <View style={newsApiStyles.gapSm}>
          <AppText variant="label">Algılanan alanlar ({result.fields.length})</AppText>
          <View style={[styles.fieldWrap, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}>
            {result.fields.map((field) => (
              <View key={field} style={[styles.fieldPill, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
                <AppText variant="caption" color="textSecondary" style={newsApiStyles.mono}>
                  {field}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">Örnek haberler (yayımlanmaz)</AppText>
        {result.sample.length === 0 ? (
          <EmptyHint text="Feed'den örnek haber dönmedi." icon="alert-circle-outline" />
        ) : (
          result.sample.map((item, index) => (
            <View
              key={`${item.url ?? index}-${index}`}
              style={[styles.sample, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
            >
              <AppText variant="bodyStrong" numberOfLines={2}>
                {item.title || '(başlık yok)'}
              </AppText>
              {item.summary ? (
                <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                  {item.summary}
                </AppText>
              ) : null}
              <View style={styles.sampleMeta}>
                <Badge label={item.source_category || 'Kategori yok'} tone="neutral" />
                <Badge label={item.district || item.city || 'Konum yok'} tone="neutral" />
                {item.has_image ? <Badge label="Görsel" tone="success" /> : null}
                {item.has_video ? <Badge label="Video" tone="accent" /> : null}
                <AppText variant="caption" color="textTertiary">
                  {item.published_at ? new Date(item.published_at).toLocaleString('tr-TR') : 'Tarih yok'}
                </AppText>
              </View>
              {item.url ? (
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {item.url}
                </AppText>
              ) : null}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

export function NewsTestPanel({
  connectionId,
  config,
  onTested,
  lastResult,
}: {
  connectionId?: string;
  config?: NewsTestInput['config'];
  onTested?: (result: NewsTestResult) => void;
  lastResult?: NewsTestResult | null;
}) {
  const test = useNewsApiTest();
  const [result, setResult] = useState<NewsTestResult | null>(lastResult ?? null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    try {
      const output = await test.mutateAsync({ connectionId, config });
      setResult(output);
      onTested?.(output);
    } catch (testError) {
      setError(errorMessage(testError, 'Test isteği tamamlanamadı.'));
    }
  };

  return (
    <View style={newsApiStyles.gap}>
      <View style={newsApiStyles.row}>
        <Button
          label={test.isPending ? 'Test ediliyor…' : 'Bağlantıyı Test Et'}
          size="sm"
          fullWidth={false}
          loading={test.isPending}
          disabled={!connectionId && !config?.feed_url}
          leftIcon={<Ionicons name="pulse-outline" size={15} color="#FFFFFF" />}
          onPress={() => void run()}
        />
        <AppText variant="caption" color="textTertiary" style={newsApiStyles.flex}>
          Test isteği sunucudan gönderilir; SSRF koruması, boyut ve süre sınırı uygulanır. Test sırasında hiçbir haber
          yayımlanmaz.
        </AppText>
      </View>

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}

      {test.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : result ? (
        <NewsTestResultView result={result} />
      ) : (
        <EmptyHint text="Henüz test edilmedi. Bağlantıyı test ederek dönen alanları ve örnek haberleri gör." />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10 },
  fieldPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  sample: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11, gap: 6 },
  sampleMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  center: { paddingVertical: 20, alignItems: 'center' },
});
