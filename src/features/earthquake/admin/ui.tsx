import { useState, type ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useTheme } from '@/theme/ThemeProvider';

export const HEALTH_LABELS: Record<string, string> = {
  unknown: 'Bilinmiyor',
  healthy: 'Sağlıklı',
  degraded: 'Sorunlu',
  down: 'Erişilemiyor',
  disabled: 'Devre dışı',
};

export const HEALTH_TONES: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  unknown: 'neutral',
  healthy: 'success',
  degraded: 'warning',
  down: 'danger',
  disabled: 'neutral',
};

export const TERMS_LABELS: Record<string, string> = {
  pending_review: 'Kullanım şartları doğrulanmadı',
  verified: 'Kullanım şartları doğrulandı',
  restricted: 'Kullanım kısıtlı',
};

export const STATUS_LABELS: Record<string, string> = {
  active: 'Yayında',
  under_review: 'İncelemede',
  pending_match: 'Eşleştirme bekliyor',
  merged: 'Birleştirildi',
  removed: 'Kaldırıldı',
  pending: 'Bekliyor',
  fanning_out: 'Dağıtılıyor',
  completed: 'Tamamlandı',
  skipped: 'Atlandı',
  failed: 'Başarısız',
  cancelled: 'İptal',
  success: 'Başarılı',
  partial: 'Kısmi',
  running: 'Çalışıyor',
  linked: 'Bağlandı',
  rejected: 'Reddedildi',
  invalid_token: 'Geçersiz token',
  expired: 'Süresi doldu',
};

export const SKIP_REASONS: Record<string, string> = {
  backfill: 'Geçmiş veri doldurma',
  late: 'Geç gelen kayıt',
  outside_region: 'İzleme bölgesi dışında',
  disabled: 'Bildirimler kapalı',
  pending_match: 'Eşleştirme bekliyor',
  event_removed: 'Kayıt kaldırıldı',
  no_recipients: 'Alıcı yok',
};

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.kv}>
      <AppText variant="caption" color="textSecondary" style={styles.kvLabel}>
        {label}
      </AppText>
      {typeof value === 'string' || typeof value === 'number' ? (
        <AppText variant="body" style={styles.flex} selectable>
          {value}
        </AppText>
      ) : (
        <View style={styles.flex}>{value}</View>
      )}
    </View>
  );
}

export function SettingSwitch({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <AppText variant="body">{label}</AppText>
        {hint ? (
          <AppText variant="caption" color="textTertiary">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
      />
    </View>
  );
}

type PendingAction = {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  run: (reason: string) => Promise<unknown>;
  success?: string;
};

/**
 * Gerekçe isteyen admin işlemleri. Her yazma işlemi sunucuda da gerekçe
 * zorunluluğu (en az 5 karakter) ve audit kaydıyla korunur.
 */
export function useReasonAction() {
  const toast = useAdminToast();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const dialog = (
    <ReasonDialog
      visible={pending != null}
      title={pending?.title ?? ''}
      description={pending?.description}
      confirmLabel={pending?.confirmLabel ?? 'Onayla'}
      destructive={pending?.destructive}
      requireReason
      loading={busy}
      onCancel={() => (busy ? undefined : setPending(null))}
      onConfirm={async ({ reason }) => {
        if (!pending) return;
        setBusy(true);
        try {
          await pending.run(reason);
          toast.success(pending.success ?? 'İşlem tamamlandı.');
          setPending(null);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'İşlem başarısız.');
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  return { ask: setPending, dialog };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  kv: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  kvLabel: { width: 170 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
});
