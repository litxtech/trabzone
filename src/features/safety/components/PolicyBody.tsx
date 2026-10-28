import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import type { PolicySection } from '../utils/policy-markdown';

/**
 * Politika belgesinin govdesini baslik + paragraf + madde duzeninde cizer.
 * Hem cocuk guvenligi hem de kullanim kosullari/gizlilik ekranlari kullanir.
 */
export function PolicyBody({ sections }: { sections: PolicySection[] }) {
  const { theme } = useTheme();

  if (sections.length === 0) {
    return null;
  }

  return (
    <View style={styles.sections}>
      {sections.map((section, index) => (
        <View key={`${section.title ?? 'section'}-${index}`} style={styles.section}>
          {section.title ? <AppText variant="h3">{section.title}</AppText> : null}
          {section.paragraphs.map((paragraph, paragraphIndex) => {
            if (paragraph.startsWith('- ')) {
              return (
                <View key={paragraphIndex} style={styles.bulletRow}>
                  <View style={[styles.bullet, { backgroundColor: theme.colors.primary }]} />
                  <AppText variant="body" color="textSecondary" style={styles.flex}>
                    {paragraph.slice(2)}
                  </AppText>
                </View>
              );
            }
            return (
              <AppText key={paragraphIndex} variant="body" color="textSecondary">
                {paragraph}
              </AppText>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sections: { gap: 18, marginTop: 18 },
  section: { gap: 10, marginTop: 10 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 8 },
});
