import { formatINR } from '@milk/shared';

export const money = formatINR;

export const FREQUENCY_LABEL: Record<string, string> = { daily: 'Every day', alternate_days: 'Alternate days', weekdays: 'Selected days' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function scheduleLabel(frequency: string, weekdays?: number[] | null) {
  if (frequency === 'weekdays' && weekdays?.length) return [1, 2, 3, 4, 5, 6, 0].filter((d) => weekdays.includes(d)).map((d) => DOW[d]).join(', ');
  return FREQUENCY_LABEL[frequency] ?? frequency;
}

export function windowLabel(start?: string, end?: string) {
  if (!start || !end) return '';
  const f = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${ap}`;
  };
  return `${f(start)} - ${f(end)}`;
}

export function cutoffLabel(t: string) {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function greeting(hour: number) {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Local calendar date as YYYY-MM-DD in Asia/Kolkata (the business timezone). */
export const todayIST = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
