/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const chain = () => new Proxy({}, { get: () => chain });
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: unknown) => v,
    withRepeat: (v: unknown) => v,
    Easing: { out: () => undefined, cubic: undefined },
    FadeIn: chain(), FadeInDown: chain(), FadeInUp: chain(), FadeOutUp: chain(),
  };
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(async () => undefined) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('expo-image', () => ({ Image: 'Image' }));

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockParams: Record<string, string> = {};
(globalThis as any).__mockRouter = mockRouter;
(globalThis as any).__mockParams = mockParams;
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
  Stack: () => null,
  Tabs: () => null,
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      getSession: jest.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      signOut: jest.fn(),
    },
  },
}));

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
});
