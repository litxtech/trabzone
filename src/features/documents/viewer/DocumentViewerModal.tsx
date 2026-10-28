import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, IconButton } from '@/components/ui';
import { haptics } from '@/utils/haptics';

import {
  DOCUMENT_KIND_LABEL,
  fileNameFromDocument,
  resolveDocumentKind,
} from './document-kind';
import { PdfDocumentView } from './PdfDocumentView';
import type { ViewerDocument } from './types';
import { ZoomableDocumentImage } from './ZoomableDocumentImage';

type Props = {
  document: ViewerDocument;
  onClose: () => void;
};

/**
 * Uygulama içi belge görüntüleyici.
 *
 * Kimlik doğrulama belgeleri, ruhsat/sigorta dosyaları ve destek ekleri
 * tarayıcıya çıkmadan bu tam ekran katmanda açılır. Görseller yakınlaştırma ve
 * kaydırma ile okunur, PDF'ler native motorla sayfa sayfa gezilir.
 */
export function DocumentViewerModal({ document, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(document.url);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const kind = resolveDocumentKind({ ...document, url });
  const title =
    document.title?.trim() ||
    fileNameFromDocument(document) ||
    DOCUMENT_KIND_LABEL[kind];

  const fail = useCallback(() => {
    setFailure('Belge yüklenemedi. Bağlantının süresi dolmuş olabilir.');
  }, []);

  const retry = useCallback(async () => {
    haptics.tap();
    setFailure(null);
    if (!document.refresh) {
      setAttempt((current) => current + 1);
      return;
    }
    setRefreshing(true);
    try {
      const next = await document.refresh();
      if (next) {
        setUrl(next);
        setAttempt((current) => current + 1);
        return;
      }
    } catch {
      // Yenileme başarısız: kullanıcıya aşağıdaki mesaj gösterilir.
    } finally {
      setRefreshing(false);
    }
    setFailure('Belge bağlantısı yenilenemedi. Ekranı kapatıp tekrar aç.');
  }, [document]);

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="fullScreen"
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
          <IconButton
            name="close"
            accessibilityLabel="Belgeyi kapat"
            variant="glass"
            size={19}
            color="#FFFFFF"
            onPress={onClose}
          />
          <View style={styles.titleWrap}>
            <AppText variant="bodyStrong" color="#FFFFFF" numberOfLines={1}>
              {title}
            </AppText>
            <AppText variant="caption" color="rgba(226,232,240,0.65)">
              {DOCUMENT_KIND_LABEL[kind]} · yalnızca bu ekranda
            </AppText>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.body}>
          {kind === 'image' ? (
            <ZoomableDocumentImage key={`image-${attempt}`} uri={url} onError={fail} />
          ) : kind === 'pdf' ? (
            <PdfDocumentView key={`pdf-${attempt}`} uri={url} onError={fail} />
          ) : (
            <View style={styles.fallback}>
              <View style={styles.fallbackIcon}>
                <Ionicons name="document-outline" size={28} color="#FFFFFF" />
              </View>
              <AppText variant="bodyStrong" color="#FFFFFF" align="center">
                Bu dosya türü uygulama içinde önizlenemiyor
              </AppText>
              <AppText variant="caption" color="rgba(255,255,255,0.7)" align="center">
                Belge yine de kayıtlı. İnceleme için destek ekibine başvurabilirsin.
              </AppText>
            </View>
          )}
        </View>

        {failure ? (
          <View style={styles.failure} pointerEvents="box-none">
            <View style={styles.failureCard}>
              <Ionicons name="alert-circle-outline" size={22} color="#FFFFFF" />
              <AppText variant="caption" color="#FFFFFF" align="center">
                {failure}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Belgeyi yeniden aç"
                disabled={refreshing}
                onPress={() => void retry()}
                style={({ pressed }) => [
                  styles.retry,
                  { opacity: refreshing ? 0.6 : pressed ? 0.75 : 1 },
                ]}
              >
                <Ionicons name="refresh" size={14} color="#FFFFFF" />
                <AppText variant="caption" color="#FFFFFF">
                  {refreshing ? 'Yenileniyor…' : 'Yeniden dene'}
                </AppText>
              </Pressable>
            </View>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#04060C' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: 'rgba(4,8,18,0.72)',
  },
  titleWrap: { flex: 1, alignItems: 'center', gap: 1 },
  headerSpacer: { width: 44 },
  body: { flex: 1 },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  fallbackIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 4,
  },
  failure: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  failureCard: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(12,18,34,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
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
});
