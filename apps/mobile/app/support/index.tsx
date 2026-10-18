import { useRouter } from 'expo-router';
import React from 'react';
import { Linking } from 'react-native';
import { Button, Card, CardSkeleton, EmptyState, ErrorState, Header, ListRow, Row, Screen, SectionHeader, StatusPill, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { config } from '@/lib/config';
import { formatDateTime } from '@/lib/format';
import { useTickets } from '@/lib/queries';
import { spacing } from '@/theme/tokens';

export default function Support() {
  const router = useRouter();
  const tickets = useTickets();
  return (
    <Screen onRefresh={() => tickets.refetch()} refreshing={tickets.isRefetching} footer={<Button title="Raise a ticket" icon="edit" onPress={() => router.push('/support/new')} testID="new-ticket" />}>
      <Header title="Support" />
      <Card>
        <ListRow icon="help-circle" title="Frequently asked questions" subtitle="Quick answers" onPress={() => router.push('/support/faq')} />
        <ListRow icon="mail" title="Email us" subtitle={config.supportEmail} onPress={() => Linking.openURL(`mailto:${config.supportEmail}`)} />
        {config.supportPhone ? <ListRow icon="phone" title="Call us" subtitle={config.supportPhone} onPress={() => Linking.openURL(`tel:${config.supportPhone}`)} /> : null}
      </Card>
      <SectionHeader title="Your tickets" />
      {tickets.isLoading ? <CardSkeleton /> : tickets.isError ? <ErrorState message={errorMessage(tickets.error)} onRetry={() => tickets.refetch()} /> : !tickets.data?.length ? (
        <EmptyState icon="message-circle" title="No tickets" message="If something is wrong with a delivery or payment, raise a ticket and we will get back to you." />
      ) : tickets.data.map((t) => (
        <Card key={t.id} style={{ marginBottom: spacing.sm }} testID={`ticket-${t.id}`}>
          <Row style={{ justifyContent: 'space-between' }}><Text weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{t.subject}</Text><StatusPill status={t.status} /></Row>
          <Text variant="small" muted style={{ marginTop: 4 }} numberOfLines={3}>{t.message}</Text>
          <Text variant="caption" muted style={{ marginTop: 6 }}>{t.category} · {formatDateTime(t.createdAt)}</Text>
        </Card>
      ))}
    </Screen>
  );
}
