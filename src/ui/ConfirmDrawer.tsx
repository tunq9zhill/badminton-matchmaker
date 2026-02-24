import type { ReactNode } from "react";

export function ConfirmDrawer(props: {
  title: string;
  description: ReactNode;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0" onClick={props.onCancel}>
      <div
        className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold">{props.title}</div>
        <div className="mt-2 text-sm text-slate-600">{props.description}</div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" onClick={props.onCancel}>ยกเลิก</button>
          <button className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void props.onConfirm()}>
            {props.confirmLabel ?? "ยืนยัน"}
          </button>
        </div>
      </div>
    </div>
  );
}
