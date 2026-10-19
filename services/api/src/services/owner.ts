/**
 * Owner (admin) management: areas, suppliers and the product catalogue. Everything is data, nothing is hard-coded:
 * a new area or product is visible to customers as soon as it is saved.
 */
import { camel, type Queryable } from '../db';
import type { Deps } from '../deps';
import { badRequest, conflict, notFound } from '../errors';
import { testUserId } from '../testing';
import { audit } from './subscriptions';

// ---------------------------------------------------------------- areas (delivery zones)

export interface ZoneInput {
  name: string; postalCodes: string[]; windowStart: string; windowEnd: string; cutoffTime: string; isActive: boolean;
}

export async function listZones(db: Queryable) {
  const r = await db.query(
    `select z.id, z.name, z.postal_codes, to_char(z.window_start,'HH24:MI') window_start, to_char(z.window_end,'HH24:MI') window_end,
            to_char(z.cutoff_time,'HH24:MI') cutoff_time, z.is_active, z.created_at,
            (select count(*)::int from subscriptions s join addresses a on a.id = s.address_id where a.zone_id = z.id and s.status in ('active','paused')) active_subscriptions,
            (select count(distinct a.user_id)::int from addresses a where a.zone_id = z.id and a.deleted_at is null) customers,
            coalesce((select json_agg(json_build_object('id', p.id, 'name', p.full_name, 'phone', p.phone) order by p.full_name)
              from supplier_zones sz join profiles p on p.id = sz.supplier_id where sz.zone_id = z.id and p.role = 'supplier'), '[]') suppliers
     from delivery_zones z order by z.is_active desc, z.name`,
  );
  return camel(r.rows);
}

async function assertPinsFree(q: Queryable, pins: string[], exceptZoneId: string | null) {
  const r = await q.query<{ name: string; pin: string }>(
    `select z.name, p pin from delivery_zones z, unnest(z.postal_codes) p
     where z.is_active and p = any($1::text[]) and ($2::uuid is null or z.id <> $2)`,
    [pins, exceptZoneId],
  );
  if (r.rows[0]) throw conflict(`PIN ${r.rows[0].pin} already belongs to "${r.rows[0].name}"`, 'PIN_IN_USE', { pin: r.rows[0].pin, zone: r.rows[0].name });
}

/** Re-link saved customer addresses after an area's PIN codes change. */
async function relinkAddresses(q: Queryable, zoneId: string, pins: string[], active: boolean) {
  if (active) {
    await q.query(`update addresses set zone_id = $1 where deleted_at is null and postal_code = any($2::text[]) and zone_id is distinct from $1`, [zoneId, pins]);
  }
  await q.query(
    `update addresses a set zone_id = (select z.id from delivery_zones z where z.is_active and a.postal_code = any(z.postal_codes) limit 1)
     where a.zone_id = $1 and a.deleted_at is null and not (a.postal_code = any($2::text[]))`,
    [zoneId, active ? pins : []],
  );
}

const uniqPins = (pins: string[]) => [...new Set(pins.map((p) => p.trim()))].sort();

export async function createZone(deps: Deps, actorId: string, z: ZoneInput) {
  return deps.db.tx(async (q) => {
    const pins = uniqPins(z.postalCodes);
    if (z.isActive) await assertPinsFree(q, pins, null);
    const r = await q.query<{ id: string }>(
      `insert into delivery_zones (name, postal_codes, window_start, window_end, cutoff_time, is_active) values ($1,$2,$3,$4,$5,$6) returning id`,
      [z.name.trim(), pins, z.windowStart, z.windowEnd, z.cutoffTime, z.isActive],
    );
    await relinkAddresses(q, r.rows[0].id, pins, z.isActive);
    await audit(q, actorId, 'zone.created', 'zone', r.rows[0].id, { name: z.name, pins });
    return r.rows[0].id;
  });
}

export async function updateZone(deps: Deps, actorId: string, id: string, z: Partial<ZoneInput>) {
  return deps.db.tx(async (q) => {
    const cur = (await q.query<any>(`select name, postal_codes, to_char(window_start,'HH24:MI') ws, to_char(window_end,'HH24:MI') we,
      to_char(cutoff_time,'HH24:MI') ct, is_active from delivery_zones where id=$1 for update`, [id])).rows[0];
    if (!cur) throw notFound('Area');
    const next = {
      name: z.name?.trim() ?? cur.name, pins: z.postalCodes ? uniqPins(z.postalCodes) : cur.postal_codes as string[],
      ws: z.windowStart ?? cur.ws, we: z.windowEnd ?? cur.we, ct: z.cutoffTime ?? cur.ct, active: z.isActive ?? cur.is_active,
    };
    if (next.we <= next.ws) throw badRequest('The delivery window must end after it starts', 'INVALID_WINDOW');
    if (next.active) await assertPinsFree(q, next.pins, id);
    await q.query(`update delivery_zones set name=$2, postal_codes=$3, window_start=$4, window_end=$5, cutoff_time=$6, is_active=$7 where id=$1`,
      [id, next.name, next.pins, next.ws, next.we, next.ct, next.active]);
    await relinkAddresses(q, id, next.pins, next.active);
    await audit(q, actorId, 'zone.updated', 'zone', id, { ...z });
    return id;
  });
}

// ---------------------------------------------------------------- suppliers

export async function listSuppliers(db: Queryable) {
  const r = await db.query(
    `select p.id, p.full_name, p.phone, p.created_at,
            coalesce((select json_agg(json_build_object('id', z.id, 'name', z.name) order by z.name)
              from supplier_zones sz join delivery_zones z on z.id = sz.zone_id where sz.supplier_id = p.id), '[]') zones
     from profiles p where p.role = 'supplier' and p.deleted_at is null order by p.full_name`,
  );
  return camel(r.rows);
}

async function setSupplierZones(q: Queryable, supplierId: string, zoneIds: string[]) {
  if (zoneIds.length) {
    const found = (await q.query<{ n: number }>(`select count(*)::int n from delivery_zones where id = any($1::uuid[])`, [zoneIds])).rows[0].n;
    if (found !== new Set(zoneIds).size) throw badRequest('One of the selected areas does not exist', 'UNKNOWN_ZONE');
  }
  await q.query(`delete from supplier_zones where supplier_id = $1`, [supplierId]);
  for (const z of new Set(zoneIds)) await q.query(`insert into supplier_zones (supplier_id, zone_id) values ($1,$2)`, [supplierId, z]);
}

/**
 * Adds a supplier by phone number. If the person already signed in (any role), that account is promoted;
 * otherwise an account is created that becomes theirs when they first sign in with that number.
 */
export async function createSupplier(deps: Deps, actorId: string, s: { phone: string; fullName: string; zoneIds: string[] }) {
  return deps.db.tx(async (q) => {
    const bare = s.phone.replace(/^\+/, '');
    let id = (await q.query<{ id: string }>(`select id from auth.users where phone in ($1, $2) limit 1`, [bare, s.phone])).rows[0]?.id;
    if (!id) {
      id = testUserId(s.phone);
      await q.query(
        `insert into auth.users (id, phone, aud, role, created_at, updated_at, phone_confirmed_at)
         values ($1, $2, 'authenticated', 'authenticated', now(), now(), now()) on conflict (id) do nothing`,
        [id, bare],
      );
    }
    const p = (await q.query<{ role: string; deleted_at: Date | null }>(`select role, deleted_at from profiles where id=$1`, [id])).rows[0];
    if (p?.deleted_at) throw conflict('This phone number belongs to a deleted account', 'ACCOUNT_DELETED');
    if (p?.role === 'admin') throw conflict('This phone number belongs to an owner account', 'IS_OWNER');
    await q.query(
      `insert into profiles (id, phone, full_name, role, profile_completed) values ($1,$2,$3,'supplier',true)
       on conflict (id) do update set role='supplier', full_name=excluded.full_name, phone=excluded.phone, profile_completed=true`,
      [id, s.phone, s.fullName.trim()],
    );
    await setSupplierZones(q, id, s.zoneIds);
    await audit(q, actorId, 'supplier.created', 'profile', id, { zones: s.zoneIds });
    return id;
  });
}

export async function updateSupplier(deps: Deps, actorId: string, id: string, s: { fullName?: string; zoneIds?: string[]; active?: boolean }) {
  return deps.db.tx(async (q) => {
    const p = (await q.query<{ role: string }>(`select role from profiles where id=$1 and deleted_at is null for update`, [id])).rows[0];
    if (!p || p.role !== 'supplier') throw notFound('Supplier'); // re-adding a removed supplier goes through createSupplier
    if (s.active === false) {
      await q.query(`update profiles set role='customer' where id=$1`, [id]);
      await q.query(`delete from supplier_zones where supplier_id=$1`, [id]);
      await audit(q, actorId, 'supplier.removed', 'profile', id);
      return id;
    }
    if (s.fullName) await q.query(`update profiles set full_name=$2 where id=$1`, [id, s.fullName.trim()]);
    if (s.zoneIds) await setSupplierZones(q, id, s.zoneIds);
    await audit(q, actorId, 'supplier.updated', 'profile', id, { ...s });
    return id;
  });
}

// ---------------------------------------------------------------- catalogue

export interface VariantInput {
  sku?: string; name: string; sizeLabel: string; priceMinor: number; mrpMinor: number; isAvailable: boolean; sortOrder?: number;
}
export interface ProductInput {
  name: string; description: string; category: string; imageUrl?: string | null; isActive: boolean; isFeatured: boolean; sortOrder?: number;
  variants?: VariantInput[];
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'product';

async function uniqueSlug(q: Queryable, base: string, exceptId?: string) {
  let slug = slugify(base);
  for (let i = 2; ; i++) {
    const taken = (await q.query(`select 1 from products where slug=$1 and ($2::uuid is null or id <> $2)`, [slug, exceptId ?? null])).rows[0];
    if (!taken) return slug;
    slug = `${slugify(base)}-${i}`;
  }
}

async function insertVariant(q: Queryable, productId: string, productName: string, v: VariantInput) {
  if (v.mrpMinor < v.priceMinor) throw badRequest('MRP cannot be lower than the selling price', 'MRP_BELOW_PRICE');
  const sku = (v.sku?.trim() || `${slugify(productName)}-${slugify(v.sizeLabel)}`).toUpperCase().slice(0, 40);
  try {
    await q.query(
      `insert into product_variants (product_id, sku, name, size_label, price_minor, mrp_minor, is_available, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [productId, sku, v.name.trim(), v.sizeLabel.trim(), v.priceMinor, v.mrpMinor, v.isAvailable, v.sortOrder ?? 0],
    );
  } catch (e: any) {
    if (e?.code === '23505') throw conflict(`The code ${sku} is already used by another size`, 'SKU_IN_USE');
    throw e;
  }
}

export async function listAllProducts(db: Queryable) {
  const r = await db.query(
    `select p.id, p.slug, p.name, p.description, p.category, p.image_url, p.is_active, p.is_featured, p.sort_order,
       coalesce((select json_agg(json_build_object('id', v.id, 'sku', v.sku, 'name', v.name, 'sizeLabel', v.size_label,
          'priceMinor', v.price_minor, 'mrpMinor', v.mrp_minor, 'isAvailable', v.is_available, 'sortOrder', v.sort_order) order by v.sort_order, v.price_minor)
          from product_variants v where v.product_id = p.id), '[]') variants
     from products p order by p.category, p.sort_order, p.name`,
  );
  return camel(r.rows);
}

export async function createProduct(deps: Deps, actorId: string, p: ProductInput) {
  return deps.db.tx(async (q) => {
    const slug = await uniqueSlug(q, p.name);
    const r = await q.query<{ id: string }>(
      `insert into products (slug, name, description, category, image_url, is_active, is_featured, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [slug, p.name.trim(), p.description.trim(), p.category, p.imageUrl || null, p.isActive, p.isFeatured, p.sortOrder ?? 0],
    );
    for (const v of p.variants ?? []) await insertVariant(q, r.rows[0].id, p.name, v);
    await audit(q, actorId, 'product.created', 'product', r.rows[0].id, { name: p.name });
    return r.rows[0].id;
  });
}

export async function updateProduct(deps: Deps, actorId: string, id: string, p: Partial<Omit<ProductInput, 'variants'>>) {
  return deps.db.tx(async (q) => {
    const cur = (await q.query<any>(`select * from products where id=$1 for update`, [id])).rows[0];
    if (!cur) throw notFound('Product');
    await q.query(
      `update products set name=$2, description=$3, category=$4, image_url=$5, is_active=$6, is_featured=$7, sort_order=$8 where id=$1`,
      [id, p.name?.trim() ?? cur.name, p.description?.trim() ?? cur.description, p.category ?? cur.category,
        p.imageUrl === undefined ? cur.image_url : p.imageUrl || null, p.isActive ?? cur.is_active, p.isFeatured ?? cur.is_featured, p.sortOrder ?? cur.sort_order],
    );
    await audit(q, actorId, 'product.updated', 'product', id, { ...p });
    return id;
  });
}

export async function addVariant(deps: Deps, actorId: string, productId: string, v: VariantInput) {
  return deps.db.tx(async (q) => {
    const p = (await q.query<{ name: string }>(`select name from products where id=$1`, [productId])).rows[0];
    if (!p) throw notFound('Product');
    await insertVariant(q, productId, p.name, v);
    await audit(q, actorId, 'variant.created', 'product', productId, { size: v.sizeLabel, priceMinor: v.priceMinor });
    return productId;
  });
}

/** Price changes apply to new subscriptions and renewals; existing prepaid deliveries keep the price that was paid. */
export async function updateVariant(deps: Deps, actorId: string, id: string, v: Partial<VariantInput>) {
  return deps.db.tx(async (q) => {
    const cur = (await q.query<any>(`select * from product_variants where id=$1 for update`, [id])).rows[0];
    if (!cur) throw notFound('Size');
    const price = v.priceMinor ?? cur.price_minor;
    const mrp = v.mrpMinor ?? cur.mrp_minor;
    if (mrp < price) throw badRequest('MRP cannot be lower than the selling price', 'MRP_BELOW_PRICE');
    await q.query(
      `update product_variants set name=$2, size_label=$3, price_minor=$4, mrp_minor=$5, is_available=$6, sort_order=$7 where id=$1`,
      [id, v.name?.trim() ?? cur.name, v.sizeLabel?.trim() ?? cur.size_label, price, mrp, v.isAvailable ?? cur.is_available, v.sortOrder ?? cur.sort_order],
    );
    await audit(q, actorId, 'variant.updated', 'product', cur.product_id, { variantId: id, ...v });
    return id;
  });
}

export async function listCategories(db: Queryable) {
  const r = await db.query(`select category, count(*)::int products from products where is_active group by category order by min(sort_order), category`);
  return camel(r.rows);
}
