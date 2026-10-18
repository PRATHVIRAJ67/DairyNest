import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Banner, Button, Header, Screen, Text } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { config } from '@/lib/config';
import { money } from '@/lib/format';
import { reconcileOrder, useMe, verifyPayment } from '@/lib/queries';
import { useCart } from '@/store/cart';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

type Phase = 'checkout' | 'verifying' | 'paid' | 'failed' | 'pending' | 'dismissed';

const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

function checkoutHtml(o: { key: string; orderId: string; amount: number; name?: string; contact?: string; email?: string }) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#FBF7EC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#17301F}</style></head><body><p>Opening secure checkout…</p>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  function post(m){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  try {
    var o = ${safeJson({ key: o.key, amount: o.amount, currency: 'INR', order_id: o.orderId, name: 'Meadowpail', description: 'Milk and curd subscription', prefill: { name: o.name, contact: o.contact, email: o.email }, theme: { color: '#1F5C3A' } })};
    o.handler = function(r){ post({ type: 'success', razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature }); };
    o.modal = { ondismiss: function(){ post({ type: 'dismissed' }); } };
    var rzp = new Razorpay(o);
    rzp.on('payment.failed', function(r){ post({ type: 'failed', reason: (r.error && r.error.description) || 'Payment failed' }); });
    rzp.open();
  } catch (e) { post({ type: 'error', reason: String(e) }); }
</script></body></html>`;
}

export default function Pay() {
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const clearCart = useCart((s) => s.clear);
  const p = useLocalSearchParams<{ subscriptionId: string; orderId: string; paymentOrderId: string; amount: string; keyId: string }>();
  const me = useMe();
  const [phase, setPhase] = useState<Phase>('checkout');
  const [reason, setReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const handled = useRef(false);

  const html = useMemo(
    () => checkoutHtml({ key: p.keyId, orderId: p.orderId, amount: Number(p.amount), name: me.data?.fullName, contact: me.data?.phone ?? undefined, email: me.data?.email ?? undefined }),
    [p.keyId, p.orderId, p.amount, me.data, attempt],
  );

  const refresh = () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); qc.invalidateQueries({ queryKey: ['subscription'] }); qc.invalidateQueries({ queryKey: ['payments'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['deliveries'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); };

  const onMessage = (e: WebViewMessageEvent) => {
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    return handle(m);
  };

  const handle = async (m: any) => {
    if (m.type === 'success') {
      if (handled.current) return;
      handled.current = true;
      setPhase('verifying');
      try {
        // The device callback is only a hint. The server verifies the signature AND confirms the capture with Razorpay.
        const r = await verifyPayment({ razorpay_order_id: m.razorpay_order_id, razorpay_payment_id: m.razorpay_payment_id, razorpay_signature: m.razorpay_signature });
        refresh();
        if (r.status === 'paid') { clearCart(); setPhase('paid'); }
        else if (r.status === 'failed') { setReason('The payment was declined.'); setPhase('failed'); }
        else setPhase('pending');
      } catch (err) {
        setReason(errorMessage(err));
        setPhase('pending');
      } finally { handled.current = false; }
    } else if (m.type === 'failed') { setReason(m.reason); setPhase('failed'); }
    else if (m.type === 'dismissed') setPhase((cur) => (cur === 'checkout' ? 'dismissed' : cur));
    else if (m.type === 'error') { setReason('Could not load the payment page. Check your connection.'); setPhase('failed'); }
  };

  const checkStatus = async () => {
    setPhase('verifying');
    try {
      const r = await reconcileOrder(p.paymentOrderId);
      refresh();
      if (r.status === 'paid') { clearCart(); setPhase('paid'); } else { setReason('We have not received confirmation from your bank yet.'); setPhase('pending'); }
    } catch (err) { setReason(errorMessage(err)); setPhase('pending'); }
  };

  const retry = () => { setReason(null); setAttempt((a) => a + 1); setPhase('checkout'); };

  // Demo mode: the demo API plays Razorpay and returns a signed proof; the real /payments/verify still checks it.
  const demoPay = async (outcome: 'success' | 'fail') => {
    setPhase('verifying');
    try {
      const proof = await api.post<{ razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }>('/demo/pay', { providerOrderId: p.orderId, outcome });
      await handle({ type: 'success', ...proof });
    } catch (err) { setReason(errorMessage(err)); setPhase('failed'); }
  };

  if (config.demoMode && phase === 'checkout') {
    return (
      <Screen>
        <Header title="Payment" />
        <Banner tone="info" title="Demo payment" message="Razorpay is simulated by the demo server. No money moves, but the server still verifies the payment signature." />
        <View style={{ alignItems: 'center', marginVertical: spacing.xl }}>
          <Text muted>Amount due</Text>
          <Text variant="display" color={colors.primary} testID="demo-amount">{money(Number(p.amount))}</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          <Button title={`Pay ${money(Number(p.amount))}`} icon="lock" onPress={() => demoPay('success')} testID="demo-pay-success" />
          <Button title="Simulate a declined payment" variant="secondary" onPress={() => demoPay('fail')} testID="demo-pay-fail" />
          <Button title="Cancel" variant="ghost" onPress={() => setPhase('dismissed')} />
        </View>
      </Screen>
    );
  }

  if (Platform.OS === 'web') {
    return <Screen><Header title="Payment" /><Banner tone="info" title="Open the mobile app to pay" message="Secure checkout is available in the iOS and Android apps." /></Screen>;
  }

  if (phase === 'checkout') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <WebView
          key={attempt}
          source={{ html, baseUrl: 'https://checkout.razorpay.com' }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => <ActivityIndicator style={{ position: 'absolute', top: '50%', alignSelf: 'center' }} color={colors.primary} />}
          onShouldStartLoadWithRequest={(req) => {
            if (/^(upi|phonepe|paytmmp|tez|gpay|intent):/i.test(req.url)) { Linking.openURL(req.url).catch(() => undefined); return false; }
            return true;
          }}
        />
        <View style={{ position: 'absolute', top: 48, left: 12 }}>
          <Button title="Cancel" size="sm" variant="secondary" full={false} onPress={() => setPhase('dismissed')} />
        </View>
      </View>
    );
  }

  const done = phase === 'paid';
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        {phase === 'verifying' ? <ActivityIndicator size="large" color={colors.primary} /> : (
          <View style={{ width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? colors.successBg : phase === 'pending' ? colors.warnBg : colors.dangerBg }}>
            <Feather name={done ? 'check' : phase === 'pending' ? 'clock' : 'x'} size={40} color={done ? colors.success : phase === 'pending' ? colors.warn : colors.danger} />
          </View>
        )}
        <Text variant="h1" center testID="pay-result">
          {phase === 'verifying' ? 'Confirming your payment…' : done ? 'Payment successful' : phase === 'pending' ? 'Payment pending' : phase === 'dismissed' ? 'Payment not completed' : 'Payment failed'}
        </Text>
        <Text muted center>
          {phase === 'verifying' ? 'Please keep the app open. We are verifying with the bank.' : done ? `We received ${money(Number(p.amount))}. Your deliveries are confirmed.` : phase === 'pending' ? `${reason ?? 'Your bank has not confirmed yet.'} If money was debited it will be applied automatically once confirmed.` : phase === 'dismissed' ? 'No money was taken. Your subscription is saved and waiting for payment.' : reason ?? 'Your payment did not go through.'}
        </Text>
      </View>
      {phase !== 'verifying' ? (
        <View style={{ gap: spacing.sm }}>
          {done ? <Button title="View my subscription" onPress={() => router.replace(`/subscription/${p.subscriptionId}`)} testID="pay-done" /> : null}
          {phase === 'pending' ? <Button title="Check payment status" onPress={checkStatus} testID="pay-check" /> : null}
          {phase === 'failed' || phase === 'dismissed' ? <Button title="Try again" onPress={retry} testID="pay-retry" /> : null}
          {!done ? <Button title="Go to my plans" variant="ghost" onPress={() => router.replace('/(tabs)/subscriptions')} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
