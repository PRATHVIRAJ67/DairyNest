import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { profileUpdate } from '@milk/validation';
import type { z } from 'zod';
import { Banner, Button, Input, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useUpdateMe } from '@/lib/queries';
import { useAuth } from '@/store/auth';

type Form = z.infer<typeof profileUpdate>;

export default function ProfileSetup() {
  const router = useRouter();
  const update = useUpdateMe();
  const signOut = useAuth((s) => s.signOut);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(profileUpdate), defaultValues: { fullName: '', email: '' } });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await update.mutateAsync({ fullName: v.fullName, email: v.email || undefined });
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <Screen>
      <View style={{ marginTop: 24, marginBottom: 24 }}>
        <Text variant="display">Tell us about you</Text>
        <Text muted style={{ marginTop: 8 }}>This helps our delivery partners greet you by name.</Text>
      </View>
      {error ? <Banner tone="danger" title="Could not save" message={error} /> : null}
      <Controller control={control} name="fullName" render={({ field }) => (
        <Input testID="name-input" label="Full name" autoComplete="name" textContentType="name" autoCapitalize="words" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.fullName?.message} />
      )} />
      <Controller control={control} name="email" render={({ field }) => (
        <Input testID="email-input" label="Email (optional)" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={errors.email?.message} helper="Used for receipts when email delivery is enabled." />
      )} />
      <Button title="Continue" onPress={onSubmit} loading={update.isPending} testID="profile-submit" />
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
