import { Router } from 'express';
import { z } from 'zod';
import {
  addressInput, addressUpdate, calendarQuery, couponValidateInput, createSubscriptionInput, deleteAccountInput,
  notificationPrefsInput, paginationQuery, pauseInput, productsQuery, profileUpdate, pushTokenInput, quoteInput,
  serviceabilityQuery, skipInput, supportTicketInput, updateAddressInput, updateFrequencyInput, updateItemsInput,
  uuid, verifyPaymentInput,
} from '@milk/validation';
import { authenticate, requireRole } from './auth';
import type { Deps } from './deps';
import { forbidden, notFound } from './errors';
import { asyncHandler, ok, validate } from './http';
import * as account from './services/account';
import * as addresses from './services/addresses';
import * as catalog from './services/catalog';
import * as deliveries from './services/deliveries';
import * as payments from './services/payments';
import * as owner from './services/owner';
import * as subs from './services/subscriptions';
import * as supplier from './services/supplier';
import { buildTestRouter } from './testing';

const idParam = z.object({ id: uuid });
const pageQuery = paginationQuery;

export function buildRouter(deps: Deps): Router {
  const r = Router();
  const auth = authenticate(deps.verifier, deps.db);
  const uid = (req: any) => req.auth!.userId as string;

  // Testing-only routes (test login, simulated payments). Mounted only when configured.
  r.use(buildTestRouter(deps));

  // ---------------- public
  r.get('/health', asyncHandler(async (_req, res) => {
    await deps.db.query('select 1');
    ok(res, { status: 'ok', paymentsConfigured: deps.payments.isConfigured(), time: deps.now().toISOString() });
  }));
  r.get('/products', validate(productsQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await catalog.listProducts(deps.db, q);
    ok(res, items, { page: q.page, pageSize: q.pageSize, total });
  }));
  r.get('/products/:idOrSlug', asyncHandler(async (req, res) => ok(res, await catalog.getProduct(deps.db, req.params.idOrSlug))));
  r.get('/plans', asyncHandler(async (_req, res) => ok(res, await catalog.listPlans(deps.db))));
  r.get('/categories', asyncHandler(async (_req, res) => ok(res, await owner.listCategories(deps.db))));
  r.get('/serviceability', validate(serviceabilityQuery, 'query'), asyncHandler(async (req, res) =>
    ok(res, await catalog.serviceability(deps.db, (req.query as any).postalCode))));
  r.get('/support/faqs', (_req, res) => ok(res, account.FAQS));

  // Razorpay webhook: raw body is captured by the JSON parser's verify hook in app.ts.
  r.post('/webhooks/razorpay', asyncHandler(async (req, res) => {
    const out = await payments.handleWebhook(
      deps, req.rawBody ?? Buffer.from(''), req.header('x-razorpay-signature'), req.header('x-razorpay-event-id') ?? undefined,
    );
    ok(res, out);
  }));

  // ---------------- authenticated
  r.use(auth);

  r.get('/me', asyncHandler(async (req, res) => ok(res, await account.getMe(deps, uid(req)))));
  r.put('/me', validate(profileUpdate), asyncHandler(async (req, res) => ok(res, await account.updateMe(deps, uid(req), req.body))));
  r.put('/me/notification-preferences', validate(notificationPrefsInput), asyncHandler(async (req, res) =>
    ok(res, await account.updatePrefs(deps, uid(req), req.body))));
  r.put('/me/push-token', validate(pushTokenInput), asyncHandler(async (req, res) => {
    await account.setPushToken(deps, uid(req), req.body.token);
    ok(res, { saved: true });
  }));
  r.delete('/me/push-token', asyncHandler(async (req, res) => { await account.setPushToken(deps, uid(req), null); ok(res, { removed: true }); }));
  r.post('/me/delete', validate(deleteAccountInput), asyncHandler(async (req, res) => ok(res, await account.deleteAccount(deps, uid(req)))));

  // addresses
  r.get('/addresses', asyncHandler(async (req, res) => ok(res, await addresses.listAddresses(deps.db, uid(req)))));
  r.post('/addresses', validate(addressInput), asyncHandler(async (req, res) => ok(res, await addresses.createAddress(deps.db, uid(req), req.body), undefined, 201)));
  r.patch('/addresses/:id', validate(idParam, 'params'), validate(addressUpdate), asyncHandler(async (req, res) =>
    ok(res, await addresses.updateAddress(deps.db, uid(req), req.params.id, req.body))));
  r.post('/addresses/:id/default', validate(idParam, 'params'), asyncHandler(async (req, res) =>
    ok(res, await addresses.updateAddress(deps.db, uid(req), req.params.id, { isDefault: true }))));
  r.delete('/addresses/:id', validate(idParam, 'params'), asyncHandler(async (req, res) => {
    await addresses.deleteAddress(deps.db, uid(req), req.params.id);
    res.status(204).end();
  }));

  // coupons
  r.post('/coupons/validate', validate(couponValidateInput), asyncHandler(async (req, res) =>
    ok(res, await subs.validateCoupon(deps, uid(req), req.body.code, req.body.subtotalMinor))));

  // subscriptions
  r.post('/subscriptions/quote', validate(quoteInput), asyncHandler(async (req, res) => ok(res, await subs.quoteSubscription(deps, uid(req), req.body))));
  r.post('/subscriptions', validate(createSubscriptionInput), asyncHandler(async (req, res) => {
    const out = await subs.createSubscription(deps, uid(req), req.body);
    ok(res, out, undefined, out.replay ? 200 : 201);
  }));
  r.get('/subscriptions', asyncHandler(async (req, res) => ok(res, await subs.listSubscriptions(deps, uid(req), (req.query.status as string) || undefined))));
  const sid = validate(idParam, 'params');
  r.get('/subscriptions/:id', sid, asyncHandler(async (req, res) => ok(res, await subs.getSubscription(deps, uid(req), req.params.id))));
  r.get('/subscriptions/:id/history', sid, asyncHandler(async (req, res) => ok(res, await subs.subscriptionHistory(deps, uid(req), req.params.id))));
  r.post('/subscriptions/:id/checkout', sid, asyncHandler(async (req, res) => ok(res, await subs.getCheckout(deps, uid(req), req.params.id))));
  r.post('/subscriptions/:id/renew', sid, asyncHandler(async (req, res) => ok(res, await subs.createRenewal(deps, uid(req), req.params.id))));
  r.post('/subscriptions/:id/pause', sid, validate(pauseInput), asyncHandler(async (req, res) => ok(res, await subs.pauseSubscription(deps, uid(req), req.params.id, req.body))));
  r.post('/subscriptions/:id/resume', sid, asyncHandler(async (req, res) => ok(res, await subs.resumeSubscription(deps, uid(req), req.params.id))));
  r.post('/subscriptions/:id/skip', sid, validate(skipInput), asyncHandler(async (req, res) => ok(res, await subs.skipDelivery(deps, uid(req), req.params.id, req.body.date))));
  r.post('/subscriptions/:id/unskip', sid, validate(skipInput), asyncHandler(async (req, res) => ok(res, await subs.unskipDelivery(deps, uid(req), req.params.id, req.body.date))));
  r.patch('/subscriptions/:id/items', sid, validate(updateItemsInput), asyncHandler(async (req, res) => ok(res, await subs.updateItems(deps, uid(req), req.params.id, req.body.items))));
  r.patch('/subscriptions/:id/schedule', sid, validate(updateFrequencyInput), asyncHandler(async (req, res) => ok(res, await subs.updateSchedule(deps, uid(req), req.params.id, req.body))));
  r.patch('/subscriptions/:id/address', sid, validate(updateAddressInput), asyncHandler(async (req, res) => ok(res, await subs.updateAddress(deps, uid(req), req.params.id, req.body.addressId))));
  r.post('/subscriptions/:id/cancel', sid, validate(z.object({ reason: z.string().trim().max(300).optional() })), asyncHandler(async (req, res) =>
    ok(res, await subs.cancelSubscription(deps, uid(req), req.params.id, req.body.reason))));
  r.post('/subscriptions/:id/deliveries/generate', sid, validate(z.object({ days: z.number().int().min(1).max(45).optional() })), asyncHandler(async (req, res) =>
    ok(res, await subs.generateForUser(deps, uid(req), req.params.id, req.body.days))));

  // deliveries
  r.get('/deliveries', validate(calendarQuery, 'query'), asyncHandler(async (req, res) => ok(res, await deliveries.listDeliveries(deps, uid(req), req.query as any))));
  r.get('/deliveries/upcoming', asyncHandler(async (req, res) => ok(res, await deliveries.upcoming(deps, uid(req)))));
  r.get('/deliveries/:id', sid, asyncHandler(async (req, res) => ok(res, await deliveries.getDelivery(deps, uid(req), req.params.id))));

  // payments
  r.post('/payments/verify', validate(verifyPaymentInput), asyncHandler(async (req, res) => ok(res, await payments.verifyCheckout(deps, uid(req), req.body))));
  r.post('/payments/orders/:id/reconcile', sid, asyncHandler(async (req, res) => ok(res, await payments.reconcileOrder(deps, uid(req), req.params.id))));
  r.get('/payments', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await payments.listPayments(deps, uid(req), q.page, q.pageSize);
    ok(res, items, { page: q.page, pageSize: q.pageSize, total });
  }));
  r.get('/invoices', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total } = await payments.listInvoices(deps, uid(req), q.page, q.pageSize);
    ok(res, items, { page: q.page, pageSize: q.pageSize, total });
  }));
  r.get('/invoices/:id', sid, asyncHandler(async (req, res) => ok(res, await payments.getInvoice(deps, uid(req), req.params.id))));
  r.get('/invoices/:id/receipt', sid, asyncHandler(async (req, res) => {
    const inv = await payments.getInvoice(deps, uid(req), req.params.id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNumber}.html"`);
    res.send(payments.renderReceiptHtml(inv));
  }));

  // notifications
  r.get('/notifications', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query as any;
    const { items, total, unread } = await account.listNotifications(deps, uid(req), q.page, q.pageSize);
    ok(res, items, { page: q.page, pageSize: q.pageSize, total, unread });
  }));
  r.post('/notifications/read-all', asyncHandler(async (req, res) => { await account.markAllRead(deps, uid(req)); ok(res, { done: true }); }));
  r.post('/notifications/:id/read', sid, asyncHandler(async (req, res) => { await account.markRead(deps, uid(req), req.params.id); ok(res, { done: true }); }));

  // support
  r.get('/support/tickets', asyncHandler(async (req, res) => ok(res, await account.listTickets(deps, uid(req)))));
  r.post('/support/tickets', validate(supportTicketInput), asyncHandler(async (req, res) => ok(res, await account.createTicket(deps, uid(req), req.body), undefined, 201)));

  // ---------------- operations (admin role; used by the owner dashboard)
  const admin = Router();
  admin.use(requireRole('admin'));
  admin.patch('/deliveries/:id/status', sid, validate(z.object({
    status: z.enum(['pending', 'out_for_delivery', 'delivered', 'failed', 'cancelled']), reason: z.string().max(300).optional(),
  })), asyncHandler(async (req, res) => ok(res, await deliveries.setDeliveryStatus(deps, uid(req), req.params.id, req.body.status, req.body.reason))));
  admin.post('/payments/:id/refund', sid, validate(z.object({ amountMinor: z.number().int().positive().optional() })), asyncHandler(async (req, res) =>
    ok(res, await payments.refundPayment(deps, uid(req), req.params.id, req.body.amountMinor))));
  // ---------------- owner management (admin role): areas, suppliers, catalogue
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
  const pin = z.string().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code');
  const zoneBody = z.object({
    name: z.string().trim().min(2).max(60), postalCodes: z.array(pin).min(1).max(200),
    windowStart: hhmm, windowEnd: hhmm, cutoffTime: hhmm, isActive: z.boolean().default(true),
  });
  const variantBody = z.object({
    sku: z.string().trim().max(40).optional(), name: z.string().trim().min(1).max(60), sizeLabel: z.string().trim().min(1).max(30),
    priceMinor: z.number().int().min(0).max(10_000_000), mrpMinor: z.number().int().min(0).max(10_000_000),
    isAvailable: z.boolean().default(true), sortOrder: z.number().int().min(0).max(9999).optional(),
  });
  const productBody = z.object({
    name: z.string().trim().min(2).max(80), description: z.string().trim().max(600).default(''),
    category: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,29}$/, 'Use a short lowercase word, e.g. ghee'),
    imageUrl: z.string().url().max(500).nullable().optional().or(z.literal('')),
    isActive: z.boolean().default(true), isFeatured: z.boolean().default(false), sortOrder: z.number().int().min(0).max(9999).optional(),
    variants: z.array(variantBody).max(20).optional(),
  });
  const supplierBody = z.object({ phone: z.string().regex(/^\+91[6-9][0-9]{9}$/, 'Use +91 followed by a 10-digit number'), fullName: z.string().trim().min(2).max(80), zoneIds: z.array(uuid).max(50) });

  admin.get('/zones', asyncHandler(async (_req, res) => ok(res, await owner.listZones(deps.db))));
  admin.post('/zones', validate(zoneBody), asyncHandler(async (req, res) => ok(res, { id: await owner.createZone(deps, uid(req), req.body) }, undefined, 201)));
  admin.patch('/zones/:id', sid, validate(zoneBody.partial()), asyncHandler(async (req, res) => ok(res, { id: await owner.updateZone(deps, uid(req), req.params.id, req.body) })));
  admin.get('/suppliers', asyncHandler(async (_req, res) => ok(res, await owner.listSuppliers(deps.db))));
  admin.post('/suppliers', validate(supplierBody), asyncHandler(async (req, res) => ok(res, { id: await owner.createSupplier(deps, uid(req), req.body) }, undefined, 201)));
  admin.patch('/suppliers/:id', sid, validate(z.object({ fullName: z.string().trim().min(2).max(80).optional(), zoneIds: z.array(uuid).max(50).optional(), active: z.boolean().optional() })),
    asyncHandler(async (req, res) => ok(res, { id: await owner.updateSupplier(deps, uid(req), req.params.id, req.body) })));
  admin.get('/products', asyncHandler(async (_req, res) => ok(res, await owner.listAllProducts(deps.db))));
  admin.post('/products', validate(productBody), asyncHandler(async (req, res) => ok(res, { id: await owner.createProduct(deps, uid(req), req.body) }, undefined, 201)));
  admin.patch('/products/:id', sid, validate(productBody.omit({ variants: true }).partial()), asyncHandler(async (req, res) => ok(res, { id: await owner.updateProduct(deps, uid(req), req.params.id, req.body) })));
  admin.post('/products/:id/variants', sid, validate(variantBody), asyncHandler(async (req, res) => ok(res, { id: await owner.addVariant(deps, uid(req), req.params.id, req.body) }, undefined, 201)));
  admin.patch('/variants/:id', sid, validate(variantBody.partial()), asyncHandler(async (req, res) => ok(res, { id: await owner.updateVariant(deps, uid(req), req.params.id, req.body) })));
  r.use('/admin', admin);

  // ---------------- supplier operations (supplier role; owners can act on every area)
  const sup = Router();
  sup.use(requireRole('supplier', 'admin'));
  const actor = (req: any): supplier.Actor => ({ userId: req.auth.userId, role: req.auth.role });
  const zoneQ = z.object({ zoneId: uuid.optional() });
  const dateQ = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), zoneId: uuid.optional() });
  sup.get('/zones', asyncHandler(async (req, res) => ok(res, await supplier.myZones(deps, actor(req)))));
  sup.get('/day', validate(dateQ, 'query'), asyncHandler(async (req, res) => ok(res, await supplier.day(deps, actor(req), req.query.date as string, req.query.zoneId as string | undefined))));
  sup.patch('/deliveries/:id/status', sid, validate(z.object({ status: z.enum(['out_for_delivery', 'delivered', 'failed']), reason: z.string().trim().max(300).optional() })),
    asyncHandler(async (req, res) => ok(res, await supplier.setStatus(deps, actor(req), req.params.id, req.body.status, req.body.reason))));
  sup.post('/deliveries/bulk-status', validate(z.object({ ids: z.array(uuid).min(1).max(500), status: z.enum(['out_for_delivery', 'delivered']) })),
    asyncHandler(async (req, res) => ok(res, await supplier.setStatusBulk(deps, actor(req), req.body.ids, req.body.status))));
  sup.get('/customers', validate(zoneQ.extend({ status: z.enum(['active', 'paused', 'pending_payment', 'past_due', 'cancelled']).optional(), q: z.string().trim().max(60).optional() }), 'query'),
    asyncHandler(async (req, res) => ok(res, await supplier.customers(deps, actor(req), req.query as any))));
  sup.get('/reports', validate(zoneQ.extend({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), 'query'),
    asyncHandler(async (req, res) => ok(res, await supplier.reports(deps, actor(req), req.query.from as string, req.query.to as string, req.query.zoneId as string | undefined))));
  r.use('/supplier', sup);

  return r;
}

export { forbidden, notFound };
