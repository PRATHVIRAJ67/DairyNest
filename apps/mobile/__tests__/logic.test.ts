import { addressForm } from '@/lib/forms';
import { cutoffLabel, greeting, scheduleLabel, windowLabel } from '@/lib/format';
import { useCart } from '@/store/cart';
import type { Product } from '@/lib/types';

const product: Product = {
  id: 'p1', slug: 'farm-fresh-cow-milk', name: 'Farm Fresh Cow Milk', description: '', category: 'milk', imageUrl: null, isFeatured: true,
  variants: [
    { id: 'v1', sku: 'CM-500', name: '500 ml pouch', sizeLabel: '500 ml', priceMinor: 3000, mrpMinor: 3200, isAvailable: true },
    { id: 'v2', sku: 'CM-1000', name: '1 L pouch', sizeLabel: '1 L', priceMinor: 5800, mrpMinor: 6200, isAvailable: true },
  ],
};

describe('subscription basket', () => {
  beforeEach(() => useCart.getState().clear());

  it('adds items, merges the same variant and caps quantity at 20', () => {
    const c = useCart.getState();
    c.add(product, product.variants[0], 2);
    c.add(product, product.variants[0], 3);
    c.add(product, product.variants[1], 1);
    expect(useCart.getState().items.map((i) => [i.variantId, i.quantity])).toEqual([['v1', 5], ['v2', 1]]);
    c.add(product, product.variants[0], 99);
    expect(useCart.getState().items[0].quantity).toBe(20);
    expect(useCart.getState().count()).toBe(21);
  });

  it('removes, updates quantity, and clears everything including schedule and coupon', () => {
    const c = useCart.getState();
    c.add(product, product.variants[0], 1);
    c.setQuantity('v1', 4);
    c.setSchedule({ frequency: 'weekdays', weekdays: [1, 3] });
    c.setCoupon('WELCOME10');
    expect(useCart.getState().items[0].quantity).toBe(4);
    c.remove('v1');
    expect(useCart.getState().items).toHaveLength(0);
    c.clear();
    expect(useCart.getState().schedule.frequency).toBe('daily');
    expect(useCart.getState().couponCode).toBeNull();
  });
});

describe('address form validation', () => {
  const ok = { label: 'Home', recipientName: 'Asha Rao', phoneDigits: '9876543210', line1: '12 MG Road', line2: '', landmark: '', city: 'Bengaluru', postalCode: '560001', deliveryInstructions: '', isDefault: false };
  const errs = (v: object) => Object.keys(addressForm.safeParse(v).error?.flatten().fieldErrors ?? {});

  it('accepts a complete address', () => expect(addressForm.safeParse(ok).success).toBe(true));
  it('flags a bad PIN code, phone, and short fields', () => {
    expect(errs({ ...ok, postalCode: '012345' })).toEqual(['postalCode']);
    expect(errs({ ...ok, postalCode: '5600' })).toEqual(['postalCode']);
    expect(errs({ ...ok, phoneDigits: '5876543210' })).toEqual(['phoneDigits']);
    expect(errs({ ...ok, line1: 'a', city: '' }).sort()).toEqual(['city', 'line1']);
  });
  it('limits delivery instructions to 250 characters', () => expect(errs({ ...ok, deliveryInstructions: 'x'.repeat(251) })).toEqual(['deliveryInstructions']));
});

describe('formatting', () => {
  it('labels schedules', () => {
    expect(scheduleLabel('daily')).toBe('Every day');
    expect(scheduleLabel('weekdays', [5, 1, 0])).toBe('Mon, Fri, Sun');
  });
  it('formats times for display', () => {
    expect(windowLabel('06:00', '08:00')).toBe('6 AM - 8 AM');
    expect(windowLabel('05:30', '07:30')).toBe('5:30 AM - 7:30 AM');
    expect(cutoffLabel('21:00')).toBe('9 PM');
    expect(cutoffLabel('00:00')).toBe('12 AM');
  });
  it('greets by time of day', () => {
    expect([greeting(8), greeting(13), greeting(20)]).toEqual(['Good morning', 'Good afternoon', 'Good evening']);
  });
});
