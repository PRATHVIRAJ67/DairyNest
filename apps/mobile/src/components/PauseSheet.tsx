import React, { useState } from 'react';
import { View } from 'react-native';
import { addDays } from '@milk/shared';
import { BottomSheet, Button, Banner, DateStrip, OptionCard, Text, formatDate } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { subActions, useSubAction } from '@/lib/queries';
import { cutoffLabel } from '@/lib/format';
import type { Subscription } from '@/lib/types';
import { useToast } from '@/store/toast';
import { spacing } from '@/theme/tokens';

type Choice = 'tomorrow' | 'week' | 'date' | 'indefinite';

/** Pause options with a plain-language explanation of the delivery and billing impact. */
export function PauseSheet({ sub, visible, onClose }: { sub: Subscription; visible: boolean; onClose: () => void }) {
  const eff = sub.rules.earliestChangeableDate;
  const [choice, setChoice] = useState<Choice>('week');
  const [until, setUntil] = useState<string>(addDays(eff, 6));
  const show = useToast((s) => s.show);
  const pause = useSubAction(sub.id, (v: { until: string | null }) => subActions.pause(sub.id, { from: eff, until: v.until }));

  const untilDate = choice === 'tomorrow' ? eff : choice === 'week' ? addDays(eff, 6) : choice === 'date' ? until : null;
  const confirm = async () => {
    try {
      await pause.mutateAsync({ until: untilDate });
      show({ tone: 'success', title: 'Subscription paused', message: untilDate ? `No deliveries until after ${formatDate(untilDate)}.` : 'No deliveries until you resume.' });
      onClose();
    } catch (e) {
      show({ tone: 'danger', title: 'Could not pause', message: errorMessage(e) });
    }
  };

  return (
    <BottomSheet visible={visible} title="Pause deliveries" onClose={onClose}>
      <Text muted style={{ marginBottom: spacing.md }}>
        Changes apply from {formatDate(eff)}. Orders close at {cutoffLabel(sub.rules.cutoffTime)} the evening before, so earlier deliveries can no longer be stopped.
      </Text>
      <OptionCard testID="pause-tomorrow" title="Just one day" subtitle={formatDate(eff)} selected={choice === 'tomorrow'} onPress={() => setChoice('tomorrow')} />
      <OptionCard testID="pause-week" title="One week" subtitle={`${formatDate(eff)} to ${formatDate(addDays(eff, 6))}`} selected={choice === 'week'} onPress={() => setChoice('week')} />
      <OptionCard testID="pause-date" title="Until a date I choose" selected={choice === 'date'} onPress={() => setChoice('date')} />
      {choice === 'date' ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text variant="small" muted style={{ marginBottom: 4 }}>Last paused day</Text>
          <DateStrip from={eff} days={45} value={until} onChange={setUntil} />
        </View>
      ) : null}
      <OptionCard testID="pause-indefinite" title="Until I resume" subtitle="Stays paused until you tap Resume" selected={choice === 'indefinite'} onPress={() => setChoice('indefinite')} />
      <Banner
        tone="info"
        title="What happens to billing"
        message="You will not be charged for paused days. Your prepaid deliveries are kept and used after you resume, so your plan simply lasts longer."
      />
      <Button title="Pause subscription" onPress={confirm} loading={pause.isPending} testID="pause-confirm" />
    </BottomSheet>
  );
}
