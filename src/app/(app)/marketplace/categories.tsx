import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AppText, IconButton, Skeleton, TextField } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  useCategorySearch,
  useMarketCategories,
} from '@/features/marketplace/hooks/use-marketplace-catalog';
import type { CategoryNode } from '@/features/marketplace/services/marketplace-catalog-service';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { useRouter } from '@/utils/router';

export default function MarketCategoriesScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const debounced = useDebouncedValue(query.trim(), 240);
  const tree = useMarketCategories();
  const search = useCategorySearch(debounced);
  const searching = debounced.length >= 2;

  const roots = useMemo(() => tree.data ?? [], [tree.data]);

  const openNode = (node: CategoryNode) => {
    const rootSlug = node.path_slugs[0] ?? node.slug;
    router.push({
      pathname: '/marketplace/catalog',
      params: {
        kind: node.kind,
        category: rootSlug,
        ...(rootSlug === node.slug ? {} : { subcategory: node.slug }),
        title: node.name,
      },
    } as never);
  };

  const toggle = (id: string) => {
    haptics.selection();
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Geri" variant="surface" size={20} onPress={() => router.back()} />
        <View style={styles.flex}>
          <AppText variant="h2">Tüm Kategoriler</AppText>
          <AppText variant="caption" color="textTertiary">
            28 ana kategori · Trabzon
          </AppText>
        </View>
        <IconButton
          name="search-outline"
          accessibilityLabel="Ara"
          variant="surface"
          size={18}
          onPress={() => router.push('/marketplace/search' as never)}
        />
      </View>

      <View style={styles.searchWrap}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Kategori ara: telefon, kiralık daire, fındık…"
          leftIcon="search-outline"
          returnKeyType="search"
          rightSlot={
            query.length > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Temizle" hitSlop={8} onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ) : undefined
          }
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {searching ? (
          search.isLoading ? (
            <View style={styles.loading}>
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} height={54} radius={14} />
              ))}
            </View>
          ) : search.data?.length ? (
            <View style={styles.searchList}>
              {search.data.map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={row.name}
                  onPress={() => {
                    const rootSlug = row.path_slugs[0] ?? row.slug;
                    router.push({
                      pathname: '/marketplace/catalog',
                      params: {
                        kind: row.kind,
                        category: rootSlug,
                        ...(rootSlug === row.slug ? {} : { subcategory: row.slug }),
                        title: row.name,
                      },
                    } as never);
                  }}
                  style={({ pressed }) => [
                    styles.searchRow,
                    { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <View style={[styles.icon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name={(row.icon as never) ?? 'pricetag-outline'} size={17} color={theme.colors.primaryDeep} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="label" numberOfLines={1}>
                      {row.name}
                    </AppText>
                    <AppText variant="caption" color="textTertiary" numberOfLines={1}>
                      {row.path_names.join(' › ')}
                    </AppText>
                  </View>
                  <AppText variant="caption" color="textTertiary">
                    {row.listing_count}
                  </AppText>
                  <Ionicons name="chevron-forward" size={14} color={theme.colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.state}>
              <Ionicons name="search-outline" size={26} color={theme.colors.textTertiary} />
              <AppText variant="bodyStrong" align="center">
                Kategori bulunamadı
              </AppText>
              <AppText variant="caption" color="textTertiary" align="center">
                Kategori adı, yolu veya eş anlamlısıyla arayabilirsin.
              </AppText>
            </View>
          )
        ) : tree.isLoading ? (
          <View style={styles.loading}>
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <Skeleton key={key} height={62} radius={16} />
            ))}
          </View>
        ) : (
          <View style={styles.tree}>
            {roots.map((node) => (
              <CategoryBranch
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                onOpen={openNode}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function CategoryBranch({
  node,
  depth,
  expanded,
  onToggle,
  onOpen,
}: {
  node: CategoryNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (node: CategoryNode) => void;
}) {
  const { theme } = useTheme();
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isRoot = depth === 0;

  return (
    <View style={isRoot ? [styles.rootCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }] : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={`${node.name}${hasChildren ? ', alt kategorileri aç' : ', ilanları gör'}`}
        onPress={() => {
          haptics.tap();
          if (hasChildren) {
            onToggle(node.id);
          } else {
            onOpen(node);
          }
        }}
        style={({ pressed }) => [
          styles.nodeRow,
          !isRoot ? styles.childRow : null,
          { opacity: pressed ? 0.75 : 1, paddingLeft: isRoot ? 12 : 12 + depth * 16 },
        ]}
      >
        <View
          style={[
            isRoot ? styles.icon : styles.childIcon,
            { backgroundColor: isRoot ? theme.colors.primarySoft : theme.colors.surfaceMuted },
          ]}
        >
          <Ionicons
            name={(node.icon as never) ?? (isRoot ? 'grid-outline' : 'chevron-forward')}
            size={isRoot ? 18 : 14}
            color={isRoot ? theme.colors.primaryDeep : theme.colors.textSecondary}
          />
        </View>
        <View style={styles.flex}>
          <AppText variant={isRoot ? 'bodyStrong' : 'body'} numberOfLines={1}>
            {node.name}
          </AppText>
          <AppText variant="caption" color="textTertiary" numberOfLines={1}>
            {node.listing_count} ilan{hasChildren ? ` · ${node.children.length} alt kategori` : ''}
          </AppText>
        </View>
        {hasChildren ? (
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.colors.textTertiary}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${node.name} ilanlarını aç`}
            hitSlop={8}
            onPress={() => onOpen(node)}
          >
            <Ionicons name="arrow-forward" size={16} color={theme.colors.primaryDeep} />
          </Pressable>
        )}
      </Pressable>

      {isOpen && hasChildren ? (
        <View>
          {node.children.map((child) => (
            <CategoryBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Tüm ${node.name} ilanları`}
            onPress={() => onOpen(node)}
            style={({ pressed }) => [styles.allRow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <AppText variant="caption" color="primaryDeep">
              Tüm {node.name} ilanlarını gör
            </AppText>
            <Ionicons name="arrow-forward" size={13} color={theme.colors.primaryDeep} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 52,
    paddingBottom: 6,
  },
  flex: { flex: 1, gap: 1 },
  searchWrap: { paddingHorizontal: 18, paddingVertical: 8 },
  content: { paddingHorizontal: 18, paddingBottom: 36 },
  loading: { gap: 8, paddingTop: 8 },
  tree: { gap: 9 },
  rootCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  nodeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingRight: 12, minHeight: 58 },
  childRow: { minHeight: 50, paddingVertical: 8 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  childIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 52,
    paddingVertical: 10,
    paddingRight: 12,
  },
  searchList: { gap: 7 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  state: { alignItems: 'center', paddingVertical: 48, gap: 6 },
});
