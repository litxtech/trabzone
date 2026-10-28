import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Badge, Button, Card, TextField } from '@/components/ui';
import { Screen } from '@/components/ui/Screen';
import { SelectSheet } from '@/components/ui/SelectSheet';
import { useExploreBootstrap } from '@/features/explore/hooks/use-explore';
import { publicMediaUrl } from '@/features/media/media-service';
import {
  useAdminAnalytics,
  useAdminCategoriesV2,
  useAdminListingDetailV2,
  useAdminListingsV2,
  useAdminOrders,
  useAdminOverviewV2,
  useModerateAdminListing,
  useRemoveAdminListingMedia,
  useSaveAdminCategoryV2,
} from '@/features/marketplace/hooks/use-market-admin';
import {
  adminMarketError,
  type AdminAnalytics,
  type AdminCategoryV2,
  type AdminListingDetail,
  type AdminListingV2,
  type AdminOrder,
} from '@/features/marketplace/services/market-admin-service';
import {
  fetchSalesSummary,
  formatPrice,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from '@/features/marketplace/services/marketplace-service';
import { shareSalesReport } from '@/features/marketplace/services/order-pdf';
import { SafetyEmptyState } from '@/features/safety/components/SafetyEmptyState';
import { SafetyHeader } from '@/features/safety/components/SafetyHeader';
import { useStaffInfo } from '@/features/safety/hooks/use-safety';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

type TabKey = 'overview' | 'categories' | 'listings' | 'analytics' | 'orders';
type ModerationAction = 'approve' | 'reject' | 'remove' | 'restore' | 'expire';

const LISTING_STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  pending: 'İncelemede',
  active: 'Yayında',
  reserved: 'Rezerve',
  sold: 'Satıldı',
  expired: 'Süresi doldu',
  rejected: 'Reddedildi',
  archived: 'Arşiv',
  removed: 'Kaldırıldı',
};

const MODERATION_LABELS: Record<string, string> = {
  visible: 'Görünür',
  hidden: 'Gizli',
  flagged: 'İşaretli',
};

const KIND_LABELS: Record<string, string> = {
  product: 'Ürün',
  real_estate: 'Emlak',
  vehicle: 'Araç',
  place: 'İşletme',
  service: 'Hizmet',
  job: 'İş',
  education: 'Eğitim',
  event: 'Etkinlik',
};

const KIND_OPTIONS = [
  'product',
  'real_estate',
  'vehicle',
  'place',
  'service',
  'job',
  'education',
  'event',
];
const TONE_OPTIONS = ['primary', 'accent', 'success', 'warning', 'danger', 'info'];

const ORDER_STATUS_OPTIONS: (OrderStatus | 'all')[] = [
  'all',
  'requested',
  'confirmed',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'rejected',
];

const MODERATION_ACTION_LABELS: Record<ModerationAction, string> = {
  approve: 'Onayla ve yayına al',
  reject: 'Reddet',
  remove: 'Yayından kaldır',
  restore: 'Yeniden yayına al',
  expire: 'Süresini doldur',
};

export default function AdminMarketplaceScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: staff, isLoading: staffLoading } = useStaffInfo();
  const [tab, setTab] = useState<TabKey>('overview');

  const permissions = staff?.permissions ?? [];
  const canManage = permissions.includes('market.manage');
  const canViewOrders = canManage || permissions.includes('market.orders.view');

  const tabs: { key: TabKey; label: string; visible: boolean }[] = [
    { key: 'overview', label: 'Genel', visible: canManage },
    { key: 'categories', label: 'Kategoriler', visible: canManage },
    { key: 'listings', label: 'İlanlar', visible: canManage },
    { key: 'analytics', label: 'Analitik', visible: canManage },
    { key: 'orders', label: 'Siparişler', visible: canViewOrders },
  ];

  if (!staffLoading && !canManage && !canViewOrders) {
    return (
      <Screen edges={['top', 'left', 'right']} padded>
        <SafetyHeader title="Marketplace yönetimi" subtitle="Yetki kontrolü" />
        <Card style={styles.denied}>
          <View style={[styles.deniedIcon, { backgroundColor: theme.colors.dangerSoft }]}>
            <Ionicons name="lock-closed-outline" size={26} color={theme.colors.danger} />
          </View>
          <AppText variant="h3" align="center">
            Bu alana erişimin yok
          </AppText>
          <AppText variant="body" color="textSecondary" align="center">
            Marketplace yönetimi yalnızca `market.manage` veya `market.orders.view` yetkisi olan
            ekibe açıktır.
          </AppText>
          <Button label="Geri dön" variant="secondary" onPress={() => router.replace('/admin')} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} scroll padded>
      <SafetyHeader
        title="Marketplace yönetimi"
        subtitle="Kategori, ilan, işletme ve analitik operasyonları"
        right={canManage ? <Badge label="market.manage" tone="neutral" /> : null}
      />

      <View style={styles.tabs}>
        {tabs
          .filter((item) => item.visible)
          .map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.selection();
                  setTab(item.key);
                }}
                style={[
                  styles.tab,
                  {
                    backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
      </View>

      {staffLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : tab === 'overview' ? (
        <OverviewTab
          onOpenListings={() => setTab('listings')}
          onOpenAnalytics={() => setTab('analytics')}
        />
      ) : tab === 'categories' ? (
        <CategoriesTab />
      ) : tab === 'listings' ? (
        <ListingsTab />
      ) : tab === 'analytics' ? (
        <AnalyticsTab />
      ) : (
        <OrdersTab />
      )}
    </Screen>
  );
}

/* --------------------------------- genel --------------------------------- */

function OverviewTab({
  onOpenListings,
  onOpenAnalytics,
}: {
  onOpenListings: () => void;
  onOpenAnalytics: () => void;
}) {
  const { theme } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useAdminOverviewV2();
  const [detailId, setDetailId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <SafetyEmptyState
        icon="cloud-offline-outline"
        title="Genel bakış yüklenemedi"
        body="Yetkin olduğundan emin ol ve tekrar dene."
        actionLabel="Tekrar dene"
        onAction={() => void refetch()}
      />
    );
  }

  const counts = data.counts;

  return (
    <View style={styles.section}>
      <View style={styles.metricGrid}>
        <Metric label="Toplam ilan" value={counts.total} icon="layers-outline" />
        <Metric
          label="Yayında"
          value={counts.active}
          icon="checkmark-circle-outline"
          tone="success"
        />
        <Metric label="Bekleyen" value={counts.pending} icon="time-outline" tone="warning" />
        <Metric label="Bugün" value={counts.today} icon="today-outline" tone="accent" />
        <Metric label="Ürün" value={counts.products} icon="bag-handle-outline" />
        <Metric label="Emlak" value={counts.real_estate_market} icon="home-outline" />
        <Metric label="Araç" value={counts.vehicles} icon="car-outline" />
        <Metric label="Hizmet" value={counts.services} icon="construct-outline" />
        <Metric label="İşletme" value={counts.places} icon="storefront-outline" />
        <Metric label="Görüntülenme" value={counts.views} icon="eye-outline" tone="accent" />
        <Metric label="Favori" value={counts.favorites} icon="heart-outline" tone="danger" />
        <Metric label="Açık şikâyet" value={counts.reports} icon="flag-outline" tone="warning" />
      </View>

      <View style={styles.quickLinks}>
        <QuickLink
          icon="shield-checkmark-outline"
          label="İlan moderasyonu"
          detail={`${counts.pending} bekleyen ilan`}
          onPress={onOpenListings}
        />
        <QuickLink
          icon="bar-chart-outline"
          label="Analitik"
          detail="Günlük, tür ve ilçe dağılımı"
          onPress={onOpenAnalytics}
        />
        <QuickLink
          icon="storefront-outline"
          label="İşletmeler"
          detail={`${counts.published_places} yayında işletme`}
          onPress={() => router.push('/admin/explore' as never)}
        />
        <QuickLink
          icon="flag-outline"
          label="Şikâyetler"
          detail={`${counts.reports} açık kayıt`}
          onPress={() => router.push('/admin/reports' as never)}
        />
        <QuickLink
          icon="home-outline"
          label="Emlak operasyonları"
          detail={`${counts.published_real_estate} yayında emlak`}
          onPress={() => router.push('/admin/real-estate' as never)}
        />
        <QuickLink
          icon="shield-outline"
          label="Audit kayıtları"
          detail="Kritik işlem geçmişi"
          onPress={() => router.push('/admin/audit' as never)}
        />
      </View>

      <View style={styles.sectionHead}>
        <AppText variant="bodyStrong">Moderasyon bekleyenler</AppText>
        <Badge label={`${data.pending_items.length} kayıt`} tone="warning" />
      </View>

      {data.pending_items.length === 0 ? (
        <Card padding={14}>
          <AppText variant="body" color="textSecondary">
            Bekleyen ilan yok. Yeni ilanlar geldiğinde burada listelenir.
          </AppText>
        </Card>
      ) : (
        data.pending_items.map((item) => {
          const thumb = publicMediaUrl('listing-images', item.cover_path);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.title} ilanını incele`}
              onPress={() => setDetailId(item.id)}
              style={({ pressed }) => [
                styles.listingRow,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={[styles.thumb, { backgroundColor: theme.colors.surfaceMuted }]}>
                {thumb ? (
                  <Image
                    source={{ uri: thumb }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                ) : (
                  <Ionicons name="image-outline" size={18} color={theme.colors.textTertiary} />
                )}
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  @{item.seller_username} · {formatPrice(item.price_cents, item.currency)}
                </AppText>
                <View style={styles.badgeRow}>
                  <Badge label={LISTING_STATUS_LABELS[item.status] ?? item.status} tone="warning" />
                  <Badge label={KIND_LABELS[item.kind ?? ''] ?? 'Diğer'} tone="neutral" />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
            </Pressable>
          );
        })
      )}

      <ListingDetailModal listingId={detailId} onClose={() => setDetailId(null)} />
    </View>
  );
}

function Metric({
  label,
  value,
  icon,
  tone = 'primary',
}: {
  label: string;
  value: number;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const { theme } = useTheme();
  const color =
    tone === 'success'
      ? theme.colors.success
      : tone === 'warning'
        ? theme.colors.warning
        : tone === 'danger'
          ? theme.colors.danger
          : tone === 'accent'
            ? theme.colors.accent
            : theme.colors.primary;
  return (
    <Card padding={11} style={styles.metric}>
      <View style={[styles.metricIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <AppText variant="h3" numberOfLines={1}>
        {value.toLocaleString('tr-TR')}
      </AppText>
      <AppText variant="caption" color="textTertiary" numberOfLines={1}>
        {label}
      </AppText>
    </Card>
  );
}

function QuickLink({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickLink,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.quickIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={17} color={theme.colors.primaryDeep} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label" numberOfLines={1}>
          {label}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={15} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

/* ------------------------------- kategoriler ------------------------------ */

function CategoriesTab() {
  const { theme } = useTheme();
  const { data: categories = [], isLoading, isError, refetch } = useAdminCategoriesV2();
  const save = useSaveAdminCategoryV2();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AdminCategoryV2 | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(() => emptyCategoryForm());

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return categories;
    }
    return categories.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.slug.toLowerCase().includes(needle) ||
        (item.path_names ?? '').toLowerCase().includes(needle),
    );
  }, [categories, query]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyCategoryForm());
    setFormError(null);
    setCreating(true);
  };

  const openEdit = (category: AdminCategoryV2) => {
    setCreating(false);
    setEditing(category);
    setFormError(null);
    setForm({
      name: category.name,
      slug: category.slug,
      parentId: category.parent_id,
      icon: category.icon ?? '',
      kind: category.kind,
      tone: category.tone,
      description: category.description ?? '',
      aliases: (category.aliases ?? []).join(', '),
      sortOrder: String(category.sort_order),
      isActive: category.is_active,
      isFeatured: category.is_featured,
      formSchema: JSON.stringify(category.form_schema ?? {}, null, 2),
    });
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setFormError(null);
  };

  const submit = () => {
    setFormError(null);
    if (form.name.trim().length < 2) {
      setFormError('Kategori adı en az 2 karakter olmalı.');
      return;
    }
    let schema: unknown;
    try {
      schema = JSON.parse(form.formSchema || '{}');
    } catch {
      setFormError('Form şeması geçerli bir JSON değil.');
      return;
    }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      setFormError('Form şeması bir JSON nesnesi olmalı.');
      return;
    }
    const parsedSort = Number(form.sortOrder.replace(/[^\d-]/g, ''));
    save.mutate(
      {
        id: editing?.id ?? null,
        parent_id: form.parentId,
        name: form.name.trim(),
        slug: form.slug.trim() || null,
        icon: form.icon.trim() || null,
        kind: form.kind,
        tone: form.tone,
        description: form.description.trim() || null,
        aliases: form.aliases
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        sort_order: Number.isFinite(parsedSort) ? parsedSort : 0,
        is_active: form.isActive,
        is_featured: form.isFeatured,
        form_schema: schema,
      },
      {
        onSuccess: () => {
          haptics.success();
          closeForm();
        },
        onError: (error) => setFormError(adminMarketError(error)),
      },
    );
  };

  const toggleActive = (category: AdminCategoryV2) => {
    save.mutate(
      {
        id: category.id,
        parent_id: category.parent_id,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        kind: category.kind,
        tone: category.tone,
        description: category.description,
        aliases: category.aliases ?? [],
        sort_order: category.sort_order,
        is_active: !category.is_active,
        is_featured: category.is_featured,
        form_schema: category.form_schema ?? {},
      },
      {
        onSuccess: () => haptics.selection(),
        onError: (error) => Alert.alert('Güncellenemedi', adminMarketError(error)),
      },
    );
  };

  const roots = categories.filter((item) => item.depth <= 2 && item.id !== editing?.id);
  const parentOptions = ['Kök kategori', ...roots.map((item) => item.path_names)];

  return (
    <View style={styles.section}>
      {creating || editing ? (
        <CategoryForm
          form={form}
          setForm={setForm}
          editing={editing}
          parentOptions={parentOptions}
          roots={roots}
          error={formError}
          saving={save.isPending}
          onCancel={closeForm}
          onSave={submit}
        />
      ) : (
        <Button label="Yeni kategori" variant="secondary" onPress={openCreate} />
      )}

      <TextField
        placeholder="Kategori adı, adres veya yol ara"
        value={query}
        onChangeText={setQuery}
        leftIcon="search-outline"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : isError ? (
        <SafetyEmptyState
          icon="cloud-offline-outline"
          title="Kategoriler yüklenemedi"
          body="Yetkin olduğundan emin ol ve tekrar dene."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      ) : filtered.length === 0 ? (
        <SafetyEmptyState
          icon="grid-outline"
          title="Eşleşen kategori yok"
          body="Aramayı değiştir veya yeni bir kategori oluştur."
        />
      ) : (
        filtered.map((category) => (
          <Card key={category.id} padding={12} style={styles.categoryCard}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {category.path_names || category.name}
                </AppText>
                <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                  /{category.slug} · {KIND_LABELS[category.kind] ?? category.kind} ·{' '}
                  {category.listing_count} ilan
                  {category.child_count > 0 ? ` · ${category.child_count} alt` : ''}
                </AppText>
              </View>
              <Switch
                value={category.is_active}
                onValueChange={() => toggleActive(category)}
                accessibilityLabel={`${category.name} kategorisini ${
                  category.is_active ? 'pasife al' : 'aktif et'
                }`}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                thumbColor={theme.colors.surface}
              />
            </View>
            <View style={styles.actions}>
              {category.is_featured ? <Badge label="Öne çıkan" tone="accent" /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${category.name} kategorisini düzenle`}
                onPress={() => openEdit(category)}
                style={({ pressed }) => [
                  styles.actionChip,
                  { borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="create-outline" size={14} color={theme.colors.textSecondary} />
                <AppText variant="caption" color="textSecondary">
                  Düzenle
                </AppText>
              </Pressable>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

type CategoryFormState = {
  name: string;
  slug: string;
  parentId: string | null;
  icon: string;
  kind: string;
  tone: string;
  description: string;
  aliases: string;
  sortOrder: string;
  isActive: boolean;
  isFeatured: boolean;
  formSchema: string;
};

function emptyCategoryForm(): CategoryFormState {
  return {
    name: '',
    slug: '',
    parentId: null,
    icon: '',
    kind: 'product',
    tone: 'primary',
    description: '',
    aliases: '',
    sortOrder: '0',
    isActive: true,
    isFeatured: false,
    formSchema: '{\n  "fields": []\n}',
  };
}

function CategoryForm({
  form,
  setForm,
  editing,
  parentOptions,
  roots,
  error,
  saving,
  onCancel,
  onSave,
}: {
  form: CategoryFormState;
  setForm: React.Dispatch<React.SetStateAction<CategoryFormState>>;
  editing: AdminCategoryV2 | null;
  parentOptions: string[];
  roots: AdminCategoryV2[];
  error: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { theme } = useTheme();
  const [parentSheet, setParentSheet] = useState(false);
  const [kindSheet, setKindSheet] = useState(false);
  const [toneSheet, setToneSheet] = useState(false);
  const parentLabel = form.parentId
    ? (roots.find((item) => item.id === form.parentId)?.path_names ?? 'Kök kategori')
    : 'Kök kategori';

  return (
    <Card padding={14} style={styles.form}>
      <AppText variant="bodyStrong">{editing ? 'Kategoriyi düzenle' : 'Yeni kategori'}</AppText>

      <TextField
        label="Ad"
        placeholder="Örn. Elektronik"
        value={form.name}
        onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
        maxLength={80}
      />
      <TextField
        label="Adres (slug)"
        placeholder="Boş bırakırsan addan üretilir"
        value={form.slug}
        onChangeText={(value) => setForm((current) => ({ ...current, slug: value.toLowerCase() }))}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={80}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Üst kategori: ${parentLabel}`}
        onPress={() => setParentSheet(true)}
        style={[styles.pickerRow, { borderColor: theme.colors.border }]}
      >
        <AppText variant="body" style={styles.flex} numberOfLines={1}>
          {parentLabel}
        </AppText>
        <Ionicons name="chevron-down" size={15} color={theme.colors.textTertiary} />
      </Pressable>

      <View style={styles.rowGap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Tür: ${KIND_LABELS[form.kind] ?? form.kind}`}
          onPress={() => setKindSheet(true)}
          style={[styles.pickerRow, styles.flex, { borderColor: theme.colors.border }]}
        >
          <AppText variant="body" style={styles.flex} numberOfLines={1}>
            {KIND_LABELS[form.kind] ?? form.kind}
          </AppText>
          <Ionicons name="chevron-down" size={15} color={theme.colors.textTertiary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Renk tonu: ${form.tone}`}
          onPress={() => setToneSheet(true)}
          style={[styles.pickerRow, styles.toneField, { borderColor: theme.colors.border }]}
        >
          <AppText variant="body" style={styles.flex} numberOfLines={1}>
            {form.tone}
          </AppText>
          <Ionicons name="chevron-down" size={15} color={theme.colors.textTertiary} />
        </Pressable>
      </View>

      <TextField
        label="Simge (Ionicons)"
        placeholder="grid-outline"
        value={form.icon}
        onChangeText={(value) => setForm((current) => ({ ...current, icon: value }))}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Açıklama"
        placeholder="Kategori açıklaması"
        value={form.description}
        onChangeText={(value) => setForm((current) => ({ ...current, description: value }))}
        multiline
        containerStyle={styles.multiline}
      />
      <TextField
        label="Arama takma adları"
        placeholder="telefon, cep telefonu, mobile"
        value={form.aliases}
        onChangeText={(value) => setForm((current) => ({ ...current, aliases: value }))}
        autoCapitalize="none"
      />
      <TextField
        label="Sıra"
        value={form.sortOrder}
        onChangeText={(value) => setForm((current) => ({ ...current, sortOrder: value }))}
        keyboardType="number-pad"
      />
      <View style={styles.rowBetween}>
        <AppText variant="label" color="textSecondary">
          Aktif
        </AppText>
        <Switch
          value={form.isActive}
          onValueChange={(value) => setForm((current) => ({ ...current, isActive: value }))}
          accessibilityLabel="Kategori aktif"
          trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
          thumbColor={theme.colors.surface}
        />
      </View>
      <View style={styles.rowBetween}>
        <AppText variant="label" color="textSecondary">
          Öne çıkan
        </AppText>
        <Switch
          value={form.isFeatured}
          onValueChange={(value) => setForm((current) => ({ ...current, isFeatured: value }))}
          accessibilityLabel="Kategori öne çıkan"
          trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
          thumbColor={theme.colors.surface}
        />
      </View>
      <TextField
        label="Form şeması (JSON)"
        placeholder={'{\n  "fields": []\n}'}
        value={form.formSchema}
        onChangeText={(value) => setForm((current) => ({ ...current, formSchema: value }))}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        containerStyle={styles.jsonField}
      />
      {error ? (
        <AppText variant="caption" color="danger">
          {error}
        </AppText>
      ) : null}
      <View style={styles.rowGap}>
        <Button label="Kaydet" onPress={onSave} loading={saving} style={styles.flex} />
        <Button label="Vazgeç" variant="secondary" onPress={onCancel} style={styles.flex} />
      </View>

      <SelectSheet
        visible={parentSheet}
        title="Üst kategori"
        options={parentOptions}
        value={parentLabel}
        onClose={() => setParentSheet(false)}
        onSelect={(value) => {
          const match = roots.find((item) => item.path_names === value);
          setForm((current) => ({ ...current, parentId: match?.id ?? null }));
          setParentSheet(false);
        }}
      />
      <SelectSheet
        visible={kindSheet}
        title="Kategori türü"
        options={KIND_OPTIONS.map((kind) => KIND_LABELS[kind] ?? kind)}
        value={KIND_LABELS[form.kind] ?? form.kind}
        onClose={() => setKindSheet(false)}
        onSelect={(value) => {
          const match = KIND_OPTIONS.find((kind) => (KIND_LABELS[kind] ?? kind) === value);
          setForm((current) => ({ ...current, kind: match ?? current.kind }));
          setKindSheet(false);
        }}
      />
      <SelectSheet
        visible={toneSheet}
        title="Renk tonu"
        options={TONE_OPTIONS}
        value={form.tone}
        onClose={() => setToneSheet(false)}
        onSelect={(value) => {
          setForm((current) => ({ ...current, tone: value }));
          setToneSheet(false);
        }}
      />
    </Card>
  );
}

/* ---------------------------------- ilanlar -------------------------------- */

function ListingsTab() {
  const { theme } = useTheme();
  const bootstrap = useExploreBootstrap();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>('pending');
  const [kind, setKind] = useState<string | null>(null);
  const [districtId, setDistrictId] = useState<number | null>(null);
  const [districtSheet, setDistrictSheet] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 300);
  const { data, isLoading, isError, refetch } = useAdminListingsV2({
    query: debouncedQuery,
    status,
    kind,
    category: null,
    districtId,
  });

  const districts = bootstrap.data?.districts ?? [];
  const districtLabel = districts.find((item) => item.id === districtId)?.name ?? 'Tüm ilçeler';
  const items = data?.items ?? [];

  const statusOptions: { value: string | null; label: string }[] = [
    { value: null, label: 'Tümü' },
    { value: 'pending', label: 'İncelemede' },
    { value: 'active', label: 'Yayında' },
    { value: 'rejected', label: 'Reddedilen' },
    { value: 'draft', label: 'Taslak' },
    { value: 'removed', label: 'Kaldırılan' },
    { value: 'expired', label: 'Süresi dolan' },
  ];

  return (
    <View style={styles.section}>
      <TextField
        placeholder="Başlık, satıcı veya ilan ID ara"
        value={query}
        onChangeText={setQuery}
        leftIcon="search-outline"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {statusOptions.map((option) => {
          const active = status === option.value;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setStatus(option.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                  borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {[
          { value: null, label: 'Tüm türler' },
          ...KIND_OPTIONS.map((value) => ({ value, label: KIND_LABELS[value] ?? value })),
        ].map((option) => {
          const active = kind === option.value;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setKind(option.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                  borderColor: active ? theme.colors.accent : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`İlçe filtresi: ${districtLabel}`}
        onPress={() => setDistrictSheet(true)}
        style={[
          styles.filterRow,
          { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
        ]}
      >
        <Ionicons name="location-outline" size={16} color={theme.colors.textTertiary} />
        <AppText variant="body" style={styles.flex} numberOfLines={1}>
          {districtLabel}
        </AppText>
        <Ionicons name="chevron-down" size={15} color={theme.colors.textTertiary} />
      </Pressable>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : isError ? (
        <SafetyEmptyState
          icon="cloud-offline-outline"
          title="İlanlar yüklenemedi"
          body="Yetkin olduğundan emin ol ve tekrar dene."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      ) : items.length === 0 ? (
        <SafetyEmptyState
          icon="storefront-outline"
          title="Eşleşen ilan yok"
          body="Filtreleri değiştirerek tekrar dene."
        />
      ) : (
        items.map((listing) => (
          <AdminListingRow
            key={listing.id}
            listing={listing}
            onPress={() => setDetailId(listing.id)}
          />
        ))
      )}

      <SelectSheet
        visible={districtSheet}
        title="İlçe"
        options={['Tüm ilçeler', ...districts.map((item) => item.name)]}
        value={districtLabel}
        onClose={() => setDistrictSheet(false)}
        onSelect={(value) => {
          const match = districts.find((item) => item.name === value);
          setDistrictId(match?.id ?? null);
          setDistrictSheet(false);
        }}
      />

      <ListingDetailModal listingId={detailId} onClose={() => setDetailId(null)} />
    </View>
  );
}

function AdminListingRow({ listing, onPress }: { listing: AdminListingV2; onPress: () => void }) {
  const { theme } = useTheme();
  const thumb = publicMediaUrl('listing-images', listing.cover_path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title} ilanını incele`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.listingRow,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.thumb, { backgroundColor: theme.colors.surfaceMuted }]}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Ionicons name="image-outline" size={18} color={theme.colors.textTertiary} />
        )}
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {listing.title}
        </AppText>
        <AppText variant="caption" color="textTertiary" numberOfLines={1}>
          @{listing.seller_username} · {formatPrice(listing.price_cents, listing.currency)}
          {listing.district ? ` · ${listing.district}` : ''}
        </AppText>
        <View style={styles.badgeRow}>
          <Badge
            label={LISTING_STATUS_LABELS[listing.status] ?? listing.status}
            tone={
              listing.status === 'active'
                ? 'success'
                : listing.status === 'pending'
                  ? 'warning'
                  : 'neutral'
            }
          />
          <Badge label={KIND_LABELS[listing.kind] ?? listing.kind} tone="neutral" />
          {listing.report_count > 0 ? (
            <Badge label={`${listing.report_count} şikâyet`} tone="danger" />
          ) : null}
          {listing.verification_status === 'pending' ? (
            <Badge label="EİDS bekliyor" tone="warning" />
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

/* ------------------------------- ilan detay -------------------------------- */

function ListingDetailModal({
  listingId,
  onClose,
}: {
  listingId: string | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch } = useAdminListingDetailV2(listingId);
  const moderate = useModerateAdminListing();
  const removeMedia = useRemoveAdminListingMedia();
  const [pendingAction, setPendingAction] = useState<ModerationAction | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const close = () => {
    setPendingAction(null);
    setReason('');
    setActionError(null);
    onClose();
  };

  const applyAction = (action: ModerationAction) => {
    if (!listingId) {
      return;
    }
    if (action === 'reject' || action === 'remove') {
      if (reason.trim().length < 3) {
        setActionError('Reddetme veya kaldırma için kısa bir gerekçe yaz.');
        return;
      }
    }
    setActionError(null);
    moderate.mutate(
      {
        id: listingId,
        action,
        reason: reason.trim() || null,
      },
      {
        onSuccess: () => {
          haptics.success();
          setPendingAction(null);
          setReason('');
        },
        onError: (error) => setActionError(adminMarketError(error)),
      },
    );
  };

  const confirmRemoveMedia = (mediaId: string) => {
    Alert.alert(
      'Medyayı kaldır',
      'Bu fotoğraf/video kalıcı olarak kaldırılacak ve satıcıya bildirim gidecek.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: () =>
            removeMedia.mutate(
              { mediaId, reason: 'moderasyon' },
              {
                onSuccess: () => haptics.success(),
                onError: (error) => Alert.alert('Kaldırılamadı', adminMarketError(error)),
              },
            ),
        },
      ],
    );
  };

  return (
    <Modal visible={Boolean(listingId)} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={close} accessibilityLabel="Kapat" />
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: theme.colors.background,
              borderColor: theme.colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.modalHead}>
            <AppText variant="h3" style={styles.flex} numberOfLines={1}>
              İlan inceleme
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={close}>
              <Ionicons name="close" size={22} color={theme.colors.text} />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : isError || !data ? (
            <View style={styles.center}>
              <AppText variant="body" color="textSecondary" align="center">
                İlan detayı alınamadı.
              </AppText>
              <Button
                label="Tekrar dene"
                variant="secondary"
                size="sm"
                onPress={() => void refetch()}
              />
            </View>
          ) : (
            <ListingDetailBody
              listing={data}
              theme={theme}
              pendingAction={pendingAction}
              reason={reason}
              actionError={actionError}
              busy={moderate.isPending || removeMedia.isPending}
              onReasonChange={setReason}
              onPickAction={(action) => {
                setActionError(null);
                if (action === 'reject' || action === 'remove') {
                  setPendingAction(action);
                  return;
                }
                setPendingAction(null);
                applyAction(action);
              }}
              onConfirm={() => {
                if (pendingAction) {
                  applyAction(pendingAction);
                }
              }}
              onCancelReason={() => {
                setPendingAction(null);
                setReason('');
                setActionError(null);
              }}
              onRemoveMedia={confirmRemoveMedia}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function ListingDetailBody({
  listing,
  theme,
  pendingAction,
  reason,
  actionError,
  busy,
  onReasonChange,
  onPickAction,
  onConfirm,
  onCancelReason,
  onRemoveMedia,
}: {
  listing: AdminListingDetail;
  theme: ReturnType<typeof useTheme>['theme'];
  pendingAction: ModerationAction | null;
  reason: string;
  actionError: string | null;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onPickAction: (action: ModerationAction) => void;
  onConfirm: () => void;
  onCancelReason: () => void;
  onRemoveMedia: (id: string) => void;
}) {
  const media = listing.media ?? [];
  const attributes = Object.entries(listing.attributes ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.modalContent}
      showsVerticalScrollIndicator={false}
    >
      {media.length > 0 ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mediaRow}
        >
          {media.map((item) => {
            const uri = publicMediaUrl('listing-images', item.thumb_path ?? item.storage_path);
            return (
              <View
                key={item.id}
                style={[styles.detailMedia, { backgroundColor: theme.colors.surfaceMuted }]}
              >
                {uri ? (
                  <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : null}
                {item.kind === 'video' ? (
                  <View style={styles.videoBadge}>
                    <Ionicons name="play" size={13} color="#fff" />
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Medyayı kaldır"
                  onPress={() => onRemoveMedia(item.id)}
                  style={styles.mediaRemove}
                >
                  <Ionicons name="trash-outline" size={13} color="#fff" />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <Card padding={14}>
          <AppText variant="caption" color="textTertiary">
            Bu ilanda medya yok.
          </AppText>
        </Card>
      )}

      <View style={styles.badgeRow}>
        <Badge
          label={LISTING_STATUS_LABELS[listing.status] ?? listing.status}
          tone={
            listing.status === 'active'
              ? 'success'
              : listing.status === 'pending'
                ? 'warning'
                : 'neutral'
          }
        />
        <Badge
          label={
            LISTING_STATUS_LABELS[listing.moderation_status] ??
            MODERATION_LABELS[listing.moderation_status] ??
            listing.moderation_status
          }
          tone="neutral"
        />
        <Badge label={KIND_LABELS[listing.kind] ?? listing.kind} tone="accent" />
        {listing.verification_status !== 'verified' ? (
          <Badge label="Doğrulanmamış" tone="warning" />
        ) : null}
      </View>

      <AppText variant="h3">{listing.title}</AppText>
      <AppText variant="h2" color="primaryDeep">
        {formatPrice(listing.price_cents, listing.currency)}
        {listing.price_period === 'month' ? ' / ay' : ''}
      </AppText>
      <AppText variant="caption" color="textTertiary">
        @{listing.seller_username} · {listing.category_name ?? 'Kategori yok'} ·{' '}
        {listing.district ?? listing.city ?? 'Konum yok'} · {listing.view_count} görüntülenme ·{' '}
        {listing.favorite_count} favori
      </AppText>
      <AppText variant="caption" color="textTertiary">
        Oluşturma: {new Date(listing.created_at).toLocaleString('tr-TR')}
        {listing.published_at
          ? ` · Yayın: ${new Date(listing.published_at).toLocaleString('tr-TR')}`
          : ''}
      </AppText>

      {listing.description ? (
        <Card padding={13}>
          <AppText variant="body" color="textSecondary">
            {listing.description}
          </AppText>
        </Card>
      ) : null}

      {attributes.length > 0 ? (
        <Card padding={13} style={styles.attributeCard}>
          <AppText variant="bodyStrong">Kategori özellikleri</AppText>
          {attributes.map(([key, value]) => (
            <View key={key} style={styles.attributeRow}>
              <AppText variant="caption" color="textTertiary" style={styles.flex}>
                {key}
              </AppText>
              <AppText variant="caption" style={styles.attributeValue}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </AppText>
            </View>
          ))}
        </Card>
      ) : null}

      {listing.reports && listing.reports.length > 0 ? (
        <Card padding={13} style={styles.attributeCard}>
          <AppText variant="bodyStrong">Şikâyetler</AppText>
          {listing.reports.map((report) => (
            <View key={report.id} style={styles.reportRow}>
              <Ionicons name="flag-outline" size={14} color={theme.colors.danger} />
              <View style={styles.flex}>
                <AppText variant="caption" color="textSecondary">
                  {report.reason ?? 'şikâyet'} · @{report.reporter_username ?? 'kullanıcı'} ·{' '}
                  {new Date(report.created_at).toLocaleString('tr-TR')}
                </AppText>
                {report.details ? (
                  <AppText variant="caption" color="textTertiary">
                    {report.details}
                  </AppText>
                ) : null}
              </View>
              <Badge label={report.status} tone="neutral" />
            </View>
          ))}
        </Card>
      ) : null}

      {listing.history && listing.history.length > 0 ? (
        <Card padding={13} style={styles.attributeCard}>
          <AppText variant="bodyStrong">Durum geçmişi</AppText>
          {listing.history.slice(0, 8).map((entry) => (
            <View key={entry.id} style={styles.reportRow}>
              <Ionicons name="time-outline" size={14} color={theme.colors.textTertiary} />
              <View style={styles.flex}>
                <AppText variant="caption" color="textSecondary">
                  {LISTING_STATUS_LABELS[entry.from_status ?? ''] ?? entry.from_status ?? '—'} →{' '}
                  {LISTING_STATUS_LABELS[entry.to_status ?? ''] ?? entry.to_status ?? '—'}
                  {entry.actor_username ? ` · @${entry.actor_username}` : ''}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {new Date(entry.created_at).toLocaleString('tr-TR')}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </AppText>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {listing.price_history && listing.price_history.length > 0 ? (
        <Card padding={13} style={styles.attributeCard}>
          <AppText variant="bodyStrong">Fiyat geçmişi</AppText>
          {listing.price_history.slice(0, 8).map((entry) => (
            <View key={String(entry.id)} style={styles.reportRow}>
              <Ionicons name="pricetag-outline" size={14} color={theme.colors.textTertiary} />
              <View style={styles.flex}>
                <AppText variant="caption" color="textSecondary">
                  {entry.old_price_cents == null
                    ? 'İlk fiyat'
                    : formatPrice(entry.old_price_cents, entry.currency)}{' '}
                  → {formatPrice(entry.new_price_cents, entry.currency)}
                  {entry.actor_username ? ` · @${entry.actor_username}` : ''}
                </AppText>
                <AppText variant="caption" color="textTertiary">
                  {new Date(entry.changed_at).toLocaleString('tr-TR')}
                </AppText>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {pendingAction === 'reject' || pendingAction === 'remove' ? (
        <Card padding={13} style={styles.reasonCard}>
          <AppText variant="bodyStrong">
            {MODERATION_ACTION_LABELS[pendingAction]} gerekçesi
          </AppText>
          <TextField
            placeholder="Satıcıya iletilecek kısa gerekçe"
            value={reason}
            onChangeText={onReasonChange}
            multiline
            maxLength={300}
            containerStyle={styles.reasonInput}
          />
          {actionError ? (
            <AppText variant="caption" color="danger">
              {actionError}
            </AppText>
          ) : null}
          <View style={styles.rowGap}>
            <Button
              label="İşlemi uygula"
              variant="danger"
              size="sm"
              loading={busy}
              disabled={busy}
              onPress={onConfirm}
              style={styles.flex}
            />
            <Button
              label="Vazgeç"
              variant="secondary"
              size="sm"
              disabled={busy}
              onPress={onCancelReason}
              style={styles.flex}
            />
          </View>
        </Card>
      ) : (
        <>
          {actionError ? (
            <AppText variant="caption" color="danger">
              {actionError}
            </AppText>
          ) : null}
          <View style={styles.moderationActions}>
            <Button
              label="Onayla"
              size="sm"
              loading={busy}
              disabled={busy}
              onPress={() => onPickAction('approve')}
              style={styles.flex}
            />
            <Button
              label="Reddet"
              variant="danger"
              size="sm"
              disabled={busy}
              onPress={() => onPickAction('reject')}
              style={styles.flex}
            />
          </View>
          <View style={styles.moderationActions}>
            <Button
              label="Yayından kaldır"
              variant="secondary"
              size="sm"
              disabled={busy}
              onPress={() => onPickAction('remove')}
              style={styles.flex}
            />
            <Button
              label="Geri yükle"
              variant="secondary"
              size="sm"
              disabled={busy}
              onPress={() => onPickAction('restore')}
              style={styles.flex}
            />
          </View>
          <Button
            label="Süresini doldur"
            variant="ghost"
            size="sm"
            disabled={busy}
            onPress={() => onPickAction('expire')}
          />
          <AppText variant="caption" color="textTertiary">
            Emlak ve taşıt ilanları EİDS doğrulaması tamamlanmadan yayına alınamaz. Doğrulama durumu
            yalnızca yetkili entegrasyon tarafından yazılır.
          </AppText>
        </>
      )}
    </ScrollView>
  );
}

/* --------------------------------- analitik -------------------------------- */

function AnalyticsTab() {
  const { theme } = useTheme();
  const { data, isLoading, isError, refetch } = useAdminAnalytics(14);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <SafetyEmptyState
        icon="cloud-offline-outline"
        title="Analitik yüklenemedi"
        body="Yetkin olduğundan emin ol ve tekrar dene."
        actionLabel="Tekrar dene"
        onAction={() => void refetch()}
      />
    );
  }

  return (
    <View style={styles.section}>
      <AnalyticsCard title="Son 14 gün ilan hareketi" analytics={data} />
      <KindDistribution analytics={data} />
      <DistrictDistribution analytics={data} />
      <TopList title="En çok görüntülenen" items={data.top_viewed} metric="views" />
      <TopList title="En çok favorilenen" items={data.top_favorited} metric="favorites" />
      <AppText variant="caption" color="textTertiary">
        Tüm grafikler `marketplace_listings`, `marketplace_favorites` ve ilçe tablolarından canlı
        hesaplanır. Dışa aktarma işlemleri yalnızca `market.manage` yetkisiyle yapılabilir.
      </AppText>
    </View>
  );
}

function AnalyticsCard({ title, analytics }: { title: string; analytics: AdminAnalytics }) {
  const { theme } = useTheme();
  const max = Math.max(1, ...analytics.daily.map((item) => item.created));
  return (
    <Card padding={13} style={styles.analyticsCard}>
      <AppText variant="bodyStrong">{title}</AppText>
      <View style={styles.chart}>
        {analytics.daily.map((item) => (
          <View key={item.day} style={styles.chartColumn}>
            <View style={styles.chartBarTrack}>
              <View
                style={[
                  styles.chartBar,
                  {
                    height: `${Math.max(4, Math.round((item.created / max) * 100))}%`,
                    backgroundColor: theme.colors.primary,
                  },
                ]}
              />
            </View>
            <AppText variant="caption" color="textTertiary" style={styles.chartLabel}>
              {item.day.slice(8)}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" color="textTertiary">
        Günlük oluşturulan ilanlar · toplam{' '}
        {analytics.daily.reduce((sum, item) => sum + item.created, 0)}
      </AppText>
    </Card>
  );
}

function KindDistribution({ analytics }: { analytics: AdminAnalytics }) {
  const { theme } = useTheme();
  const max = Math.max(1, ...analytics.kinds.map((item) => item.total));
  return (
    <Card padding={13} style={styles.analyticsCard}>
      <AppText variant="bodyStrong">Tür dağılımı</AppText>
      {analytics.kinds.map((item) => (
        <View key={item.kind} style={styles.barRow}>
          <AppText variant="caption" style={styles.barLabel} numberOfLines={1}>
            {item.label}
          </AppText>
          <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max(4, Math.round((item.total / max) * 100))}%`,
                  backgroundColor: theme.colors.primaryDeep,
                },
              ]}
            />
          </View>
          <AppText variant="caption" color="textTertiary" style={styles.barValue}>
            {item.total}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

function DistrictDistribution({ analytics }: { analytics: AdminAnalytics }) {
  const { theme } = useTheme();
  const max = Math.max(1, ...analytics.districts.map((item) => item.total));
  return (
    <Card padding={13} style={styles.analyticsCard}>
      <AppText variant="bodyStrong">İlçe dağılımı</AppText>
      {analytics.districts.length === 0 ? (
        <AppText variant="caption" color="textTertiary">
          Henüz ilçe verisi yok.
        </AppText>
      ) : (
        analytics.districts.map((item) => (
          <View key={item.district} style={styles.barRow}>
            <AppText variant="caption" style={styles.barLabel} numberOfLines={1}>
              {item.district}
            </AppText>
            <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceMuted }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.max(4, Math.round((item.total / max) * 100))}%`,
                    backgroundColor: theme.colors.accent,
                  },
                ]}
              />
            </View>
            <AppText variant="caption" color="textTertiary" style={styles.barValue}>
              {item.total}
            </AppText>
          </View>
        ))
      )}
    </Card>
  );
}

function TopList({
  title,
  items,
  metric,
}: {
  title: string;
  items: AdminAnalytics['top_viewed'];
  metric: 'views' | 'favorites';
}) {
  const { theme } = useTheme();
  return (
    <Card padding={13} style={styles.analyticsCard}>
      <AppText variant="bodyStrong">{title}</AppText>
      {items.length === 0 ? (
        <AppText variant="caption" color="textTertiary">
          Veri yok.
        </AppText>
      ) : (
        items.map((item, index) => (
          <View key={item.id} style={styles.topRow}>
            <View style={[styles.rankBadge, { backgroundColor: theme.colors.surfaceMuted }]}>
              <AppText variant="caption" color="textSecondary">
                {index + 1}
              </AppText>
            </View>
            <AppText variant="caption" style={styles.flex} numberOfLines={1}>
              {item.title}
            </AppText>
            <AppText variant="caption" color="primaryDeep">
              {item[metric]}
            </AppText>
          </View>
        ))
      )}
    </Card>
  );
}

/* --------------------------------- siparişler ------------------------------- */

function OrdersTab() {
  const { theme } = useTheme();
  const [status, setStatus] = useState<string>('all');
  const [pdfBusy, setPdfBusy] = useState(false);
  const { data, isLoading, isError, refetch } = useAdminOrders(status === 'all' ? null : status);
  const items = data?.items ?? [];

  const exportPdf = async () => {
    haptics.tap();
    setPdfBusy(true);
    const summary = await fetchSalesSummary('all');
    setPdfBusy(false);
    if (!summary.ok) {
      Alert.alert('PDF raporu', summary.error.message);
      return;
    }
    const result = await shareSalesReport({
      orders: items.map((order) => ({
        order_no: order.order_no,
        created_at: order.created_at,
        status: order.status,
        total_cents: order.total_cents,
        currency: order.currency,
        buyer_username: order.buyer_username,
        seller_username: order.seller_username,
      })),
      summary: summary.data,
      scope: 'all',
      ownerLabel: 'Yönetici satış raporu',
    });
    if (!result.ok) {
      Alert.alert('PDF raporu', result.error.message);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.rowBetween}>
        <AppText variant="caption" color="textTertiary" style={styles.flex}>
          Pazar geneli sipariş kayıtları · {items.length} kayıt
        </AppText>
        <Button
          label={pdfBusy ? 'Hazırlanıyor…' : 'PDF raporu'}
          variant="secondary"
          size="sm"
          fullWidth={false}
          loading={pdfBusy}
          onPress={() => void exportPdf()}
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {ORDER_STATUS_OPTIONS.map((option) => {
          const active = status === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setStatus(option)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? theme.colors.primaryDeep : theme.colors.surface,
                  borderColor: active ? theme.colors.primaryDeep : theme.colors.border,
                },
              ]}
            >
              <AppText variant="caption" color={active ? 'onPrimary' : 'textSecondary'}>
                {option === 'all' ? 'Tümü' : ORDER_STATUS_LABELS[option as OrderStatus]}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : isError ? (
        <SafetyEmptyState
          icon="cloud-offline-outline"
          title="Siparişler yüklenemedi"
          body="Yetkin olduğundan emin ol ve tekrar dene."
          actionLabel="Tekrar dene"
          onAction={() => void refetch()}
        />
      ) : items.length === 0 ? (
        <SafetyEmptyState
          icon="receipt-outline"
          title="Sipariş yok"
          body="Bu durumda marketplace siparişi bulunmuyor."
        />
      ) : (
        items.map((order) => <OrderRow key={order.id} order={order} />)
      )}
      <AppText variant="caption" color="textTertiary">
        Siparişler salt okunurdur. Ödeme altyapısı etkin olmadığında `payment_status` alanı
        `not_collected` kalır; uygulama başarılı ödeme mesajı göstermez.
      </AppText>
    </View>
  );
}

function OrderRow({ order }: { order: AdminOrder }) {
  const { theme } = useTheme();
  return (
    <Card padding={12} style={styles.orderCard}>
      <View style={styles.rowBetween}>
        <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
          {order.order_no}
        </AppText>
        <Badge label={ORDER_STATUS_LABELS[order.status]} tone="neutral" />
      </View>
      <AppText variant="caption" color="textSecondary" numberOfLines={1}>
        @{order.buyer_username} → @{order.seller_username} · {order.item_count} ürün
      </AppText>
      <View style={styles.rowBetween}>
        <AppText variant="bodyStrong">{formatPrice(order.total_cents, order.currency)}</AppText>
        <AppText variant="caption" color="textTertiary">
          {order.payment_method === 'arrange_with_seller'
            ? 'Satıcıyla anlaşma'
            : order.payment_method}
          {' · '}
          {order.payment_status === 'not_collected' ? 'ödeme alınmadı' : order.payment_status}
        </AppText>
      </View>
      <View style={styles.rowGap}>
        <Ionicons name="time-outline" size={13} color={theme.colors.textTertiary} />
        <AppText variant="caption" color="textTertiary">
          {new Date(order.created_at).toLocaleString('tr-TR')}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  denied: { alignItems: 'center', gap: 10, marginTop: 20 },
  deniedIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  tab: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  section: { gap: 12 },
  center: { paddingVertical: 32, alignItems: 'center', gap: 10 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
  },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '31.5%', gap: 4 },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLinks: { gap: 7 },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  listingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCard: { gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  form: { gap: 10 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
  },
  toneField: { width: 120 },
  multiline: { minHeight: 76 },
  jsonField: { minHeight: 130 },
  chips: { gap: 6, paddingRight: 8 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(4,10,22,0.55)',
  },
  modalSheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 8 },
  modalContent: { gap: 10, paddingBottom: 24 },
  mediaRow: { gap: 8 },
  detailMedia: { width: 118, height: 92, borderRadius: 12, overflow: 'hidden' },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,10,22,0.7)',
  },
  mediaRemove: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(180,30,50,0.85)',
  },
  attributeCard: { gap: 7 },
  attributeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  attributeValue: { flex: 1.4, textAlign: 'right' },
  reportRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 3 },
  reasonCard: { gap: 8 },
  reasonInput: { minHeight: 70 },
  moderationActions: { flexDirection: 'row', gap: 8 },
  analyticsCard: { gap: 10 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 120 },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    gap: 4,
  },
  chartBarTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderRadius: 5, minHeight: 4 },
  chartLabel: { fontSize: 9 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 92 },
  barTrack: { flex: 1, height: 9, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 9, borderRadius: 5 },
  barValue: { width: 34, textAlign: 'right' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  rankBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderCard: { gap: 6 },
});
