import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Dialog, ListRow, Screen, SectionHeader, Segmented, Text } from '@/components/ui';
import { useMe } from '@/lib/queries';
import { useAuth } from '@/store/auth';
import { useTheme, type ThemeMode } from '@/theme/ThemeProvider';
import { palette, spacing } from '@/theme/tokens';

export default function Account() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const me = useMe();
  const signOut = useAuth((s) => s.signOut);
  const [confirm, setConfirm] = useState(false);
  const initials = (me.data?.fullName || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <Screen>
      <Text variant="display" style={{ marginBottom: spacing.lg }}>Account</Text>
      <Card onPress={() => router.push('/profile')} accessibilityLabel="Edit profile" testID="profile-card">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: palette.forest700, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="h2" color={palette.lime400}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="h2" numberOfLines={1}>{me.data?.fullName || 'Your profile'}</Text>
            <Text muted>{me.data?.phone ?? me.data?.email ?? ''}</Text>
          </View>
        </View>
      </Card>

      <SectionHeader title="My DailyDairy" />
      <Card>
        <ListRow testID="row-addresses" icon="map-pin" title="Delivery addresses" subtitle="Add, edit or remove addresses" onPress={() => router.push('/addresses')} />
        <ListRow testID="row-payments" icon="credit-card" title="Payments and invoices" subtitle="History, receipts and refunds" onPress={() => router.push('/payments')} />
        <ListRow testID="row-notifications" icon="bell" title="Notifications" onPress={() => router.push('/notifications')} />
        <ListRow testID="row-settings" icon="shield" title="Notification and privacy settings" onPress={() => router.push('/settings')} />
      </Card>

      <SectionHeader title="Appearance" />
      <Card>
        <Segmented<ThemeMode> value={mode} onChange={setMode} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Card>

      <SectionHeader title="Help" />
      <Card>
        <ListRow testID="row-support" icon="headphones" title="Support" subtitle="Raise a ticket or contact us" onPress={() => router.push('/support')} />
        <ListRow testID="row-faq" icon="help-circle" title="Frequently asked questions" onPress={() => router.push('/support/faq')} />
        <ListRow icon="file-text" title="Terms of service" onPress={() => router.push('/legal/terms')} />
        <ListRow icon="lock" title="Privacy policy" onPress={() => router.push('/legal/privacy')} />
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button title="Log out" variant="secondary" icon="log-out" onPress={() => setConfirm(true)} testID="logout" />
      </View>
      <Dialog visible={confirm} title="Log out?" message="You will need your phone number and a new code to sign back in." confirmLabel="Log out" onCancel={() => setConfirm(false)} onConfirm={async () => { setConfirm(false); await signOut(); }} />
    </Screen>
  );
}
