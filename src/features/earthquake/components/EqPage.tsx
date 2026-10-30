import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { PublicShell } from '@/features/web/components/PublicShell';

/**
 * Deprem Merkezi sayfa kabuğu. Herkese açık kabuk kullanılır: deprem
 * sayfaları oturum açmadan ve web paylaşım bağlantılarından da açılabilir.
 */
export function EqPage({
  title,
  subtitle,
  right,
  fallbackHref = '/deprem',
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  fallbackHref?: string;
  children: ReactNode;
}) {
  const web = Platform.OS === 'web';
  return (
    <PublicShell
      title={title}
      subtitle={subtitle}
      right={right}
      fallbackHref={fallbackHref}
      webScroll
      webContentStyle={styles.webContent}
    >
      <View style={[styles.body, web ? styles.webBody : null]}>
        {web ? (
          <View style={styles.webHead}>
            <View style={styles.flex}>
              <AppText variant="h1" accessibilityRole="header">
                {title}
              </AppText>
              {subtitle ? (
                <AppText variant="body" color="textSecondary">
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            {right ? <View style={styles.webActions}>{right}</View> : null}
          </View>
        ) : null}
        {children}
      </View>
    </PublicShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  webContent: { alignItems: 'center' },
  webBody: { width: '100%', maxWidth: 980, alignSelf: 'center', paddingTop: 24, paddingBottom: 40 },
  webHead: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' },
  webActions: { flexDirection: 'row', gap: 8 },
});
