import type { Frequency } from './types';

/** Business timezone. All delivery dates are calendar dates in this zone. */
export const BUSINESS_TZ = 'Asia/Kolkata';
const DAY = 86400000;
export const BILLING_PERIOD_DAYS = 30;

export type ISODate = string; // YYYY-MM-DD

export function parseISODate(d: ISODate): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Bad date ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`Bad date ${d}`);
  return t;
}
export function addDays(d: ISODate, n: number): ISODate {
  return new Date(parseISODate(d) + n * DAY).toISOString().slice(0, 10);
}
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(a) - parseISODate(b)) / DAY);
}
/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(d: ISODate): number {
  return new Date(parseISODate(d)).getUTCDay();
}

/** Calendar date and minutes-since-midnight for "now" in an IANA timezone. */
export function zonedNow(now: Date, tz: string = BUSINESS_TZ): { date: ISODate; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    minutes: Number(g('hour')) * 60 + Number(g('minute')),
  };
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export interface ScheduleRule {
  frequency: Frequency;
  /** anchor date (subscription start); alternate_days counts from here */
  startDate: ISODate;
  /** 0-6 (Sun=0) used by the weekdays frequency */
  weekdays?: number[];
}

export function isScheduledOn(rule: ScheduleRule, date: ISODate): boolean {
  const delta = diffDays(date, rule.startDate);
  if (delta < 0) return false;
  switch (rule.frequency) {
    case 'daily':
      return true;
    case 'alternate_days':
      return delta % 2 === 0;
    case 'weekdays':
      return (rule.weekdays ?? []).includes(weekdayOf(date));
  }
}

/** Inclusive range of scheduled dates, minus skips/holidays. */
export function scheduledDates(
  rule: ScheduleRule,
  from: ISODate,
  to: ISODate,
  exclude: Iterable<ISODate> = [],
): ISODate[] {
  const ex = new Set(exclude);
  const out: ISODate[] = [];
  for (let d = from; diffDays(d, to) <= 0; d = addDays(d, 1)) {
    if (isScheduledOn(rule, d) && !ex.has(d)) out.push(d);
  }
  return out;
}

/**
 * Cutoff rule: a delivery for date D can be changed until `cutoffTime` on the day BEFORE D.
 * So the earliest changeable date is tomorrow if now is before today's cutoff, else day-after-tomorrow.
 */
export function earliestChangeableDate(now: Date, cutoffTime: string, tz: string = BUSINESS_TZ): ISODate {
  const z = zonedNow(now, tz);
  return z.minutes < timeToMinutes(cutoffTime) ? addDays(z.date, 1) : addDays(z.date, 2);
}

export function isBeforeCutoff(
  deliveryDate: ISODate,
  now: Date,
  cutoffTime: string,
  tz: string = BUSINESS_TZ,
): boolean {
  return diffDays(deliveryDate, earliestChangeableDate(now, cutoffTime, tz)) >= 0;
}
