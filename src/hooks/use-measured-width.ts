import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/**
 * Bir kapsayıcının ölçülen genişliğini döndürür.
 *
 * Medya ızgaralarında hücre boyutu **açık** (sayısal) verilmelidir: yüzde
 * genişlik (`width: '48%'`) ile `aspectRatio` aynı düğümde kullanıldığında
 * Yoga yüksekliği 0'a indirebiliyor ve görsel hiç çizilmiyor. Bu yüzden
 * ızgara genişliği `onLayout` ile ölçülür, hücre yüksekliği bu değerden
 * hesaplanır. İlk karede ölçüm gelmeden tahmini genişlik kullanılır; böylece
 * görsel bir kare boyunca kaybolmaz veya zıplamaz.
 */
export function useMeasuredWidth(estimate: number) {
  const [measured, setMeasured] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setMeasured((current) => (next > 0 && next !== current ? next : current));
  }, []);

  return { width: measured > 0 ? measured : Math.max(1, Math.round(estimate)), onLayout };
}
