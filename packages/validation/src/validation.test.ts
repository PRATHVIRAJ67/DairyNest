import { describe, expect, it } from 'vitest';
import { addressInput, createSubscriptionInput, indianPhone, scheduleInput } from './index';

describe('validation', () => {
  it('phone', () => {
    expect(indianPhone.safeParse('+919876543210').success).toBe(true);
    expect(indianPhone.safeParse('9876543210').success).toBe(false);
  });
  it('address pin code', () => {
    const base = {
      label: 'Home',
      recipientName: 'Asha',
      phone: '+919876543210',
      line1: '12 MG Road',
      city: 'Bengaluru',
      postalCode: '560001',
    };
    expect(addressInput.safeParse(base).success).toBe(true);
    expect(addressInput.safeParse({ ...base, postalCode: '012345' }).success).toBe(false);
  });
  it('weekdays frequency requires days', () => {
    expect(scheduleInput.safeParse({ frequency: 'weekdays', startDate: '2026-01-01' }).success).toBe(false);
  });
  it('terms must be accepted', () => {
    const r = createSubscriptionInput.safeParse({
      items: [{ variantId: crypto.randomUUID(), quantity: 1 }],
      schedule: { frequency: 'daily', startDate: '2026-01-01' },
      addressId: crypto.randomUUID(),
      acceptTerms: false,
      idempotencyKey: '12345678',
    });
    expect(r.success).toBe(false);
  });
});
