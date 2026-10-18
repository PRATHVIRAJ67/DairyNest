import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Button, CardSkeleton, EmptyState, ErrorState, Header, Row, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useMarkAllRead, useMarkRead, useNotifications } from '@/lib/queries';
import type { AppNotification } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

const ICON: Record<string, keyof typeof Feather.glyphMap> = { payment: 'credit-card', delivery: 'truck', subscription: 'repeat' };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export default function Notifications() {
  const { colors } = useTheme();
  const router = useRouter();
  const q = useNotifications();
  const read = useMarkRead();
  const readAll = useMarkAllRead();

  const open = (n: AppNotification) => {
    if (!n.readAt) read.mutate(n.id);
    if (n.data?.deliveryId) router.push(`/delivery/${n.data.deliveryId}`);
    else if (n.data?.subscriptionId) router.push(`/subscription/${n.data.subscriptionId}`);
    else if (n.type.startsWith('payment')) router.push('/payments');
  };

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <Header title="Notifications" right={q.data?.unread ? <Button title="Mark all read" size="sm" variant="ghost" full={false} onPress={() => readAll.mutate()} testID="mark-all-read" /> : undefined} />
      {q.isLoading ? <CardSkeleton /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
        <EmptyState icon="bell" title="You are all caught up" message="Delivery and payment updates will show up here." />
      ) : q.data.items.map((n) => (
        <Pressable key={n.id} testID={`notif-${n.id}`} accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body}. ${n.readAt ? 'Read' : 'Unread'}`} onPress={() => open(n)} style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: n.readAt ? colors.surfaceAlt : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name={ICON[n.type.split('.')[0]] ?? 'bell'} size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text weight={n.readAt ? 'medium' : 'bold'} style={{ flex: 1 }}>{n.title}</Text>
              <Text variant="caption" muted>{ago(n.createdAt)}</Text>
            </Row>
            <Text variant="small" muted>{n.body}</Text>
          </View>
          {!n.readAt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 }} /> : null}
        </Pressable>
      ))}
    </Screen>
  );
}
