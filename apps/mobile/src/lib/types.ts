import type { ISODate } from '@milk/shared';

export interface Variant { id: string; sku: string; name: string; sizeLabel: string; priceMinor: number; mrpMinor: number; isAvailable: boolean }
export interface Product { id: string; slug: string; name: string; description: string; category: string; imageUrl: string | null; isFeatured: boolean; variants: Variant[] }
export interface Address {
  id: string; label: string; recipientName: string; phone: string; line1: string; line2: string; landmark: string; city: string;
  postalCode: string; deliveryInstructions: string; isDefault: boolean; zoneId: string | null;
}
export interface Profile { id: string; fullName: string; phone: string | null; email: string | null; role: string; profileCompleted: boolean; notificationPrefs: NotificationPrefs }
export interface NotificationPrefs { push: boolean; email: boolean; sms: boolean; deliveryUpdates: boolean; paymentUpdates: boolean; promotions: boolean }
export type SubStatus = 'pending_payment' | 'active' | 'paused' | 'past_due' | 'cancelled';
export interface SubItem { variantId: string; quantity: number; unitPriceMinor: number; variantName: string; sizeLabel: string; productName: string; imageUrl: string | null; category: string }
export interface Subscription {
  id: string; status: SubStatus; frequency: 'daily' | 'alternate_days' | 'weekdays'; weekdays: number[] | null; startDate: ISODate; scheduleAnchor?: ISODate; items: SubItem[];
  perDeliveryMinor: number; address: Pick<Address, 'id' | 'label' | 'recipientName' | 'line1' | 'line2' | 'landmark' | 'city' | 'postalCode'>;
  pauses: { id: string; startsOn: ISODate; endsOn: ISODate | null }[]; skippedDates: ISODate[];
  nextDelivery: { id: string; deliveryDate: ISODate; status: string; windowStart: string; windowEnd: string } | null;
  billing: { model: string; autoDebit: boolean; prepaidDeliveriesRemaining: number; coveredThrough: ISODate | null; renewalDue: boolean; lastOrder: any; lastPayment: { status: string; failureReason: string | null } | null };
  rules: { cutoffTime: string; timezone: string; earliestChangeableDate: ISODate };
  actions: { canPause: boolean; canResume: boolean; canSkip: boolean; canEdit: boolean; canCancel: boolean; canPay: boolean; canRenew: boolean };
  cancellation?: { unusedPrepaidDeliveries: number; refundReviewTicketCreated: boolean };
}
export interface Delivery {
  id: string; subscriptionId: string; deliveryDate: ISODate; status: string; displayStatus: string; canModify: boolean; windowStart: string; windowEnd: string;
  instructions: string; totalMinor: number; deliveredAt: string | null; failureReason: string | null; addressLabel: string; addressLine1: string; addressCity: string;
  cutoffTime: string; items: { variantId: string; name: string; quantity: number; unitPriceMinor: number }[];
}
export interface Quote {
  deliveries: number; perDeliveryMinor: number; subtotalMinor: number; planDiscountMinor: number; couponDiscountMinor: number; totalMinor: number;
  periodStart: ISODate; periodEnd: ISODate; earliestStartDate: ISODate; cutoffTime: string; couponCode: string | null; couponDescription: string | null;
  items: { variantId: string; quantity: number; unitPriceMinor: number; name: string }[];
}
export interface Checkout { subscriptionId: string; paymentOrderId: string; providerOrderId: string; amountMinor: number; currency: 'INR'; keyId: string }
export interface PaymentRow {
  id: string; subscriptionId: string | null; amountMinor: number; status: string; method: string | null; providerPaymentId: string | null; failureReason: string | null;
  refundedMinor: number | null; createdAt: string; periodStart: ISODate | null; periodEnd: ISODate | null; invoiceId: string | null; invoiceNumber: string | null; paymentId: string | null;
}
export interface Invoice { id: string; invoiceNumber: string; amountMinor: number; subscriptionId: string | null; issuedAt: string }
export interface AppNotification { id: string; type: string; title: string; body: string; data: any; readAt: string | null; createdAt: string }
export interface Ticket { id: string; category: string; subject: string; message: string; status: string; createdAt: string }
export interface Plan { id: string; code: string; name: string; description: string; frequency: string; discountBps: number }
