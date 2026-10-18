import React from 'react';
import { Card, Row, StatusPill, Text, formatDate } from '@/components/ui';
import { windowLabel } from '@/lib/format';
import type { Delivery } from '@/lib/types';
import { spacing } from '@/theme/tokens';

export function DeliveryCard({ d, onPress, showDate }: { d: Delivery; onPress: () => void; showDate?: boolean }) {
  return (
    <Card onPress={onPress} testID={`delivery-${d.id}`} style={{ marginBottom: spacing.sm }} accessibilityLabel={`Delivery ${d.deliveryDate}, ${d.displayStatus}`}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <StatusPill status={d.displayStatus} />
        <Text variant="small" muted>{showDate ? formatDate(d.deliveryDate) + ' · ' : ''}{windowLabel(d.windowStart, d.windowEnd)}</Text>
      </Row>
      {d.items.length ? d.items.map((i) => <Text key={i.variantId} weight="semibold">{i.quantity} × {i.name}</Text>) : <Text muted>Skipped delivery</Text>}
    </Card>
  );
}
