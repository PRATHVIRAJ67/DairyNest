import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { Banner, Button, Chip, Header, Input, Row, Screen, SwitchRow, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { checkServiceability, useAddresses, useSaveAddress } from '@/lib/queries';
import { addressForm, type AddressForm } from '@/lib/forms';
import { cutoffLabel, windowLabel } from '@/lib/format';
import { useToast } from '@/store/toast';
import { spacing } from '@/theme/tokens';

export default function EditAddress() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const addresses = useAddresses();
  const save = useSaveAddress();
  const show = useToast((s) => s.show);
  const existing = addresses.data?.find((a) => a.id === id);

  const { control, handleSubmit, reset, watch, setError, formState: { errors } } = useForm<AddressForm>({
    resolver: zodResolver(addressForm),
    defaultValues: { label: 'Home', recipientName: '', phoneDigits: '', line1: '', line2: '', landmark: '', city: '', postalCode: '', deliveryInstructions: '', isDefault: false },
  });
  useEffect(() => {
    if (existing) reset({ label: existing.label, recipientName: existing.recipientName, phoneDigits: existing.phone.replace('+91', ''), line1: existing.line1, line2: existing.line2, landmark: existing.landmark, city: existing.city, postalCode: existing.postalCode, deliveryInstructions: existing.deliveryInstructions, isDefault: existing.isDefault });
  }, [existing, reset]);

  const pin = watch('postalCode');
  const zone = useQuery({ queryKey: ['serviceability', pin], queryFn: () => checkServiceability(pin), enabled: /^[1-9][0-9]{5}$/.test(pin), staleTime: 5 * 60_000 });

  const onSubmit = handleSubmit(async (v) => {
    try {
      const { phoneDigits, ...rest } = v;
      await save.mutateAsync({ ...(id ? { id } : {}), ...rest, phone: `+91${phoneDigits}` });
      show({ tone: 'success', title: id ? 'Address updated' : 'Address saved' });
      router.back();
    } catch (e) {
      setError('line1', { message: errorMessage(e) });
    }
  });

  const field = (name: keyof AddressForm, label: string, extra: object = {}) => (
    <Controller control={control} name={name} render={({ field: f }) => (
      <Input testID={`addr-${name}`} label={label} value={String(f.value ?? '')} onChangeText={f.onChange} onBlur={f.onBlur} error={(errors as any)[name]?.message} {...extra} />
    )} />
  );

  return (
    <Screen footer={<Button title={id ? 'Save changes' : 'Save address'} onPress={onSubmit} loading={save.isPending} testID="address-save" />}>
      <Header title={id ? 'Edit address' : 'New address'} />
      <Controller control={control} name="label" render={({ field: f }) => (
        <View style={{ marginBottom: spacing.lg }}>
          <Row style={{ flexWrap: 'wrap', rowGap: spacing.sm }}>
            {['Home', 'Office', 'Other'].map((l) => <Chip key={l} label={l} selected={f.value === l} onPress={() => f.onChange(l)} />)}
          </Row>
          {errors.label ? <Text variant="small" color="#B93A2B">{errors.label.message}</Text> : null}
        </View>
      )} />
      {field('recipientName', 'Recipient name', { autoCapitalize: 'words' })}
      <Controller control={control} name="phoneDigits" render={({ field: f }) => (
        <Input testID="addr-phone" label="Mobile number" prefix="+91" keyboardType="number-pad" maxLength={10} value={f.value} onChangeText={(t) => f.onChange(t.replace(/\D/g, ''))} onBlur={f.onBlur} error={errors.phoneDigits?.message} />
      )} />
      {field('line1', 'House / flat and street')}
      {field('line2', 'Area / locality (optional)')}
      {field('landmark', 'Landmark (optional)', { helper: 'Helps our delivery partner find you' })}
      <Row style={{ gap: spacing.md }}>
        <View style={{ flex: 1 }}>{field('city', 'City')}</View>
        <View style={{ flex: 1 }}>{field('postalCode', 'PIN code', { keyboardType: 'number-pad', maxLength: 6 })}</View>
      </Row>
      {zone.data ? (
        zone.data.serviceable ? (
          <Banner tone="success" title={`We deliver to ${pin}`} message={zone.data.zone ? `${zone.data.zone.name}: ${windowLabel(zone.data.zone.windowStart, zone.data.zone.windowEnd)}. Change by ${cutoffLabel(zone.data.zone.cutoffTime)} the evening before.` : undefined} testID="serviceable" />
        ) : (
          <Banner tone="warn" title="Not serviceable yet" message="We do not deliver to this PIN code yet. You can still save it, but you cannot subscribe here." testID="not-serviceable" />
        )
      ) : null}
      {field('deliveryInstructions', 'Delivery instructions (optional)', { multiline: true, numberOfLines: 3, placeholder: 'e.g. Leave at the door, do not ring the bell', style: { minHeight: 70, textAlignVertical: 'top' } })}
      <Controller control={control} name="isDefault" render={({ field: f }) => <SwitchRow title="Make this my default address" value={f.value} onChange={f.onChange} />} />
    </Screen>
  );
}
