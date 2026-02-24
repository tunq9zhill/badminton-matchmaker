const HOST_SESSION_KEY = "bm:last-host-session";
const RECENT_PLAYERS_KEY = "bm:recent-players";
const HOST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type CachedHostSession = {
  sessionId: string;
  secret: string;
  savedAt: number;
};

export type RecentPlayer = {
  name: string;
  avatarDataUrl?: string;
  usedAt: number;
};

export function saveHostSession(sessionId: string, secret: string) {
  const payload: CachedHostSession = { sessionId, secret, savedAt: Date.now() };
  localStorage.setItem(HOST_SESSION_KEY, JSON.stringify(payload));
}

export function readHostSession(): CachedHostSession | null {
  const raw = localStorage.getItem(HOST_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedHostSession;
    if (!parsed?.sessionId || !parsed?.secret) return null;
    if (Date.now() - parsed.savedAt > HOST_SESSION_TTL_MS) {
      localStorage.removeItem(HOST_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearHostSession() {
  localStorage.removeItem(HOST_SESSION_KEY);
}

export function readRecentPlayers(): RecentPlayer[] {
  const raw = localStorage.getItem(RECENT_PLAYERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentPlayer[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function saveRecentPlayers(players: RecentPlayer[]) {
  localStorage.setItem(RECENT_PLAYERS_KEY, JSON.stringify(players.slice(0, 12)));
}
