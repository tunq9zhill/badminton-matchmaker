import { create } from "zustand";

type Toast = { id: string; message: string; kind: "info" | "error" | "success" };

type AppState = {
  toast?: Toast;
  setToast: (t?: Toast) => void;
};

export const useAppStore = create<AppState>((set) => ({
  toast: undefined,
  setToast: (toast) => set({ toast }),
}));
