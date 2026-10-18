import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { FlatList, View, useWindowDimensions, type ViewToken } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProductIllustration } from '@/components/ProductArt';
import { Button, Text } from '@/components/ui';
import { config } from '@/lib/config';
import { useAuth } from '@/store/auth';
import { palette, spacing } from '@/theme/tokens';

const SLIDES = [
  { slug: 'farm-fresh-cow-milk', category: 'milk', title: 'Farm-fresh, before sunrise', body: 'Pasteurised milk and set curd from local farms, at your door every morning.' },
  { slug: 'set-curd', category: 'curd', title: 'Your schedule, your rules', body: 'Daily, alternate days or the weekdays you pick. Pause, skip or change anytime before the evening cutoff.' },
  { slug: 'a2-desi-cow-milk', category: 'milk', title: 'Pay once, relax', body: 'Prepay securely with UPI or card. Skipped days are never wasted: your plan simply lasts longer.' },
];

export default function Onboarding() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const finish = useAuth((s) => s.finishOnboarding);
  const ref = useRef<FlatList>(null);
  const onView = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => { if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index); }).current;

  const go = async () => { await finish(); router.replace('/(auth)/phone'); };
  const next = () => (index < SLIDES.length - 1 ? ref.current?.scrollToIndex({ index: index + 1 }) : go());

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.forest700 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
        <Text variant="h2" color={palette.white}>{config.appName}</Text>
        <Text weight="semibold" color={palette.lime400} onPress={go} accessibilityRole="button" style={{ padding: 8 }}>Skip</Text>
      </View>
      <FlatList
        ref={ref}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s) => s.slug}
        onViewableItemsChanged={onView}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => (
          <View style={{ width, paddingHorizontal: spacing.xl, justifyContent: 'center', alignItems: 'center' }}>
            <Animated.View entering={FadeInUp.duration(450)} style={{ borderRadius: 48, overflow: 'hidden', marginBottom: spacing.xxl }}>
              <ProductIllustration slug={item.slug} category={item.category} size={Math.min(260, width * 0.66)} />
            </Animated.View>
            <Text variant="display" color={palette.white} center>{item.title}</Text>
            <Text color={palette.forest100} center style={{ marginTop: spacing.md, maxWidth: 340 }}>{item.body}</Text>
          </View>
        )}
      />
      <View style={{ padding: spacing.xl, gap: spacing.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }} accessibilityLabel={`Page ${index + 1} of ${SLIDES.length}`}>
          {SLIDES.map((s, i) => (
            <View key={s.slug} style={{ width: i === index ? 26 : 8, height: 8, borderRadius: 4, backgroundColor: i === index ? palette.lime500 : 'rgba(255,255,255,0.35)' }} />
          ))}
        </View>
        <Button title={index === SLIDES.length - 1 ? 'Get started' : 'Next'} variant="accent" onPress={next} testID="onboarding-next" />
      </View>
    </SafeAreaView>
  );
}
