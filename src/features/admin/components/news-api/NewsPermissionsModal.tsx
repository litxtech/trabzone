import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/services/errors';
import { useTheme } from '@/theme/ThemeProvider';

import { useNewsApiSavePermissions } from '../../hooks/use-admin-news-api';
import { useAdminToast } from '../AdminToast';
import type { NewsLicenseStatus, NewsPermissions } from '@/features/news-api/types';

import { NewsModalShell } from './NewsModalShell';
import { ChipSelect, LICENSE_LABELS, ToggleRow, newsApiStyles } from './shared';

const LICENSE_OPTIONS = (Object.keys(LICENSE_LABELS) as NewsLicenseStatus[]).map((value) => ({
  value,
  label: LICENSE_LABELS[value],
}));

export function NewsPermissionsModal({
  visible,
  connectionId,
  connectionName,
  permissions,
  licenseStatus,
  licenseNote,
  onClose,
}: {
  visible: boolean;
  connectionId: string;
  connectionName: string;
  permissions: NewsPermissions | null;
  licenseStatus: NewsLicenseStatus;
  licenseNote: string | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const save = useNewsApiSavePermissions();

  const [license, setLicense] = useState<NewsLicenseStatus>(licenseStatus);
  const [note, setNote] = useState(licenseNote ?? '');
  const [canText, setCanText] = useState(permissions?.can_republish_text ?? false);
  const [canSummary, setCanSummary] = useState(permissions?.can_republish_summary ?? false);
  const [canImages, setCanImages] = useState(permissions?.can_use_images ?? false);
  const [canLogo, setCanLogo] = useState(permissions?.can_use_logo ?? false);
  const [canVideo, setCanVideo] = useState(permissions?.can_use_video ?? false);
  const [attributionRequired, setAttributionRequired] = useState(permissions?.attribution_required ?? true);
  const [attributionText, setAttributionText] = useState(permissions?.attribution_text ?? '');
  const [termsUrl, setTermsUrl] = useState(permissions?.terms_url ?? '');
  const [evidenceUrl, setEvidenceUrl] = useState(permissions?.evidence_url ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (license === 'permitted' && !canText && !canSummary) {
      setError('Yayın izni "var" seçildiyse en az bir metin yayın hakkı işaretlenmeli.');
      return;
    }
    if (attributionRequired && attributionText.trim().length < 3) {
      setError('Atıf zorunluysa kaynak atıf metni yazılmalı.');
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        id: connectionId,
        payload: {
          license_status: license,
          license_note: note.trim() || null,
          can_republish_text: canText,
          can_republish_summary: canSummary,
          can_use_images: canImages,
          can_use_logo: canLogo,
          can_use_video: canVideo,
          attribution_required: attributionRequired,
          attribution_text: attributionText.trim() || null,
          terms_url: termsUrl.trim() || null,
          evidence_url: evidenceUrl.trim() || null,
        },
      });
      toast.success('Lisans ve yayın izinleri kaydedildi.');
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError, 'İzinler kaydedilemedi.'));
    }
  };

  return (
    <NewsModalShell
      visible={visible}
      title="Lisans ve Yayın İzinleri"
      subtitle={`${connectionName} · yayın hakkı doğrulanmadan otomatik yayın açılamaz`}
      onClose={onClose}
      footer={
        <>
          <Button label="Vazgeç" size="sm" variant="ghost" fullWidth={false} onPress={onClose} />
          <Button label="İzinleri kaydet" size="sm" fullWidth={false} loading={save.isPending} onPress={() => void submit()} />
        </>
      }
    >
      <View style={[styles.note, { borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}>
        <AppText variant="caption" color="textSecondary">
          Kaynak listesinde bulunmak yayın izni anlamına gelmez. Her kaynağın yayın hakkı ayrı kaydedilir ve audit
          log'a işlenir. İzin yoksa yalnızca keşif modu kullanılabilir.
        </AppText>
      </View>

      <View style={newsApiStyles.gapSm}>
        <AppText variant="label">Lisans durumu</AppText>
        <ChipSelect options={LICENSE_OPTIONS} value={license} onChange={setLicense} />
      </View>

      <TextField
        label="Lisans notu"
        value={note}
        onChangeText={setNote}
        multiline
        style={styles.multiline}
        placeholder="Kaynağın yayın şartları, izin kapsamı ve süresi"
      />

      <ToggleRow
        title="Tam metin yeniden yayın hakkı"
        description="Kaynak metninin tamamının kaynak profilinde yayımlanmasına izin verir."
        value={canText}
        onValueChange={setCanText}
      />
      <ToggleRow
        title="Özet / spot kullanım hakkı"
        description="Trabzone Haber derlemesi ve editör onaylı taslak için gereklidir."
        value={canSummary}
        onValueChange={setCanSummary}
      />
      <ToggleRow title="Görsel kullanım hakkı" value={canImages} onValueChange={setCanImages} />
      <ToggleRow title="Logo kullanım hakkı" value={canLogo} onValueChange={setCanLogo} />
      <ToggleRow title="Video kullanım hakkı" value={canVideo} onValueChange={setCanVideo} />

      <ToggleRow
        title="Atıf zorunlu"
        description="Yayınlarda kaynak kuruluş adı ve bağlantısı gösterilir."
        value={attributionRequired}
        onValueChange={setAttributionRequired}
      />
      <TextField
        label="Atıf metni"
        value={attributionText}
        onChangeText={setAttributionText}
        placeholder="Kaynak: Trabzon Son Haber"
      />

      <TextField
        label="Şartlar / lisans sayfası"
        value={termsUrl}
        onChangeText={setTermsUrl}
        autoCapitalize="none"
        placeholder="https://kaynak.com/kullanim-sartlari"
      />
      <TextField
        label="İzin kanıtı (yazışma, sözleşme bağlantısı)"
        value={evidenceUrl}
        onChangeText={setEvidenceUrl}
        autoCapitalize="none"
        placeholder="https://..."
      />

      {permissions?.verified_at ? (
        <AppText variant="caption" color="textTertiary">
          Son doğrulama: {new Date(permissions.verified_at).toLocaleString('tr-TR')}
        </AppText>
      ) : null}

      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
    </NewsModalShell>
  );
}

const styles = StyleSheet.create({
  note: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11 },
  multiline: { minHeight: 78 },
});
