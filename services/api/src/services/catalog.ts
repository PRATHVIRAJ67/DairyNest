import { camel, type Queryable } from '../db';
import { notFound } from '../errors';

const PRODUCT_COLS = `p.id, p.slug, p.name, p.description, p.category, p.image_url, p.is_featured, p.sort_order`;

export async function listProducts(
  db: Queryable,
  f: { category?: string; featured?: string; q?: string; page: number; pageSize: number },
) {
  const where: string[] = ['p.is_active'];
  const params: unknown[] = [];
  if (f.category) { params.push(f.category); where.push(`p.category = $${params.length}`); }
  if (f.featured) { params.push(f.featured === 'true'); where.push(`p.is_featured = $${params.length}`); }
  if (f.q) { params.push(`%${f.q.replace(/[%_]/g, '')}%`); where.push(`(p.name ilike $${params.length} or p.description ilike $${params.length})`); }
  const w = where.join(' and ');
  const total = (await db.query<{ c: number }>(`select count(*)::int c from products p where ${w}`, params)).rows[0].c;
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const rows = await db.query(
    `select ${PRODUCT_COLS},
       coalesce((select json_agg(json_build_object('id', v.id, 'sku', v.sku, 'name', v.name, 'sizeLabel', v.size_label,
          'priceMinor', v.price_minor, 'mrpMinor', v.mrp_minor, 'isAvailable', v.is_available) order by v.sort_order)
          from product_variants v where v.product_id = p.id), '[]') as variants
     from products p where ${w} order by p.sort_order, p.name limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: camel(rows.rows), total };
}

export async function getProduct(db: Queryable, idOrSlug: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const r = await db.query(
    `select ${PRODUCT_COLS},
       coalesce((select json_agg(json_build_object('id', v.id, 'sku', v.sku, 'name', v.name, 'sizeLabel', v.size_label,
          'priceMinor', v.price_minor, 'mrpMinor', v.mrp_minor, 'isAvailable', v.is_available) order by v.sort_order)
          from product_variants v where v.product_id = p.id), '[]') as variants
     from products p where p.is_active and ${isUuid ? 'p.id = $1' : 'p.slug = $1'}`,
    [idOrSlug],
  );
  if (!r.rows[0]) throw notFound('Product');
  return camel(r.rows[0]);
}

export async function listPlans(db: Queryable) {
  const r = await db.query(`select id, code, name, description, frequency, discount_bps from subscription_plans where is_active order by code`);
  return camel(r.rows);
}

export async function serviceability(db: Queryable, postalCode: string) {
  const r = await db.query(
    `select id, name, to_char(window_start,'HH24:MI') window_start, to_char(window_end,'HH24:MI') window_end,
            to_char(cutoff_time,'HH24:MI') cutoff_time, timezone
     from delivery_zones where is_active and $1 = any(postal_codes) limit 1`,
    [postalCode],
  );
  const z = r.rows[0];
  return z ? { serviceable: true, zone: camel(z) } : { serviceable: false, zone: null };
}
