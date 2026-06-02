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
      className={`fixed inset-0 z-50 flex items-end justify-center p-4 transition-colors duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "bg-[#07160F]/75 backdrop-blur-sm" : "bg-black/0"}`}
      onClick={() => void closeWith(props.onClose)}
    >
      <div
        className={`w-full max-w-md rounded-[20px] border border-white/10 bg-[#183223] p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,0.35)] transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-90"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-5">
          <div className="text-[16px] font-medium leading-5 text-white">{props.title}</div>
          <button className="text-[14px] font-medium text-white/55 transition-colors hover:text-white" onClick={() => void closeWith(props.onClose)}>Close</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto text-white">{props.children}</div>
        <div className="mt-5 border-t border-white/10 pt-5">
          {props.actions ?? <Button variant="secondary" onClick={() => void closeWith(props.onClose)}>OK</Button>}
        </div>
      </div>
    </div>
  );
}
