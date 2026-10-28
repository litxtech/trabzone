import { Ionicons } from '@expo/vector-icons';
import { Link, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Skeleton } from '@/components/ui';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';
import { usePendingAcceptances, useRecordAcceptance } from '@/features/legal/hooks/use-legal';
import type { LegalDocument } from '@/features/legal/types';
import { parsePolicyMarkdown } from '@/features/safety/utils/policy-markdown';
import { PolicyBody } from '@/features/safety/components/PolicyBody';

import { PUBLIC_LEGAL_PAGES, findPublicLegalPage } from '../../legal/catalog';
import { useWebMeta } from '../use-web-meta';
import { WebFooter } from './WebFooter';
import { WebHeader } from './WebHeader';

type Props = { slug: string; document?: LegalDocument | null; isLoading?: boolean };

const CATEGORY_ORDER = ['Sözleşmeler', 'Veri ve Gizlilik', 'Güvenlik', 'Platform Kuralları'] as const;

/**
 * Herkese açık hukuki belge görüntüleyicisi. Metinler Supabase'de sürümlenmiş
 * olarak tutulur; bu sayfa yalnızca yayınlanmış sürümü gösterir ve oturum
 * açmadan erişilebilir (mağaza incelemesi gereksinimi).
 */
export function LegalPage({ slug, document: doc, isLoading }: Props) {
  const { theme } = useTheme();
  const authStatus = useAuthStatus();
  const isAuthed = authStatus === 'authenticated';
  const catalogItem = findPublicLegalPage(slug);
  const [copied, setCopied] = useState(false);

  const { data: pending } = usePendingAcceptances(isAuthed);
  const record = useRecordAcceptance();
  const sections = useMemo(() => parsePolicyMarkdown(doc?.body_md ?? ''), [doc?.body_md]);
  const needsAcceptance = Boolean(
    doc?.requires_acceptance && isAuthed && pending?.some((item) => item.slug === slug),
  );

  useWebMeta({
    title: doc
      ? doc.title.includes('Trabzone')
        ? doc.title
        : `${doc.title} · Trabzone`
      : `${catalogItem?.title ?? 'Politika'} · Trabzone`,
    description:
      doc?.summary ??
      catalogItem?.description ??
      'Trabzone hukuki politikaları, veri koruma ve topluluk kuralları.',
    path: catalogItem?.path ?? `/policy/${slug}`,
    type: 'article',
  });

  const copyLink = () => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: PUBLIC_LEGAL_PAGES.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <WebHeader />

      <View style={styles.hero}>
        <View style={styles.heroInner}>
          <View style={styles.breadcrumb}>
            <Link href={'/' as Href} asChild>
              <Pressable>
                <AppText variant="caption" color="#8EA6D8">
                  Ana Sayfa
                </AppText>
              </Pressable>
            </Link>
            <AppText variant="caption" color="#5E739D">
              /
            </AppText>
            <AppText variant="caption" color="#C7D4EE">
              Hukuki Belgeler
            </AppText>
          </View>

          <AppText variant="caption" color="#8EA6D8" style={styles.eyebrow}>
            TRABZONE HUKUKİ MERKEZ
          </AppText>
          <AppText variant="h1" color="#FFFFFF" style={styles.heroTitle}>
            {doc?.title ?? catalogItem?.title ?? 'Hukuki Belge'}
          </AppText>
          {doc?.summary ?? catalogItem?.description ? (
            <AppText variant="body" color="#A9BDE2" style={styles.heroSummary}>
              {doc?.summary ?? catalogItem?.description}
            </AppText>
          ) : null}

          <View style={styles.metaRow}>
            {doc ? (
              <MetaPill icon="layers-outline" label={`Sürüm ${doc.version}`} />
            ) : null}
            {doc?.effective_at ?? doc?.published_at ? (
              <MetaPill
                icon="calendar-outline"
                label={`Yürürlük: ${formatDateTr(doc.effective_at ?? doc.published_at ?? '')}`}
              />
            ) : null}
            <MetaPill icon="lock-closed-outline" label="Herkese açık belge" />
          </View>

          <View style={styles.heroActions}>
            <Button
              label={copied ? 'Bağlantı kopyalandı' : 'Bağlantıyı kopyala'}
              variant="secondary"
              size="sm"
              leftIcon={
                <Ionicons
                  name={copied ? 'checkmark-outline' : 'link-outline'}
                  size={15}
                  color={theme.colors.primaryDeep}
                />
              }
              onPress={copyLink}
            />
            {Platform.OS === 'web' ? (
              <Button
                label="Yazdır"
                variant="secondary"
                size="sm"
                leftIcon={<Ionicons name="print-outline" size={15} color={theme.colors.primaryDeep} />}
                onPress={() => window.print()}
              />
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.layout}>
        <View style={styles.content}>
          {isLoading && !doc ? <DocumentSkeleton /> : null}

          {!isLoading && !doc ? (
            <Card style={styles.notFound}>
              <Ionicons name="document-outline" size={28} color={theme.colors.textTertiary} />
              <AppText variant="title">Belge yayımlanmadı</AppText>
              <AppText variant="body" color="textSecondary" align="center">
                Bu belge şu anda yayında değil. Güncel metinler için hukuki belgeler dizinini
                kullanabilir veya destek ekibimize ulaşabilirsiniz.
              </AppText>
              <View style={styles.notFoundActions}>
                <Link href={'/support' as Href} asChild>
                  <Button label="Destek Merkezi" variant="primary" size="sm" />
                </Link>
                <Link href={'/contact' as Href} asChild>
                  <Button label="İletişim" variant="secondary" size="sm" />
                </Link>
              </View>
            </Card>
          ) : null}

          {needsAcceptance ? (
            <Card style={[styles.gate, { borderColor: theme.colors.primary }]}>
              <View style={styles.gateRow}>
                <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.primary} />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">Güncellenmiş sözleşme onayı bekliyor</AppText>
                  <AppText variant="caption" color="textSecondary">
                    Bu belgenin {doc?.version}. sürümünü kabul etmeniz gerekiyor. Onay kaydı
                    değiştirilemez biçimde saklanır.
                  </AppText>
                </View>
              </View>
              <Button
                label={record.isPending ? 'Kaydediliyor…' : 'Okudum ve kabul ediyorum'}
                size="sm"
                loading={record.isPending}
                onPress={() =>
                  doc &&
                  record.mutate({
                    slug,
                    source: 'web_settings',
                    version: doc.version,
                    userAgent:
                      Platform.OS === 'web' && typeof navigator !== 'undefined'
                        ? navigator.userAgent
                        : null,
                  })
                }
              />
              {record.isError ? (
                <AppText variant="caption" color="danger">
                  Onay kaydedilemedi. Lütfen tekrar deneyin.
                </AppText>
              ) : null}
            </Card>
          ) : null}

          {doc ? (
            <View
              style={[
                styles.paper,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <PolicyBody sections={sections} />
              <View style={[styles.paperFooter, { borderTopColor: theme.colors.border }]}>
                <AppText variant="caption" color="textTertiary">
                  Bu metin Trabzone&apos;un yürürlükteki sürümüdür. Belge sürümü ve yürürlük tarihi
                  değiştiğinde kullanıcılar bilgilendirilir; zorunlu hâllerde yeniden kabul
                  istenir.
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  Sorularınız için{' '}
                  <Link href={'/contact' as Href}>
                    <AppText variant="caption" color="primary">
                      iletişim sayfamızı
                    </AppText>
                  </Link>{' '}
                  kullanabilirsiniz.
                </AppText>
              </View>
            </View>
          ) : null}

          <Card tone="muted" elevated={false} style={styles.helpCard}>
            <View style={styles.gateRow}>
              <Ionicons name="help-buoy-outline" size={22} color={theme.colors.primaryDeep} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Belgeyle ilgili sorunuz mu var?</AppText>
                <AppText variant="caption" color="textSecondary">
                  Gizlilik ve KVKK başvurularınızı veri talepleri merkezinden, diğer sorularınızı
                  destek merkezinden iletebilirsiniz.
                </AppText>
              </View>
            </View>
            <View style={styles.notFoundActions}>
              <Link href={'/data-requests' as Href} asChild>
                <Button label="Veri Talepleri" variant="secondary" size="sm" />
              </Link>
              <Link href={'/support' as Href} asChild>
                <Button label="Destek Merkezi" variant="primary" size="sm" />
              </Link>
            </View>
          </Card>
        </View>

        <View style={styles.aside}>
          <View style={styles.asideBlock}>
            <AppText variant="overline" color="textTertiary">
              HUKUKİ BELGELER
            </AppText>
            {grouped.map((group) => (
              <View key={group.category} style={styles.asideGroup}>
                <AppText variant="caption" color="textTertiary" style={styles.asideGroupTitle}>
                  {group.category}
                </AppText>
                {group.items.map((item) => {
                  const active = item.slug === slug;
                  return (
                    <Link key={item.slug} href={item.path as Href} asChild>
                      <Pressable
                        style={({ pressed }) => [
                          styles.asideLink,
                          active ? { backgroundColor: theme.colors.primarySoft } : null,
                          { opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <AppText
                          variant={active ? 'bodyStrong' : 'body'}
                          color={active ? 'primaryDeep' : 'textSecondary'}
                        >
                          {item.shortTitle}
                        </AppText>
                        {active ? (
                          <Ionicons name="chevron-forward" size={14} color={theme.colors.primary} />
                        ) : null}
                      </Pressable>
                    </Link>
                  );
                })}
              </View>
            ))}
          </View>

          {sections.filter((section) => section.title).length > 0 ? (
            <View style={styles.asideBlock}>
              <AppText variant="overline" color="textTertiary">
                İÇİNDEKİLER
              </AppText>
              {sections
                .filter((section) => section.title)
                .map((section, index) => (
                  <AppText
                    key={`${section.title}-${index}`}
                    variant="caption"
                    color="textSecondary"
                    style={styles.tocItem}
                  >
                    {section.title}
                  </AppText>
                ))}
            </View>
          ) : null}
        </View>
      </View>

      <WebFooter />
    </View>
  );
}

function MetaPill({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.metaPill}>
      <Ionicons name={icon} size={13} color="#A8BEE8" />
      <AppText variant="caption" color="#C9D7F0">
        {label}
      </AppText>
    </View>
  );
}

function DocumentSkeleton() {
  return (
    <View style={styles.skeleton}>
      <Skeleton height={24} width="55%" radius={6} />
      <Skeleton height={14} width="96%" radius={4} />
      <Skeleton height={14} width="90%" radius={4} />
      <Skeleton height={14} width="94%" radius={4} />
      <Skeleton height={14} width="70%" radius={4} />
      <Skeleton height={14} width="88%" radius={4} />
      <Skeleton height={14} width="82%" radius={4} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  hero: {
    backgroundColor: '#07152E',
    paddingTop: 56,
    paddingBottom: 46,
    paddingHorizontal: 20,
  },
  heroInner: { width: '100%', maxWidth: 1160, alignSelf: 'center' },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  eyebrow: { letterSpacing: 1.6, marginBottom: 10 },
  heroTitle: { maxWidth: 760 },
  heroSummary: { marginTop: 12, maxWidth: 700, lineHeight: 24 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  layout: {
    width: '100%',
    maxWidth: 1160,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 50,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 28,
  },
  content: { flex: 1, minWidth: 280, maxWidth: 820 },
  paper: { borderRadius: 18, borderWidth: 1, padding: 24, marginTop: 18 },
  paperFooter: { borderTopWidth: 1, marginTop: 22, paddingTop: 16, gap: 8 },
  aside: { width: 280, gap: 22 },
  asideBlock: { gap: 4 },
  asideGroup: { gap: 2, marginTop: 12 },
  asideGroupTitle: { marginBottom: 4, letterSpacing: 0.4 },
  asideLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  tocItem: { paddingVertical: 5, lineHeight: 18 },
  skeleton: { gap: 12, paddingVertical: 10 },
  notFound: { gap: 10, alignItems: 'center', padding: 28 },
  notFoundActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  gate: { gap: 12, marginTop: 18, borderWidth: 1 },
  gateRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  helpCard: { gap: 10, marginTop: 22 },
});
