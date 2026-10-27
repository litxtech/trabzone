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
 */
export function KeyboardProvider({ children }: PropsWithChildren) {
  const height = useSharedValue(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, (event) => {
      height.set(withTiming(event.endCoordinates.height, { duration: event.duration || 220 }));
      setIsVisible(true);
    });

    const hide = Keyboard.addListener(HIDE_EVENT, (event) => {
      height.set(withTiming(0, { duration: event.duration || 180 }));
      setIsVisible(false);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [height]);

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
