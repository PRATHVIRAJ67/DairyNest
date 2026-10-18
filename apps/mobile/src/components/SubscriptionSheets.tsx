import React, { useState } from 'react';
import { View } from 'react-native';
import { addDays, isScheduledOn } from '@milk/shared';
import { Banner, BottomSheet, Button, Chip, DateStrip, EmptyState, Row, Skeleton, Stepper, Text, WeekdayPicker, formatDate } from '@/components/ui';
import { ProductIllustration } from '@/components/ProductArt';
import { errorMessage } from '@/lib/api';
import { cutoffLabel, FREQUENCY_LABEL, money } from '@/lib/format';
import { subActions, useProducts, useSubAction } from '@/lib/queries';
import type { Subscription } from '@/lib/types';
import { useToast } from '@/store/toast';
import { radius, spacing } from '@/theme/tokens';

export function SkipSheet({ sub, onClose }: { sub: Subscription; onClose: () => void }) {
  const eff = sub.rules.earliestChangeableDate;
  const [date, setDate] = useState<string | null>(null);
  const show = useToast((s) => s.show);
  const skip = useSubAction(sub.id, (d: string) => subActions.skip(sub.id, d));
  const unskip = useSubAction(sub.id, (d: string) => subActions.unskip(sub.id, d));
  const rule = { frequency: sub.frequency, startDate: sub.startDate, weekdays: sub.weekdays ?? undefined };
  // Offer only dates that are scheduled, not already skipped/paused, and still before the cutoff.
  const candidates = Array.from({ length: 28 }, (_, i) => addDays(eff, i)).filter((d) => isScheduledOn({ ...rule, startDate: sub.scheduleAnchor ?? sub.startDate }, d));
  const pausedDay = (d: string) => sub.pauses.some((p) => d >= p.startsOn && (!p.endsOn || d <= p.endsOn));
  const available = candidates.filter((d) => !sub.skippedDates.includes(d) && !pausedDay(d));
  const doSkip = async () => {
    if (!date) return;
    try { await skip.mutateAsync(date); show({ tone: 'success', title: 'Delivery skipped', message: `${formatDate(date)} is credited back to your plan.` }); setDate(null); }
    catch (e) { show({ tone: 'danger', title: 'Could not skip', message: errorMessage(e) }); }
  };
  return (
    <BottomSheet visible title="Skip a delivery" onClose={onClose}>
      <Text muted style={{ marginBottom: spacing.md }}>Orders close at {cutoffLabel(sub.rules.cutoffTime)} the evening before, so the earliest day you can skip is {formatDate(eff)}.</Text>
      {available.length ? <DateStrip from={eff} days={28} value={date} onChange={setDate} disabledDates={Array.from({ length: 28 }, (_, i) => addDays(eff, i)).filter((d) => !available.includes(d))} /> : <Text muted>No upcoming deliveries to skip.</Text>}
      <Banner tone="info" title="What happens to billing" message="A skipped delivery is not consumed from your prepaid plan. Your plan is extended by one delivery instead." />
      <Button title={date ? `Skip ${formatDate(date)}` : 'Pick a date'} onPress={doSkip} disabled={!date} loading={skip.isPending} testID="skip-confirm" />
      {sub.skippedDates.length ? (
        <View style={{ marginTop: spacing.lg }}>
          <Text variant="h3" style={{ marginBottom: spacing.sm }}>Skipped dates</Text>
          <Row style={{ flexWrap: 'wrap', rowGap: spacing.sm }}>
            {sub.skippedDates.map((d) => <Chip key={d} label={`${formatDate(d)}  ✕`} onPress={() => unskip.mutate(d, { onError: (e) => show({ tone: 'danger', title: 'Could not undo', message: errorMessage(e) }), onSuccess: () => show({ tone: 'success', title: 'Skip undone', message: `${formatDate(d)} is back on.` }) })} />)}
          </Row>
          <Text variant="small" muted style={{ marginTop: 6 }}>Tap a date to undo the skip (before its cutoff).</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

export function ItemsSheet({ sub, onClose }: { sub: Subscription; onClose: () => void }) {
  const products = useProducts();
  const show = useToast((s) => s.show);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(sub.items.map((i) => [i.variantId, i.quantity])));
  const save = useSubAction(sub.id, (items: { variantId: string; quantity: number }[]) => subActions.items(sub.id, items));
  const chosen = Object.entries(qty).filter(([, n]) => n > 0).map(([variantId, quantity]) => ({ variantId, quantity }));
  const submit = async () => {
    try { await save.mutateAsync(chosen); show({ tone: 'success', title: 'Items updated', message: `New quantities apply from ${formatDate(sub.rules.earliestChangeableDate)}.` }); onClose(); }
    catch (e) { show({ tone: 'danger', title: 'Could not update', message: errorMessage(e) }); }
  };
  return (
    <BottomSheet visible title="Change items" onClose={onClose}>
      <Text muted style={{ marginBottom: spacing.md }}>Changes apply from {formatDate(sub.rules.earliestChangeableDate)}. Set a quantity to 0 to remove an item.</Text>
      {products.isLoading ? <Skeleton height={80} /> : !products.data?.length ? <EmptyState title="No products" /> : products.data.flatMap((p) => p.variants.filter((v) => v.isAvailable || qty[v.id]).map((v) => (
        <Row key={v.id} style={{ gap: spacing.md, paddingVertical: 8 }}>
          <View style={{ borderRadius: radius.md, overflow: 'hidden' }}><ProductIllustration slug={p.slug} category={p.category} size={48} /></View>
          <View style={{ flex: 1 }}>
            <Text weight="semibold" numberOfLines={1}>{p.name}</Text>
            <Text variant="small" muted>{v.sizeLabel} · {money(v.priceMinor)}</Text>
          </View>
          <Stepper value={qty[v.id] ?? 0} min={0} onChange={(n) => setQty((c) => ({ ...c, [v.id]: n }))} label={`${p.name} ${v.sizeLabel}`} />
        </Row>
      )))}
      <Banner tone="info" title="What happens to billing" message="Your current prepaid deliveries keep their paid prices. The new items are priced at the next renewal." />
      <Button title="Save changes" onPress={submit} disabled={!chosen.length} loading={save.isPending} testID="items-save" />
      {!chosen.length ? <Text variant="small" muted center style={{ marginTop: 6 }}>Keep at least one item, or cancel the subscription instead.</Text> : null}
    </BottomSheet>
  );
}

export function ScheduleSheet({ sub, onClose }: { sub: Subscription; onClose: () => void }) {
  const eff = sub.rules.earliestChangeableDate;
  const show = useToast((s) => s.show);
  const [frequency, setFrequency] = useState(sub.frequency);
  const [weekdays, setWeekdays] = useState<number[]>(sub.weekdays ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(eff);
  const save = useSubAction(sub.id, () => subActions.schedule(sub.id, { frequency, startDate: start, ...(frequency === 'weekdays' ? { weekdays } : {}) }));
  const submit = async () => {
    try { await save.mutateAsync(); show({ tone: 'success', title: 'Schedule updated', message: `New schedule starts ${formatDate(start)}.` }); onClose(); }
    catch (e) { show({ tone: 'danger', title: 'Could not update', message: errorMessage(e) }); }
  };
  return (
    <BottomSheet visible title="Change frequency" onClose={onClose}>
      <Row style={{ flexWrap: 'wrap', rowGap: spacing.sm }}>
        {(['daily', 'alternate_days', 'weekdays'] as const).map((f) => <Chip key={f} testID={`sched-${f}`} label={FREQUENCY_LABEL[f]} selected={frequency === f} onPress={() => setFrequency(f)} />)}
      </Row>
      {frequency === 'weekdays' ? <View style={{ marginTop: spacing.md }}><WeekdayPicker value={weekdays} onChange={setWeekdays} /></View> : null}
      <Text variant="small" muted style={{ marginTop: spacing.lg, marginBottom: 6 }}>New schedule starts</Text>
      <DateStrip from={eff} days={21} value={start} onChange={setStart} />
      <Banner tone="info" title="What happens to billing" message="Your prepaid deliveries are re-scheduled on the new pattern, so no money is lost. A different frequency may make your prepaid deliveries last a different number of days." />
      <Button title="Save schedule" onPress={submit} disabled={frequency === 'weekdays' && !weekdays.length} loading={save.isPending} testID="schedule-save" />
    </BottomSheet>
  );
}
