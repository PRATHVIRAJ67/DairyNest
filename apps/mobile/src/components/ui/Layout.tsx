import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH, radius, shadow, spacing } from '@/theme/tokens';
import { Text } from './Text';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  footer?: React.ReactNode;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, footer, edges = ['top', 'left', 'right'], contentStyle }: ScreenProps) {
  const { colors } = useTheme();
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ padding: padded ? spacing.lg : 0, paddingBottom: spacing.xxxl }, contentStyle]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: padded ? spacing.lg : 0 }, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={footer ? edges : [...edges, 'bottom']}>
      {body}
      {footer ? (
        <SafeAreaView edges={['bottom']} style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          {footer}
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

export function Header({ title, subtitle, right, back = true }: { title: string; subtitle?: string; right?: React.ReactNode; back?: boolean }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          style={[styles.back, { backgroundColor: colors.surface, borderColor: colors.border }]}
          hitSlop={8}
        >
          <Feather name="arrow-left" size={20} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant="h1" numberOfLines={1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text variant="small" muted>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style, onPress, padded = true, testID, accessibilityLabel }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean; testID?: string; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const s: StyleProp<ViewStyle> = [{ backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, padding: padded ? spacing.lg : 0 }, shadow(colors, 1), style];
  if (onPress) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [s, pressed && { opacity: 0.9, transform: [{ scale: 0.995 }] }]}>
        {children}
      </Pressable>
    );
  }
  return <View testID={testID} style={s}>{children}</View>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text variant="h2" accessibilityRole="header">{title}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10} style={{ minHeight: MIN_TOUCH - 12, justifyContent: 'center' }}>
          <Text variant="small" weight="semibold" color={colors.primary}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected?: boolean; onPress?: () => void; icon?: keyof typeof Feather.glyphMap; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
    >
      {icon ? <Feather name={icon} size={14} color={selected ? colors.onPrimary : colors.textMuted} style={{ marginRight: 6 }} /> : null}
      <Text variant="small" weight="semibold" color={selected ? colors.onPrimary : colors.text}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceAlt }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[styles.seg, on && { backgroundColor: colors.surface }, on && shadow(colors, 1)]}>
            <Text variant="small" weight="semibold" color={on ? colors.primary : colors.textMuted}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md }} />;
}

export function ListRow({ icon, title, subtitle, onPress, right, danger, testID }: { icon?: keyof typeof Feather.glyphMap; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={title} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.7 : 1 }]}>
      {icon ? (
        <View style={[styles.listIcon, { backgroundColor: danger ? colors.dangerBg : colors.primarySoft }]}>
          <Feather name={icon} size={18} color={danger ? colors.danger : colors.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text weight="semibold" color={danger ? colors.danger : colors.text}>{title}</Text>
        {subtitle ? <Text variant="small" muted>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={18} color={colors.textMuted} /> : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg, gap: spacing.md },
  back: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, minHeight: 38, borderRadius: radius.pill, borderWidth: 1.5, marginRight: spacing.sm },
  segmented: { flexDirection: 'row', borderRadius: radius.pill, padding: 4 },
  seg: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  listIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
