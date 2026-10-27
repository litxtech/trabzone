import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

import { AppText } from './AppText';
import { TextField } from './TextField';

export type SelectSheetProps = {
  visible: boolean;
  title: string;
  options: readonly string[];
  value?: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
  emptyLabel?: string;
};

export function SelectSheet({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
  emptyLabel = 'Sonuç bulunamadı.',
}: SelectSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    if (!needle) {
      return options;
    }
    return options.filter((option) =>
      option.toLocaleLowerCase('tr-TR').includes(needle),
    );
  }, [options, query]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Seçimi kapat"
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={styles.head}>
            <AppText variant="h3">{title}</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              hitSlop={10}
              onPress={onClose}
            >
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <TextField
            placeholder="Ara"
            value={query}
            onChangeText={setQuery}
            leftIcon="search-outline"
            autoCorrect={false}
            returnKeyType="search"
          />

          <FlatList
            data={filtered}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <AppText variant="caption" color="textTertiary" align="center" style={styles.empty}>
                {emptyLabel}
              </AppText>
            }
            renderItem={({ item }) => {
              const selected = item === value;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item}
                  onPress={() => {
                    onSelect(item);
                    setQuery('');
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: pressed
                        ? theme.colors.surfaceMuted
                        : selected
                          ? theme.colors.primarySoft
                          : 'transparent',
                      borderRadius: theme.radius.sm,
                    },
                  ]}
                >
                  <AppText
                    variant="body"
                    color={selected ? 'primaryDeep' : 'text'}
                    style={styles.optionLabel}
                  >
                    {item}
                  </AppText>
                  {selected ? (
                    <Ionicons name="checkmark" size={18} color={theme.colors.primary} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  sheet: {
    maxHeight: '82%',
    paddingHorizontal: 18,
    paddingTop: 8,
    gap: 12,
  },
  grabber: { width: 40, height: 4, borderRadius: 999, alignSelf: 'center', marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { marginTop: 2 },
  listContent: { paddingBottom: 8 },
  empty: { paddingVertical: 24 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  optionLabel: { flex: 1 },
});
