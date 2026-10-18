import { useRouter } from 'expo-router';
import React from 'react';
import { BottomSheet, Button, EmptyState, OptionCard, Skeleton, Text } from '@/components/ui';
import { useAddresses } from '@/lib/queries';
import type { Address } from '@/lib/types';
import { spacing } from '@/theme/tokens';

export function AddressPicker({ visible, selectedId, onSelect, onClose }: { visible: boolean; selectedId?: string | null; onSelect: (a: Address) => void; onClose: () => void }) {
  const router = useRouter();
  const addresses = useAddresses();
  return (
    <BottomSheet visible={visible} title="Delivery address" onClose={onClose}>
      {addresses.isLoading ? <Skeleton height={64} /> : !addresses.data?.length ? (
        <EmptyState icon="map-pin" title="No saved addresses" message="Add the address where your milk should be delivered." />
      ) : (
        addresses.data.map((a) => (
          <OptionCard
            key={a.id}
            testID={`pick-address-${a.id}`}
            title={`${a.label}${a.isDefault ? ' (default)' : ''}`}
            subtitle={`${a.line1}, ${a.city} ${a.postalCode}${a.zoneId ? '' : ' · not serviceable yet'}`}
            selected={a.id === selectedId}
            onPress={() => a.zoneId && onSelect(a)}
          />
        ))
      )}
      <Text variant="small" muted style={{ marginVertical: spacing.sm }}>Addresses outside our delivery areas cannot be selected.</Text>
      <Button title="Add a new address" variant="secondary" icon="plus" onPress={() => { onClose(); router.push('/addresses/edit'); }} testID="add-address-from-picker" />
    </BottomSheet>
  );
}
