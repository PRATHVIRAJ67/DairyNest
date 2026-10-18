import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PauseSheet } from '@/components/PauseSheet';
import { ProductIllustration } from '@/components/ProductArt';
import { ProductCard } from '@/components/ProductCard';
import { SubscriptionCard } from '@/components/SubscriptionCard';
import { Banner, Button, Card, CardSkeleton, Dialog, Row, Screen, SectionHeader, Skeleton, Text, formatDate } from '@/components/ui';
import { usePayFlow } from '@/hooks/usePay';
import { errorMessage } from '@/lib/api';
import { config } from '@/lib/config';
import { greeting, todayIST, windowLabel } from '@/lib/format';
import { qk, subActions, useAddresses, useMe, useNotifications, useProducts, useSubAction, useSubscriptions, useUpcoming } from '@/lib/queries';
import type { Subscription } from '@/lib/types';
import { useToast } from '@/store/toast';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing } from '@/theme/tokens';

function ResumeButton({ sub }: { sub: Subscription }) {
  const [open, setOpen] = useState(false);
  const show = useToast((s) => s.show);
  const resume = useSubAction(sub.id, () => subActions.resume(sub.id));
  const go = async () => {
    try {
      await resume.mutateAsync();
      setOpen(false);
      show({ tone: 'success', title: 'Welcome back', message: 'Deliveries will restart from the next available day.' });
    } catch (e) {
      show({ tone: 'danger', title: 'Could not resume', message: errorMessage(e) });
    }
  };
  return (
    <>
      <Button title="Resume" size="sm" variant="accent" icon="play" onPress={() => setOpen(true)} testID={`resume-${sub.id}`} />
      <Dialog visible={open} title="Resume deliveries?" message={`Deliveries restart from ${formatDate(sub.rules.earliestChangeableDate)}. Your prepaid deliveries continue where they left off.`} confirmLabel="Resume" onConfirm={go} onCancel={() => setOpen(false)} loading={resume.isPending} />
    </>
  );
}

export default function Home() {
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const addresses = useAddresses();
  const subs = useSubscriptions();
  const upcoming = useUpcoming();
  const featured = useProducts({ featured: true });
  const notifications = useNotifications();
  const [pauseFor, setPauseFor] = useState<Subscription | null>(null);
  const pay = usePayFlow();

  const activeIds = useMemo(() => (subs.data ?? []).filter((s) => s.status === 'active').map((s) => s.id).join(','), [subs.data]);
  // No background scheduler exists: top up upcoming deliveries whenever the customer opens the app.
  useEffect(() => {
    if (!activeIds) return;
    Promise.all(activeIds.split(',').map((id) => subActions.generate(id).catch(() => null))).then((r) => {
      if (r.some((x) => x && x.created > 0)) qc.invalidateQueries({ queryKey: qk.upcoming });
    });
  }, [activeIds, qc]);

  const refreshing = subs.isRefetching || upcoming.isRefetching;
  const refresh = () => { subs.refetch(); upcoming.refetch(); addresses.refetch(); notifications.refetch(); featured.refetch(); };

  const defaultAddress = addresses.data?.find((a) => a.isDefault) ?? addresses.data?.[0];
  const today = todayIST();
  const todays = (upcoming.data ?? []).filter((d) => d.deliveryDate === today);
  const next = upcoming.data?.[0];
  const needsPayment = (subs.data ?? []).filter((s) => s.status === 'pending_payment' || s.status === 'past_due');
  const live = (subs.data ?? []).filter((s) => s.status === 'active' || s.status === 'paused');
  const unread = notifications.data?.unread ?? 0;
  const firstName = me.data?.fullName.split(' ')[0] ?? '';

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text muted>{greeting(new Date().getHours())}</Text>
          <Text variant="display" numberOfLines={1} testID="greeting">{firstName || 'there'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`} onPress={() => router.push('/notifications')} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="bell" size={20} color={colors.text} />
          {unread > 0 ? (
            <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
              <Text variant="caption" color="#fff" weight="bold" style={{ fontSize: 10, lineHeight: 12 }}>{unread > 9 ? '9+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Change delivery address" onPress={() => router.push('/addresses')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.lg }} testID="home-address">
        <Feather name="map-pin" size={16} color={colors.primary} />
        {addresses.isLoading ? <Skeleton width={180} height={14} /> : defaultAddress ? (
          <Text variant="small" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>Delivering to {defaultAddress.label} · {defaultAddress.line1}, {defaultAddress.postalCode}</Text>
        ) : (
          <Text variant="small" weight="semibold" color={colors.primary} style={{ flex: 1 }}>Add a delivery address</Text>
        )}
        <Feather name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>

      {needsPayment.map((s) => (
        <View key={s.id} style={{ marginTop: spacing.lg }}>
          <Banner
            testID={`pay-banner-${s.id}`}
            tone={s.status === 'past_due' ? 'danger' : 'warn'}
            title={s.status === 'past_due' ? 'Your prepaid deliveries have run out' : 'Payment pending'}
            message={s.status === 'past_due' ? 'Renew to keep your morning delivery going.' : s.billing.lastPayment?.status === 'failed' ? `Last attempt failed: ${s.billing.lastPayment.failureReason ?? 'payment declined'}. Try again to activate your plan.` : 'Complete payment to activate your subscription.'}
            actionLabel={pay.busyId === s.id ? 'Opening…' : s.status === 'past_due' ? 'Renew now' : 'Pay now'}
            onAction={() => pay.start(s)}
          />
        </View>
      ))}

      <Animated.View entering={FadeInDown.duration(400)}>
        <View style={{ marginTop: spacing.lg, borderRadius: radius.xl, backgroundColor: palette.forest700, padding: spacing.xl, overflow: 'hidden' }}>
          <Text variant="caption" color={palette.lime400}>TODAY</Text>
          {upcoming.isLoading || subs.isLoading ? <Skeleton height={60} style={{ marginTop: 10 }} /> : todays.length ? (
            <>
              <Text variant="h1" color={palette.white} style={{ marginTop: 6 }}>{todays[0].displayStatus === 'delivered' ? 'Delivered' : 'Arriving ' + windowLabel(todays[0].windowStart, todays[0].windowEnd)}</Text>
              <Text color={palette.forest100} style={{ marginTop: 6 }}>{todays.flatMap((d) => d.items).map((i) => `${i.quantity} x ${i.name}`).join(' · ')}</Text>
            </>
          ) : (
            <>
              <Text variant="h1" color={palette.white} style={{ marginTop: 6 }}>{live.length ? 'No delivery today' : 'Start your first plan'}</Text>
              <Text color={palette.forest100} style={{ marginTop: 6 }}>{next ? `Next delivery ${formatDate(next.deliveryDate)}, ${windowLabel(next.windowStart, next.windowEnd)}` : live.length ? 'Nothing scheduled right now.' : 'Fresh milk and curd, delivered before breakfast.'}</Text>
            </>
          )}
          {!live.length && !subs.isLoading ? <View style={{ marginTop: spacing.lg }}><Button title="Browse products" variant="accent" onPress={() => router.push('/(tabs)/shop')} full={false} testID="home-browse" /></View> : null}
        </View>
      </Animated.View>

      {next && live.length ? (
        <Card style={{ marginTop: spacing.md }} onPress={() => router.push(`/delivery/${next.id}`)} accessibilityLabel="Next delivery details">
          <Row style={{ gap: spacing.md }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Feather name="truck" size={20} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text variant="small" muted>Next delivery</Text>
              <Text weight="semibold">{formatDate(next.deliveryDate)} · {windowLabel(next.windowStart, next.windowEnd)}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textMuted} />
          </Row>
        </Card>
      ) : null}

      <SectionHeader title="Shop by category" />
      <Row style={{ gap: spacing.md }}>
        {[{ k: 'milk', t: 'Milk', s: 'farm-fresh-cow-milk' }, { k: 'curd', t: 'Curd', s: 'set-curd' }].map((c) => (
          <Pressable key={c.k} testID={`category-${c.k}`} accessibilityRole="button" accessibilityLabel={`Shop ${c.t}`} onPress={() => router.push({ pathname: '/(tabs)/shop', params: { category: c.k } })} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' }}>
            <View style={{ borderRadius: radius.md, overflow: 'hidden' }}>
              <ProductIllustration slug={c.s} category={c.k} size={96} />
            </View>
            <Text weight="semibold" style={{ marginTop: 8 }}>{c.t}</Text>
          </Pressable>
        ))}
      </Row>

      {live.length ? (
        <>
          <SectionHeader title="Your plans" action="See all" onAction={() => router.push('/(tabs)/subscriptions')} />
          {live.slice(0, 2).map((s) => (
            <SubscriptionCard
              key={s.id}
              sub={s}
              onPress={() => router.push(`/subscription/${s.id}`)}
              footer={s.status === 'paused' ? <ResumeButton sub={s} /> : <Button title="Pause" size="sm" variant="secondary" icon="pause" onPress={() => setPauseFor(s)} testID={`quick-pause-${s.id}`} />}
            />
          ))}
        </>
      ) : null}

      <SectionHeader title="Featured" action="View all" onAction={() => router.push('/(tabs)/shop')} />
      {featured.isLoading ? <CardSkeleton /> : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingBottom: 4 }}>
          {(featured.data ?? []).map((p) => <ProductCard key={p.id} product={p} width={170} onPress={() => router.push(`/product/${p.slug}`)} />)}
        </ScrollView>
      )}

      <Card style={{ marginTop: spacing.xl }} onPress={() => router.push('/support')} accessibilityLabel="Customer support">
        <Row style={{ gap: spacing.md }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Feather name="headphones" size={20} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text weight="semibold">Need help?</Text>
            <Text variant="small" muted>Raise a ticket or read the FAQs</Text>
          </View>
          {config.supportPhone ? <Button title="Call" size="sm" variant="secondary" full={false} onPress={() => Linking.openURL(`tel:${config.supportPhone}`)} /> : <Feather name="chevron-right" size={18} color={colors.textMuted} />}
        </Row>
      </Card>

      {subs.isError ? <Banner tone="danger" title="Could not load your plans" message={errorMessage(subs.error)} actionLabel="Retry" onAction={() => subs.refetch()} /> : null}
      {pauseFor ? <PauseSheet sub={pauseFor} visible onClose={() => setPauseFor(null)} /> : null}
    </Screen>
  );
}
