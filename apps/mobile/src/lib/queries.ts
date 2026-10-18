import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ISODate } from '@milk/shared';
import { api } from './api';
import type {
  Address, AppNotification, Checkout, Delivery, Invoice, NotificationPrefs, PaymentRow, Plan, Product, Profile, Quote, Subscription, Ticket,
} from './types';

export const qk = {
  products: (f?: object) => ['products', f ?? {}] as const,
  product: (s: string) => ['product', s] as const,
  plans: ['plans'] as const,
  me: ['me'] as const,
  addresses: ['addresses'] as const,
  subs: ['subscriptions'] as const,
  sub: (id: string) => ['subscription', id] as const,
  deliveries: (f: object) => ['deliveries', f] as const,
  upcoming: ['deliveries', 'upcoming'] as const,
  payments: ['payments'] as const,
  invoices: ['invoices'] as const,
  notifications: ['notifications'] as const,
  tickets: ['tickets'] as const,
  health: ['health'] as const,
  faqs: ['faqs'] as const,
};

const invalidateSubs = (qc: QueryClient, id?: string) => {
  qc.invalidateQueries({ queryKey: qk.subs });
  if (id) qc.invalidateQueries({ queryKey: qk.sub(id) });
  qc.invalidateQueries({ queryKey: ['deliveries'] });
};

// ---- catalog (public)
export const useProducts = (f: { category?: string; q?: string; featured?: boolean } = {}) =>
  useQuery({
    queryKey: qk.products(f),
    queryFn: () => {
      const p = new URLSearchParams({ pageSize: '50' });
      if (f.category) p.set('category', f.category);
      if (f.q) p.set('q', f.q);
      if (f.featured) p.set('featured', 'true');
      return api.publicGet<Product[]>(`/products?${p}`);
    },
  });
export const useProduct = (slug: string) => useQuery({ queryKey: qk.product(slug), queryFn: () => api.publicGet<Product>(`/products/${slug}`) });
export const usePlans = () => useQuery({ queryKey: qk.plans, queryFn: () => api.publicGet<Plan[]>('/plans'), staleTime: 10 * 60_000 });
export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: () => api.publicGet<{ paymentsConfigured: boolean }>('/health'), staleTime: 60_000 });
export const useFaqs = () => useQuery({ queryKey: qk.faqs, queryFn: () => api.publicGet<{ q: string; a: string }[]>('/support/faqs'), staleTime: 60 * 60_000 });
export const checkServiceability = (postalCode: string) => api.publicGet<{ serviceable: boolean; zone: { name: string; windowStart: string; windowEnd: string; cutoffTime: string } | null }>(`/serviceability?postalCode=${postalCode}`);

// ---- profile
export const useMe = (enabled = true) => useQuery({ queryKey: qk.me, queryFn: () => api.get<Profile>('/me'), enabled });
export const useUpdateMe = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { fullName: string; email?: string }) => api.put<Profile>('/me', v), onSuccess: (d) => qc.setQueryData(qk.me, d) });
};
export const useUpdatePrefs = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: NotificationPrefs) => api.put<Profile>('/me/notification-preferences', v as any), onSuccess: (d) => qc.setQueryData(qk.me, d) });
};
export const useDeleteAccount = () => useMutation({ mutationFn: () => api.post('/me/delete', { confirm: 'DELETE' }) });

// ---- addresses
export const useAddresses = () => useQuery({ queryKey: qk.addresses, queryFn: () => api.get<Address[]>('/addresses') });
export const useSaveAddress = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Address> & { id?: string }) => (id ? api.patch<Address>(`/addresses/${id}`, body) : api.post<Address>('/addresses', body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.addresses }),
  });
};
export const useDeleteAddress = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.del(`/addresses/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.addresses }) });
};
export const useSetDefaultAddress = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.post(`/addresses/${id}/default`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.addresses }) });
};

// ---- subscriptions
export const useSubscriptions = (enabled = true) => useQuery({ queryKey: qk.subs, queryFn: () => api.get<Subscription[]>('/subscriptions'), enabled });
export const useSubscription = (id: string) => useQuery({ queryKey: qk.sub(id), queryFn: () => api.get<Subscription>(`/subscriptions/${id}`), enabled: !!id });
export const useSubscriptionHistory = (id: string) => useQuery({ queryKey: ['sub-history', id], queryFn: () => api.get<{ id: string; action: string; metadata: any; createdAt: string }[]>(`/subscriptions/${id}/history`) });

export interface QuoteInput { items: { variantId: string; quantity: number }[]; addressId: string; schedule: { frequency: string; weekdays?: number[]; startDate: ISODate }; couponCode?: string }
export const useQuote = (input: QuoteInput | null) =>
  useQuery({ queryKey: ['quote', input], queryFn: () => api.post<Quote>('/subscriptions/quote', input as any), enabled: !!input, retry: false, staleTime: 15_000 });

export const useCreateSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: QuoteInput & { acceptTerms: true; idempotencyKey: string }) => api.post<{ subscription: Subscription; checkout: Checkout; replay: boolean }>('/subscriptions', v as any),
    onSuccess: () => invalidateSubs(qc),
  });
};
export const useCheckout = () => useMutation({ mutationFn: (id: string) => api.post<Checkout>(`/subscriptions/${id}/checkout`) });
export const useRenew = () => useMutation({ mutationFn: (id: string) => api.post<Checkout>(`/subscriptions/${id}/renew`) });

export function useSubAction<V = void>(id: string, fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidateSubs(qc, id) });
}
export const subActions = {
  pause: (id: string, v: { from?: ISODate; until?: ISODate | null }) => api.post(`/subscriptions/${id}/pause`, v as any),
  resume: (id: string) => api.post(`/subscriptions/${id}/resume`),
  skip: (id: string, date: ISODate) => api.post(`/subscriptions/${id}/skip`, { date }),
  unskip: (id: string, date: ISODate) => api.post(`/subscriptions/${id}/unskip`, { date }),
  items: (id: string, items: { variantId: string; quantity: number }[]) => api.patch(`/subscriptions/${id}/items`, { items }),
  schedule: (id: string, s: { frequency: string; weekdays?: number[]; startDate: ISODate }) => api.patch(`/subscriptions/${id}/schedule`, s as any),
  address: (id: string, addressId: string) => api.patch(`/subscriptions/${id}/address`, { addressId }),
  cancel: (id: string, reason?: string) => api.post<Subscription>(`/subscriptions/${id}/cancel`, { reason } as any),
  generate: (id: string) => api.post<{ created: number }>(`/subscriptions/${id}/deliveries/generate`, {}),
};

// ---- deliveries
export const useDeliveries = (f: { from: ISODate; to: ISODate; subscriptionId?: string }) =>
  useQuery({ queryKey: qk.deliveries(f), queryFn: () => api.get<Delivery[]>(`/deliveries?from=${f.from}&to=${f.to}${f.subscriptionId ? `&subscriptionId=${f.subscriptionId}` : ''}`) });
export const useUpcoming = (enabled = true) => useQuery({ queryKey: qk.upcoming, queryFn: () => api.get<Delivery[]>('/deliveries/upcoming'), enabled });
export const useDelivery = (id: string) => useQuery({ queryKey: ['delivery', id], queryFn: () => api.get<Delivery>(`/deliveries/${id}`) });

// ---- payments
export const usePayments = () => useQuery({ queryKey: qk.payments, queryFn: () => api.get<PaymentRow[]>('/payments?pageSize=50') });
export const useInvoices = () => useQuery({ queryKey: qk.invoices, queryFn: () => api.get<Invoice[]>('/invoices?pageSize=50') });
export const verifyPayment = (v: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
  api.post<{ status: 'paid' | 'failed' | 'pending'; subscriptionId: string | null }>('/payments/verify', v);
export const reconcileOrder = (id: string) => api.post<{ status: string; changed: boolean }>(`/payments/orders/${id}/reconcile`);

// ---- notifications / support
export const useNotifications = () =>
  useQuery({ queryKey: qk.notifications, queryFn: async () => { const r = await api.getPage<AppNotification>('/notifications?pageSize=50'); return { items: r.data, unread: r.meta?.unread ?? 0 }; }, refetchInterval: 60_000 });
export const useMarkRead = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }) });
};
export const useMarkAllRead = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }) });
};
export const useTickets = () => useQuery({ queryKey: qk.tickets, queryFn: () => api.get<Ticket[]>('/support/tickets') });
export const useCreateTicket = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { category: string; subject: string; message: string }) => api.post<Ticket>('/support/tickets', v), onSuccess: () => qc.invalidateQueries({ queryKey: qk.tickets }) });
};
