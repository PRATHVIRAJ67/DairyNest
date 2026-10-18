import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastHost } from '@/components/ToastHost';
import { Platform } from 'react-native';
import { ApiError } from '@/lib/api';
import { useToast } from '@/store/toast';
import { useAuth } from '@/store/auth';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function Shell() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const session = useAuth((s) => s.session);
  const ready = useAuth((s) => s.ready);
  const [wasSignedIn, setWasSignedIn] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    useAuth.getState().init().then((u) => { off = u; });
    return () => off?.();
  }, []);

  // Foreground push notifications are shown as in-app banners and refresh the notification list.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let remove: (() => void) | undefined;
    import('expo-notifications')
      .then((N) => {
        N.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
        const sub = N.addNotificationReceivedListener((n) => {
          useToast.getState().show({ tone: 'info', title: n.request.content.title ?? 'Update', message: n.request.content.body ?? undefined });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
          queryClient.invalidateQueries({ queryKey: ['deliveries'] });
        });
        remove = () => sub.remove();
      })
      .catch(() => undefined); // push is unavailable in this runtime (e.g. Expo Go): nothing to do
    return () => remove?.();
  }, []);

  // Signing out (or deleting the account) clears cached private data and returns to the entry screen.
  useEffect(() => {
    if (session) setWasSignedIn(true);
    else if (wasSignedIn && ready) {
      queryClient.clear();
      setWasSignedIn(false);
      router.replace('/');
    }
  }, [session, ready, wasSignedIn, router]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Fraunces_600SemiBold, Fraunces_700Bold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  useEffect(() => { if (fontsLoaded) SplashScreen.hideAsync().catch(() => undefined); }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <Shell />
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
