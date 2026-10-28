import { useLegalDocument } from '@/features/legal/hooks/use-legal';

import { LegalPage } from './LegalPage';

/** Statik hukuki route'lar için ortak veri yükleyici. */
export function LegalDocumentRoute({ slug }: { slug: string }) {
  const { data, isLoading } = useLegalDocument(slug);
  return <LegalPage slug={slug} document={data ?? null} isLoading={isLoading} />;
}
