import type { ReactNode } from "react";

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white shadow-sm border border-slate-200 max-h-[420px] overflow-hidden flex flex-col ${props.className ?? ""}`}>
      {props.children}
    </div>
  );
}

export function CardHeader(props: { title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
      <div className="text-sm font-semibold">{props.title}</div>
      {props.right}
    </div>
  );
}

export function CardBody(props: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3 overflow-y-auto ${props.className ?? ""}`}>{props.children}</div>;
}
