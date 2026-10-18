import React, { useEffect } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { Button, type ButtonVariant } from './Button';
import { Text } from './Text';

export function Dialog({ visible, title, message, children, confirmLabel = 'OK', cancelLabel = 'Cancel', onConfirm, onCancel, destructive, loading, confirmDisabled }: {
  visible: boolean; title: string; message?: string; children?: React.ReactNode; confirmLabel?: string; cancelLabel?: string | null;
  onConfirm?: () => void; onCancel?: () => void; destructive?: boolean; loading?: boolean; confirmDisabled?: boolean;
}) {
  const { colors } = useTheme();
  const variant: ButtonVariant = destructive ? 'danger' : 'primary';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <Text variant="h2" accessibilityRole="header">{title}</Text>
          {message ? <Text muted style={{ marginTop: spacing.sm }}>{message}</Text> : null}
          {children ? <View style={{ marginTop: spacing.lg }}>{children}</View> : null}
          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            <Button title={confirmLabel} variant={variant} onPress={onConfirm} loading={loading} disabled={confirmDisabled} />
            {cancelLabel ? <Button title={cancelLabel} variant="ghost" onPress={onCancel} disabled={loading} /> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const y = useSharedValue(40);
  const o = useSharedValue(0);
  useEffect(() => {
    y.value = withTiming(visible ? 0 : 40, { duration: 220, easing: Easing.out(Easing.cubic) });
    o.value = withTiming(visible ? 1 : 0, { duration: 220 });
  }, [visible, y, o]);
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: o.value }));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: colors.overlay, justifyContent: 'flex-end' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }, sheet]}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <Text variant="h2" style={{ marginBottom: spacing.md }} accessibilityRole="header">{title}</Text>
            <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  dialog: { borderRadius: radius.xl, padding: spacing.xl },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.md, margin: -spacing.xl, marginBottom: -spacing.xl },
  grabber: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: spacing.md },
});
