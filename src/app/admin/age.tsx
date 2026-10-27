import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, TextField } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { SafetySheet } from '@/features/safety/components/SafetySheet';
import { useAgeOverview, useGuardianConsents } from '@/features/safety/hooks/use-safety';
import {
  useAdminDecideConsent,
  useAdminOverrideAge,
} from '@/features/safety/hooks/use-safety-mutations';
import type { GuardianConsent } from '@/features/safety/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr, inputToBirthDate } from '@/utils/date';
import { haptics } from '@/utils/haptics';

type ConsentFilter = 'pending' | 'verified' | 'rejected' | 'all';

const CONSENT_STATUS: Record<
  string,
  { label: string; tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  pending: { label: 'Bekliyor', tone: 'warning' },
  verified: { label: 'Onaylandı', tone: 'success' },
  rejected: { label: 'Reddedildi', tone: 'danger' },
  revoked: { label: 'Kaldırıldı', tone: 'neutral' },
  expired: { label: 'Süresi doldu', tone: 'neutral' },
};

export default function AdminAgeScreen() {
  const { theme } = useTheme();
  const [filter, setFilter] = useState<ConsentFilter>('pending');
  const [selected, setSelected] = useState<GuardianConsent | null>(null);
  const [note, setNote] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideUser, setOverrideUser] = useState('');
  const [overrideDate, setOverrideDate] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const overview = useAgeOverview();
  const consents = useGuardianConsents(filter);
  const decide = useAdminDecideConsent();
  const overrideAge = useAdminOverrideAge();

  const stats = overview.data;

  const submitDecision = (status: 'verified' | 'rejected' | 'revoked') => {
    if (!selected) {
      return;
    }
    decide.mutate(
      { consentId: selected.id, status, note: note.trim() || undefined },
      {
        onSuccess: () => {
          haptics.success();
          setSelected(null);
          setNote('');
        },
      },
    );
  };

  const submitOverride = () => {
    setOverrideError(null);
    const iso = inputToBirthDate(overrideDate);
    if (!iso) {
      setOverrideError('Geçerli bir tarih gir (GG.AA.YYYY).');
      return;
    }
    if (overrideUser.trim().length < 8) {
      setOverrideError('Kullanıcı kimliği (UUID) gir.');
      return;
    }
    overrideAge.mutate(
      { userId: overrideUser.trim(), birthDate: iso, note: note.trim() || undefined },
      {
        onSuccess: () => {
          haptics.success();
          setOverrideOpen(false);
          setOverrideUser('');
          setOverrideDate('');
          setNote('');
        },
        onError: (error) => setOverrideError(error.message),
      },
    );
  };

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Yaş ve veli onayı"
        subtitle="Yaş doğrulama durumu ve onay kuyruğu"
        onBack={undefined}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Yaş bilgisini manuel düzelt"
            onPress={() => setOverrideOpen(true)}
            style={[styles.iconButton, { backgroundColor: theme.colors.primarySoft }]}
          >
            <Ionicons name="create-outline" size={18} color={theme.colors.primaryDeep} />
          </Pressable>
        }
      />

      <View style={styles.statsGrid}>
        <StatCard label="Doğrulanan" value={stats?.total_assured ?? 0} icon="people-outline" />
        <StatCard
          label="18 yaş altı"
          value={stats?.children ?? 0}
          icon="shield-checkmark-outline"
          tone="primary"
        />
        <StatCard
          label="Bekleyen onay"
          value={stats?.pending_guardian ?? 0}
          icon="hourglass-outline"
          tone="warning"
        />
        <StatCard
          label="Onaylanan veli"
          value={stats?.verified_guardian ?? 0}
          icon="checkmark-circle-outline"
          tone="success"
        />
      </View>

      {stats && stats.awaiting_guardian_verification > 0 ? (
        <View
          style={[
            styles.alert,
            { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warning },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            {stats.awaiting_guardian_verification} hesap veli onayı bekliyor. Bu hesaplarda koruma
            ayarları zaten yürürlükte.
          </AppText>
        </View>
      ) : null}

      <View style={styles.filters}>
        {(
          [
            { key: 'pending' as ConsentFilter, label: 'Bekleyen' },
            { key: 'verified' as ConsentFilter, label: 'Onaylanan' },
            { key: 'rejected' as ConsentFilter, label: 'Reddedilen' },
            { key: 'all' as ConsentFilter, label: 'Tümü' },
          ]
        ).map((item) => {
          const active = filter === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(item.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                  borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {consents.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (consents.data ?? []).length === 0 ? (
        <SafetyEmptyState
          icon="people-outline"
          title="Bu filtrede onay talebi yok"
          body="Veli onay talepleri oluşturulduğunda burada listelenir."
        />
      ) : (
        <View style={styles.list}>
          {(consents.data ?? []).map((consent) => {
            const status = CONSENT_STATUS[consent.status] ?? {
              label: 'Bekliyor',
              tone: 'warning' as const,
            };
            return (
              <Pressable
                key={consent.id}
                accessibilityRole="button"
                accessibilityLabel={`${consent.user_name ?? consent.user_id} veli onayı`}
                onPress={() => {
                  setSelected(consent);
                  setNote('');
                }}
                style={({ pressed }) => [
                  styles.consent,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor:
                      consent.status === 'pending' ? theme.colors.warning : theme.colors.border,
                    borderRadius: theme.radius.md,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={styles.consentHead}>
                  <View style={[styles.consentIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="person-outline" size={17} color={theme.colors.primaryDeep} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {consent.user_name ?? consent.user_id.slice(0, 8)}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      Veli: {consent.guardian_email ?? '—'}
                      {consent.relation ? ` · ${consent.relation}` : ''}
                    </AppText>
                  </View>
                  <Badge label={status.label} tone={status.tone} />
                </View>

                <View style={styles.consentMeta}>
                  <AppText variant="caption" color="textSecondary">
                    Talep: {formatDateTimeTr(consent.requested_at)}
                  </AppText>
                  {consent.expires_at ? (
                    <AppText variant="caption" color="textTertiary">
                      Son geçerlilik: {formatDateTimeTr(consent.expires_at)}
                    </AppText>
                  ) : null}
                  <AppText variant="caption" color="textTertiary">
                    Yaş grubu: {consent.age_group ?? '—'} · Doğrulama:{' '}
                    {consent.age_verification ?? '—'}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <Card tone="muted" elevated={false} style={styles.noteCard}>
        <AppText variant="caption" color="textSecondary">
          Veli onayı, e-posta bağlantısı ile doğrulanır. Onay tamamlanana kadar hesap Çocuk Korumalı
          olarak kalır ve koruma ayarları gevşetilemez. Manuel doğrulama yalnızca belge ile teyit
          edildiğinde yapılmalıdır.
        </AppText>
      </Card>

      <SafetySheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title="Veli onayı"
        subtitle={selected?.user_name ?? selected?.user_id.slice(0, 8)}
        footer={
          selected?.status === 'pending' ? (
            <>
              <Button
                label="Onayla"
                loading={decide.isPending}
                onPress={() => submitDecision('verified')}
              />
              <Button
                label="Reddet"
                variant="danger"
                loading={decide.isPending}
                onPress={() => submitDecision('rejected')}
              />
            </>
          ) : undefined
        }
      >
        <AppText variant="body" color="textSecondary">
          Veli e-postası: {selected?.guardian_email ?? '—'}
          {selected?.guardian_name ? `\nVeli adı: ${selected.guardian_name}` : ''}
          {'\n'}Yöntem: {selected?.method ?? '—'}
        </AppText>

        {selected?.status === 'pending' ? (
          <TextField
            label="İç not"
            placeholder="Doğrulama yöntemi, belge referansı…"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            maxLength={500}
            textAlignVertical="top"
          />
        ) : null}
      </SafetySheet>

      <SafetySheet
        visible={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Yaş bilgisini düzelt"
        subtitle="Yalnızca doğrulanmış belge sonrası kullanın"
        footer={
          <Button
            label="Yaşı güncelle"
            loading={overrideAge.isPending}
            onPress={submitOverride}
          />
        }
      >
        <TextField
          label="Kullanıcı kimliği (UUID)"
          placeholder="00000000-0000-0000-0000-000000000000"
          value={overrideUser}
          onChangeText={setOverrideUser}
          autoCapitalize="none"
          autoCorrect={false}
          leftIcon="person-outline"
        />
        <TextField
          label="Doğum tarihi"
          placeholder="GG.AA.YYYY"
          value={overrideDate}
          onChangeText={setOverrideDate}
          keyboardType="numbers-and-punctuation"
          leftIcon="calendar-outline"
          error={overrideError}
        />
        <TextField
          label="Gerekçe"
          placeholder="Belge türü ve referansı"
          value={note}
          onChangeText={setNote}
          multiline
          numberOfLines={3}
          maxLength={500}
          textAlignVertical="top"
        />
        <AppText variant="caption" color="textTertiary">
          Değişiklik denetim kaydına yazılır ve kullanıcıya bilgilendirme gönderilir.
        </AppText>
      </SafetySheet>
    </Screen>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone?: 'neutral' | 'primary' | 'warning' | 'success';
}) {
  const { theme } = useTheme();
  const colors = {
    neutral: { background: theme.colors.surfaceMuted, color: theme.colors.textSecondary },
    primary: { background: theme.colors.primarySoft, color: theme.colors.primaryDeep },
    warning: { background: theme.colors.warningSoft, color: theme.colors.warning },
    success: { background: theme.colors.successSoft, color: theme.colors.success },
  }[tone];

  return (
    <View
      style={[
        styles.statCard,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={[styles.statIcon, { backgroundColor: colors.background }]}>
        <Ionicons name={icon} size={16} color={colors.color} />
      </View>
      <AppText variant="h3">{value}</AppText>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  statCard: {
    width: '48%',
    flexGrow: 1,
    padding: 13,
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
  },
  statIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 12,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  list: { gap: 9, marginTop: 14 },
  consent: { padding: 12, gap: 8, borderWidth: 1 },
  consentHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  consentIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  consentMeta: { gap: 2 },
  center: { alignItems: 'center', paddingVertical: 40 },
  noteCard: { marginTop: 16, padding: 12 },
});
