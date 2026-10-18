import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Header, Input, Screen, Text } from '@/components/ui';
import { authClient, DEMO_OTP } from '@/lib/authClient';
import { config } from '@/lib/config';

export default function OtpScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code');
    setBusy(true);
    setError(null);
    const { error: e } = await authClient().verifyOtp({ phone: phone!, token: code, type: 'sms' });
    setBusy(false);
    if (e) return setError(/expired|invalid/i.test(e.message) ? 'That code is incorrect or has expired. Check the code or request a new one.' : e.message);
    router.replace('/'); // the entry gate routes to profile setup or home
  };

  const resend = async () => {
    setError(null);
    const { error: e } = await authClient().signInWithOtp({ phone: phone! });
    if (e) return setError(e.message);
    setSeconds(30);
    setResent(true);
  };

  return (
    <Screen>
      <Header title="Verify your number" subtitle={config.testLogin || config.demoMode ? phone : `Code sent to ${phone}`} />
      {error ? <Banner tone="danger" title="Verification failed" message={error} testID="otp-error" /> : null}
      {config.demoMode ? <Banner tone="info" title="Demo mode" message={`No SMS is sent. Enter ${DEMO_OTP}.`} testID="demo-otp-hint" /> : null}
      {config.testLogin && !config.demoMode ? <Banner tone="info" title="Test version" message="No SMS is sent. Enter the test code you were given." testID="test-otp-hint" /> : null}
      {resent && !error ? <Banner tone="success" title="New code sent" /> : null}
      <Input
        testID="otp-input"
        label="6-digit code"
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
        placeholder="______"
        style={{ letterSpacing: 8, fontSize: 22 }}
        onSubmitEditing={verify}
      />
      <Button title="Verify and continue" onPress={verify} loading={busy} disabled={code.length !== 6} testID="otp-submit" />
      <View style={{ marginTop: 20, alignItems: 'center' }}>
        {seconds > 0 ? (
          <Text muted>Resend code in {seconds}s</Text>
        ) : (
          <Button title="Resend code" variant="ghost" full={false} onPress={resend} testID="otp-resend" />
        )}
        <Button title="Use a different number" variant="ghost" full={false} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
