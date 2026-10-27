import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { haptics } from '@/utils/haptics';
import { useTheme } from '@/theme/ThemeProvider';

import { useUploadAttachment } from '../hooks/use-safety-mutations';
import { SAFETY_BUCKET, type SafetyBucket } from '../services/safety-service';
import type { Attachment } from '../types';

type Props = {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  kind?: 'support' | 'report';
  onError?: (message: string) => void;
  disabled?: boolean;
};

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;

export function AttachmentPicker({
  attachments,
  onChange,
  kind = 'support',
  onError,
  disabled = false,
}: Props) {
  const { theme } = useTheme();
  const upload = useUploadAttachment();
  const bucket: SafetyBucket = kind === 'report' ? SAFETY_BUCKET.report : SAFETY_BUCKET.support;
  const remaining = MAX_FILES - attachments.length;

  const addFile = async (file: { uri: string; name: string; mime: string; size?: number }) => {
    if (remaining <= 0) {
      onError?.('En fazla 3 dosya ekleyebilirsin.');
      return;
    }
    if (file.size && file.size > MAX_BYTES) {
      haptics.error();
      onError?.('Dosya boyutu 5 MB sınırını aşıyor.');
      return;
    }
    try {
      const uploaded = await upload.mutateAsync({ bucket, ...file });
      onChange([...attachments, uploaded]);
      haptics.selection();
    } catch (error) {
      haptics.error();
      onError?.(
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Dosya yüklenemedi.',
      );
    }
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onError?.('Fotoğraf eklemek için galeri iznine ihtiyacımız var.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      exif: false,
      allowsMultipleSelection: remaining > 1,
      selectionLimit: remaining,
    });
    if (result.canceled) {
      return;
    }
    for (const asset of result.assets.slice(0, remaining)) {
      await addFile({
        uri: asset.uri,
        name: asset.fileName ?? `fotograf-${Date.now()}.jpg`,
        mime: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize,
      });
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      multiple: remaining > 1,
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return;
    }
    for (const asset of result.assets.slice(0, remaining)) {
      await addFile({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? 'application/pdf',
        size: asset.size,
      });
    }
  };

  return (
    <View style={styles.wrapper}>
      {attachments.length > 0 ? (
        <View style={styles.chips}>
          {attachments.map((attachment) => (
            <View
              key={attachment.path}
              style={[
                styles.chip,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.sm,
                },
              ]}
            >
              <Ionicons
                name={attachment.mime.includes('pdf') ? 'document-text-outline' : 'image-outline'}
                size={16}
                color={theme.colors.primaryDeep}
              />
              <AppText variant="caption" numberOfLines={1} style={styles.chipText}>
                {attachment.name}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${attachment.name} dosyasını kaldır`}
                hitSlop={8}
                onPress={() => onChange(attachments.filter((item) => item.path !== attachment.path))}
              >
                <Ionicons name="close-circle" size={17} color={theme.colors.textTertiary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {remaining > 0 ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fotoğraf ekle"
            disabled={disabled || upload.isPending}
            onPress={() => void pickImage()}
            style={({ pressed }) => [
              styles.action,
              {
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.sm,
                opacity: pressed || disabled ? 0.65 : 1,
              },
            ]}
          >
            {upload.isPending ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Ionicons name="image-outline" size={17} color={theme.colors.primaryDeep} />
            )}
            <AppText variant="caption" color="textSecondary">
              Fotoğraf ekle
            </AppText>
          </Pressable>

          {kind === 'support' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Belge ekle"
              disabled={disabled || upload.isPending}
              onPress={() => void pickDocument()}
              style={({ pressed }) => [
                styles.action,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.sm,
                  opacity: pressed || disabled ? 0.65 : 1,
                },
              ]}
            >
              <Ionicons name="document-attach-outline" size={17} color={theme.colors.primaryDeep} />
              <AppText variant="caption" color="textSecondary">
                Belge ekle
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <AppText variant="caption" color="textTertiary">
        En fazla 3 dosya · 5 MB · fotoğraf{kind === 'support' ? ' veya PDF' : ''}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  chips: { gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
