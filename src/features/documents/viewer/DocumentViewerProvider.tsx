import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { haptics } from '@/utils/haptics';

import { DocumentViewerModal } from './DocumentViewerModal';
import type { ViewerDocument } from './types';

type DocumentViewerContextValue = {
  /**
   * Belgeyi tam ekran uygulama içi görüntüleyicide açar.
   *
   * `refresh` verilirse imzalı bağlantının süresi dolduğunda görüntüleyici
   * yeni adres ister ve kullanıcı ekranı kapatmak zorunda kalmaz.
   */
  openDocument: (document: ViewerDocument) => void;
};

const DocumentViewerContext = createContext<DocumentViewerContextValue | null>(null);

export function DocumentViewerProvider({ children }: PropsWithChildren) {
  const [active, setActive] = useState<{ id: number; document: ViewerDocument } | null>(null);

  const openDocument = useCallback((document: ViewerDocument) => {
    if (!document.url) {
      return;
    }
    haptics.tap();
    setActive((current) => ({
      id: (current?.id ?? 0) + 1,
      document,
    }));
  }, []);

  const close = useCallback(() => setActive(null), []);

  const value = useMemo(() => ({ openDocument }), [openDocument]);

  return (
    <DocumentViewerContext.Provider value={value}>
      {children}
      {active ? (
        <DocumentViewerModal
          key={`document-viewer-${active.id}`}
          document={active.document}
          onClose={close}
        />
      ) : null}
    </DocumentViewerContext.Provider>
  );
}

export function useDocumentViewer(): DocumentViewerContextValue {
  const context = useContext(DocumentViewerContext);
  if (!context) {
    throw new Error('useDocumentViewer, DocumentViewerProvider içinde kullanılmalı.');
  }
  return context;
}
