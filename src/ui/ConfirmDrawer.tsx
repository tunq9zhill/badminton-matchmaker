import { useEffect, useState, type ReactNode } from "react";

export function ConfirmDrawer(props: {
  title: string;
  description: ReactNode;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const closeWith = async (cb: () => void | Promise<void>) => {
    if (closing) return;
    setClosing(true);
    setOpen(false);
    await new Promise((r) => setTimeout(r, 220));
    await cb();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center p-0 transition-colors duration-200 ease-[cubic-bezier(0.38,1.37,0.33,1)] ${open ? "bg-black/35" : "bg-black/0"}`}
      onClick={() => void closeWith(props.onCancel)}
    >
      <div
        className={`w-full max-w-md squircle rounded-t-3xl border border-slate-200 bg-white p-4 shadow-xl transition-all duration-300 ease-[cubic-bezier(0.38,1.37,0.33,1)] ${open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-90"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold">{props.title}</div>
        <div className="mt-2 text-sm text-slate-600">{props.description}</div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold" onClick={() => void closeWith(props.onCancel)}>ยกเลิก</button>
          <button className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void closeWith(props.onConfirm)}>
            {props.confirmLabel ?? "ยืนยัน"}
          </button>
        </div>
      </div>
    </div>
  );
}
