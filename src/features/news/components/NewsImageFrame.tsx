import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppImage } from '@/components/ui';

type Props = {
  uri: string;
  width: number | null;
  height: number | null;
  /**
   * `contain`: görselin tamamı görünür (haber başlıklı görseller kırpılmaz).
   * `cover`: kutu görselle doldurulur, taşan kısım kırpılır.
   */
  fit?: 'cover' | 'contain';
  /** Görselin ekranda kaplayabileceği en yüksek nokta. */
  maxHeight: number;
  /** X (Twitter) medyası gibi yuvarlatılmış köşe yarıçapı. */
  radius: number;
  recycleKey?: string | null;
  /** İlk karede genişlik tahmini için kullanılan üst sınır. */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/**
 * Haber görseli çerçevesi.
 *
 * X'te bir gönderiye eklenen fotoğraf, kartın arka planından ayrı bir "kutu"
 * olarak görünmez: görselin kendi oranında, yuvarlatılmış köşeleriyle ve
 * çevresindeki alan tamamen saydam kalacak biçimde yerleşir.
 *
 * Önceden haber görselleri sabit oranlı bir kutuya `contain` ile sığdırılıyor,
 * kutunun boş kalan kenarları ise `surfaceMuted` ile dolduruluyordu. Bu, özellikle
 * dikey/panoramik görsellerde görselin çevresinde gri bir çerçeve bırakıyordu.
 * Burada kutu, görselin doğal oranına göre ölçülür; böylece kenar boşluğu
 * oluşmaz, köşeler yuvarlatılır ve arka plan görünür (şeffaf) kalır.
 *
 * Genişlik `onLayout` ile ölçülür; ilk karede pencere genişliğinden güvenli bir
 * tahmin kullanılır ki görsel bir kare boyunca kaybolmasın.
 */
export function NewsImageFrame({
  uri,
  width,
  height,
  fit = 'cover',
  maxHeight,
  radius,
  recycleKey,
  maxWidth = 680,
  style,
  children,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);

  const naturalRatio = width && height && width > 0 && height > 0 ? width / height : 1.6;
  // `cover` kırpılan bir çerçeve kullanır (eski davranış korunur). `contain`
  // ise görselin doğal oranını kullanır: böylece hiçbir kenarda boşluk kalmaz.
  const ratio = fit === 'cover' ? Math.min(Math.max(naturalRatio, 0.62), 1.78) : naturalRatio;

  // Akış sütunu: ekran genişliği eksi kart iç boşluğu, web'de üst sınırla.
  const estimatedWidth = Math.max(1, Math.min(windowWidth - 40, maxWidth));
  const availableWidth = measuredWidth > 0 ? measuredWidth : estimatedWidth;

  // Önce tam genişlik varsayılır; dikey görseller ekranı kaplamasın diye
  // yükseklik sınırı aşılırsa genişlikten kısılır. Kenar boşluğu kalmaz.
  let frameWidth = availableWidth;
  let frameHeight = frameWidth / ratio;
  if (frameHeight > maxHeight) {
    frameHeight = maxHeight;
    frameWidth = frameHeight * ratio;
  }
  frameWidth = Math.max(1, Math.min(frameWidth, availableWidth));
  frameHeight = Math.max(1, frameHeight);

  return (
    <View
      style={[styles.wrap, style]}
      onLayout={(event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.width);
        if (next > 0 && next !== measuredWidth) {
          setMeasuredWidth(next);
        }
      }}
    >
      <View
        style={{
          width: frameWidth,
          height: frameHeight,
          borderRadius: radius,
          overflow: 'hidden',
        }}
      >
        <AppImage
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          recycleKey={recycleKey}
        />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center' },
});
