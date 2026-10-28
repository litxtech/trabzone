import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { MapSheet } from './MapSheet';

const STEPS = [
  {
    title: 'Trabzone Haritası’na hoş geldin',
    body: 'Arkadaşların, yolculuklar, mekânlar ve etkinlikler tek bir etkileşim haritasında. Harita yalnızca izin verdiğin veriyi gösterir.',
    icon: 'map-outline' as const,
  },
  {
    title: 'Haritada neleri keşfedebilirsin?',
    body: 'Konum paylaşan arkadaşlar, açık yolculuk ilanları ve yolcu talepleri. Etkinlik, mekân, canlı yayın ve medya katmanları modülleri bağlandığında aynı haritada açılır.',
    icon: 'compass-outline' as const,
  },
  {
    title: 'Konum gizliliğin sende',
    body: 'Hayalet Modu varsayılandır. İstersen yalnızca arkadaşlarınla veya seçtiğin kişilerle, yaklaşık ya da hassas konum olarak paylaşırsın. Süre dolunca erişim kapanır.',
    icon: 'shield-checkmark-outline' as const,
  },
  {
    title: 'Konum izni tercihi',
    body: 'Konum izni vermeden de şehir ve mekân arayabilirsin. Canlı konum paylaşımı yalnızca sen başlattığında çalışır; arka planda sürekli takip yapılmaz.',
    icon: 'navigate-outline' as const,
  },
  {
    title: 'Harita hazır',
    body: 'Sosyal, Yolculuk, Keşfet ve Destek modları arasında geçiş yapabilir; katmanları ve yoğunluğu kendine göre ayarlayabilirsin.',
    icon: 'checkmark-circle-outline' as const,
  },
];

/**
 * İlk kullanım tanıtımı. Konum izni zorunlu değildir; izin yalnızca kullanıcı
 * düğmeye bastığında istenir.
 */
export function MapOnboarding({
  visible,
  onDone,
  onRequestLocation,
  requestingLocation,
}: {
  visible: boolean;
  onDone: () => void;
  onRequestLocation: () => void;
  requestingLocation?: boolean;
}) {
  const { theme } = useTheme();
  const [step, setStep] = useState(0);
  const current = STEPS[step] ?? STEPS[0]!;
  const last = step === STEPS.length - 1;
  const permissionStep = step === 3;

  return (
    <MapSheet
      visible={visible}
      onClose={onDone}
      title={current.title}
      subtitle={`${step + 1} / ${STEPS.length}`}
      scroll={false}
      maxHeightRatio={0.72}
      footer={
        <>
          <Button
            label={last ? 'Haritayı aç' : permissionStep ? 'Konum izni ver' : 'Devam'}
            loading={permissionStep ? requestingLocation : false}
            onPress={() => {
              if (permissionStep) {
                onRequestLocation();
                return;
              }
              if (last) {
                onDone();
                return;
              }
              setStep((value) => Math.min(value + 1, STEPS.length - 1));
            }}
          />
          {!last ? (
            <Button
              label={permissionStep ? 'Şimdilik atla' : 'Tanıtımı atla'}
              variant="ghost"
              size="sm"
              onPress={onDone}
            />
          ) : null}
        </>
      }
    >
      <View
        style={[
          styles.hero,
          { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
        ]}
      >
        <View style={[styles.heroIcon, { backgroundColor: theme.colors.primarySoft }]}>
          <Ionicons name={current.icon} size={30} color={theme.colors.primaryDeep} />
        </View>
        <AppText variant="body" color="textSecondary" align="center">
          {current.body}
        </AppText>
      </View>

      <View style={styles.dots}>
        {STEPS.map((item, index) => (
          <View
            key={item.title}
            style={[
              styles.dot,
              {
                backgroundColor: index === step ? theme.colors.primaryDeep : theme.colors.border,
                width: index === step ? 20 : 6,
              },
            ]}
          />
        ))}
      </View>

      <AppText variant="caption" color="textTertiary" align="center">
        Trabzone resmî acil hizmet değildir. Acil durumlarda 112’yi ara.
      </AppText>
    </MapSheet>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroIcon: { width: 62, height: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, paddingVertical: 4 },
  dot: { height: 6, borderRadius: 3 },
});
