import { Ionicons } from '@expo/vector-icons';
import { useRouter } from '@/utils/router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Skeleton } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { PolicyBody } from '@/features/safety/components/PolicyBody';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import {
  CHILD_REASONS,
  SAFETY_COMMITMENTS,
  SUPPORT_EMAIL,
} from '@/features/safety/constants';
import { useSafetyFaqs, useSafetyPolicy } from '@/features/safety/hooks/use-safety';
import { parsePolicyMarkdown } from '@/features/safety/utils/policy-markdown';
import { contactSupportByEmail } from '@/features/safety/utils/contact';
import { useAuthStatus } from '@/stores/auth-store';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

/**
 * Cocuk Guvenligi Politikasi.
 *
 * Bu sayfa magaza inceleme sureci ve yasal seffaflik icin oturum acmadan da
 * acilabilir; bu nedenle AuthGate kullanilmaz.
 */
export default function ChildSafetyPolicyScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const authStatus = useAuthStatus();
  const { data: policy, isLoading } = useSafetyPolicy('child-safety');
  const { data: faqs } = useSafetyFaqs();
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  const childFaqs = useMemo(
    () => (faqs ?? []).filter((faq) => faq.category === 'child_safety'),
    [faqs],
  );

  const sections = useMemo(() => parsePolicyMarkdown(policy?.body_md ?? ''), [policy?.body_md]);

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Çocuk Güvenliği Politikası"
        subtitle={
          policy ? `Sürüm ${policy.version} · ${formatDateTr(policy.effective_at ?? policy.published_at)}` : 'Yükleniyor…'
        }
        onBack={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace(authStatus === 'authenticated' ? '/feed' : '/lobby');
          }
        }}
      />

      <View
        style={[
          styles.hero,
          { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.lg },
        ]}
      >
        <View style={[styles.heroIcon, { backgroundColor: theme.colors.surface }]}>
          <Ionicons name="shield-checkmark" size={26} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="h3" color="primaryDeep">
          Çocukların güvenliği pazarlık konusu değildir
        </AppText>
        <AppText variant="body" color="textSecondary">
          Trabzone, 18 yaş altındaki kullanıcılar için daha kapalı varsayılanlar uygular ve çocuk
          güvenliği bildirimlerini ayrı, öncelikli bir kuyrukta inceler.
        </AppText>
      </View>

      {isLoading && !policy ? (
        <View style={styles.skeletonBlock}>
          <Skeleton height={15} width="92%" radius={5} />
          <Skeleton height={15} width="86%" radius={5} />
          <Skeleton height={15} width="72%" radius={5} />
        </View>
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

      <View style={styles.section}>
        <AppText variant="h3">Neleri bildirebilirsin?</AppText>
        <View style={styles.reasonList}>
          {CHILD_REASONS.map((reason) => (
            <View
              key={reason.code}
              style={[
                styles.reasonRow,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.sm,
                },
              ]}
            >
              <Ionicons
                name={reason.icon}
                size={17}
                color={reason.critical ? theme.colors.danger : theme.colors.primaryDeep}
              />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{reason.label}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {reason.description}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="h3">İnceleme sürecimiz</AppText>
        <View style={styles.timeline}>
          {[
            {
              title: 'Bildirim alınır',
              body: 'Çocuk güvenliği bildirimleri ayrı kuyruğa yazılır ve kritik olanlar en üste alınır.',
            },
            {
              title: 'Öncelikli inceleme',
              body: 'Kritik bildirimler için hedef 30 dakika, diğer çocuk güvenliği bildirimleri için 4 saattir.',
            },
            {
              title: 'İçerik ve hesap işlemi',
              body: 'Kural ihlali doğrulanırsa içerik kaldırılır, hesap kısıtlanır; gerektiğinde yetkili kurumlara bildirilir.',
            },
            {
              title: 'Gizli sonuç bildirimi',
              body: 'Sonuç yalnızca bildirimi yapan kişiye iletilir; bildirenin kimliği karşı tarafa açıklanmaz.',
            },
          ].map((step, index) => (
            <View key={step.title} style={styles.timelineRow}>
              <View style={styles.timelineLeft}>
                <View style={[styles.timelineDot, { backgroundColor: theme.colors.primaryDeep }]}>
                  <AppText variant="caption" color="onPrimary">
                    {index + 1}
                  </AppText>
                </View>
                {index < 3 ? (
                  <View style={[styles.timelineLine, { backgroundColor: theme.colors.border }]} />
                ) : null}
              </View>
              <View style={styles.timelineText}>
                <AppText variant="bodyStrong">{step.title}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {step.body}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="h3">Taahhütlerimiz</AppText>
        <View style={styles.commitments}>
          {SAFETY_COMMITMENTS.map((commitment) => (
            <View key={commitment} style={styles.commitmentRow}>
              <Ionicons name="checkmark-circle" size={15} color={theme.colors.success} />
              <AppText variant="body" color="textSecondary" style={styles.flex}>
                {commitment}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      {childFaqs.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="h3">Sık sorulan sorular</AppText>
          {childFaqs.map((faq) => {
            const open = openFaq === faq.id;
            return (
              <Pressable
                key={faq.id}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => {
                  haptics.selection();
                  setOpenFaq(open ? null : faq.id);
                }}
                style={[
                  styles.faq,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: open ? theme.colors.primary : theme.colors.border,
                    borderRadius: theme.radius.sm,
                  },
                ]}
              >
                <View style={styles.faqHead}>
                  <AppText variant="bodyStrong" style={styles.flex}>
                    {faq.question}
                  </AppText>
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={theme.colors.textTertiary}
                  />
                </View>
                {open ? (
                  <AppText variant="caption" color="textSecondary">
                    {faq.answer}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Card style={styles.contact}>
        <AppText variant="title">Bir durumu bildirmek istiyorum</AppText>
        <AppText variant="caption" color="textSecondary">
          Uygulama içinden bildirim yapmak inceleme süresini kısaltır. Acil tehlike varsa lütfen
          önce yerel acil servisi (112) ara.
        </AppText>
        {authStatus === 'authenticated' ? (
          <Button
            label="Çocuk güvenliği bildirimi yap"
            onPress={() => router.push('/support/create?category=child_safety')}
            leftIcon={<Ionicons name="shield-half-outline" size={17} color="#FFFFFF" />}
          />
        ) : (
          <Button label="Giriş yap ve bildir" onPress={() => router.replace('/lobby')} />
        )}
        <Button
          label={`E-posta: ${SUPPORT_EMAIL}`}
          variant="secondary"
          onPress={() => void contactSupportByEmail('Çocuk güvenliği bildirimi')}
          leftIcon={<Ionicons name="mail-outline" size={17} color={theme.colors.primaryDeep} />}
        />
      </Card>

      <AppText variant="caption" color="textTertiary" align="center" style={styles.footer}>
        Trabzone · Çocuk güvenliği ekibi{'\n'}
        Bu politika düzenli olarak gözden geçirilir ve sürümlenir.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', paddingVertical: 30 },
  skeletonBlock: { gap: 10, paddingTop: 8 },
  hero: { padding: 18, gap: 8, marginBottom: 4 },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  summary: { gap: 6, marginTop: 12 },
  section: { gap: 10, marginTop: 10 },
  reasonList: { gap: 7 },
  reasonRow: { flexDirection: 'row', gap: 10, padding: 11, borderWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineLeft: { alignItems: 'center', width: 24 },
  timelineDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  timelineLine: { flex: 1, width: 2, marginVertical: 3 },
  timelineText: { flex: 1, gap: 2, paddingBottom: 16 },
  commitments: { gap: 8 },
  commitmentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  faq: { padding: 12, gap: 7, borderWidth: 1 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contact: { gap: 10, marginTop: 22 },
  footer: { marginTop: 20, lineHeight: 17 },
});
