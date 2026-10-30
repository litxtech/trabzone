import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppImage, AppText, Badge, Button, IconButton } from '@/components/ui';
import { AdminSection, AdminToolbar, FilterChips, Pager } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { HorizontalBars, TrendChart } from '@/features/admin/components/Charts';
import { DataTable, type Column } from '@/features/admin/components/DataTable';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import {
  useAdCampaign,
  useAdCampaignAnalytics,
  useAdCampaignTransition,
  useAdCampaigns,
  useAdReportGenerate,
} from '../hooks';
import { CAMPAIGN_STATUS, formatCount, formatDateShort, formatMoneyCents } from '../labels';
import { adIssueLabel } from '../service';
import type { AdCampaignListItem, AdCampaignStatus, AdTransition } from '../types';

const ACTIONS: Record<AdTransition, { label: string; destructive?: boolean; reason: 'required' | 'optional' }> = {
  submit: { label: 'İncelemeye gönder', reason: 'optional' },
  approve: { label: 'Onayla', reason: 'optional' },
  reject: { label: 'Reddet', destructive: true, reason: 'required' },
  pause: { label: 'Duraklat', reason: 'optional' },
  resume: { label: 'Devam ettir', reason: 'optional' },
  archive: { label: 'Arşivle', destructive: true, reason: 'optional' },
  to_draft: { label: 'Taslağa al', reason: 'optional' },
};

function actionsFor(status: AdCampaignStatus, canManage: boolean, canApprove: boolean): AdTransition[] {
  const list: AdTransition[] = [];
  if (canManage && ['draft', 'rejected'].includes(status)) list.push('submit');
  if (canApprove && status === 'pending_review') list.push('approve', 'reject');
  if (canManage && ['scheduled', 'active'].includes(status)) list.push('pause');
  if (canManage && status === 'paused') list.push('resume');
  if (canManage && ['rejected', 'pending_review'].includes(status)) list.push('to_draft');
  if (canManage && !['active', 'scheduled', 'archived'].includes(status)) list.push('archive');
  return list;
}

export function CampaignsSection({
  canManage,
  canApprove,
  onEdit,
}: {
  canManage: boolean;
  canApprove: boolean;
  onEdit: (id: string | null) => void;
}) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const campaigns = useAdCampaigns(status || null, search, offset);
  const counts = campaigns.data?.counts ?? {};

  const columns: Column<AdCampaignListItem>[] = [
    {
      key: 'campaign',
      label: 'Kampanya',
      width: 2.6,
      render: (row) => (
        <View style={styles.campaignCell}>
          <View style={[styles.thumb, { backgroundColor: theme.colors.surfaceMuted }]}>
            {row.image_url ? <AppImage source={{ uri: row.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          </View>
          <View style={styles.flex}>
            <AppText variant="caption" style={styles.bold} numberOfLines={1}>
              {row.name}
            </AppText>
            <AppText variant="caption" color="textTertiary" numberOfLines={1}>
              {row.advertiser_name} · {row.title ?? 'Başlık yok'}
            </AppText>
            {row.destination_valid === false ? (
              <AppText variant="caption" color="danger" numberOfLines={1}>
                {adIssueLabel(`destination_${row.destination_reason}`)}
              </AppText>
            ) : null}
          </View>
        </View>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      width: 1,
      render: (row) => <Badge label={CAMPAIGN_STATUS[row.status].label} tone={CAMPAIGN_STATUS[row.status].tone} />,
    },
    {
      key: 'perf',
      label: 'Performans',
      width: 1.2,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textSecondary">
          {formatCount(row.impressions)} gösterim · {formatCount(row.clicks)} tık · %{row.ctr}
        </AppText>
      ),
    },
    {
      key: 'dates',
      label: 'Yayın',
      width: 1.2,
      hideOnMobile: true,
      render: (row) => (
        <AppText variant="caption" color="textTertiary">
          {formatDateShort(row.starts_at)} → {formatDateShort(row.ends_at)}
        </AppText>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: 1,
      render: (row) => (
        <View style={styles.rowActions}>
          <Button label="Detay" size="sm" variant="ghost" fullWidth={false} onPress={() => setDetailId(row.id)} />
          {canManage && !['expired', 'archived'].includes(row.status) ? (
            <Button label="Düzenle" size="sm" variant="ghost" fullWidth={false} onPress={() => onEdit(row.id)} />
          ) : null}
        </View>
      ),
    },
  ];

  return (
    <AdminSection
      title="Kampanyalar"
      subtitle="Durumlar: Taslak → İnceleme bekliyor → Planlandı/Aktif. Bitiş, bütçe ve gösterim sınırı sunucuda dakikada bir uygulanır."
    >
      <AdminToolbar>
        <View style={[styles.searchWrap, { borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground }]}>
          <Ionicons name="search" size={15} color={theme.colors.textTertiary} />
          <TextInput
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            placeholder="Kampanya veya reklamveren ara…"
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.searchInput, { color: theme.colors.text }]}
          />
        </View>
      </AdminToolbar>
      <FilterChips
        options={[
          { key: '', label: 'Tümü' },
          ...(Object.keys(CAMPAIGN_STATUS) as AdCampaignStatus[]).map((key) => ({
            key,
            label: CAMPAIGN_STATUS[key].label,
            count: counts[key] ?? 0,
          })),
        ]}
        value={status}
        onChange={(value) => {
          setStatus(value);
          setOffset(0);
        }}
      />
      <DataTable
        columns={columns}
        rows={campaigns.data?.items ?? []}
        keyExtractor={(row) => row.id}
        loading={campaigns.isLoading}
        empty={
          <View style={[styles.empty, { borderColor: theme.colors.border }]}>
            <Ionicons name="megaphone-outline" size={22} color={theme.colors.textTertiary} />
            <AppText variant="body" color="textSecondary">
              Kampanya bulunamadı.
            </AppText>
          </View>
        }
      />
      {campaigns.data ? (
        <Pager total={campaigns.data.total} limit={campaigns.data.limit} offset={campaigns.data.offset} onChange={setOffset} />
      ) : null}

      <CampaignDetail
        id={detailId}
        canManage={canManage}
        canApprove={canApprove}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          onEdit(id);
        }}
      />
    </AdminSection>
  );
}

function CampaignDetail({
  id,
  canManage,
  canApprove,
  onClose,
  onEdit,
}: {
  id: string | null;
  canManage: boolean;
  canApprove: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const router = useRouter();
  const [days, setDays] = useState(30);
  const campaign = useAdCampaign(id);
  const analytics = useAdCampaignAnalytics(id, days);
  const transition = useAdCampaignTransition();
  const report = useAdReportGenerate();
  const [pending, setPending] = useState<AdTransition | null>(null);
  const c = campaign.data;
  const sensitive = c ? ['health_service', 'finance'].includes(c.policy_category) : false;

  return (
    <Modal visible={id != null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Kapat" style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]} onPress={onClose} />
        <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={[styles.panelHead, { borderColor: theme.colors.divider }]}>
            <View style={styles.flex}>
              <AppText variant="h3" numberOfLines={1}>
                {c?.name ?? 'Kampanya'}
              </AppText>
              {c ? (
                <View style={styles.badges}>
                  <Badge label={CAMPAIGN_STATUS[c.status].label} tone={CAMPAIGN_STATUS[c.status].tone} />
                  <AppText variant="caption" color="textTertiary">
                    {c.advertiser?.name} · öncelik {c.priority} · {formatDateShort(c.starts_at)} → {formatDateShort(c.ends_at)}
                  </AppText>
                </View>
              ) : null}
            </View>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.detailBody}>
            {!c ? (
              <AppText variant="body" color="textSecondary">
                {campaign.isError ? 'Kampanya yüklenemedi.' : 'Yükleniyor…'}
              </AppText>
            ) : (
              <>
                <View style={styles.rowActions}>
                  {actionsFor(c.status, canManage, canApprove).map((action) => (
                    <Button
                      key={action}
                      label={ACTIONS[action].label}
                      size="sm"
                      variant={ACTIONS[action].destructive ? 'danger' : action === 'approve' ? 'primary' : 'secondary'}
                      fullWidth={false}
                      onPress={() => setPending(action)}
                    />
                  ))}
                  {canManage && !['expired', 'archived'].includes(c.status) ? (
                    <Button label="Düzenle" size="sm" variant="outline" fullWidth={false} onPress={() => onEdit(c.id)} />
                  ) : null}
                  <Button
                    label="Detay sayfasını önizle"
                    size="sm"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => router.push(`/ad/${c.id}` as never)}
                  />
                  <Button
                    label="Rapor oluştur"
                    size="sm"
                    variant="ghost"
                    fullWidth={false}
                    loading={report.isPending}
                    onPress={async () => {
                      try {
                        await report.mutateAsync(c.id);
                        toast.success('Reklamveren raporu oluşturuldu.');
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : 'Rapor oluşturulamadı.');
                      }
                    }}
                  />
                </View>

                {c.issues.length ? (
                  <View style={[styles.notice, { backgroundColor: theme.colors.warningSoft }]}>
                    <AppText variant="label" color="warning">
                      Yayın engelleri
                    </AppText>
                    {c.issues.map((issue) => (
                      <AppText key={issue} variant="caption" color="warning">
                        • {adIssueLabel(issue)}
                      </AppText>
                    ))}
                  </View>
                ) : null}
                {c.rejection_reason ? (
                  <AppText variant="caption" color="danger">
                    Ret gerekçesi: {c.rejection_reason}
                  </AppText>
                ) : null}

                <StatGrid>
                  <StatCard label="Gösterim" value={formatCount(c.metrics.impressions)} icon="eye-outline" />
                  <StatCard label="Tıklama" value={formatCount(c.metrics.clicks)} icon="hand-left-outline" tone="accent" />
                  <StatCard label="TO (CTR)" value={`%${c.metrics.ctr}`} icon="trending-up-outline" tone="success" />
                  <StatCard label="Tekil erişim" value={formatCount(c.metrics.reach)} icon="people-outline" />
                  <StatCard
                    label="Harcama"
                    value={formatMoneyCents(c.metrics.spend_cents)}
                    icon="cash-outline"
                    hint={c.budget_cents ? `Bütçe ${formatMoneyCents(c.budget_cents)}` : 'Bütçe sınırı yok'}
                  />
                  <StatCard
                    label="Geçersiz olay"
                    value={formatCount(c.metrics.invalid_events)}
                    icon="shield-outline"
                    tone={c.metrics.invalid_events ? 'warning' : 'primary'}
                    hint={`${c.metrics.hides} gizleme · ${c.metrics.reports} bildirim`}
                  />
                </StatGrid>

                <FilterChips
                  options={[
                    { key: '7', label: '7 gün' },
                    { key: '30', label: '30 gün' },
                    { key: '90', label: '90 gün' },
                  ]}
                  value={String(days)}
                  onChange={(value) => setDays(Number(value))}
                />
                {analytics.data ? (
                  <>
                    <AppText variant="title">Günlük gösterim</AppText>
                    <TrendChart data={analytics.data.daily.map((item) => ({ label: item.day.slice(5), value: item.impressions }))} />
                    <AppText variant="title">Günlük tıklama</AppText>
                    <TrendChart
                      color={theme.colors.accent}
                      data={analytics.data.daily.map((item) => ({ label: item.day.slice(5), value: item.clicks }))}
                    />
                    <View style={styles.twoCol}>
                      <View style={styles.col}>
                        <AppText variant="title">Yerleşime göre</AppText>
                        <HorizontalBars
                          data={analytics.data.by_placement.map((item) => ({ label: item.label ?? item.placement, value: item.impressions }))}
                        />
                      </View>
                      <View style={styles.col}>
                        <AppText variant="title">İlçeye göre</AppText>
                        <HorizontalBars data={analytics.data.by_district.map((item) => ({ label: item.district, value: item.impressions }))} />
                      </View>
                      <View style={styles.col}>
                        <AppText variant="title">Platforma göre</AppText>
                        <HorizontalBars data={analytics.data.by_platform.map((item) => ({ label: item.platform, value: item.impressions }))} />
                      </View>
                      <View style={styles.col}>
                        <AppText variant="title">Haftalık / aylık</AppText>
                        {analytics.data.weekly.slice(-6).map((item) => (
                          <AppText key={item.week} variant="caption" color="textSecondary">
                            Hafta {item.week}: {formatCount(item.impressions)} gösterim · {formatCount(item.clicks)} tık
                          </AppText>
                        ))}
                        {analytics.data.monthly.map((item) => (
                          <AppText key={item.month} variant="caption" color="textSecondary">
                            Ay {item.month.slice(0, 7)}: {formatCount(item.impressions)} gösterim · {formatCount(item.clicks)} tık
                          </AppText>
                        ))}
                      </View>
                    </View>
                    {analytics.data.invalid_by_reason.length ? (
                      <>
                        <AppText variant="title">Reddedilen olaylar (bot / hız / görünürlük)</AppText>
                        {analytics.data.invalid_by_reason.map((item) => (
                          <AppText key={`${item.kind}-${item.reason}`} variant="caption" color="textSecondary">
                            {item.kind} · {item.reason}: {formatCount(item.count)}
                          </AppText>
                        ))}
                      </>
                    ) : null}
                    {analytics.data.reports.length ? (
                      <>
                        <AppText variant="title">Reklamveren raporları</AppText>
                        {analytics.data.reports.map((item) => (
                          <AppText key={item.id} variant="caption" color="textSecondary">
                            {formatDateShort(item.generated_at)} · {item.kind === 'campaign_end' ? 'Kampanya sonu' : 'Manuel'} ·{' '}
                            {formatCount(item.metrics.impressions)} gösterim · {formatCount(item.metrics.clicks)} tık · %{item.metrics.ctr}
                          </AppText>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}

                {c.feedback.length ? (
                  <>
                    <AppText variant="title">Kullanıcı bildirimleri</AppText>
                    {c.feedback.map((item, index) => (
                      <AppText key={`${item.created_at}-${index}`} variant="caption" color="textSecondary">
                        {formatDateShort(item.created_at)} · {item.reason ?? 'neden belirtilmedi'}
                        {item.details ? ` — ${item.details}` : ''}
                      </AppText>
                    ))}
                  </>
                ) : null}

                <AppText variant="title">Durum geçmişi</AppText>
                {c.history.map((item, index) => (
                  <AppText key={`${item.at}-${index}`} variant="caption" color="textSecondary">
                    {formatDateShort(item.at)} · {item.label} · {item.actor ?? 'sistem'}
                    {typeof item.meta?.reason === 'string' && item.meta.reason ? ` — ${item.meta.reason}` : ''}
                  </AppText>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </View>

      <ReasonDialog
        visible={pending != null}
        title={pending ? ACTIONS[pending].label : ''}
        description={
          pending === 'approve' && sensitive
            ? 'Sağlık ve finans reklamlarında en az 10 karakterlik inceleme notu zorunludur.'
            : pending === 'approve'
              ? 'Onaylanan kampanya başlangıç saatinde otomatik yayına girer.'
              : 'İşlem denetim kaydına yazılır.'
        }
        requireReason={pending ? ACTIONS[pending].reason === 'required' || (pending === 'approve' && sensitive) : false}
        destructive={pending ? Boolean(ACTIONS[pending].destructive) : false}
        loading={transition.isPending}
        onCancel={() => setPending(null)}
        onConfirm={async ({ reason }) => {
          if (!pending || !c) return;
          try {
            await transition.mutateAsync({ id: c.id, action: pending, reason: reason || null });
            setPending(null);
            toast.success('Kampanya durumu güncellendi.');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
          }
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '700' },
  campaignCell: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  thumb: { width: 54, height: 20 + 16, borderRadius: 8, overflow: 'hidden' },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  searchWrap: {
    flexGrow: 1,
    flexBasis: 260,
    height: 38,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    minWidth: 220,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 6, outlineStyle: 'none' } as never,
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  panel: { width: '100%', maxWidth: 1100, height: '92%', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  panelHead: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  detailBody: { padding: 16, gap: 12 },
  notice: { padding: 10, borderRadius: 10, gap: 3 },
  twoCol: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  col: { flexGrow: 1, flexBasis: 300, gap: 8 },
});
