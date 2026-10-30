import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { PremiumGlassAdBanner } from '../../components/PremiumGlassAdBanner';

const DEVICES = [
  { key: 'se', label: 'Küçük iPhone', width: 375 },
  { key: 'promax', label: 'iPhone Pro Max', width: 430 },
  { key: 'android', label: 'Android', width: 412 },
] as const;

/** Banner'ın kart içindeki genişliği akıştaki gerçek yatay boşluklarla aynıdır. */
const FEED_GUTTER = 40;

export type AdPreviewCreative = {
  title: string;
  description: string;
  ctaLabel: string;
  businessName: string;
  imageUrl: string | null;
  imageFocus: 'left' | 'center' | 'right';
};

export function AdDevicePreview({ creative }: { creative: AdPreviewCreative }) {
  const { theme } = useTheme();
  const [device, setDevice] = useState<(typeof DEVICES)[number]['key']>('se');
  const [safeArea, setSafeArea] = useState(false);
  const active = DEVICES.find((item) => item.key === device) ?? DEVICES[0];
  const bannerWidth = active.width - FEED_GUTTER;

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        {DEVICES.map((item) => {
          const selected = item.key === device;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setDevice(item.key)}
              style={[
                styles.chip,
                {
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primarySoft : 'transparent',
                },
              ]}
            >
              <AppText variant="caption" color={selected ? 'primaryDeep' : 'textSecondary'}>
                {item.label} · {item.width}pt
              </AppText>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: safeArea }}
          onPress={() => setSafeArea((value) => !value)}
          style={[
            styles.chip,
            {
              borderColor: safeArea ? theme.colors.warning : theme.colors.border,
              backgroundColor: safeArea ? theme.colors.warningSoft : 'transparent',
            },
          ]}
        >
          <AppText variant="caption" color={safeArea ? 'warning' : 'textSecondary'}>
            Metin güvenli alanı
          </AppText>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View
          style={[
            styles.phone,
            { width: active.width + 16, backgroundColor: theme.colors.text, borderRadius: device === 'android' ? 30 : 44 },
          ]}
        >
          <View
            style={[
              styles.screen,
              { backgroundColor: theme.colors.background, borderRadius: device === 'android' ? 24 : 36 },
            ]}
          >
            <View style={styles.statusBar}>
              <AppText variant="caption" color="textSecondary">
                9:41
              </AppText>
              <Ionicons name="cellular" size={12} color={theme.colors.textSecondary} />
            </View>
            <FakePost />
            <View style={styles.bannerRow}>
              <PremiumGlassAdBanner
                width={bannerWidth}
                title={creative.title || 'Reklam başlığı'}
                description={creative.description || null}
                ctaLabel={creative.ctaLabel}
                businessName={creative.businessName || null}
                imageUrl={creative.imageUrl}
                imageFocus={creative.imageFocus}
                showSafeArea={safeArea}
                onMenu={() => undefined}
              />
            </View>
            <FakePost />
          </View>
        </View>
      </ScrollView>
      <AppText variant="caption" color="textTertiary">
        Önizleme gerçek banner bileşenini kullanır. Banner genişliği {bannerWidth}pt; yükseklik orana göre
        sabittir, bu yüzden yüklenirken akış kaymaz.
      </AppText>
    </View>
  );
}

function FakePost() {
  const { theme } = useTheme();
  return (
    <View style={styles.post}>
      <View style={styles.postHead}>
        <View style={[styles.avatar, { backgroundColor: theme.colors.surfaceMuted }]} />
        <View style={styles.lines}>
          <View style={[styles.line, { width: '40%', backgroundColor: theme.colors.surfaceMuted }]} />
          <View style={[styles.line, { width: '24%', backgroundColor: theme.colors.surfaceMuted }]} />
        </View>
      </View>
      <View style={[styles.line, { width: '92%', backgroundColor: theme.colors.surfaceMuted }]} />
      <View style={[styles.line, { width: '70%', backgroundColor: theme.colors.surfaceMuted }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  scroll: { paddingVertical: 4 },
  phone: { padding: 8 },
  screen: { overflow: 'hidden', paddingBottom: 18 },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    paddingTop: 12,
    paddingBottom: 6,
  },
  bannerRow: { paddingHorizontal: 20, paddingVertical: 14 },
  post: { paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  lines: { flex: 1, gap: 6 },
  line: { height: 9, borderRadius: 5 },
});
