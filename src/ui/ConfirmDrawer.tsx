import { useEffect, useState, type ReactNode } from "react";

export function ConfirmDrawer(props: {
  title: string;
  description: ReactNode;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  confirmTone?: "primary" | "danger";
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
      className={`fixed inset-0 z-50 flex items-end justify-center p-4 transition-colors duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "bg-[#07160F]/75 backdrop-blur-sm" : "bg-black/0"}`}
      onClick={() => void closeWith(props.onCancel)}
    >
      <div
        className={`w-full max-w-md rounded-[20px] border border-white/10 bg-[#183223] p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,0.35)] transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-90"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[16px] font-medium leading-5 text-white">{props.title}</div>
        <div className="mt-2 text-[14px] leading-5 text-white/60">{props.description}</div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            className="h-[52px] rounded-[20px] border border-white/10 bg-white/[0.04] px-3 text-[15px] font-medium text-white transition-transform active:scale-[0.98]"
            onClick={() => void closeWith(props.onCancel)}
          >
            Cancel
          </button>
          <button
            className={`h-[52px] rounded-[20px] px-3 text-[15px] font-medium text-white transition-transform active:scale-[0.98] ${
              props.confirmTone === "danger"
                ? "bg-[#8E1D24] shadow-[0_0_24px_rgba(142,29,36,0.22)]"
                : "bg-[#37B64B] shadow-[0_0_24px_rgba(55,182,75,0.2)]"
            }`}
            onClick={() => void closeWith(props.onConfirm)}
          >
            {props.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
