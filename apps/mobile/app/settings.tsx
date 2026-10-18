import React, { useState } from 'react';
import { Banner, Button, Card, Dialog, Header, Input, Screen, SectionHeader, SwitchRow, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { registerForPush, unregisterPush } from '@/lib/push';
import { useDeleteAccount, useMe, useUpdatePrefs } from '@/lib/queries';
import type { NotificationPrefs } from '@/lib/types';
import { useAuth } from '@/store/auth';
import { useToast } from '@/store/toast';
import { spacing } from '@/theme/tokens';

export default function Settings() {
  const me = useMe();
  const update = useUpdatePrefs();
  const del = useDeleteAccount();
  const signOut = useAuth((s) => s.signOut);
  const show = useToast((s) => s.show);
  const [dialog, setDialog] = useState(false);
  const [typed, setTyped] = useState('');
  const prefs = me.data?.notificationPrefs;

  const set = async (patch: Partial<NotificationPrefs>) => {
    if (!prefs) return;
    try {
      if (patch.push === true) {
        const r = await registerForPush();
        if (!r.ok) return show({ tone: 'info', title: 'Push notifications unavailable', message: r.message });
      }
      if (patch.push === false) await unregisterPush();
      await update.mutateAsync({ ...prefs, ...patch });
    } catch (e) { show({ tone: 'danger', title: 'Could not save', message: errorMessage(e) }); }
  };

  const deleteAccount = async () => {
    try {
      await del.mutateAsync();
      setDialog(false);
      await signOut();
    } catch (e) { setDialog(false); show({ tone: 'danger', title: 'Could not delete account', message: errorMessage(e) }); }
  };

  return (
    <Screen>
      <Header title="Settings" />
      <SectionHeader title="Notifications" />
      <Card>
        <SwitchRow title="Delivery updates" subtitle="Out for delivery, delivered, issues" value={!!prefs?.deliveryUpdates} onChange={(v) => set({ deliveryUpdates: v })} disabled={!prefs} />
        <SwitchRow title="Payment updates" subtitle="Receipts, failures and refunds" value={!!prefs?.paymentUpdates} onChange={(v) => set({ paymentUpdates: v })} disabled={!prefs} />
        <SwitchRow title="Offers and news" subtitle="Occasional promotions" value={!!prefs?.promotions} onChange={(v) => set({ promotions: v })} disabled={!prefs} />
      </Card>
      <SectionHeader title="Channels" />
      <Card>
        <SwitchRow title="Push notifications" subtitle="On this device" value={!!prefs?.push} onChange={(v) => set({ push: v })} disabled={!prefs} />
        <SwitchRow title="Email" subtitle="Not available yet" value={false} onChange={() => undefined} disabled />
        <SwitchRow title="SMS" subtitle="Not available yet" value={false} onChange={() => undefined} disabled />
      </Card>
      <Text variant="small" muted style={{ marginTop: spacing.sm }}>Every notification is always saved in your in-app history, even when a channel is off or unavailable.</Text>

      <SectionHeader title="Privacy" />
      <Card>
        <Text variant="small" muted>We store your name, phone number, addresses and order history to run your deliveries and payments. Card and UPI details are handled by Razorpay and never stored by us. Read the privacy policy for details.</Text>
      </Card>
      <SectionHeader title="Danger zone" />
      <Banner tone="danger" title="Delete account" message="Cancels your subscriptions, removes your personal details and signs you out. Payment records are retained for legal and accounting purposes. This cannot be undone." />
      <Button title="Delete my account" variant="danger" icon="trash-2" onPress={() => { setTyped(''); setDialog(true); }} testID="delete-account" />
      <Dialog visible={dialog} destructive title="Delete your account?" message={'Type DELETE to confirm.'} confirmLabel="Delete forever" confirmDisabled={typed !== 'DELETE'} loading={del.isPending} onCancel={() => setDialog(false)} onConfirm={deleteAccount}>
        <Input testID="delete-confirm" label="Type DELETE" autoCapitalize="characters" value={typed} onChangeText={setTyped} />
      </Dialog>
    </Screen>
  );
}
