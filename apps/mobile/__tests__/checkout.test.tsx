import { fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { api, ApiError } from '@/lib/api';
import { useCart } from '@/store/cart';
import type { Product } from '@/lib/types';
import Checkout from '../app/checkout';
import { renderWithProviders, router } from '../test-support/testUtils';

jest.mock('@/lib/api', () => {
  const real = jest.requireActual('@/lib/api');
  return { ...real, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), del: jest.fn(), publicGet: jest.fn(), getPage: jest.fn() } };
});
const mocked = api as unknown as Record<'get' | 'post' | 'publicGet', jest.Mock>;

const product: Product = {
  id: 'p1', slug: 'farm-fresh-cow-milk', name: 'Farm Fresh Cow Milk', description: '', category: 'milk', imageUrl: null, isFeatured: true,
  variants: [{ id: 'v1', sku: 'CM-500', name: '500 ml pouch', sizeLabel: '500 ml', priceMinor: 3000, mrpMinor: 3200, isAvailable: true }],
};
const address = { id: 'a1', label: 'Home', recipientName: 'Asha', phone: '+919876543210', line1: '12 MG Road', line2: '', landmark: '', city: 'Bengaluru', postalCode: '560001', deliveryInstructions: '', isDefault: true, zoneId: 'z1' };
const quote = {
  deliveries: 30, perDeliveryMinor: 6000, subtotalMinor: 180000, planDiscountMinor: 5400, couponDiscountMinor: 0, totalMinor: 174600,
  periodStart: '2026-03-11', periodEnd: '2026-04-09', earliestStartDate: '2026-03-11', cutoffTime: '21:00', couponCode: null, couponDescription: null, items: [],
};

function server(opts: { paymentsConfigured?: boolean; quoteImpl?: (body: any) => any } = {}) {
  mocked.publicGet.mockImplementation(async (path: string) => {
    if (path === '/health') return { paymentsConfigured: opts.paymentsConfigured ?? true };
    throw new Error('unexpected ' + path);
  });
  mocked.get.mockImplementation(async (path: string) => {
    if (path === '/addresses') return [address];
    throw new Error('unexpected ' + path);
  });
  mocked.post.mockImplementation(async (path: string, body: any) => {
    if (path === '/subscriptions/quote') return opts.quoteImpl ? opts.quoteImpl(body) : quote;
    if (path === '/subscriptions') return { subscription: { id: 's1' }, checkout: { subscriptionId: 's1', paymentOrderId: 'po1', providerOrderId: 'order_X', amountMinor: 174600, currency: 'INR', keyId: 'rzp_test' }, replay: false };
    throw new Error('unexpected ' + path);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useCart.getState().clear();
  useCart.getState().add(product, product.variants[0], 2);
});

describe('subscription checkout', () => {
  it('shows the server-calculated total, not a client calculation', async () => {
    server();
    const { findByTestId } = await renderWithProviders(<Checkout />);
    const total = await findByTestId('checkout-total');
    expect(total.props.children).toBe('₹1,746');
    const quoteCall = mocked.post.mock.calls.find((c) => c[0] === '/subscriptions/quote')!;
    // The client sends ids and quantities only, never prices or totals.
    expect(quoteCall[1].items).toEqual([{ variantId: 'v1', quantity: 2 }]);
    expect(JSON.stringify(quoteCall[1])).not.toMatch(/price|total/i);
    expect(quoteCall[1].addressId).toBe('a1');
  });

  it('requires accepting the terms before payment', async () => {
    server();
    const { findByTestId, getByTestId } = await renderWithProviders(<Checkout />);
    await findByTestId('checkout-total');
    await waitFor(() => expect(getByTestId('checkout-pay').props.accessibilityState.disabled).toBe(true));
    await fireEvent.press(getByTestId('terms-checkbox'));
    await waitFor(() => expect(getByTestId('checkout-pay').props.accessibilityState.disabled).toBe(false));
  });

  it('creates the subscription with an idempotency key and opens the payment screen', async () => {
    server();
    const { findByTestId, getByTestId } = await renderWithProviders(<Checkout />);
    await findByTestId('checkout-total');
    await fireEvent.press(getByTestId('terms-checkbox'));
    await waitFor(() => expect(getByTestId('checkout-pay').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(getByTestId('checkout-pay'));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const create = mocked.post.mock.calls.find((c) => c[0] === '/subscriptions')!;
    expect(create[1]).toMatchObject({ acceptTerms: true, addressId: 'a1', items: [{ variantId: 'v1', quantity: 2 }], schedule: { frequency: 'daily' } });
    expect(create[1].idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/checkout/pay', params: { subscriptionId: 's1', orderId: 'order_X', paymentOrderId: 'po1', amount: '174600', keyId: 'rzp_test' } });
  });

  it('blocks payment and explains when the server has no payment credentials', async () => {
    server({ paymentsConfigured: false });
    const { findByText, getByTestId } = await renderWithProviders(<Checkout />);
    expect(await findByText('Online payments are not set up yet')).toBeTruthy();
    await fireEvent.press(getByTestId('terms-checkbox'));
    expect(getByTestId('checkout-pay').props.accessibilityState.disabled).toBe(true);
  });

  it('shows a coupon error returned by the server and removes the coupon', async () => {
    server({
      quoteImpl: (body) => {
        if (body.couponCode) throw new ApiError(422, 'COUPON_INVALID', 'This coupon code is not valid');
        return quote;
      },
    });
    const { findByText, getByTestId } = await renderWithProviders(<Checkout />);
    await findByText(/Price details/);
    await fireEvent.changeText(getByTestId('coupon-input'), 'bogus1');
    await fireEvent.press(getByTestId('coupon-apply'));
    expect(await findByText('This coupon code is not valid')).toBeTruthy();
    await waitFor(() => expect(useCart.getState().couponCode).toBeNull());
  });

  it('surfaces a server failure at payment time without navigating', async () => {
    server();
    mocked.post.mockImplementation(async (path: string) => {
      if (path === '/subscriptions/quote') return quote;
      throw new ApiError(422, 'VARIANT_UNAVAILABLE', 'Farm Fresh Cow Milk (500 ml pouch) is currently unavailable');
    });
    const { findByTestId, getByTestId, findByText } = await renderWithProviders(<Checkout />);
    await findByTestId('checkout-total');
    await fireEvent.press(getByTestId('terms-checkbox'));
    await waitFor(() => expect(getByTestId('checkout-pay').props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(getByTestId('checkout-pay'));
    expect((await findByTestId('checkout-error'))).toBeTruthy();
    expect(await findByText(/currently unavailable/)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows an empty state when the basket is empty', async () => {
    useCart.getState().clear();
    server();
    const { findByText } = await renderWithProviders(<Checkout />);
    expect(await findByText('Nothing here yet')).toBeTruthy();
  });
});
