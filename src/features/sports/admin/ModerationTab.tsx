import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useReasonAction } from '@/features/earthquake/admin/ui';
import { PostCard } from '@/features/feed/components/PostCard';
import type { FeedPost } from '@/features/feed/services/feed-service';

import {
  sportsAdminApi,
  useSportsAdminComments,
  useSportsAdminMedia,
  useSportsAdminModerators,
  useSportsAdminMutation,
  useSportsAdminReports,
  useSportsAdminSanctions,
} from './api';
import { authorLabel, fmtTime, ListRow, Muted, sharedStyles, StatusBadge } from './shared';

type Section = 'reports' | 'sanctions' | 'moderators' | 'comments' | 'media';

const REPORT_REASONS: Record<string, string> = {
  spam: 'Spam',
  abuse: 'Hakaret / taciz',
  hate: 'Nefret söylemi',
  violence: 'Şiddet',
  sexual: 'Cinsel içerik',
  misinformation: 'Yanıltıcı bilgi',
  other: 'Diğer',
};

export function ModerationTab() {
  const [section, setSection] = useState<Section>('reports');
  return (
    <View style={sharedStyles.gap}>
      <FilterChips
        options={[
          { key: 'reports', label: 'Sohbet şikâyetleri' },
          { key: 'sanctions', label: 'Yaptırımlar' },
          { key: 'moderators', label: 'Sohbet moderatörleri' },
          { key: 'comments', label: 'Maç yorumları' },
          { key: 'media', label: 'Taraftar medyası' },
        ]}
        value={section}
        onChange={setSection}
      />
      {section === 'reports' ? <Reports /> : null}
      {section === 'sanctions' ? <Sanctions /> : null}
      {section === 'moderators' ? <Moderators /> : null}
      {section === 'comments' ? <Comments /> : null}
      {section === 'media' ? <Media /> : null}
    </View>
  );
}

function Reports() {
  const { ask, dialog } = useReasonAction();
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const reports = useSportsAdminReports(status, true);
  const resolve = useSportsAdminMutation(sportsAdminApi.resolveReport);
  const sanction = useSportsAdminMutation(sportsAdminApi.sanction);
  const items = reports.data?.items ?? [];

  return (
    <AdminSection title="Sohbet şikâyetleri">
      {dialog}
      <FilterChips
        options={[
          { key: 'open', label: 'Açık' },
          { key: 'resolved', label: 'Çözüldü' },
          { key: 'dismissed', label: 'Reddedildi' },
        ]}
        value={status}
        onChange={setStatus}
      />
      {reports.isLoading ? <ActivityIndicator /> : null}
      {!reports.isLoading && items.length === 0 ? <Muted>Şikâyet yok.</Muted> : null}
      {items.map((report) => (
        <ListRow key={report.id}>
          <View style={sharedStyles.rowLine}>
            <Badge label={REPORT_REASONS[report.reason] ?? report.reason} tone="warning" />
            <AppText variant="caption" color="textSecondary" style={sharedStyles.flex}>
              {report.fixture.home} – {report.fixture.away} · {fmtTime(report.created_at)} · {report.total_reports} şikâyet · bildiren{' '}
              {authorLabel(report.reporter)}
            </AppText>
            <StatusBadge status={report.message.status} />
          </View>
          <AppText variant="body" selectable>
            {authorLabel(report.message.author)}: {report.message.raw_body ?? '—'}
          </AppText>
          {report.note ? <Muted>Not: {report.note}</Muted> : null}
          {status === 'open' ? (
            <View style={sharedStyles.actions}>
              <Button
                label="Mesajı kaldır"
                size="sm"
                variant="danger"
                fullWidth={false}
                onPress={() =>
                  ask({ title: 'Mesaj kaldırılsın mı?', destructive: true, run: (reason) => resolve.mutateAsync({ id: report.id, action: 'remove', reason }) })
                }
              />
              <Button
                label="Şikâyeti reddet"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={() => ask({ title: 'Şikâyet reddedilsin mi?', run: (reason) => resolve.mutateAsync({ id: report.id, action: 'dismiss', reason }) })}
              />
              {report.message.author ? (
                <Button
                  label="Yazarı 30 dk sustur"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  onPress={() =>
                    ask({
                      title: `${authorLabel(report.message.author)} 30 dakika susturulsun mu?`,
                      run: (reason) =>
                        sanction.mutateAsync({
                          username: report.message.author?.username ?? '',
                          kind: 'mute',
                          minutes: 30,
                          reason,
                          fixture: report.fixture.id,
                        }),
                    })
                  }
                />
              ) : null}
            </View>
          ) : null}
        </ListRow>
      ))}
    </AdminSection>
  );
}

function Sanctions() {
  const { ask, dialog } = useReasonAction();
  const sanctions = useSportsAdminSanctions(true);
  const create = useSportsAdminMutation(sportsAdminApi.sanction);
  const revoke = useSportsAdminMutation(sportsAdminApi.revokeSanction);
  const [username, setUsername] = useState('');
  const [kind, setKind] = useState<'mute' | 'kick' | 'ban'>('mute');
  const [minutes, setMinutes] = useState('60');

  return (
    <AdminSection title="Sohbet yaptırımları" subtitle="Susturma süreli, uzaklaştırma maç bazlı, yasak kalıcıdır (kaldırılabilir).">
      {dialog}
      <View style={sharedStyles.rowLine}>
        <TextField value={username} onChangeText={setUsername} placeholder="@kullanıcıadı" autoCapitalize="none" containerStyle={{ flex: 1, minWidth: 200 }} />
        <FilterChips
          options={[
            { key: 'mute', label: 'Sustur' },
            { key: 'kick', label: 'Uzaklaştır' },
            { key: 'ban', label: 'Yasakla' },
          ]}
          value={kind}
          onChange={setKind}
        />
        {kind !== 'ban' ? (
          <TextField
            value={minutes}
            onChangeText={(text) => setMinutes(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="Dakika"
            containerStyle={{ width: 110 }}
          />
        ) : null}
        <Button
          label="Uygula"
          size="sm"
          fullWidth={false}
          disabled={username.trim().length < 2}
          onPress={() =>
            ask({
              title: `${username.trim()} için yaptırım uygulansın mı?`,
              destructive: kind === 'ban',
              run: async (reason) => {
                await create.mutateAsync({ username: username.trim(), kind, minutes: kind === 'ban' ? null : Number(minutes) || 60, reason });
                setUsername('');
              },
            })
          }
        />
      </View>
      {(sanctions.data?.items ?? []).length === 0 ? <Muted>Aktif yaptırım yok.</Muted> : null}
      {(sanctions.data?.items ?? []).map((item) => (
        <ListRow key={item.id}>
          <View style={sharedStyles.rowLine}>
            <AppText variant="label" style={sharedStyles.flex}>
              {authorLabel(item.user)} · {item.kind}
              {item.fixture_id ? ` · maç #${item.fixture_id}` : ' · tüm maçlar'}
            </AppText>
            <Button
              label="Kaldır"
              size="sm"
              variant="outline"
              fullWidth={false}
              onPress={() => ask({ title: 'Yaptırım kaldırılsın mı?', run: (reason) => revoke.mutateAsync({ id: item.id, reason }) })}
            />
          </View>
          <Muted>
            {fmtTime(item.created_at)} · {authorLabel(item.by)} · bitiş {item.expires_at ? fmtTime(item.expires_at) : 'süresiz'} · {item.reason ?? ''}
          </Muted>
        </ListRow>
      ))}
    </AdminSection>
  );
}

function Moderators() {
  const { ask, dialog } = useReasonAction();
  const moderators = useSportsAdminModerators(true);
  const set = useSportsAdminMutation(sportsAdminApi.setModerator);
  const [username, setUsername] = useState('');

  return (
    <AdminSection title="Sohbet moderatörleri" subtitle="Moderatörler sohbette mesaj kaldırabilir ve kısa süreli yaptırım uygulayabilir.">
      {dialog}
      <View style={sharedStyles.rowLine}>
        <TextField value={username} onChangeText={setUsername} placeholder="@kullanıcıadı" autoCapitalize="none" containerStyle={{ flex: 1, minWidth: 200 }} />
        <Button
          label="Moderatör ekle"
          size="sm"
          fullWidth={false}
          disabled={username.trim().length < 2}
          onPress={() =>
            ask({
              title: `${username.trim()} moderatör yapılsın mı?`,
              run: async (reason) => {
                await set.mutateAsync({ username: username.trim(), add: true, reason });
                setUsername('');
              },
            })
          }
        />
      </View>
      {(moderators.data ?? []).length === 0 ? <Muted>Moderatör yok.</Muted> : null}
      {(moderators.data ?? []).map((item) => (
        <ListRow key={item.user?.id ?? item.created_at}>
          <View style={sharedStyles.rowLine}>
            <AppText variant="label" style={sharedStyles.flex}>
              {authorLabel(item.user)}
            </AppText>
            <Muted>
              {fmtTime(item.created_at)} · ekleyen {authorLabel(item.added_by)}
            </Muted>
            {item.user ? (
              <Button
                label="Kaldır"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={() =>
                  ask({
                    title: `${authorLabel(item.user)} moderatörlükten çıkarılsın mı?`,
                    run: (reason) => set.mutateAsync({ username: item.user?.username ?? '', add: false, reason }),
                  })
                }
              />
            ) : null}
          </View>
        </ListRow>
      ))}
    </AdminSection>
  );
}

function Comments() {
  const { ask, dialog } = useReasonAction();
  const [status, setStatus] = useState<'all' | 'visible' | 'hidden' | 'removed'>('all');
  const comments = useSportsAdminComments(status === 'all' ? null : status, true);
  const action = useSportsAdminMutation(sportsAdminApi.commentAction);

  return (
    <AdminSection title="Maç yorumları" subtitle="Yorum metni değiştirilemez; yalnızca gizlenir, kaldırılır veya geri alınır.">
      {dialog}
      <FilterChips
        options={[
          { key: 'all', label: 'Tümü' },
          { key: 'visible', label: 'Görünür' },
          { key: 'hidden', label: 'Gizli' },
          { key: 'removed', label: 'Kaldırılan' },
        ]}
        value={status}
        onChange={setStatus}
      />
      {(comments.data?.items ?? []).length === 0 ? <Muted>Yorum yok.</Muted> : null}
      {(comments.data?.items ?? []).map((comment) => (
        <ListRow key={comment.id}>
          <View style={sharedStyles.rowLine}>
            <AppText variant="caption" color="textSecondary" style={sharedStyles.flex}>
              {comment.fixture.home} – {comment.fixture.away} · {authorLabel(comment.author)} · {fmtTime(comment.created_at)}
              {comment.parent_id ? ' · yanıt' : ''} · {comment.like_count} beğeni
              {comment.reports ? ` · ${comment.reports} şikâyet` : ''}
            </AppText>
            <StatusBadge status={comment.status} />
          </View>
          <AppText variant="body" selectable>
            {comment.body}
          </AppText>
          {comment.reason ? <Muted>Gerekçe: {comment.reason}</Muted> : null}
          <View style={sharedStyles.actions}>
            {(comment.status === 'visible' ? (['hide', 'remove'] as const) : (['restore'] as const)).map((name) => (
              <Button
                key={name}
                label={{ hide: 'Gizle', remove: 'Kaldır', restore: 'Geri al' }[name]}
                size="sm"
                variant={name === 'remove' ? 'danger' : 'outline'}
                fullWidth={false}
                onPress={() => ask({ title: 'Yorum durumu değiştirilsin mi?', run: (reason) => action.mutateAsync({ id: comment.id, action: name, reason }) })}
              />
            ))}
          </View>
        </ListRow>
      ))}
    </AdminSection>
  );
}

function Media() {
  const { ask, dialog } = useReasonAction();
  const [status, setStatus] = useState<'all' | 'visible' | 'hidden'>('all');
  const media = useSportsAdminMedia(status === 'all' ? null : status, true);
  const action = useSportsAdminMutation(sportsAdminApi.mediaAction);

  return (
    <AdminSection
      title="Taraftar medyası"
      subtitle="Maça bağlanan herkese açık gönderiler. TV/yayın görüntüsü içeren paylaşımları maçtan kaldır; gönderinin kendisi için Gönderi moderasyonunu kullan."
    >
      {dialog}
      <FilterChips
        options={[
          { key: 'all', label: 'Tümü' },
          { key: 'visible', label: 'Görünür' },
          { key: 'hidden', label: 'Gizli' },
        ]}
        value={status}
        onChange={setStatus}
      />
      {(media.data?.items ?? []).length === 0 ? <Muted>Medya yok.</Muted> : null}
      {(media.data?.items ?? []).map((item) => (
        <ListRow key={item.id}>
          <View style={sharedStyles.rowLine}>
            <AppText variant="caption" color="textSecondary" style={sharedStyles.flex}>
              {item.fixture.home} – {item.fixture.away} · {item.category} · {fmtTime(item.created_at)}
            </AppText>
            <StatusBadge status={item.status} />
            <Button
              label={item.status === 'hidden' ? 'Geri al' : 'Maçtan kaldır'}
              size="sm"
              variant="outline"
              fullWidth={false}
              onPress={() =>
                ask({
                  title: item.status === 'hidden' ? 'Medya yeniden gösterilsin mi?' : 'Medya maç sayfasından kaldırılsın mı?',
                  run: (reason) => action.mutateAsync({ id: item.id, action: item.status === 'hidden' ? 'restore' : 'hide', reason }),
                })
              }
            />
          </View>
          {item.hidden_reason ? <Muted>Gerekçe: {item.hidden_reason}</Muted> : null}
          {item.post ? (
            <View style={{ maxWidth: 520 }}>
              <PostCard post={item.post as unknown as FeedPost} />
            </View>
          ) : (
            <Muted>Gönderi artık görünür değil.</Muted>
          )}
        </ListRow>
      ))}
    </AdminSection>
  );
}
