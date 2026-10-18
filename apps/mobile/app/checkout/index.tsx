import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AddressPicker } from '@/components/AddressPicker';
import { ProductIllustration } from '@/components/ProductArt';
import { Banner, Button, Card, Checkbox, Chip, DateStrip, EmptyState, Header, Input, Row, Screen, Skeleton, Stepper, Text, WeekdayPicker, formatDate } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { cutoffLabel, FREQUENCY_LABEL, money, todayIST } from '@/lib/format';
import { useAddresses, useCreateSubscription, useHealth, useQuote, type QuoteInput } from '@/lib/queries';
import { useCart } from '@/store/cart';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { addDays } from '@milk/shared';
import { radius, spacing } from '@/theme/tokens';

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function Checkout() {
  const { colors } = useTheme();
  const router = useRouter();
  const cart = useCart();
  const addresses = useAddresses();
  const health = useHealth();
  const create = useCreateSubscription();
  const show = useToast((s) => s.show);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [terms, setTerms] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [earliest, setEarliest] = useState<string | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);

  // Select the default address once addresses load.
  useEffect(() => {
    if (!cart.addressId && addresses.data?.length) {
      const a = addresses.data.find((x) => x.isDefault && x.zoneId) ?? addresses.data.find((x) => x.zoneId);
      if (a) cart.setAddress(a.id);
    }
  }, [addresses.data, cart]);

  const tomorrow = addDays(todayIST(), 1);
  const startDate = cart.schedule.startDate ?? earliest ?? tomorrow;
  const address = addresses.data?.find((a) => a.id === cart.addressId);

  const input: QuoteInput | null = useMemo(() => {
    if (!cart.items.length || !cart.addressId) return null;
    if (cart.schedule.frequency === 'weekdays' && !cart.schedule.weekdays.length) return null;
    return {
      items: cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      addressId: cart.addressId,
      schedule: { frequency: cart.schedule.frequency, startDate, ...(cart.schedule.frequency === 'weekdays' ? { weekdays: cart.schedule.weekdays } : {}) },
      ...(cart.couponCode ? { couponCode: cart.couponCode } : {}),
    };
  }, [cart.items, cart.addressId, cart.schedule, cart.couponCode, startDate]);

  const quote = useQuote(input);
  const idempotencyKey = useMemo(newKey, [input]); // a new key whenever the order changes
  const qErr = quote.error instanceof ApiError ? quote.error : null;

  // The server tells us the earliest valid start date (delivery cutoff rule).
  useEffect(() => {
    const e = quote.data?.earliestStartDate ?? (qErr?.code === 'START_DATE_TOO_EARLY' ? qErr.details?.earliest : null);
    if (e && e !== earliest) setEarliest(e);
    if (qErr?.code === 'START_DATE_TOO_EARLY' && qErr.details?.earliest) cart.setSchedule({ startDate: qErr.details.earliest });
  }, [quote.data, qErr, earliest, cart]);

  const couponError = qErr && cart.couponCode && /COUPON/.test(qErr.code) ? qErr.message : null;
  // Keep the server's message visible even though the rejected coupon is dropped from the basket.
  useEffect(() => { if (couponError) { setCouponMsg(couponError); cart.setCoupon(null); } }, [couponError, cart]);

  const paymentsOff = health.data && !health.data.paymentsConfigured;
  const q = quote.data;
  const canPay = !!q && terms && !paymentsOff && !create.isPending;

  const pay = async () => {
    if (!input || !q) return;
    setPayError(null);
    try {
      const r = await create.mutateAsync({ ...input, acceptTerms: true, idempotencyKey });
      router.push({ pathname: '/checkout/pay', params: { subscriptionId: r.checkout.subscriptionId, orderId: r.checkout.providerOrderId, paymentOrderId: r.checkout.paymentOrderId, amount: String(r.checkout.amountMinor), keyId: r.checkout.keyId } });
    } catch (e) {
      setPayError(errorMessage(e));
      show({ tone: 'danger', title: 'Could not start checkout', message: errorMessage(e) });
    }
  };

  if (!cart.items.length) {
    return (
      <Screen>
        <Header title="Your subscription" />
        <EmptyState icon="shopping-bag" title="Nothing here yet" message="Pick a milk or curd to build your plan." actionLabel="Browse products" onAction={() => router.replace('/(tabs)/shop')} />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.sm, paddingBottom: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text muted>Pay today (first 30 days)</Text>
            {quote.isFetching ? <Skeleton width={90} height={22} /> : <Text variant="h2" color={colors.primary} testID="checkout-total">{q ? money(q.totalMinor) : '-'}</Text>}
          </Row>
          <Button title={paymentsOff ? 'Payments unavailable' : 'Confirm and pay'} onPress={pay} disabled={!canPay} loading={create.isPending} icon="lock" testID="checkout-pay" />
        </View>
      }
    >
      <Header title="Your subscription" />

      {cart.items.map((i) => (
        <Card key={i.variantId} style={{ marginBottom: spacing.sm }}>
          <Row style={{ gap: spacing.md }}>
            <View style={{ borderRadius: radius.md, overflow: 'hidden' }}><ProductIllustration slug={i.slug} category={i.category} size={64} /></View>
            <View style={{ flex: 1 }}>
              <Text weight="semibold" numberOfLines={2}>{i.productName}</Text>
              <Text variant="small" muted>{i.sizeLabel} · {money(i.priceMinor)} each</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${i.productName}`} onPress={() => cart.remove(i.variantId)} hitSlop={8}><Text variant="small" weight="semibold" color={colors.danger} style={{ marginTop: 4 }}>Remove</Text></Pressable>
            </View>
            <Stepper value={i.quantity} onChange={(n) => cart.setQuantity(i.variantId, n)} label={i.productName} />
          </Row>
        </Card>
      ))}
      <Button title="Add more products" variant="ghost" icon="plus" onPress={() => router.push('/(tabs)/shop')} />

      <Text variant="h2" style={{ marginTop: spacing.lg, marginBottom: spacing.md }}>Schedule</Text>
      <Row style={{ flexWrap: 'wrap', rowGap: spacing.sm }}>
        {(['daily', 'alternate_days', 'weekdays'] as const).map((f) => <Chip key={f} testID={`checkout-freq-${f}`} label={FREQUENCY_LABEL[f]} selected={cart.schedule.frequency === f} onPress={() => cart.setSchedule({ frequency: f })} />)}
      </Row>
      {cart.schedule.frequency === 'weekdays' ? (
        <View style={{ marginTop: spacing.md }}>
          <WeekdayPicker value={cart.schedule.weekdays} onChange={(w) => cart.setSchedule({ weekdays: w })} />
          {!cart.schedule.weekdays.length ? <Text variant="small" color={colors.danger} style={{ marginTop: 6 }}>Pick at least one day</Text> : null}
        </View>
      ) : null}
      <Text variant="small" muted style={{ marginTop: spacing.lg, marginBottom: 6 }}>Start date{earliest ? ` (earliest ${formatDate(earliest)})` : ''}</Text>
      <DateStrip from={earliest ?? tomorrow} days={28} value={startDate} onChange={(d) => cart.setSchedule({ startDate: d })} />
      {q ? <Text variant="small" muted style={{ marginTop: 6 }}>Orders close at {cutoffLabel(q.cutoffTime)} the evening before delivery.</Text> : null}

      <Text variant="h2" style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>Deliver to</Text>
      {addresses.isLoading ? <Skeleton height={70} /> : address ? (
        <Card onPress={() => setPickerOpen(true)} testID="checkout-address" accessibilityLabel="Change delivery address">
          <Row style={{ gap: spacing.md }}>
            <Feather name="map-pin" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{address.label} · {address.recipientName}</Text>
              <Text variant="small" muted>{address.line1}, {address.city} {address.postalCode}</Text>
            </View>
            <Text variant="small" weight="semibold" color={colors.primary}>Change</Text>
          </Row>
        </Card>
      ) : (
        <Banner tone="warn" title="Add a delivery address" message="We need an address in a serviceable area before you can subscribe." actionLabel="Add address" onAction={() => setPickerOpen(true)} />
      )}

      <Text variant="h2" style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>Coupon</Text>
      {cart.couponCode && q?.couponCode ? (
        <Banner tone="success" title={`${q.couponCode} applied`} message={q.couponDescription ?? undefined} actionLabel="Remove" onAction={() => { cart.setCoupon(null); setCoupon(''); }} />
      ) : (
        <Row style={{ alignItems: 'flex-start', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><Input testID="coupon-input" label="Coupon code" autoCapitalize="characters" value={coupon} onChangeText={(t) => { setCoupon(t); setCouponMsg(null); }} error={couponMsg ?? undefined} /></View>
          <View style={{ marginTop: 26 }}><Button title="Apply" size="sm" full={false} variant="secondary" disabled={coupon.trim().length < 3} onPress={() => { setCouponMsg(null); cart.setCoupon(coupon.trim().toUpperCase()); }} testID="coupon-apply" /></View>
        </Row>
      )}

      <Text variant="h2" style={{ marginTop: spacing.md, marginBottom: spacing.md }}>Price details</Text>
      <Card>
        {quote.isLoading ? <Skeleton height={100} /> : qErr && !couponError && qErr.code !== 'START_DATE_TOO_EARLY' ? (
          <Banner tone="danger" title="We could not price this order" message={qErr.message} />
        ) : q ? (
          <View style={{ gap: 8 }}>
            <PriceLine label={`${q.deliveries} deliveries × ${money(q.perDeliveryMinor)}`} value={money(q.subtotalMinor)} />
            {q.planDiscountMinor > 0 ? <PriceLine label="Plan discount" value={`- ${money(q.planDiscountMinor)}`} good /> : null}
            {q.couponDiscountMinor > 0 ? <PriceLine label={`Coupon ${q.couponCode}`} value={`- ${money(q.couponDiscountMinor)}`} good /> : null}
            <View style={{ height: 1, backgroundColor: colors.border }} />
            <PriceLine label="Total today" value={money(q.totalMinor)} bold />
            <Text variant="small" muted>Covers {formatDate(q.periodStart)} to {formatDate(q.periodEnd)}. Skipped or paused days are not charged: your plan is extended instead. Prices are confirmed by our server.</Text>
          </View>
        ) : <Text muted>Choose an address to see your price.</Text>}
      </Card>

      <Text variant="h2" style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>Payment</Text>
      <Card>
        <Row style={{ gap: spacing.md }}>
          <Feather name="shield" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text weight="semibold">Razorpay secure checkout</Text>
            <Text variant="small" muted>UPI, cards, netbanking and wallets. Your card or UPI details never touch our servers.</Text>
          </View>
        </Row>
      </Card>
      {paymentsOff ? <View style={{ marginTop: spacing.md }}><Banner tone="warn" title="Online payments are not set up yet" message="The server has no payment credentials configured, so subscriptions cannot be paid for right now." /></View> : null}
      <Banner tone="info" title="Manual renewal" message="This is a prepaid plan. It does not auto-debit: we remind you to renew when fewer than two weeks of deliveries remain." />

      <View style={{ marginTop: spacing.md }}>
        <Checkbox checked={terms} onChange={setTerms} testID="terms-checkbox">
          <Text variant="small">I agree to the <Text variant="small" weight="bold" color={colors.primary} onPress={() => router.push('/legal/terms')}>subscription terms</Text>, including the cutoff time, prepaid billing and cancellation rules.</Text>
        </Checkbox>
      </View>
      {payError ? <Banner tone="danger" title="Checkout failed" message={payError} testID="checkout-error" /> : null}

      <AddressPicker visible={pickerOpen} selectedId={cart.addressId} onClose={() => setPickerOpen(false)} onSelect={(a) => { cart.setAddress(a.id); setPickerOpen(false); }} />
    </Screen>
  );
}

function PriceLine({ label, value, bold, good }: { label: string; value: string; bold?: boolean; good?: boolean }) {
  const { colors } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text weight={bold ? 'bold' : undefined} style={{ flex: 1 }}>{label}</Text>
      <Text weight={bold ? 'bold' : 'semibold'} color={good ? colors.success : undefined}>{value}</Text>
    </Row>
  );
}
