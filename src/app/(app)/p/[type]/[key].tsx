import { Redirect, useLocalSearchParams } from 'expo-router';

import { resolveShareRoute } from '@/features/share/links';

/**
 * `/p/{tür}/{anahtar}` paylaşım adresinin uygulama içi karşılığı.
 *
 * Paylaşılan bağlantı universal link (https) veya `trabzone://` şemasıyla
 * açıldığında bu ekran devreye girer ve kullanıcıyı doğrudan ilgili içeriğe
 * taşır. Oturum yoksa `AuthGate` adresi `next` parametresinde taşır; giriş
 * tamamlandığında aynı gönderi/ilan/profil açılır.
 *
 * Yorum bağlantılarındaki `comment` parametresi korunur; gönderi ekranı bu
 * kimliği kullanarak ilgili yorumu açar.
 */
export default function ShareLinkScreen() {
  const params = useLocalSearchParams<{
    type?: string | string[];
    key?: string | string[];
    comment?: string | string[];
  }>();

  const type = Array.isArray(params.type) ? params.type[0] : params.type;
  const key = Array.isArray(params.key) ? params.key[0] : params.key;
  const comment = Array.isArray(params.comment) ? params.comment[0] : params.comment;

  const href = resolveShareRoute(type ?? '', key ?? '');

  if (!href) {
    return <Redirect href="/feed" />;
  }

  const target = comment ? `${href}?comment=${encodeURIComponent(comment)}` : href;

  return <Redirect href={target as never} />;
}
