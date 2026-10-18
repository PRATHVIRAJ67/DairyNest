import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { AddressPicker } from '@/components/AddressPicker';
import { ItemsSheet, ScheduleSheet, SkipSheet } from '@/components/SubscriptionSheets';
import { PauseSheet } from '@/components/PauseSheet';
import { Banner, Button, Card, CardSkeleton, Dialog, ErrorState, Header, Input, ListRow, Row, Screen, SectionHeader, StatusPill, Text, formatDate } from '@/components/ui';
import { usePayFlow } from '@/hooks/usePay';
import { errorMessage } from '@/lib/api';
import { cutoffLabel, money, scheduleLabel, windowLabel } from '@/lib/format';
import { subActions, useSubAction, useSubscription, useSubscriptionHistory } from '@/lib/queries';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

const ACTION_LABEL: Record<string, string> = {
  'subscription.created': 'Subscription created', 'subscription.active': 'Activated', 'subscription.paused': 'Paused', 'subscription.pause_requested': 'Pause scheduled',
  'subscription.resumed': 'Resumed', 'subscription.delivery_skipped': 'Delivery skipped', 'subscription.delivery_unskipped': 'Skip undone', 'subscription.items_changed': 'Items changed',
  'subscription.schedule_changed': 'Schedule changed', 'subscription.address_changed': 'Address changed', 'subscription.cancelled': 'Cancelled', 'subscription.past_due': 'Prepaid deliveries ran out',
  'subscription.renewal_requested': 'Renewal started',
};

export default function SubscriptionDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const q = useSubscription(id);
  const history = useSubscriptionHistory(id);
  const pay = usePayFlow();
  const show = useToast((s) => s.show);
  const [sheet, setSheet] = useState<null | 'pause' | 'skip' | 'items' | 'schedule' | 'address'>(null);
  const [dialog, setDialog] = useState<null | 'resume' | 'cancel'>(null);
  const [reason, setReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const resume = useSubAction(id, () => subActions.resume(id));
  const cancel = useSubAction(id, () => subActions.cancel(id, reason.trim() || undefined));
  const changeAddress = useSubAction(id, (addressId: string) => subActions.address(id, addressId));
  const s = q.data;

  const run = async (fn: () => Promise<unknown>, ok: { title: string; message?: string }, fail: string) => {
    try { await fn(); show({ tone: 'success', ...ok }); } catch (e) { show({ tone: 'danger', title: fail, message: errorMessage(e) }); }
  };

  if (q.isLoading) return <Screen><Header title="Subscription" /><CardSkeleton /><CardSkeleton /></Screen>;
  if (q.isError || !s) return <Screen><Header title="Subscription" /><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;

  const scheduledPause = s.pauses.find((p) => s.status === 'active' && p.startsOn > s.rules.earliestChangeableDate);
  const cancelled = s.status === 'cancelled';

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <Header title="Subscription" right={<StatusPill status={s.status} />} />

      {s.status === 'pending_payment' ? (
        <Banner tone="warn" title="Waiting for payment" message={s.billing.lastPayment?.status === 'failed' ? `Your last attempt failed${s.billing.lastPayment.failureReason ? ': ' + s.billing.lastPayment.failureReason : ''}.` : 'Your plan starts as soon as payment is confirmed.'} actionLabel={pay.busyId === s.id ? 'Opening…' : 'Pay now'} onAction={() => pay.start(s)} />
      ) : null}
      {s.status === 'past_due' ? <Banner tone="danger" title="Prepaid deliveries have run out" message="Renew to continue receiving deliveries." actionLabel="Renew now" onAction={() => pay.start(s, 'renew')} /> : null}
      {scheduledPause ? <Banner tone="info" title="Pause scheduled" message={`Deliveries pause from ${formatDate(scheduledPause.startsOn)}${scheduledPause.endsOn ? ' to ' + formatDate(scheduledPause.endsOn) : ' until you resume'}.`} /> : null}
      {s.status === 'paused' ? <Banner tone="warn" title={s.pauses[0]?.endsOn ? `Paused until ${formatDate(s.pauses[0].endsOn)}` : 'Paused until you resume'} message="You are not charged for paused days. Your prepaid deliveries are kept." /> : null}
      {cancelled && s.cancellation?.refundReviewTicketCreated ? <Banner tone="info" title="Refund review opened" message={`${s.cancellation.unusedPrepaidDeliveries} prepaid deliveries were unused. We opened a support ticket so our team can review a refund.`} /> : null}

      <Card>
        <Text variant="caption" muted>ITEMS</Text>
        {s.items.map((i) => (
          <Row key={i.variantId} style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <Text weight="semibold" style={{ flex: 1 }}>{i.quantity} × {i.productName} ({i.sizeLabel})</Text>
            <Text>{money(i.unitPriceMinor * i.quantity)}</Text>
          </Row>
        ))}
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text muted>Per delivery</Text>
          <Text weight="bold" color={colors.primary}>{money(s.perDeliveryMinor)}</Text>
        </Row>
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <ListRow icon="repeat" title="Schedule" subtitle={`${scheduleLabel(s.frequency, s.weekdays)} · from ${formatDate(s.startDate, { year: true })}`} />
        <ListRow icon="map-pin" title={s.address.label} subtitle={`${s.address.line1}, ${s.address.city} ${s.address.postalCode}`} />
        <ListRow icon="clock" title="Change cutoff" subtitle={`Until ${cutoffLabel(s.rules.cutoffTime)} the evening before · earliest change: ${formatDate(s.rules.earliestChangeableDate)}`} />
        {s.nextDelivery && s.status === 'active' ? <ListRow icon="truck" title="Next delivery" subtitle={`${formatDate(s.nextDelivery.deliveryDate)} · ${windowLabel(s.nextDelivery.windowStart, s.nextDelivery.windowEnd)}`} onPress={() => router.push(`/delivery/${s.nextDelivery!.id}`)} /> : null}
      </Card>

      <SectionHeader title="Billing" />
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text muted>Prepaid deliveries left</Text>
          <Text weight="bold" testID="prepaid-left">{s.billing.prepaidDeliveriesRemaining}</Text>
        </Row>
        {s.billing.coveredThrough ? <Row style={{ justifyContent: 'space-between', marginTop: 6 }}><Text muted>Scheduled through</Text><Text weight="semibold">{formatDate(s.billing.coveredThrough)}</Text></Row> : null}
        <Text variant="small" muted style={{ marginTop: spacing.md }}>Prepaid in 30-day blocks and renewed manually. There is no automatic debit. Skipped, paused and failed deliveries are credited back, so you only pay for what you receive.</Text>
        {s.actions.canRenew ? <View style={{ marginTop: spacing.md }}><Button title={s.billing.renewalDue ? 'Renew for 30 days' : 'Renew early'} variant={s.billing.renewalDue ? 'primary' : 'secondary'} onPress={() => pay.start(s, 'renew')} loading={pay.busyId === s.id} testID="renew" /></View> : null}
      </Card>

      {!cancelled ? (
        <>
          <SectionHeader title="Manage" />
          <Card>
            {s.actions.canSkip ? <ListRow testID="act-skip" icon="skip-forward" title="Skip a delivery" subtitle="Skip one day. It is credited back to your plan." onPress={() => setSheet('skip')} /> : null}
            {s.actions.canPause ? <ListRow testID="act-pause" icon="pause-circle" title="Pause deliveries" subtitle="For a few days, a week or until you resume" onPress={() => setSheet('pause')} /> : null}
            {s.actions.canResume ? <ListRow testID="act-resume" icon="play-circle" title="Resume deliveries" subtitle={`Restart from ${formatDate(s.rules.earliestChangeableDate)}`} onPress={() => setDialog('resume')} /> : null}
            {s.actions.canEdit ? (
              <>
                <ListRow testID="act-items" icon="edit-3" title="Change quantity or products" subtitle="Applies from your next changeable delivery" onPress={() => setSheet('items')} />
                <ListRow testID="act-schedule" icon="calendar" title="Change frequency" subtitle={scheduleLabel(s.frequency, s.weekdays)} onPress={() => setSheet('schedule')} />
              </>
            ) : null}
            <ListRow testID="act-address" icon="map-pin" title="Change delivery address" onPress={() => setSheet('address')} />
            {s.actions.canCancel ? <ListRow testID="act-cancel" icon="x-circle" title="Cancel subscription" subtitle="Stops future deliveries" danger onPress={() => setDialog('cancel')} /> : null}
          </Card>
        </>
      ) : null}

      <SectionHeader title="History" action={showHistory ? 'Hide' : 'Show'} onAction={() => setShowHistory((v) => !v)} />
      {showHistory ? (
        <Card>
          {history.isLoading ? <CardSkeleton /> : !history.data?.length ? <Text muted>No activity yet.</Text> : history.data.map((h) => (
            <Row key={h.id} style={{ gap: spacing.md, paddingVertical: 6 }}>
              <Feather name="clock" size={14} color={colors.textMuted} />
              <View style={{ flex: 1 }}><Text weight="semibold">{ACTION_LABEL[h.action] ?? h.action}</Text><Text variant="small" muted>{new Date(h.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text></View>
            </Row>
          ))}
        </Card>
      ) : null}

      {sheet === 'pause' ? <PauseSheet sub={s} visible onClose={() => setSheet(null)} /> : null}
      {sheet === 'skip' ? <SkipSheet sub={s} onClose={() => setSheet(null)} /> : null}
      {sheet === 'items' ? <ItemsSheet sub={s} onClose={() => setSheet(null)} /> : null}
      {sheet === 'schedule' ? <ScheduleSheet sub={s} onClose={() => setSheet(null)} /> : null}
      <AddressPicker visible={sheet === 'address'} selectedId={s.address.id} onClose={() => setSheet(null)} onSelect={(a) => { setSheet(null); run(() => changeAddress.mutateAsync(a.id), { title: 'Address updated', message: `Deliveries from ${formatDate(s.rules.earliestChangeableDate)} go to ${a.label}.` }, 'Could not change address'); }} />

      <Dialog visible={dialog === 'resume'} title="Resume deliveries?" message={`Deliveries restart from ${formatDate(s.rules.earliestChangeableDate)}. Your remaining prepaid deliveries continue; nothing extra is charged.`} confirmLabel="Resume" loading={resume.isPending} onCancel={() => setDialog(null)} onConfirm={() => run(async () => { await resume.mutateAsync(); setDialog(null); }, { title: 'Subscription resumed' }, 'Could not resume')} />
      <Dialog visible={dialog === 'cancel'} destructive title="Cancel this subscription?" confirmLabel="Cancel subscription" cancelLabel="Keep it" loading={cancel.isPending} onCancel={() => setDialog(null)} onConfirm={() => run(async () => { await cancel.mutateAsync(); setDialog(null); }, { title: 'Subscription cancelled', message: 'Future deliveries have been stopped.' }, 'Could not cancel')}
        message={`Deliveries from ${formatDate(s.rules.earliestChangeableDate)} onward will stop. Deliveries already being prepared will still arrive. You have ${s.billing.prepaidDeliveriesRemaining} unscheduled prepaid deliveries; we will open a refund review for the unused amount. This cannot be undone.`}>
        <Input label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={300} />
      </Dialog>
    </Screen>
  );
}
