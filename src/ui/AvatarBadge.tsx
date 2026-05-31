import { getAvatarInitials } from "../app/avatar";

export function AvatarBadge(props: {
  name: string;
  imageUrl?: string;
  sizeClassName?: string;
  textClassName?: string;
  className?: string;
}) {
  const sizeClassName = props.sizeClassName ?? "h-10 w-10";
  const textClassName = props.textClassName ?? "text-base";
  const className = props.className ?? "";

  if (props.imageUrl) {
    return (
      <img
        src={props.imageUrl}
        alt={`avatar-${props.name}`}
        className={`${sizeClassName} flex-none rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`${sizeClassName} ${className} grid flex-none place-items-center rounded-full bg-[#37B64B] text-white`}
    >
      <span className={`${textClassName} font-medium uppercase leading-none`}>{getAvatarInitials(props.name)}</span>
    </div>
  );
}
