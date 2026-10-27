import { createContext, useContext } from 'react';

export type DrawerVariant = 'main' | 'profile';

export type DrawerContextValue = {
  open: (variant?: DrawerVariant) => void;
  close: () => void;
  isOpen: boolean;
  variant: DrawerVariant;
};

export const DrawerContext = createContext<DrawerContextValue | null>(null);

export function useDrawer(): DrawerContextValue {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error('useDrawer must be used inside <DrawerHost>');
  }
  return context;
}
