import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { ProductIllustration } from '@/components/ProductArt';
import { ErrorState, Button, Text } from '@/components/ui';
import { config, isConfigured } from '@/lib/config';
import { useMe } from '@/lib/queries';
import { useAuth } from '@/store/auth';
import { palette } from '@/theme/tokens';

/** Splash + routing gate: decides where a launch should land. */
export default function Index() {
  const { session, ready, onboarded, signOut } = useAuth();
  const me = useMe(!!session);

  if (!isConfigured()) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.ivory, justifyContent: 'center' }}>
        <ErrorState message="This build is missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to apps/mobile/.env and restart Expo." />
      </View>
    );
  }
  if (!ready || (session && me.isLoading)) return <Splash />;
  if (!session) return <Redirect href={onboarded ? '/(auth)/phone' : '/(auth)/onboarding'} />;
  if (me.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.ivory, justifyContent: 'center', padding: 24 }}>
        <ErrorState message={`We could not reach the server at ${config.apiUrl}. Check your connection.`} onRetry={() => me.refetch()} />
        <Button title="Sign out" variant="ghost" onPress={signOut} />
      </View>
    );
  }
  if (!me.data?.profileCompleted) return <Redirect href="/(auth)/profile-setup" />;
  return <Redirect href="/(tabs)" />;
}

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: palette.forest700, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View entering={FadeIn.duration(500)} style={{ borderRadius: 40, overflow: 'hidden' }}>
        <ProductIllustration category="milk" slug="farm-fresh-cow-milk" size={140} />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(250).duration(500)} style={{ alignItems: 'center', marginTop: 20 }}>
        <Text variant="display" color={palette.white}>{config.appName}</Text>
        <Text color={palette.lime400} style={{ marginTop: 4 }}>Fresh milk and curd, every morning</Text>
      </Animated.View>
      <ActivityIndicator color={palette.lime500} style={{ marginTop: 32 }} />
    </View>
  );
}
