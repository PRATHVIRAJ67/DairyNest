import { z } from 'zod';
import { postalCode } from '@milk/validation';

/** Phone is entered as 10 digits; the +91 prefix is added on save. */
export const addressForm = z.object({
  label: z.string().trim().min(1, 'Add a label like Home or Office').max(30),
  recipientName: z.string().trim().min(2, 'Enter the name of the person receiving the delivery').max(80),
  phoneDigits: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number'),
  line1: z.string().trim().min(3, 'Enter your house/flat and street').max(150),
  line2: z.string().trim().max(150),
  landmark: z.string().trim().max(100),
  city: z.string().trim().min(2, 'Enter your city').max(60),
  postalCode,
  deliveryInstructions: z.string().trim().max(250, 'Keep instructions under 250 characters'),
  isDefault: z.boolean(),
});
export type AddressForm = z.infer<typeof addressForm>;

export const phoneForm = z.object({ digits: z.string().regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit mobile number') });
