import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { addDays, parseISODate, type ISODate } from '@milk/shared';
import { useTheme } from '@/theme/ThemeProvider';
import { MIN_TOUCH, radius, spacing } from '@/theme/tokens';
import { Text } from './Text';

export function Stepper({ value, onChange, min = 1, max = 20, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label?: string }) {
  const { colors } = useTheme();
  const btn = (icon: 'minus' | 'plus', disabled: boolean, next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${icon === 'minus' ? 'Decrease' : 'Increase'} ${label ?? 'quantity'}`}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={[styles.stepBtn, { backgroundColor: colors.primarySoft, opacity: disabled ? 0.4 : 1 }]}
    >
      <Feather name={icon} size={18} color={colors.primary} />
    </Pressable>
  );
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityValue={{ now: value, min, max }}>
      {btn('minus', value <= min, value - 1)}
      <Text weight="bold" style={{ minWidth: 34, textAlign: 'center' }} testID="stepper-value">{value}</Text>
      {btn('plus', value >= max, value + 1)}
    </View>
  );
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatDate = (d: ISODate, opts: { weekday?: boolean; year?: boolean } = { weekday: true }) => {
  const dt = new Date(parseISODate(d));
  const base = `${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
  return `${opts.weekday ? DOW[dt.getUTCDay()] + ', ' : ''}${base}${opts.year ? ' ' + dt.getUTCFullYear() : ''}`;
};

/** Horizontal strip of selectable dates (avoids a native date-picker dependency). */
export function DateStrip({ from, days = 21, value, onChange, disabledDates = [] }: { from: ISODate; days?: number; value?: ISODate | null; onChange: (d: ISODate) => void; disabledDates?: ISODate[] }) {
  const { colors } = useTheme();
  const items = Array.from({ length: days }, (_, i) => addDays(from, i));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 4 }}>
      {items.map((d) => {
        const on = d === value;
        const off = disabledDates.includes(d);
        const dt = new Date(parseISODate(d));
        return (
          <Pressable
            key={d}
            disabled={off}
            accessibilityRole="button"
            accessibilityLabel={formatDate(d, { weekday: true, year: true })}
            accessibilityState={{ selected: on, disabled: off }}
            onPress={() => onChange(d)}
            style={[styles.date, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border, opacity: off ? 0.35 : 1 }]}
          >
            <Text variant="caption" color={on ? colors.onPrimary : colors.textMuted}>{DOW[dt.getUTCDay()]}</Text>
            <Text variant="h3" color={on ? colors.onPrimary : colors.text}>{dt.getUTCDate()}</Text>
            <Text variant="caption" color={on ? colors.onPrimary : colors.textMuted}>{MON[dt.getUTCMonth()]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { colors } = useTheme();
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {order.map((d) => {
        const on = value.includes(d);
        return (
          <Pressable
            key={d}
            accessibilityRole="checkbox"
            accessibilityLabel={DOW[d]}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
            style={[styles.dow, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}
          >
            <Text variant="small" weight="bold" color={on ? colors.onPrimary : colors.text}>{DOW[d]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Checkbox({ checked, onChange, children, testID }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minHeight: MIN_TOUCH }}>
      <View style={[styles.box, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : colors.surface }]}>
        {checked ? <Feather name="check" size={16} color={colors.onPrimary} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function SwitchRow({ title, subtitle, value, onChange, disabled }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{title}</Text>
        {subtitle ? <Text variant="small" muted>{subtitle}</Text> : null}
      </View>
      <Switch accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
    </View>
  );
}

export function OptionCard({ title, subtitle, selected, onPress, right, testID }: { title: string; subtitle?: string; selected?: boolean; onPress: () => void; right?: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.option, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface }]}
    >
      <View style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>{selected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{title}</Text>
        {subtitle ? <Text variant="small" muted>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: { width: MIN_TOUCH - 4, height: MIN_TOUCH - 4, borderRadius: (MIN_TOUCH - 4) / 2, alignItems: 'center', justifyContent: 'center' },
  date: { width: 62, paddingVertical: 10, alignItems: 'center', borderRadius: radius.md, borderWidth: 1.5 },
  dow: { minWidth: 44, minHeight: 40, paddingHorizontal: 8, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1.5, marginBottom: spacing.sm },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
