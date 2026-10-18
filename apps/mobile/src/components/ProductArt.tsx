import { Image } from 'expo-image';
import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

const TINTS: Record<string, { bg: [string, string]; liquid: string; label: string }> = {
  'farm-fresh-cow-milk': { bg: ['#E8F3E4', '#D3E8CF'], liquid: '#FFFFFF', label: '#1F5C3A' },
  'a2-desi-cow-milk': { bg: ['#F6EFD9', '#EBE0BE'], liquid: '#FFF9EA', label: '#8A5A12' },
  'toned-milk': { bg: ['#E3EEF6', '#CFE1EE'], liquid: '#FFFFFF', label: '#1E5F8C' },
  'buffalo-milk': { bg: ['#F1E9DA', '#E4D8C0'], liquid: '#FFF6E2', label: '#6B4A1E' },
  'set-curd': { bg: ['#F4F7E4', '#E6EEC4'], liquid: '#FFFDF5', label: '#4F7A12' },
  'greek-curd': { bg: ['#EAF0F7', '#D8E3F0'], liquid: '#FFFFFF', label: '#2B5C8F' },
  'probiotic-curd': { bg: ['#F7EAEE', '#F0D6DE'], liquid: '#FFFDFB', label: '#9B3A5A' },
};
const FALLBACK = TINTS['farm-fresh-cow-milk'];

/** Vector illustration used until a real product photo is uploaded to Supabase Storage. */
export function ProductIllustration({ slug, category, size = 160 }: { slug?: string; category: string; size?: number }) {
  const t = (slug && TINTS[slug]) || FALLBACK;
  const id = `g-${slug ?? category}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={t.bg[1]} stopOpacity="0.55" />
          <Stop offset="1" stopColor={t.bg[1]} />
        </LinearGradient>
        <LinearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.9" />
          <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.8" />
        </LinearGradient>
      </Defs>
      <Rect width="160" height="160" fill={t.bg[0]} />
      <Circle cx="80" cy="86" r="66" fill={`url(#${id})`} />
      <Ellipse cx="80" cy="140" rx="46" ry="7" fill="#0B2E1C" opacity="0.1" />
      {category === 'curd' ? (
        <G>
          <Path d="M38 62 L46 132 Q47 140 56 140 L104 140 Q113 140 114 132 L122 62 Z" fill={t.liquid} stroke="#D9D2BC" strokeWidth="1.5" />
          <Rect x="34" y="52" width="92" height="14" rx="7" fill={t.label} />
          <Rect x="34" y="52" width="92" height="5" rx="2.5" fill="#FFFFFF" opacity="0.25" />
          <Rect x="52" y="82" width="56" height="34" rx="8" fill={t.label} opacity="0.12" />
          <Circle cx="80" cy="99" r="9" fill={t.label} opacity="0.85" />
          <Path d="M76 99 q4 -7 8 0 q-4 7 -8 0z" fill="#fff" opacity="0.9" />
        </G>
      ) : (
        <G>
          <Rect x="62" y="22" width="36" height="16" rx="5" fill={t.label} />
          <Path d="M64 38 L64 52 Q44 62 44 84 L44 130 Q44 140 54 140 L106 140 Q116 140 116 130 L116 84 Q116 62 96 52 L96 38 Z" fill={t.liquid} stroke="#D9D2BC" strokeWidth="1.5" />
          <Path d="M44 96 L116 96 L116 130 Q116 140 106 140 L54 140 Q44 140 44 130 Z" fill={t.liquid} opacity="0.95" />
          <Rect x="52" y="82" width="56" height="40" rx="9" fill={t.label} opacity="0.1" />
          <Path d="M80 90 q-9 11 0 19 q9 -8 0 -19z" fill={t.label} />
          <SvgText x="80" y="124" fontSize="9" fontWeight="700" fill={t.label} textAnchor="middle">FRESH</SvgText>
          <Rect x="50" y="62" width="10" height="70" rx="5" fill={`url(#${id}-glass)`} opacity="0.7" />
        </G>
      )}
    </Svg>
  );
}

export const tintFor = (slug?: string) => ((slug && TINTS[slug]) || FALLBACK).bg[0];

export function ProductImage({ imageUrl, slug, category, height = 140, rounded = radius.lg }: { imageUrl?: string | null; slug?: string; category: string; height?: number; rounded?: number }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const showPhoto = !!imageUrl && !failed;
  return (
    <View style={{ height, borderRadius: rounded, overflow: 'hidden', backgroundColor: showPhoto ? colors.surfaceAlt : tintFor(slug), alignItems: 'center', justifyContent: 'center' }}>
      {showPhoto ? (
        <Image source={{ uri: imageUrl! }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={200} onError={() => setFailed(true)} accessibilityLabel={`${slug ?? category} photo`} />
      ) : (
        <ProductIllustration slug={slug} category={category} size={height} />
      )}
    </View>
  );
}
