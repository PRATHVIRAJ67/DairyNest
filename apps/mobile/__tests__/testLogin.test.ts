/* eslint-disable @typescript-eslint/no-require-imports */
// Test-login client (EXPO_PUBLIC_TEST_LOGIN=1): talks to /auth/test-login instead of Supabase SMS OTP.
const store: Record<string, string> = {};
jest.mock('@/lib/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => store[k] ?? null,
    setItem: async (k: string, v: string) => { store[k] = v; },
    removeItem: async (k: string) => { delete store[k]; },
  },
}));

function load() {
  let mod: typeof import('@/lib/authClient');
  jest.isolateModules(() => {
    process.env.EXPO_PUBLIC_TEST_LOGIN = '1';
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test/api/v1';
    mod = require('@/lib/authClient');
  });
  return mod!.authClient();
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_TEST_LOGIN;
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as any).fetch = undefined;
});

it('signs in with the test code, stores the session and restores it', async () => {
  const expiresAt = new Date(Date.now() + 86400_000).toISOString();
  const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { accessToken: 'test.abc.def', expiresAt } }) }));
  (globalThis as any).fetch = fetchMock;
  const auth = load();
  const events: string[] = [];
  auth.onAuthStateChange((e) => events.push(e));

  expect((await auth.signInWithOtp({ phone: '+919876543210' })).error).toBeNull();
  expect((await auth.verifyOtp({ phone: '+919876543210', token: '482916', type: 'sms' })).error).toBeNull();

  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/v1/auth/test-login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ phone: '+919876543210', code: '482916' }) }));
  expect(events).toEqual(['SIGNED_IN']);
  const { data } = await auth.getSession();
  expect(data.session?.access_token).toBe('test.abc.def');

  await auth.signOut();
  expect((await auth.getSession()).data.session).toBeNull();
  expect(events).toEqual(['SIGNED_IN', 'SIGNED_OUT']);
});

it('reports a wrong code in the same words as an expired SMS code', async () => {
  (globalThis as any).fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'That code is incorrect' } }) }));
  const r = await load().verifyOtp({ phone: '+919876543210', token: '000000', type: 'sms' });
  expect(r.error?.message).toMatch(/expired|invalid/i); // the OTP screen maps this to a friendly message
});

it('treats an expired stored session as signed out', async () => {
  store['test-session'] = JSON.stringify({ accessToken: 'test.x.y', expiresAt: new Date(Date.now() - 1000).toISOString(), phone: '+919876543210' });
  expect((await load().getSession()).data.session).toBeNull();
});
