import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Avatar, Badge, Button, Skeleton } from '@/components/ui';
import { AdminSection } from '@/features/admin/components/AdminPage';
import { StatCard, StatGrid } from '@/features/admin/components/StatCard';
import { useAdminToast } from '@/features/admin/components/AdminToast';
import { ReasonDialog } from '@/features/admin/components/ReasonDialog';
import { useTheme } from '@/theme/ThemeProvider';

import {
  useDemoClear,
  useDemoOverview,
  useDemoSeed,
  useDemoUserRemove,
  useDemoUsersClear,
} from '../hooks/use-demo';
import {
  formatDemoModuleSummary,
  type DemoModule,
  type DemoModuleKey,
  type DemoUser,
} from '../services/demo-service';

type Pending =
  | { kind: 'seed'; modules: DemoModuleKey[] }
  | { kind: 'clear'; modules: DemoModuleKey[] }
  | { kind: 'remove-user'; user: DemoUser }
  | { kind: 'clear-users' }
  | null;

const MODULE_ICONS: Record<DemoModuleKey, keyof typeof Ionicons.glyphMap> = {
  real_estate: 'home-outline',
  marketplace: 'storefront-outline',
  ride: 'car-sport-outline',
};

const ALL_MODULES: DemoModuleKey[] = ['real_estate', 'marketplace', 'ride'];

export function DemoDataPanel({ canManage }: { canManage: boolean }) {
  const { theme } = useTheme();
  const toast = useAdminToast();
  const overview = useDemoOverview();
  const seed = useDemoSeed();
  const clear = useDemoClear();
  const removeUser = useDemoUserRemove();
  const clearUsers = useDemoUsersClear();
  const [pending, setPending] = useState<Pending>(null);

  const data = overview.data;
  const users = data?.users ?? [];
  const busy =
    seed.isPending || clear.isPending || removeUser.isPending || clearUsers.isPending;

  const run = async (action: Pending) => {
    if (!action) {
      return;
    }
    try {
      if (action.kind === 'seed') {
        const result = await seed.mutateAsync(action.modules);
        toast.success(`Örnek içerik yüklendi: ${formatDemoModuleSummary(result)}.`);
      } else if (action.kind === 'clear') {
        const result = await clear.mutateAsync(action.modules);
        toast.success(`Örnek içerik kaldırıldı: ${formatDemoModuleSummary(result)}.`);
      } else if (action.kind === 'remove-user') {
        const result = await removeUser.mutateAsync(action.user.id);
        toast.success(`Örnek kullanıcı kaldırıldı: @${result.username}.`);
      } else {
        const result = await clearUsers.mutateAsync();
        toast.success(`${result.removed} örnek kullanıcı ve bağlı içerikleri kaldırıldı.`);
      }
      setPending(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'İşlem tamamlanamadı.');
    }
  };

  if (overview.isLoading) {
    return (
      <View style={styles.stack}>
        <StatGrid>
          <Skeleton height={104} radius={16} />
          <Skeleton height={104} radius={16} />
          <Skeleton height={104} radius={16} />
          <Skeleton height={104} radius={16} />
        </StatGrid>
        <Skeleton height={220} radius={18} />
        <Skeleton height={220} radius={18} />
      </View>
    );
  }

  if (overview.isError || !data) {
    return (
      <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerSoft }]}>
        <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.danger} />
        <View style={styles.flex}>
          <AppText variant="bodyStrong" color="danger">
            Örnek veri durumu yüklenemedi
          </AppText>
          <AppText variant="caption" color="textSecondary">
            {overview.error instanceof Error ? overview.error.message : 'Bilinmeyen hata'}
          </AppText>
        </View>
        <Button
          label="Yenile"
          size="sm"
          variant="outline"
          fullWidth={false}
          onPress={() => void overview.refetch()}
        />
      </View>
    );
  }

  const hasContent =
    data.totals.real_estate + data.totals.marketplace + data.totals.ride > 0;

  return (
    <>
      <StatGrid>
        <StatCard
          label="Örnek emlak"
          value={formatNumber(data.totals.real_estate)}
          icon="home-outline"
          hint="Trabzon ilçelerinde kiralık, satılık, devren"
        />
        <StatCard
          label="Örnek marketplace"
          value={formatNumber(data.totals.marketplace)}
          icon="storefront-outline"
          tone="accent"
          hint="Elektronik, mobilya, yöresel ürün"
        />
        <StatCard
          label="Örnek yolculuk"
          value={formatNumber(data.totals.ride)}
          icon="car-sport-outline"
          tone="success"
          hint="Şehir içi ve şehirler arası"
        />
        <StatCard
          label="Örnek kullanıcı"
          value={formatNumber(data.totals.users)}
          icon="people-outline"
          tone={data.totals.users > 0 ? 'warning' : 'primary'}
          hint="İstediğin zaman tek tek veya toplu sil"
        />
      </StatGrid>

      {!data.media_ready ? (
        <View
          style={[
            styles.notice,
            { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warning },
          ]}
        >
          <Ionicons name="image-outline" size={18} color={theme.colors.warning} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" color="warning">
              Örnek fotoğraflar yüklenmemiş
            </AppText>
            <AppText variant="caption" color="textSecondary">
              İlanlar görünür ama kartlarda görsel boş kalır. Fotoğrafları yüklemek için:
              {'\n'}
              <AppText variant="caption" color="text">
                node scripts/demo-seed.mjs
              </AppText>
            </AppText>
          </View>
        </View>
      ) : null}

      <AdminSection
        title="Örnek içerik"
        subtitle="Yükleme idempotenttir: aynı modülü tekrar yüklemek örnek kayıtları yeniler, gerçek kullanıcı verisine dokunmaz."
        action={
          <Badge
            label={hasContent ? 'Örnek veri var' : 'Henüz yüklenmedi'}
            tone={hasContent ? 'success' : 'neutral'}
          />
        }
      >
        <View style={styles.moduleList}>
          {data.modules.map((module) => (
            <ModuleRow
              key={module.key}
              module={module}
              canManage={canManage}
              busy={busy}
              onSeed={() => setPending({ kind: 'seed', modules: [module.key] })}
              onClear={() => setPending({ kind: 'clear', modules: [module.key] })}
            />
          ))}
        </View>

        <View style={styles.allActions}>
          <Button
            label="Tüm örnek içeriği yükle"
            size="sm"
            fullWidth={false}
            disabled={!canManage || busy}
            loading={seed.isPending}
            leftIcon={<Ionicons name="sparkles-outline" size={15} color={theme.colors.onPrimary} />}
            onPress={() => setPending({ kind: 'seed', modules: ALL_MODULES })}
          />
          <Button
            label="Tüm örnek içeriği kaldır"
            size="sm"
            variant="outline"
            fullWidth={false}
            disabled={!canManage || busy || !hasContent}
            loading={clear.isPending}
            leftIcon={<Ionicons name="trash-outline" size={15} color={theme.colors.text} />}
            onPress={() => setPending({ kind: 'clear', modules: ALL_MODULES })}
          />
        </View>
        {!canManage ? (
          <AppText variant="caption" color="textTertiary">
            Yükleme ve kaldırma için demo.manage izni gerekir.
          </AppText>
        ) : null}
      </AdminSection>

      <AdminSection
        title="Örnek kullanıcılar"
        subtitle="Bu hesaplar giriş yapamaz; yalnızca örnek ilanların sahibi olarak görünür. Silindiğinde ilanları, araçları ve yolculukları da silinir."
        action={
          <Button
            label="Tümünü kaldır"
            size="sm"
            variant="danger"
            fullWidth={false}
            disabled={!canManage || busy || users.length === 0}
            loading={clearUsers.isPending}
            onPress={() => setPending({ kind: 'clear-users' })}
          />
        }
      >
        {users.length === 0 ? (
          <View
            style={[
              styles.empty,
              { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
            ]}
          >
            <Ionicons name="person-add-outline" size={20} color={theme.colors.textTertiary} />
            <AppText variant="caption" color="textTertiary">
              Örnek kullanıcı yok. Yukarıdan örnek içerik yüklediğinde altı demo hesap oluşturulur.
            </AppText>
          </View>
        ) : (
          <View style={styles.userList}>
            {users.map((user) => (
              <View
                key={user.id}
                style={[
                  styles.userRow,
                  { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border },
                ]}
              >
                <Avatar name={`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()} size={38} />
                <View style={styles.flex}>
                  <View style={styles.userHead}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {[user.first_name, user.last_name].filter(Boolean).join(' ') || user.username}
                    </AppText>
                    <Badge label={`@${user.username}`} tone="neutral" />
                  </View>
                  <AppText variant="caption" color="textTertiary">
                    {[user.district, user.city].filter(Boolean).join(', ') || 'Trabzon'} ·{' '}
                    {user.real_estate} emlak · {user.marketplace} marketplace · {user.ride_offers}{' '}
                    yolculuk
                  </AppText>
                </View>
                <Button
                  label="Kaldır"
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  disabled={!canManage || busy}
                  leftIcon={<Ionicons name="close-circle-outline" size={14} color={theme.colors.danger} />}
                  onPress={() => setPending({ kind: 'remove-user', user })}
                />
              </View>
            ))}
          </View>
        )}
      </AdminSection>

      <View
        style={[
          styles.info,
          { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
        ]}
      >
        <Ionicons name="information-circle-outline" size={19} color={theme.colors.primaryDeep} />
        <View style={styles.flex}>
          <AppText variant="bodyStrong" color="primaryDeep">
            Örnek veri nasıl çalışır?
          </AppText>
          <AppText variant="caption" color="textSecondary">
            Örnek kayıtlar <AppText variant="caption" color="text">is_demo</AppText> ile
            işaretlenir; kaldırma yalnızca bu kayıtları siler. Örnek kullanıcılar gerçek
            kullanıcı listesinde görünür ama giriş yapamaz. Yayına çıkmadan önce tüm örnek
            veriyi kaldırman önerilir.
          </AppText>
        </View>
      </View>

      <ReasonDialog
        visible={pending !== null}
        requireReason={false}
        destructive={
          pending?.kind === 'clear' ||
          pending?.kind === 'remove-user' ||
          pending?.kind === 'clear-users'
        }
        loading={busy}
        title={dialogTitle(pending, data.modules)}
        description={dialogDescription(pending, data.modules)}
        confirmLabel={pending?.kind === 'seed' ? 'Yükle' : 'Kaldır'}
        cancelLabel="Vazgeç"
        onCancel={() => setPending(null)}
        onConfirm={() => void run(pending)}
      />
    </>
  );
}

function ModuleRow({
  module,
  canManage,
  busy,
  onSeed,
  onClear,
}: {
  module: DemoModule;
  canManage: boolean;
  busy: boolean;
  onSeed: () => void;
  onClear: () => void;
}) {
  const { theme } = useTheme();
  const hasItems = module.count > 0;

  return (
    <View style={[styles.moduleRow, { borderColor: theme.colors.border }]}>
      <View style={[styles.moduleIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={MODULE_ICONS[module.key]} size={18} color={theme.colors.primaryDeep} />
      </View>
      <View style={styles.flex}>
        <View style={styles.userHead}>
          <AppText variant="bodyStrong">{module.label}</AppText>
          <Badge
            label={hasItems ? `${formatNumber(module.count)} kayıt` : 'Boş'}
            tone={hasItems ? 'success' : 'neutral'}
          />
        </View>
        <AppText variant="caption" color="textTertiary">
          {module.hint}
          {hasItems ? ` · ${formatNumber(module.published)} yayında` : ''}
        </AppText>
      </View>
      <View style={styles.moduleActions}>
        <Button
          label={hasItems ? 'Yenile' : 'Yükle'}
          size="sm"
          variant="secondary"
          fullWidth={false}
          disabled={!canManage || busy}
          onPress={onSeed}
        />
        <Button
          label="Kaldır"
          size="sm"
          variant="outline"
          fullWidth={false}
          disabled={!canManage || busy || !hasItems}
          onPress={onClear}
        />
      </View>
    </View>
  );
}

function dialogTitle(pending: Pending, modules: DemoModule[]): string {
  if (!pending) {
    return '';
  }
  if (pending.kind === 'seed') {
    return pending.modules.length === ALL_MODULES.length
      ? 'Tüm örnek içerik yüklensin mi?'
      : `${labelOf(pending.modules[0], modules)} örnekleri yüklensin mi?`;
  }
  if (pending.kind === 'clear') {
    return pending.modules.length === ALL_MODULES.length
      ? 'Tüm örnek içerik kaldırılsın mı?'
      : `${labelOf(pending.modules[0], modules)} örnekleri kaldırılsın mı?`;
  }
  if (pending.kind === 'remove-user') {
    return 'Örnek kullanıcı kaldırılsın mı?';
  }
  return 'Tüm örnek kullanıcılar kaldırılsın mı?';
}

function dialogDescription(pending: Pending, modules: DemoModule[]): string {
  if (!pending) {
    return '';
  }
  if (pending.kind === 'seed') {
    return `Örnek kayıtlar oluşturulur; aynı modülde daha önce yüklenen örnekler yenilenir. ${pending.modules
      .map((key) => labelOf(key, modules))
      .join(', ')}.`;
  }
  if (pending.kind === 'clear') {
    return 'Yalnızca is_demo işaretli kayıtlar silinir. Örnek kullanıcılar ve gerçek ilanlar korunur.';
  }
  if (pending.kind === 'remove-user') {
    const counts = `${pending.user.real_estate} emlak, ${pending.user.marketplace} marketplace, ${pending.user.ride_offers} yolculuk`;
    return `@${pending.user.username} hesabı ve bağlı içerikleri (${counts}) kalıcı olarak silinir. Bu işlem geri alınamaz.`;
  }
  return 'Tüm örnek kullanıcılar, ilanları, araçları ve yolculukları kalıcı olarak silinir. Gerçek kullanıcı hesapları etkilenmez.';
}

function labelOf(key: DemoModuleKey | undefined, modules: DemoModule[]): string {
  return modules.find((item) => item.key === key)?.label ?? 'Örnek';
}

function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('tr-TR').format(value ?? 0);
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  flex: { flex: 1 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
  },
  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  moduleList: { gap: 8 },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    padding: 11,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  moduleIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  allActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  userList: { gap: 7 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  userHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  info: {
    flexDirection: 'row',
    gap: 10,
    padding: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
