import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { CartBar } from '@/components/CartBar';
import { ProductImage } from '@/components/ProductArt';
import { Banner, Button, CardSkeleton, Chip, ErrorState, Header, OptionCard, Row, Screen, Stepper, Text, WeekdayPicker } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { FREQUENCY_LABEL, money } from '@/lib/format';
import { useProduct } from '@/lib/queries';
import { useCart } from '@/store/cart';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export default function ProductDetails() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const product = useProduct(slug);
  const cart = useCart();
  const show = useToast((s) => s.show);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const p = product.data;
  useEffect(() => {
    if (p && !variantId) setVariantId((p.variants.find((v) => v.isAvailable) ?? p.variants[0])?.id ?? null);
  }, [p, variantId]);
  const variant = p?.variants.find((v) => v.id === variantId);

  const add = () => {
    if (!p || !variant) return;
    cart.add(p, variant, quantity);
    show({ tone: 'success', title: 'Added to your subscription', message: `${quantity} x ${p.name} (${variant.sizeLabel})` });
  };
  const subscribeNow = () => { add(); router.push('/checkout'); };

  if (product.isLoading) return <Screen><Header title="Product" /><CardSkeleton /></Screen>;
  if (product.isError || !p) return <Screen><Header title="Product" /><ErrorState message={errorMessage(product.error)} onRetry={() => product.refetch()} /></Screen>;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        footer={
          <View style={{ gap: spacing.sm, paddingBottom: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Text variant="small" muted>Per delivery</Text>
                <Text variant="h2" color={colors.primary} testID="product-total">{variant ? money(variant.priceMinor * quantity) : '-'}</Text>
              </View>
              <Stepper value={quantity} onChange={setQuantity} label={p.name} />
            </Row>
            <Row style={{ gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Button title="Add to plan" variant="secondary" onPress={add} disabled={!variant?.isAvailable} testID="add-to-plan" /></View>
              <View style={{ flex: 1 }}><Button title="Subscribe" onPress={subscribeNow} disabled={!variant?.isAvailable} testID="subscribe-now" /></View>
            </Row>
          </View>
        }
      >
        <Header title={p.name} subtitle={p.category === 'milk' ? 'Milk' : p.category === 'curd' ? 'Curd' : 'Dairy'} />
        <ProductImage imageUrl={p.imageUrl} slug={p.slug} category={p.category} height={240} rounded={radius.xl} />
        <Text style={{ marginTop: spacing.lg }}>{p.description}</Text>

        <Row style={{ gap: spacing.lg, marginTop: spacing.lg, flexWrap: 'wrap' }}>
          {[['thermometer', 'Cold-chain delivered'], ['clock', 'Before sunrise'], ['shield', 'Quality checked']].map(([icon, t]) => (
            <Row key={t} style={{ gap: 6 }}><Feather name={icon as 'clock'} size={14} color={colors.primary} /><Text variant="small" muted>{t}</Text></Row>
          ))}
        </Row>

        <Text variant="h2" style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>Pack size</Text>
        {p.variants.map((v) => (
          <OptionCard
            key={v.id}
            testID={`variant-${v.sku}`}
            title={`${v.sizeLabel} · ${v.name}`}
            subtitle={v.isAvailable ? undefined : 'Currently unavailable'}
            selected={v.id === variantId}
            onPress={() => v.isAvailable && setVariantId(v.id)}
            right={
              <View style={{ alignItems: 'flex-end' }}>
                <Text weight="bold">{money(v.priceMinor)}</Text>
                {v.mrpMinor > v.priceMinor ? <Text variant="small" muted style={{ textDecorationLine: 'line-through' }}>{money(v.mrpMinor)}</Text> : null}
              </View>
            }
          />
        ))}
        <Text variant="h2" style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>How often?</Text>
        <Row style={{ flexWrap: 'wrap', rowGap: spacing.sm }}>
          {(['daily', 'alternate_days', 'weekdays'] as const).map((f) => (
            <Chip key={f} testID={`freq-${f}`} label={FREQUENCY_LABEL[f]} selected={cart.schedule.frequency === f} onPress={() => cart.setSchedule({ frequency: f })} />
          ))}
        </Row>
        {cart.schedule.frequency === 'weekdays' ? (
          <View style={{ marginTop: spacing.md }}>
            <WeekdayPicker value={cart.schedule.weekdays} onChange={(w) => cart.setSchedule({ weekdays: w })} />
          </View>
        ) : null}
        <View style={{ height: spacing.lg }} />
        <Banner tone="info" title="How delivery works" message="You can pause, skip or change a delivery anytime before the evening cutoff the day before. Pick your start date and address at checkout." />
      </Screen>
      <CartBar bottom={150} />
    </View>
  );
}

