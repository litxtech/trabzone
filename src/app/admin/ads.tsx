import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button } from '@/components/ui';
import { AdminPage, AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminMe } from '@/features/admin/hooks/use-admin';
import { AdCampaignEditor } from '@/features/ads/admin/components/AdCampaignEditor';
import { useAdsGlobalSet, useAdsOverview } from '@/features/ads/admin/hooks';
import { CAMPAIGN_STATUS, formatCount, formatDateShort, formatMoneyCents } from '@/features/ads/admin/labels';
import { AdvertisersSection } from '@/features/ads/admin/sections/AdvertisersSection';
import { CampaignsSection } from '@/features/ads/admin/sections/CampaignsSection';
import {
  AnalyticsSection,
  AuditSection,
  DetailPagesSection,
  TargetingSection,
} from '@/features/ads/admin/sections/InsightsSections';
import { MediaSection } from '@/features/ads/admin/sections/MediaSection';
import { PlacementsSection } from '@/features/ads/admin/sections/PlacementsSection';
import { SettingsSection } from '@/features/ads/admin/sections/SettingsSection';
import { useTheme } from '@/theme/ThemeProvider';

type SectionKey =
  | 'placements'
  | 'campaigns'
  | 'advertisers'
  | 'media'
  | 'details'
  | 'targeting'
  | 'analytics'
  | 'settings'
  | 'audit';

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'placements', label: 'Yerleşimler' },
  { key: 'campaigns', label: 'Kampanyalar' },
  { key: 'advertisers', label: 'Reklamverenler' },
  { key: 'media', label: 'Medya Kütüphanesi' },
  { key: 'details', label: 'Detay Sayfaları' },
  { key: 'targeting', label: 'Hedefleme' },
  { key: 'analytics', label: 'Analitik' },
  { key: 'settings', label: 'Sistem Ayarları' },
  { key: 'audit', label: 'Denetim Kayıtları' },
];

export default function AdminAdsScreen() {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const me = useAdminMe();
  const permissions = me.data?.permissions ?? [];
  const canManage = permissions.includes('ads.manage');
  const canApprove = permissions.includes('ads.approve');
  const canSettings = permissions.includes('ads.settings');
  const overview = useAdsOverview();
  const globalSet = useAdsGlobalSet();
  const [section, setSection] = useState<SectionKey>('placements');
  const [editor, setEditor] = useState<{ id: string | null } | null>(null);
  const [globalTarget, setGlobalTarget] = useState<boolean | null>(null);
  const o = overview.data;
  const ctr = o && o.impressions_total > 0 ? ((o.clicks_total / o.impressions_total) * 100).toFixed(2) : '0';

  return (
    <AdminPage
      title="Reklam Kontrol Merkezi"
      subtitle="Doğrudan Trabzone kampanyaları, akış yerleşimleri ve reklam analitiği. Tüm reklamlar varsayılan olarak kapalıdır."
      refreshing={overview.isRefetching}
      onRefresh={() => void overview.refetch()}
      actions={
        <View style={styles.headerActions}>
          {canSettings && o ? (
            <Button
              label={o.ads_enabled ? 'Tüm Reklamları Kapat' : 'Reklamları Aç'}
              size="sm"
              variant={o.ads_enabled ? 'danger' : 'secondary'}
              fullWidth={false}
              leftIcon={
                <Ionicons
                  name={o.ads_enabled ? 'power' : 'play-circle-outline'}
                  size={15}
                  color={o.ads_enabled ? theme.colors.onPrimary : theme.colors.text}
                />
              }
              onPress={() => setGlobalTarget(!o.ads_enabled)}
            />
          ) : null}
          {canManage ? (
            <Button
              label="Yeni Reklam Oluştur"
              size="sm"
              fullWidth={false}
              leftIcon={<Ionicons name="add" size={15} color={theme.colors.onPrimary} />}
              onPress={() => setEditor({ id: null })}
            />
          ) : null}
        </View>
      }
    >
      {o ? (
        <View
          style={[
            styles.globalBanner,
            {
              backgroundColor: o.ads_enabled ? theme.colors.successSoft : theme.colors.surfaceMuted,
              borderColor: o.ads_enabled ? theme.colors.success : theme.colors.border,
            },
          ]}
        >
          <Ionicons
            name={o.ads_enabled ? 'radio-button-on' : 'pause-circle-outline'}
            size={18}
            color={o.ads_enabled ? theme.colors.success : theme.colors.textSecondary}
          />
          <AppText variant="bodyStrong" style={styles.flex}>
            {o.ads_enabled
              ? `Reklam gösterimi açık · ${o.placements_enabled}/${o.placements_total} yerleşim etkin`
              : 'Tüm reklamlar kapalı. Kullanıcılar hiçbir reklam görmez; yerleşim ve kampanyalar hazırlanabilir.'}
          </AppText>
          {o.admob_enabled ? <Badge label="AdMob yedeği açık" tone="accent" /> : null}
        </View>
      ) : null}

      <StatGrid>
        <StatCard label="Aktif reklam" value={formatCount(o?.active_ads)} icon="megaphone-outline" hint="Açık yerleşimde yayında" />
        <StatCard
          label="Bugünkü gösterim"
          value={formatCount(o?.impressions_today)}
          icon="eye-outline"
          hint={`Toplam ${formatCount(o?.impressions_total)}`}
        />
        <StatCard
          label="Bugünkü tıklama"
          value={formatCount(o?.clicks_today)}
          icon="hand-left-outline"
          tone="accent"
          hint={`Toplam ${formatCount(o?.clicks_total)}`}
        />
        <StatCard label="TO (CTR)" value={`%${ctr}`} icon="trending-up-outline" tone="success" hint="Tüm zamanlar" />
        <StatCard
          label="Aktif kampanya"
          value={formatCount(o?.active_campaigns)}
          icon="rocket-outline"
          hint={`${formatCount(o?.scheduled_campaigns)} planlı`}
        />
        <StatCard
          label="İnceleme bekleyen"
          value={formatCount(o?.pending_review)}
          icon="hourglass-outline"
          tone={o?.pending_review ? 'warning' : 'primary'}
        />
        <StatCard label="Reklam geliri" value={formatMoneyCents(o?.revenue_cents)} icon="cash-outline" hint="Doğrudan kampanyalar" />
        <StatCard
          label="Güvenlik sinyali"
          value={formatCount(o?.invalid_events_24h)}
          icon="shield-outline"
          tone={o?.invalid_events_24h ? 'warning' : 'primary'}
          hint={`24 saat geçersiz olay · ${formatCount(o?.reports_7d)} bildirim (7 gün)`}
        />
      </StatGrid>

      {o?.upcoming_ends.length ? (
        <AdminSection title="Yakında bitecek kampanyalar" subtitle="Önümüzdeki 7 gün">
          {o.upcoming_ends.map((item) => (
            <View key={item.id} style={styles.upcoming}>
              <AppText variant="body" style={styles.flex} numberOfLines={1}>
                {item.name}
              </AppText>
              <Badge label={CAMPAIGN_STATUS[item.status].label} tone={CAMPAIGN_STATUS[item.status].tone} />
              <AppText variant="caption" color="textTertiary">
                {formatDateShort(item.ends_at)}
              </AppText>
            </View>
          ))}
        </AdminSection>
      ) : null}

      <FilterChips options={SECTIONS} value={section} onChange={setSection} />

      {section === 'placements' ? <PlacementsSection canManage={canManage} /> : null}
      {section === 'campaigns' ? (
        <CampaignsSection canManage={canManage} canApprove={canApprove} onEdit={(id) => setEditor({ id })} />
      ) : null}
      {section === 'advertisers' ? <AdvertisersSection canManage={canManage} /> : null}
      {section === 'media' ? <MediaSection canManage={canManage} /> : null}
      {section === 'details' ? <DetailPagesSection onEdit={(id) => setEditor({ id })} /> : null}
      {section === 'targeting' ? <TargetingSection /> : null}
      {section === 'analytics' ? <AnalyticsSection /> : null}
      {section === 'settings' ? <SettingsSection canEdit={canSettings} /> : null}
      {section === 'audit' ? <AuditSection /> : null}

      <AdCampaignEditor
        visible={editor != null}
        campaignId={editor?.id ?? null}
        canManage={canManage}
        onClose={() => setEditor(null)}
        onSaved={(message) => {
          toast.success(message);
          setEditor(null);
        }}
      />

      <ReasonDialog
        visible={globalTarget != null}
        title={globalTarget ? 'Reklam gösterimini aç' : 'Tüm reklamları kapat'}
        description={
          globalTarget
            ? 'Reklamlar yalnızca açık yerleşimlerde ve onaylı, yayın tarihindeki kampanyalarla gösterilir. Bu işlem kritik olarak denetim kaydına yazılır.'
            : 'Tüm yerleşimlerde reklam gösterimi anında durur. Kampanya ve yerleşim ayarları korunur.'
        }
        confirmLabel={globalTarget ? 'Aç' : 'Tümünü kapat'}
        destructive={!globalTarget}
        loading={globalSet.isPending}
        onCancel={() => setGlobalTarget(null)}
        onConfirm={async ({ reason }) => {
          if (globalTarget == null) return;
          try {
            await globalSet.mutateAsync({ enabled: globalTarget, reason });
            toast.success(globalTarget ? 'Reklam gösterimi açıldı.' : 'Tüm reklamlar kapatıldı.');
            setGlobalTarget(null);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
          }
        }}
      />
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  globalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  upcoming: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
});
