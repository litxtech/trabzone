import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, TextField } from '@/components/ui';
import { useKeyboardBottomInset } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  visible: boolean;
  defaultLabel: string;
  loading?: boolean;
  onSave: (label: string, notify: boolean) => void;
  onClose: () => void;
};

/** Çizilen alanı kullanıcı hesabına kaydeder; bildirim tercihi açıkça sorulur. */
export function SaveAreaSheet({ visible, defaultLabel, loading, onSave, onClose }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardBottomInset();
  const [label, setLabel] = useState(defaultLabel);
  const [notify, setNotify] = useState(false);

  useEffect(() => {
    if (visible) {
      // Modal açıldığında formu varsayılan adla sıfırlar.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLabel(defaultLabel);
      setNotify(false);
    }
  }, [defaultLabel, visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.root, keyboardInset]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kaydetmeyi kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              paddingBottom: insets.bottom + 16,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <AppText variant="h3">Aramayı kaydet</AppText>
          <AppText variant="caption" color="textSecondary">
            Kaydedilen alan hesabına bağlanır. Bildirimi açarsan bu alana uygun yeni kayıtlar için
            bildirim hazırlanır.
          </AppText>
          <TextField
            label="Arama adı"
            value={label}
            onChangeText={setLabel}
            placeholder="Örn. Ortahisar kiralık ev aramam"
            maxLength={120}
          />
          <View style={styles.notifyRow}>
            <View style={styles.notifyText}>
              <AppText variant="bodyStrong">Yeni kayıt bildirimi</AppText>
              <AppText variant="caption" color="textTertiary">
                Yalnızca bu alan ve filtrelerle eşleşen yayınlanmış kayıtlar için.
              </AppText>
            </View>
            <Switch value={notify} onValueChange={setNotify} trackColor={{ true: theme.colors.primary }} />
          </View>
          <View style={styles.actions}>
            <Button label="Vazgeç" variant="outline" onPress={onClose} style={styles.flex} />
            <Button
              label="Kaydet"
              loading={loading}
              disabled={label.trim().length < 2}
              onPress={() => onSave(label.trim(), notify)}
              style={styles.flex}
            />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    paddingTop: 8,
    gap: 12,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  notifyText: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  flex: { flex: 1 },
});
