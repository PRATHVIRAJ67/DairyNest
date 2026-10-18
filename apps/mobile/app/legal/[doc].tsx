import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Banner, Header, Screen, Text } from '@/components/ui';
import { config } from '@/lib/config';
import { spacing } from '@/theme/tokens';

const DOCS: Record<string, { title: string; sections: [string, string][] }> = {
  terms: {
    title: 'Terms of service',
    sections: [
      ['Your subscription', 'You choose products, quantities, a delivery schedule and a start date. Prices are calculated by our server at checkout and shown before you pay.'],
      ['Prepaid billing', 'Subscriptions are prepaid in 30-day blocks and are renewed manually. We do not automatically debit your account. When fewer than two weeks of prepaid deliveries remain, you can renew from the app.'],
      ['Cutoff times', 'A delivery can be skipped, paused or changed until the cutoff time of your delivery area on the evening before (shown in the app, typically 9 PM). After the cutoff the delivery is being prepared and cannot be changed.'],
      ['Skipped and paused days', 'Skipped, paused and failed deliveries are not consumed from your prepaid plan; your plan is extended instead.'],
      ['Cancellation and refunds', 'You can cancel any time. Deliveries already being prepared will still arrive. If you cancel with unused prepaid deliveries, we review a refund of the unused amount to your original payment method.'],
      ['Delivery', 'We deliver within the morning window of your area. Please make sure someone can receive the delivery or leave instructions. If a delivery fails because of us, it is credited back.'],
      ['Contact', `Questions? Email ${config.supportEmail}.`],
    ],
  },
  privacy: {
    title: 'Privacy policy',
    sections: [
      ['What we collect', 'Your phone number, name, optional email, delivery addresses, subscription and delivery history, payment references and support tickets.'],
      ['Payments', 'Payments are processed by Razorpay. We never see or store your card number, UPI PIN or other payment credentials, only a payment reference and status.'],
      ['How we use it', 'To deliver your orders, process payments, send delivery and payment updates you have enabled, and provide support.'],
      ['Notifications', 'You control delivery, payment and promotional notifications in Settings. Push notifications need your permission.'],
      ['Your choices', 'You can edit your details at any time and delete your account in Settings. Deleting removes your personal details and cancels subscriptions. We keep payment and invoice records as required by law.'],
      ['Contact', `Privacy questions: ${config.supportEmail}.`],
    ],
  },
};

export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const d = DOCS[doc] ?? DOCS.terms;
  return (
    <Screen>
      <Header title={d.title} />
      <Banner tone="warn" title="Template text" message="This is starter wording. Have it reviewed by a qualified lawyer and add your company details before launch." />
      {d.sections.map(([h, body]) => (
        <React.Fragment key={h}>
          <Text variant="h3" style={{ marginTop: spacing.lg }}>{h}</Text>
          <Text muted style={{ marginTop: 4 }}>{body}</Text>
        </React.Fragment>
      ))}
    </Screen>
  );
}
