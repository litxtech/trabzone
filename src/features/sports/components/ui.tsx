import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export function SectionCard({ children, title, right, style }: { children: ReactNode; title?: string; right?: ReactNode; style?: ViewStyle }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }, style]}>
      {title ? (
        <View style={styles.titleRow}>
          <AppText variant="title" style={styles.flex}>
            {title}
          </AppText>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function PanelLoading() {
  const { theme } = useTheme();
  return (
    <View style={styles.state}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

export function PanelError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onRetry} style={styles.state} accessibilityRole="button" accessibilityLabel="Tekrar dene">
      <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.textSecondary} />
      <AppText variant="body" color="textSecondary" align="center">
        {message ?? 'Veri yüklenemedi. Tekrar denemek için dokun.'}
      </AppText>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.state}>
      <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={24} color={theme.colors.primaryDeep} />
      </View>
      <AppText variant="bodyStrong" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" color="textSecondary" align="center">
          {body}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted,
          borderColor: active ? theme.colors.primary : theme.colors.border,
        },
      ]}
    >
      <AppText variant="caption" style={{ color: active ? theme.colors.onPrimary : theme.colors.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Moderasyon işlemleri için gerekçe isteyen küçük pencere (sunucu ≥5 karakter ister). */
export function ReasonPrompt({
  visible,
  title,
  confirmLabel = 'Onayla',
  destructive,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { theme } = useTheme();
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 5;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.promptBackdrop, { backgroundColor: theme.colors.overlay }]}>
        <View style={[styles.prompt, { backgroundColor: theme.colors.surface }]}>
          <AppText variant="title">{title}</AppText>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Gerekçe (en az 5 karakter)"
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.promptInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
            multiline
            maxLength={300}
            autoFocus
          />
          <View style={styles.promptActions}>
            <Pressable
              onPress={() => {
                setReason('');
                onCancel();
              }}
              style={styles.promptButton}
            >
              <AppText variant="bodyStrong" color="textSecondary">
                Vazgeç
              </AppText>
            </Pressable>
            <Pressable
              disabled={!valid}
              onPress={() => {
                const value = reason.trim();
                setReason('');
                onConfirm(value);
              }}
              style={[styles.promptButton, { opacity: valid ? 1 : 0.4 }]}
            >
              <AppText variant="bodyStrong" color={destructive ? 'danger' : 'primary'}>
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  promptBackdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  prompt: { borderRadius: 20, padding: 18, gap: 12 },
  promptInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10, minHeight: 70, textAlignVertical: 'top' },
  promptActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  promptButton: { paddingHorizontal: 12, paddingVertical: 8 },
  flex: { flex: 1 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  state: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 36, paddingHorizontal: 24 },
  icon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
});
