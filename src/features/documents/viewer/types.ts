/**
 * Uygulama içi belge görüntüleyicide açılan tek bir dosya.
 *
 * Kimlik doğrulama belgeleri, araç ruhsatları, destek talebi ekleri ve
 * yönetim panelindeki inceleme dosyaları tarayıcıya çıkmadan bu görüntüleyici
 * ile açılır; görsel ve PDF aynı deneyimi paylaşır.
 */
export type ViewerDocument = {
  /** İmzalı ya da herkese açık dosya adresi. */
  url: string;
  /** Dosya adı; tür çıkarımı ve başlık için kullanılır. */
  name?: string | null;
  /** Biliniyorsa MIME türü (örn. `application/pdf`, `image/jpeg`). */
  mime?: string | null;
  /** Başlıkta gösterilecek özel metin (varsayılan: dosya adı). */
  title?: string | null;
  /**
   * İmzalı bağlantılar kısa ömürlüdür. Görüntüleme sırasında süre dolarsa
   * yeni bir adres üretmek için çağrılır. `null` dönerse yenileme başarısız
   * sayılır ve kullanıcıya belgeyi yeniden açması söylenir.
   */
  refresh?: () => Promise<string | null>;
};

export type DocumentKind = 'image' | 'pdf' | 'other';
