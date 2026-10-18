import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { Card, CardSkeleton, ErrorState, Header, Row, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useFaqs } from '@/lib/queries';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export default function Faq() {
  const { colors } = useTheme();
  const q = useFaqs();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Screen>
      <Header title="FAQs" />
      {q.isLoading ? <CardSkeleton /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.data?.map((f, i) => (
        <Card key={f.q} style={{ marginBottom: spacing.sm }} padded={false}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === i }} onPress={() => setOpen(open === i ? null : i)} style={{ padding: spacing.lg }}>
            <Row style={{ justifyContent: 'space-between', gap: spacing.md }}>
              <Text weight="semibold" style={{ flex: 1 }}>{f.q}</Text>
              <Feather name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </Row>
            {open === i ? <Text muted style={{ marginTop: spacing.sm }}>{f.a}</Text> : null}
          </Pressable>
        </Card>
      ))}
    </Screen>
  );
}
