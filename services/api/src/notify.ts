import type { Queryable } from './db';
import type { Logger } from './logger';

export interface PushSender {
  /** Returns true only when the push provider accepted the message. */
  send(token: string, title: string, body: string, data: Record<string, unknown>): Promise<boolean>;
}

/** Expo push service. Real delivery; reports failure honestly. */
export class ExpoPushSender implements PushSender {
  constructor(private accessToken?: string, private fetchImpl: typeof fetch = fetch) {}
  async send(token: string, title: string, body: string, data: Record<string, unknown>) {
    if (!/^(Expo|Exponent)PushToken\[.+\]$/.test(token)) return false;
    const res = await this.fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
    });
    if (!res.ok) return false;
    const json: any = await res.json().catch(() => ({}));
    return json?.data?.status === 'ok';
  }
}

export type Category = 'deliveryUpdates' | 'paymentUpdates' | 'promotions';
export interface NotificationInput {
  userId: string;
  type: string;
  category: Category;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Notification service. Always writes the in-app history row. Push is attempted only when the user enabled
 * it and has a token. Email and SMS have no provider yet and are recorded as `not_configured`, never "sent".
 */
export class Notifier {
  constructor(private push: PushSender | null, private log: Logger) {}

  async notify(q: Queryable, n: NotificationInput) {
    const prof = await q.query<{ notification_prefs: any; push_token: string | null }>(
      'select notification_prefs, push_token from profiles where id = $1',
      [n.userId],
    );
    const prefs = prof.rows[0]?.notification_prefs ?? {};
    if (prefs[n.category] === false) return null;
    const delivery: Record<string, string> = { email: 'not_configured', sms: 'not_configured', push: 'skipped' };
    let status: 'recorded' | 'sent' | 'failed' = 'recorded';
    const token = prof.rows[0]?.push_token;
    if (prefs.push && token && this.push) {
      try {
        const ok = await this.push.send(token, n.title, n.body, { ...n.data, type: n.type });
        delivery.push = ok ? 'sent' : 'failed';
        status = ok ? 'sent' : 'failed';
      } catch (e) {
        this.log.warn({ err: e }, 'push send failed');
        delivery.push = 'failed';
        status = 'failed';
      }
    } else if (prefs.push && !token) {
      delivery.push = 'no_device_token';
    }
    const r = await q.query<{ id: string }>(
      `insert into notifications (user_id, type, title, body, data, channel, provider_status)
       values ($1,$2,$3,$4,$5,'in_app',$6) returning id`,
      [n.userId, n.type, n.title, n.body, JSON.stringify({ ...(n.data ?? {}), delivery }), status === 'failed' ? 'recorded' : status],
    );
    return r.rows[0].id;
  }
}
