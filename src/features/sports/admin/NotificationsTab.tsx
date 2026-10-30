import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { useReasonAction } from '@/features/earthquake/admin/ui';

import {
  sportsAdminApi,
  useSportsAdminAudit,
  useSportsAdminLogs,
  useSportsAdminMutation,
  useSportsAdminNotifications,
} from './api';
import { authorLabel, fmtTime, ListRow, Muted, sharedStyles, StatusBadge } from './shared';

const TYPE_LABELS: Record<string, string> = {
  reminder: 'Hatırlatma',
  lineups: 'Kadro',
  kickoff: 'Başlama',
  goal_for: 'Trabzonspor golü',
  goal_against: 'Rakip golü',
  red_card: 'Kırmızı kart',
  half_time: 'Devre arası',
  full_time: 'Maç sonu',
  postponed: 'Erteleme/iptal',
  correction: 'Düzeltme',
  announcement: 'Duyuru',
  test: 'Test',
};

export function NotificationsTab({ canNotify }: { canNotify: boolean }) {
  const toast = useAdminToast();
  const { ask, dialog } = useReasonAction();
  const [offset, setOffset] = useState(0);
  const list = useSportsAdminNotifications(offset, true);
  const announce = useSportsAdminMutation(sportsAdminApi.announcement);
  const testPush = useSportsAdminMutation(sportsAdminApi.testPush);
  const cancel = useSportsAdminMutation(sportsAdminApi.cancelNotification);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [fixture, setFixture] = useState('');

  return (
    <View style={sharedStyles.gap}>
      {dialog}
      {canNotify ? (
        <AdminSection
          title="Duyuru gönder"
          subtitle="Yalnızca “Duyurular” bildirimini açık tutan kullanıcılara gider. Saatte en fazla 10 duyuru."
        >
          <TextField label="Başlık" value={title} onChangeText={setTitle} maxLength={120} />
          <TextField label="Metin" value={body} onChangeText={setBody} maxLength={300} multiline />
          <TextField
            label="Maç kimliği (isteğe bağlı)"
            value={fixture}
            onChangeText={(text) => setFixture(text.replace(/[^0-9-]/g, ''))}
            hint="Dolu ise bildirim maç sayfasına açılır."
          />
          <View style={sharedStyles.actions}>
            <Button
              label="Duyuruyu kuyruğa al"
              size="sm"
              fullWidth={false}
              disabled={title.trim().length < 3 || body.trim().length < 5}
              loading={announce.isPending}
              onPress={() =>
                ask({
                  title: 'Duyuru gönderilsin mi?',
                  description: 'Onay vermiş tüm abonelere gönderilir.',
                  run: async (reason) => {
                    await announce.mutateAsync({ fixture: fixture ? Number(fixture) : null, title: title.trim(), body: body.trim(), reason });
                    setTitle('');
                    setBody('');
                  },
                  success: 'Duyuru kuyruğa alındı.',
                })
              }
            />
            <Button
              label="Kendime test bildirimi"
              size="sm"
              variant="outline"
              fullWidth={false}
              loading={testPush.isPending}
              onPress={() =>
                testPush.mutate(
                  {},
                  {
                    onSuccess: () => toast.success('Test bildirimi kuyruğa alındı; yalnızca sana gönderilir.'),
                    onError: (error) => toast.error(error.message),
                  },
                )
              }
            />
          </View>
        </AdminSection>
      ) : null}

      <AdminSection title="Bildirim olayları" subtitle="Her olay benzersiz anahtarla bir kez üretilir; VAR iptallerinde düzeltme olayı gönderilir.">
        {list.isLoading ? <ActivityIndicator /> : null}
        {(list.data?.items ?? []).map((item) => (
          <ListRow key={item.id}>
            <View style={sharedStyles.rowLine}>
              <Badge label={TYPE_LABELS[item.type] ?? item.type} tone="primary" />
              {item.is_test ? <Badge label="TEST" tone="warning" /> : null}
              <AppText variant="label" style={sharedStyles.flex}>
                {item.title}
              </AppText>
              <StatusBadge status={item.status} />
            </View>
            <AppText variant="caption">{item.body}</AppText>
            <Muted>
              {fmtTime(item.created_at)}
              {item.fixture_id ? ` · maç #${item.fixture_id}` : ''} · {item.recipients ?? 0} alıcı
              {item.push
                ? ` · push: ${item.push.sent} gönderildi, ${item.push.delivered} teslim, ${item.push.pending} bekliyor, ${item.push.suppressed} bastırıldı, ${item.push.failed} başarısız`
                : ''}
            </Muted>
            {item.last_error ? (
              <AppText variant="caption" color="danger">
                {item.last_error}
              </AppText>
            ) : null}
            {canNotify && (item.status === 'pending' || item.status === 'fanning_out') ? (
              <Button
                label="İptal et"
                size="sm"
                variant="outline"
                fullWidth={false}
                onPress={() => ask({ title: 'Bildirim iptal edilsin mi?', destructive: true, run: (reason) => cancel.mutateAsync({ id: item.id, reason }) })}
              />
            ) : null}
          </ListRow>
        ))}
        <View style={sharedStyles.actions}>
          <Button label="Önceki" size="sm" variant="outline" fullWidth={false} disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 30))} />
          <Button
            label="Sonraki"
            size="sm"
            variant="outline"
            fullWidth={false}
            disabled={(list.data?.items.length ?? 0) < 30}
            onPress={() => setOffset(offset + 30)}
          />
        </View>
      </AdminSection>
    </View>
  );
}

export function LogsTab() {
  const [section, setSection] = useState<'logs' | 'audit'>('logs');
  const [status, setStatus] = useState<'all' | 'ok' | 'error' | 'quota' | 'skipped'>('all');
  const [offset, setOffset] = useState(0);
  const logs = useSportsAdminLogs(status === 'all' ? null : status, offset, section === 'logs');
  const audit = useSportsAdminAudit(offset, section === 'audit');

  return (
    <View style={sharedStyles.gap}>
      <FilterChips
        options={[
          { key: 'logs', label: 'API istek kayıtları' },
          { key: 'audit', label: 'Denetim kaydı' },
        ]}
        value={section}
        onChange={(next) => {
          setSection(next);
          setOffset(0);
        }}
      />
      {section === 'logs' ? (
        <>
          <AdminSection title="Kota kullanımı (14 gün)">
            {(logs.data?.usage ?? []).length === 0 ? <Muted>Kayıt yok.</Muted> : null}
            {(logs.data?.usage ?? []).map((row) => (
              <AppText key={`${row.day}-${row.endpoint}`} variant="caption">
                {row.day} · /{row.endpoint} · {row.requests} istek · {row.failures} hata
              </AppText>
            ))}
          </AdminSection>
          <AdminSection title="İstekler" subtitle="API anahtarı hiçbir kayıtta tutulmaz.">
            <FilterChips
              options={[
                { key: 'all', label: 'Tümü' },
                { key: 'ok', label: 'Başarılı' },
                { key: 'error', label: 'Hata' },
                { key: 'quota', label: 'Kota' },
                { key: 'skipped', label: 'Atlandı' },
              ]}
              value={status}
              onChange={(next) => {
                setStatus(next);
                setOffset(0);
              }}
            />
            {logs.isLoading ? <ActivityIndicator /> : null}
            {(logs.data?.items ?? []).map((log) => (
              <ListRow key={log.id}>
                <View style={sharedStyles.rowLine}>
                  <AppText variant="caption" style={sharedStyles.flex}>
                    {fmtTime(log.created_at)} · {log.job}
                    {log.endpoint ? ` · /${log.endpoint}` : ''}
                    {log.http_status ? ` · HTTP ${log.http_status}` : ''}
                    {log.duration_ms != null ? ` · ${log.duration_ms} ms` : ''}
                    {log.results != null ? ` · ${log.results} sonuç` : ''}
                    {log.remaining != null ? ` · kalan ${log.remaining}` : ''}
                  </AppText>
                  <StatusBadge status={log.status} />
                </View>
                {log.error ? (
                  <AppText variant="caption" color="danger" selectable>
                    {log.error}
                  </AppText>
                ) : null}
              </ListRow>
            ))}
          </AdminSection>
        </>
      ) : (
        <AdminSection title="Denetim kaydı" subtitle="Tüm yönetim işlemleri gerekçe, önceki ve sonraki değerle kaydedilir.">
          {audit.isLoading ? <ActivityIndicator /> : null}
          {(audit.data?.items ?? []).map((entry) => (
            <ListRow key={entry.id}>
              <AppText variant="label">
                {entry.action} · {entry.target_type}
                {entry.target_id ? ` #${entry.target_id}` : ''}
              </AppText>
              <Muted>
                {fmtTime(entry.at)} · {authorLabel(entry.actor)}
                {entry.reason ? ` · “${entry.reason}”` : ''}
              </Muted>
              {entry.before || entry.after ? (
                <AppText variant="caption" color="textSecondary" selectable numberOfLines={4}>
                  {entry.before ? `Önce: ${JSON.stringify(entry.before)}` : ''}
                  {entry.after ? `${entry.before ? '\n' : ''}Sonra: ${JSON.stringify(entry.after)}` : ''}
                </AppText>
              ) : null}
            </ListRow>
          ))}
        </AdminSection>
      )}
      <View style={sharedStyles.actions}>
        <Button label="Önceki" size="sm" variant="outline" fullWidth={false} disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 40))} />
        <Button label="Sonraki" size="sm" variant="outline" fullWidth={false} onPress={() => setOffset(offset + 40)} />
      </View>
    </View>
  );
}
