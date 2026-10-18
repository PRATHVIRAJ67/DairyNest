export type Frequency = 'daily' | 'alternate_days' | 'weekdays';
export type SubscriptionStatus = 'pending_payment' | 'active' | 'paused' | 'past_due' | 'cancelled';
export type DeliveryStatus =
  | 'scheduled'
  | 'pending'
  | 'out_for_delivery'
  | 'delivered'
  | 'skipped'
  | 'failed'
  | 'cancelled';
export type PaymentOrderStatus = 'created' | 'paid' | 'failed' | 'expired';
export type PaymentStatus = 'pending' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
export type ProductCategory = 'milk' | 'curd' | 'other';

export interface ApiOk<T> {
  data: T;
  meta?: Record<string, unknown>;
}
export interface ApiErr {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
