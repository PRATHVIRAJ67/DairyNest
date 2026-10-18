import { Feather } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

export function Skeleton({ width = '100%', height = 16, r = 8, style }: { width?: DimensionValue; height?: number; r?: number; style?: object }) {
  const { colors } = useTheme();
  const o = useSharedValue(0.5);
  useEffect(() => { o.value = withRepeat(withTiming(1, { duration: 800 }), -1, true); }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View accessibilityLabel="Loading" style={[{ width, height, borderRadius: r, backgroundColor: colors.skeleton }, a, style]} />;
}

export function CardSkeleton() {
  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
      <Skeleton height={120} r={radius.lg} />
      <Skeleton width="60%" height={16} />
      <Skeleton width="35%" height={14} />
    </View>
  );
}

export function EmptyState({ icon = 'inbox', title, message, actionLabel, onAction }: { icon?: keyof typeof Feather.glyphMap; title: string; message?: string; actionLabel?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityRole="summary">
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}><Feather name={icon} size={30} color={colors.primary} /></View>
      <Text variant="h2" center>{title}</Text>
      {message ? <Text muted center style={{ marginTop: 6, marginBottom: spacing.lg }}>{message}</Text> : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} full={false} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityRole="alert">
      <View style={[styles.badge, { backgroundColor: colors.dangerBg }]}><Feather name="alert-triangle" size={30} color={colors.danger} /></View>
      <Text variant="h2" center>Something went wrong</Text>
      <Text muted center style={{ marginTop: 6, marginBottom: spacing.lg }}>{message}</Text>
      {onRetry ? <Button title="Try again" onPress={onRetry} variant="secondary" full={false} icon="refresh-cw" /> : null}
    </View>
  );
}

type Tone = 'info' | 'success' | 'warn' | 'danger';
export function Banner({ tone = 'info', title, message, actionLabel, onAction, icon, testID }: { tone?: Tone; title: string; message?: string; actionLabel?: string; onAction?: () => void; icon?: keyof typeof Feather.glyphMap; testID?: string }) {
  const { colors } = useTheme();
  const t = { info: [colors.infoBg, colors.info, 'info'], success: [colors.successBg, colors.success, 'check-circle'], warn: [colors.warnBg, colors.warn, 'alert-circle'], danger: [colors.dangerBg, colors.danger, 'alert-triangle'] }[tone] as [string, string, keyof typeof Feather.glyphMap];
  return (
    <View testID={testID} accessibilityRole="alert" style={[styles.banner, { backgroundColor: t[0] }]}>
      <Feather name={icon ?? t[2]} size={20} color={t[1]} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text weight="semibold" color={t[1]}>{title}</Text>
        {message ? <Text variant="small" color={colors.text} style={{ marginTop: 2 }}>{message}</Text> : null}
        {actionLabel ? <Text variant="small" weight="bold" color={t[1]} onPress={onAction} accessibilityRole="button" style={{ marginTop: 8 }}>{actionLabel}</Text> : null}
      </View>
    </View>
  );
}

const STATUS: Record<string, { label: string; tone: Tone | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' }, paused: { label: 'Paused', tone: 'warn' }, pending_payment: { label: 'Awaiting payment', tone: 'warn' },
  past_due: { label: 'Past due', tone: 'danger' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'info' }, pending: { label: 'Being prepared', tone: 'warn' }, out_for_delivery: { label: 'Out for delivery', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' }, skipped: { label: 'Skipped', tone: 'neutral' }, failed: { label: 'Failed', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' }, refunded: { label: 'Refunded', tone: 'neutral' }, partially_refunded: { label: 'Partly refunded', tone: 'neutral' }, expired: { label: 'Expired', tone: 'neutral' },
  open: { label: 'Open', tone: 'info' }, in_progress: { label: 'In progress', tone: 'warn' }, resolved: { label: 'Resolved', tone: 'success' }, closed: { label: 'Closed', tone: 'neutral' },
};

export function StatusPill({ status }: { status: string }) {
  const { colors } = useTheme();
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const };
  const map = { info: [colors.infoBg, colors.info], success: [colors.successBg, colors.success], warn: [colors.warnBg, colors.warn], danger: [colors.dangerBg, colors.danger], neutral: [colors.surfaceAlt, colors.textMuted] }[s.tone];
  return (
    <View style={[styles.pill, { backgroundColor: map[0] }]} accessibilityLabel={`Status: ${s.label}`}>
      <Text variant="caption" weight="bold" color={map[1]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  banner: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, marginBottom: spacing.md },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
});
