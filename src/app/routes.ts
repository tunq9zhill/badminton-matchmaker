export type Route =
  | { name: "landing" }
  | { name: "host"; sessionId: string; secret?: string }
  | { name: "viewer"; sessionId: string }
  | { name: "notfound" };

export function parseRoute(pathname: string, search: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);

  if (parts.length === 0) return { name: "landing" };

  if (parts[0] === "h" && parts[1]) {
    return { name: "host", sessionId: parts[1], secret: params.get("secret") ?? undefined };
  }
  if (parts[0] === "s" && parts[1]) {
    return { name: "viewer", sessionId: parts[1] };
  }
  return { name: "notfound" };
}
