import { Ionicons } from '@expo/vector-icons';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type Tone = 'success' | 'danger' | 'info';

type Toast = {
  id: number;
  message: string;
  tone: Tone;
};

type ToastContextValue = {
  show: (message: string, tone?: Tone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function AdminToastProvider({ children }: PropsWithChildren) {
  const { theme } = useTheme();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: Tone = 'info') => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      const timer = setTimeout(() => dismiss(id), tone === 'danger' ? 6000 : 3800);
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message) => show(message, 'success'),
      error: (message) => show(message, 'danger'),
      info: (message) => show(message, 'info'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 ? (
        <View pointerEvents="box-none" style={styles.host}>
          {toasts.map((toast) => {
            const tone =
              toast.tone === 'success'
                ? { color: theme.colors.success, soft: theme.colors.successSoft, icon: 'checkmark-circle' as const }
                : toast.tone === 'danger'
                  ? { color: theme.colors.danger, soft: theme.colors.dangerSoft, icon: 'alert-circle' as const }
                  : { color: theme.colors.primary, soft: theme.colors.primarySoft, icon: 'information-circle' as const };

            return (
              <Pressable
                key={toast.id}
                accessibilityRole="alert"
                accessibilityLabel={toast.message}
                onPress={() => dismiss(toast.id)}
                style={[
                  styles.toast,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: tone.color,
                    borderRadius: theme.radius.md,
                    ...theme.shadows.card,
                  },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: tone.soft }]}>
                  <Ionicons name={tone.icon} size={17} color={tone.color} />
                </View>
                <AppText variant="caption" style={styles.text}>
                  {toast.message}
                </AppText>
                <Ionicons name="close" size={15} color={theme.colors.textTertiary} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useAdminToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useAdminToast must be used inside AdminToastProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    gap: 8,
    zIndex: 200,
    maxWidth: 380,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    minWidth: 260,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, fontWeight: '600' },
});
