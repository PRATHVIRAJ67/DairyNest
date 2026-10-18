import type { AddressInput } from '@milk/validation';
import { camel, type Db, type Queryable } from '../db';
import { conflict, notFound, unprocessable } from '../errors';

const COLS = `id, label, recipient_name, phone, line1, line2, landmark, city, postal_code, delivery_instructions,
  is_default, zone_id, created_at`;

export async function listAddresses(db: Queryable, userId: string) {
  const r = await db.query(`select ${COLS} from addresses where user_id = $1 and deleted_at is null order by is_default desc, created_at`, [userId]);
  return camel(r.rows);
}

async function zoneFor(q: Queryable, postalCode: string): Promise<string | null> {
  const r = await q.query<{ id: string }>(`select id from delivery_zones where is_active and $1 = any(postal_codes) limit 1`, [postalCode]);
  return r.rows[0]?.id ?? null;
}

export async function createAddress(db: Db, userId: string, a: AddressInput) {
  return db.tx(async (q) => {
    const zoneId = await zoneFor(q, a.postalCode);
    const count = (await q.query<{ c: number }>(`select count(*)::int c from addresses where user_id=$1 and deleted_at is null`, [userId])).rows[0].c;
    if (count >= 10) throw unprocessable('You can save up to 10 addresses', 'ADDRESS_LIMIT');
    const makeDefault = a.isDefault || count === 0;
    if (makeDefault) await q.query(`update addresses set is_default=false where user_id=$1 and is_default`, [userId]);
    const r = await q.query(
      `insert into addresses (user_id,label,recipient_name,phone,line1,line2,landmark,city,postal_code,delivery_instructions,is_default,zone_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning ${COLS}`,
      [userId, a.label, a.recipientName, a.phone, a.line1, a.line2, a.landmark, a.city, a.postalCode, a.deliveryInstructions, makeDefault, zoneId],
    );
    return camel(r.rows[0]);
  });
}

const FIELD_MAP: Record<string, string> = {
  label: 'label', recipientName: 'recipient_name', phone: 'phone', line1: 'line1', line2: 'line2',
  landmark: 'landmark', city: 'city', postalCode: 'postal_code', deliveryInstructions: 'delivery_instructions',
};

export async function updateAddress(db: Db, userId: string, id: string, patch: Partial<AddressInput>) {
  return db.tx(async (q) => {
    const cur = await q.query(`select id from addresses where id=$1 and user_id=$2 and deleted_at is null for update`, [id, userId]);
    if (!cur.rows[0]) throw notFound('Address');
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(FIELD_MAP)) {
      if ((patch as any)[k] !== undefined) { params.push((patch as any)[k]); sets.push(`${col} = $${params.length}`); }
    }
    if (patch.postalCode) { params.push(await zoneFor(q, patch.postalCode)); sets.push(`zone_id = $${params.length}`); }
    if (patch.isDefault === true) {
      await q.query(`update addresses set is_default=false where user_id=$1 and is_default`, [userId]);
      sets.push('is_default = true');
    }
    if (sets.length === 0) return camel((await q.query(`select ${COLS} from addresses where id=$1`, [id])).rows[0]);
    params.push(id, userId);
    const r = await q.query(`update addresses set ${sets.join(', ')} where id=$${params.length - 1} and user_id=$${params.length} returning ${COLS}`, params);
    return camel(r.rows[0]);
  });
}

export async function deleteAddress(db: Db, userId: string, id: string) {
  return db.tx(async (q) => {
    const cur = await q.query<{ is_default: boolean }>(`select is_default from addresses where id=$1 and user_id=$2 and deleted_at is null for update`, [id, userId]);
    if (!cur.rows[0]) throw notFound('Address');
    const inUse = await q.query(`select 1 from subscriptions where address_id=$1 and status <> 'cancelled' limit 1`, [id]);
    if (inUse.rows[0]) throw conflict('This address is used by an active subscription. Change the subscription address first.', 'ADDRESS_IN_USE');
    await q.query(`update addresses set deleted_at=now(), is_default=false where id=$1`, [id]);
    if (cur.rows[0].is_default) {
      await q.query(
        `update addresses set is_default=true where id = (select id from addresses where user_id=$1 and deleted_at is null order by created_at limit 1)`,
        [userId],
      );
    }
  });
}
