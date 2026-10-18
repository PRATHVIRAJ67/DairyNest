import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui';
import { money } from '@/lib/format';
import { useCart } from '@/store/cart';
import { palette, radius, spacing } from '@/theme/tokens';

/** Floating bar shown when the subscription basket has items. */
export function CartBar({ bottom = 8 }: { bottom?: number }) {
  const router = useRouter();
  const items = useCart((s) => s.items);
  if (!items.length) return null;
  const perDelivery = items.reduce((t, i) => t + i.priceMinor * i.quantity, 0);
  const qty = items.reduce((t, i) => t + i.quantity, 0);
  return (
    <View style={{ position: 'absolute', left: spacing.lg, right: spacing.lg, bottom }}>
      <Pressable
        testID="cart-bar"
        accessibilityRole="button"
        accessibilityLabel={`Review subscription, ${qty} items, ${money(perDelivery)} per delivery`}
        onPress={() => router.push('/checkout')}
        style={{ backgroundColor: palette.forest700, borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}
      >
        <View>
          <Text weight="bold" color={palette.white}>{qty} {qty === 1 ? 'item' : 'items'} · {money(perDelivery)} / delivery</Text>
          <Text variant="small" color={palette.lime400}>Review your subscription</Text>
        </View>
        <Feather name="arrow-right-circle" size={26} color={palette.lime500} />
      </Pressable>
    </View>
  );
}
