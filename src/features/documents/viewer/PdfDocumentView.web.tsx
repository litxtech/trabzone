import { createElement } from 'react';
import { StyleSheet, View } from 'react-native';

type Props = {
  /** İmzalı ya da herkese açık PDF adresi. */
  uri: string;
  /** Yükleme başarısız olduğunda çağrılır. */
  onError?: () => void;
};

/**
 * Web sitesinde PDF belge, uygulamanın kendi sayfası içinde gömülü olarak
 * açılır; ziyaretçi yeni sekme veya harici görüntüleyiciye çıkmaz.
 */
export function PdfDocumentView({ uri }: Props) {
  return (
    <View style={styles.root}>
      {createElement('iframe', {
        src: uri,
        title: 'PDF belge',
        style: {
          borderWidth: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#FFFFFF',
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
});
