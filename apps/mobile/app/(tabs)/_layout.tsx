import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';

type IconName = keyof typeof Feather.glyphMap;
const tab = (name: string, title: string, icon: IconName) => ({
  name,
  options: {
    title,
    tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <Feather name={icon} size={size} color={color} />,
  },
});

export default function TabsLayout() {
  const { colors } = useTheme();
  const session = useAuth((s) => s.session);
  if (!session) return <Redirect href="/" />;
  const t = [tab('index', 'Home', 'home'), tab('shop', 'Shop', 'shopping-bag'), tab('subscriptions', 'Plans', 'repeat'), tab('calendar', 'Calendar', 'calendar'), tab('account', 'Account', 'user')];
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 62, paddingTop: 6, paddingBottom: 8 },
      }}
    >
      {t.map((x) => (
        <Tabs.Screen key={x.name} {...x} />
      ))}
    </Tabs>
  );
}
