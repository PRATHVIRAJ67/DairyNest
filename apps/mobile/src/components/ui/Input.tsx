import { Feather } from '@expo/vector-icons';
import React, { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, spacing } from '@/theme/tokens';
import { Text } from './Text';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  helper?: string;
  prefix?: string;
  icon?: keyof typeof Feather.glyphMap;
}

export const Input = forwardRef<TextInput, Props>(function Input({ label, error, helper, prefix, icon, secureTextEntry, style, ...rest }, ref) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="caption" muted style={{ marginBottom: 6 }}>{label.toUpperCase()}</Text>
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor, borderWidth: focused || error ? 2 : 1.5 }]}>
        {icon ? <Feather name={icon} size={18} color={colors.textMuted} style={{ marginRight: spacing.sm }} /> : null}
        {prefix ? <Text weight="semibold" style={{ marginRight: 6 }}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          secureTextEntry={hidden}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          style={[styles.input, { color: colors.text, fontFamily: fonts.body }, style]}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show' : 'Hide'} onPress={() => setHidden((h) => !h)} hitSlop={12}>
            <Feather name={hidden ? 'eye' : 'eye-off'} size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text variant="small" color={colors.danger} style={{ marginTop: 6 }} accessibilityLiveRegion="polite">{error}</Text> : helper ? <Text variant="small" muted style={{ marginTop: 6 }}>{helper}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingHorizontal: spacing.lg, minHeight: 52 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
});
