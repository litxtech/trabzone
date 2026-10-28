import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import type { UsernameCheckState } from '../hooks/use-username-availability';

/**
 * Kullanıcı adı alanının sağındaki durum göstergesi. Instagram'daki gibi
 * uygun adda yeşil tik, alınmış/geçersiz adda kırmızı çarpı gösterir; kontrol
 * sürerken nokta animasyonu yerine sabit bir bekleme işareti kullanılır.
 */
export function UsernameStatusIcon({ state }: { state: UsernameCheckState }) {
  const { theme } = useTheme();

  if (state === 'checking') {
    return (
      <View>
        <Ionicons name="ellipsis-horizontal" size={18} color={theme.colors.textTertiary} />
      </View>
    );
  }
  if (state === 'available' || state === 'own') {
    return <Ionicons name="checkmark-circle" size={19} color={theme.colors.success} />;
  }
  if (state === 'taken' || state === 'reserved' || state === 'invalid' || state === 'error') {
    return <Ionicons name="close-circle" size={19} color={theme.colors.danger} />;
  }
  return null;
}
