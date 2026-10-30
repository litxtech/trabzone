import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, IconButton } from '@/components/ui';
import type { PlaceReview } from '@/features/explore/types';
import { useKeyboardBottomInset } from '@/providers/keyboard';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';

import { useUpsertPharmacyReview } from '../hooks/use-pharmacy';

const MAX_BODY = 1200;
const RATING_LABEL = ['', 'Çok kötü', 'Kötü', 'Orta', 'İyi', 'Mükemmel'];

/**
 * Eczane değerlendirmesi: 1-5 yıldız + metin. Medya (reçete fotoğrafı) kabul
 * edilmez; sunucu TC kimlik numarası ve reçete talebi içeren metinleri reddeder.
 *
 * Form durumu, pencere her açıldığında yeniden kurulur (`ReviewForm` anahtarı);
 * böylece effect içinde setState çağrısı gerekmez.
 */
export function PharmacyReviewModal({
  visible,
  placeId,
  pharmacyName,
  existing,
  onClose,
  onSaved,
}: {
  visible: boolean;
  placeId: string;
  pharmacyName: string;
  existing?: PlaceReview | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardBottomInset();
  const editing = Boolean(existing);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.root, keyboardInset]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Değerlendirme penceresini kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
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
              <AppText variant="h3">
                {editing ? 'Değerlendirmeni düzenle' : 'Eczaneyi değerlendir'}
              </AppText>
              <AppText variant="caption" color="textSecondary" numberOfLines={1}>
                {pharmacyName}
              </AppText>
            </View>
            <IconButton name="close" accessibilityLabel="Kapat" size={18} onPress={onClose} />
          </View>

          {visible ? (
            <ReviewForm
              key={existing?.id ?? 'new'}
              placeId={placeId}
              existing={existing}
              editing={editing}
              onSaved={onSaved}
            />
          ) : null}
        </View>
      </Animated.View>
    </Modal>
  );
}

function ReviewForm({
  placeId,
  existing,
  editing,
  onSaved,
}: {
  placeId: string;
  existing?: PlaceReview | null;
  editing: boolean;
  onSaved: () => void;
}) {
  const { theme } = useTheme();
  const upsert = useUpsertPharmacyReview(placeId);

  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? '');
  const [error, setError] = useState<string | null>(null);

  const busy = upsert.isPending;
  const canSubmit = useMemo(() => rating >= 1 && !busy, [busy, rating]);

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    setError(null);
    upsert.mutate(
      { rating, body: body.trim() ? body.trim() : null },
      {
        onSuccess: () => {
          haptics.success();
          Alert.alert(
            editing ? 'Değerlendirme güncellendi' : 'Değerlendirmen alındı',
            'Değerlendirmen moderasyon kontrolünden sonra yayınlanır. Ortalama puan yalnızca yayınlanan değerlendirmelerden hesaplanır.',
            [{ text: 'Tamam', onPress: onSaved }],
          );
        },
        onError: (mutationError) => {
          setError(mutationError.message || 'Değerlendirme kaydedilemedi.');
        },
      },
    );
  };

  return (
    <>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={`${value} yıldız`}
              accessibilityState={{ selected: rating === value }}
              hitSlop={6}
              disabled={busy}
              onPress={() => {
                haptics.selection();
                setRating(value);
              }}
            >
              <Ionicons
                name={value <= rating ? 'star' : 'star-outline'}
                size={34}
                color={value <= rating ? theme.colors.warning : theme.colors.borderStrong}
              />
            </Pressable>
          ))}
        </View>
        <AppText variant="caption" color="textSecondary" align="center">
          {rating > 0 ? `${RATING_LABEL[rating]} · ${rating}/5` : 'Puan vermek için yıldızlara dokun'}
        </AppText>

        <View
          style={[
            styles.textArea,
            { backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border },
          ]}
        >
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Hizmet, bekleme süresi, konum gibi deneyimini yaz…"
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            maxLength={MAX_BODY}
            editable={!busy}
            style={[styles.input, { color: theme.colors.text }]}
            textAlignVertical="top"
          />
          <AppText variant="caption" color="textTertiary" align="right">
            {body.length}/{MAX_BODY}
          </AppText>
        </View>

        <View
          style={[
            styles.privacy,
            { backgroundColor: theme.colors.warningSoft, borderColor: `${theme.colors.warning}33` },
          ]}
        >
          <Ionicons name="lock-closed-outline" size={15} color={theme.colors.warning} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Kişisel sağlık bilgisi, reçete numarası/fotoğrafı veya TC kimlik numarası paylaşmayın.
            Bu tür içerikler otomatik olarak reddedilir. Reçete ve ilaç sorusu için eczaneyi
            doğrudan arayın.
          </AppText>
        </View>

        <View
          style={[
            styles.note,
            { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
          ]}
        >
          <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.textSecondary} />
          <AppText variant="caption" color="textSecondary" style={styles.flex}>
            Değerlendirme yalnızca kayıtlı Trabzone hesaplarından yapılabilir. Aynı eczane için tek
            aktif değerlendirme tutulur; işletmeler yorumları silemez, yalnızca yanıtlar.
          </AppText>
        </View>

        {error ? (
          <View style={[styles.error, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={15} color={theme.colors.danger} />
            <AppText variant="caption" color="danger" style={styles.flex}>
              {error}
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {busy ? (
          <View style={styles.stage}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <AppText variant="caption" color="textSecondary">
              Kaydediliyor…
            </AppText>
          </View>
        ) : null}
        <Button
          label={editing ? 'Değerlendirmeyi güncelle' : 'Değerlendirmeyi gönder'}
          onPress={submit}
          loading={busy}
          disabled={!canSubmit}
        />
      </View>
    </>
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
  flex: { flex: 1 },
  body: { marginTop: 6 },
  bodyContent: { gap: 12, paddingBottom: 10 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingTop: 6 },
  textArea: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  input: { minHeight: 100, fontSize: 15, lineHeight: 21 },
  privacy: {
    flexDirection: 'row',
    gap: 8,
    padding: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  note: {
    flexDirection: 'row',
    gap: 8,
    padding: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  error: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 12 },
  footer: { gap: 8, paddingTop: 8 },
  stage: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
});
