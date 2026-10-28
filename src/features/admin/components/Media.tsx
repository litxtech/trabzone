import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { publicMediaUrl } from '@/features/media/media-service';
import type { MediaBucket } from '@/features/media/media-service';
import { mediaPublicUrl } from '@/features/profile/services/media-service';
import { useTheme } from '@/theme/ThemeProvider';

export function MediaThumb({
  bucket,
  path,
  size = 42,
  radius = 10,
  icon = 'image-outline',
}: {
  bucket: Exclude<MediaBucket, 'message-media'>;
  path: string | null | undefined;
  size?: number;
  radius?: number;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const { theme } = useTheme();
  const uri = path ? publicMediaUrl(bucket, path) : null;

  return (
    <View
      style={[
        styles.thumb,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: theme.colors.surfaceMuted,
        },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Ionicons name={icon} size={Math.round(size * 0.4)} color={theme.colors.textTertiary} />
      )}
    </View>
  );
}

export function Avatar({
  path,
  name,
  size = 34,
}: {
  path: string | null | undefined;
  name: string | null | undefined;
  size?: number;
}) {
  const { theme } = useTheme();
  const uri = path ? mediaPublicUrl('avatar', path) : null;
  return (
    <View
      style={[
        styles.thumb,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.primarySoft,
        },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <AppText variant="caption" color="primaryDeep" style={{ fontWeight: '700' }}>
          {(name ?? '?').slice(0, 1).toUpperCase()}
        </AppText>
      )}
    </View>
  );
}

export function PersonCell({
  name,
  username,
  avatar,
  verified,
}: {
  name: string | null | undefined;
  username: string | null | undefined;
  avatar?: string | null;
  verified?: boolean;
}) {
  return (
    <View style={styles.person}>
      <Avatar path={avatar} name={name} size={30} />
      <View style={styles.personText}>
        <View style={styles.nameRow}>
          <AppText variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
            {name ?? '—'}
          </AppText>
          {verified ? (
            <Ionicons name="checkmark-circle" size={13} color="#3B82F6" />
          ) : null}
        </View>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          @{username ?? '—'}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  personText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
