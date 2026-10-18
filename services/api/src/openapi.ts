import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  addressInput, createSubscriptionInput, pauseInput, quoteInput, skipInput, supportTicketInput, verifyPaymentInput,
} from '@milk/validation';

const j = (s: any) => zodToJsonSchema(s, { target: 'openApi3', $refStrategy: 'none' });
const secured = [{ bearerAuth: [] }];
const ok = (description = 'OK') => ({ '200': { description, content: { 'application/json': { schema: { type: 'object', properties: { data: {} } } } } } });
const body = (schema: any) => ({ required: true, content: { 'application/json': { schema: j(schema) } } });
const idp = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];

export function buildOpenApi() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Milk & Curd Subscription API', version: '0.1.0',
      description: 'REST API under /api/v1. Authenticate with a Supabase access token: `Authorization: Bearer <token>`. Money is integer paise. Errors: `{ error: { code, message, details, requestId } }`.',
    },
    servers: [{ url: '/api/v1' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths: {
      '/health': { get: { tags: ['System'], summary: 'Health check', responses: ok() } },
      '/products': { get: { tags: ['Catalog'], summary: 'List products with variants', parameters: ['category', 'featured', 'q', 'page', 'pageSize'].map((n) => ({ name: n, in: 'query', schema: { type: 'string' } })), responses: ok() } },
      '/products/{idOrSlug}': { get: { tags: ['Catalog'], summary: 'Product detail', parameters: [{ name: 'idOrSlug', in: 'path', required: true, schema: { type: 'string' } }], responses: ok() } },
      '/plans': { get: { tags: ['Catalog'], summary: 'Subscription plans', responses: ok() } },
      '/serviceability': { get: { tags: ['Catalog'], summary: 'Is a PIN code serviceable?', parameters: [{ name: 'postalCode', in: 'query', required: true, schema: { type: 'string' } }], responses: ok() } },
      '/me': { get: { tags: ['Account'], security: secured, summary: 'Current profile', responses: ok() }, put: { tags: ['Account'], security: secured, summary: 'Update profile', responses: ok() } },
      '/me/delete': { post: { tags: ['Account'], security: secured, summary: 'Delete account (anonymise + cancel subscriptions)', responses: ok() } },
      '/addresses': {
        get: { tags: ['Addresses'], security: secured, summary: 'List saved addresses', responses: ok() },
        post: { tags: ['Addresses'], security: secured, summary: 'Add address', requestBody: body(addressInput), responses: ok('Created') },
      },
      '/addresses/{id}': {
        patch: { tags: ['Addresses'], security: secured, summary: 'Edit address', parameters: idp, responses: ok() },
        delete: { tags: ['Addresses'], security: secured, summary: 'Delete address', parameters: idp, responses: { '204': { description: 'Deleted' } } },
      },
      '/subscriptions/quote': { post: { tags: ['Subscriptions'], security: secured, summary: 'Server-side price quote', requestBody: body(quoteInput), responses: ok() } },
      '/subscriptions': {
        get: { tags: ['Subscriptions'], security: secured, summary: 'List my subscriptions', responses: ok() },
        post: { tags: ['Subscriptions'], security: secured, summary: 'Create subscription and payment order (idempotent)', requestBody: body(createSubscriptionInput), responses: ok('Replay') },
      },
      '/subscriptions/{id}': { get: { tags: ['Subscriptions'], security: secured, summary: 'Subscription detail', parameters: idp, responses: ok() } },
      '/subscriptions/{id}/pause': { post: { tags: ['Subscriptions'], security: secured, summary: 'Pause (until a date or indefinitely)', parameters: idp, requestBody: body(pauseInput), responses: ok() } },
      '/subscriptions/{id}/resume': { post: { tags: ['Subscriptions'], security: secured, summary: 'Resume', parameters: idp, responses: ok() } },
      '/subscriptions/{id}/skip': { post: { tags: ['Subscriptions'], security: secured, summary: 'Skip one delivery', parameters: idp, requestBody: body(skipInput), responses: ok() } },
      '/subscriptions/{id}/cancel': { post: { tags: ['Subscriptions'], security: secured, summary: 'Cancel', parameters: idp, responses: ok() } },
      '/subscriptions/{id}/deliveries/generate': { post: { tags: ['Deliveries'], security: secured, summary: 'Manually generate upcoming deliveries (idempotent)', parameters: idp, responses: ok() } },
      '/deliveries': { get: { tags: ['Deliveries'], security: secured, summary: 'Deliveries in a date range', parameters: ['from', 'to', 'subscriptionId'].map((n) => ({ name: n, in: 'query', schema: { type: 'string' } })), responses: ok() } },
      '/payments/verify': { post: { tags: ['Payments'], security: secured, summary: 'Verify Razorpay checkout result on the server', requestBody: body(verifyPaymentInput), responses: ok() } },
      '/payments': { get: { tags: ['Payments'], security: secured, summary: 'Payment history', responses: ok() } },
      '/invoices': { get: { tags: ['Payments'], security: secured, summary: 'Invoices', responses: ok() } },
      '/invoices/{id}/receipt': { get: { tags: ['Payments'], security: secured, summary: 'Download receipt (HTML)', parameters: idp, responses: { '200': { description: 'HTML receipt' } } } },
      '/webhooks/razorpay': { post: { tags: ['Payments'], summary: 'Razorpay webhook (signature verified over the raw body)', responses: ok() } },
      '/notifications': { get: { tags: ['Notifications'], security: secured, summary: 'Notification history', responses: ok() } },
      '/support/tickets': {
        get: { tags: ['Support'], security: secured, summary: 'My tickets', responses: ok() },
        post: { tags: ['Support'], security: secured, summary: 'Create ticket', requestBody: body(supportTicketInput), responses: ok('Created') },
      },
      '/admin/deliveries/{id}/status': { patch: { tags: ['Operations'], security: secured, summary: 'Admin role: update delivery status', parameters: idp, responses: ok() } },
      '/admin/payments/{id}/refund': { post: { tags: ['Operations'], security: secured, summary: 'Admin role: refund a payment', parameters: idp, responses: ok() } },
    },
  };
}
