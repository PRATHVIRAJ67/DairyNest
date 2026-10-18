import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyBps,
  canTransition,
  earliestChangeableDate,
  formatINR,
  isBeforeCutoff,
  isScheduledOn,
  priceSubscription,
  scheduledDates,
  zonedNow,
} from './index';

describe('money', () => {
  it('applies bps with integers', () => {
    expect(applyBps(10000, 1000)).toBe(1000);
    expect(applyBps(999, 1000)).toBe(100);
  });
  it('formats INR', () => {
    expect(formatINR(123456)).toBe('₹1,234.56');
    expect(formatINR(6000)).toBe('₹60');
  });
});

describe('schedule', () => {
  it('alternate days anchors on start', () => {
    const r = { frequency: 'alternate_days' as const, startDate: '2026-01-01' };
    expect(scheduledDates(r, '2026-01-01', '2026-01-07')).toEqual([
      '2026-01-01',
      '2026-01-03',
      '2026-01-05',
      '2026-01-07',
    ]);
  });
  it('weekdays and exclusions', () => {
    const r = { frequency: 'weekdays' as const, startDate: '2026-01-01', weekdays: [1, 4] };
    expect(scheduledDates(r, '2026-01-01', '2026-01-12', ['2026-01-05'])).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-12',
    ]);
    expect(isScheduledOn(r, '2025-12-29')).toBe(false);
  });
  it('addDays crosses leap day', () => {
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
  });
});

describe('cutoff (IST)', () => {
  it('before cutoff => tomorrow is changeable', () => {
    const now = new Date('2026-03-10T14:30:00Z'); // 20:00 IST
    expect(zonedNow(now).date).toBe('2026-03-10');
    expect(earliestChangeableDate(now, '21:00')).toBe('2026-03-11');
    expect(isBeforeCutoff('2026-03-11', now, '21:00')).toBe(true);
  });
  it('after cutoff => only day after tomorrow', () => {
    const now = new Date('2026-03-10T16:00:00Z'); // 21:30 IST
    expect(isBeforeCutoff('2026-03-11', now, '21:00')).toBe(false);
    expect(isBeforeCutoff('2026-03-12', now, '21:00')).toBe(true);
  });
  it('19:00Z is already the next calendar day in IST', () => {
    expect(zonedNow(new Date('2026-03-10T19:00:00Z')).date).toBe('2026-03-11');
  });
});

describe('state machine', () => {
  it('rejects invalid transitions', () => {
    expect(canTransition('pending_payment', 'paused')).toBe(false);
    expect(canTransition('cancelled', 'active')).toBe(false);
    expect(canTransition('active', 'paused')).toBe(true);
  });
});

describe('pricing', () => {
  it('prices a 30 day daily period with percent coupon', () => {
    const p = priceSubscription({
      items: [{ unitPriceMinor: 3000, quantity: 2 }],
      rule: { frequency: 'daily', startDate: '2026-04-01' },
      coupon: { discountType: 'percent', value: 1000 },
    });
    expect(p.deliveries).toBe(30);
    expect(p.subtotalMinor).toBe(180000);
    expect(p.couponDiscountMinor).toBe(18000);
    expect(p.totalMinor).toBe(162000);
  });
  it('flat coupon is capped at the subtotal', () => {
    const p = priceSubscription({
      items: [{ unitPriceMinor: 100, quantity: 1 }],
      rule: { frequency: 'alternate_days', startDate: '2026-04-01' },
      coupon: { discountType: 'flat', value: 999999 },
    });
    expect(p.totalMinor).toBe(0);
  });
});
