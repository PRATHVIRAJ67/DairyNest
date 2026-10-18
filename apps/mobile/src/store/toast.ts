import { create } from 'zustand';

export interface ToastMsg {
  id: number;
  tone: 'success' | 'danger' | 'info';
  title: string;
  message?: string;
}
interface ToastState {
  toast: ToastMsg | null;
  show: (t: Omit<ToastMsg, 'id'>) => void;
  hide: () => void;
}
let n = 0;
export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (t) => {
    const id = ++n;
    set({ toast: { ...t, id } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), 4200);
  },
  hide: () => set({ toast: null }),
}));
