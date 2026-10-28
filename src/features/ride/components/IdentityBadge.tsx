import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/** Mavi tik rengi; tema değişse de marka mavisi korunur. */
export const VERIFIED_BLUE = '#1D9BF0';

export function VerifiedTick({
  size = 16,
  label = 'Kimlik doğrulandı',
}: {
  size?: number;
  label?: string;
}) {
  return (
    <Ionicons
      name="checkmark-circle"
      size={size}
      color={VERIFIED_BLUE}
      accessibilityLabel={label}
    />
  );
}

/** İsimlerin yanında kullanılan küçük "doğrulanmış" rozeti. */
export function VerifiedChip({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <VerifiedTick size={15} />;
  }
  return (
    <View style={[styles.chip, { borderColor: 'rgba(29,155,240,0.32)' }]}>
      <VerifiedTick size={13} />
      <AppText variant="caption" color={VERIFIED_BLUE} style={styles.chipText}>
        Kimlik doğrulandı
      </AppText>
    </View>
  );
}

/**
 * Doğrulanmış kullanıcı için "yola çık" güven bandı.
 *
 * Kullanıcı kimliğini bir kez doğruladıktan sonra bu bant görünür; kimlik
 * doğrulama akışı tekrar açılmaz.
 */
export function IdentityReadyBanner({
  subtitle = 'Kimliğin bir kez doğrulandı; tekrar belge istenmez.',
  onPress,
  actionLabel = 'Detay',
}: {
  subtitle?: string;
  onPress?: () => void;
  actionLabel?: string;
}) {
  const { theme } = useTheme();
  const body = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: 'rgba(29,155,240,0.16)' }]}>
        <VerifiedTick size={22} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" color={VERIFIED_BLUE}>
          Kimlik doğrulandı · Yola çık
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {subtitle}
        </AppText>
      </View>
      {onPress ? (
        <>
          <AppText variant="caption" color={VERIFIED_BLUE}>
            {actionLabel}
          </AppText>
          <Ionicons name="chevron-forward" size={15} color={VERIFIED_BLUE} />
        </>
      ) : null}
    </>
  );

  const style = [
    styles.banner,
    {
      backgroundColor: theme.scheme === 'dark' ? 'rgba(29,155,240,0.12)' : '#EAF6FE',
      borderColor: 'rgba(29,155,240,0.32)',
    },
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Kimlik doğrulama detayları"
        onPress={onPress}
        style={({ pressed }) => [style, { opacity: pressed ? 0.82 : 1 }]}
      >
        {body}
      </Pressable>
    );
  }

  return <View style={style}>{body}</View>;
}

/** "Kimlik doğrulandı" bilgisini ayarlar özetinde kullanan küçük satır. */
export function IdentityStatusRow({
  title,
  description,
  verified,
  onPress,
  verifiedLabel = 'Doğrulandı',
  pendingLabel = 'Doğrulanmadı',
}: {
  title: string;
  description: string;
  verified: boolean;
  onPress?: () => void;
  verifiedLabel?: string;
  pendingLabel?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.statusRow, { borderColor: theme.colors.border }]}
    >
      <View
        style={[
          styles.statusIcon,
          {
            backgroundColor: verified ? 'rgba(29,155,240,0.12)' : theme.colors.surfaceMuted,
          },
        ]}
      >
        {verified ? (
          <VerifiedTick size={19} />
        ) : (
          <Ionicons name="shield-outline" size={18} color={theme.colors.textTertiary} />
        )}
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color="textTertiary">
          {description}
        </AppText>
      </View>
      <AppText variant="caption" color={verified ? VERIFIED_BLUE : 'textTertiary'}>
        {verified ? verifiedLabel : pendingLabel}
      </AppText>
      {onPress ? (
        <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontSize: 11 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
