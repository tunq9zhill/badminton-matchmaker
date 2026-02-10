import type { ReactNode } from "react";

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  type?: "button" | "submit";
}) {
  const v = props.variant ?? "primary";
  const base =
    "w-full select-none rounded-xl px-4 py-3 text-base font-semibold shadow-sm active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100";
  const styles =
    v === "primary"
      ? "bg-slate-900 text-white"
      : v === "danger"
      ? "bg-rose-600 text-white"
      : "bg-white text-slate-900 border border-slate-200";

  return (
    <button
      type={props.type ?? "button"}
      className={`${base} ${styles} ${props.className ?? ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}
