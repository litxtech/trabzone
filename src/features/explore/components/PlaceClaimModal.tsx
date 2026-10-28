import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton, TextField } from '@/components/ui';
import { pickMedia } from '@/features/media/media-picker';
import { uploadMedia } from '@/features/media/media-service';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useSubmitPlaceClaim } from '../hooks/use-explore';

type Props = {
  visible: boolean;
  placeId: string;
  placeName: string;
  onClose: () => void;
  onSubmitted: () => void;
};

const EVIDENCE = [
  { key: 'tax_record' as const, label: 'Vergi levhası / mükellefiyet', icon: 'document-text-outline' as const },
  { key: 'utility' as const, label: 'Elektrik/su abonelik belgesi', icon: 'flash-outline' as const },
  { key: 'document' as const, label: 'Ticaret sicil / yetki belgesi', icon: 'ribbon-outline' as const },
  { key: 'other' as const, label: 'Diğer resmî belge', icon: 'folder-open-outline' as const },
];

/**
 * İşletme sahiplenme başvurusu. Yalnızca telefon numarası bilmek doğrulama
 * sayılmaz; resmî belge veya mükellefiyet bilgisi istenir.
 */
export function PlaceClaimModal({ visible, placeId, placeName, onClose, onSubmitted }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const profile = useMyProfile();
  const claim = useSubmitPlaceClaim();

  const [evidenceType, setEvidenceType] = useState<(typeof EVIDENCE)[number]['key']>('tax_record');
  const [evidenceText, setEvidenceText] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [documentUri, setDocumentUri] = useState<string | null>(null);
  const [mime, setMime] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = Boolean(stage) || claim.isPending;
  const valid = evidenceText.trim().length >= 20;

  const close = () => {
    if (busy) {
      return;
    }
    onClose();
  };

  const pickDocument = async () => {
    const picked = await pickMedia({ source: 'library', kind: 'image' });
    const asset = picked?.[0];
    if (!asset) {
      return;
    }
    setDocumentUri(asset.uri);
    setMime(asset.mimeType);
    setFileName(asset.fileName);
  };

  const send = async () => {
    if (!valid) {
      setError('Başvurunun değerlendirilebilmesi için en az 20 karakterlik açıklama yaz.');
      return;
    }
    if (!profile.data) {
      setError('Başvuru göndermek için giriş yapmalısın.');
      return;
    }

    setError(null);
    let documentPath: string | null = null;

    if (documentUri) {
      setStage('Belge yükleniyor');
      const uploaded = await uploadMedia({
        bucket: 'place-media',
        folder: profile.data.id,
        uri: documentUri,
        mime,
        fileName,
        compressImages: true,
      });
      if (!uploaded.ok) {
        setStage(null);
        setError(uploaded.error.message || 'Belge yüklenemedi.');
        return;
      }
      documentPath = uploaded.data.path;
    }

    setStage('Başvuru gönderiliyor');
    claim.mutate(
      {
        placeId,
        evidenceType,
        evidenceText: evidenceText.trim(),
        documentPath,
        contactPhone: phone.trim() || null,
        contactEmail: email.trim() || null,
      },
      {
        onSuccess: () => {
          haptics.success();
          setStage(null);
          Alert.alert(
            'Başvurun alındı',
            'İşletme sahipliği talebin yönetim ekibine iletildi. Onaylanana kadar profil yönetimi açılmaz; sonucu bildirimlerinden takip edebilirsin.',
            [{ text: 'Tamam', onPress: onSubmitted }],
          );
        },
        onError: (mutationError) => {
          setStage(null);
          setError(mutationError.message || 'Başvuru gönderilemedi.');
        },
      },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Başvuru penceresini kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={close}
        />
        <View
          style={[
            styles.sheet,
            theme.shadows.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />
          <View style={styles.head}>
            <View style={styles.flex}>
              <AppText variant="h3">İşletmemi sahiplen</AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {placeName}
              </AppText>
            </View>
            <IconButton name="close" accessibilityLabel="Kapat" size={18} onPress={close} />
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <AppText variant="label" color="textSecondary">
              Doğrulama belgesi türü
            </AppText>
            <View style={styles.options}>
              {EVIDENCE.map((option) => {
                const selected = evidenceType === option.key;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      haptics.selection();
                      setEvidenceType(option.key);
                    }}
                    style={[
                      styles.option,
                      {
                        borderColor: selected ? theme.colors.primary : theme.colors.border,
                        backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
                      },
                    ]}
                  >
                    <Ionicons
                      name={option.icon}
                      size={17}
                      color={selected ? theme.colors.primaryDeep : theme.colors.textSecondary}
                    />
                    <AppText variant="caption" style={styles.flex}>
                      {option.label}
                    </AppText>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={17} color={theme.colors.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            <TextField
              label="Doğrulama açıklaması *"
              value={evidenceText}
              onChangeText={setEvidenceText}
              placeholder="Vergi numarası, ticaret sicil no veya işletmeyle ilişkini açıkla"
              multiline
              maxLength={800}
              editable={!busy}
              hint="En az 20 karakter. Telefon numarası tek başına doğrulama sayılmaz."
            />

            <View style={styles.row}>
              <TextField
                label="İletişim telefonu"
                value={phone}
                onChangeText={setPhone}
                placeholder="05xx xxx xx xx"
                keyboardType="phone-pad"
                maxLength={24}
                editable={!busy}
                containerStyle={styles.flex}
              />
              <TextField
                label="E-posta"
                value={email}
                onChangeText={setEmail}
                placeholder="ornek@isletme.com"
                keyboardType="email-address"
                autoCapitalize="none"
                maxLength={120}
                editable={!busy}
                containerStyle={styles.flex}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={documentUri ? 'Belgeyi değiştir' : 'Belge fotoğrafı ekle'}
              disabled={busy}
              onPress={() => void pickDocument()}
              style={[styles.upload, { borderColor: theme.colors.borderStrong }]}
            >
              {documentUri ? (
                <Image source={{ uri: documentUri }} style={styles.documentPreview} contentFit="cover" />
              ) : (
                <Ionicons name="cloud-upload-outline" size={24} color={theme.colors.primaryDeep} />
              )}
              <View style={styles.flex}>
                <AppText variant="bodyStrong">
                  {documentUri ? 'Belge seçildi' : 'Belge fotoğrafı ekle (isteğe bağlı)'}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {documentUri ? 'Değiştirmek için dokun' : 'Vergi levhası, abonelik veya yetki belgesi'}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
            </Pressable>

            <View style={[styles.note, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Ionicons name="lock-closed-outline" size={16} color={theme.colors.textSecondary} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Gönderdiğin belgeler yalnızca doğrulama amacıyla yetkili moderatörler tarafından
                görüntülenir. Onaylanırsan işletme profilinde “Doğrulanmış işletme” göstergesi yer alır.
              </AppText>
            </View>

            {error ? (
              <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
                <AppText variant="caption" color="danger" style={styles.flex}>
                  {error}
                </AppText>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {stage ? (
              <View style={styles.stageRow}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <AppText variant="caption" color="textSecondary">
                  {stage}
                </AppText>
              </View>
            ) : null}
            <Button label="Başvuruyu gönder" onPress={() => void send()} loading={busy} disabled={!valid || busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingTop: 8,
    maxHeight: '92%',
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  content: { gap: 12, paddingTop: 12, paddingBottom: 8 },
  flex: { flex: 1 },
  options: { gap: 7 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', gap: 10 },
  upload: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 12,
  },
  documentPreview: { width: 44, height: 44, borderRadius: 9 },
  note: { flexDirection: 'row', gap: 8, padding: 11, borderRadius: 14 },
  error: { flexDirection: 'row', gap: 6, padding: 10, borderRadius: 12, alignItems: 'center' },
  footer: { gap: 8, paddingTop: 8 },
  stageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
});
