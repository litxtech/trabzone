import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar, Button, IconButton, TextField } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import type { DiscoverProfile } from '@/features/discovery/services/discover-service';
import { useDiscoverPeople } from '@/features/discovery/hooks/use-discover';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useCreateGroup, useStartDirectConversation } from '../hooks/use-chat';

export type NewChatSheetProps = {
  visible: boolean;
  initialMode?: 'direct' | 'group';
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
};

type Mode = 'direct' | 'group';

/**
 * Yeni sohbet / yeni grup akışı. Kullanıcı araması `people_discover` RPC'sini
 * kullanır; böylece gizlilik ve engel kuralları sunucuda uygulanır.
 */
export function NewChatSheet({
  visible,
  initialMode = 'direct',
  onClose,
  onOpenConversation,
}: NewChatSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Her açılışta formu sıfırlamak için key kullanılır. */}
      <NewChatContent
        key={`${visible ? 'open' : 'closed'}-${initialMode}`}
        initialMode={initialMode}
        onClose={onClose}
        onOpenConversation={onOpenConversation}
      />
    </Modal>
  );
}

type NewChatContentProps = {
  initialMode: Mode;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
};

function NewChatContent({ initialMode, onClose, onOpenConversation }: NewChatContentProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, DiscoverProfile>>({});
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debouncedQuery = useDebouncedValue(query, 300);
  const discovery = useDiscoverPeople({ query: debouncedQuery, city: null, sort: 'popular' });
  const startChat = useStartDirectConversation();
  const createGroup = useCreateGroup();

  const people = useMemo(() => discovery.data ?? [], [discovery.data]);
  const selectedIds = useMemo(() => Object.keys(selected), [selected]);

  const reset = () => {
    setQuery('');
    setTitle('');
    setSelected({});
    setError(null);
    setMode('direct');
  };

  const close = () => {
    reset();
    onClose();
  };

  const openDirect = (person: DiscoverProfile) => {
    setError(null);
    startChat.mutate(person.id, {
      onSuccess: ({ id }) => {
        haptics.success();
        reset();
        onOpenConversation(id);
      },
      onError: (mutationError) => setError(mutationError.message),
    });
  };

  const toggleSelected = (person: DiscoverProfile) => {
    haptics.selection();
    setSelected((current) => {
      const next = { ...current };
      if (next[person.id]) {
        delete next[person.id];
      } else {
        next[person.id] = person;
      }
      return next;
    });
  };

  const submitGroup = () => {
    setError(null);
    if (title.trim().length < 1) {
      setError('Gruba bir isim ver.');
      return;
    }
    if (selectedIds.length < 1) {
      setError('En az bir kişi seç.');
      return;
    }

    createGroup.mutate(
      { title: title.trim(), memberIds: selectedIds },
      {
        onSuccess: ({ id }) => {
          haptics.success();
          reset();
          onOpenConversation(id);
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  const busy = startChat.isPending || createGroup.isPending;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background, paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <IconButton name="close" accessibilityLabel="Kapat" variant="surface" size={20} onPress={close} />
          <AppText variant="h3" style={styles.headerTitle}>
            {mode === 'group' ? 'Yeni grup' : 'Yeni sohbet'}
          </AppText>
          <IconButton
            name="people-outline"
            accessibilityLabel={mode === 'group' ? 'Birebir sohbete geç' : 'Grup oluştur'}
            variant="surface"
            size={19}
            onPress={() => {
              haptics.selection();
              setError(null);
              setMode((current) => (current === 'group' ? 'direct' : 'group'));
            }}
          />
        </View>

        <View style={styles.controls}>
          {mode === 'group' ? (
            <TextField
              placeholder="Grup adı"
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              leftIcon="people-outline"
            />
          ) : null}

          <TextField
            placeholder="İsim veya kullanıcı adı ara"
            value={query}
            onChangeText={setQuery}
            leftIcon="search-outline"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />

          {mode === 'group' ? (
            <View style={styles.groupBar}>
              <AppText variant="caption" color="textSecondary">
                {selectedIds.length} kişi seçildi
              </AppText>
              <AppText variant="caption" color="textTertiary">
                En fazla 50 kişi
              </AppText>
            </View>
          ) : null}

          {error ? (
            <View
              style={[
                styles.error,
                { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}
        </View>

        {discovery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : discovery.isError ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
            <AppText variant="body" color="textSecondary" align="center">
              Kişiler yüklenemedi.
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tekrar dene"
              onPress={() => void discovery.refetch()}
            >
              <AppText variant="label" color="primaryDeep">
                Tekrar dene
              </AppText>
            </Pressable>
          </View>
        ) : people.length === 0 ? (
          <View style={styles.center}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="person-outline" size={22} color={theme.colors.primaryDeep} />
            </View>
            <AppText variant="bodyStrong">Kimse bulunamadı</AppText>
            <AppText variant="body" color="textSecondary" align="center">
              Farklı bir isim veya kullanıcı adı dene.
            </AppText>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 120 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {people.map((person) => {
              const name =
                `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.username;
              const isSelected = Boolean(selected[person.id]);
              const pending = startChat.isPending && startChat.variables === person.id;

              return (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === 'group'
                      ? `${name} ${isSelected ? 'seçimini kaldır' : 'seç'}`
                      : `${name} ile sohbet başlat`
                  }
                  accessibilityState={{ selected: isSelected, busy: pending }}
                  disabled={busy}
                  onPress={() => (mode === 'group' ? toggleSelected(person) : openDirect(person))}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: isSelected ? theme.colors.primarySoft : theme.colors.surface,
                      borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Avatar uri={mediaPublicUrl('avatar', person.avatar_path)} name={name} size={44} />
                  <View style={styles.rowText}>
                    <View style={styles.nameRow}>
                      <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                        {name}
                      </AppText>
                      {person.is_verified ? (
                        <Ionicons name="checkmark-circle" size={14} color={theme.colors.primary} />
                      ) : null}
                    </View>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      @{person.username}
                      {person.city ? ` · ${person.city}` : ''}
                    </AppText>
                  </View>

                  {mode === 'group' ? (
                    <View
                      style={[
                        styles.checkbox,
                        {
                          backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                          borderColor: isSelected ? theme.colors.primary : theme.colors.borderStrong,
                        },
                      ]}
                    >
                      {isSelected ? (
                        <Ionicons name="checkmark" size={14} color={theme.colors.onPrimary} />
                      ) : null}
                    </View>
                  ) : pending ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <Ionicons name="chatbubble-outline" size={17} color={theme.colors.textTertiary} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {mode === 'group' ? (
          <View
            style={[
              styles.footer,
              {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.divider,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            <Button
              label={
                selectedIds.length > 0 ? `Grup oluştur (${selectedIds.length})` : 'Grup oluştur'
              }
              onPress={submitGroup}
              loading={createGroup.isPending}
              disabled={selectedIds.length === 0 || title.trim().length === 0}
            />
          </View>
        ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 10,
  },
  headerTitle: { flex: 1, textAlign: 'center' },
  controls: { paddingHorizontal: 20, paddingTop: 14, gap: 10 },
  groupBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 40 },
  emptyIcon: { width: 50, height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingTop: 14, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 11,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
