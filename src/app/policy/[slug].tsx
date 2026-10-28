import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Skeleton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { PolicyBody } from '@/features/safety/components/PolicyBody';
import { useSafetyPolicy } from '@/features/safety/hooks/use-safety';
import { parsePolicyMarkdown } from '@/features/safety/utils/policy-markdown';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

/**
 * Genel yasal politika ekrani: /policy/terms ve /policy/privacy.
 * Metinler veritabanindan surumlenmis olarak gelir; bu sayede icerik
 * guncellemesi icin yeni uygulama surumu gerekmez.
 *
 * Magaza incelemesi ve yasal seffaflik icin oturum acmadan da acilabilir;
 * bu nedenle AuthGate kullanilmaz.
 */
const ALLOWED_SLUGS = ['terms', 'privacy'] as const;
type PolicySlug = (typeof ALLOWED_SLUGS)[number];

const COPY: Record<PolicySlug, { title: string; icon: keyof typeof Ionicons.glyphMap }> = {
  terms: { title: 'Kullanım Koşulları', icon: 'document-text-outline' },
  privacy: { title: 'Gizlilik Politikası', icon: 'lock-closed-outline' },
};

export default function LegalPolicyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const authStatus = useAuthStatus();
  const params = useLocalSearchParams<{ slug?: string }>();

  const slug = (ALLOWED_SLUGS as readonly string[]).includes(params.slug ?? '')
    ? (params.slug as PolicySlug)
    : null;
  const copy = slug ? COPY[slug] : null;

  const { data: policy, isLoading } = useSafetyPolicy(slug ?? 'terms');
  const sections = useMemo(() => parsePolicyMarkdown(policy?.body_md ?? ''), [policy?.body_md]);

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(authStatus === 'authenticated' ? '/feed' : '/lobby');
  };

  if (!slug) {
    return (
      <Screen edges={['top', 'left', 'right']} scroll padded>
        <SafetyHeader title="Politika" onBack={goBack} />
        <Card style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={26} color={theme.colors.textTertiary} />
          <AppText variant="title">Belge bulunamadı</AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Aradığınız politika sayfası mevcut değil. Lobi ekranından güncel bağlantıları
            kullanabilirsiniz.
          </AppText>
          <Button label="Lobiye dön" variant="secondary" onPress={() => router.replace('/lobby')} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title={copy?.title ?? 'Politika'}
        subtitle={
          policy
            ? `Sürüm ${policy.version} · ${formatDateTr(policy.effective_at ?? policy.published_at)}`
            : 'Yükleniyor…'
        }
        onBack={goBack}
      />

      <View
        style={[
          styles.hero,
          { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.lg },
        ]}
      >
        <View style={[styles.heroIcon, { backgroundColor: theme.colors.surface }]}>
          <Ionicons name={copy?.icon ?? 'document-text-outline'} size={24} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="h3" color="primaryDeep">
          {policy?.title ?? copy?.title ?? 'Politika'}
        </AppText>
        <AppText variant="body" color="textSecondary">
          Bu metin Trabzone&apos;un yürürlükteki sürümüdür. Önemli değişikliklerde uygulama içinde
          bildirim yapılır.
        </AppText>
      </View>

      {isLoading && !policy ? (
        <View style={styles.skeletonBlock}>
          <Skeleton height={15} width="92%" radius={5} />
          <Skeleton height={15} width="88%" radius={5} />
          <Skeleton height={15} width="76%" radius={5} />
          <Skeleton height={15} width="90%" radius={5} />
          <Skeleton height={15} width="64%" radius={5} />
        </View>
      ) : null}

      {!isLoading && !policy ? (
        <Card tone="muted" elevated={false} style={styles.summary}>
          <AppText variant="bodyStrong">Belge yayımlanmadı</AppText>
          <AppText variant="body" color="textSecondary">
            Bu politika şu anda yayında değil. Yardım ve Destek ekranından bize ulaşabilirsiniz.
          </AppText>
          <Button
            label="Yardım ve Destek"
            variant="secondary"
            onPress={() => router.push(authStatus === 'authenticated' ? '/support' : '/lobby')}
          />
        </Card>
      ) : null}

      {policy?.summary ? (
        <Card tone="muted" elevated={false} style={styles.summary}>
          <AppText variant="bodyStrong">Özet</AppText>
          <AppText variant="body" color="textSecondary">
            {policy.summary}
          </AppText>
        </Card>
      ) : null}

      <PolicyBody sections={sections} />

      <AppText variant="caption" color="textTertiary" align="center" style={styles.footer}>
        Trabzone · Yürürlük: {policy ? formatDateTr(policy.effective_at ?? policy.published_at) : '—'}
        {'\n'}Sorularınız için: support@litxtech.com
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 18, gap: 8, marginBottom: 4 },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  summary: { gap: 6, marginTop: 12 },
  skeletonBlock: { gap: 10, paddingTop: 8 },
  center: { alignItems: 'center', paddingVertical: 30 },
  notFound: { gap: 10, marginTop: 24, alignItems: 'center' },
  footer: { marginTop: 22, lineHeight: 17 },
});
