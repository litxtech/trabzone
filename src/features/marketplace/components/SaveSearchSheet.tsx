import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useSaveSearch } from '../hooks/use-marketplace-catalog';

type Props = {
  visible: boolean;
  defaultLabel: string;
  filters: Record<string, unknown>;
  onClose: () => void;
  onSaved?: () => void;
};

/** Kaydedilmiş arama + yeni ilan alarmı. Gerçek `market_saved_search_save` RPC'sini kullanır. */
export function SaveSearchSheet({ visible, defaultLabel, filters, onClose, onSaved }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState(defaultLabel);
  const [notify, setNotify] = useState(true);
  const mutation = useSaveSearch();

  useEffect(() => {
    if (visible) {
      // Pencere her açıldığında varsayılan etiket ve bildirim tercihi sıfırlanır.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLabel(defaultLabel);
      setNotify(true);
    }
  }, [defaultLabel, visible]);

  const submit = () => {
    const trimmed = label.trim();
    if (trimmed.length < 2) {
      Alert.alert('Arama adı gerekli', 'Kaydetmek için en az 2 karakterlik bir ad yaz.');
      return;
    }
    mutation.mutate(
      { label: trimmed, filters, notifyEnabled: notify },
      {
        onSuccess: () => {
          haptics.success();
          Alert.alert('Arama kaydedildi', 'Yeni uygun ilanlar için bildirim göndereceğiz.');
          onSaved?.();
          onClose();
        },
        onError: (error) => {
          Alert.alert('Kaydedilemedi', error.message || 'Tekrar dene.');
        },
      },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={onClose} style={styles.backdrop} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              paddingBottom: insets.bottom + 14,
            },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: theme.colors.borderStrong }]} />
          </View>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="bookmark" size={18} color={theme.colors.primaryDeep} />
            </View>
            <View style={styles.flex}>
              <AppText variant="h3">Aramayı kaydet</AppText>
              <AppText variant="caption" color="textTertiary">
                Yeni ilanlar için alarm oluştur
              </AppText>
            </View>
          </View>

          <TextField
            label="Arama adı"
            value={label}
            onChangeText={setLabel}
            maxLength={80}
            placeholder="Örn. Ortahisar kiralık daire"
            leftIcon="bookmark-outline"
          />

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: notify }}
            onPress={() => {
              haptics.selection();
              setNotify((current) => !current);
            }}
            style={[styles.toggleRow, { borderColor: theme.colors.border }]}
          >
            <View style={styles.flex}>
              <AppText variant="label">Bildirim gönder</AppText>
              <AppText variant="caption" color="textTertiary">
                Bu kriterlere uygun yeni ilan açıldığında haber ver.
              </AppText>
            </View>
            <View
              style={[
                styles.switch,
                { backgroundColor: notify ? theme.colors.primary : theme.colors.borderStrong },
              ]}
            >
              <View style={[styles.knob, { alignSelf: notify ? 'flex-end' : 'flex-start' }]} />
            </View>
          </Pressable>

          <Button label="Kaydet" loading={mutation.isPending} onPress={submit} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(3,7,14,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 4,
    gap: 14,
  },
  handleWrap: { alignItems: 'center', paddingVertical: 9 },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  switch: { width: 42, height: 25, borderRadius: 13, padding: 3, justifyContent: 'center' },
  knob: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#FFFFFF' },
});
