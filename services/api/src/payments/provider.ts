import crypto from 'node:crypto';
import { AppError } from '../errors';

export interface ProviderPayment {
  id: string;
  orderId: string;
  amountMinor: number;
  status: 'captured' | 'failed' | 'authorized' | 'created' | 'refunded';
  amountRefundedMinor: number;
  method?: string;
  errorDescription?: string;
}

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Public key sent to the mobile checkout (never the secret). */
  publicKey(): string | null;
  createOrder(args: { amountMinor: number; receipt: string; notes?: Record<string, string> }): Promise<{ id: string }>;
  verifyCheckoutSignature(args: { orderId: string; paymentId: string; signature: string }): boolean;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  fetchOrderPayments(orderId: string): Promise<ProviderPayment[]>;
  refund(args: { paymentId: string; amountMinor: number }): Promise<{ id: string; status: string }>;
}

export function hmacHex(secret: string, data: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export const paymentsNotConfigured = () =>
  new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Online payments are not configured on this server yet.');

/** Used when Razorpay credentials are absent. Nothing is simulated. */
export class UnconfiguredProvider implements PaymentProvider {
  readonly name = 'razorpay';
  isConfigured() {
    return false;
  }
  publicKey() {
    return null;
  }
  async createOrder(): Promise<never> {
    throw paymentsNotConfigured();
  }
  verifyCheckoutSignature() {
    return false;
  }
  verifyWebhookSignature() {
    return false;
  }
  async fetchPayment(): Promise<never> {
    throw paymentsNotConfigured();
  }
  async fetchOrderPayments(): Promise<never> {
    throw paymentsNotConfigured();
  }
  async refund(): Promise<never> {
    throw paymentsNotConfigured();
  }
}

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';
  constructor(
    private keyId: string,
    private keySecret: string,
    private webhookSecret: string | undefined,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  isConfigured() {
    return true;
  }
  publicKey() {
    return this.keyId;
  }
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', json?.error?.description ?? 'Payment provider request failed');
    }
    return json as T;
  }
  async createOrder({ amountMinor, receipt, notes }: { amountMinor: number; receipt: string; notes?: Record<string, string> }) {
    const o = await this.call<{ id: string }>('POST', '/orders', { amount: amountMinor, currency: 'INR', receipt, notes });
    return { id: o.id };
  }
  verifyCheckoutSignature({ orderId, paymentId, signature }: { orderId: string; paymentId: string; signature: string }) {
    return safeEqualHex(hmacHex(this.keySecret, `${orderId}|${paymentId}`), signature);
  }
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined) {
    if (!this.webhookSecret || !signature) return false;
    return safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature);
  }
  private map(p: any): ProviderPayment {
    return {
      id: p.id,
      orderId: p.order_id,
      amountMinor: p.amount,
      status: p.status,
      amountRefundedMinor: p.amount_refunded ?? 0,
      method: p.method,
      errorDescription: p.error_description ?? undefined,
    };
  }
  async fetchPayment(paymentId: string) {
    return this.map(await this.call('GET', `/payments/${encodeURIComponent(paymentId)}`));
  }
  async fetchOrderPayments(orderId: string) {
    const r = await this.call<{ items: any[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    return r.items.map((p) => this.map(p));
  }
  async refund({ paymentId, amountMinor }: { paymentId: string; amountMinor: number }) {
    const r = await this.call<{ id: string; status: string }>('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {
      amount: amountMinor,
    });
    return { id: r.id, status: r.status };
  }
}
