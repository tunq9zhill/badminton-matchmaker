import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./Button";

export function Modal(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const closeWith = async (cb: () => void) => {
    if (closing) return;
    setClosing(true);
    setOpen(false);
    await new Promise((r) => setTimeout(r, 450));
    cb();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center p-0 transition-colors duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "bg-black/35" : "bg-black/0"}`}
      onClick={() => void closeWith(props.onClose)}
    >
      <div
        className={`w-full max-w-md squircle rounded-t-3xl border border-slate-200 bg-white shadow-xl transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-90"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-semibold">{props.title}</div>
          <button className="text-sm text-slate-500" onClick={() => void closeWith(props.onClose)}>Close</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{props.children}</div>
        <div className="px-4 py-3 border-t border-slate-100">
          {props.actions ?? <Button variant="secondary" onClick={() => void closeWith(props.onClose)}>OK</Button>}
        </div>
      </div>
    </div>
  );
}
