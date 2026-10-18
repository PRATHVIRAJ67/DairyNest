import type { SubscriptionStatus } from './types';

/** Explicit allowed subscription transitions. Anything else is rejected. */
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  pending_payment: ['active', 'cancelled'],
  active: ['paused', 'past_due', 'cancelled'],
  paused: ['active', 'cancelled'],
  past_due: ['active', 'cancelled'],
  cancelled: [],
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}
