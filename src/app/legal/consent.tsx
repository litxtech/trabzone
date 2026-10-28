import { Ionicons } from '@expo/vector-icons';
import { Redirect, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Skeleton } from '@/components/ui';
import { AuthGate } from '@/features/auth/components/AuthGate';
import { AuthScreen } from '@/features/auth/components/AuthScreen';
import { PUBLIC_LEGAL_PAGES } from '@/features/legal/catalog';
import { usePendingAcceptances, useRecordAcceptance } from '@/features/legal/hooks/use-legal';
import type { PendingAcceptance } from '@/features/legal/types';
import { fetchMyProfile } from '@/features/profile/services/profile-service';
import { useRouter } from '@/utils/router';

import { useWebMeta } from '@/features/web/use-web-meta';

export default function LegalConsentRoute() {
  return (
    <AuthGate>
      <LegalConsentScreen />
    </AuthGate>
  );
}

function documentPath(slug: string) {
  return PUBLIC_LEGAL_PAGES.find((item) => item.slug === slug)?.path ?? `/policy/${slug}`;
}

function LegalConsentScreen() {
  const router = useRouter();
  const { data: pending, isLoading } = usePendingAcceptances(true);
  const record = useRecordAcceptance();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useWebMeta({
    title: 'Sözleşme Onayı · Trabzone',
    description:
      'Trabzone kullanım koşulları ve topluluk kurallarının güncel sürümünü inceleyip kabul edin.',
    path: '/legal/consent',
    noIndex: true,
  });

  const items = useMemo(() => pending ?? [], [pending]);
  const allChecked = items.length > 0 && items.every((item) => checked[item.slug]);

  const openDocument = useCallback(
    (slug: string) => {
      const path = documentPath(slug);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(path, '_blank', 'noopener,noreferrer');
        return;
      }
      router.push(path as Href);
    },
    [router],
  );

  const accept = async () => {
    if (!allChecked || record.isPending) {
      return;
    }
    setError(null);
    try {
      for (const item of items) {
        await record.mutateAsync({
          slug: item.slug,
          version: item.version,
          source: Platform.OS === 'web' ? 'web_consent_gate' : 'mobile_settings',
        });
      }
      const profile = await fetchMyProfile();
      if (profile.ok && !profile.data?.onboarding_completed) {
        router.replace('/complete-profile');
        return;
      }
      router.replace('/feed');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Onay kaydedilemedi. Lütfen bağlantını kontrol edip tekrar dene.',
      );
    }
  };

  if (isLoading) {
    return (
      <AuthScreen title="Sözleşme onayı" subtitle="Güncel metinler kontrol ediliyor." showBack={false}>
        <View style={styles.form}>
          <Skeleton height={84} radius={16} />
          <Skeleton height={84} radius={16} />
          <Skeleton height={52} radius={16} />
        </View>
      </AuthScreen>
    );
  }

  if (items.length === 0) {
    return <Redirect href="/feed" />;
  }

  return (
    <AuthScreen
      title="Sözleşme güncellendi"
      subtitle="Devam etmek için güncel metinleri inceleyip kabul etmen gerekiyor."
      showBack={false}
    >
      <View style={styles.form}>
        <View style={styles.notice}>
          <Ionicons name="shield-checkmark-outline" size={18} color="#8FB2FF" />
          <AppText variant="caption" color="#C7D4EE" style={styles.flex}>
            Onayladığın belge sürümü, içerik özeti ve tarih değiştirilemez biçimde kaydedilir.
          </AppText>
        </View>

        {items.map((item) => (
          <ConsentRow
            key={item.slug}
            item={item}
            checked={Boolean(checked[item.slug])}
            onToggle={() =>
              setChecked((current) => ({ ...current, [item.slug]: !current[item.slug] }))
            }
            onOpen={() => openDocument(item.slug)}
          />
        ))}

        {error ? (
          <View style={styles.error}>
            <Ionicons name="alert-circle-outline" size={17} color="#FF8A8E" />
            <AppText variant="caption" color="#FFB4B7" style={styles.flex}>
              {error}
            </AppText>
          </View>
        ) : null}

        <Button
          label={record.isPending ? 'Kaydediliyor…' : 'Kabul et ve devam et'}
          loading={record.isPending}
          disabled={!allChecked}
          onPress={() => void accept()}
        />

        <AppText variant="caption" color="#7E8BA6" align="center">
          Zorunlu olmayan pazarlama ve analitik tercihleri bu ekranda istenmez; hesap
          ayarlarından ayrıca yönetebilirsin.
        </AppText>
      </View>
    </AuthScreen>
  );
}

function ConsentRow({
  item,
  checked,
  onToggle,
  onOpen,
}: {
  item: PendingAcceptance;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`${item.title} sürüm ${item.version} kabulü`}
        onPress={onToggle}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
      >
        <View style={[styles.box, checked && styles.boxChecked]}>
          {checked ? <Ionicons name="checkmark" size={14} color="#06101F" /> : null}
        </View>
        <View style={styles.flex}>
          <AppText variant="bodyStrong" color="#FFFFFF">
            {item.title}
          </AppText>
          <AppText variant="caption" color="#9AA7C2">
            Sürüm {item.version}
            {item.effective_at ? ` · Yürürlük ${item.effective_at.slice(0, 10)}` : ''}
          </AppText>
        </View>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={onOpen} style={styles.openLink}>
        <Ionicons name="open-outline" size={14} color="#8FB2FF" />
        <AppText variant="caption" color="#8FB2FF">
          Metni oku
        </AppText>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: 14 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(143,178,255,0.24)',
    backgroundColor: 'rgba(143,178,255,0.08)',
    padding: 12,
  },
  card: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: '#8FB2FF', borderColor: '#8FB2FF' },
  openLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,90,95,0.12)',
    padding: 12,
  },
});
