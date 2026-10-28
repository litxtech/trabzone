import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { useAdminExploreMutation, useAdminPlaces } from '@/features/explore/hooks/use-explore';
import * as api from '@/features/explore/services/explore-service';
import type { AdminPlaceDetail, AdminPlaceRow } from '@/features/explore/types';
import { useTheme } from '@/theme/ThemeProvider';

import { AdminDetailModal, AdminEmptyState, AdminQueryState } from './AdminExploreShared';
import { PLACE_STATUS_LABELS, statusLabel } from './labels';

type Props = {
  source: AdminPlaceDetail;
  onClose: () => void;
  onMerged: () => void;
};

/**
 * Yinelenen iki işletme kaydını birleştirir. Kaynak kayıt silinmez;
 * `duplicate` durumuna alınır ve tüm ilişkileri hedef kayda taşınır.
 * İşlem sunucuda `admin_place_merge` ile denetim kaydına yazılır.
 */
export function MergePlaceModal({ source, onClose, onMerged }: Props) {
  const { theme } = useTheme();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<AdminPlaceRow | null>(null);
  const [reason, setReason] = useState('');

  const search = useAdminPlaces({ q: query.trim() || null, limit: 12 });
  const mutation = useAdminExploreMutation(
    (input: { sourceId: string; targetId: string; reason: string }) =>
      api.adminMergePlace(input.sourceId, input.targetId, input.reason),
  );

  const rows = (search.data?.items ?? []).filter((item) => item.id !== source.id);
  const canSubmit = Boolean(target) && reason.trim().length >= 3 && !mutation.isPending;

  const submit = () => {
    if (!target) {
      Alert.alert('Hedef seç', 'Kaydın birleştirileceği işletmeyi seç.');
      return;
    }
    if (reason.trim().length < 3) {
      Alert.alert('Gerekçe gerekli', 'Birleştirme kararı için en az 3 karakterlik gerekçe yaz.');
      return;
    }
    mutation.mutate(
      { sourceId: source.id, targetId: target.id, reason: reason.trim() },
      {
        onSuccess: () => {
          Alert.alert(
            'Kayıtlar birleştirildi',
            `"${source.name}" kaydı "${target.name}" ile birleştirildi.`,
          );
          onMerged();
        },
        onError: (cause) => Alert.alert('Birleştirilemedi', cause.message),
      },
    );
  };

  return (
    <AdminDetailModal
      visible
      title="Mükerrer kaydı birleştir"
      subtitle={`Kaynak: ${source.name}`}
      onClose={onClose}
      maxWidth={680}
      footer={
        <>
          <Button label="Vazgeç" size="sm" variant="outline" fullWidth={false} onPress={onClose} />
          <Button
            label="Birleştir"
            size="sm"
            variant="danger"
            fullWidth={false}
            disabled={!canSubmit}
            loading={mutation.isPending}
            onPress={submit}
          />
        </>
      }
    >
      <View
        style={[
          styles.notice,
          { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.border },
        ]}
      >
        <Ionicons name="git-merge-outline" size={18} color={theme.colors.warning} />
        <AppText variant="caption" color="textSecondary" style={styles.flex}>
          Kaynak kaydın yorumları, medyası, favorileri ve sahiplik bağlantıları hedefe taşınır.
          Kaynak kayıt “Mükerrer” durumunda kalır; hiçbir kullanıcı verisi silinmez.
        </AppText>
      </View>

      <TextField
        label="Hedef işletme ara"
        value={query}
        onChangeText={setQuery}
        placeholder="İşletme adı veya adres…"
        leftIcon="search"
        autoCapitalize="none"
      />

      {target ? (
        <View
          style={[
            styles.selected,
            {
              borderColor: theme.colors.primary,
              backgroundColor: theme.colors.primarySoft,
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={18} color={theme.colors.primaryDeep} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{target.name}</AppText>
            <AppText variant="caption" color="textSecondary">
              {[target.district, target.neighborhood].filter(Boolean).join(' / ') || 'Konum yok'}
            </AppText>
          </View>
          <Button
            label="Kaldır"
            size="sm"
            variant="ghost"
            fullWidth={false}
            onPress={() => setTarget(null)}
          />
        </View>
      ) : null}

      <AdminQueryState
        loading={search.isLoading}
        error={search.isError ? search.error.message : null}
        onRetry={() => void search.refetch()}
      >
        {rows.length === 0 ? (
          <AdminEmptyState
            icon="search-outline"
            tone="neutral"
            title="Eşleşen kayıt yok"
            text="Hedef işletmenin adını veya adresini yazarak aramayı daralt."
          />
        ) : (
          <View style={styles.list}>
            {rows.map((item) => {
              const active = target?.id === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTarget(item)}
                  style={[
                    styles.row,
                    {
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                    },
                  ]}
                >
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {item.name}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {[
                        item.category_name,
                        [item.district, item.neighborhood].filter(Boolean).join(' / '),
                        statusLabel(item.status, PLACE_STATUS_LABELS),
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Bilgi yok'}
                    </AppText>
                  </View>
                  {active ? (
                    <Ionicons name="checkmark-circle" size={18} color={theme.colors.primaryDeep} />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={theme.colors.textTertiary}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </AdminQueryState>

      <TextField
        label="Birleştirme gerekçesi"
        value={reason}
        onChangeText={setReason}
        placeholder="Örn. aynı işletmenin iki kez eklenmiş kaydı"
        multiline
        maxLength={400}
      />
    </AdminDetailModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  selected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
