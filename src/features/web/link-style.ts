import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

/**
 * expo-router `Link` + `asChild` kombinasyonu için güvenli stil yardımcısı.
 *
 * Neden gerekli:
 * `asChild` kullanıldığında bağlantı, Radix `Slot` üzerinden render edilir ve
 * `style` prop'ları `{ ...slotStyle, ...childStyle }` şeklinde **nesne** olarak
 * birleştirilir. Eğer stil bir dizi ise (`[a, b]`), spread işlemi sayısal
 * anahtarlar (`0`, `1`, ...) üretir; React Native Web bunları CSS özelliği gibi
 * yazmaya çalışır ve sayfa "Failed to set an indexed property" hatasıyla
 * tamamen boşalır.
 *
 * Ayrıca `style={({ pressed }) => ...}` biçimindeki fonksiyon stilleri de aynı
 * nedenle kaybolur (fonksiyon spread edilemez), bu yüzden basma geri bildirimi
 * global CSS `:active` kuralına bırakılmıştır.
 */
export function flatStyle(style: unknown): StyleProp<TextStyle> {
  return (StyleSheet.flatten(style as never) ?? {}) as unknown as StyleProp<TextStyle>;
}
