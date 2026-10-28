import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';

import { AppText, Button, IconButton } from '@/components/ui';
import { MapCanvas } from '@/features/map/components/MapCanvas';
import type { MapCamera, MapPoint } from '@/features/map/types';
import { useTheme } from '@/theme/ThemeProvider';

export function AdminAccessDenied({ message }: { message: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.denied,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
    >
      <View style={[styles.deniedIcon, { backgroundColor: theme.colors.dangerSoft }]}>
        <Ionicons name="lock-closed-outline" size={22} color={theme.colors.danger} />
      </View>
      <AppText variant="h3" align="center">
        Yetki gerekli
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {message}
      </AppText>
    </View>
  );
}

export function AdminEmptyState({
  icon = 'checkmark-done-outline',
  title,
  text,
  tone = 'success',
  action,
}: {
  icon?: ComponentProps<typeof Ionicons>['name'];
  title: string;
  text?: string;
  tone?: 'success' | 'danger' | 'neutral';
  action?: ReactNode;
}) {
  const { theme } = useTheme();
  const color =
    tone === 'danger'
      ? theme.colors.danger
      : tone === 'neutral'
        ? theme.colors.textTertiary
        : theme.colors.success;
  return (
    <View style={[styles.empty, { borderColor: theme.colors.border }]}>
      <Ionicons name={icon} size={22} color={color} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong" align="center">
          {title}
        </AppText>
        {text ? (
          <AppText variant="caption" color="textTertiary" align="center">
            {text}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function AdminQueryState({
  loading,
  error,
  onRetry,
  empty,
  children,
}: {
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  empty?: ReactNode;
  children?: ReactNode;
}) {
  const { theme } = useTheme();
  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.colors.primary} />
        <AppText variant="caption" color="textTertiary">
          Sunucudan yükleniyor…
        </AppText>
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.queryError, { backgroundColor: theme.colors.dangerSoft }]}>
        <Ionicons name="cloud-offline-outline" size={19} color={theme.colors.danger} />
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong" color="danger">
            Veri yüklenemedi
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {error}
          </AppText>
        </View>
        <Button label="Yenile" size="sm" variant="outline" fullWidth={false} onPress={onRetry} />
      </View>
    );
  }
  return <>{empty ?? children ?? null}</>;
}

const ADMIN_MAP_CAMERA: MapCamera = { lat: 41.0027, lng: 39.7168, zoom: 10.4 };

/**
 * Yönetim haritası: filtrelenmiş kayıtları işaretçi olarak gösterir.
 * İşaretçiye dokununca çağıran panelin yönetim kartı açılır. Sorgu tarafında
 * üst sınır 100 olduğu için harita binlerce noktayı tek seferde çizmez.
 */
export function AdminMapPreview({
  points,
  onSelect,
  height = 480,
}: {
  points: MapPoint[];
  onSelect: (id: string) => void;
  height?: number;
}) {
  const { theme } = useTheme();
  const scheme = useColorScheme();
  const [camera, setCamera] = useState<MapCamera>(ADMIN_MAP_CAMERA);

  return (
    <View
      style={[
        styles.mapWrap,
        { height, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <MapCanvas
        initialCamera={camera}
        markers={points}
        dark={scheme === 'dark'}
        onMarkerPress={(point) => onSelect(point.id)}
        onCameraChange={setCamera}
      />
      <View style={[styles.mapHint, { backgroundColor: theme.colors.surfaceElevated }]}>
        <Ionicons name="information-circle-outline" size={15} color={theme.colors.primary} />
        <AppText variant="caption" color="textSecondary">
          {points.length > 0
            ? `${points.length} kayıt haritada. İşaretçiye dokunarak yönetim kartını aç.`
            : 'Bu filtrede haritada gösterilecek kayıt yok.'}
        </AppText>
      </View>
    </View>
  );
}

export function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <View style={styles.field}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      {typeof value === 'string' ? (
        <AppText
          variant="caption"
          color="textSecondary"
          style={mono ? styles.mono : undefined}
          selectable={mono}
        >
          {value}
        </AppText>
      ) : (
        value
      )}
    </View>
  );
}

export function AdminDetailModal({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = 780,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}) {
  const { theme } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: theme.colors.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View
          style={[
            styles.modalCard,
            {
              maxWidth,
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
            },
          ]}
        >
          <View style={[styles.modalHead, { borderColor: theme.colors.divider }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="h3">{title}</AppText>
              {subtitle ? (
                <AppText variant="caption" color="textTertiary">
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <IconButton accessibilityLabel="Kapat" name="close" size={18} onPress={onClose} />
          </View>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? (
            <View style={[styles.modalFooter, { borderColor: theme.colors.divider }]}>{footer}</View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  denied: {
    alignItems: 'center',
    gap: 10,
    padding: 30,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deniedIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 18,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mapWrap: {
    position: 'relative',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  mapHint: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    opacity: 0.94,
  },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 36 },
  queryError: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12 },
  field: { gap: 3, flexGrow: 1, flexBasis: 180, minWidth: 150 },
  mono: { fontFamily: 'monospace' },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: {
    width: '100%',
    maxHeight: '92%',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalContent: { padding: 16, gap: 14 },
  modalFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
