import React from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';

type Variant = keyof typeof type;
interface Props extends TextProps {
  variant?: Variant;
  muted?: boolean;
  color?: string;
  center?: boolean;
  weight?: 'medium' | 'semibold' | 'bold';
}

export function Text({ variant = 'body', muted, color, center, style, weight, ...rest }: Props) {
  const { colors } = useTheme();
  const base: TextStyle = { ...(type[variant] as TextStyle), color: color ?? (muted ? colors.textMuted : colors.text) };
  if (weight) base.fontFamily = { medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' }[weight];
  if (center) base.textAlign = 'center';
  return <RNText allowFontScaling maxFontSizeMultiplier={1.4} {...rest} style={[base, style]} />;
}
