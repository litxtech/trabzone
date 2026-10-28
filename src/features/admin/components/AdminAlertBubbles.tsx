import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from '@/utils/router';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { useAdminAlertActions, useAdminAlerts } from '@/features/admin/hooks/use-admin-alerts';
import { ALERT_PRESENTATION } from '@/features/admin/services/admin-alerts-service';
import type { AdminAlert, AdminAlertCategory, AdminAlertTone } from '@/features/admin/types';
import { useReduceMotion } from '@/perf/use-reduce-motion';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeColors } from '@/theme/themes';
import { formatRelativeTr } from '@/utils/date';
import { haptics } from '@/utils/haptics';

/**
 * Admin Control Center baloncuk uyarıları.
 *
 * Panelin hangi ekranında olunursa olunsun aynı baloncuk görünür; tıklanınca
 * uyarının taşıdığı mevcut rotaya (`/admin/report/:id`, `/admin/ticket/:id`, …)
 * gidilir. Yerel ekranlar `useAdminAlertBubbles().push(...)` ile aynı görsel
 * dili kullanarak kendi baloncuklarını üretebilir.
 */

const MAX_COLLAPSED = 3;

type LocalAlertInput = {
  title: string;
  body?: string | null;
  route: string;
  category?: AdminAlertCategory;
  tone?: AdminAlertTone;
};

type AdminAlertContextValue = {
  push: (alert: LocalAlertInput) => void;
  clearLocal: () => void;
};

const AdminAlertContext = createContext<AdminAlertContextValue | null>(null);

function toneColors(tone: AdminAlertTone, colors: ThemeColors) {
  switch (tone) {
    case 'danger':
      return { color: colors.danger, soft: colors.dangerSoft };
    case 'warning':
      return { color: colors.warning, soft: colors.warningSoft };
    case 'success':
      return { color: colors.success, soft: colors.successSoft };
    default:
      return { color: colors.primary, soft: colors.primarySoft };
  }
}

export function AdminAlertProvider({ children }: PropsWithChildren) {
  const [locals, setLocals] = useState<AdminAlert[]>([]);
  const nextLocalId = useRef(1);

  const push = useCallback((alert: LocalAlertInput) => {
    const id = `local-${nextLocalId.current++}`;
    setLocals((current) =>
      [
        {
          id,
          category: alert.category ?? 'custom',
          title: alert.title,
          body: alert.body ?? null,
          route: alert.route,
          entity_type: null,
          entity_id: null,
          tone: alert.tone ?? 'info',
          created_at: new Date().toISOString(),
        } satisfies AdminAlert,
        ...current,
      ].slice(0, 6),
    );
  }, []);

  const removeLocal = useCallback((id: string) => {
    setLocals((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearLocal = useCallback(() => setLocals([]), []);

  const value = useMemo<AdminAlertContextValue>(() => ({ push, clearLocal }), [clearLocal, push]);

  return (
    <AdminAlertContext.Provider value={value}>
      {children}
      <AdminAlertBubbles locals={locals} onDismissLocal={removeLocal} />
    </AdminAlertContext.Provider>
  );
}

/** Admin ekranları aynı baloncuk bileşenini kullanarak kendi uyarısını gösterir. */
export function useAdminAlertBubbles(): AdminAlertContextValue {
  const context = useContext(AdminAlertContext);
  if (!context) {
    throw new Error('useAdminAlertBubbles must be used inside AdminAlertProvider');
  }
  return context;
}

function AdminAlertBubbles({
  locals,
  onDismissLocal,
}: {
  locals: AdminAlert[];
  onDismissLocal: (id: string) => void;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { data } = useAdminAlerts(true);
  const { markRead, markAllRead } = useAdminAlertActions();
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: AdminAlert[] = [];
    for (const alert of [...locals, ...(data?.items ?? [])]) {
      const fingerprint = `${alert.category}|${alert.route}|${alert.title}`;
      if (seen.has(fingerprint)) {
        continue;
      }
      seen.add(fingerprint);
      merged.push(alert);
    }
    return merged;
  }, [data?.items, locals]);

  const open = useCallback(
    (alert: AdminAlert) => {
      haptics.tap();
      if (alert.id.startsWith('local-')) {
        onDismissLocal(alert.id);
      } else {
        markRead.mutate([alert.id]);
      }
      router.push(alert.route as Href);
    },
    [markRead, onDismissLocal, router],
  );

  const dismiss = useCallback(
    (alert: AdminAlert) => {
      if (alert.id.startsWith('local-')) {
        onDismissLocal(alert.id);
        return;
      }
      markRead.mutate([alert.id]);
    },
    [markRead, onDismissLocal],
  );

  const clearAll = useCallback(() => {
    locals.forEach((alert) => onDismissLocal(alert.id));
    markAllRead.mutate();
    setExpanded(false);
  }, [locals, markAllRead, onDismissLocal]);

  if (items.length === 0) {
    return null;
  }

  const hiddenCount = Math.max(0, items.length - MAX_COLLAPSED);
  const visible = expanded ? items : items.slice(0, MAX_COLLAPSED);

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: 84 + (insets.bottom ?? 0) }]}>
      <ScrollView
        style={expanded ? styles.stackExpanded : undefined}
        contentContainerStyle={styles.stack}
        showsVerticalScrollIndicator={false}
        pointerEvents="box-none"
      >
        {visible.map((alert) => {
          const presentation = ALERT_PRESENTATION[alert.category] ?? ALERT_PRESENTATION.custom;
          const tone = toneColors(alert.tone ?? presentation.tone, theme.colors);
          return (
            <Animated.View
              key={alert.id}
              entering={reduceMotion ? undefined : FadeInDown.springify().damping(18)}
              exiting={reduceMotion ? undefined : FadeOut.duration(140)}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${presentation.label}: ${alert.title}. Aç`}
                onPress={() => open(alert)}
                style={({ pressed }) => [
                  styles.bubble,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: `${tone.color}66`,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: tone.soft }]}>
                  <Ionicons name={presentation.icon} size={17} color={tone.color} />
                </View>

                <View style={styles.textWrap}>
                  <View style={styles.titleRow}>
                    <AppText variant="caption" numberOfLines={1} style={styles.title}>
                      {alert.title}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" style={styles.time}>
                      {formatRelativeTr(alert.created_at)}
                    </AppText>
                  </View>
                  <AppText
                    variant="caption"
                    color="textSecondary"
                    numberOfLines={1}
                    style={styles.body}
                  >
                    {alert.body ? `${presentation.label} · ${alert.body}` : presentation.label}
                  </AppText>
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Baloncuğu kapat"
                  hitSlop={8}
                  onPress={() => dismiss(alert)}
                  style={styles.close}
                >
                  <Ionicons name="close" size={14} color={theme.colors.textTertiary} />
                </Pressable>
              </Pressable>
            </Animated.View>
          );
        })}

        {expanded ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Baloncuk listesini daralt"
            onPress={() => setExpanded(false)}
            style={[styles.chip, { backgroundColor: theme.colors.surfaceMuted }]}
          >
            <Ionicons name="chevron-up" size={13} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              Daralt
            </AppText>
          </Pressable>
        ) : hiddenCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${hiddenCount} işlem daha göster`}
            onPress={() => setExpanded(true)}
            style={[styles.chip, { backgroundColor: theme.colors.surfaceMuted }]}
          >
            <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
            <AppText variant="caption" color="textSecondary">
              {hiddenCount} işlem daha
            </AppText>
          </Pressable>
        ) : null}

        {items.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tüm baloncukları temizle"
            onPress={clearAll}
            style={styles.clear}
          >
            <AppText variant="caption" color="textTertiary">
              Tümünü temizle
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    right: 16,
    zIndex: 240,
    alignItems: 'flex-end',
    maxWidth: 360,
  },
  stack: { gap: 8, alignItems: 'flex-end', paddingBottom: 2 },
  stackExpanded: { maxHeight: 380 },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 264,
    maxWidth: 352,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 8,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1, minWidth: 0, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontWeight: '700', flexShrink: 1 },
  time: { fontSize: 10 },
  body: { fontSize: 11 },
  close: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
  },
  clear: { paddingVertical: 2, paddingHorizontal: 6 },
});
