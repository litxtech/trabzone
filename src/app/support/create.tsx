import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/utils/router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, TextField } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { AttachmentPicker } from '@/features/safety/components/AttachmentPicker';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_MAP,
  SUPPORT_EMAIL,
  SUPPORT_RESPONSE_TARGET_HOURS,
} from '@/features/safety/constants';
import { useCreateTicket } from '@/features/safety/hooks/use-safety-mutations';
import type { Attachment, SupportCategoryCode, TicketReceipt } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, formatRelativeTr, formatSlaRemaining } from '@/utils/date';
import { haptics } from '@/utils/haptics';

const VALID_CATEGORIES = new Set(SUPPORT_CATEGORIES.map((category) => category.code));

export default function CreateTicketScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    category?: string;
    subject?: string;
    referenceType?: string;
    referenceId?: string;
  }>();

  const initialCategory: SupportCategoryCode = useMemo(() => {
    const candidate = params.category as SupportCategoryCode | undefined;
    return candidate && VALID_CATEGORIES.has(candidate) ? candidate : 'other';
  }, [params.category]);

  const [category, setCategory] = useState<SupportCategoryCode>(initialCategory);
  const [subject, setSubject] = useState(typeof params.subject === 'string' ? params.subject : '');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ subject?: string; body?: string }>({});
  const [receipt, setReceipt] = useState<TicketReceipt | null>(null);

  const createTicket = useCreateTicket();
  const isChild = category === 'child_safety';

  const submit = async () => {
    const nextErrors: { subject?: string; body?: string } = {};
    if (subject.trim().length < 3) {
      nextErrors.subject = 'Konu en az 3 karakter olmalı.';
    }
    if (body.trim().length < 10) {
      nextErrors.body = 'Sorununu en az 10 karakterle anlat.';
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      haptics.warning();
      return;
    }

    setError(null);
    try {
      const result = await createTicket.mutateAsync({
        category,
        subject: subject.trim(),
        body: body.trim(),
        attachments,
      });
      haptics.success();
      setReceipt(result);
    } catch (submitError) {
      haptics.error();
      setError(
        submitError && typeof submitError === 'object' && 'message' in submitError
          ? String((submitError as { message: unknown }).message)
          : 'Talep oluşturulamadı. Tekrar dene.',
      );
    }
  };

  if (receipt) {
    const sla = formatSlaRemaining(receipt.sla_due_at);
    return (
      <Screen edges={['top', 'left', 'right']} scroll padded>
        <SafetyHeader
          title="Talebin alındı"
          subtitle="Destek ekibimiz bilgilendirildi"
          onBack={() => router.replace('/support')}
        />

        <Card style={styles.successCard}>
          <View style={[styles.successIcon, { backgroundColor: theme.colors.successSoft }]}>
            <Ionicons name="checkmark-circle" size={40} color={theme.colors.success} />
          </View>
          <AppText variant="h2" align="center">
            Destek talebin oluşturuldu
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            {isChild
              ? 'Çocuk güvenliği talebin öncelikli kuyruğa alındı. Ekibimiz en kısa sürede dönüş yapacak.'
              : `Ekibimiz ${SUPPORT_RESPONSE_TARGET_HOURS} saat içinde yanıtlayacak. Tüm gelişmeleri Başvurularım bölümünden takip edebilirsin.`}
          </AppText>

          <View
            style={[
              styles.receiptBox,
              { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md },
            ]}
          >
            <ReceiptLine label="Talep numarası" value={receipt.ticket_no} strong />
            <ReceiptLine label="Konu" value={SUPPORT_CATEGORY_MAP[receipt.category_code]?.label ?? 'Destek'} />
            <ReceiptLine label="Durum" value={isChild ? 'Öncelikli inceleme' : 'Alındı'} />
            <ReceiptLine label="Oluşturma" value={formatDateTimeTr(receipt.created_at)} />
            {sla ? (
              <ReceiptLine
                label={isChild ? 'İnceleme hedefi' : 'Yanıt hedefi'}
                value={`${sla.label} (${formatRelativeTr(receipt.created_at)})`}
                tone={sla.expired ? 'danger' : 'default'}
              />
            ) : null}
          </View>

          <Button label="Talebi görüntüle" onPress={() => router.replace(`/support/${receipt.id}`)} />
          <Button label="Destek merkezine dön" variant="secondary" onPress={() => router.replace('/support')} />
        </Card>

        <AppText variant="caption" color="textTertiary" align="center">
          Acil tehlike durumunda lütfen yerel acil servisi (112) ara. E-posta: {SUPPORT_EMAIL}
        </AppText>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded keyboardAware>
      <SafetyHeader
        title="Yeni destek talebi"
        subtitle="Ne kadar ayrıntı verirsen o kadar hızlı çözebiliriz"
      />

      {isChild ? (
        <View
          style={[
            styles.childNotice,
            { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
          ]}
        >
          <Ionicons name="shield-half-outline" size={20} color={theme.colors.danger} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" color="danger">
              Öncelikli çocuk güvenliği talebi
            </AppText>
            <AppText variant="caption" color="textSecondary">
              Bu talep 30 dakika içinde incelemeye alınır. Hayati tehlike varsa önce 112&apos;yi ara.
              Talebin gizli tutulur.
            </AppText>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <AppText variant="label" color="textSecondary">
          Konu
        </AppText>
        <View style={styles.categoryGrid}>
          {SUPPORT_CATEGORIES.map((item) => {
            const active = category === item.code;
            const danger = item.code === 'child_safety';
            return (
              <Pressable
                key={item.code}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.selection();
                  setCategory(item.code);
                }}
                style={({ pressed }) => [
                  styles.categoryChip,
                  {
                    backgroundColor: active
                      ? danger
                        ? theme.colors.danger
                        : theme.colors.primaryDeep
                      : theme.colors.surface,
                    borderColor: active
                      ? danger
                        ? theme.colors.danger
                        : theme.colors.primaryDeep
                      : theme.colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={15}
                  color={
                    active
                      ? theme.colors.onPrimary
                      : danger
                        ? theme.colors.danger
                        : theme.colors.textSecondary
                  }
                />
                <AppText
                  variant="caption"
                  color={active ? theme.colors.onPrimary : danger ? 'danger' : 'textSecondary'}
                >
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <TextField
          label="Kısa başlık"
          placeholder="Örn. Hesabıma giriş yapamıyorum"
          value={subject}
          onChangeText={setSubject}
          maxLength={120}
          error={fieldErrors.subject}
          hint={`${subject.length}/120`}
        />

        <TextField
          label="Sorunun ayrıntısı"
          placeholder="Ne olduğunu, ne zaman başladığını ve daha önce ne denediğini yaz."
          value={body}
          onChangeText={setBody}
          multiline
          numberOfLines={6}
          maxLength={4000}
          textAlignVertical="top"
          style={{ minHeight: 130 }}
          error={fieldErrors.body}
          hint={`${body.length}/4000`}
        />
      </View>

      <View style={styles.section}>
        <AppText variant="label" color="textSecondary">
          Ekran görüntüsü veya belge
        </AppText>
        <AttachmentPicker
          attachments={attachments}
          onChange={setAttachments}
          kind="support"
          onError={setError}
        />
      </View>

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

      <Button
        label="Talebi gönder"
        loading={createTicket.isPending}
        onPress={() => void submit()}
        leftIcon={<Ionicons name="send-outline" size={18} color="#FFFFFF" />}
      />

      <AppText variant="caption" color="textTertiary" align="center">
        Göndererek topluluk kurallarını kabul etmiş olursun. Yanıt süresi hedefi{' '}
        {isChild ? '30 dakika' : `${SUPPORT_RESPONSE_TARGET_HOURS} saat`}.
      </AppText>
    </Screen>
  );
}

function ReceiptLine({
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
    <View style={styles.receiptLine}>
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
  section: { gap: 10, marginBottom: 16 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  childNotice: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 13,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 16,
  },
  error: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
  },
  successCard: { alignItems: 'center', gap: 10 },
  successIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  receiptBox: { width: '100%', padding: 14, gap: 9, marginVertical: 6 },
  receiptLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  receiptValue: { flex: 1, textAlign: 'right' },
});
