export function buildViewerLink(origin: string, sessionId: string) {
  return `${origin}/s/${sessionId}`;
}
export function buildHostLink(origin: string, sessionId: string, secret: string) {
  return `${origin}/h/${sessionId}?secret=${encodeURIComponent(secret)}`;
}
