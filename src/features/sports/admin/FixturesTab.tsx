import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { SettingSwitch, useReasonAction } from '@/features/earthquake/admin/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useRouter } from '@/utils/router';

import { eventLabel, matchTitle, minuteLabel, scoreText, statusLine } from '../utils/format';
import {
  invokeSportsWorker,
  sportsAdminApi,
  useSportsAdminChat,
  useSportsAdminFixture,
  useSportsAdminFixtures,
  useSportsAdminMutation,
  useSportsAdminPolls,
  type AdminFixture,
} from './api';
import { authorLabel, fmtTime, ListRow, Muted, sharedStyles, StatusBadge } from './shared';

type Scope = 'recent' | 'live' | 'upcoming' | 'problems' | 'test';

const TEST_STEPS: { key: string; label: string }[] = [
  { key: 'lineups', label: 'Kadrolar' },
  { key: 'kickoff', label: 'Başlama' },
  { key: 'minute', label: '+7 dk' },
  { key: 'goal_for', label: 'Trabzonspor golü' },
  { key: 'goal_against', label: 'Rakip golü' },
  { key: 'var_cancel', label: 'VAR: son golü iptal' },
  { key: 'yellow', label: 'Sarı kart' },
  { key: 'red', label: 'Kırmızı kart' },
  { key: 'stats', label: 'İstatistik' },
  { key: 'half_time', label: 'Devre arası' },
  { key: 'second_half', label: 'İkinci yarı' },
  { key: 'full_time', label: 'Maç sonu' },
  { key: 'postpone', label: 'Ertele' },
];

export function FixturesTab({ canData, canModerate }: { canData: boolean; canModerate: boolean }) {
  const toast = useAdminToast();
  const [scope, setScope] = useState<Scope>('recent');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [opponent, setOpponent] = useState('TEST Rakip');
  const list = useSportsAdminFixtures(scope, search, true);
  const create = useSportsAdminMutation(sportsAdminApi.testFixtureCreate);

  return (
    <View style={sharedStyles.gap}>
      <FilterChips
        options={[
          { key: 'recent', label: 'Son / yakın' },
          { key: 'live', label: 'Canlı' },
          { key: 'upcoming', label: 'Gelecek' },
          { key: 'problems', label: 'Sorunlu / müdahaleli' },
          { key: 'test', label: 'TEST' },
        ]}
        value={scope}
        onChange={(next) => {
          setScope(next);
          setSelected(null);
        }}
      />
      <TextField placeholder="Takım adı veya maç kimliği" value={search} onChangeText={setSearch} leftIcon="search-outline" />

      {canData && scope === 'test' ? (
        <AdminSection
          title="TEST maçı simülatörü"
          subtitle="Gerçek veri boru hattını API biçimindeki yükle çalıştırır. TEST maçları Feed’de yalnızca yetkili admine görünür; bildirimler yalnızca testi başlatan admine gider."
        >
          <View style={sharedStyles.rowLine}>
            <TextField value={opponent} onChangeText={setOpponent} label="Rakip adı" containerStyle={{ flex: 1, minWidth: 220 }} />
            <Button
              label="TEST maçı oluştur"
              size="sm"
              fullWidth={false}
              loading={create.isPending}
              onPress={() =>
                create.mutate(
                  { opponent, kickoffMinutes: 30 },
                  {
                    onSuccess: (detail) => {
                      setSelected(detail.fixture.id);
                      toast.success(`TEST maçı #${detail.fixture.id} oluşturuldu.`);
                    },
                    onError: (error) => toast.error(error.message),
                  },
                )
              }
            />
          </View>
        </AdminSection>
      ) : null}

      {list.isLoading ? (
        <ActivityIndicator />
      ) : list.isError ? (
        <AppText color="danger">{list.error.message}</AppText>
      ) : (list.data?.items ?? []).length === 0 ? (
        <Muted>Maç yok.</Muted>
      ) : (
        (list.data?.items ?? []).map((fixture) => (
          <FixtureListRow key={fixture.id} fixture={fixture} selected={selected === fixture.id} onPress={() => setSelected(selected === fixture.id ? null : fixture.id)} />
        ))
      )}

      {selected != null ? <FixtureDetail id={selected} canData={canData} canModerate={canModerate} onDeleted={() => setSelected(null)} /> : null}
    </View>
  );
}

function FixtureListRow({ fixture, selected, onPress }: { fixture: AdminFixture; selected: boolean; onPress: () => void }) {
  return (
    <ListRow onPress={onPress} selected={selected}>
      <View style={sharedStyles.rowLine}>
        <AppText variant="label" style={sharedStyles.flex}>
          {matchTitle(fixture)} {fixture.status.phase !== 'scheduled' ? `${scoreText(fixture.goals.home)}–${scoreText(fixture.goals.away)}` : ''}
        </AppText>
        {fixture.is_test ? <Badge label="TEST" tone="warning" /> : null}
        {fixture.status.is_live ? <Badge label="CANLI" tone="danger" /> : null}
        {fixture.feature_state !== 'auto' ? <Badge label={fixture.feature_state === 'pinned' ? 'Öne çıkarıldı' : 'Bastırıldı'} tone="accent" /> : null}
        {fixture.hidden ? <Badge label="Gizli" tone="danger" /> : null}
        {fixture.sync_failures > 0 ? <Badge label={`${fixture.sync_failures} senkron hatası`} tone="danger" /> : null}
      </View>
      <Muted>
        #{fixture.id} · {statusLine(fixture)} · {fixture.league.name ?? '—'} · veri yaşı {fixture.data_age_seconds ?? '?'} sn
        {fixture.counts
          ? ` · ${fixture.counts.events} olay, ${fixture.counts.stats ? 'istatistik var' : 'istatistik yok'}, ${fixture.counts.lineups ? 'kadro var' : 'kadro yok'}, ${fixture.counts.chat} mesaj, ${fixture.counts.comments} yorum`
          : ''}
      </Muted>
    </ListRow>
  );
}

function FixtureDetail({
  id,
  canData,
  canModerate,
  onDeleted,
}: {
  id: number;
  canData: boolean;
  canModerate: boolean;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const { ask, dialog } = useReasonAction();
  const detail = useSportsAdminFixture(id);
  const action = useSportsAdminMutation(sportsAdminApi.fixtureAction);
  const eventAction = useSportsAdminMutation(sportsAdminApi.eventAction);
  const step = useSportsAdminMutation(sportsAdminApi.testFixtureStep);
  const remove = useSportsAdminMutation(sportsAdminApi.testFixtureDelete);
  const resync = useSportsAdminMutation((input: { id: number; reason: string }) =>
    invokeSportsWorker<{ ok: boolean; key_missing: boolean; error: string | null }>({ action: 'resync', fixture_id: input.id, reason: input.reason }),
  );
  const newsLink = useSportsAdminMutation(sportsAdminApi.newsLink);
  const [pin, setPin] = useState('');
  const [postId, setPostId] = useState('');

  if (detail.isLoading) return <ActivityIndicator />;
  if (detail.isError || !detail.data) return <AppText color="danger">{detail.error?.message ?? 'Yüklenemedi'}</AppText>;
  const { fixture, events, phases, notifications, audit } = detail.data;

  const act = (name: string, title: string, payload?: Record<string, unknown>, destructive = false) =>
    ask({
      title,
      destructive,
      run: (reason) => action.mutateAsync({ id, action: name, reason, payload }),
    });

  return (
    <View style={sharedStyles.gap}>
      {dialog}
      <AdminSection
        title={`${matchTitle(fixture)} · #${fixture.id}`}
        subtitle={`${statusLine(fixture)} · ${fixture.league.name ?? '—'} · başlama ${fmtTime(fixture.kickoff_at)}`}
        action={<Button label="Arenayı aç" size="sm" variant="outline" fullWidth={false} onPress={() => router.push(`/trabzonspor/mac/${fixture.id}` as never)} />}
      >
        <View style={sharedStyles.rowLine}>
          <Badge label={`Feed: ${fixture.feature_state}`} tone="neutral" />
          <Badge label={`Sohbet: ${fixture.chat_state}`} tone="neutral" />
          {fixture.chat_slow_mode_seconds ? <Badge label={`Yavaş mod ${fixture.chat_slow_mode_seconds} sn`} tone="warning" /> : null}
          {fixture.comments_locked ? <Badge label="Yorumlar kilitli" tone="danger" /> : null}
          {fixture.final_verified ? <Badge label="Sonuç doğrulandı" tone="success" /> : null}
          {fixture.is_test ? <Badge label="TEST" tone="warning" /> : null}
        </View>
        {fixture.last_sync_error ? (
          <AppText variant="caption" color="danger" selectable>
            Son senkron hatası: {fixture.last_sync_error}
          </AppText>
        ) : null}
        <Muted>
          Skor ve olay kayıtları yalnızca veri sağlayıcısından gelir; panelden skor yazılamaz. Olay gizleme denetim kaydıyla yapılır
          ve geri alınabilir.
        </Muted>

        {canData ? (
          <View style={sharedStyles.actions}>
            {fixture.feature_state === 'pinned' ? (
              <Button label="Öne çıkarmayı kaldır" size="sm" variant="outline" fullWidth={false} onPress={() => act('unpin', 'Öne çıkarma kaldırılsın mı?')} />
            ) : (
              <Button label="Feed’de öne çıkar" size="sm" variant="outline" fullWidth={false} onPress={() => act('pin', 'Bu maç Feed kartında öne çıkarılsın mı?')} />
            )}
            {fixture.feature_state === 'suppressed' ? (
              <Button label="Feed kartına izin ver" size="sm" variant="outline" fullWidth={false} onPress={() => act('unsuppress', 'Feed kartı yeniden açılsın mı?')} />
            ) : (
              <Button label="Feed kartını bastır" size="sm" variant="outline" fullWidth={false} onPress={() => act('suppress', 'Bu maç Feed kartında gösterilmesin mi?')} />
            )}
            {fixture.hidden ? (
              <Button label="Maçı yeniden göster" size="sm" variant="outline" fullWidth={false} onPress={() => act('unhide', 'Maç yeniden görünür olsun mu?')} />
            ) : (
              <Button label="Maçı gizle" size="sm" variant="danger" fullWidth={false} onPress={() => act('hide', 'Maç tüm yüzeylerden gizlensin mi?', undefined, true)} />
            )}
            {!fixture.is_test ? (
              <Button
                label="Sağlayıcıdan yeniden çek"
                size="sm"
                fullWidth={false}
                loading={resync.isPending}
                onPress={() =>
                  ask({
                    title: 'Maç verisi API’den yeniden çekilsin mi?',
                    description: '1 istek kotadan düşer.',
                    run: async (reason) => {
                      const result = await resync.mutateAsync({ id, reason });
                      if (result.key_missing) throw new Error('API_FOOTBALL_KEY tanımlı değil.');
                      if (!result.ok) throw new Error(result.error ?? 'Senkron başarısız.');
                    },
                    success: 'Maç yeniden senkronize edildi.',
                  })
                }
              />
            ) : null}
          </View>
        ) : null}
      </AdminSection>

      {fixture.is_test && canData ? (
        <AdminSection title="TEST adımları" subtitle="Her adım gerçek ingest fonksiyonuna API biçiminde yük gönderir; dedupe, revizyon ve bildirim akışı test edilir.">
          <View style={sharedStyles.actions}>
            {TEST_STEPS.map((item) => (
              <Button
                key={item.key}
                label={item.label}
                size="sm"
                variant="outline"
                fullWidth={false}
                disabled={step.isPending}
                onPress={() =>
                  step.mutate({ id, step: item.key }, { onError: (error) => toast.error(error.message) })
                }
              />
            ))}
          </View>
          <Button
            label="TEST maçını sil"
            size="sm"
            variant="danger"
            fullWidth={false}
            loading={remove.isPending}
            onPress={() =>
              remove.mutate(
                { id },
                {
                  onSuccess: () => {
                    toast.success('TEST maçı silindi.');
                    onDeleted();
                  },
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          />
        </AdminSection>
      ) : null}

      {canModerate ? (
        <AdminSection title="Sohbet ve yorum kontrolü">
          <View style={sharedStyles.actions}>
            {(['chat_open', 'chat_pause', 'chat_close', 'chat_auto'] as const).map((name) => (
              <Button
                key={name}
                label={{ chat_open: 'Sohbeti aç', chat_pause: 'Duraklat', chat_close: 'Kapat', chat_auto: 'Otomatik' }[name]}
                size="sm"
                variant={fixture.chat_state === name.replace('chat_', '') ? 'primary' : 'outline'}
                fullWidth={false}
                onPress={() => act(name, 'Sohbet durumu değiştirilsin mi?')}
              />
            ))}
          </View>
          <View style={sharedStyles.actions}>
            {[0, 10, 30, 60].map((seconds) => (
              <Button
                key={seconds}
                label={seconds === 0 ? 'Yavaş mod kapalı' : `Yavaş mod ${seconds} sn`}
                size="sm"
                variant={(fixture.chat_slow_mode_seconds ?? 0) === seconds ? 'primary' : 'outline'}
                fullWidth={false}
                onPress={() => act('slow_mode', 'Yavaş mod değiştirilsin mi?', { seconds })}
              />
            ))}
          </View>
          {fixture.chat_pinned ? (
            <ListRow>
              <AppText variant="label">Sabit duyuru</AppText>
              <AppText variant="body">{fixture.chat_pinned.body}</AppText>
              <Button label="Duyuruyu kaldır" size="sm" variant="outline" fullWidth={false} onPress={() => act('chat_unpin', 'Sabit duyuru kaldırılsın mı?')} />
            </ListRow>
          ) : null}
          <View style={sharedStyles.rowLine}>
            <TextField value={pin} onChangeText={setPin} placeholder="Sohbette sabitlenecek duyuru" maxLength={280} containerStyle={{ flex: 1, minWidth: 240 }} />
            <Button
              label="Sabitle"
              size="sm"
              fullWidth={false}
              disabled={pin.trim().length < 2}
              onPress={() =>
                ask({
                  title: 'Duyuru sohbete sabitlensin mi?',
                  run: async (reason) => {
                    await action.mutateAsync({ id, action: 'chat_pin', reason, payload: { body: pin.trim() } });
                    setPin('');
                  },
                })
              }
            />
          </View>
          <View style={sharedStyles.actions}>
            <Button
              label="Tüm mesajları kaldır"
              size="sm"
              variant="danger"
              fullWidth={false}
              onPress={() => act('chat_clear', 'Bu maçtaki tüm kullanıcı mesajları kaldırılsın mı?', undefined, true)}
            />
            {fixture.comments_locked ? (
              <Button label="Yorumları aç" size="sm" variant="outline" fullWidth={false} onPress={() => act('unlock_comments', 'Yorumlar yeniden açılsın mı?')} />
            ) : (
              <Button label="Yorumları kilitle" size="sm" variant="outline" fullWidth={false} onPress={() => act('lock_comments', 'Yeni yorumlar kapatılsın mı?')} />
            )}
          </View>
        </AdminSection>
      ) : null}

      <AdminSection title={`Olaylar (${events.length})`} subtitle="Sağlayıcıdan kaybolan olaylar otomatik “geri çekildi” olarak işaretlenir.">
        {events.length === 0 ? (
          <Muted>Olay yok.</Muted>
        ) : (
          events.map((event) => (
            <ListRow key={event.id}>
              <View style={sharedStyles.rowLine}>
                <AppText variant="label" style={sharedStyles.flex}>
                  {minuteLabel(event.minute, event.extra)} {eventLabel(event)} · {event.player_name ?? '—'} ({event.team_name ?? '—'})
                </AppText>
                <StatusBadge status={event.status} />
                {event.revision > 1 ? <Badge label={`rev ${event.revision}`} tone="neutral" /> : null}
              </View>
              {event.hidden_reason ? <Muted>Gizleme gerekçesi: {event.hidden_reason}</Muted> : null}
              {canData && event.status !== 'retracted' ? (
                <Button
                  label={event.status === 'hidden' ? 'Yeniden göster' : 'Gizle'}
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  onPress={() =>
                    ask({
                      title: event.status === 'hidden' ? 'Olay yeniden gösterilsin mi?' : 'Olay gizlensin mi?',
                      description: 'Kayıt silinmez; işlem denetim kaydına yazılır.',
                      run: (reason) => eventAction.mutateAsync({ id: event.id, action: event.status === 'hidden' ? 'unhide' : 'hide', reason }),
                    })
                  }
                />
              ) : null}
            </ListRow>
          ))
        )}
      </AdminSection>

      {canModerate ? <PollsAdmin fixtureId={id} /> : null}

      {canModerate ? (
        <AdminSection title="Bağlı haber" subtitle="Herkese açık bir Trabzone Haber gönderisini bu maça bağla.">
          <View style={sharedStyles.rowLine}>
            <TextField value={postId} onChangeText={setPostId} placeholder="Gönderi kimliği (uuid)" autoCapitalize="none" containerStyle={{ flex: 1, minWidth: 260 }} />
            {(['add', 'remove'] as const).map((mode) => (
              <Button
                key={mode}
                label={mode === 'add' ? 'Bağla' : 'Kaldır'}
                size="sm"
                variant={mode === 'add' ? 'primary' : 'outline'}
                fullWidth={false}
                disabled={!/^[0-9a-f-]{36}$/i.test(postId.trim())}
                onPress={() =>
                  ask({
                    title: mode === 'add' ? 'Haber bağlansın mı?' : 'Haber bağlantısı kaldırılsın mı?',
                    run: async (reason) => {
                      await newsLink.mutateAsync({ fixture: id, post: postId.trim(), add: mode === 'add', reason });
                      setPostId('');
                    },
                  })
                }
              />
            ))}
          </View>
        </AdminSection>
      ) : null}

      {canModerate ? <ChatAdmin fixtureId={id} /> : null}

      <AdminSection title="Durum geçmişi">
        {phases.length === 0 ? (
          <Muted>Kayıt yok.</Muted>
        ) : (
          phases.map((phase, index) => (
            <AppText key={`${phase.at}-${index}`} variant="caption">
              {fmtTime(phase.at)} · {phase.status}
              {phase.elapsed != null ? ` · ${phase.elapsed}'` : ''}
            </AppText>
          ))
        )}
      </AdminSection>

      <AdminSection title="Bildirim olayları">
        {notifications.length === 0 ? (
          <Muted>Yok.</Muted>
        ) : (
          notifications.map((item) => (
            <ListRow key={item.id}>
              <View style={sharedStyles.rowLine}>
                <AppText variant="label" style={sharedStyles.flex}>
                  {item.title}
                </AppText>
                <StatusBadge status={item.status} />
              </View>
              <Muted>
                {fmtTime(item.created_at)} · {item.type} · {item.recipients ?? 0} alıcı · {item.key}
              </Muted>
            </ListRow>
          ))
        )}
      </AdminSection>

      <AdminSection title="Denetim kaydı">
        {audit.length === 0 ? (
          <Muted>Yok.</Muted>
        ) : (
          audit.map((entry, index) => (
            <AppText key={`${entry.at}-${index}`} variant="caption">
              {fmtTime(entry.at)} · {authorLabel(entry.actor)} · {entry.action}
              {entry.reason ? ` · “${entry.reason}”` : ''}
            </AppText>
          ))
        )}
      </AdminSection>
    </View>
  );
}

function PollsAdmin({ fixtureId }: { fixtureId: number }) {
  const { ask, dialog } = useReasonAction();
  const polls = useSportsAdminPolls(fixtureId);
  const create = useSportsAdminMutation(sportsAdminApi.createPoll);
  const pollAction = useSportsAdminMutation(sportsAdminApi.pollAction);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [allowChange, setAllowChange] = useState(false);
  const [visibility, setVisibility] = useState<'after_vote' | 'always' | 'after_close'>('after_vote');
  const [closesIn, setClosesIn] = useState('');
  const optionList = options
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <AdminSection title="Anketler" subtitle="Kullanıcı başına tek oy veritabanında zorunludur. Bahis veya ödül yoktur.">
      {dialog}
      {(polls.data ?? []).map((poll) => (
        <ListRow key={poll.id}>
          <View style={sharedStyles.rowLine}>
            <AppText variant="label" style={sharedStyles.flex}>
              {poll.question}
            </AppText>
            <StatusBadge status={poll.status} />
            {poll.auto_key ? <Badge label="Otomatik" tone="neutral" /> : null}
          </View>
          <Muted>
            {poll.real_total} oy · {poll.changed_votes} değiştirilmiş · {poll.new_account_votes} yeni hesap oyu · sonuç görünürlüğü{' '}
            {poll.results_visibility} · {poll.allow_change ? 'oy değiştirilebilir' : 'oy değiştirilemez'}
          </Muted>
          {poll.real_options.map((option) => (
            <AppText key={option.id} variant="caption">
              {option.label}: {option.votes}
            </AppText>
          ))}
          <View style={sharedStyles.actions}>
            {(['close', 'disable', 'activate'] as const)
              .filter((name) => (name === 'activate' ? poll.status !== 'active' : poll.status === 'active'))
              .map((name) => (
                <Button
                  key={name}
                  label={{ close: 'Kapat', disable: 'Devre dışı', activate: 'Etkinleştir' }[name]}
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  onPress={() =>
                    ask({
                      title: 'Anket durumu değiştirilsin mi?',
                      run: (reason) => pollAction.mutateAsync({ id: poll.id, action: name, reason }),
                    })
                  }
                />
              ))}
          </View>
        </ListRow>
      ))}
      <TextField label="Yeni anket sorusu" value={question} onChangeText={setQuestion} maxLength={200} />
      <TextField label="Seçenekler (her satıra bir)" value={options} onChangeText={setOptions} multiline />
      <TextField
        label="Kapanış (dakika sonra, boş = açık)"
        value={closesIn}
        onChangeText={(text) => setClosesIn(text.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
      />
      <SettingSwitch label="Kullanıcı oyunu değiştirebilir" value={allowChange} onChange={setAllowChange} />
      <FilterChips
        options={[
          { key: 'after_vote', label: 'Sonuç: oy verince' },
          { key: 'always', label: 'Sonuç: her zaman' },
          { key: 'after_close', label: 'Sonuç: kapanınca' },
        ]}
        value={visibility}
        onChange={setVisibility}
      />
      <Button
        label="Anketi yayınla"
        size="sm"
        fullWidth={false}
        disabled={question.trim().length < 5 || optionList.length < 2 || optionList.length > 6}
        loading={create.isPending}
        onPress={() =>
          ask({
            title: 'Anket yayınlansın mı?',
            run: async (reason) => {
              await create.mutateAsync({
                fixture: fixtureId,
                question: question.trim(),
                options: optionList,
                closesAt: closesIn ? new Date(Date.now() + Number(closesIn) * 60_000).toISOString() : null,
                allowChange,
                visibility,
                reason,
              });
              setQuestion('');
              setOptions('');
              setClosesIn('');
            },
          })
        }
      />
    </AdminSection>
  );
}

function ChatAdmin({ fixtureId }: { fixtureId: number }) {
  const { theme } = useTheme();
  const { ask, dialog } = useReasonAction();
  const [status, setStatus] = useState<'all' | 'visible' | 'removed'>('all');
  const chat = useSportsAdminChat(fixtureId, status === 'all' ? null : status);
  const remove = useSportsAdminMutation(sportsAdminApi.removeMessage);

  return (
    <AdminSection title="Sohbet mesajları" subtitle="En yeni 80 mesaj; 10 sn’de bir yenilenir.">
      {dialog}
      <FilterChips
        options={[
          { key: 'all', label: 'Tümü' },
          { key: 'visible', label: 'Görünür' },
          { key: 'removed', label: 'Kaldırılan' },
        ]}
        value={status}
        onChange={setStatus}
      />
      {(chat.data?.items ?? []).map((message) => (
        <View key={message.id} style={[sharedStyles.rowLine, { borderBottomWidth: 1, borderBottomColor: theme.colors.divider, paddingVertical: 4 }]}>
          <View style={sharedStyles.flex}>
            <AppText variant="caption" color="textSecondary">
              {fmtTime(message.created_at)} · {authorLabel(message.author)} · {message.kind}
              {message.reports ? ` · ${message.reports} şikâyet` : ''}
            </AppText>
            <AppText variant="body" selectable color={message.status === 'visible' ? 'text' : 'textTertiary'}>
              {message.raw_body ?? message.body ?? '—'}
            </AppText>
            {message.removed_reason ? <Muted>Kaldırma: {message.removed_reason}</Muted> : null}
          </View>
          <StatusBadge status={message.status} />
          {message.status === 'visible' && message.kind === 'user' ? (
            <Button
              label="Kaldır"
              size="sm"
              variant="outline"
              fullWidth={false}
              onPress={() =>
                ask({ title: 'Mesaj kaldırılsın mı?', destructive: true, run: (reason) => remove.mutateAsync({ id: message.id, reason }) })
              }
            />
          ) : null}
        </View>
      ))}
    </AdminSection>
  );
}
