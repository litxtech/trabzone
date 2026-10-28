import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { AppText, Badge, Button, TextField } from '@/components/ui';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import {
  useAdminBlogAiRuns,
  useAdminBlogAiSettings,
  useAdminBlogAiSettingsSave,
} from '@/features/admin/hooks/use-admin-blog';
import { useTheme } from '@/theme/ThemeProvider';

export function BlogAiSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const settings = useAdminBlogAiSettings();
  const runs = useAdminBlogAiRuns(12);
  const save = useAdminBlogAiSettingsSave();
  const [enabled, setEnabled] = useState(true);
  const [model, setModel] = useState('deepseek-chat');
  const [temperature, setTemperature] = useState('0.7');
  const [prompt, setPrompt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !settings.data) return;
    setEnabled(settings.data.enabled);
    setModel(settings.data.model);
    setTemperature(String(settings.data.temperature));
    setPrompt(settings.data.system_prompt);
    setReason('');
    setError(null);
  }, [settings.data, visible]);

  const submit = async () => {
    const value = Number(temperature);
    if (!Number.isFinite(value) || value < 0 || value > 1.5) {
      setError('Sıcaklık 0 ile 1.5 arasında olmalı.');
      return;
    }
    if (reason.trim() && reason.trim().length < 3) {
      setError('Gerekçe en az 3 karakter olmalı.');
      return;
    }
    try {
      await save.mutateAsync({
        enabled,
        model: model.trim() || 'deepseek-chat',
        temperature: value,
        system_prompt: prompt,
        reason: reason.trim() || null,
      });
      toast.success('AI ayarları kaydedildi.');
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Ayarlar kaydedilemedi.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
            },
          ]}
        >
          <View style={styles.head}>
            <View style={styles.flex}>
              <AppText variant="h2">AI yazma ayarları</AppText>
              <AppText variant="caption" color="textTertiary">
                DeepSeek anahtarı yalnızca sunucuda saklanır; tarayıcıya gönderilmez.
              </AppText>
            </View>
            <Badge label="DeepSeek" tone="accent" />
            <Pressable onPress={onClose} accessibilityLabel="Kapat" style={styles.close}>
              <Ionicons name="close" size={21} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          {settings.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : settings.isError ? (
            <AppText variant="body" color="danger">
              Ayarlar yüklenemedi. Yönetici oturumunu kontrol et.
            </AppText>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <View style={styles.switchRow}>
                <View style={styles.flex}>
                  <AppText variant="label">AI yazma özelliği</AppText>
                  <AppText variant="caption" color="textTertiary">
                    Kapalıyken editördeki AI butonları çalışmaz.
                  </AppText>
                </View>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
                  thumbColor={theme.colors.surface}
                />
              </View>

              <View style={styles.row}>
                <TextField
                  label="Model"
                  value={model}
                  onChangeText={setModel}
                  placeholder="deepseek-chat"
                  autoCapitalize="none"
                  containerStyle={styles.flex}
                  hint="deepseek-chat veya deepseek-reasoner"
                />
                <TextField
                  label="Sıcaklık"
                  value={temperature}
                  onChangeText={setTemperature}
                  keyboardType="decimal-pad"
                  containerStyle={styles.flex}
                  hint="0 = tutarlı, 1.5 = yaratıcı"
                />
              </View>

              <TextField
                label="Sistem talimatı"
                value={prompt}
                onChangeText={setPrompt}
                multiline
                style={styles.prompt}
                hint="Tüm AI çağrılarına eklenen ortak editör talimatı."
              />

              <TextField
                label="Değişiklik gerekçesi (opsiyonel)"
                value={reason}
                onChangeText={setReason}
                placeholder="Denetim kaydına yazılacak kısa gerekçe"
              />

              {error ? (
                <AppText variant="caption" color="danger">
                  {error}
                </AppText>
              ) : null}

              <View style={styles.actions}>
                <Button label="Vazgeç" variant="ghost" size="sm" fullWidth={false} onPress={onClose} />
                <Button
                  label="Ayarları kaydet"
                  size="sm"
                  fullWidth={false}
                  loading={save.isPending}
                  onPress={() => void submit()}
                />
              </View>

              <View style={[styles.runs, { borderColor: theme.colors.border }]}>
                <AppText variant="title">Son AI çağrıları</AppText>
                {(runs.data?.items ?? []).length === 0 ? (
                  <AppText variant="caption" color="textTertiary">
                    Henüz AI çağrısı yok. Bir yazı üretince burada görünür.
                  </AppText>
                ) : (
                  (runs.data?.items ?? []).map((run) => (
                    <View key={run.id} style={styles.runRow}>
                      <View style={styles.flex}>
                        <AppText variant="caption" color="textSecondary">
                          {run.action} · {run.actor_name ?? 'Yönetici'}
                        </AppText>
                        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                          {run.prompt ?? '—'}
                        </AppText>
                      </View>
                      <View style={styles.runMeta}>
                        <Badge label={run.ok ? 'Başarılı' : 'Hata'} tone={run.ok ? 'success' : 'danger'} />
                        <AppText variant="caption" color="textTertiary">
                          {run.tokens_in ?? 0}+{run.tokens_out ?? 0} token · {run.duration_ms ?? 0} ms
                        </AppText>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 720, maxHeight: '92%', borderWidth: 1, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingBottom: 10 },
  close: { padding: 6 },
  scroll: { flexGrow: 0 },
  content: { padding: 16, paddingTop: 4, gap: 13 },
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  prompt: { minHeight: 110 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  runs: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 8 },
  runRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  runMeta: { alignItems: 'flex-end', gap: 3 },
  center: { padding: 40, alignItems: 'center' },
});

