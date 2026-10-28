import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText, Badge, Button, Card, TextField } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { useDocumentViewer } from '@/features/documents/viewer';
import { useMyProfile } from '@/features/profile/hooks/use-my-profile';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { IdentityReadyBanner, VERIFIED_BLUE, VerifiedTick } from '@/features/ride/components/IdentityBadge';
import { RideHeader } from '@/features/ride/components/RideHeader';
import {
  useApplyDriver,
  useRideProfile,
  useSubmitVerification,
} from '@/features/ride/hooks/use-ride';
import { rideDocumentUrl, uploadRideDocument } from '@/features/ride/services/ride-service';
import type { Verification, VerificationKind } from '@/features/ride/types';
import { VERIFICATION_LABEL, formatDate } from '@/features/ride/utils/format';
import {
  VERIFICATION_PURPOSE,
  VERIFICATION_REQUIREMENT,
  effectiveIdentityStatus,
  effectiveVerificationStatus,
  formatTrDateInput,
  fullName,
  identityExpiresAt,
  identityVerifiedAt,
  isoToTrDate,
  isValidTckn,
  latestVerification,
  maskDocumentNo,
  metaText,
  trDateToIso,
} from '@/features/ride/utils/identity';
import {
  NEEDS_DEV_BUILD,
  fileNameFromPath,
  formatFileSize,
  isImageDocument,
  loadImagePicker,
  pickDocument,
  preloadDocumentModules,
  type PickedDocument,
} from '@/features/ride/utils/native';
import { unwrap } from '@/utils/result';

const STATUS_LABEL: Record<string, string> = {
  unverified: 'Doğrulanmadı',
  pending: 'İnceleniyor',
  approved: 'Doğrulandı',
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
/** Depo sınırı: PDF'ler sıkıştırılamadığı için önden kontrol edilir. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** İmzalı belge bağlantısı 15 dakika geçerli; önbellek 10 dakika tutulur. */
const SIGNED_URL_TTL_SECONDS = 900;
const SIGNED_URL_CACHE_MS = 10 * 60 * 1000;
const DATE_PATTERN = /^\d{2}\.\d{2}\.\d{4}$/;

function validateTrDate(
  value: string,
  required: boolean,
  options: { pastAllowed?: boolean; label?: string } = {},
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? `${options.label ?? 'Geçerlilik tarihi'} zorunlu.` : null;
  }
  if (!DATE_PATTERN.test(trimmed)) {
    return 'Tarihi GG.AA.YYYY biçiminde gir (örn. 31.12.2027).';
  }
  const iso = trDateToIso(trimmed);
  if (!iso) {
    return 'Geçersiz tarih. Gün, ay ve yılı kontrol et.';
  }
  if (!options.pastAllowed && new Date(`${iso}T23:59:59`).getTime() < Date.now()) {
    return 'Tarih geçmişte olamaz.';
  }
  return null;
}

function verificationField(
  verification: Verification | null,
  key: string,
): string | null {
  return metaText(verification?.meta, key);
}

export default function RideVerificationScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const profile = useRideProfile();
  const myProfile = useMyProfile();
  const submit = useSubmitVerification();
  const apply = useApplyDriver();
  const viewer = useDocumentViewer();

  const [active, setActive] = useState<VerificationKind | null>(null);
  const [tcNo, setTcNo] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [docNo, setDocNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [bio, setBio] = useState('');
  const [picked, setPicked] = useState<PickedDocument | null>(null);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** İmzalı bağlantılar kısa ömürlüdür; her açılışta yeniden imzalamak gecikme yaratır. */
  const signedUrls = useRef(new Map<string, { url: string; expiresAt: number }>());
  const prefilled = useRef(false);

  const data = profile.data;
  const identityStatus = effectiveIdentityStatus(data);
  const identityApproved = identityStatus === 'approved';
  const identityRecord = latestVerification(data, 'identity');
  const verifiedAt = identityVerifiedAt(data);
  const identityExpiry = identityExpiresAt(data);
  // Ekran her zaman kimlik özetiyle açılır; onaylı kullanıcıya yeni belge
  // formu gösterilmez, sıradaki adım yalnızca açık bir düğmeyle sunulur.
  const currentKind = active ?? 'identity';
  const current = latestVerification(data, currentKind);
  const currentStatus =
    currentKind === 'identity'
      ? identityStatus
      : current
        ? effectiveVerificationStatus(current)
        : 'unverified';
  const currentApproved = currentStatus === 'approved';
  const currentDocument = current?.document_path ?? null;
  const isIdentity = currentKind === 'identity';
  const licenseApproved =
    effectiveVerificationStatus(latestVerification(data, 'driver_license')) === 'approved';
  const insuranceApproved =
    effectiveVerificationStatus(latestVerification(data, 'insurance')) === 'approved';
  // `ride_driver_apply` hem kimlik hem geçerli ehliyet onayı ister.
  const driverReady = identityApproved && licenseApproved;
  const submitBlocked = currentStatus === 'pending';
  const driverStatus = data?.driver_status ?? 'none';
  const driverPending = driverStatus === 'pending';
  const driverApproved = driverStatus === 'approved';

  // Kişisel bilgiler profilden bir kez ön doldurulur; kullanıcı düzenleyebilir.
  useEffect(() => {
    if (prefilled.current || !myProfile.data) {
      return;
    }
    prefilled.current = true;
    setFirstName((value) => value || myProfile.data?.first_name || '');
    setLastName((value) => value || myProfile.data?.last_name || '');
  }, [myProfile.data]);

  const resetFeedback = () => {
    setError(null);
    setNotice(null);
  };

  const selectKind = (kind: VerificationKind) => {
    setActive(kind);
    setPicked(null);
    setTcNo('');
    setDocNo('');
    setExpiry('');
    resetFeedback();
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

  const handlePickFile = async () => {
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
      if (!isImageDocument(result.document) && (result.document.size ?? 0) > MAX_DOCUMENT_BYTES) {
        setError('PDF boyutu 10 MB sınırını aşıyor. Daha küçük bir dosya seç.');
        return;
      }
      setPicked(result.document);
    } finally {
      setPicking(false);
    }
  };

  const handlePickGallery = async () => {
    resetFeedback();
    setPicking(true);
    try {
      const picker = await loadImagePicker();
      if (!picker) {
        setError(NEEDS_DEV_BUILD);
        return;
      }
      const permission = await picker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Belge fotoğrafı seçmek için galeri izni gerekli.');
        return;
      }
      const result = await picker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsMultipleSelection: false,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!result.canceled && !asset) {
        setError('Fotoğraf okunamadı. Başka bir görsel seç.');
        return;
      }
      if (!asset) {
        return;
      }
      const name = asset.fileName || `belge-${Date.now()}.jpg`;
      setPicked({
        uri: asset.uri,
        name,
        mime: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize ?? null,
      });
    } catch {
      setError('Galeri açılamadı. Tekrar dene.');
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async () => {
    resetFeedback();
    if (!picked) {
      setError('Önce belgenin fotoğrafını galeriden seç veya PDF yükle.');
      return;
    }
    const expiryError = validateTrDate(expiry, EXPIRY_REQUIRED.includes(currentKind), {
      label: 'Geçerlilik tarihi',
    });
    if (expiryError) {
      setError(expiryError);
      return;
    }
    const birthIso = isIdentity ? trDateToIso(birthDate.trim()) : null;
    if (isIdentity) {
      if (!isValidTckn(tcNo)) {
        setError('Geçerli bir T.C. Kimlik Numarası gir (11 hane).');
        return;
      }
      if (!firstName.trim() || !lastName.trim()) {
        setError('Kimlikteki ad ve soyadı yaz.');
        return;
      }
      const birthError = validateTrDate(birthDate, true, {
        label: 'Doğum tarihi',
        pastAllowed: true,
      });
      if (birthError) {
        setError(birthError);
        return;
      }
      if (!birthIso || birthIso > new Date().toISOString().slice(0, 10)) {
        setError('Doğum tarihi gelecekte olamaz.');
        return;
      }
    }

    const expiresAt = expiry.trim() ? trDateToIso(expiry.trim()) : null;
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
        kind: currentKind,
        documentPath: path,
        expiresAt,
        meta: isIdentity
          ? {
              document_no: tcNo.replace(/\D/g, ''),
              full_name: fullName(firstName, lastName),
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              birth_date: birthIso,
              document_name: picked.name,
            }
          : {
              ...(docNo.trim() ? { document_no: docNo.trim() } : {}),
              document_name: picked.name,
            },
      });
      setNotice(
        isIdentity
          ? 'Kimlik belgen incelemeye gönderildi. Onaylandığında mavi tik görünür ve tekrar doğrulama istenmez.'
          : `${VERIFICATION_LABEL[currentKind]} belgesi incelemeye gönderildi.`,
      );
      signedUrls.current.delete(path);
      setPicked(null);
      setTcNo('');
      setDocNo('');
      setExpiry('');
    } catch (cause) {
      setError(errorMessage(cause, 'Belge yüklenemedi.'));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleViewDocument = async (path: string | null) => {
    resetFeedback();
    if (!path) {
      setError('Görüntülenecek bir belge bulunamadı.');
      return;
    }
    setViewing(true);
    try {
      const url = await documentUrl(path);
      viewer.openDocument({
        url,
        name: fileNameFromPath(path),
        title: `${VERIFICATION_LABEL[currentKind]} belgesi`,
        // İmzalı adres kısa ömürlü: görüntüleyici açıkken süresi dolarsa
        // yeni imza üretilir, kullanıcı ekranı kapatmak zorunda kalmaz.
        refresh: async () => {
          const fresh = await rideDocumentUrl(path, SIGNED_URL_TTL_SECONDS);
          if (!fresh.ok) {
            return null;
          }
          const next = fresh.data.url;
          signedUrls.current.set(path, {
            url: next,
            expiresAt: Date.now() + SIGNED_URL_CACHE_MS,
          });
          return next;
        },
      });
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

  const identityDisplayName =
    verificationField(identityRecord, 'full_name') ||
    (myProfile.data ? fullName(myProfile.data.first_name, myProfile.data.last_name) : '');
  const identityBirth = verificationField(identityRecord, 'birth_date');

  const summaryRows = useMemo(
    () =>
      (['identity', 'driver_license', 'insurance', 'transport_license'] as VerificationKind[]).map(
        (kind) => {
          const record = latestVerification(data, kind);
          const status =
            kind === 'identity'
              ? identityStatus
              : record
                ? effectiveVerificationStatus(record)
                : 'unverified';
          return { kind, record, status };
        },
      ),
    [data, identityStatus],
  );

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
  const activeRecord = current;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} scroll padded>
      <RideHeader
        title="Doğrulama"
        subtitle="Kimlik bir kez, güven her yolculukta"
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

      {identityApproved ? (
        <IdentityReadyBanner
          subtitle={
            verifiedAt
              ? `${formatDate(verifiedAt)} tarihinde doğrulandı. Tekrar belge istenmez.`
              : 'Kimliğin doğrulandı; tekrar belge istenmez.'
          }
          onPress={() => router.navigate('/settings/verifications' as never)}
        />
      ) : (
        <Card padding={15} tone="primarySoft" style={styles.intro}>
          <View style={[styles.introIcon, { backgroundColor: theme.colors.primary }]}>
            <Ionicons name="shield-checkmark-outline" size={22} color="#FFFFFF" />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong">Rezervasyon ve ilan için kimlik doğrulaması</AppText>
            <AppText variant="caption" color="textSecondary">
              Belgeler gizli kovada saklanır. Kimlik onayından sonra aynı belge tekrar istenmez.
            </AppText>
          </View>
        </Card>
      )}

      <Card padding={15} style={styles.section}>
        <View style={styles.sectionHead}>
          <AppText variant="title">Doğrulama durumu</AppText>
          <Badge
            label={identityApproved ? 'Kimlik hazır' : 'Kimlik bekliyor'}
            tone={identityApproved ? 'success' : 'warning'}
          />
        </View>
        {summaryRows.map((row) => {
          const selected = currentKind === row.kind;
          const approved = row.status === 'approved';
          return (
            <Pressable
              key={row.kind}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => selectKind(row.kind)}
              style={[
                styles.statusRow,
                {
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primarySoft : 'transparent',
                },
              ]}
            >
              <View
                style={[
                  styles.statusIcon,
                  {
                    backgroundColor: approved
                      ? 'rgba(29,155,240,0.12)'
                      : theme.colors.surfaceMuted,
                  },
                ]}
              >
                {approved ? (
                  <VerifiedTick size={20} />
                ) : (
                  <Ionicons
                    name={row.kind === 'identity' ? 'id-card-outline' : 'document-text-outline'}
                    size={18}
                    color={theme.colors.textTertiary}
                  />
                )}
              </View>
              <View style={styles.flex}>
                <View style={styles.rowTitle}>
                  <AppText variant="bodyStrong">{VERIFICATION_LABEL[row.kind]}</AppText>
                  {approved ? <VerifiedTick size={14} /> : null}
                </View>
                <AppText variant="caption" color="textTertiary" numberOfLines={2}>
                  {VERIFICATION_PURPOSE[row.kind]}
                </AppText>
              </View>
              <Badge label={STATUS_LABEL[row.status] ?? row.status} tone={TONE(row.status)} />
            </Pressable>
          );
        })}
        <AppText variant="caption" color="textTertiary">
          {identityApproved
            ? 'Kimlik doğrulandı. Aşağıdaki eksik belgeleri tamamlayarak sürücü olabilirsin.'
            : 'Kimlik onaylanmadan rezervasyon oluşturulamaz. Tek bir kimlik belgesi yeterlidir.'}
        </AppText>
      </Card>

      {currentApproved ? (
        <Card padding={15} tone="primarySoft" style={styles.section}>
          <View style={styles.approvedHead}>
            <VerifiedTick size={26} />
            <View style={styles.flex}>
              <AppText variant="title">
                {isIdentity ? 'Kimlik doğrulandı' : `${VERIFICATION_LABEL[currentKind]} doğrulandı`}
              </AppText>
              <AppText variant="caption" color="textSecondary">
                {isIdentity
                  ? 'Yola çık. Bu kimlik için tekrar doğrulama istenmeyecek.'
                  : 'Belge geçerli olduğu sürece yeniden yükleme gerekmez.'}
              </AppText>
            </View>
          </View>

          {isIdentity ? (
            <View style={styles.detailGrid}>
              <Detail label="Ad soyad" value={identityDisplayName || '—'} />
              <Detail
                label="T.C. Kimlik No"
                value={
                  maskDocumentNo(verificationField(identityRecord, 'document_no')) ?? '—'
                }
              />
              <Detail label="Doğum tarihi" value={isoToTrDate(identityBirth) || '—'} />
              <Detail
                label="Doğrulama tarihi"
                value={verifiedAt ? formatDate(verifiedAt) : '—'}
              />
              <Detail
                label="Geçerlilik"
                value={identityExpiry ? formatDate(identityExpiry) : 'Süresiz'}
              />
              <Detail label="Ne için?" value={VERIFICATION_PURPOSE.identity} />
            </View>
          ) : (
            <View style={styles.detailGrid}>
              <Detail
                label="Geçerlilik"
                value={activeRecord?.expires_at ? formatDate(activeRecord.expires_at) : '—'}
              />
              <Detail label="Ne için?" value={VERIFICATION_PURPOSE[currentKind]} />
            </View>
          )}

          <View style={styles.inlineActions}>
            {currentDocument ? (
              <Button
                label="Belgeyi görüntüle"
                variant="secondary"
                size="sm"
                fullWidth={false}
                loading={viewing}
                onPress={() => void handleViewDocument(currentDocument)}
              />
            ) : null}
            {isIdentity ? (
              <Button
                label="Doğrulama özeti"
                variant="ghost"
                size="sm"
                fullWidth={false}
                onPress={() => router.navigate('/settings/verifications' as never)}
              />
            ) : null}
          </View>
        </Card>
      ) : (
        <Card padding={15} style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={styles.flex}>
              <AppText variant="title">
                {isIdentity ? 'Kimliğini doğrula' : `${VERIFICATION_LABEL[currentKind]} yükle`}
              </AppText>
              <AppText variant="caption" color="textTertiary">
                {VERIFICATION_REQUIREMENT[currentKind]}
              </AppText>
            </View>
            <Badge label={STATUS_LABEL[currentStatus] ?? currentStatus} tone={TONE(currentStatus)} />
          </View>

          {current?.status === 'rejected' ? (
            <View style={[styles.infoBox, { backgroundColor: theme.colors.dangerSoft }]}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.danger} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Ret nedeni: {current.reject_reason ?? 'Belirtilmedi'} · Belgeyi yenileyerek tekrar
                gönderebilirsin.
              </AppText>
            </View>
          ) : null}

          {current?.status === 'pending' ? (
            <View style={[styles.infoBox, { backgroundColor: theme.colors.warningSoft }]}>
              <Ionicons name="time-outline" size={16} color={theme.colors.warning} />
              <AppText variant="caption" color="textSecondary" style={styles.flex}>
                Belgen inceleniyor. Onaylandığında bildirim alacaksın; bu sırada yeni belge
                göndermen gerekmez.
              </AppText>
            </View>
          ) : null}

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
                  onPress={() =>
                    viewer.openDocument({
                      url: picked.uri,
                      name: picked.name,
                      mime: picked.mime,
                      title: 'Seçilen belge',
                    })
                  }
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
            <View style={styles.pickRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Galeriden belge seç"
                onPress={() => void handlePickGallery()}
                style={[
                  styles.pickTile,
                  { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
                ]}
              >
                {picking ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : (
                  <>
                    <View style={[styles.pickIcon, { backgroundColor: theme.colors.surface }]}>
                      <Ionicons name="images-outline" size={22} color={VERIFIED_BLUE} />
                    </View>
                    <AppText variant="bodyStrong">Galeriden seç</AppText>
                    <AppText variant="caption" color="textTertiary" align="center">
                      Kimliğinin fotoğrafı
                    </AppText>
                  </>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="PDF belge seç"
                onPress={() => void handlePickFile()}
                style={[
                  styles.pickTile,
                  { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted },
                ]}
              >
                <View style={[styles.pickIcon, { backgroundColor: theme.colors.surface }]}>
                  <Ionicons name="document-outline" size={22} color={theme.colors.primaryDeep} />
                </View>
                <AppText variant="bodyStrong">Dosya seç</AppText>
                <AppText variant="caption" color="textTertiary" align="center">
                  PDF veya görsel · 10 MB
                </AppText>
              </Pressable>
            </View>
          )}

          {isIdentity ? (
            <View style={styles.form}>
              <TextField
                label="T.C. Kimlik No"
                value={tcNo}
                onChangeText={(value) => setTcNo(value.replace(/\D/g, '').slice(0, 11))}
                placeholder="11 haneli kimlik numarası"
                keyboardType="number-pad"
                maxLength={11}
                leftIcon="id-card-outline"
              />
              <View style={styles.split}>
                <TextField
                  label="Ad"
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Kimlikteki ad"
                  autoCapitalize="words"
                  containerStyle={styles.flex}
                />
                <TextField
                  label="Soyad"
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Kimlikteki soyad"
                  autoCapitalize="words"
                  containerStyle={styles.flex}
                />
              </View>
              <TextField
                label="Doğum tarihi"
                value={birthDate}
                onChangeText={(value) => setBirthDate(formatTrDateInput(value))}
                placeholder="GG.AA.YYYY"
                keyboardType="number-pad"
                maxLength={10}
                leftIcon="calendar-outline"
              />
            </View>
          ) : (
            <TextField
              label="Belge numarası (isteğe bağlı)"
              value={docNo}
              onChangeText={setDocNo}
              placeholder="Belge üzerindeki numara"
              autoCapitalize="characters"
            />
          )}

          <TextField
            label={
              EXPIRY_REQUIRED.includes(currentKind)
                ? 'Geçerlilik tarihi'
                : 'Geçerlilik tarihi (varsa)'
            }
            value={expiry}
            onChangeText={(value) => setExpiry(formatTrDateInput(value))}
            placeholder="GG.AA.YYYY"
            keyboardType="number-pad"
            maxLength={10}
            leftIcon="calendar-outline"
            hint={
              EXPIRY_REQUIRED.includes(currentKind)
                ? 'Belge süresi dolmadan yeni belge yüklemen gerekir.'
                : 'Süresiz kimliklerde boş bırakabilirsin.'
            }
          />

          <Button
            label={
              busy
                ? 'Gönderiliyor…'
                : submitBlocked
                  ? 'Belge inceleniyor'
                  : isIdentity
                    ? 'Kimliği doğrula'
                    : `${VERIFICATION_LABEL[currentKind]} belgesini gönder`
            }
            loading={busy}
            disabled={!picked || busy || submitBlocked}
            onPress={() => void handleSubmit()}
          />
          {!picked ? (
            <AppText variant="caption" color="textTertiary" align="center">
              Önce galeriden bir belge seç.
            </AppText>
          ) : uploading ? (
            <AppText variant="caption" color="textSecondary" align="center">
              Yükleniyor… %{Math.round(uploadProgress * 100)}
            </AppText>
          ) : (
            <AppText variant="caption" color="textTertiary" align="center">
              {pickedIsImage
                ? 'Fotoğraf gönderilirken küçültülür; bu yükleme süresini kısaltır.'
                : 'PDF olduğu gibi gönderilir.'}
            </AppText>
          )}

        </Card>
      )}

      {driverStatus === 'none' || driverStatus === 'rejected' ? (
        <Card padding={15} style={styles.section}>
          <AppText variant="title">Sürücü başvurusu</AppText>
          <AppText variant="caption" color="textTertiary">
            {driverReady
              ? 'Kısa bir tanıtım yazısı yaz. Onaylandığında ilan yayınlayabilirsin.'
              : 'Başvuru için kimlik ve geçerli sürücü belgesi onayı gerekir.'}
          </AppText>
          <View style={styles.checklist}>
            {[
              { label: 'Kimlik doğrulaması', ok: identityApproved },
              { label: 'Sürücü belgesi', ok: licenseApproved },
              { label: 'Araç sigortası (garajda araç onayı için)', ok: insuranceApproved },
            ].map((item) => (
              <View key={item.label} style={styles.checkRow}>
                {item.ok ? (
                  <VerifiedTick size={16} />
                ) : (
                  <Ionicons name="ellipse-outline" size={16} color={theme.colors.textTertiary} />
                )}
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
        <Card padding={15} tone="muted" style={styles.section}>
          <View style={styles.rowTitle}>
            <Ionicons name="time-outline" size={18} color={theme.colors.warning} />
            <AppText variant="bodyStrong">Sürücü başvurun inceleniyor</AppText>
          </View>
          <AppText variant="caption" color="textSecondary">
            Belgelerin doğrulama ekibi tarafından kontrol ediliyor. Onaylandığında bildirim
            alacaksın.
          </AppText>
        </Card>
      ) : driverApproved ? (
        <Card padding={15} tone="primarySoft" style={styles.section}>
          <View style={styles.approvedHead}>
            <VerifiedTick size={26} />
            <View style={styles.flex}>
              <AppText variant="bodyStrong">Sürücü yetkin açık</AppText>
              <AppText variant="caption" color="textSecondary">
                Yolculuk ilanı yayınlayabilirsin. İlan için onaylı bir araç (ruhsat + sigorta)
                gerekir.
              </AppText>
            </View>
          </View>
          <View style={styles.inlineActions}>
            <Button
              label="Yolculuk paylaş"
              size="sm"
              fullWidth={false}
              onPress={() => router.navigate('/ride/create' as never)}
            />
            <Button
              label="Garajım"
              variant="secondary"
              size="sm"
              fullWidth={false}
              onPress={() => router.navigate('/ride/garage' as never)}
            />
          </View>
        </Card>
      ) : null}

      {notice ? (
        <Card padding={12} tone="primarySoft">
          <View style={styles.inlineRow}>
            <VerifiedTick size={16} />
            <AppText variant="caption" color="textSecondary" style={styles.flex}>
              {notice}
            </AppText>
          </View>
        </Card>
      ) : null}
      {error ? (
        <Card padding={12} tone="muted">
          <AppText variant="caption" color="danger">
            {error}
          </AppText>
        </Card>
      ) : null}

      <Card padding={15} tone="muted" style={styles.section}>
        <View style={styles.rowTitle}>
          <Ionicons name="lock-closed-outline" size={16} color={theme.colors.primaryDeep} />
          <AppText variant="title">Veri güvenliği</AppText>
        </View>
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
          fullWidth={false}
          onPress={() => router.navigate('/settings/privacy' as never)}
        />
      </Card>

    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <AppText variant="caption" color="textTertiary">
        {label}
      </AppText>
      <AppText variant="bodyStrong" numberOfLines={2}>
        {value}
      </AppText>
    </View>
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
  intro: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: 10 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  approvedHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detail: {
    flexBasis: '46%',
    flexGrow: 1,
    gap: 1,
    paddingVertical: 2,
  },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 10 },
  checklist: { gap: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  form: { gap: 10 },
  split: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  pickRow: { flexDirection: 'row', gap: 8 },
  pickTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  pickIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
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
});
