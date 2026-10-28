import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { haptics } from '@/utils/haptics';

type PdfComponent = typeof import('react-native-pdf').default;
type PdfRef = import('react-native-pdf').PdfRef;

type Props = {
  /** İmzalı ya da herkese açık PDF adresi. */
  uri: string;
  /** Yükleme başarısız olduğunda çağrılır. */
  onError?: () => void;
};

/**
 * PDF belgeleri uygulama içinde, native PDF motoruyla açar.
 *
 * Tarayıcıya çıkmadan çok sayfalı belgeler okunabilir; sayfa geçişi ve
 * yakınlaştırma aynı ekranda kalır. Native modül eski bir geliştirme
 * derlemesinde yoksa kullanıcıya tarayıcı açmak yerine güncelleme uyarısı
 * gösterilir.
 */
export function PdfDocumentView({ uri, onError }: Props) {
  const [Pdf, setPdf] = useState<PdfComponent | null>(null);
  const [moduleMissing, setModuleMissing] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const pdfRef = useRef<PdfRef>(null);

  useEffect(() => {
    let cancelled = false;
    import('react-native-pdf')
      .then((module) => {
        if (cancelled) {
          return;
        }
        setPdf(() => module.default);
      })
      .catch(() => {
        if (!cancelled) {
          setModuleMissing(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const retry = useCallback(() => {
    haptics.tap();
    setStatus('loading');
    setAttempt((current) => current + 1);
  }, []);

  const goToPage = useCallback((next: number) => {
    if (next < 1) {
      return;
    }
    haptics.selection();
    pdfRef.current?.setPage(next);
  }, []);

  if (moduleMissing) {
    return (
      <View style={styles.center}>
        <View style={styles.iconChip}>
          <Ionicons name="document-text-outline" size={26} color="#FFFFFF" />
        </View>
        <AppText variant="bodyStrong" color="#FFFFFF" align="center">
          PDF görüntüleyici bu derlemede yok
        </AppText>
        <AppText variant="caption" color="rgba(255,255,255,0.75)" align="center">
          Uygulamanın güncel sürümünü kurduğunda belge tarayıcı açılmadan burada
          görüntülenir.
        </AppText>
      </View>
    );
  }

  if (!Pdf) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <View style={styles.iconChip}>
          <Ionicons name="document-outline" size={26} color="#FFFFFF" />
        </View>
        <AppText variant="bodyStrong" color="#FFFFFF" align="center">
          Belge açılamadı
        </AppText>
        <AppText variant="caption" color="rgba(255,255,255,0.75)" align="center">
          Bağlantının süresi dolmuş olabilir. Yeniden denemek için dokun.
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Belgeyi yeniden aç"
          onPress={retry}
          style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="refresh" size={14} color="#FFFFFF" />
          <AppText variant="caption" color="#FFFFFF">
            Yeniden dene
          </AppText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Pdf
        key={`pdf-${attempt}`}
        ref={pdfRef}
        source={{ uri, cache: true }}
        style={styles.pdf}
        trustAllCerts={false}
        fitPolicy={0}
        enableAntialiasing
        enableDoubleTapZoom
        enableTextSelection={false}
        minScale={1}
        maxScale={4}
        spacing={12}
        onLoadComplete={(total) => {
          setPages(total);
          setPage(1);
          setStatus('ready');
        }}
        onPageChanged={(next) => setPage(next)}
        onError={() => {
          setStatus('error');
          onError?.();
        }}
        renderActivityIndicator={() => <ActivityIndicator color="#FFFFFF" />}
      />

      {pages > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Önceki sayfa"
            accessibilityState={{ disabled: page <= 1 }}
            disabled={page <= 1}
            onPress={() => goToPage(page - 1)}
            style={({ pressed }) => [
              styles.pagerButton,
              { opacity: page <= 1 ? 0.35 : pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="chevron-back" size={16} color="#FFFFFF" />
          </Pressable>
          <AppText variant="caption" color="#FFFFFF">
            {page} / {pages}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sonraki sayfa"
            accessibilityState={{ disabled: page >= pages }}
            disabled={page >= pages}
            onPress={() => goToPage(page + 1)}
            style={({ pressed }) => [
              styles.pagerButton,
              { opacity: page >= pages ? 0.35 : pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pdf: { flex: 1, width: '100%', height: '100%', backgroundColor: '#0B1020' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  iconChip: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 2,
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    marginTop: 4,
  },
  pager: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(4,8,18,0.72)',
  },
  pagerButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
});
