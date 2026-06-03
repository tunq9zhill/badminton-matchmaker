import { useCallback, useEffect, useRef, useState } from "react";
import { type Toast as ToastState, useAppStore } from "../app/store";

const TOAST_EXIT_MS = 1000;

export function Toast(props: { toast: ToastState }) {
  const setToast = useAppStore((s) => s.setToast);
  const [isLeaving, setIsLeaving] = useState(false);
  const isLeavingRef = useRef(false);
  const autoDismissTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const hasActions = !!props.toast.primaryAction || !!props.toast.secondaryAction;

  const dismissToast = useCallback(() => {
    if (isLeavingRef.current) return;
    isLeavingRef.current = true;
    setIsLeaving(true);

    if (autoDismissTimerRef.current != null) {
      window.clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }

    exitTimerRef.current = window.setTimeout(() => {
      setToast(undefined);
    }, TOAST_EXIT_MS);
  }, [setToast]);

  useEffect(() => {
    if (hasActions) return;

    autoDismissTimerRef.current = window.setTimeout(dismissToast, 2600);

    return () => {
      if (autoDismissTimerRef.current != null) {
        window.clearTimeout(autoDismissTimerRef.current);
        autoDismissTimerRef.current = null;
      }
      if (exitTimerRef.current != null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [dismissToast, hasActions, props.toast.id]);

  const runAction = useCallback(
    (action: ToastState["primaryAction"]) => {
      dismissToast();
      void action?.onClick();
    },
    [dismissToast],
  );

  const tone =
    props.toast.kind === "error"
      ? {
          icon: <ToastErrorIcon />,
          title: "Error",
          accentStyle: { background: "linear-gradient(90deg, rgba(255,93,93,0.14) 0%, rgba(255,93,93,0) 48%)" },
          iconClass: "bg-[#3A2630] text-[#FF5D5D]",
          ringClass: "ring-[rgba(255,93,93,0.12)]",
        }
      : props.toast.kind === "success"
      ? {
          icon: <ToastSuccessIcon />,
          title: "Success",
          accentStyle: { background: "linear-gradient(90deg, rgba(55,217,107,0.14) 0%, rgba(55,217,107,0) 48%)" },
          iconClass: "bg-[#1F4237] text-[#37D96B]",
          ringClass: "ring-[rgba(55,217,107,0.12)]",
        }
      : {
          icon: <ToastInfoIcon />,
          title: "Notification",
          accentStyle: { background: "linear-gradient(90deg, rgba(255,210,77,0.14) 0%, rgba(255,210,77,0) 48%)" },
          iconClass: "bg-[#3F3824] text-[#FFD24D]",
          ringClass: "ring-[rgba(255,210,77,0.12)]",
        };

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-50 px-4"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    >
      <div
        role={props.toast.kind === "error" ? "alert" : "status"}
        className={`${isLeaving ? "toast-move-out" : "toast-move-in"} pointer-events-auto relative mx-auto flex min-h-[88px] w-full max-w-[430px] items-start gap-4 overflow-hidden rounded-[16px] border border-white/5 bg-[#222B33] px-[18px] py-[18px] text-white shadow-[0_18px_50px_rgba(0,0,0,0.28)]`}
      >
        <span className="pointer-events-none absolute inset-0" style={tone.accentStyle} aria-hidden="true" />
        <span className={`relative mt-1 grid h-7 w-7 flex-none place-items-center rounded-full ring-8 ${tone.iconClass} ${tone.ringClass}`}>
          {tone.icon}
        </span>
        <div className="relative min-w-0 flex-1 break-words text-left">
          <div className="text-[18px] font-semibold leading-[22px] tracking-normal text-white">
            {props.toast.title ?? tone.title}
          </div>
          <div className="mt-1 text-[15px] font-normal leading-[21px] tracking-normal text-white/62">
            {props.toast.message}
          </div>
          {hasActions && (
            <div className="mt-3 flex flex-wrap gap-2">
              {props.toast.primaryAction && (
                <button
                  type="button"
                  onClick={() => runAction(props.toast.primaryAction)}
                  className="rounded-full bg-[#37B64B] px-3 py-1.5 text-[13px] font-semibold leading-4 text-white transition active:scale-[0.97]"
                >
                  {props.toast.primaryAction.label}
                </button>
              )}
              {props.toast.secondaryAction && (
                <button
                  type="button"
                  onClick={() => runAction(props.toast.secondaryAction)}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] font-semibold leading-4 text-white/65 transition active:scale-[0.97]"
                >
                  {props.toast.secondaryAction.label}
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Close notification"
          onClick={dismissToast}
          className="relative -mr-1 grid h-7 w-7 flex-none place-items-center rounded-full text-white/45 transition hover:text-white active:scale-[0.95]"
        >
          <ToastCloseIcon />
        </button>
      </div>
    </div>
  );
}

function ToastSuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 8.2L6.7 11L12 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ToastErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.7 4.7L11.3 11.3" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M11.3 4.7L4.7 11.3" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

function ToastInfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 4.2V8.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8 11.4H8.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function ToastCloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M4.5 4.5L10.5 10.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M10.5 4.5L4.5 10.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
