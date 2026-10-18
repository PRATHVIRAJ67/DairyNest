import { applyBps, assertMinor } from './money';
import { BILLING_PERIOD_DAYS, addDays, scheduledDates, type ISODate, type ScheduleRule } from './dates';

export interface PricedItem {
  unitPriceMinor: number;
  quantity: number;
}
export interface CouponRule {
  discountType: 'percent' | 'flat';
  /** percent => basis points (1000 = 10%); flat => minor units */
  value: number;
  maxDiscountMinor?: number | null;
  minOrderMinor?: number | null;
}

export const perDeliveryTotal = (items: PricedItem[]) =>
  items.reduce((s, i) => s + assertMinor(i.unitPriceMinor) * i.quantity, 0);

export function couponDiscount(subtotal: number, c: CouponRule): number {
  if (c.minOrderMinor && subtotal < c.minOrderMinor) return 0;
  let d = c.discountType === 'percent' ? applyBps(subtotal, c.value) : c.value;
  if (c.maxDiscountMinor != null) d = Math.min(d, c.maxDiscountMinor);
  return Math.min(d, subtotal);
}

export interface PriceBreakdown {
  periodStart: ISODate;
  periodEnd: ISODate;
  deliveries: number;
  perDeliveryMinor: number;
  subtotalMinor: number;
  planDiscountMinor: number;
  couponDiscountMinor: number;
  totalMinor: number;
}

/** Prepaid first billing period (30 days from start). The server is the only source of truth. */
export function priceSubscription(args: {
  items: PricedItem[];
  rule: ScheduleRule;
  planDiscountBps?: number;
  coupon?: CouponRule | null;
  holidays?: ISODate[];
}): PriceBreakdown {
  const periodStart = args.rule.startDate;
  const periodEnd = addDays(periodStart, BILLING_PERIOD_DAYS - 1);
  const deliveries = scheduledDates(args.rule, periodStart, periodEnd, args.holidays ?? []).length;
  const perDeliveryMinor = perDeliveryTotal(args.items);
  const subtotalMinor = perDeliveryMinor * deliveries;
  const planDiscountMinor = applyBps(subtotalMinor, args.planDiscountBps ?? 0);
  const afterPlan = subtotalMinor - planDiscountMinor;
  const couponDiscountMinor = args.coupon ? couponDiscount(afterPlan, args.coupon) : 0;
  return {
    periodStart,
    periodEnd,
    deliveries,
    perDeliveryMinor,
    subtotalMinor,
    planDiscountMinor,
    couponDiscountMinor,
    totalMinor: afterPlan - couponDiscountMinor,
  };
}
