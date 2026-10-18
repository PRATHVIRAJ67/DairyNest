import { z } from 'zod';

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const postalCode = z.string().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code');
export const indianPhone = z
  .string()
  .regex(/^\+91[6-9][0-9]{9}$/, 'Use +91 followed by a 10-digit mobile number');
export const frequency = z.enum(['daily', 'alternate_days', 'weekdays']);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const profileUpdate = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
});

export const addressInput = z.object({
  label: z.string().trim().min(1, 'Add a label').max(30),
  recipientName: z.string().trim().min(2, 'Enter a name').max(80),
  phone: indianPhone,
  line1: z.string().trim().min(3, 'Enter your address').max(150),
  line2: z.string().trim().max(150).optional().default(''),
  landmark: z.string().trim().max(100).optional().default(''),
  city: z.string().trim().min(2, 'Enter a city').max(60),
  postalCode,
  deliveryInstructions: z.string().trim().max(250).optional().default(''),
  isDefault: z.boolean().optional().default(false),
});
export const addressUpdate = addressInput.partial();

export const productsQuery = paginationQuery.extend({
  category: z.enum(['milk', 'curd', 'other']).optional(),
  featured: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(60).optional(),
});

export const subscriptionItemInput = z.object({
  variantId: uuid,
  quantity: z.number().int().min(1).max(20),
});

export const scheduleInput = z
  .object({
    frequency,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    startDate: isoDate,
  })
  .refine((v) => v.frequency !== 'weekdays' || (v.weekdays && v.weekdays.length > 0), {
    message: 'Pick at least one weekday',
    path: ['weekdays'],
  });

export const quoteInput = z.object({
  items: z.array(subscriptionItemInput).min(1).max(10),
  schedule: scheduleInput,
  addressId: uuid,
  couponCode: z.string().trim().toUpperCase().max(30).optional(),
});

export const createSubscriptionInput = quoteInput.extend({
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
  idempotencyKey: z.string().min(8).max(100),
});

export const pauseInput = z.object({
  from: isoDate.optional(),
  until: isoDate.nullable().optional(), // null/undefined => indefinite
});
export const skipInput = z.object({ date: isoDate });
export const updateItemsInput = z.object({ items: z.array(subscriptionItemInput).min(1).max(10) });
export const updateFrequencyInput = scheduleInput;
export const updateAddressInput = z.object({ addressId: uuid });

export const calendarQuery = z.object({
  from: isoDate,
  to: isoDate,
  subscriptionId: uuid.optional(),
});

export const verifyPaymentInput = z.object({
  razorpay_order_id: z.string().min(5),
  razorpay_payment_id: z.string().min(5),
  razorpay_signature: z.string().min(10),
});

export const supportTicketInput = z.object({
  category: z.enum(['delivery', 'payment', 'product', 'account', 'other']),
  subject: z.string().trim().min(3, 'Add a subject').max(120),
  message: z.string().trim().min(10, 'Please describe the issue (10+ characters)').max(2000),
});

export const notificationPrefsInput = z.object({
  push: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
  deliveryUpdates: z.boolean(),
  paymentUpdates: z.boolean(),
  promotions: z.boolean(),
});
export const pushTokenInput = z.object({ token: z.string().min(10).max(300) });
export const deleteAccountInput = z.object({ confirm: z.literal('DELETE') });
export const couponValidateInput = z.object({
  code: z.string().trim().toUpperCase().min(3).max(30),
  subtotalMinor: z.number().int().min(0).optional(),
});
export const serviceabilityQuery = z.object({ postalCode });

export type AddressInput = z.infer<typeof addressInput>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionInput>;
export type QuoteInput = z.infer<typeof quoteInput>;
