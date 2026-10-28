import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge } from '@/components/ui';
import { MapSheet } from '@/features/map/components/MapSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDateTr } from '@/utils/date';

import type { SavedArea } from '../types';

type Props = {
  visible: boolean;
  areas: SavedArea[];
  onClose: () => void;
  onOpenArea: (area: SavedArea) => void;
  onDelete: (area: SavedArea) => void;
};

/** Kullanıcının çizerek kaydettiği harita alanları. */
export function SavedAreasSheet({ visible, areas, onClose, onOpenArea, onDelete }: Props) {
  const { theme } = useTheme();

  return (
    <MapSheet
      visible={visible}
      onClose={onClose}
      title="Kaydedilen aramalar"
      subtitle={`${areas.length} kayıtlı alan · bildirim tercihleri hesabına bağlıdır`}
      maxHeightRatio={0.88}
    >
      {areas.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bookmark-outline" size={28} color={theme.colors.textTertiary} />
          <AppText variant="bodyStrong">Kayıtlı alan yok</AppText>
          <AppText variant="caption" color="textTertiary" align="center">
            Haritada alan çizip “Aramayı kaydet” ile ilgilendiğin bölgeyi saklayabilirsin.
          </AppText>
        </View>
      ) : null}

      {areas.map((area) => (
        <Pressable
          key={area.id}
          accessibilityRole="button"
          accessibilityLabel={`${area.label} alanını aç`}
          onPress={() => onOpenArea(area)}
          style={({ pressed }) => [
            styles.row,
            {
              borderColor: theme.colors.border,
              backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
            },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="shapes-outline" size={18} color={theme.colors.primaryDeep} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {area.label}
            </AppText>
            <AppText variant="caption" color="textTertiary">
              {area.area_kind === 'real_estate' ? 'Emlak araması' : 'Harita araması'} ·{' '}
              {formatDateTr(area.created_at)}
            </AppText>
            <View style={styles.badges}>
              <Badge
                label={area.notify_enabled ? 'Bildirim açık' : 'Bildirim kapalı'}
                tone={area.notify_enabled ? 'success' : 'neutral'}
              />
              {area.geometry ? <Badge label="Polygon" tone="primary" /> : null}
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${area.label} aramasını sil`}
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation();
              onDelete(area);
            }}
            style={styles.delete}
          >
            <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
          </Pressable>
        </Pressable>
      ))}
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  badges: { flexDirection: 'row', gap: 5, marginTop: 3 },
  delete: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
