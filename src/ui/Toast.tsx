import { useEffect } from "react";
import { useAppStore } from "../app/store";

export function Toast(props: { toast: { id: string; message: string; kind: "info" | "error" | "success" } }) {
  const setToast = useAppStore((s) => s.setToast);

  useEffect(() => {
    const t = setTimeout(() => setToast(undefined), 2600);
    return () => clearTimeout(t);
  }, [props.toast.id, setToast]);

  const tone =
    props.toast.kind === "error"
      ? "bg-rose-600"
      : props.toast.kind === "success"
      ? "bg-emerald-600"
      : "bg-slate-900";

  return (
    <div className="fixed bottom-4 left-0 right-0 z-50 px-4">
      <div className={`mx-auto max-w-md rounded-xl px-4 py-3 text-white shadow-lg ${tone}`}>
        {props.toast.message}
      </div>
    </div>
  );
}
