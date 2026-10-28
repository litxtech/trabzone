import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { useNewsApiPublishers, useNewsApiSaveProfile } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import type { NewsConnection, NewsSourceProfile } from '@/features/news-api/types';

import { NewsModalShell } from './NewsModalShell';
import { ChipSelect, EmptyHint, ToggleRow, newsApiStyles } from './shared';

const STATUS_OPTIONS = [
  { value: 'unpublished', label: 'Yayında değil' },
  { value: 'active', label: 'Aktif' },
  { value: 'removed', label: 'Kaldırıldı' },
];

export function NewsProfileModal({
  visible,
  connection,
  profile,
  profileShared,
  onClose,
}: {
  visible: boolean;
  connection: NewsConnection;
  profile: NewsSourceProfile | null;
  profileShared?: boolean;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useNewsApiSaveProfile();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? connection.name);
  const [username, setUsername] = useState(profile?.username ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [coverUrl, setCoverUrl] = useState(profile?.cover_url ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [website, setWebsite] = useState(profile?.website ?? connection.homepage_url ?? '');
  const [status, setStatus] = useState<string>(profile?.status ?? 'unpublished');
  const [verified, setVerified] = useState(profile?.verified ?? false);
  const [verificationNote, setVerificationNote] = useState(profile?.verification_note ?? '');
  const [profileId, setProfileId] = useState<string | null>(profile?.profile_id ?? connection.publisher_profile_id ?? null);
  const [publisherSearch, setPublisherSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const publishers = useNewsApiPublishers(publisherSearch, visible);
  const selectedPublisher = (publishers.data?.items ?? []).find((row) => row.id === profileId);

  const submit = async () => {
    if (displayName.trim().length < 2) {
      setError('Görünen ad en az 2 karakter olmalı.');
      return;
    }
    if (verified && !profileId) {
      setError('Doğrulama rozeti için önce bir Trabzone profili bağla.');
      return;
    }
    if (verified && verificationNote.trim().length < 3) {
      setError('Doğrulama için doğrulama notu zorunludur.');
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        id: connection.id,
        payload: {
          profile_id: profileId,
          display_name: displayName.trim(),
          username: username.trim() || null,
          avatar_url: avatarUrl.trim() || null,
          cover_url: coverUrl.trim() || null,
          description: description.trim() || null,
          website: website.trim() || null,
          status: status as NewsSourceProfile['status'],
          verified,
          verification_note: verificationNote.trim() || null,
        },
      });
      toast.success('Kaynak profili kaydedildi.');
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError, 'Kaynak profili kaydedilemedi.'));
    }
  };

  return (
    <NewsModalShell
      visible={visible}
      title="Kaynak Profili"
      subtitle={`${connection.name} · MOD A kaynak yayını bu profilde paylaşılır`}
      onClose={onClose}
      footer={
        <>
          <Button label="Vazgeç" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
          <Button label="Profili kaydet" size="sm" fullWidth={false} loading={save.isPending} onPress={() => void submit()} />
        </>
      }
    >
      {profileShared ? (
        <View style={[styles.warn, { borderColor: theme.colors.warning, backgroundColor: theme.colors.warningSoft }]}>
          <AppText variant="caption" color="warning">
            Bu profil başka bir kaynak veya kullanıcıyla paylaşılıyor. Kaynak silinse bile profil otomatik silinmez.
          </AppText>
        </View>
      ) : null}

      <TextField label="Görünen ad" value={displayName} onChangeText={setDisplayName} />
      <TextField
        label="Kullanıcı adı"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        placeholder="kaynakhbr"
      />
      <TextField label="Avatar URL" value={avatarUrl} onChangeText={setAvatarUrl} autoCapitalize="none" />
      <TextField label="Kapak görseli URL" value={coverUrl} onChangeText={setCoverUrl} autoCapitalize="none" />
      <TextField label="Açıklama" value={description} onChangeText={setDescription} multiline style={styles.multiline} />
      <TextField label="Resmî site" value={website} onChangeText={setWebsite} autoCapitalize="none" />

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">Profil durumu</AppText>
        <ChipSelect options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </View>

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">Trabzone profili bağla</AppText>
        <TextField
          value={publisherSearch}
          onChangeText={setPublisherSearch}
          placeholder="Kullanıcı adı veya görünen ad ara"
          autoCapitalize="none"
        />
        {selectedPublisher ? (
          <View style={[styles.publisher, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft }]}>
            <View style={newsApiStyles.flex}>
              <AppText variant="label">{selectedPublisher.display_name ?? selectedPublisher.username ?? 'Profil'}</AppText>
              <AppText variant="caption" color="textSecondary">
                @{selectedPublisher.username ?? '—'} · {new Intl.NumberFormat('tr-TR').format(selectedPublisher.followers_count)} takipçi
              </AppText>
            </View>
            {selectedPublisher.is_verified ? <Badge label="Doğrulanmış" tone="success" /> : null}
            <Button label="Kaldır" size="sm" variant="ghost" fullWidth={false} onPress={() => setProfileId(null)} />
          </View>
        ) : (
          <EmptyHint text="Profil bağlanmadı. Otomatik yayın için bir yayıncı profili gerekir." />
        )}
        <View style={styles.publisherList}>
          {(publishers.data?.items ?? [])
            .filter((row) => row.id !== profileId)
            .slice(0, 8)
            .map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                onPress={() => {
                  setProfileId(row.id);
                  if (!displayName || displayName === connection.name) {
                    setDisplayName(row.display_name ?? row.username ?? connection.name);
                  }
                  if (!username) setUsername(row.username ?? '');
                }}
                style={[styles.publisherRow, { borderColor: theme.colors.border }]}
              >
                <AppText variant="caption" style={newsApiStyles.flex} numberOfLines={1}>
                  {row.display_name ?? row.username ?? row.id}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  @{row.username ?? '—'}
                </AppText>
              </Pressable>
            ))}
        </View>
      </View>

      <ToggleRow
        title="Doğrulanmış kaynak"
        description="Yalnızca gerçekten doğrulanmış haber kuruluşları için işaretlenmeli."
        value={verified}
        onValueChange={setVerified}
      />
      {verified ? (
        <TextField
          label="Doğrulama notu"
          value={verificationNote}
          onChangeText={setVerificationNote}
          placeholder="Doğrulama kaynağı, tarih ve yöntem"
          multiline
          style={styles.multiline}
        />
      ) : null}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </NewsModalShell>
  );
}

const styles = StyleSheet.create({
  warn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11 },
  multiline: { minHeight: 72 },
  publisher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    flexWrap: 'wrap',
  },
  publisherList: { gap: 4 },
  publisherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
