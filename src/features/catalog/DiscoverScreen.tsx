import { useQueryClient } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../../components/ui/AppCard';
import { AppText } from '../../components/ui/AppText';
import { CategoryChip } from '../../components/ui/CategoryChip';
import { ScreenState } from '../../components/ui/ScreenState';
import { getPublicAssetUrl } from '../../lib/supabase';
import { colors, radii, spacing } from '../../theme/tokens';
import { catalogKeys, useCatalogApps, useCategories } from './catalog.queries';
import type { CatalogCard, Category } from './catalog.types';
import { useCatalogFilters } from './useCatalogFilters';

const allCategory: Category = Object.freeze({ id: 'all', slug: 'all', name: 'Tümü' });
const emptyApps: readonly CatalogCard[] = Object.freeze([]);

export function DiscoverScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const filters = useCatalogFilters();
  const categoriesQuery = useCategories();
  const appsQuery = useCatalogApps({
    query: filters.debouncedQuery,
    categorySlug: filters.categorySlug,
    sort: filters.sort,
  });
  const apps = appsQuery.data ?? emptyApps;
  const categories = categoriesQuery.data ?? [];
  const featuredApp = useMemo(() => apps.find(app => app.featured), [apps]);
  const listedApps = useMemo(
    () => (featuredApp ? apps.filter(app => app.id !== featuredApp.id) : apps),
    [apps, featuredApp],
  );

  const openApp = useCallback(
    (app: CatalogCard) => router.push(`/apps/${app.slug}` as Href),
    [router],
  );
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
    [queryClient],
  );

  const header = (
    <View>
      <AppText variant="title" style={styles.wordmark}>
        cep depo<AppText tone="accent" variant="title">.</AppText>
      </AppText>
      <AppText accessibilityRole="header" variant="display" style={styles.hero}>
        Uygulamanı keşfet.
      </AppText>
      <AppText tone="muted" style={styles.intro}>
        Bağımsız Android uygulamalarını sade ve güvenilir bir katalogda bul.
      </AppText>

      <TextInput
        accessibilityLabel="Uygulama ara"
        autoCapitalize="none"
        onChangeText={filters.setQuery}
        placeholder="Uygulama, kategori veya özellik ara"
        placeholderTextColor={colors.textSubtle}
        returnKeyType="search"
        style={styles.search}
        value={filters.query}
      />

      <ScrollView
        contentContainerStyle={styles.categories}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <CategoryChip
          category={allCategory}
          onPress={() => filters.setCategorySlug(null)}
          selected={filters.categorySlug === null}
        />
        {categories.map(category => (
          <CategoryChip
            category={category}
            key={category.id}
            onPress={selected => filters.setCategorySlug(selected.slug)}
            selected={filters.categorySlug === category.slug}
          />
        ))}
      </ScrollView>

      <View accessibilityLabel="Katalog sıralaması" style={styles.sortRow}>
        {(['popular', 'newest'] as const).map(sort => {
          const selected = filters.sort === sort;
          const label = sort === 'popular' ? 'Popüler' : 'Yeni';
          return (
            <Pressable
              accessibilityLabel={`${label} sıralaması`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={sort}
              onPress={() => filters.setSort(sort)}
              style={[styles.sortButton, selected && styles.sortButtonSelected]}
            >
              <AppText tone={selected ? 'primary' : 'muted'} variant="label">{label}</AppText>
            </Pressable>
          );
        })}
      </View>

      {featuredApp ? (
        <View style={styles.featured}>
          <AppText tone="accent" variant="label" style={styles.sectionLabel}>EDİTÖRÜN SEÇİMİ</AppText>
          <AppCard
            app={featuredApp}
            iconUri={featuredApp.iconPath ? getPublicAssetUrl(featuredApp.iconPath) : null}
            onPress={openApp}
          />
        </View>
      ) : null}
      {listedApps.length > 0 ? <AppText variant="title" style={styles.sectionTitle}>Uygulamalar</AppText> : null}
    </View>
  );

  const isPending = appsQuery.isPending || categoriesQuery.isPending;
  const isError = appsQuery.isError || categoriesQuery.isError;
  const hasActiveFilter = filters.query.trim().length > 0 || filters.categorySlug !== null;

  if (isPending) {
    return <SafeAreaView style={styles.screen}><ScreenState kind="loading" title="Katalog yükleniyor" /></SafeAreaView>;
  }
  if (isError) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenState
          kind="error"
          message="Bağlantını kontrol edip yeniden deneyebilirsin."
          onRetry={() => void refresh()}
          title="Uygulamalar yüklenemedi."
        />
      </SafeAreaView>
    );
  }
  if (apps.length === 0) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.emptyHeader}>{header}</View>
        <ScreenState
          kind="empty"
          message={hasActiveFilter ? 'Arama veya kategori seçimini değiştirebilirsin.' : 'İlk yayınlar hazırlanıyor.'}
          title={hasActiveFilter ? 'Sonuç bulunamadı.' : 'Mağaza henüz boş.'}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={listedApps}
        keyExtractor={app => app.id}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            colors={[colors.accent]}
            onRefresh={() => void refresh()}
            refreshing={appsQuery.isFetching || categoriesQuery.isFetching}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <AppCard
            app={item}
            iconUri={item.iconPath ? getPublicAssetUrl(item.iconPath) : null}
            onPress={openApp}
          />
        )}
        testID="catalog-list"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  emptyHeader: { paddingHorizontal: spacing.lg },
  wordmark: { marginTop: spacing.lg, letterSpacing: -1 },
  hero: { marginTop: spacing.xxl, letterSpacing: -1.3 },
  intro: { marginTop: spacing.sm, maxWidth: 520 },
  search: {
    minHeight: 48,
    marginTop: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.lg,
  },
  categories: { paddingVertical: spacing.lg },
  sortRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  sortButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  sortButtonSelected: { borderBottomColor: colors.accent },
  featured: { marginBottom: spacing.lg },
  sectionLabel: { marginBottom: spacing.sm, letterSpacing: 1.2 },
  sectionTitle: { marginBottom: spacing.md },
});
