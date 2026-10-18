import { Feather } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { Card, Row, StatusPill, Text, formatDate } from '@/components/ui';
import { money, scheduleLabel, windowLabel } from '@/lib/format';
import type { Subscription } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export function SubscriptionCard({ sub, onPress, footer }: { sub: Subscription; onPress?: () => void; footer?: React.ReactNode }) {
  const { colors } = useTheme();
  const names = sub.items.map((i) => `${i.quantity} x ${i.productName} (${i.sizeLabel})`);
  return (
    <Card
      onPress={onPress}
      testID={`sub-${sub.id}`}
      accessibilityLabel={`Subscription: ${names.join(', ')}. Status ${sub.status}`}
      style={{ marginBottom: spacing.md }}
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <StatusPill status={sub.status} />
        <Text weight="bold" color={colors.primary}>
          {money(sub.perDeliveryMinor)}
          <Text variant="small" muted>
            {' '}
            / delivery
          </Text>
        </Text>
      </Row>
      {names.slice(0, 3).map((n) => (
        <Text key={n} weight="semibold" numberOfLines={1}>
          {n}
        </Text>
      ))}
      {names.length > 3 ? (
        <Text variant="small" muted>
          +{names.length - 3} more
        </Text>
      ) : null}
      <Row style={{ marginTop: spacing.md, gap: 6 }}>
        <Feather name="repeat" size={14} color={colors.textMuted} />
        <Text variant="small" muted>
          {scheduleLabel(sub.frequency, sub.weekdays)}
        </Text>
      </Row>
      {sub.nextDelivery && sub.status === 'active' ? (
        <Row style={{ marginTop: 6, gap: 6 }}>
          <Feather name="truck" size={14} color={colors.textMuted} />
          <Text variant="small" muted>
            Next: {formatDate(sub.nextDelivery.deliveryDate)} · {windowLabel(sub.nextDelivery.windowStart, sub.nextDelivery.windowEnd)}
          </Text>
        </Row>
      ) : null}
      {sub.status === 'paused' ? (
        <Row style={{ marginTop: 6, gap: 6 }}>
          <Feather name="pause-circle" size={14} color={colors.warn} />
          <Text variant="small" color={colors.warn}>
            {sub.pauses[0]?.endsOn ? `Paused until ${formatDate(sub.pauses[0].endsOn)}` : 'Paused until you resume'}
          </Text>
        </Row>
      ) : null}
      {footer ? <View style={{ marginTop: spacing.md }}>{footer}</View> : null}
    </Card>
  );
}
