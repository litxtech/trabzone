import type { PropsWithChildren } from 'react';
import { Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Web sayfalarının dikey kaydırma kabı.
 *
 * Native tarafta klasik `ScrollView` kullanılır. Web'de ise içerik pencere
 * (document) kaydırmasına bırakılır: Expo'nun web şablonu `body` kaydırmasını
 * kapattığı için sayfa içeriği ekran yüksekliğini aştığında tekerlek, klavye ve
 * tarayıcı kaydırma çubuğu çalışmıyordu. İçerik akışına bırakıldığında sayfa
 * normal bir web sitesi gibi kayar; `WebHeader` yapışkan kalır.
 */
export function WebPageScroll({
  children,
  contentContainerStyle,
}: PropsWithChildren<{ contentContainerStyle?: StyleProp<ViewStyle> }>) {
  if (Platform.OS === 'web') {
    return <View style={[styles.webContent, contentContainerStyle]}>{children}</View>;
  }

  return (
    <ScrollView
      style={styles.nativeScroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  nativeScroll: { flex: 1 },
  // flexGrow, kısa sayfalarda footer'ın ekranın altına yapışmasını korur.
  webContent: { flexGrow: 1, flexShrink: 0 },
});
