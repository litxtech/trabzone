import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type CartItem = {
  listingId: string;
  sellerId: string;
  sellerUsername: string;
  title: string;
  priceCents: number;
  currency: string;
  imagePath: string | null;
  stock: number;
  quantity: number;
};

type CartState = {
  items: CartItem[];
  add: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  remove: (listingId: string) => void;
  setQuantity: (listingId: string, quantity: number) => void;
  removeSeller: (sellerId: string) => void;
  clear: () => void;
};

/**
 * Sepet yalnızca istemci tarafında tutulan bir niyet listesidir: ödeme veya
 * stok rezervasyonu iddia etmez. Sipariş, `market_create_order` RPC'si ile
 * sunucuda oluşturulur ve stok orada düşülür.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      add: (item, quantity = 1) =>
        set((state) => {
          const existing = state.items.find((entry) => entry.listingId === item.listingId);
          if (existing) {
            return {
              items: state.items.map((entry) =>
                entry.listingId === item.listingId
                  ? {
                      ...entry,
                      quantity: Math.min(entry.quantity + quantity, Math.max(item.stock, 1)),
                      stock: item.stock,
                      priceCents: item.priceCents,
                    }
                  : entry,
              ),
            };
          }
          return {
            items: [...state.items, { ...item, quantity: Math.min(quantity, Math.max(item.stock, 1)) }],
          };
        }),
      remove: (listingId) =>
        set((state) => ({ items: state.items.filter((entry) => entry.listingId !== listingId) })),
      setQuantity: (listingId, quantity) =>
        set((state) => ({
          items: state.items.map((entry) =>
            entry.listingId === listingId
              ? { ...entry, quantity: Math.max(1, Math.min(quantity, Math.max(entry.stock, 1))) }
              : entry,
          ),
        })),
      removeSeller: (sellerId) =>
        set((state) => ({ items: state.items.filter((entry) => entry.sellerId !== sellerId) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: 'trabzone.cart.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ items }) => ({ items }),
    },
  ),
);

export function cartTotal(items: CartItem[]): number {
  return items.reduce((total, entry) => total + entry.priceCents * entry.quantity, 0);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((total, entry) => total + entry.quantity, 0);
}
