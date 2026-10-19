import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Card, Text } from '@/components/ui';
import { ProductImage } from '@/components/ProductArt';
import { categoryLabel, money } from '@/lib/format';
import type { Product } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function ProductCard({ product, onPress, width }: { product: Product; onPress: () => void; width?: number }) {
  const { colors } = useTheme();
  const available = product.variants.filter((v) => v.isAvailable);
  const from = available.length ? Math.min(...available.map((v) => v.priceMinor)) : null;
  const first = available[0];
  const discount = first && first.mrpMinor > first.priceMinor ? Math.round((1 - first.priceMinor / first.mrpMinor) * 100) : 0;
  return (
    <Card
      padded={false}
      onPress={onPress}
      testID={`product-${product.slug}`}
      accessibilityLabel={`${product.name}, ${from !== null ? 'from ' + money(from) : 'currently unavailable'}`}
      style={{ width, overflow: 'hidden' }}
    >
      <View>
        <ProductImage imageUrl={product.imageUrl} slug={product.slug} category={product.category} height={width ? Math.round(width * 0.82) : 150} rounded={0} />
        {discount > 0 ? (
          <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text variant="caption" weight="bold" color={colors.onAccent}>
              {discount}% OFF
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: spacing.md, gap: 2 }}>
        <Text variant="caption" muted>
          {categoryLabel(product.category).toUpperCase()}
        </Text>
        <Text weight="semibold" numberOfLines={2}>
          {product.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
          <Text weight="bold" color={colors.primary}>
            {from !== null ? `from ${money(from)}` : 'Unavailable'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${product.name}`}
            onPress={onPress}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="plus" size={18} color={colors.onPrimary} />
          </Pressable>
        </View>
      </View>
    </Card>
  );
}
