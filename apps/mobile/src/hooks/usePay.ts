import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useCheckout, useRenew } from '@/lib/queries';
import type { Subscription } from '@/lib/types';
import { useToast } from '@/store/toast';

/** Opens the payment screen for an unpaid first period (checkout) or a renewal. */
export function usePayFlow() {
  const router = useRouter();
  const checkout = useCheckout();
  const renew = useRenew();
  const show = useToast((s) => s.show);
  const [busyId, setBusyId] = useState<string | null>(null);

  const start = useCallback(
    async (sub: Pick<Subscription, 'id' | 'status'>, mode: 'auto' | 'renew' = 'auto') => {
      setBusyId(sub.id);
      try {
        const c = mode === 'renew' || sub.status !== 'pending_payment' ? await renew.mutateAsync(sub.id) : await checkout.mutateAsync(sub.id);
        router.push({
          pathname: '/checkout/pay',
          params: { subscriptionId: sub.id, orderId: c.providerOrderId, paymentOrderId: c.paymentOrderId, amount: String(c.amountMinor), keyId: c.keyId },
        });
      } catch (e) {
        show({ tone: 'danger', title: 'Cannot start payment', message: errorMessage(e) });
      } finally {
        setBusyId(null);
      }
    },
    [checkout, renew, router, show],
  );
  return { start, busyId };
}
