import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ISODate } from '@milk/shared';
import { DeliveryCard } from '@/components/DeliveryCard';
import { Chip, Card, EmptyState, ErrorState, Row, Screen, SectionHeader, Skeleton, Text, formatDate } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { todayIST } from '@/lib/format';
import { useDeliveries } from '@/lib/queries';
import type { Delivery } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

export default function CalendarTab() {
  const { colors } = useTheme();
  const router = useRouter();
  const today = todayIST();
  const [cursor, setCursor] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
  const [selected, setSelected] = useState<ISODate>(today);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'delivered' | 'skipped' | 'issues'>('all');

  const first = `${cursor.y}-${pad(cursor.m + 1)}-01`;
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const last = `${cursor.y}-${pad(cursor.m + 1)}-${pad(daysInMonth)}`;
  const q = useDeliveries({ from: first, to: last });
  const offset = new Date(Date.UTC(cursor.y, cursor.m, 1)).getUTCDay();

  const byDate = useMemo(() => {
    const m = new Map<string, Delivery[]>();
    (q.data ?? []).forEach((d) => m.set(d.deliveryDate, [...(m.get(d.deliveryDate) ?? []), d]));
    return m;
  }, [q.data]);

  const dot = (s: string) => ({ delivered: colors.success, skipped: colors.textMuted, failed: colors.danger, cancelled: colors.textMuted, pending: colors.warn, out_for_delivery: colors.info, scheduled: colors.primary } as Record<string, string>)[s] ?? colors.primary;
  const move = (delta: number) => setCursor((c) => { const d = new Date(Date.UTC(c.y, c.m + delta, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const matches = (d: Delivery) => filter === 'all' || (filter === 'upcoming' && ['scheduled', 'pending', 'out_for_delivery'].includes(d.displayStatus) && d.deliveryDate >= today) || (filter === 'delivered' && d.status === 'delivered') || (filter === 'skipped' && d.status === 'skipped') || (filter === 'issues' && ['failed', 'cancelled'].includes(d.status));
  const list = filter === 'all' ? byDate.get(selected) ?? [] : (q.data ?? []).filter(matches);

  const cells: (ISODate | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${cursor.y}-${pad(cursor.m + 1)}-${pad(i + 1)}`)];

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <Text variant="display">Deliveries</Text>
      <Text muted style={{ marginBottom: spacing.lg }}>Your calendar and delivery history</Text>

      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => move(-1)} hitSlop={10} testID="cal-prev"><Feather name="chevron-left" size={22} color={colors.text} /></Pressable>
          <Text variant="h2" accessibilityLiveRegion="polite">{MONTHS[cursor.m]} {cursor.y}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => move(1)} hitSlop={10} testID="cal-next"><Feather name="chevron-right" size={22} color={colors.text} /></Pressable>
        </Row>
        <Row>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={i} variant="caption" muted center style={{ flex: 1 }}>{d}</Text>)}</Row>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((d, i) => {
            if (!d) return <View key={`e${i}`} style={{ width: '14.285%', height: 48 }} />;
            const ds = byDate.get(d) ?? [];
            const on = d === selected;
            return (
              <Pressable key={d} testID={`day-${d}`} accessibilityRole="button" accessibilityLabel={`${formatDate(d, { weekday: true, year: true })}, ${ds.length ? ds.map((x) => x.displayStatus).join(', ') : 'no delivery'}`} onPress={() => { setSelected(d); setFilter('all'); }} style={{ width: '14.285%', height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.primary : 'transparent', borderWidth: d === today && !on ? 1.5 : 0, borderColor: colors.primary }}>
                  <Text variant="small" weight="semibold" color={on ? colors.onPrimary : colors.text}>{Number(d.slice(8))}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 2, position: 'absolute', bottom: 1 }}>
                  {ds.slice(0, 3).map((x) => <View key={x.id} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: dot(x.displayStatus) }} />)}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Row style={{ flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md }}>
          {[['scheduled', 'Scheduled'], ['delivered', 'Delivered'], ['skipped', 'Skipped'], ['pending', 'Preparing'], ['failed', 'Issue']].map(([k, t]) => (
            <Row key={k} style={{ gap: 5 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot(k) }} /><Text variant="caption" muted>{t}</Text></Row>
          ))}
        </Row>
      </Card>

      <Row style={{ marginTop: spacing.lg }}>
        {([['all', 'Selected day'], ['upcoming', 'Upcoming'], ['delivered', 'Delivered'], ['skipped', 'Skipped'], ['issues', 'Issues']] as const).map(([k, t]) => <Chip key={k} label={t} selected={filter === k} onPress={() => setFilter(k)} testID={`cal-filter-${k}`} />)}
      </Row>
      <SectionHeader title={filter === 'all' ? formatDate(selected, { weekday: true, year: true }) : `${MONTHS[cursor.m]}: ${filter}`} />

      {q.isLoading ? <Skeleton height={90} r={radius.lg} /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !list.length ? (
        <EmptyState icon="calendar" title={filter === 'all' ? 'No delivery this day' : 'Nothing to show'} message={filter === 'all' ? 'Pick another day, or browse products to start a plan.' : 'No deliveries match this filter this month.'} actionLabel={filter === 'all' ? undefined : 'Show selected day'} onAction={() => setFilter('all')} />
      ) : list.map((d) => <DeliveryCard key={d.id} d={d} onPress={() => router.push(`/delivery/${d.id}`)} showDate={filter !== 'all'} />)}
      <Text variant="small" muted style={{ marginTop: spacing.md }}>Upcoming deliveries are created as your plan is topped up each time you open the app. Tomorrow's delivery is locked once the evening cutoff passes.</Text>
    </Screen>
  );
}
