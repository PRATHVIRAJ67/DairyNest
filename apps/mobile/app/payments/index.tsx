import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Banner, BottomSheet, Button, Card, CardSkeleton, EmptyState, ErrorState, Header, Row, Screen, Segmented, StatusPill, Text, formatDate } from '@/components/ui';
import { usePayFlow } from '@/hooks/usePay';
import { errorMessage } from '@/lib/api';
import { formatDateTime, money } from '@/lib/format';
import { downloadReceipt } from '@/lib/receipt';
import { reconcileOrder, useInvoices, usePayments } from '@/lib/queries';
import type { PaymentRow } from '@/lib/types';
import { useToast } from '@/store/toast';
import { spacing } from '@/theme/tokens';

export default function Payments() {
  const [tab, setTab] = useState<'payments' | 'invoices'>('payments');
  const payments = usePayments();
  const invoices = useInvoices();
  const [open, setOpen] = useState<PaymentRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const qc = useQueryClient();
  const pay = usePayFlow();
  const show = useToast((s) => s.show);

  const receipt = async (id: string, number: string) => {
    setBusy(id);
    try { await downloadReceipt(id, number); } catch (e) { show({ tone: 'danger', title: 'Receipt unavailable', message: errorMessage(e) }); } finally { setBusy(null); }
  };
  const refreshStatus = async (row: PaymentRow) => {
    setBusy(row.id);
    try {
      const r = await reconcileOrder(row.id);
      await Promise.all([qc.invalidateQueries({ queryKey: ['payments'] }), qc.invalidateQueries({ queryKey: ['invoices'] }), qc.invalidateQueries({ queryKey: ['subscriptions'] })]);
      show({ tone: r.status === 'paid' ? 'success' : 'info', title: r.status === 'paid' ? 'Payment confirmed' : 'No change yet', message: r.status === 'paid' ? undefined : 'The bank has not confirmed this payment.' });
      setOpen(null);
    } catch (e) { show({ tone: 'danger', title: 'Could not refresh', message: errorMessage(e) }); } finally { setBusy(null); }
  };

  const active = tab === 'payments' ? payments : invoices;
  return (
    <Screen onRefresh={() => active.refetch()} refreshing={active.isRefetching}>
      <Header title="Payments" />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'payments', label: 'Payments' }, { value: 'invoices', label: 'Invoices' }]} />
      <View style={{ height: spacing.lg }} />

      {tab === 'payments' ? (
        payments.isLoading ? <CardSkeleton /> : payments.isError ? <ErrorState message={errorMessage(payments.error)} onRetry={() => payments.refetch()} /> : !payments.data?.length ? (
          <EmptyState icon="credit-card" title="No payments yet" message="Your payments will appear here after you subscribe." />
        ) : payments.data.map((p) => (
          <Card key={p.id} onPress={() => setOpen(p)} testID={`payment-${p.id}`} style={{ marginBottom: spacing.sm }} accessibilityLabel={`Payment of ${money(p.amountMinor)}, ${p.status}`}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="h3">{money(p.amountMinor)}</Text>
              <StatusPill status={p.status} />
            </Row>
            <Text variant="small" muted style={{ marginTop: 4 }}>{formatDateTime(p.createdAt)}{p.periodStart ? ` · covers ${formatDate(p.periodStart)} to ${formatDate(p.periodEnd!)}` : ''}</Text>
            {p.status === 'failed' && p.failureReason ? <Text variant="small" style={{ marginTop: 4 }} color="#B93A2B">{p.failureReason}</Text> : null}
          </Card>
        ))
      ) : invoices.isLoading ? <CardSkeleton /> : invoices.isError ? <ErrorState message={errorMessage(invoices.error)} onRetry={() => invoices.refetch()} /> : !invoices.data?.length ? (
        <EmptyState icon="file-text" title="No invoices yet" message="An invoice is created for every successful payment." />
      ) : invoices.data.map((i) => (
        <Card key={i.id} style={{ marginBottom: spacing.sm }} testID={`invoice-${i.id}`}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View><Text weight="semibold">{i.invoiceNumber}</Text><Text variant="small" muted>{formatDateTime(i.issuedAt)}</Text></View>
            <Text variant="h3">{money(i.amountMinor)}</Text>
          </Row>
          <View style={{ marginTop: spacing.md }}><Button title="Download receipt" size="sm" variant="secondary" icon="download" loading={busy === i.id} onPress={() => receipt(i.id, i.invoiceNumber)} testID={`receipt-${i.id}`} /></View>
        </Card>
      ))}

      <BottomSheet visible={!!open} title="Payment details" onClose={() => setOpen(null)}>
        {open ? (
          <View style={{ gap: spacing.sm }}>
            <Row style={{ justifyContent: 'space-between' }}><Text variant="display">{money(open.amountMinor)}</Text><StatusPill status={open.status} /></Row>
            <Detail k="Date" v={formatDateTime(open.createdAt)} />
            {open.method ? <Detail k="Method" v={open.method.toUpperCase()} /> : null}
            {open.providerPaymentId ? <Detail k="Reference" v={open.providerPaymentId} /> : null}
            {open.periodStart ? <Detail k="Billing period" v={`${formatDate(open.periodStart)} to ${formatDate(open.periodEnd!)}`} /> : null}
            {open.invoiceNumber ? <Detail k="Invoice" v={open.invoiceNumber} /> : null}
            {open.refundedMinor ? <Detail k="Refunded" v={money(open.refundedMinor)} /> : null}
            {open.status === 'failed' ? <Banner tone="danger" title="Payment failed" message={open.failureReason ?? 'The bank declined this payment. No money was taken. If money was debited it is automatically refunded by your bank.'} /> : null}
            {open.status === 'pending' ? <Banner tone="warn" title="Waiting for confirmation" message="If your account was debited, this updates automatically once the bank confirms." /> : null}
            {open.status === 'refunded' || open.status === 'partially_refunded' ? <Banner tone="info" title="Refund status" message="Refunds typically reach your original payment method in 5 to 7 working days." /> : null}
            {open.invoiceId ? <Button title="Download receipt" icon="download" variant="secondary" loading={busy === open.invoiceId} onPress={() => receipt(open.invoiceId!, open.invoiceNumber ?? 'receipt')} testID="sheet-receipt" /> : null}
            {(open.status === 'pending' || open.status === 'failed') ? <Button title="Refresh status" icon="refresh-cw" variant="secondary" loading={busy === open.id} onPress={() => refreshStatus(open)} testID="refresh-status" /> : null}
            {(open.status === 'pending' || open.status === 'failed') && open.subscriptionId ? <Button title="Retry payment" loading={pay.busyId === open.subscriptionId} onPress={() => { const sid = open.subscriptionId!; setOpen(null); pay.start({ id: sid, status: 'pending_payment' }); }} testID="retry-payment" /> : null}
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return <Row style={{ justifyContent: 'space-between' }}><Text muted>{k}</Text><Text weight="semibold" selectable style={{ maxWidth: '65%', textAlign: 'right' }}>{v}</Text></Row>;
}
