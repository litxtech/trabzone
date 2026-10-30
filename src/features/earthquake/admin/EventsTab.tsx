import { useState } from 'react';
import { View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { AdminSection, FilterChips } from '@/features/admin/components/AdminPage';
import { AdminQueryState } from '@/features/explore/admin/AdminExploreShared';
import { formatDateTime, Pill, RowCard } from '@/features/pharmacy/admin/shared';
import { useRouter } from '@/utils/router';

import type { EarthquakeSource } from '../types';
import { formatDecimal, formatDepth, formatDistance, formatMagnitude, SOURCE_LABELS } from '../utils/format';
import {
  adminApi,
  useAdminEvent,
  useAdminEvents,
  useAdminMatchReviews,
  useEarthquakeAdminMutation,
  type AdminEventRow,
} from './api';
import { KeyValue, SKIP_REASONS, STATUS_LABELS, useReasonAction } from './ui';

type StatusFilter = 'all' | AdminEventRow['status'];

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'removed') return 'danger';
  if (status === 'under_review' || status === 'pending_match') return 'warning';
  return 'neutral';
}

function str(value: unknown): string {
  if (value == null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function EventsTab({ canReview }: { canReview: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<'all' | EarthquakeSource>('all');
  const [region, setRegion] = useState<'all' | 'province' | 'r150' | 'turkey'>('r150');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const events = useAdminEvents(
    { status: status === 'all' ? null : status, source: source === 'all' ? null : source, region: region === 'all' ? null : region, search, offset },
    true,
  );
  const detail = useAdminEvent(selected);
  const reviews = useAdminMatchReviews('pending', true);
  const action = useEarthquakeAdminMutation(adminApi.eventAction);
  const resolve = useEarthquakeAdminMutation(adminApi.resolveMatch);
  const { ask, dialog } = useReasonAction();

  const doAction = (id: string, kind: string, title: string, description?: string, value?: string | null, destructive?: boolean) =>
    ask({
      title,
      description,
      destructive,
      run: (reason) => action.mutateAsync({ id, action: kind, reason, value }),
      success: 'Kayıt güncellendi.',
    });

  const items = events.data?.items ?? [];
  const d = detail.data;
  const e = d?.event;

  return (
    <View style={{ gap: 14 }}>
      <AdminSection
        title="Eşleştirme bekleyen kayıtlar"
        subtitle="Birden fazla aday bulunan veya belirsiz eşleşen AFAD/USGS kayıtları. Karar verilene kadar ikincil kayıt kullanıcıya gösterilmez."
      >
        <AdminQueryState loading={reviews.isLoading} error={reviews.isError ? reviews.error.message : null} onRetry={() => void reviews.refetch()}>
          {(reviews.data?.items ?? []).length === 0 ? (
            <AppText variant="caption" color="textSecondary">
              Bekleyen eşleştirme yok.
            </AppText>
          ) : (
            (reviews.data?.items ?? []).map((review) => (
              <RowCard
                key={review.id}
                title={`${review.record ? `${SOURCE_LABELS[review.record.source]} ${review.record.source_event_id}` : 'Kayıt'} ↔ ${review.candidate?.canonical_id ?? '—'}`}
                subtitle={`Δt ${formatDecimal(review.dt_seconds, 1)} sn · Δmesafe ${formatDecimal(review.distance_km, 1)} km · ΔM ${formatDecimal(review.magnitude_delta, 1)} · ${review.candidate_count} aday`}
                meta={`Kayıt: ${review.record ? `${formatMagnitude(review.record.magnitude, review.record.magnitude_type)} · ${formatDateTime(review.record.occurred_at)} · ${review.record.location ?? ''}` : '—'}\nAday: ${
                  review.candidate ? `${formatMagnitude(review.candidate.magnitude, review.candidate.magnitude_type)} · ${formatDateTime(review.candidate.occurred_at)} · ${review.candidate.location ?? ''}` : '—'
                }`}
                actions={
                  canReview ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Button
                        label="Aynı deprem"
                        size="sm"
                        fullWidth={false}
                        onPress={() =>
                          ask({
                            title: 'Kayıtlar aynı deprem olarak birleştirilsin mi?',
                            description: 'Birincil kaynağı taşıyan olay korunur; diğeri ona yönlendirilir. Kaynak değerleri değiştirilmez.',
                            run: (reason) => resolve.mutateAsync({ reviewId: review.id, decision: 'link', reason }),
                          })
                        }
                      />
                      <Button
                        label="Farklı depremler"
                        size="sm"
                        variant="outline"
                        fullWidth={false}
                        onPress={() =>
                          ask({
                            title: 'Kayıtlar ayrı depremler olarak işaretlensin mi?',
                            run: (reason) => resolve.mutateAsync({ reviewId: review.id, decision: 'reject', reason }),
                          })
                        }
                      />
                    </View>
                  ) : undefined
                }
              />
            ))
          )}
        </AdminQueryState>
      </AdminSection>

      <AdminSection title="Deprem kayıtları">
        <TextField
          label="Ara"
          placeholder="Olay kimliği, kaynak olay no veya yer"
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            setOffset(0);
          }}
        />
        <FilterChips
          options={[
            { key: 'all', label: 'Tüm bölgeler' },
            { key: 'province', label: 'Trabzon ili' },
            { key: 'r150', label: '150 km' },
            { key: 'turkey', label: 'Türkiye' },
          ]}
          value={region}
          onChange={(value) => {
            setRegion(value as typeof region);
            setOffset(0);
          }}
        />
        <FilterChips
          options={(['all', 'active', 'under_review', 'pending_match', 'merged', 'removed'] as const).map((key) => ({
            key,
            label: key === 'all' ? 'Tüm durumlar' : STATUS_LABELS[key] ?? key,
          }))}
          value={status}
          onChange={(value) => {
            setStatus(value as StatusFilter);
            setOffset(0);
          }}
        />
        <FilterChips
          options={[
            { key: 'all', label: 'Tüm kaynaklar' },
            { key: 'afad', label: 'AFAD' },
            { key: 'usgs', label: 'USGS' },
          ]}
          value={source}
          onChange={(value) => {
            setSource(value as typeof source);
            setOffset(0);
          }}
        />
        <AdminQueryState loading={events.isLoading} error={events.isError ? events.error.message : null} onRetry={() => void events.refetch()}>
          {items.length === 0 ? (
            <AppText variant="caption" color="textSecondary">
              Kayıt yok.
            </AppText>
          ) : null}
          {items.map((item) => (
            <RowCard
              key={item.id}
              selected={selected === item.id}
              onPress={() => setSelected(selected === item.id ? null : item.id)}
              title={`${formatMagnitude(item.magnitude, item.magnitude_type)} · ${item.location ?? '—'}`}
              subtitle={`${item.canonical_id} · ${formatDateTime(item.occurred_at)} · Derinlik ${formatDepth(item.depth_km)} · Trabzon’a ${formatDistance(item.distance_km)}`}
              meta={`Kaynaklar: ${item.sources.map((s) => SOURCE_LABELS[s]).join(', ')} (gösterilen ${SOURCE_LABELS[item.preferred_source]}) · rev. ${item.revision} · bildirim: ${item.notification_state}${
                item.notification_skip_reason ? ` (${SKIP_REASONS[item.notification_skip_reason] ?? item.notification_skip_reason})` : ''
              }`}
              badges={
                <>
                  <Pill label={STATUS_LABELS[item.status] ?? item.status} tone={statusTone(item.status)} />
                  {item.pending_reviews > 0 ? <Pill label="Eşleştirme bekliyor" tone="warning" /> : null}
                  {item.has_admin_note ? <Pill label="Not var" /> : null}
                </>
              }
            />
          ))}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Önceki" size="sm" variant="outline" fullWidth={false} disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 30))} />
            <Button label="Sonraki" size="sm" variant="outline" fullWidth={false} disabled={items.length < 30} onPress={() => setOffset(offset + 30)} />
          </View>
        </AdminQueryState>
      </AdminSection>

      {selected ? (
        <AdminSection
          title="Kayıt ayrıntısı"
          action={<Button label="Kapat" size="sm" variant="ghost" fullWidth={false} onPress={() => setSelected(null)} />}
        >
          <AdminQueryState loading={detail.isLoading} error={detail.isError ? detail.error.message : null} onRetry={() => void detail.refetch()}>
            {d && e ? (
              <View style={{ gap: 10 }}>
                <KeyValue label="Olay kimliği" value={e.canonical_event_id} />
                <KeyValue label="Durum" value={STATUS_LABELS[e.status] ?? e.status} />
                <KeyValue label="Gösterilen kaynak" value={SOURCE_LABELS[e.preferred_source]} />
                <KeyValue label="Büyüklük" value={`${str(e.magnitude_type)} ${str(e.magnitude)}`} />
                <KeyValue label="Derinlik (km)" value={str(e.depth_km)} />
                <KeyValue label="Konum" value={`${str(e.latitude)}, ${str(e.longitude)} · ${str(e.location_description)}`} />
                <KeyValue label="Bölge sınıfı" value={`${str(e.region_classification)}${d.district_name ? ` · ${d.district_name}` : ''}`} />
                <KeyValue label="Görüntülenme" value={String(d.views)} />
                <KeyValue label="İç not" value={e.admin_note ?? '—'} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Button label="Kullanıcı sayfasını aç" size="sm" variant="ghost" fullWidth={false} onPress={() => router.push(`/deprem/${e.canonical_event_id}` as never)} />
                  {canReview ? (
                    <>
                      {e.status === 'active' ? (
                        <Button label="İncelemeye al" size="sm" variant="outline" fullWidth={false} onPress={() => doAction(e.id, 'flag', 'Kayıt incelemeye alınsın mı?', 'Kayıt kullanıcılara görünmeye devam eder; incelemede olarak işaretlenir.')} />
                      ) : null}
                      {e.status === 'under_review' ? (
                        <Button label="İncelemeyi kapat" size="sm" variant="outline" fullWidth={false} onPress={() => doAction(e.id, 'unflag', 'İnceleme kapatılsın mı?')} />
                      ) : null}
                      {e.status !== 'removed' && e.status !== 'merged' ? (
                        <Button
                          label="Yayından kaldır"
                          size="sm"
                          variant="danger"
                          fullWidth={false}
                          onPress={() =>
                            doAction(e.id, 'remove', 'Kayıt yayından kaldırılsın mı?', 'Kayıt silinmez; kullanıcılara gösterilmez ve bekleyen bildirimleri iptal edilir.', null, true)
                          }
                        />
                      ) : null}
                      {e.status === 'removed' ? (
                        <Button label="Geri yükle" size="sm" variant="outline" fullWidth={false} onPress={() => doAction(e.id, 'restore', 'Kayıt geri yüklensin mi?')} />
                      ) : null}
                      {e.sources
                        .filter((s) => s !== e.preferred_source)
                        .map((s) => (
                          <Button
                            key={s}
                            label={`${SOURCE_LABELS[s]} değerlerini göster`}
                            size="sm"
                            variant="outline"
                            fullWidth={false}
                            onPress={() =>
                              doAction(e.id, 'set_preferred', `Gösterilen kaynak ${SOURCE_LABELS[s]} olsun mu?`, 'Değerler bağlı kaynak kaydından olduğu gibi alınır; elle değer girilmez.', s)
                            }
                          />
                        ))}
                    </>
                  ) : null}
                </View>
                {canReview ? (
                  <View style={{ gap: 6 }}>
                    <TextField label="İç not" value={note ?? e.admin_note ?? ''} onChangeText={setNote} multiline maxLength={2000} />
                    <Button
                      label="Notu kaydet"
                      size="sm"
                      variant="outline"
                      fullWidth={false}
                      disabled={note == null}
                      onPress={() => doAction(e.id, 'note', 'İç not kaydedilsin mi?', undefined, note ?? '')}
                    />
                  </View>
                ) : null}

                <AppText variant="label">Kaynak kayıtları (değiştirilmemiş)</AppText>
                {d.records.map((record) => (
                  <AppText key={record.id} variant="caption" color="textSecondary">
                    {SOURCE_LABELS[record.source_name]} {record.source_event_id} · {str(record.source_magnitude_type)} {str(record.source_magnitude)} · derinlik{' '}
                    {str(record.source_depth_km)} · {str(record.source_latitude)}, {str(record.source_longitude)} · {str(record.source_timestamp)} · eşleşme{' '}
                    {str(record.match_method)} · rev. {str(record.revision)}
                  </AppText>
                ))}

                <AppText variant="label">Revizyonlar</AppText>
                {d.revisions.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Yok
                  </AppText>
                ) : (
                  d.revisions.map((revision, index) => (
                    <AppText key={index} variant="caption" color="textSecondary">
                      {formatDateTime(String(revision.created_at))} · {str(revision.change_kind)} · {str(revision.source_name)} · {str(revision.changes)}
                    </AppText>
                  ))
                )}

                <AppText variant="label">Bildirimler</AppText>
                {d.notifications.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Yok
                  </AppText>
                ) : (
                  d.notifications.map((n, index) => (
                    <AppText key={index} variant="caption" color="textSecondary">
                      {formatDateTime(String(n.created_at))} · {str(n.type)} · {STATUS_LABELS[String(n.status)] ?? str(n.status)} · alıcı {str(n.recipients)} · push {str(n.push_queued)}
                      {n.skip_reason ? ` · ${SKIP_REASONS[String(n.skip_reason)] ?? str(n.skip_reason)}` : ''}
                    </AppText>
                  ))
                )}

                <AppText variant="label">Audit</AppText>
                {d.audit.length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Yok
                  </AppText>
                ) : (
                  d.audit.map((entry, index) => (
                    <AppText key={index} variant="caption" color="textSecondary">
                      {formatDateTime(String(entry.created_at))} · {str(entry.operation)} · Gerekçe: {str(entry.reason)} · Eski: {str(entry.old_value)} · Yeni:{' '}
                      {str(entry.new_value)}
                    </AppText>
                  ))
                )}
              </View>
            ) : null}
          </AdminQueryState>
        </AdminSection>
      ) : null}
      {dialog}
    </View>
  );
}
