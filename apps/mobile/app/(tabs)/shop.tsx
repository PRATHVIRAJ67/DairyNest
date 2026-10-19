import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { ProductCard } from '@/components/ProductCard';
import { CartBar } from '@/components/CartBar';
import { CardSkeleton, Chip, EmptyState, ErrorState, Input, Row, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { categoryLabel } from '@/lib/format';
import { useCategories, useProducts } from '@/lib/queries';
import { spacing } from '@/theme/tokens';


export default function Shop() {
  const params = useLocalSearchParams<{ category?: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { setCategory(params.category); }, [params.category]);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const products = useProducts({ category, q: q || undefined });
  // Categories come from the server, so new ones (ghee, paneer…) appear without an app update.
  const cats = [{ k: undefined as string | undefined, t: 'All' }, ...(useCategories().data ?? []).map((c) => ({ k: c.category, t: categoryLabel(c.category) }))];
  const cardW = Math.floor((width - spacing.lg * 2 - spacing.md) / 2);

  return (
    <View style={{ flex: 1 }}>
      <Screen onRefresh={() => products.refetch()} refreshing={products.isRefetching}>
        <Text variant="display">Shop</Text>
        <Text muted style={{ marginBottom: spacing.lg }}>Fresh dairy, delivered every morning</Text>
        <Input label="Search" icon="search" placeholder="Search products…" value={search} onChangeText={setSearch} returnKeyType="search" testID="shop-search" />
        <Row style={{ marginBottom: spacing.lg, flexWrap: 'wrap', rowGap: spacing.sm }}>
          {cats.map((c) => <Chip key={c.t} label={c.t} selected={category === c.k} onPress={() => setCategory(c.k)} testID={`chip-${c.t}`} />)}
        </Row>
        {products.isLoading ? <CardSkeleton /> : products.isError ? (
          <ErrorState message={errorMessage(products.error)} onRetry={() => products.refetch()} />
        ) : !products.data?.length ? (
          <EmptyState icon="search" title="Nothing found" message="Try a different search or category." actionLabel="Clear filters" onAction={() => { setSearch(''); setCategory(undefined); }} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            {products.data.map((p) => <ProductCard key={p.id} product={p} width={cardW} onPress={() => router.push(`/product/${p.slug}`)} />)}
          </View>
        )}
        <View style={{ height: 70 }} />
      </Screen>
      <CartBar />
    </View>
  );
}
