import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import React from 'react';
import { ThemeProvider } from '@/theme/ThemeProvider';

export async function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const utils = await render(
    <ThemeProvider initialMode="light">
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...utils, client };
}

export const router = (globalThis as any).__mockRouter as { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
export const params = (globalThis as any).__mockParams as Record<string, string>;
