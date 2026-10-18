import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, CardSkeleton, Dialog, EmptyState, ErrorState, Header, Row, Screen, Text } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAddresses, useDeleteAddress, useSetDefaultAddress } from '@/lib/queries';
import type { Address } from '@/lib/types';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export default function Addresses() {
  const router = useRouter();
  const { colors } = useTheme();
  const q = useAddresses();
  const del = useDeleteAddress();
  const setDefault = useSetDefaultAddress();
  const show = useToast((s) => s.show);
  const [target, setTarget] = useState<Address | null>(null);

  const remove = async () => {
    if (!target) return;
    try { await del.mutateAsync(target.id); show({ tone: 'success', title: 'Address deleted' }); }
    catch (e) { show({ tone: 'danger', title: 'Could not delete', message: errorMessage(e) }); }
    setTarget(null);
  };

  return (
    <Screen
      onRefresh={() => q.refetch()}
      refreshing={q.isRefetching}
      footer={<Button title="Add new address" icon="plus" onPress={() => router.push('/addresses/edit')} testID="add-address" />}
    >
      <Header title="Addresses" />
      {q.isLoading ? <CardSkeleton /> : q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <EmptyState icon="map-pin" title="No addresses yet" message="Add where you would like your milk delivered." />
      ) : q.data.map((a) => (
        <Card key={a.id} style={{ marginBottom: spacing.md }} testID={`address-${a.id}`}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 8 }}>
              <Feather name={a.label.toLowerCase() === 'office' || a.label.toLowerCase() === 'work' ? 'briefcase' : 'home'} size={18} color={colors.primary} />
              <Text variant="h3">{a.label}</Text>
            </Row>
            {a.isDefault ? <View style={{ backgroundColor: colors.successBg, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill }}><Text variant="caption" weight="bold" color={colors.success}>DEFAULT</Text></View> : null}
          </Row>
          <Text style={{ marginTop: 8 }}>{a.recipientName} · {a.phone}</Text>
          <Text muted>{[a.line1, a.line2, a.landmark && `Near ${a.landmark}`, `${a.city} ${a.postalCode}`].filter(Boolean).join(', ')}</Text>
          {a.deliveryInstructions ? <Text variant="small" muted style={{ marginTop: 4 }}>Note: {a.deliveryInstructions}</Text> : null}
          {!a.zoneId ? <View style={{ marginTop: spacing.sm }}><Banner tone="warn" title="Not serviceable yet" message="We do not deliver to this PIN code yet." /></View> : null}
          <Row style={{ gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
            <Button title="Edit" size="sm" variant="secondary" full={false} icon="edit-2" onPress={() => router.push({ pathname: '/addresses/edit', params: { id: a.id } })} testID={`edit-${a.id}`} />
            {!a.isDefault ? <Button title="Make default" size="sm" variant="ghost" full={false} onPress={() => setDefault.mutate(a.id, { onError: (e) => show({ tone: 'danger', title: 'Could not update', message: errorMessage(e) }) })} testID={`default-${a.id}`} /> : null}
            <Button title="Delete" size="sm" variant="danger" full={false} icon="trash-2" onPress={() => setTarget(a)} testID={`delete-${a.id}`} />
          </Row>
        </Card>
      ))}
      <Dialog visible={!!target} destructive title="Delete this address?" message={`${target?.label ?? ''} will be removed. Addresses used by an active subscription cannot be deleted.`} confirmLabel="Delete" loading={del.isPending} onCancel={() => setTarget(null)} onConfirm={remove} />
    </Screen>
  );
}
