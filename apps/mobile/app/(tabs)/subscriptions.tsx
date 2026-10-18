import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { SubscriptionCard } from '@/components/SubscriptionCard';
import { CardSkeleton, Chip, EmptyState, ErrorState, Row, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useSubscriptions } from '@/lib/queries';
import { spacing } from '@/theme/tokens';
import { ScrollView } from 'react-native';

const FILTERS = [
  { k: 'all', t: 'All' },
  { k: 'active', t: 'Active' },
  { k: 'paused', t: 'Paused' },
  { k: 'pending_payment', t: 'Pending payment' },
  { k: 'past_due', t: 'Past due' },
  { k: 'cancelled', t: 'Cancelled' },
] as const;

export default function Subscriptions() {
  const router = useRouter();
  const subs = useSubscriptions();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['k']>('all');
  const list = (subs.data ?? []).filter((s) => filter === 'all' || s.status === filter);
  const counts = (k: string) => (k === 'all' ? subs.data?.length ?? 0 : (subs.data ?? []).filter((s) => s.status === k).length);

  return (
    <Screen onRefresh={() => subs.refetch()} refreshing={subs.isRefetching}>
      <Text variant="display">My plans</Text>
      <Text muted style={{ marginBottom: spacing.lg }}>Manage, pause or renew your subscriptions</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg, flexGrow: 0 }}>
        <Row>
          {FILTERS.map((f) => <Chip key={f.k} testID={`sub-filter-${f.k}`} label={`${f.t}${counts(f.k) ? ` (${counts(f.k)})` : ''}`} selected={filter === f.k} onPress={() => setFilter(f.k)} />)}
        </Row>
      </ScrollView>
      {subs.isLoading ? <CardSkeleton /> : subs.isError ? <ErrorState message={errorMessage(subs.error)} onRetry={() => subs.refetch()} /> : !list.length ? (
        filter === 'all' ? (
          <EmptyState icon="repeat" title="No subscriptions yet" message="Subscribe to fresh milk or curd and never run out again." actionLabel="Browse products" onAction={() => router.push('/(tabs)/shop')} />
        ) : (
          <EmptyState icon="inbox" title="Nothing here" message="No subscriptions with this status." actionLabel="Show all" onAction={() => setFilter('all')} />
        )
      ) : list.map((s) => <SubscriptionCard key={s.id} sub={s} onPress={() => router.push(`/subscription/${s.id}`)} />)}
    </Screen>
  );
}
