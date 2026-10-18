import { create } from 'zustand';
import type { ISODate } from '@milk/shared';
import type { Product, Variant } from '@/lib/types';

export interface CartItem {
  variantId: string;
  quantity: number;
  productName: string;
  variantName: string;
  sizeLabel: string;
  priceMinor: number;
  slug: string;
  category: string;
  imageUrl: string | null;
}
export interface CartSchedule {
  frequency: 'daily' | 'alternate_days' | 'weekdays';
  weekdays: number[];
  startDate: ISODate | null;
}

interface CartState {
  items: CartItem[];
  schedule: CartSchedule;
  addressId: string | null;
  couponCode: string | null;
  add: (p: Product, v: Variant, quantity: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  setSchedule: (s: Partial<CartSchedule>) => void;
  setAddress: (id: string | null) => void;
  setCoupon: (c: string | null) => void;
  clear: () => void;
  count: () => number;
}

const freshSchedule = (): CartSchedule => ({ frequency: 'daily', weekdays: [1, 2, 3, 4, 5], startDate: null });

export const useCart = create<CartState>((set, get) => ({
  items: [],
  schedule: freshSchedule(),
  addressId: null,
  couponCode: null,
  add: (p, v, quantity) =>
    set((s) => {
      const existing = s.items.find((i) => i.variantId === v.id);
      if (existing) {
        return { items: s.items.map((i) => (i.variantId === v.id ? { ...i, quantity: Math.min(20, i.quantity + quantity) } : i)) };
      }
      return {
        items: [
          ...s.items,
          {
            variantId: v.id,
            quantity,
            productName: p.name,
            variantName: v.name,
            sizeLabel: v.sizeLabel,
            priceMinor: v.priceMinor,
            slug: p.slug,
            category: p.category,
            imageUrl: p.imageUrl,
          },
        ],
      };
    }),
  setQuantity: (variantId, quantity) => set((s) => ({ items: s.items.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)) })),
  remove: (variantId) => set((s) => ({ items: s.items.filter((i) => i.variantId !== variantId) })),
  setSchedule: (sch) => set((s) => ({ schedule: { ...s.schedule, ...sch } })),
  setAddress: (addressId) => set({ addressId }),
  setCoupon: (couponCode) => set({ couponCode }),
  clear: () => set({ items: [], schedule: freshSchedule(), addressId: null, couponCode: null }),
  count: () => get().items.reduce((n, i) => n + i.quantity, 0),
}));
