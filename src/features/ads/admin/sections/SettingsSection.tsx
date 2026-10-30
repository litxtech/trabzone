import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AdminSection } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { ToggleRow } from '@/features/admin/components/news-api/shared';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useTheme } from '@/theme/ThemeProvider';

import { useAdRuleUpdate, useAdsSettings, useAdsSettingsUpdate } from '../hooks';
import { PROHIBITED_CATEGORIES } from '../labels';
import type { AdRule, AdSettings } from '../types';

type Draft = {
  directEnabled: boolean;
  admobEnabled: boolean;
  iosAppId: string;
  androidAppId: string;
  units: string;
  allowlist: string;
  hideDays: string;
  clickRate: string;
  impressionRate: string;
  minViewMs: string;
  minRatio: string;
  ttl: string;
  reportThreshold: string;
  policy: string;
};

function toDraft(s: AdSettings): Draft {
  return {
    directEnabled: s.direct_enabled,
    admobEnabled: s.admob_enabled,
    iosAppId: s.admob_config.ios_app_id ?? '',
    androidAppId: s.admob_config.android_app_id ?? '',
    units: JSON.stringify(s.admob_config.units ?? {}, null, 2),
    allowlist: s.external_domain_allowlist.join(', '),
    hideDays: String(s.hide_duration_days),
    clickRate: String(s.click_rate_limit_per_minute),
    impressionRate: String(s.impression_rate_limit_per_minute),
    minViewMs: String(s.min_view_ms),
    minRatio: String(s.min_visible_ratio),
    ttl: String(s.serve_ttl_minutes),
    reportThreshold: String(s.auto_pause_report_threshold),
    policy: s.policy_text ?? '',
  };
}

export function SettingsSection({ canEdit }: { canEdit: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const settings = useAdsSettings();
  const update = useAdsSettingsUpdate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [patch, setPatch] = useState<Partial<AdSettings> | null>(null);
  const s = settings.data?.settings;
  if (s && s.updated_at !== loadedAt) {
    setLoadedAt(s.updated_at);
    setDraft(toDraft(s));
  }
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const buildPatch = (): Partial<AdSettings> | null => {
    if (!draft) return null;
    let units: Record<string, unknown> = {};
    try {
      units = draft.units.trim() ? (JSON.parse(draft.units) as Record<string, unknown>) : {};
    } catch {
      toast.error('Reklam birimi eşlemesi geçerli JSON olmalı.');
      return null;
    }
    const int = (text: string) => Number.parseInt(text, 10);
    return {
      direct_enabled: draft.directEnabled,
      admob_enabled: draft.admobEnabled,
      admob_config: {
        ...(draft.iosAppId.trim() ? { ios_app_id: draft.iosAppId.trim() } : {}),
        ...(draft.androidAppId.trim() ? { android_app_id: draft.androidAppId.trim() } : {}),
        units: units as AdSettings['admob_config']['units'],
      },
      external_domain_allowlist: draft.allowlist
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
      hide_duration_days: int(draft.hideDays),
      click_rate_limit_per_minute: int(draft.clickRate),
      impression_rate_limit_per_minute: int(draft.impressionRate),
      min_view_ms: int(draft.minViewMs),
      min_visible_ratio: Number.parseFloat(draft.minRatio.replace(',', '.')),
      serve_ttl_minutes: int(draft.ttl),
      auto_pause_report_threshold: int(draft.reportThreshold),
      policy_text: draft.policy,
    };
  };

  return (
    <>
      <AdminSection
        title="Sistem ayarları"
        subtitle="Değerler sunucuda güvenli aralığa sıkıştırılır. Gösterim için en az %50 görünürlük ve 1 saniye altına inilemez."
      >
        {!draft ? (
          <AppText variant="body" color="textSecondary">
            Yükleniyor…
          </AppText>
        ) : (
          <View style={styles.form}>
            <ToggleRow
              title="Doğrudan (Trabzone) kampanyalar"
              description="Kapalıysa yalnızca yapılandırılmış sağlayıcı reklamları sunulabilir."
              value={draft.directEnabled}
              disabled={!canEdit}
              onValueChange={(v) => set('directEnabled', v)}
            />
            <View style={[styles.box, { borderColor: theme.colors.border }]}>
              <AppText variant="title">Google AdMob (hazırlık)</AppText>
              <AppText variant="caption" color="textTertiary">
                Uygulama paketine Google Mobile Ads SDK eklenip yerel derleme alınmadan ve gerçek kimlikler girilmeden canlı
                AdMob gösterimi yapılmaz. SDK etiket, AdChoices ve tıklamayı kendisi yönetir; rıza (UMP/ATT) akışı zorunludur.
              </AppText>
              <ToggleRow
                title="AdMob yedeğini etkinleştir"
                description="Uygulama kimliği olmadan sunucu açmaya izin vermez."
                value={draft.admobEnabled}
                disabled={!canEdit}
                onValueChange={(v) => set('admobEnabled', v)}
              />
              <View style={styles.row}>
                <View style={styles.cell}>
                  <TextField label="iOS uygulama kimliği" value={draft.iosAppId} onChangeText={(v) => set('iosAppId', v)} autoCapitalize="none" placeholder="ca-app-pub-…~…" editable={canEdit} />
                </View>
                <View style={styles.cell}>
                  <TextField label="Android uygulama kimliği" value={draft.androidAppId} onChangeText={(v) => set('androidAppId', v)} autoCapitalize="none" placeholder="ca-app-pub-…~…" editable={canEdit} />
                </View>
              </View>
              <TextField
                label="Reklam birimi eşlemesi (JSON)"
                value={draft.units}
                onChangeText={(v) => set('units', v)}
                multiline
                autoCapitalize="none"
                editable={canEdit}
                hint='Örnek: {"feed_home": {"ios": "ca-app-pub-…/…", "android": "ca-app-pub-…/…"}}'
              />
            </View>
            <TextField
              label="Harici bağlantı alan adı izin listesi (virgülle)"
              value={draft.allowlist}
              onChangeText={(v) => set('allowlist', v)}
              autoCapitalize="none"
              editable={canEdit}
              hint="Boş bırakılırsa güvenli (https, IP/yerel olmayan) tüm alan adlarına izin verilir."
            />
            <View style={styles.row}>
              {(
                [
                  ['hideDays', 'Gizleme süresi (gün)', '1–365'],
                  ['clickRate', 'Tıklama hız sınırı / dk', '1–60'],
                  ['impressionRate', 'Gösterim hız sınırı / dk', '10–300'],
                  ['minViewMs', 'Asgari görünme süresi (ms)', '1000–5000'],
                  ['minRatio', 'Asgari görünürlük oranı', '0.5–1'],
                  ['ttl', 'Sunum geçerliliği (dk)', '5–240'],
                  ['reportThreshold', 'Otomatik duraklatma bildirim eşiği', '2–500'],
                ] as const
              ).map(([key, label, hint]) => (
                <View key={key} style={styles.cell}>
                  <TextField label={label} value={draft[key]} onChangeText={(v) => set(key, v)} keyboardType="decimal-pad" hint={hint} editable={canEdit} />
                </View>
              ))}
            </View>
            <TextField
              label="Reklam kabul politikası"
              value={draft.policy}
              onChangeText={(v) => set('policy', v)}
              multiline
              editable={canEdit}
              hint={`Her durumda yasak: ${PROHIBITED_CATEGORIES.join(', ')}.`}
            />
            {canEdit ? (
              <View style={styles.actions}>
                <Button
                  label="Ayarları kaydet"
                  size="sm"
                  fullWidth={false}
                  onPress={() => {
                    const next = buildPatch();
                    if (next) setPatch(next);
                  }}
                />
              </View>
            ) : (
              <AppText variant="caption" color="textTertiary">
                Ayarları değiştirmek için ads.settings yetkisi gerekir.
              </AppText>
            )}
          </View>
        )}
      </AdminSection>

      <AdminSection title="Güvenli sınırlar" subtitle="Yerleşim ayarları bu aralıkların dışına çıkamaz. Mutlak sınırlar kod ve veritabanında sabittir.">
        {(settings.data?.rules ?? []).map((rule) => (
          <RuleRow key={rule.key} rule={rule} canEdit={canEdit} />
        ))}
      </AdminSection>

      <ReasonDialog
        visible={patch != null}
        title="Reklam sistem ayarlarını kaydet"
        description="Bu kritik bir ayardır; işlem denetim kaydına yazılır."
        loading={update.isPending}
        onCancel={() => setPatch(null)}
        onConfirm={async ({ reason }) => {
          if (!patch) return;
          try {
            await update.mutateAsync({ patch, reason });
            setPatch(null);
            toast.success('Ayarlar kaydedildi.');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Ayarlar kaydedilemedi.');
          }
        }}
      />
    </>
  );
}

function RuleRow({ rule, canEdit }: { rule: AdRule; canEdit: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const update = useAdRuleUpdate();
  const [min, setMin] = useState(String(rule.min_value));
  const [max, setMax] = useState(String(rule.max_value));
  const [def, setDef] = useState(String(rule.default_value));
  const [confirm, setConfirm] = useState(false);
  return (
    <View style={[styles.rule, { borderColor: theme.colors.border }]}>
      <View style={styles.ruleText}>
        <AppText variant="bodyStrong">{rule.label_tr}</AppText>
        <AppText variant="caption" color="textTertiary">
          {rule.description_tr} · mutlak aralık {rule.hard_min}–{rule.hard_max}
        </AppText>
      </View>
      <View style={styles.ruleInputs}>
        <TextField label="Alt" value={min} onChangeText={setMin} keyboardType="number-pad" editable={canEdit} />
        <TextField label="Varsayılan" value={def} onChangeText={setDef} keyboardType="number-pad" editable={canEdit} />
        <TextField label="Üst" value={max} onChangeText={setMax} keyboardType="number-pad" editable={canEdit} />
        {canEdit ? <Button label="Kaydet" size="sm" variant="secondary" fullWidth={false} onPress={() => setConfirm(true)} /> : null}
      </View>
      <ReasonDialog
        visible={confirm}
        title={`${rule.label_tr} sınırlarını güncelle`}
        loading={update.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={async ({ reason }) => {
          try {
            await update.mutateAsync({ key: rule.key, min: Number(min), max: Number(max), def: Number(def), reason });
            setConfirm(false);
            toast.success('Sınırlar güncellendi.');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Sınırlar güncellenemedi.');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexGrow: 1, flexBasis: 200, minWidth: 180 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  rule: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' },
  ruleText: { flexGrow: 1, flexBasis: 260, gap: 2 },
  ruleInputs: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' },
});
