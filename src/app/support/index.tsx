import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, IconButton, TextField } from '@/components/ui';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import {
  SAFETY_COMMITMENTS,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_MAP,
  SUPPORT_EMAIL,
  SUPPORT_RESPONSE_TARGET_HOURS,
} from '@/features/safety/constants';
import { useSafetyFaqs, useSafetyState } from '@/features/safety/hooks/use-safety';
import { contactSupportByEmail, copySupportEmail } from '@/features/safety/utils/contact';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

const ALL_FAQ = 'all';

export default function SupportCenterScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { openReport } = useReportSheet();
  const { data: safety } = useSafetyState();
  const { data: faqs, isLoading: faqsLoading } = useSafetyFaqs();

  const [query, setQuery] = useState('');
  const [faqCategory, setFaqCategory] = useState<string>(ALL_FAQ);
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);

  const unread = safety?.notifications_unread ?? 0;

  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');

  const visibleCategories = useMemo(() => {
    if (!normalizedQuery) {
      return SUPPORT_CATEGORIES;
    }
    return SUPPORT_CATEGORIES.filter((category) =>
      `${category.label} ${category.description}`
        .toLocaleLowerCase('tr-TR')
        .includes(normalizedQuery),
    );
  }, [normalizedQuery]);

  const faqCategories = useMemo(() => {
    const codes = new Set((faqs ?? []).map((faq) => String(faq.category)));
    return Array.from(codes);
  }, [faqs]);

  const visibleFaqs = useMemo(() => {
    return (faqs ?? []).filter((faq) => {
      const matchesCategory = faqCategory === ALL_FAQ || String(faq.category) === faqCategory;
      if (!matchesCategory) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = `${faq.question} ${faq.answer}`.toLocaleLowerCase('tr-TR');
      return haystack.includes(normalizedQuery);
    });
  }, [faqs, faqCategory, normalizedQuery]);

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Destek Merkezi"
        subtitle="Sorular, sorunlar ve başvurular için tek nokta"
        onBack={() => router.replace('/feed')}
        right={
          <View>
            <IconButton
              name="clipboard-outline"
              accessibilityLabel="Başvurularım"
              variant="surface"
              size={19}
              onPress={() => router.push('/support/my-requests')}
            />
            {unread > 0 ? (
              <View style={[styles.bellBadge, { backgroundColor: theme.colors.danger }]}>
                <AppText variant="caption" color="#FFFFFF">
                  {unread > 9 ? '9+' : unread}
                </AppText>
              </View>
            ) : null}
          </View>
        }
      />

      <LinearGradient
        colors={theme.gradients.primary}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { borderRadius: theme.radius.xl }]}
      >
        <View style={styles.heroIcon}>
          <Ionicons name="headset" size={26} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="h2" color={theme.colors.onPrimary}>
          Size nasıl yardımcı olabiliriz?
        </AppText>
        <AppText variant="body" color="rgba(255,255,255,0.86)">
          Talebini oluştur, ekibimiz {SUPPORT_RESPONSE_TARGET_HOURS} saat içinde yanıtlasın. Çocuk
          güvenliği bildirimleri ayrı ve öncelikli kuyrukta incelenir.
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${SUPPORT_EMAIL} adresine e-posta gönder`}
          onPress={() => void contactSupportByEmail()}
          style={({ pressed }) => [
            styles.heroPill,
            { backgroundColor: 'rgba(255,255,255,0.16)', opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Ionicons name="mail-outline" size={16} color={theme.colors.onPrimary} />
          <AppText variant="caption" color={theme.colors.onPrimary}>
            {SUPPORT_EMAIL}
          </AppText>
          <Ionicons name="arrow-forward" size={14} color={theme.colors.onPrimary} />
        </Pressable>
      </LinearGradient>

      <View style={styles.quickRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yeni destek talebi oluştur"
          onPress={() => router.push('/support/create')}
          style={({ pressed }) => [
            styles.quickCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
              opacity: pressed ? 0.8 : 1,
            },
            theme.shadows.card,
          ]}
        >
          <View style={[styles.quickIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="add-circle-outline" size={22} color={theme.colors.primaryDeep} />
          </View>
          <AppText variant="bodyStrong">Yeni talep</AppText>
          <AppText variant="caption" color="textSecondary">
            Sorununu ayrıntılı anlat
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Başvurularım"
          onPress={() => router.push('/support/my-requests')}
          style={({ pressed }) => [
            styles.quickCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
              opacity: pressed ? 0.8 : 1,
            },
            theme.shadows.card,
          ]}
        >
          <View style={[styles.quickIcon, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="clipboard-outline" size={22} color={theme.colors.success} />
          </View>
          <AppText variant="bodyStrong">Başvurularım</AppText>
          <AppText variant="caption" color="textSecondary">
            {unread > 0 ? `${unread} okunmamış güncelleme` : 'Taleplerini takip et'}
          </AppText>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Çocuk güvenliği bildirimi"
        onPress={() => {
          haptics.press();
          openReport({
            targetType: 'other',
            targetId: 'support-center',
            targetLabel: 'Çocuk güvenliği bildirimi',
          });
        }}
        style={({ pressed }) => [
          styles.childBanner,
          {
            backgroundColor: theme.colors.dangerSoft,
            borderColor: theme.colors.danger,
            borderRadius: theme.radius.lg,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={[styles.childIcon, { backgroundColor: theme.colors.surface }]}>
          <Ionicons name="shield-half-outline" size={22} color={theme.colors.danger} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong" color="danger">
            Çocuk güvenliği bildirimi
          </AppText>
          <AppText variant="caption" color="textSecondary">
            Öncelikli kuyruk · 30 dakika inceleme hedefi · Kimliğin gizli
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={17} color={theme.colors.danger} />
      </Pressable>

      <TextField
        placeholder="Konu veya soru ara"
        value={query}
        onChangeText={setQuery}
        leftIcon="search-outline"
        autoCorrect={false}
        containerStyle={styles.search}
      />

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <AppText variant="h3">Konular</AppText>
          <AppText variant="caption" color="textTertiary">
            {visibleCategories.length} kategori
          </AppText>
        </View>
        <View style={styles.grid}>
          {visibleCategories.map((category) => (
            <Pressable
              key={category.code}
              accessibilityRole="button"
              accessibilityLabel={category.label}
              onPress={() => router.push(`/support/create?category=${category.code}`)}
              style={({ pressed }) => [
                styles.categoryCard,
                {
                  backgroundColor:
                    category.code === 'child_safety'
                      ? theme.colors.dangerSoft
                      : theme.colors.surface,
                  borderColor:
                    category.code === 'child_safety'
                      ? theme.colors.danger
                      : theme.colors.border,
                  borderRadius: theme.radius.md,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.categoryIcon,
                  {
                    backgroundColor:
                      category.code === 'child_safety'
                        ? theme.colors.surface
                        : theme.colors.surfaceMuted,
                  },
                ]}
              >
                <Ionicons
                  name={category.icon}
                  size={18}
                  color={
                    category.code === 'child_safety'
                      ? theme.colors.danger
                      : theme.colors.primaryDeep
                  }
                />
              </View>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {category.label}
              </AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                {category.description}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <AppText variant="h3">Sık sorulan sorular</AppText>
          {faqsLoading ? <AppText variant="caption" color="textTertiary">Yükleniyor…</AppText> : null}
        </View>

        <View style={styles.chips}>
          <FaqChip
            label="Tümü"
            active={faqCategory === ALL_FAQ}
            onPress={() => setFaqCategory(ALL_FAQ)}
          />
          {faqCategories.map((code) => (
            <FaqChip
              key={code}
              label={SUPPORT_CATEGORY_MAP[code as keyof typeof SUPPORT_CATEGORY_MAP]?.label ?? 'Diğer'}
              active={faqCategory === code}
              onPress={() => setFaqCategory(code)}
            />
          ))}
        </View>

        {visibleFaqs.length === 0 ? (
          <AppText variant="body" color="textSecondary">
            Aradığın soruya ulaşamadık. Yeni bir destek talebi oluşturabilirsin.
          </AppText>
        ) : (
          <View style={styles.faqList}>
            {visibleFaqs.map((faq) => {
              const open = openFaqId === faq.id;
              return (
                <Pressable
                  key={faq.id}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => {
                    haptics.selection();
                    setOpenFaqId(open ? null : faq.id);
                  }}
                  style={({ pressed }) => [
                    styles.faqItem,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: open ? theme.colors.primary : theme.colors.border,
                      borderRadius: theme.radius.md,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View style={styles.faqHead}>
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {faq.question}
                    </AppText>
                    <Ionicons
                      name={open ? 'chevron-up' : 'chevron-down'}
                      size={17}
                      color={theme.colors.textTertiary}
                    />
                  </View>
                  {open ? (
                    <AppText variant="body" color="textSecondary" style={styles.faqAnswer}>
                      {faq.answer}
                    </AppText>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View
        style={[
          styles.contactCard,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
          },
        ]}
      >
        <AppText variant="title">Bize doğrudan ulaş</AppText>
        <AppText variant="caption" color="textSecondary">
          Uygulama üzerinden talep oluşturman inceleme süresini kısaltır. E-posta ile de
          yazabilirsin.
        </AppText>
        <View style={styles.contactActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="E-posta gönder"
            onPress={() => void contactSupportByEmail()}
            style={({ pressed }) => [
              styles.contactAction,
              {
                backgroundColor: theme.colors.primarySoft,
                borderRadius: theme.radius.sm,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="mail-outline" size={16} color={theme.colors.primaryDeep} />
            <AppText variant="caption" color="primaryDeep">
              E-posta gönder
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="E-posta adresini kopyala"
            onPress={() => void copySupportEmail()}
            style={({ pressed }) => [
              styles.contactAction,
              {
                backgroundColor: theme.colors.surfaceMuted,
                borderRadius: theme.radius.sm,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="copy-outline" size={16} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              Adresi kopyala
            </AppText>
          </Pressable>
        </View>
        <AppText variant="caption" color="textTertiary">
          {SUPPORT_EMAIL}
        </AppText>
      </View>

      <View style={styles.commitments}>
        {SAFETY_COMMITMENTS.slice(0, 3).map((commitment) => (
          <View key={commitment} style={styles.commitmentRow}>
            <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {commitment}
            </AppText>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Çocuk güvenliği politikasını aç"
        onPress={() => router.push('/policy/child-safety')}
        style={styles.policyLink}
      >
        <Ionicons name="document-text-outline" size={16} color={theme.colors.primaryDeep} />
        <AppText variant="caption" color="primaryDeep">
          Çocuk Güvenliği Politikası
        </AppText>
        <Ionicons name="chevron-forward" size={14} color={theme.colors.primaryDeep} />
      </Pressable>
    </Screen>
  );
}

function FaqChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
          borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <AppText variant="caption" color={active ? theme.colors.onPrimary : 'textSecondary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bellBadge: {
    position: 'absolute',
    right: 0,
    top: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { padding: 20, gap: 10, marginBottom: 14 },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    marginTop: 2,
  },
  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  quickCard: { flex: 1, padding: 14, gap: 3, borderWidth: StyleSheet.hairlineWidth },
  quickIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  childBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  childIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  search: { marginBottom: 6 },
  section: { marginTop: 18, gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryCard: { width: '48%', padding: 13, gap: 3, borderWidth: StyleSheet.hairlineWidth, flexGrow: 1 },
  categoryIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  faqList: { gap: 8 },
  faqItem: { padding: 13, gap: 8, borderWidth: 1 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  faqAnswer: { paddingTop: 2 },
  contactCard: { marginTop: 20, padding: 16, gap: 8, borderWidth: StyleSheet.hairlineWidth },
  contactActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  contactAction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 8 },
  commitments: { marginTop: 20, gap: 8 },
  commitmentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  policyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
  },
});
