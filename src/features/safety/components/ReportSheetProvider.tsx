import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

import type { ReportDraft } from '../types';
import { ReportSheet } from './ReportSheet';

type ReportContextValue = {
  openReport: (draft: ReportDraft) => void;
  closeReport: () => void;
  isOpen: boolean;
};

const ReportContext = createContext<ReportContextValue | null>(null);

/**
 * Tum uygulamada tek bir bildirim alt sayfasi tutar. Reels, gonderi, yorum,
 * profil veya DM ekranlari yalnizca `openReport({...})` cagirir.
 *
 * Ornek:
 *   const { openReport } = useReportSheet();
 *   openReport({ targetType: 'reel', targetId: reel.id, targetUserId: reel.ownerId });
 */
export function ReportSheetProvider({ children }: PropsWithChildren) {
  const [target, setTarget] = useState<ReportDraft | null>(null);
  const [visible, setVisible] = useState(false);

  const openReport = useCallback((draft: ReportDraft) => {
    setTarget(draft);
    setVisible(true);
  }, []);

  const closeReport = useCallback(() => {
    setVisible(false);
    // Kapanma animasyonu bitene kadar hedefi koruyoruz.
    setTimeout(() => setTarget(null), 320);
  }, []);

  const value = useMemo(
    () => ({ openReport, closeReport, isOpen: visible }),
    [openReport, closeReport, visible],
  );

  return (
    <ReportContext.Provider value={value}>
      {children}
      <ReportSheet visible={visible} target={target} onClose={closeReport} />
    </ReportContext.Provider>
  );
}

export function useReportSheet(): ReportContextValue {
  const context = useContext(ReportContext);
  if (!context) {
    throw new Error('useReportSheet must be used inside <ReportSheetProvider>');
  }
  return context;
}
