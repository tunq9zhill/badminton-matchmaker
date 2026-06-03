import { create } from "zustand";

export type ToastAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export type Toast = {
  id: string;
  message: string;
  kind: "info" | "error" | "success";
  title?: string;
  primaryAction?: ToastAction;
  secondaryAction?: ToastAction;
};

type AppState = {
  toast?: Toast;
  setToast: (t?: Toast) => void;
};

export const useAppStore = create<AppState>((set) => ({
  toast: undefined,
  setToast: (toast) => set({ toast }),
}));
