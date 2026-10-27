import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr, formatSlaRemaining } from '@/utils/date';
import { haptics } from '@/utils/haptics';

import {
  CHILD_REASONS,
  CHILD_REASON_MAP,
  REPORT_REASONS,
  REPORT_TARGET_ICON,
  REPORT_TARGET_LABEL,
  SUPPORT_EMAIL,
} from '../constants';
import { useCreateReport } from '../hooks/use-safety-mutations';
import type { Attachment, ReportDraft, ReportReceipt } from '../types';
import { AttachmentPicker } from './AttachmentPicker';
import { SafetySheet } from './SafetySheet';

type Step = 'reason' | 'child' | 'details' | 'done';

type Props = {
  visible: boolean;
  target: ReportDraft | null;
  onClose: () => void;
};

const CHILD_STEPS = ['Neden', 'Ayrıntı', 'Gönder'] as const;

export function ReportSheet({ visible, target, onClose }: Props) {
  const { theme } = useTheme();
  const router = useRouter();
  const createReport = useCreateReport();

  const [step, setStep] = useState<Step>('reason');
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [childReason, setChildReason] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);

  const isChildReport = reasonCode === 'child_safety';
  const childMeta = childReason ? CHILD_REASON_MAP[childReason as keyof typeof CHILD_REASON_MAP] : null;

  const resetForm = () => {
    setStep('reason');
    setReasonCode(null);
    setChildReason(null);
    setDescription('');
    setAttachments([]);
    setError(null);
    setReceipt(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const targetLabel = useMemo(() => {
    if (!target) {
      return 'İçerik';
    }
    const type = REPORT_TARGET_LABEL[target.targetType];
    return target.targetLabel ? `${type} · ${target.targetLabel}` : type;
  }, [target]);

  const submit = async () => {
    if (!target || !reasonCode) {
      return;
    }
    setError(null);
    try {
      const result = await createReport.mutateAsync({
        ...target,
        reasonCode,
        childReasonCode: isChildReport ? childReason : null,
        description: description.trim(),
        attachments,
      });
      haptics.success();
      setReceipt(result);
      setStep('done');
    } catch (submitError) {
      haptics.error();
      setError(
        submitError && typeof submitError === 'object' && 'message' in submitError
          ? String((submitError as { message: unknown }).message)
          : 'Bildirim gönderilemedi. Tekrar dene.',
      );
    }
  };

  const sla = receipt ? formatSlaRemaining(receipt.sla_due_at) : null;

  return (
    <SafetySheet
      visible={visible}
      onClose={handleClose}
      title={step === 'done' ? undefined : 'Bildir'}
      subtitle={step === 'done' ? undefined : targetLabel}
      footer={
        step === 'details' ? (
          <Button
            label="Bildirimi gönder"
            loading={createReport.isPending}
            onPress={() => void submit()}
            leftIcon={<Ionicons name="shield-checkmark-outline" size={18} color="#FFFFFF" />}
          />
        ) : step === 'done' ? (
          <Button
            label="Başvurularım'da takip et"
            onPress={() => {
              onClose();
              router.push('/support/my-requests');
            }}
          />
        ) : undefined
      }
    >
      {step !== 'done' ? (
        <View style={styles.stepper}>
          {(isChildReport ? CHILD_STEPS : ['Neden', 'Ayrıntı', 'Gönder']).map((label, index) => {
            const activeIndex = step === 'reason' || step === 'child' ? 0 : 1;
            const active = index <= activeIndex;
            return (
              <View key={label} style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? 'onPrimary' : 'textTertiary'}>
                    {index + 1}
                  </AppText>
                </View>
                <AppText variant="caption" color={active ? 'primaryDeep' : 'textTertiary'}>
                  {label}
                </AppText>
                {index < 2 ? (
                  <View
                    style={[
                      styles.stepLine,
                      { backgroundColor: active ? theme.colors.primary : theme.colors.border },
                    ]}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {step === 'reason' ? (
        <View style={styles.list}>
          <AppText variant="caption" color="textSecondary">
            Bu içerikle ilgili en uygun nedeni seç. Bildirimin gönderenin kimliğiyle birlikte
            paylaşılmaz.
          </AppText>

          {target?.targetType === 'profile' || target?.targetType === 'user' ? (
            <View
              style={[
                styles.targetHint,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons
                name={REPORT_TARGET_ICON[target.targetType]}
                size={18}
                color={theme.colors.textSecondary}
              />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                {targetLabel}
              </AppText>
            </View>
          ) : null}

          {REPORT_REASONS.map((reason) => {
            const selected = reasonCode === reason.code;
            const isChild = reason.code === 'child_safety';
            return (
              <Pressable
                key={reason.code}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setReasonCode(reason.code);
                  setError(null);
                  if (isChild) {
                    haptics.selection();
                    setStep('child');
                    return;
                  }
                  setStep('details');
                }}
                style={({ pressed }) => [
                  styles.reasonRow,
                  {
                    backgroundColor: selected
                      ? theme.colors.primarySoft
                      : isChild
                        ? theme.colors.dangerSoft
                        : theme.colors.surface,
                    borderColor: selected
                      ? theme.colors.primary
                      : isChild
                        ? theme.colors.danger
                        : theme.colors.border,
                    borderRadius: theme.radius.md,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.reasonIcon,
                    {
                      backgroundColor: isChild ? theme.colors.surface : theme.colors.surfaceMuted,
                    },
                  ]}
                >
                  <Ionicons
                    name={reason.icon}
                    size={19}
                    color={isChild ? theme.colors.danger : theme.colors.primaryDeep}
                  />
                </View>
                <View style={styles.flex}>
                  <View style={styles.reasonTitleRow}>
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {reason.label}
                    </AppText>
                    {reason.urgent ? (
                      <View style={[styles.tag, { backgroundColor: theme.colors.danger }]}>
                        <AppText variant="caption" color="#FFFFFF">
                          Öncelikli
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <AppText variant="caption" color="textSecondary">
                    {reason.description}
                  </AppText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {step === 'child' ? (
        <View style={styles.list}>
          <View
            style={[
              styles.childHero,
              { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
            ]}
          >
            <Ionicons name="shield-half-outline" size={24} color={theme.colors.danger} />
            <View style={styles.flex}>
              <AppText variant="bodyStrong" color="danger">
                Çocuk güvenliği bildirimi
              </AppText>
              <AppText variant="caption" color="textSecondary">
                Bu bildirim ayrı ve öncelikli bir kuyruğa gider. İnceleme hedefi 30 dakikadır.
              </AppText>
            </View>
          </View>

          <AppText variant="label" color="textTertiary">
            DURUMU EN İYİ TANIMLAYAN SEÇENEK
          </AppText>

          {CHILD_REASONS.map((reason) => {
            const selected = childReason === reason.code;
            return (
              <Pressable
                key={reason.code}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setChildReason(reason.code);
                  setError(null);
                  haptics.selection();
                  setStep('details');
                }}
                style={({ pressed }) => [
                  styles.reasonRow,
                  {
                    backgroundColor: selected ? theme.colors.dangerSoft : theme.colors.surface,
                    borderColor: selected ? theme.colors.danger : theme.colors.border,
                    borderRadius: theme.radius.md,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.reasonIcon, { backgroundColor: theme.colors.dangerSoft }]}>
                  <Ionicons name={reason.icon} size={19} color={theme.colors.danger} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{reason.label}</AppText>
                  <AppText variant="caption" color="textSecondary">
                    {reason.description}
                  </AppText>
                </View>
                {reason.critical ? (
                  <View style={[styles.tag, { backgroundColor: theme.colors.danger }]}>
                    <AppText variant="caption" color="#FFFFFF">
                      Kritik
                    </AppText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}

          <Button
            label="Geri"
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => {
              setStep('reason');
              setReasonCode(null);
              setChildReason(null);
            }}
          />
        </View>
      ) : null}

      {step === 'details' ? (
        <View style={styles.list}>
          <View
            style={[
              styles.selection,
              {
                backgroundColor: isChildReport ? theme.colors.dangerSoft : theme.colors.primarySoft,
                borderColor: isChildReport ? theme.colors.danger : theme.colors.primary,
              },
            ]}
          >
            <View style={styles.flex}>
              <AppText variant="caption" color="textTertiary">
                SEÇİLEN NEDEN
              </AppText>
              <AppText variant="bodyStrong">
                {isChildReport ? childMeta?.label : REPORT_REASONS.find((r) => r.code === reasonCode)?.label}
              </AppText>
              {isChildReport && childMeta?.critical ? (
                <AppText variant="caption" color="danger">
                  Kritik öncelik · 30 dakika inceleme hedefi
                </AppText>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nedeni değiştir"
              onPress={() => setStep(isChildReport ? 'child' : 'reason')}
              hitSlop={8}
            >
              <AppText variant="caption" color="primaryDeep">
                Değiştir
              </AppText>
            </Pressable>
          </View>

          {childReason === 'child_immediate_danger' ? (
            <View
              style={[
                styles.alert,
                { backgroundColor: theme.colors.danger, borderColor: theme.colors.danger },
              ]}
            >
              <Ionicons name="call" size={18} color="#FFFFFF" />
              <AppText variant="caption" color="#FFFFFF" style={styles.flex}>
                Hayati tehlike varsa önce 112&apos;yi ara. Ardından bu bildirimi göndererek ekibimizi
                bilgilendir.
              </AppText>
            </View>
          ) : null}

          <TextField
            label={isChildReport ? 'Ne oldu? (isteğe bağlı)' : 'Ayrıntı (isteğe bağlı)'}
            placeholder={
              isChildReport
                ? 'Gördüklerini kendi cümlelerinle anlat. Kimseyi suçlamak zorunda değilsin.'
                : 'Neden bildirdiğini kısaca açıkla.'
            }
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={2000}
            numberOfLines={5}
            textAlignVertical="top"
            style={{ minHeight: 110 }}
            hint={`${description.length}/2000`}
          />

          <View style={styles.attachmentBlock}>
            <AppText variant="label" color="textSecondary">
              Ekran görüntüsü ekle
            </AppText>
            <AttachmentPicker
              attachments={attachments}
              onChange={setAttachments}
              kind="report"
              onError={setError}
            />
          </View>

          {isChildReport ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons name="lock-closed-outline" size={16} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Bildirimin gizli tutulur. Kimliğin, bildirdiğin kişiye veya üçüncü kişilere
                açıklanmaz. Yalnızca yetkili çocuk güvenliği ekibi görüntüleyebilir.
              </AppText>
            </View>
          ) : (
            <View
              style={[
                styles.notice,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Ionicons name="time-outline" size={16} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Bildirimlerin 24 saat içinde incelenir. Acil tehlike durumunda lütfen yerel acil
                servisi ara.
              </AppText>
            </View>
          )}

          {error ? (
            <View
              style={[
                styles.error,
                { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}

          <AppText variant="caption" color="textTertiary">
            Bildirimi göndererek topluluk kurallarını ve güvenlik politikamızı kabul etmiş olursun.
            Sorular için {SUPPORT_EMAIL}.
          </AppText>
        </View>
      ) : null}

      {step === 'done' && receipt ? (
        <View style={styles.done}>
          <View
            style={[
              styles.doneIcon,
              {
                backgroundColor: receipt.is_child_safety
                  ? theme.colors.dangerSoft
                  : theme.colors.successSoft,
              },
            ]}
          >
            <Ionicons
              name={receipt.is_child_safety ? 'shield-checkmark' : 'checkmark-circle'}
              size={42}
              color={receipt.is_child_safety ? theme.colors.danger : theme.colors.success}
            />
          </View>

          <AppText variant="h2" align="center">
            {receipt.is_child_safety ? 'Çocuk güvenliği bildirimin alındı' : 'Bildirimin alındı'}
          </AppText>

          <AppText variant="body" color="textSecondary" align="center">
            {receipt.is_child_safety
              ? 'Bildirimin öncelikli çocuk güvenliği kuyruğuna yönlendirildi. Ekibimiz en kısa sürede incelemeye başlayacak.'
              : 'Bildirimin güvenlik ekibimize iletildi. İnceleme durumunu Başvurularım bölümünden takip edebilirsin.'}
          </AppText>

          <View
            style={[
              styles.receiptCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
              },
            ]}
          >
            <ReceiptRow label="Bildirim numarası" value={receipt.report_no} strong />
            <ReceiptRow label="Durum" value={receipt.is_child_safety ? 'Öncelikli inceleme' : 'Alındı'} />
            <ReceiptRow
              label="Gönderim"
              value={formatDateTimeTr(receipt.created_at)}
            />
            {sla ? (
              <ReceiptRow
                label={receipt.is_child_safety ? 'İnceleme hedefi' : 'Yanıt hedefi'}
                value={`${sla.label} (${formatRelativeTr(receipt.created_at)})`}
                tone={sla.expired ? 'danger' : 'default'}
              />
            ) : null}
          </View>

          {receipt.is_child_safety ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
              ]}
            >
              <Ionicons name="lock-closed" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="danger" style={styles.flex}>
                Kimliğin gizli tutulur. Bu bildirim, bildirdiğin kişiye hiçbir şekilde bildirilmez.
              </AppText>
            </View>
          ) : null}

          <Button
            label="Kapat"
            variant="secondary"
            onPress={() => {
              onClose();
            }}
          />
        </View>
      ) : null}
    </SafetySheet>
  );
}

function ReceiptRow({
  label,
  value,
  strong,
  tone = 'default',
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <View style={styles.receiptRow}>
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
      <AppText
        variant={strong ? 'bodyStrong' : 'body'}
        color={tone === 'danger' ? 'danger' : 'text'}
        style={styles.receiptValue}
        numberOfLines={2}
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  stepDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepLine: { width: 22, height: 2, borderRadius: 1, marginHorizontal: 2 },
  targetHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
  },
  reasonIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  reasonTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999 },
  childHero: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'flex-start',
  },
  selection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  attachmentBlock: { gap: 6 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  done: { alignItems: 'center', gap: 12, paddingTop: 8 },
  doneIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  receiptCard: { width: '100%', padding: 14, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
  receiptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  receiptValue: { flex: 1, textAlign: 'right' },
});
