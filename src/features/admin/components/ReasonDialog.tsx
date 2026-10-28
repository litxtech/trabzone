import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  visible: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  requireReason?: boolean;
  destructive?: boolean;
  loading?: boolean;
  amount?: boolean;
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (input: { reason: string; amountCents: number | null }) => void;
};

export function ReasonDialog({
  visible,
  title,
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  requireReason = true,
  destructive = false,
  loading = false,
  amount = false,
  extra,
  onCancel,
  onConfirm,
}: Props) {
  const { theme } = useTheme();
  const [reason, setReason] = useState('');
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (visible) {
      setReason('');
      setAmountText('');
      setError(null);
    }
  }, [visible]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = () => {
    const value = reason.trim();
    if (requireReason && value.length < 3) {
      setError('En az 3 karakterlik bir gerekçe yaz.');
      return;
    }
    let amountCents: number | null = null;
    if (amount) {
      const normalized = amountText.replace(/[^\d]/g, '');
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Geçerli bir tutar gir.');
        return;
      }
      amountCents = Math.round(parsed);
    }
    setError(null);
    onConfirm({ reason: value, amountCents });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Kapat" />
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
              ...theme.shadows.card,
            },
          ]}
        >
          <View style={styles.head}>
            <View
              style={[
                styles.icon,
                {
                  backgroundColor: destructive ? theme.colors.dangerSoft : theme.colors.primarySoft,
                },
              ]}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: destructive ? theme.colors.danger : theme.colors.primary,
                }}
              />
            </View>
            <View style={styles.flex}>
              <AppText variant="h3">{title}</AppText>
              {description ? (
                <AppText variant="caption" color="textSecondary">
                  {description}
                </AppText>
              ) : null}
            </View>
          </View>

          {amount ? (
            <TextField
              label="Tutar (kuruş)"
              placeholder="Örn. 15000"
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="number-pad"
              hint="Tutar kuruş cinsindendir. Sipariş bakiyesini aşamaz."
            />
          ) : null}

          {extra}

          {requireReason ? (
            <TextField
              label="İşlem gerekçesi"
              placeholder="Denetim kaydına yazılacak kısa gerekçe"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={400}
              hint="Gerekçe audit log içinde saklanır. Kişisel veri yazma."
            />
          ) : null}

          {error ? (
            <AppText variant="caption" color="danger">
              {error}
            </AppText>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={cancelLabel}
              variant="secondary"
              size="sm"
              fullWidth={false}
              onPress={onCancel}
              style={styles.flex}
            />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              size="sm"
              fullWidth={false}
              loading={loading}
              onPress={submit}
              style={styles.flex}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  card: { width: '100%', maxWidth: 480, padding: 18, gap: 12, borderWidth: 1 },
  head: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 2 },
});
