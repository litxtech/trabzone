import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminPage, AdminSection, AdminToolbar, FilterChips } from '@/features/admin/components/AdminPage';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminMe,
  useApprovalDecide,
  useFeatureFlags,
  useFeatureFlagSet,
} from '@/features/admin/hooks/use-admin';
import type { ApprovalRequest, FeatureFlag } from '@/features/admin/types';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTimeTr } from '@/utils/date';

export default function AdminFeaturesScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const flags = useFeatureFlags();
  const setFlag = useFeatureFlagSet();
  const decide = useApprovalDecide();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [pendingFlag, setPendingFlag] = useState<FeatureFlag | null>(null);
  const [decision, setDecision] = useState<{ approval: ApprovalRequest; approve: boolean } | null>(null);

  const permissions = me.data?.permissions ?? [];
  const canManage = permissions.includes('feature.manage');
  const canApprove = permissions.includes('admin.manage');

  const categories = useMemo(
    () => Array.from(new Set((flags.data?.items ?? []).map((flag) => flag.category))).sort(),
    [flags.data],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr-TR');
    return (flags.data?.items ?? []).filter((flag) => {
      if (category !== 'all' && flag.category !== category) return false;
      if (!term) return true;
      return (
        flag.key.toLocaleLowerCase('tr-TR').includes(term) ||
        flag.label.toLocaleLowerCase('tr-TR').includes(term) ||
        (flag.description ?? '').toLocaleLowerCase('tr-TR').includes(term)
      );
    });
  }, [flags.data, search, category]);

  const enabledCount = (flags.data?.items ?? []).filter((flag) => flag.enabled).length;
  const criticalCount = (flags.data?.items ?? []).filter((flag) => flag.critical).length;
  const pendingCount = flags.data?.pending_approvals.length ?? 0;

  return (
    <AdminPage
      title="Özellik Kontrol Merkezi"
      subtitle="Sunucu taraflı feature flag yönetimi; kritik değişiklikler ikinci yönetici onayı gerektirir."
      refreshing={flags.isRefetching}
      onRefresh={() => void flags.refetch()}
      actions={<Badge label={canManage ? 'feature.manage' : 'Salt okunur'} tone={canManage ? 'accent' : 'neutral'} />}
    >
      <StatGrid>
        <StatCard label="Açık özellik" value={String(enabledCount)} icon="toggle-outline" tone="success" hint={`${flags.data?.items.length ?? 0} toplam anahtar`} />
        <StatCard label="Kritik anahtar" value={String(criticalCount)} icon="lock-closed-outline" tone="danger" hint="İkinci onay gerekir" />
        <StatCard label="Onay bekleyen" value={String(pendingCount)} icon="checkmark-done-outline" tone={pendingCount ? 'warning' : 'primary'} hint="Süper admin kararı" />
      </StatGrid>

      <AdminSection title="Özellik anahtarları" subtitle="Her anahtar belgelenmiş ve denetlenebilir olmalıdır.">
        <AdminToolbar>
          <View style={{ flexGrow: 1, flexBasis: 260, minWidth: 220 }}>
            <TextField
              placeholder="Anahtar, ad veya açıklama ara…"
              value={search}
              onChangeText={setSearch}
              leftIcon="search-outline"
              autoCapitalize="none"
            />
          </View>
        </AdminToolbar>
        <FilterChips
          options={[
            { key: 'all', label: 'Tüm kategoriler' },
            ...categories.map((item) => ({ key: item, label: item })),
          ]}
          value={category}
          onChange={setCategory}
        />

        {visible.map((flag) => (
          <View
            key={flag.key}
            style={[
              styles.flagRow,
              {
                borderColor: flag.critical ? theme.colors.warning : theme.colors.divider,
                backgroundColor: flag.critical ? theme.colors.warningSoft : 'transparent',
              },
            ]}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <View style={styles.flagTitleRow}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {flag.label}
                </AppText>
                {flag.critical ? <Badge label="kritik" tone="warning" /> : null}
                <Badge label={flag.category} tone="neutral" />
                {flag.is_public ? <Badge label="genel" tone="accent" /> : null}
              </View>
              <AppText variant="caption" color="textTertiary" style={{ fontFamily: 'monospace' }}>
                {flag.key}
              </AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                {flag.description ?? 'Açıklama yok.'}
              </AppText>
              {flag.rollout_note ? (
                <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                  Not: {flag.rollout_note}
                </AppText>
              ) : null}
              <AppText variant="caption" color="textTertiary">
                {formatDateTimeTr(flag.updated_at)} · {flag.updated_by_name ?? 'Sistem'}
              </AppText>
            </View>

            <View style={{ alignItems: 'flex-end', gap: 5 }}>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: flag.enabled, disabled: !canManage }}
                disabled={!canManage || setFlag.isPending}
                onPress={() => setPendingFlag(flag)}
                style={[
                  styles.switchTrack,
                  { backgroundColor: flag.enabled ? theme.colors.success : theme.colors.borderStrong },
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    {
                      backgroundColor: '#FFFFFF',
                      alignSelf: flag.enabled ? 'flex-end' : 'flex-start',
                    },
                  ]}
                />
              </Pressable>
              <AppText variant="caption" color={flag.enabled ? 'success' : 'textTertiary'}>
                {flag.enabled ? 'Açık' : 'Kapalı'}
              </AppText>
            </View>
          </View>
        ))}
      </AdminSection>

      <AdminSection
        title="Onay bekleyen değişiklikler"
        subtitle="Kritik feature flag değişiklikleri süper admin onayı olmadan uygulanmaz."
        action={<Badge label={`${pendingCount} bekliyor`} tone={pendingCount ? 'warning' : 'neutral'} />}
      >
        {(flags.data?.pending_approvals ?? []).length === 0 ? (
          <View style={styles.emptyApprovals}>
            <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.success} />
            <AppText variant="caption" color="textSecondary">
              Onay bekleyen değişiklik yok.
            </AppText>
          </View>
        ) : (
          flags.data?.pending_approvals.map((approval) => (
            <View key={approval.id} style={[styles.approvalRow, { borderColor: theme.colors.divider }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="caption" style={{ fontWeight: '700' }}>
                  {String(approval.payload.key ?? approval.target_id)} → {String(approval.payload.enabled) === 'true' ? 'aç' : 'kapat'}
                </AppText>
                <AppText variant="caption" color="textSecondary" numberOfLines={2}>
                  {approval.reason}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {approval.requested_by_name ?? '—'} · {formatDateTimeTr(approval.created_at)}
                </AppText>
              </View>
              {canApprove ? (
                <View style={{ flexDirection: 'row', gap: 5 }}>
                  <Button label="Onayla" size="sm" variant="primary" fullWidth={false} onPress={() => setDecision({ approval, approve: true })} />
                  <Button label="Reddet" size="sm" variant="outline" fullWidth={false} onPress={() => setDecision({ approval, approve: false })} />
                </View>
              ) : (
                <Badge label="Süper admin onayı" tone="neutral" />
              )}
            </View>
          ))
        )}
        <AppText variant="caption" color="textTertiary">
          İkinci onay kuralı: değişikliği talep eden yönetici kendi talebini onaylayamaz. Karar
          gerekçesi ve önceki/sonraki değer denetim kaydında saklanır.
        </AppText>
      </AdminSection>

      <ReasonDialog
        visible={Boolean(pendingFlag)}
        title={pendingFlag?.enabled ? 'Özelliği kapat' : 'Özelliği aç'}
        description={
          pendingFlag?.critical
            ? 'Kritik anahtar: süper admin değilseniz değişiklik onaya gönderilir.'
            : 'Değişiklik canlı kullanıcıları etkiler.'
        }
        confirmLabel={pendingFlag?.critical ? 'Onaya gönder' : 'Uygula'}
        destructive={Boolean(pendingFlag?.enabled)}
        loading={setFlag.isPending}
        onCancel={() => setPendingFlag(null)}
        onConfirm={async ({ reason }) => {
          if (!pendingFlag) return;
          try {
            const result = (await setFlag.mutateAsync({
              key: pendingFlag.key,
              enabled: !pendingFlag.enabled,
              reason,
            })) as { status?: string } | null;
            setPendingFlag(null);
            void flags.refetch();
            if (result?.status === 'pending_approval') {
              toast.info('Değişiklik ikinci yönetici onayına gönderildi.');
            } else {
              toast.success('Özellik durumu güncellendi.');
            }
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Özellik güncellenemedi.');
          }
        }}
      />

      <ReasonDialog
        visible={Boolean(decision)}
        title={decision?.approve ? 'Değişikliği onayla' : 'Değişikliği reddet'}
        description="Karar gerekçesi denetim kaydına yazılır."
        confirmLabel={decision?.approve ? 'Onayla' : 'Reddet'}
        destructive={!decision?.approve}
        loading={decide.isPending}
        onCancel={() => setDecision(null)}
        onConfirm={async ({ reason }) => {
          if (!decision) return;
          try {
            await decide.mutateAsync({ approvalId: decision.approval.id, approve: decision.approve, reason });
            setDecision(null);
            toast.success(decision.approve ? 'Değişiklik onaylandı.' : 'Talep reddedildi.');
            void flags.refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Karar uygulanamadı.');
          }
        }}
      />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flagRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexWrap: 'wrap',
  },
  flagTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  switchTrack: {
    width: 40,
    height: 22,
    borderRadius: 11,
    padding: 2,
    justifyContent: 'center',
  },
  switchThumb: { width: 18, height: 18, borderRadius: 9 },
  emptyApprovals: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 16 },
  approvalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
});
