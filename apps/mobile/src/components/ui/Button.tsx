import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH, radius, spacing, type } from '@/theme/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
interface Props {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  size?: 'md' | 'sm';
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, size = 'md', full = true, style, testID, accessibilityHint }: Props) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    accent: { bg: colors.accent, fg: colors.onAccent, border: colors.accent },
    secondary: { bg: 'transparent', fg: colors.primary, border: colors.primary },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
    danger: { bg: colors.dangerBg, fg: colors.danger, border: colors.danger },
  }[variant];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg, borderColor: palette.border, minHeight: size === 'sm' ? MIN_TOUCH - 6 : 52, opacity: inactive ? 0.5 : pressed ? 0.85 : 1, alignSelf: full ? 'stretch' : 'flex-start' },
        pressed && { transform: [{ scale: 0.99 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Feather name={icon} size={18} color={palette.fg} style={{ marginRight: spacing.sm }} /> : null}
          <Text style={[type.button, { color: palette.fg, fontSize: size === 'sm' ? 14 : 16 }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, borderWidth: 1.5, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
