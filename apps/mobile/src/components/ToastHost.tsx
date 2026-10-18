import React from 'react';
import { Pressable } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/ui';
import { useToast } from '@/store/toast';

/** In-app notification banner (success/failure feedback and incoming notifications). */
export function ToastHost() {
  const { toast, hide } = useToast();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const tone = toast.tone === 'danger' ? 'danger' : toast.tone === 'success' ? 'success' : 'info';
  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 100 }}
    >
      <Pressable onPress={hide} accessibilityRole="alert" accessibilityLabel={`${toast.title}. ${toast.message ?? ''}`}>
        <Banner tone={tone} title={toast.title} message={toast.message} />
      </Pressable>
    </Animated.View>
  );
}
