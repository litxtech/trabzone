import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { SettingSwitch, useReasonAction } from '@/features/earthquake/admin/ui';

import { sportsAdminApi, useSportsAdminMutation, type AdminSettings } from './api';
import { fmtTime, ListRow, Muted, sharedStyles } from './shared';

type NumberKey = {
  [K in keyof AdminSettings]-?: AdminSettings[K] extends number | null ? K : never;
}[keyof AdminSettings];

type BoolKey = {
  [K in keyof AdminSettings]-?: AdminSettings[K] extends boolean ? K : never;
}[keyof AdminSettings];

const SYNC_FIELDS: { key: NumberKey; label: string; hint: string; nullable?: boolean }[] = [
  { key: 'live_interval_seconds', label: 'Canlı maç aralığı (sn)', hint: '15–300. Önerilen 20–30.' },
  { key: 'stats_interval_seconds', label: 'İstatistik aralığı (sn)', hint: '30–600. Önerilen 60.' },
  { key: 'prematch_interval_seconds', label: 'Maç öncesi aralık (sn)', hint: '60–3600' },
  { key: 'schedule_interval_minutes', label: 'Fikstür aralığı (dk)', hint: '30–1440' },
  { key: 'matchday_schedule_interval_minutes', label: 'Maç günü fikstür aralığı (dk)', hint: '10–240' },
  { key: 'standings_interval_minutes', label: 'Puan durumu aralığı (dk)', hint: '30–1440' },
  { key: 'leagues_interval_hours', label: 'Turnuva aralığı (sa)', hint: '6–168' },
  { key: 'squad_interval_hours', label: 'Kadro aralığı (sa)', hint: '6–168' },
  { key: 'daily_request_budget', label: 'Günlük istek bütçesi', hint: 'Boş = plan limiti', nullable: true },
  { key: 'request_reserve', label: 'Kota rezervi', hint: 'Canlı maç için ayrılan istek sayısı' },
];

const FEED_FIELDS: { key: NumberKey; label: string; hint: string }[] = [
  { key: 'feed_prematch_minutes', label: 'Maç öncesi gösterim (dk)', hint: 'Kart kaç dakika önce görünür (varsayılan 60)' },
  { key: 'feed_postmatch_minutes', label: 'Maç sonrası gösterim (dk)', hint: 'Sonuç kartı ne kadar kalır' },
];

const CHAT_FIELDS: { key: NumberKey; label: string; hint: string }[] = [
  { key: 'chat_max_length', label: 'Azami mesaj uzunluğu', hint: 'Karakter' },
  { key: 'chat_rate_per_minute', label: 'Dakikada mesaj sınırı', hint: 'Kullanıcı başına' },
  { key: 'chat_duplicate_window_seconds', label: 'Tekrar mesaj penceresi (sn)', hint: 'Aynı metin engellenir' },
  { key: 'chat_open_before_minutes', label: 'Sohbet açılışı (dk önce)', hint: 'Başlama saatinden önce' },
  { key: 'chat_close_after_minutes', label: 'Sohbet kapanışı (dk sonra)', hint: 'Maç bitiminden sonra' },
  { key: 'chat_retention_days', label: 'Mesaj saklama (gün)', hint: 'Sonrasında mesajlar silinir' },
];

type Section = 'team' | 'sync' | 'feed' | 'chat' | 'rights' | 'notify';

export function SettingsTab({ settings, canManage }: { settings: AdminSettings; canManage: boolean }) {
  const { ask, dialog } = useReasonAction();
  const [section, setSection] = useState<Section>('team');
  const [draft, setDraft] = useState<Partial<AdminSettings>>({});
  const [terms, setTerms] = useState<string | null>(null);
  const update = useSportsAdminMutation(sportsAdminApi.updateSettings);
  const setTeam = useSportsAdminMutation(sportsAdminApi.setTeam);
  const competition = useSportsAdminMutation(sportsAdminApi.updateCompetition);

  const value = useMemo(() => ({ ...settings, ...draft }), [settings, draft]);
  const patch = useMemo(() => {
    const out: Record<string, unknown> = {};
    const base = settings as unknown as Record<string, unknown>;
    for (const [key, next] of Object.entries(draft)) {
      if (JSON.stringify(next) !== JSON.stringify(base[key])) out[key] = next;
    }
    if (terms != null) {
      const list = terms
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (JSON.stringify(list) !== JSON.stringify(settings.chat_blocked_terms ?? [])) out.chat_blocked_terms = list;
    }
    return out;
  }, [draft, settings, terms]);
  const dirty = Object.keys(patch).length > 0;

  const setBool = (key: BoolKey) => (next: boolean) => setDraft((prev) => ({ ...prev, [key]: next }));
  const numberField = (field: { key: NumberKey; label: string; hint: string; nullable?: boolean }) => {
    const current = value[field.key];
    return (
      <TextField
        key={field.key}
        label={field.label}
        hint={field.hint}
        editable={canManage}
        keyboardType="number-pad"
        value={current == null ? '' : String(current)}
        onChangeText={(text) => {
          const digits = text.replace(/[^0-9]/g, '');
          setDraft((prev) => ({
            ...prev,
            [field.key]: digits === '' ? (field.nullable ? null : 0) : Number(digits),
          }));
        }}
        containerStyle={{ minWidth: 220, flexGrow: 1, flexBasis: 220 }}
      />
    );
  };

  const save = () =>
    ask({
      title: 'Ayarları kaydet',
      description: `Değişen alanlar: ${Object.keys(patch).join(', ')}`,
      run: async (reason) => {
        await update.mutateAsync({ patch, reason });
        setDraft({});
        setTerms(null);
      },
      success: 'Ayarlar kaydedildi.',
    });

  return (
    <View style={sharedStyles.gap}>
      {dialog}
      <FilterChips
        options={[
          { key: 'team', label: 'Takım ve turnuvalar' },
          { key: 'sync', label: 'Senkron ve kota' },
          { key: 'feed', label: 'Feed kartı' },
          { key: 'chat', label: 'Canlı sohbet' },
          { key: 'rights', label: 'Haklar' },
          { key: 'notify', label: 'Bildirimler' },
        ]}
        value={section}
        onChange={setSection}
      />

      {section === 'team' ? (
        <>
          <AdminSection
            title="Takım doğrulama"
            subtitle="Takım kimliği tahmin edilmez: API /teams araması tek kesin eşleşme döndürürse otomatik, aksi halde burada seçilir."
          >
            <AppText variant="body">
              Seçili takım:{' '}
              {settings.team ? `${settings.team.name} (#${settings.team.id}, ${settings.team.country ?? '—'})` : 'Henüz doğrulanmadı'}
            </AppText>
            {settings.team_verified_at ? <Muted>Doğrulama: {fmtTime(settings.team_verified_at)}</Muted> : null}
            <TextField
              label="Arama ifadesi"
              value={String(value.team_search ?? '')}
              editable={canManage}
              onChangeText={(text) => setDraft((prev) => ({ ...prev, team_search: text }))}
              hint="Takım keşfi işi bu ifadeyle /teams?search çağırır."
            />
            {settings.team_candidates.length === 0 ? (
              <Muted>Aday yok. Genel durum sekmesinden “Takım keşfi” işini çalıştır.</Muted>
            ) : (
              settings.team_candidates.map((candidate) => (
                <ListRow key={candidate.id} selected={candidate.id === settings.team_id}>
                  <View style={sharedStyles.rowLine}>
                    <AppText variant="label" style={sharedStyles.flex}>
                      {candidate.name} · #{candidate.id}
                    </AppText>
                    {candidate.national ? <Badge label="Milli takım" tone="warning" /> : null}
                    {candidate.id === settings.team_id ? <Badge label="Seçili" tone="success" /> : null}
                  </View>
                  <Muted>
                    {[candidate.country, candidate.city, candidate.venue, candidate.founded ? `Kuruluş ${candidate.founded}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Muted>
                  {canManage && candidate.id !== settings.team_id ? (
                    <Button
                      label="Bu takımı doğrula"
                      size="sm"
                      variant="outline"
                      fullWidth={false}
                      onPress={() =>
                        ask({
                          title: `${candidate.name} (#${candidate.id}) seçilsin mi?`,
                          description: 'Fikstür, turnuva ve puan durumu bu kimlikle yeniden senkronize edilir.',
                          run: (reason) => setTeam.mutateAsync({ teamId: candidate.id, reason }),
                          success: 'Takım doğrulandı.',
                        })
                      }
                    />
                  ) : null}
                </ListRow>
              ))
            )}
          </AdminSection>

          <AdminSection title="Turnuvalar ve kapsam" subtitle="API /leagues?team&current=true ile otomatik algılanır.">
            <View style={sharedStyles.rowLine}>
              <SettingSwitch
                label="Sezonu otomatik algıla"
                value={Boolean(value.season_auto)}
                onChange={setBool('season_auto')}
                disabled={!canManage}
              />
            </View>
            {!value.season_auto ? numberField({ key: 'season', label: 'Sezon', hint: 'Örn. 2026', nullable: true }) : null}
            {settings.competitions.length === 0 ? (
              <Muted>Turnuva yok.</Muted>
            ) : (
              settings.competitions.map((comp) => {
                const coverage = (comp.coverage ?? {}) as Record<string, unknown>;
                const fixturesCoverage = (coverage.fixtures ?? {}) as Record<string, unknown>;
                const flags = [
                  fixturesCoverage.events ? 'olaylar' : null,
                  fixturesCoverage.lineups ? 'kadrolar' : null,
                  fixturesCoverage.statistics_fixtures ? 'istatistik' : null,
                  fixturesCoverage.statistics_players ? 'oyuncu' : null,
                  coverage.standings ? 'puan durumu' : null,
                ].filter(Boolean);
                return (
                  <ListRow key={`${comp.league_id}-${comp.season}`}>
                    <View style={sharedStyles.rowLine}>
                      <AppText variant="label" style={sharedStyles.flex}>
                        {comp.name} · {comp.season} · #{comp.league_id}
                      </AppText>
                      {comp.is_current ? <Badge label="Güncel" tone="success" /> : null}
                      <Badge label={comp.is_enabled ? 'Aktif' : 'Kapalı'} tone={comp.is_enabled ? 'primary' : 'neutral'} />
                    </View>
                    <Muted>
                      {comp.type ?? '—'} · öncelik {comp.priority} · kapsam: {flags.length ? flags.join(', ') : 'bilinmiyor'} · son senkron{' '}
                      {fmtTime(comp.last_synced_at)}
                    </Muted>
                    {canManage ? (
                      <Button
                        label={comp.is_enabled ? 'Devre dışı bırak' : 'Etkinleştir'}
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        onPress={() =>
                          ask({
                            title: `${comp.name} ${comp.is_enabled ? 'kapatılsın' : 'açılsın'} mı?`,
                            run: (reason) =>
                              competition.mutateAsync({ league: comp.league_id, season: comp.season, enabled: !comp.is_enabled, reason }),
                          })
                        }
                      />
                    ) : null}
                  </ListRow>
                );
              })
            )}
          </AdminSection>
        </>
      ) : null}

      {section === 'sync' ? (
        <AdminSection title="Senkron ve kota" subtitle="Kota sınırına yaklaşıldığında canlı maç dışındaki işler ertelenir.">
          <SettingSwitch label="Senkron açık" value={Boolean(value.sync_enabled)} onChange={setBool('sync_enabled')} disabled={!canManage} />
          <View style={sharedStyles.actions}>{SYNC_FIELDS.map(numberField)}</View>
          <Muted>API adresi: {settings.api_base_url} · Anahtar secret adı: {settings.secret_name}</Muted>
        </AdminSection>
      ) : null}

      {section === 'feed' ? (
        <AdminSection title="Feed maç kartı" subtitle="Hikayelerin altında, gönderilerin üstünde tek kart. Reklam gösterilmez.">
          <SettingSwitch label="Feed kartı açık" value={Boolean(value.feed_card_enabled)} onChange={setBool('feed_card_enabled')} disabled={!canManage} />
          <SettingSwitch label="Sohbet sayacını göster" value={Boolean(value.feed_show_chat_count)} onChange={setBool('feed_show_chat_count')} disabled={!canManage} />
          <SettingSwitch label="Canlı istatistik özetini göster" value={Boolean(value.feed_show_stats)} onChange={setBool('feed_show_stats')} disabled={!canManage} />
          <SettingSwitch label="Kullanıcı kartı gizleyebilir" value={Boolean(value.feed_allow_hide)} onChange={setBool('feed_allow_hide')} disabled={!canManage} />
          <SettingSwitch label="Maç sonrası arşiv kartı" value={Boolean(value.feed_show_archive)} onChange={setBool('feed_show_archive')} disabled={!canManage} />
          <FilterChips
            options={[
              { key: 'expanded', label: 'Varsayılan: geniş' },
              { key: 'compact', label: 'Varsayılan: kompakt' },
            ]}
            value={(value.feed_default_view ?? 'expanded') as 'expanded' | 'compact'}
            onChange={(next) => canManage && setDraft((prev) => ({ ...prev, feed_default_view: next }))}
          />
          <View style={sharedStyles.actions}>{FEED_FIELDS.map(numberField)}</View>
          <Muted>Belirli bir maçı öne çıkarmak veya gizlemek için Maçlar sekmesini kullan.</Muted>
        </AdminSection>
      ) : null}

      {section === 'chat' ? (
        <AdminSection title="Canlı sohbet kuralları" subtitle="Tüm kurallar sunucuda uygulanır; anonim mesaj gönderilemez.">
          <SettingSwitch label="Canlı sohbet açık" value={Boolean(value.chat_enabled)} onChange={setBool('chat_enabled')} disabled={!canManage} />
          <SettingSwitch label="Bağlantılara izin ver" value={Boolean(value.chat_links_allowed)} onChange={setBool('chat_links_allowed')} disabled={!canManage} />
          <SettingSwitch label="Maç yorumları açık" value={Boolean(value.comments_enabled)} onChange={setBool('comments_enabled')} disabled={!canManage} />
          <SettingSwitch label="Otomatik anketler (Maçın Oyuncusu)" value={Boolean(value.auto_polls_enabled)} onChange={setBool('auto_polls_enabled')} disabled={!canManage} />
          <View style={sharedStyles.actions}>{CHAT_FIELDS.map(numberField)}</View>
          <TextField
            label="Engelli kelimeler"
            hint="Virgül veya satırla ayır. Eşleşen mesajlar gönderilmez."
            multiline
            editable={canManage}
            value={terms ?? (settings.chat_blocked_terms ?? []).join(', ')}
            onChangeText={setTerms}
          />
        </AdminSection>
      ) : null}

      {section === 'rights' ? (
        <AdminSection title="Görsel ve yayın hakları" subtitle="Lisans doğrulanmadan logo ve oyuncu fotoğrafı gösterilmez. Canlı maç videosu yoktur.">
          <SettingSwitch
            label="Takım logolarını göster"
            hint="API-Football logo görsellerinin kullanım hakkı doğrulandıysa aç."
            value={Boolean(value.logos_enabled)}
            onChange={setBool('logos_enabled')}
            disabled={!canManage}
          />
          <SettingSwitch
            label="Oyuncu fotoğraflarını göster"
            hint="Fotoğraf lisansı doğrulandıysa aç."
            value={Boolean(value.player_photos_enabled)}
            onChange={setBool('player_photos_enabled')}
            disabled={!canManage}
          />
          <TextField
            label="Hak notu"
            hint="Lisans kaynağı ve tarihi (iç kayıt)."
            multiline
            editable={canManage}
            value={String(value.rights_note ?? '')}
            onChangeText={(text) => setDraft((prev) => ({ ...prev, rights_note: text }))}
          />
        </AdminSection>
      ) : null}

      {section === 'notify' ? (
        <AdminSection title="Maç bildirimleri" subtitle="Yalnızca açıkça onay vermiş kullanıcılara gönderilir; TEST bildirimleri yalnızca testi başlatan admine gider.">
          <SettingSwitch label="Bildirim gönderimi açık" value={Boolean(value.notifications_enabled)} onChange={setBool('notifications_enabled')} disabled={!canManage} />
          {numberField({ key: 'reminder_minutes', label: 'Maç hatırlatması (dk önce)', hint: 'Varsayılan 60' })}
        </AdminSection>
      ) : null}

      {canManage ? (
        <Button label={dirty ? 'Değişiklikleri kaydet' : 'Değişiklik yok'} disabled={!dirty} loading={update.isPending} onPress={save} />
      ) : (
        <Muted>Ayarları değiştirmek için sports.manage izni gerekir.</Muted>
      )}
    </View>
  );
}
