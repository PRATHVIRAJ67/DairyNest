import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Linking, View } from 'react-native';
import { z } from 'zod';
import { indianPhone } from '@milk/validation';
import { Banner, Button, Input, Screen, Text } from '@/components/ui';
import { config } from '@/lib/config';
import { authClient } from '@/lib/authClient';

const schema = z.object({ digits: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number') });
type Form = z.infer<typeof schema>;

export default function PhoneScreen() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { digits: '' } });

  const onSubmit = handleSubmit(async ({ digits }) => {
    setError(null);
    const phone = `+91${digits}`;
    if (!indianPhone.safeParse(phone).success) return setError('Enter a valid mobile number');
    // Real OTP via Supabase Auth. Requires an SMS provider configured in the Supabase dashboard.
    const { error: e } = await authClient().signInWithOtp({ phone });
    if (e) {
      setError(/provider|sms|twilio/i.test(e.message) ? 'SMS sending is not set up for this project yet. Ask the administrator to configure a phone provider in Supabase Auth.' : e.message);
      return;
    }
    router.push({ pathname: '/(auth)/otp', params: { phone } });
  });

  return (
    <Screen>
      <View style={{ marginTop: 32, marginBottom: 32 }}>
        <Text variant="display">Welcome</Text>
        <Text muted style={{ marginTop: 8 }}>Enter your mobile number. We will text you a one-time code to sign in or create your account.</Text>
      </View>
      {config.demoMode ? <Banner tone="info" title="Demo mode" message="Use any 10-digit mobile number. No SMS is sent; the code is 123456." /> : null}
      {config.testLogin && !config.demoMode ? <Banner tone="info" title="Test version" message="No SMS is sent. Use any 10-digit mobile number, then enter the test code you were given." /> : null}
      {error ? <Banner tone="danger" title="Could not send the code" message={error} testID="phone-error" /> : null}
      <Controller
        control={control}
        name="digits"
        render={({ field: { value, onChange, onBlur } }) => (
          <Input
            testID="phone-input"
            label="Mobile number"
            prefix="+91"
            keyboardType="number-pad"
            maxLength={10}
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholder="98765 43210"
            value={value}
            onChangeText={(t) => onChange(t.replace(/\D/g, ''))}
            onBlur={onBlur}
            error={errors.digits?.message}
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
        )}
      />
      <Button title="Send code" onPress={onSubmit} loading={isSubmitting} testID="phone-submit" />
      <Text variant="small" muted center style={{ marginTop: 24 }}>
        By continuing you agree to our{' '}
        <Text variant="small" weight="semibold" onPress={() => router.push('/legal/terms')}>Terms</Text> and{' '}
        <Text variant="small" weight="semibold" onPress={() => router.push('/legal/privacy')}>Privacy Policy</Text>.
      </Text>
      <Text variant="small" muted center style={{ marginTop: 16 }}>
        Lost access to your number?{' '}
        <Text variant="small" weight="semibold" onPress={() => Linking.openURL(`mailto:${config.supportEmail}?subject=Account%20recovery`)}>Contact support</Text>
      </Text>
    </Screen>
  );
}
