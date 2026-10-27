import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Share, StyleSheet, Pressable, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useReportSheet } from '@/features/safety/components/ReportSheetProvider';
import { SafetySheet } from '@/features/safety/components/SafetySheet';
import { SUPPORT_EMAIL } from '@/features/safety/constants';
import { useTheme } from '@/theme/ThemeProvider';

type Props = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Orta "Paylaş" aksiyonu. Yalnizca gercekten calisan aksiyonlar listelenir;
 * gonderi/urun paylasimi hazir olana kadar burada yer almaz.
 */
export function ShareSheet({ visible, onClose }: Props) {
  const { theme } = useTheme();
  const router = useRouter();
  const { openReport } = useReportSheet();

  const shareApp = useCallback(async () => {
    onClose();
    try {
      await Share.share({
        message:
          'Trabzone — yeni nesil sosyal keşif, mesajlaşma ve marketplace platformu. Sen de katıl!',
      });
    } catch {
      // Kullanici paylasim sayfasini kapatti; yapilacak bir sey yok.
    }
  }, [onClose]);

  const reportContent = useCallback(() => {
    onClose();
    // Alt sayfa kapanmadan ikinci bir modal acmak iOS'ta cakismaya yol acar.
    setTimeout(() => {
      openReport({
        targetType: 'other',
        targetId: 'share-sheet-report',
        targetLabel: 'İçerik bildirimi',
      });
    }, 320);
  }, [onClose, openReport]);

  const contactSupport = useCallback(() => {
    onClose();
    router.push('/support/create' as never);
  }, [onClose, router]);

  return (
    <SafetySheet
      visible={visible}
      onClose={onClose}
      title="Paylaş"
      subtitle="Ne yapmak istersin?"
      scrollable={false}
    >
      <Action
        icon="share-social-outline"
        title="Trabzone'u paylaş"
        subtitle="Davet bağlantını arkadaşlarınla gönder"
        onPress={() => void shareApp()}
      />
      <Action
        icon="flag-outline"
        title="İçerik bildir"
        subtitle="Topluluk kurallarını ihlal eden bir şey mi var?"
        tone="danger"
        onPress={reportContent}
      />
      <Action
        icon="headset-outline"
        title="Destek talebi oluştur"
        subtitle={SUPPORT_EMAIL}
        onPress={contactSupport}
      />

      <View
        style={[
          styles.note,
          { backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.md },
        ]}
      >
        <Ionicons name="construct-outline" size={17} color={theme.colors.textSecondary} />
        <AppText variant="caption" color="textSecondary" style={styles.noteText}>
          Gönderi, hikâye ve ürün paylaşımı henüz yayında değil. Hazır olduğunda bu menüde yer
          alacak.
        </AppText>
      </View>

      <Button label="Kapat" variant="ghost" size="md" onPress={onClose} />
    </SafetySheet>
  );
}

function Action({
  icon,
  title,
  subtitle,
  tone = 'default',
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  tone?: 'default' | 'danger';
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const accent = tone === 'danger' ? theme.colors.danger : theme.colors.primaryDeep;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={19} color={accent} />
      </View>
      <View style={styles.actionText}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color="textSecondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionText: { flex: 1, gap: 1 },
  note: { flexDirection: 'row', gap: 9, padding: 12, alignItems: 'flex-start' },
  noteText: { flex: 1, lineHeight: 17 },
});
