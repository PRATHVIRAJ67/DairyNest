import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, CardSkeleton, Dialog, ErrorState, Header, ListRow, Row, Screen, StatusPill, Text, formatDate } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { cutoffLabel, money, windowLabel } from '@/lib/format';
import { subActions, useDelivery, useSubAction } from '@/lib/queries';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export default function DeliveryDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const q = useDelivery(id);
  const d = q.data;
  const show = useToast((s) => s.show);
  const [confirm, setConfirm] = useState(false);
  const skip = useSubAction(d?.subscriptionId ?? '', () => subActions.skip(d!.subscriptionId, d!.deliveryDate));

  if (q.isLoading) return <Screen><Header title="Delivery" /><CardSkeleton /></Screen>;
  if (q.isError || !d) return <Screen><Header title="Delivery" /><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;

  const doSkip = async () => {
    try { await skip.mutateAsync(); await q.refetch(); setConfirm(false); show({ tone: 'success', title: 'Delivery skipped', message: 'It is credited back to your plan.' }); }
    catch (e) { setConfirm(false); show({ tone: 'danger', title: 'Could not skip', message: errorMessage(e) }); }
  };

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <Header title={formatDate(d.deliveryDate)} subtitle={windowLabel(d.windowStart, d.windowEnd)} right={<StatusPill status={d.displayStatus} />} />
      {d.displayStatus === 'pending' ? <Banner tone="warn" title="Being prepared" message={`The ${cutoffLabel(d.cutoffTime)} cutoff has passed, so this delivery can no longer be changed.`} /> : null}
      {d.status === 'failed' ? <Banner tone="danger" title="We could not deliver" message={`${d.failureReason ?? 'The delivery could not be completed.'} The delivery has been credited back to your plan.`} /> : null}
      {d.status === 'delivered' && d.deliveredAt ? <Banner tone="success" title="Delivered" message={new Date(d.deliveredAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} /> : null}

      <Card>
        <Text variant="caption" muted>ITEMS</Text>
        {d.items.length ? d.items.map((i) => (
          <Row key={i.variantId} style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <Text weight="semibold" style={{ flex: 1 }}>{i.quantity} × {i.name}</Text>
            <Text>{money(i.unitPriceMinor * i.quantity)}</Text>
          </Row>
        )) : <Text muted style={{ marginTop: 8 }}>This delivery was skipped.</Text>}
        {d.items.length ? <><View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} /><Row style={{ justifyContent: 'space-between' }}><Text muted>Value (prepaid)</Text><Text weight="bold">{money(d.totalMinor)}</Text></Row></> : null}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <ListRow icon="map-pin" title={d.addressLabel} subtitle={`${d.addressLine1}, ${d.addressCity}`} />
        <ListRow icon="message-square" title="Delivery instructions" subtitle={d.instructions || 'None'} />
        <ListRow icon="repeat" title="View subscription" onPress={() => router.push(`/subscription/${d.subscriptionId}`)} />
      </Card>

      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        {d.canModify ? <Button title="Skip this delivery" variant="secondary" icon="skip-forward" onPress={() => setConfirm(true)} testID="delivery-skip" /> : null}
        <Button title="Report a problem" variant="ghost" icon="alert-circle" onPress={() => router.push({ pathname: '/support/new', params: { subject: `Delivery on ${d.deliveryDate}`, category: 'delivery' } })} />
      </View>
      <Dialog visible={confirm} title="Skip this delivery?" message={`${formatDate(d.deliveryDate)} will be skipped. It is not charged: your prepaid plan is extended by one delivery.`} confirmLabel="Skip delivery" loading={skip.isPending} onConfirm={doSkip} onCancel={() => setConfirm(false)} />
    </Screen>
  );
}
