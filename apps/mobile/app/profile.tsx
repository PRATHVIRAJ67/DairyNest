import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { profileUpdate } from '@milk/validation';
import type { z } from 'zod';
import { Button, Header, Input, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useMe, useUpdateMe } from '@/lib/queries';
import { useToast } from '@/store/toast';

type Form = z.infer<typeof profileUpdate>;

export default function EditProfile() {
  const router = useRouter();
  const me = useMe();
  const update = useUpdateMe();
  const show = useToast((s) => s.show);
  const { control, handleSubmit, reset, formState: { errors } } = useForm<Form>({ resolver: zodResolver(profileUpdate), defaultValues: { fullName: '', email: '' } });
  useEffect(() => { if (me.data) reset({ fullName: me.data.fullName, email: me.data.email ?? '' }); }, [me.data, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ fullName: v.fullName, email: v.email || undefined });
      show({ tone: 'success', title: 'Profile updated' });
      router.back();
    } catch (e) { show({ tone: 'danger', title: 'Could not save', message: errorMessage(e) }); }
  });

  return (
    <Screen footer={<Button title="Save" onPress={onSubmit} loading={update.isPending} testID="profile-save" />}>
      <Header title="Edit profile" />
      <Controller control={control} name="fullName" render={({ field }) => <Input testID="profile-name" label="Full name" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.fullName?.message} autoCapitalize="words" />} />
      <Controller control={control} name="email" render={({ field }) => <Input testID="profile-email" label="Email" keyboardType="email-address" autoCapitalize="none" value={field.value ?? ''} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.email?.message} />} />
      <Input label="Mobile number" value={me.data?.phone ?? ''} editable={false} helper="Your number is verified and cannot be changed here. Contact support to change it." />
    </Screen>
  );
}
