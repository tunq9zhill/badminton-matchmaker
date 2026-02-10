import type { ReactNode } from "react";
import { Button } from "./Button";

export function Modal(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-3">
      <div className="w-full sm:max-w-md rounded-2xl bg-white shadow-xl border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-semibold">{props.title}</div>
          <button className="text-sm text-slate-500" onClick={props.onClose}>Close</button>
        </div>
        <div className="px-4 py-3">{props.children}</div>
        <div className="px-4 py-3 border-t border-slate-100">
          {props.actions ?? <Button variant="secondary" onClick={props.onClose}>OK</Button>}
        </div>
      </div>
    </div>
  );
}
