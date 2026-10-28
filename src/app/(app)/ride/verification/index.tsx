import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText, Badge, Button, Card } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { RideHeader } from '@/features/ride/components/RideHeader';
import {
  useApplyDriver,
  useRideProfile,
  useSubmitVerification,
} from '@/features/ride/hooks/use-ride';
import { rideDocumentUrl, uploadRideDocument } from '@/features/ride/services/ride-service';
import type { VerificationKind } from '@/features/ride/types';
import { VERIFICATION_LABEL, formatDate } from '@/features/ride/utils/format';
import {
  fileNameFromPath,
  formatFileSize,
  isImageDocument,
  loadWebBrowser,
  pickDocument,
  preloadDocumentModules,
  type PickedDocument,
} from '@/features/ride/utils/native';
import { unwrap } from '@/utils/result';

const KIND_HELP: Record<VerificationKind, string> = {
  identity:
    'Nüfus cüzdanı, ehliyet veya pasaport. Kimlik numarası dışındaki alanlar maskelenebilir.',
  driver_license: 'Geçerli sürücü belgesi. Sınıfı ve geçerlilik tarihi kontrol edilir.',
  insurance: 'Aracın trafik sigortası poliçesi. Geçerlilik tarihi zorunludur.',
  transport_license:
    'Ticari taşımacılık yapacaksan gerekli yetki belgesi. Masraf paylaşımı için zorunlu değildir.',
};

const STATUS_LABEL: Record<string, string> = {
  unverified: 'Doğrulanmadı',
  pending: 'İnceleniyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  expired: 'Süresi doldu',
  none: 'Başvuru yok',
  suspended: 'Askıda',
};

const TONE = (status: string): 'success' | 'warning' | 'danger' | 'neutral' =>
  status === 'approved'
    ? 'success'
    : status === 'rejected' || status === 'expired'
      ? 'danger'
      : status === 'pending'
        ? 'warning'
        : 'neutral';

const EXPIRY_REQUIRED: VerificationKind[] = ['driver_license', 'insurance', 'transport_license'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Depo sınırı: PDF'ler sıkıştırılamadığı için önden kontrol edilir. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** İmzalı belge bağlantısı 15 dakika geçerli; önbellek 10 dakika tutulur. */
const SIGNED_URL_TTL_SECONDS = 900;
const SIGNED_URL_CACHE_MS = 10 * 60 * 1000;

/** YYYY-AA-GG girdisini doğrular; geçersizse kullanıcıya gösterilecek mesaj döner. */
function validateExpiry(value: string, kind: VerificationKind): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return EXPIRY_REQUIRED.includes(kind) ? 'Bu belge için geçerlilik tarihi zorunlu.' : null;
  }
  if (!DATE_PATTERN.test(trimmed)) {
    return 'Geçerlilik tarihini YYYY-AA-GG biçiminde gir (örn. 2027-06-30).';
  }
  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return 'Geçerlilik tarihi geçersiz.';
  }
  if (parsed.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
    return 'Geçerlilik tarihi geçmişte olamaz.';
  }
  return null;
}

export default function RideVerificationScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const profile = useRideProfile();
  const submit = useSubmitVerification();
  const apply = useApplyDriver();

  const [active, setActive] = useState<VerificationKind>('identity');
  const [docNo, setDocNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [bio, setBio] = useState('');
  const [picked, setPicked] = useState<PickedDocument | null>(null);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewing, setViewing] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Render sırasında saat okumamak için tek seferlik anlık görüntü.
  const [mountedAt] = useState(() => Date.now());
  /** İmzalı bağlantılar kısa ömürlüdür; her açılışta yeniden imzalamak gecikme yaratır. */
  const signedUrls = useRef(new Map<string, { url: string; expiresAt: number }>());

  const data = profile.data;
  const verificationFor = (kind: VerificationKind) =>
    data?.verifications.find((item) => item.kind === kind) ?? null;

  const current = verificationFor(active);
  const currentDocument = current?.document_path ?? null;
  const identityApproved = data?.identity_status === 'approved';
  const driverPending = data?.driver_status === 'pending';
  const licenseApproved = verificationFor('driver_license')?.status === 'approved';
  const insuranceApproved = verificationFor('insurance')?.status === 'approved';
  // `ride_driver_apply` hem kimlik hem geçerli ehliyet onayı ister.
  const driverReady = identityApproved && licenseApproved;
  // Sunucu, süresi dolmamış onaylı belgeye yeni kayıt kabul etmez.
  const approvedLocked =
    current?.status === 'approved' &&
    (!current.expires_at || new Date(`${current.expires_at}T23:59:59`).getTime() > mountedAt);

  const resetFeedback = () => {
    setError(null);
    setNotice(null);
  };

  /**
   * İmzalı bağlantı üretir ve önbelleğe alır.
   *
   * Her "Görüntüle" dokunuşunda yeni imza istemek (ağ turu + imza) belgenin
   * geç açılmasına yol açıyordu; bağlantı 10 dakika yeniden kullanılır.
   */
  const documentUrl = useCallback(async (path: string) => {
    const cached = signedUrls.current.get(path);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }
    const result = await rideDocumentUrl(path, SIGNED_URL_TTL_SECONDS);
    const url = (await unwrap(result)).url;
    signedUrls.current.set(path, { url, expiresAt: Date.now() + SIGNED_URL_CACHE_MS });
    return url;
  }, []);

  // Seçici/önizleyici modülleri ekran açılırken ısıtılır.
  useEffect(() => {
    preloadDocumentModules();
  }, []);

  // Gönderilmiş belgenin bağlantısı arka planda hazırlanır.
  useEffect(() => {
    if (!currentDocument) {
      return;
    }
    void documentUrl(currentDocument).catch(() => undefined);
  }, [currentDocument, documentUrl]);

  const handlePick = async () => {
    resetFeedback();
    setPicking(true);
    try {
      const result = await pickDocument();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (!result.document) {
        return;
      }
      // PDF'ler sıkıştırılamaz; sınırı aşan dosyayı yüklemeden önce uyar.
      if (!isImageDocument(result.document) && (result.document.size ?? 0) > MAX_DOCUMENT_BYTES) {
        setError('PDF boyutu 10 MB sınırını aşıyor. Daha küçük bir dosya seç.');
        return;
      }
      setPicked(result.document);
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async () => {
    resetFeedback();
    if (!picked) {
      setError('Önce bir belge seçmelisin.');
      return;
    }
    const expiryError = validateExpiry(expiry, active);
    if (expiryError) {
      setError(expiryError);
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const uploaded = await uploadRideDocument(
        {
          uri: picked.uri,
          name: picked.name,
          mime: picked.mime,
          size: picked.size ?? undefined,
        },
        setUploadProgress,
      );
      const path = (await unwrap(uploaded)).path;
      await submit.mutateAsync({
        kind: active,
        documentPath: path,
        expiresAt: expiry.trim() ? `${expiry.trim()}T23:59:59` : null,
        meta: docNo.trim()
          ? { document_no: docNo.trim(), document_name: picked.name }
          : { document_name: picked.name },
      });
      setNotice(`${VERIFICATION_LABEL[active]} belgesi incelemeye gönderildi.`);
      signedUrls.current.delete(path);
      setPicked(null);
      setDocNo('');
      setExpiry('');
    } catch (cause) {
      setError(errorMessage(cause, 'Belge yüklenemedi.'));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleViewDocument = async () => {
    resetFeedback();
    if (!currentDocument) {
      setError('Görüntülenecek bir belge bulunamadı.');
      return;
    }
    setViewing(true);
    try {
      const url = await documentUrl(currentDocument);
      const name = fileNameFromPath(currentDocument);
      if (isImageDocument({ name, mime: '' })) {
        setViewerLoading(true);
        setViewerUrl(url);
        return;
      }
      const WebBrowser = await loadWebBrowser();
      if (WebBrowser) {
        await WebBrowser.openBrowserAsync(url);
      } else {
        await Linking.openURL(url);
      }
    } catch (cause) {
      setError(errorMessage(cause, 'Belge açılamadı.'));
    } finally {
      setViewing(false);
    }
  };

  const handleDriverApply = async () => {
    resetFeedback();
    if (!identityApproved) {
      setError('Kimlik doğrulaman onaylanmadan sürücü başvurusu gönderilemez.');
      return;
    }
    if (!licenseApproved) {
      setError('Sürücü belgesi onaylanmadan sürücü başvurusu gönderilemez.');
      return;
    }
    try {
      await apply.mutateAsync(bio.trim());
      setNotice('Sürücü başvurun alındı. Onaylandığında araç ekleyip ilan yayınlayabilirsin.');
    } catch (cause) {
      setError(errorMessage(cause, 'Başvuru gönderilemedi.'));
    }
  };

  if (profile.isLoading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} padded>
        <RideHeader title="Doğrulama" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </Screen>
    );
  }

  const busy = submit.isPending || uploading;
  const pickedIsImage = picked ? isImageDocument(picked) : false;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Kimlik ve sürücü doğrulaması"
        subtitle="Rezervasyon ve ilan için zorunlu"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Koşullar"
            onPress={() => router.navigate('/ride/policy' as never)}
            style={[
              styles.iconBtn,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="document-text-outline" size={18} color={theme.colors.text} />
          </Pressable>
        }
      />

      <Card padding={15} style={styles.summary}>
        <View style={styles.summaryRow}>
          <View style={[styles.iconWrap, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="person-circle-outline" size={26} color={theme.colors.primaryDeep} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Kimlik doğrulaması</AppText>
            <AppText variant="caption" color="textTertiary">
              Hem sürücü hem yolcu için rezervasyon öncesi zorunlu.
            </AppText>
          </View>
          <Badge
            label={STATUS_LABEL[data?.identity_status ?? 'unverified'] ?? '—'}
            tone={TONE(data?.identity_status ?? 'unverified')}
          />
        </View>
        <View style={styles.summaryRow}>
          <View style={[styles.iconWrap, { backgroundColor: theme.colors.accentSoft }]}>
            <Ionicons name="car-outline" size={26} color={theme.colors.accent} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Sürücü başvurusu</AppText>
            <AppText variant="caption" color="textTertiary">
              Onay için kimlik ve sürücü belgesi gerekir. İlan için ayrıca onaylı araç
              (ruhsat + sigorta) şarttır.
            </AppText>
          </View>
          <Badge
            label={STATUS_LABEL[data?.driver_status ?? 'none'] ?? '—'}
            tone={TONE(data?.driver_status ?? 'none')}
          />
        </View>
      </Card>

      <Card padding={15} style={styles.form}>
        <AppText variant="title">Belge yükle</AppText>
        <View style={styles.chips}>
          {(
            ['identity', 'driver_license', 'insurance', 'transport_license'] as VerificationKind[]
          ).map((kind) => {
            const activeKind = active === kind;
            const status = verificationFor(kind)?.status;
            return (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityState={{ selected: activeKind }}
                onPress={() => {
                  setActive(kind);
                  setPicked(null);
                  resetFeedback();
                }}
                style={[
                  styles.chip,
                  {
                    borderColor: activeKind ? theme.colors.primary : theme.colors.border,
                    backgroundColor: activeKind
                      ? theme.colors.primarySoft
                      : theme.colors.surfaceMuted,
                  },
                ]}
              >
                <AppText variant="caption" color={activeKind ? 'primaryDeep' : 'textSecondary'}>
                  {VERIFICATION_LABEL[kind]}
                  {status ? ` · ${STATUS_LABEL[status] ?? status}` : ''}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="caption" color="textTertiary">
          {KIND_HELP[active]}
        </AppText>

        {current?.status === 'rejected' ? (
          <View style={[styles.infoBox, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              Ret nedeni: {current?.reject_reason ?? 'Belirtilmedi'} · Belgeyi yenileyerek tekrar
              gönderebilirsin.
            </AppText>
          </View>
        ) : null}

        {current ? (
          <View style={[styles.infoBox, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Ionicons
              name={current.status === 'approved' ? 'shield-checkmark-outline' : 'time-outline'}
              size={16}
              color={current.status === 'approved' ? theme.colors.success : theme.colors.warning}
            />
            <View style={styles.flex}>
              <AppText variant="caption" color="textSecondary">
                Son durum: {STATUS_LABEL[current.status] ?? current.status}
                {current.expires_at ? ` · Geçerlilik ${formatDate(current.expires_at)}` : ''}
              </AppText>
              {currentDocument ? (
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  {fileNameFromPath(currentDocument)}
                </AppText>
              ) : null}
            </View>
            {currentDocument ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Gönderilen belgeyi görüntüle"
                onPress={() => void handleViewDocument()}
                style={[styles.viewBtn, { borderColor: theme.colors.border }]}
              >
                {viewing ? (
                  <ActivityIndicator size="small" color={theme.colors.primaryDeep} />
                ) : (
                  <>
                    <Ionicons name="eye-outline" size={15} color={theme.colors.primaryDeep} />
                    <AppText variant="caption" color="primaryDeep">
                      Görüntüle
                    </AppText>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : (
          <AppText variant="caption" color="textTertiary">
            Bu belge türü için henüz başvuru yok.
          </AppText>
        )}

        {approvedLocked ? (
          <View style={[styles.infoBox, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="shield-checkmark" size={16} color={theme.colors.success} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              Bu belge onaylı. Yeni belge göndermek için geçerlilik süresinin dolmasını bekle.
            </AppText>
          </View>
        ) : (
          <>
            {picked ? (
              <View
                style={[
                  styles.preview,
                  { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
                ]}
              >
                {pickedIsImage ? (
                  <Pressable
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Seçilen belgeyi büyüt"
                    onPress={() => setViewerUrl(picked.uri)}
                  >
                    <Image
                      source={{ uri: picked.uri }}
                      style={styles.previewImage}
                      contentFit="contain"
                      transition={150}
                    />
                  </Pressable>
                ) : (
                  <View style={styles.pdfPreview}>
                    <View style={[styles.pdfIcon, { backgroundColor: theme.colors.dangerSoft }]}>
                      <Ionicons name="document-text" size={26} color={theme.colors.danger} />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="bodyStrong" numberOfLines={2}>
                        {picked.name}
                      </AppText>
                      <AppText variant="caption" color="textTertiary">
                        PDF · {formatFileSize(picked.size)}
                      </AppText>
                    </View>
                  </View>
                )}
                <View style={styles.previewMeta}>
                  <AppText
                    variant="caption"
                    color="textSecondary"
                    numberOfLines={1}
                    style={styles.flex}
                  >
                    {pickedIsImage
                      ? `${picked.name} · ${formatFileSize(picked.size)}`
                      : 'Göndermeden önce belgeyi kontrol et.'}
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Seçilen belgeyi kaldır"
                    onPress={() => setPicked(null)}
                  >
                    <Ionicons name="close-circle" size={19} color={theme.colors.textTertiary} />
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Belge seç"
                onPress={() => void handlePick()}
                style={[
                  styles.dropzone,
                  { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
                ]}
              >
                {picking ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : (
                  <>
                    <Ionicons
                      name="cloud-upload-outline"
                      size={26}
                      color={theme.colors.primaryDeep}
                    />
                    <AppText variant="bodyStrong">Belge seç</AppText>
                    <AppText variant="caption" color="textTertiary" style={styles.centerText}>
                      PDF veya görsel · en fazla 10 MB
                    </AppText>
                  </>
                )}
              </Pressable>
            )}

            <TextInput
              value={docNo}
              onChangeText={setDocNo}
              placeholder="Belge numarası (isteğe bağlı)"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
            <TextInput
              value={expiry}
              onChangeText={setExpiry}
              placeholder="Geçerlilik tarihi YYYY-AA-GG"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              placeholderTextColor={theme.colors.textTertiary}
              style={[
                styles.input,
                {
                  color: theme.colors.text,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.inputBackground,
                },
              ]}
            />
            <AppText variant="caption" color="textTertiary">
              {EXPIRY_REQUIRED.includes(active)
                ? 'Bu belge için geçerlilik tarihi zorunludur.'
                : 'Geçerlilik tarihi varsa belge süresi dolmadan hatırlatma alırsın.'}
            </AppText>

            <Button
              label={picked ? 'Belgeyi gönder' : 'Belge seç ve gönder'}
              loading={busy}
              onPress={() => (picked ? void handleSubmit() : void handlePick())}
              leftIcon={<Ionicons name="cloud-upload-outline" size={17} color="#FFFFFF" />}
            />
            {uploading ? (
              <AppText variant="caption" color="textSecondary" style={styles.centerText}>
                Yükleniyor… %{Math.round(uploadProgress * 100)}
              </AppText>
            ) : pickedIsImage ? (
              <AppText variant="caption" color="textTertiary" style={styles.centerText}>
                Fotoğraf gönderilirken küçültülür; bu yükleme süresini kısaltır.
              </AppText>
            ) : null}
          </>
        )}
      </Card>

      {data?.driver_status === 'none' || data?.driver_status === 'rejected' ? (
        <Card padding={15} style={styles.form}>
          <AppText variant="title">Sürücü başvurusu</AppText>
          <AppText variant="caption" color="textTertiary">
            {driverReady
              ? 'Başvuruda kısa bir tanıtım yazısı istenir. Onaylandığında ilan yayınlayabilirsin.'
              : 'Başvuru için kimlik ve geçerli sürücü belgesi onayı gerekir. Eksik belgeleri yukarıdan gönderebilirsin.'}
          </AppText>
          <View style={styles.checklist}>
            {[
              { label: 'Kimlik doğrulaması', ok: identityApproved },
              { label: 'Sürücü belgesi', ok: licenseApproved },
              { label: 'Araç sigortası (garajda araç onayı için gerekli)', ok: insuranceApproved },
            ].map((item) => (
              <View key={item.label} style={styles.checkRow}>
                <Ionicons
                  name={item.ok ? 'checkmark-circle' : 'ellipse-outline'}
                  size={16}
                  color={item.ok ? theme.colors.success : theme.colors.textTertiary}
                />
                <AppText variant="caption" color={item.ok ? 'textSecondary' : 'textTertiary'}>
                  {item.label}
                  {item.ok ? ' · onaylı' : ' · bekliyor'}
                </AppText>
              </View>
            ))}
          </View>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Kendinden ve yolculuk tarzından kısaca bahset"
            placeholderTextColor={theme.colors.textTertiary}
            multiline
            editable={driverReady}
            style={[
              styles.input,
              styles.noteInput,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.inputBackground,
                opacity: driverReady ? 1 : 0.55,
              },
            ]}
          />
          <Button
            label={
              driverReady ? 'Sürücü başvurusunu gönder' : 'Önce kimlik ve ehliyet onayı gerekli'
            }
            loading={apply.isPending}
            disabled={!driverReady || !bio.trim()}
            onPress={() => void handleDriverApply()}
          />
        </Card>
      ) : driverPending ? (
        <Card padding={15} tone="muted">
          <AppText variant="bodyStrong">Sürücü başvurun inceleniyor</AppText>
          <AppText variant="caption" color="textSecondary">
            Belgelerin doğrulama ekibi tarafından kontrol ediliyor. Onaylandığında bildirim
            alacaksın.
          </AppText>
        </Card>
      ) : data?.driver_status === 'approved' ? (
        <Card padding={15} tone="primarySoft">
          <View style={styles.summaryRow}>
            <View style={[styles.iconWrap, { backgroundColor: theme.colors.surface }]}>
              <Ionicons name="checkmark-circle" size={24} color={theme.colors.success} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">Sürücü yetkin açık</AppText>
              <AppText variant="caption" color="textSecondary">
                Yolculuk ilanı yayınlayabilirsin. İlan için onaylı bir araç (ruhsat + sigorta)
                gerekir; eksikse garajdan ekleyebilirsin.
              </AppText>
            </View>
          </View>
          <View style={styles.checklist}>
            <Button
              label="Yolculuk paylaş"
              onPress={() => router.navigate('/ride/create' as never)}
            />
            <Button
              label="Garajım"
              variant="secondary"
              onPress={() => router.navigate('/ride/garage' as never)}
            />
          </View>
        </Card>
      ) : null}

      {notice ? (
        <Card padding={12} tone="primarySoft">
          <AppText variant="caption" color="textSecondary">
            {notice}
          </AppText>
        </Card>
      ) : null}
      {error ? (
        <Card padding={12} tone="muted">
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        </Card>
      ) : null}

      <Card padding={15} tone="muted">
        <AppText variant="title">Veri güvenliği</AppText>
        <AppText variant="caption" color="textSecondary">
          Belgeler özel `ride-documents` kovasında saklanır. Yalnızca yetkili doğrulama
          inceleyicileri ve sen kendi belgeni görebilirsin. Belge içeriği arama veya eşleştirme
          sonuçlarında gösterilmez. Doğrulama tamamlanmadan rezervasyon ve ilan işlevleri
          kullanılamaz.
        </AppText>
        <Button
          label="Gizlilik ve veri politikası"
          variant="ghost"
          size="sm"
          onPress={() => router.navigate('/settings/privacy' as never)}
        />
      </Card>

      <Modal
        visible={Boolean(viewerUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setViewerUrl(null);
          setViewerLoading(false);
        }}
      >
        <View style={styles.viewerBackdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Belge önizlemesini kapat"
            onPress={() => {
              setViewerUrl(null);
              setViewerLoading(false);
            }}
            style={styles.viewerClose}
          >
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </Pressable>
          {viewerUrl ? (
            <Image
              source={{ uri: viewerUrl }}
              style={styles.viewerImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={120}
              onLoadStart={() => setViewerLoading(true)}
              onLoadEnd={() => setViewerLoading(false)}
            />
          ) : null}
          {viewerLoading ? (
            <View style={styles.viewerLoading} pointerEvents="none">
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
          <AppText variant="caption" style={styles.viewerHint}>
            Belge yalnızca bu önizlemede gösterilir.
          </AppText>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { paddingVertical: 60, alignItems: 'center' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: { gap: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 10 },
  checklist: { gap: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dropzone: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 22,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  centerText: { textAlign: 'center' },
  preview: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  previewImage: { width: '100%', height: 180, backgroundColor: '#0B1020' },
  pdfPreview: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  pdfIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.35)',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  noteInput: { minHeight: 76, textAlignVertical: 'top' },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(6,10,22,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    gap: 10,
  },
  viewerImage: { width: '100%', height: '78%' },
  viewerLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: 54,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  viewerHint: { color: 'rgba(226,232,240,0.75)' },
});
