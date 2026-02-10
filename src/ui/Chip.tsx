import type { ReactNode } from "react";

export function Chip(props: { children: ReactNode; tone?: "good" | "warn" | "muted" }) {
  const t = props.tone ?? "muted";
  const cls =
    t === "good"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : t === "warn"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-slate-50 text-slate-700 border-slate-200";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{props.children}</span>;
}
