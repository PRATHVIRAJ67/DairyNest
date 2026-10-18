import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { supportTicketInput } from '@milk/validation';
import type { z } from 'zod';
import { Button, Chip, Header, Input, Row, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useCreateTicket } from '@/lib/queries';
import { useToast } from '@/store/toast';
import { spacing } from '@/theme/tokens';

type Form = z.infer<typeof supportTicketInput>;
const CATS: { k: Form['category']; t: string }[] = [{ k: 'delivery', t: 'Delivery' }, { k: 'payment', t: 'Payment' }, { k: 'product', t: 'Product' }, { k: 'account', t: 'Account' }, { k: 'other', t: 'Other' }];

export default function NewTicket() {
  const params = useLocalSearchParams<{ subject?: string; category?: Form['category'] }>();
  const router = useRouter();
  const create = useCreateTicket();
  const show = useToast((s) => s.show);
  const { control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(supportTicketInput),
    defaultValues: { category: params.category ?? 'delivery', subject: params.subject ?? '', message: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync(v);
      show({ tone: 'success', title: 'Ticket submitted', message: 'We will get back to you soon.' });
      router.back();
    } catch (e) { show({ tone: 'danger', title: 'Could not submit', message: errorMessage(e) }); }
  });
  return (
    <Screen footer={<Button title="Submit ticket" onPress={onSubmit} loading={create.isPending} testID="ticket-submit" />}>
      <Header title="Raise a ticket" />
      <Text variant="caption" muted style={{ marginBottom: 6 }}>CATEGORY</Text>
      <Controller control={control} name="category" render={({ field }) => (
        <Row style={{ flexWrap: 'wrap', rowGap: spacing.sm, marginBottom: spacing.lg }}>{CATS.map((c) => <Chip key={c.k} label={c.t} selected={field.value === c.k} onPress={() => field.onChange(c.k)} />)}</Row>
      )} />
      <Controller control={control} name="subject" render={({ field }) => <Input testID="ticket-subject" label="Subject" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.subject?.message} maxLength={120} />} />
      <Controller control={control} name="message" render={({ field }) => <Input testID="ticket-message" label="What happened?" multiline numberOfLines={6} style={{ minHeight: 130, textAlignVertical: 'top' }} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.message?.message} maxLength={2000} />} />
    </Screen>
  );
}
