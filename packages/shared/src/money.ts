/** All money is integer minor units (paise). Never use floats for financial math. */
export const CURRENCY = 'INR' as const;

export function assertMinor(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid minor amount: ${n}`);
  return n;
}

/** Percentage in basis points (1% = 100 bps), rounded half-up using integer math. */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  return Math.floor((amountMinor * bps + 5000) / 10000);
}

export function formatINR(minor: number): string {
  const rupees = Math.trunc(minor / 100);
  const paise = Math.abs(minor % 100);
  const r = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₹${r}${paise ? '.' + paise.toString().padStart(2, '0') : ''}`;
}
