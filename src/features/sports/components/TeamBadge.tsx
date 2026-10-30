import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.replace(/\b(FK|SK|JK|AŞ|A\.Ş\.|FC|CF|SC)\b/gi, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 3).toLocaleUpperCase('tr-TR');
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('tr-TR');
}

/**
 * Takım rozeti. Logo yalnızca yönetici "logo kullanım hakkı" ayarını açtıysa
 * sunucudan gelir; aksi halde baş harfli nötr rozet gösterilir.
 */
export function TeamBadge({
  name,
  logo,
  size = 44,
  primary = false,
}: {
  name: string | null;
  logo?: string | null;
  size?: number;
  primary?: boolean;
}) {
  if (logo) {
    return (
      <Image
        source={{ uri: logo }}
        style={{ width: size, height: size }}
        contentFit="contain"
        accessibilityLabel={name ?? 'Takım'}
      />
    );
  }
  return (
    <View
      accessibilityLabel={name ?? 'Takım'}
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: primary ? '#7A1F3D' : 'rgba(255,255,255,0.12)',
          borderColor: primary ? '#4FA3E0' : 'rgba(255,255,255,0.22)',
        },
      ]}
    >
      <AppText variant="label" style={{ color: '#FFFFFF', fontSize: Math.max(10, size * 0.3) }}>
        {initials(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
});
