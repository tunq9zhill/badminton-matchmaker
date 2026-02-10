export function Input(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  );
}
