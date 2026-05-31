export function getAvatarInitials(name: string) {
  const normalized = name.replace(/\u200B/g, "").trim();
  const first = Array.from(normalized)[0] ?? "";
  return first.toUpperCase() || "?";
}
