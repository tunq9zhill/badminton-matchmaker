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
    await new Promise((r) => setTimeout(r, 450));
    await cb();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center p-4 transition-colors duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "bg-black/35" : "bg-black/0"}`}
      onClick={() => void closeWith(props.onCancel)}
    >
      <div
        className={`w-full max-w-md squircle rounded-[20px] border border-slate-200 bg-white p-5 shadow-xl transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-90"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold">{props.title}</div>
        <div className="mt-2 text-sm text-slate-600">{props.description}</div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="rounded-[16px] border border-slate-200 px-3 py-2 text-sm font-semibold" onClick={() => void closeWith(props.onCancel)}>ยกเลิก</button>
          <button className="rounded-[16px] bg-rose-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void closeWith(props.onConfirm)}>
            {props.confirmLabel ?? "ยืนยัน"}
          </button>
        </div>
      </div>
    </div>
  );
}
