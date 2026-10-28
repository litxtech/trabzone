import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { useReduceMotion } from '@/perf/use-reduce-motion';

type KeyboardContextValue = {
  /** Animated height (px) that must be reserved at the bottom of a screen. */
  height: SharedValue<number>;
  /** Convenience flag for JS-side layout decisions (tab bar, sticky footers). */
  isVisible: boolean;
};

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/**
 * Tek bir klavye aboneligi tum uygulamayi besler.
 *
 * Android'de edge-to-edge zorunlu oldugu icin pencere artik klavye acilinca
 * kuculmuyor; bu yuzden yuksekligi biz yonetiyoruz. Klavye olaylari gercek
 * olcuyu verdigi icin hem iOS hem Android'de ayni sekilde calisir.
 *
 * Animasyonlari kaldiran kullanicilarda yukseklik dogrudan atanir: klavye
 * acilirken araya giren animasyon kareleri olusmaz.
 */
export function KeyboardProvider({ children }: PropsWithChildren) {
  const height = useSharedValue(0);
  const [isVisible, setIsVisible] = useState(false);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, (event) => {
      height.set(
        reduceMotion
          ? event.endCoordinates.height
          : withTiming(event.endCoordinates.height, { duration: event.duration || 220 }),
      );
      setIsVisible(true);
    });

    const hide = Keyboard.addListener(HIDE_EVENT, (event) => {
      height.set(
        reduceMotion ? 0 : withTiming(0, { duration: event.duration || 180 }),
      );
      setIsVisible(false);
    });

    // iOS'ta tahmin / otomatik doldurma cubugu yazmaya baslayinca klavyeyi
    // buyutuyor. Cerceve degisimini izlemezsek ayrilan bosluk eski (kucuk)
    // yukseklikte kalir ve yazarken yorum/mesaj alani klavyenin altina iner.
    const frame =
      Platform.OS === 'ios'
        ? Keyboard.addListener('keyboardWillChangeFrame', (event) => {
            const next = Math.max(event.endCoordinates.height, 0);
            height.set(
              reduceMotion ? next : withTiming(next, { duration: event.duration || 200 }),
            );
            setIsVisible(next > 0);
          })
        : null;

    return () => {
      show.remove();
      hide.remove();
      frame?.remove();
    };
  }, [height, reduceMotion]);

  const value = useMemo<KeyboardContextValue>(() => ({ height, isVisible }), [height, isVisible]);

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}

export function useKeyboard(): KeyboardContextValue {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboard must be used inside <KeyboardProvider>');
  }
  return context;
}
