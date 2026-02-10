import { nanoid } from "nanoid";
import type { Player, Team, Session } from "../app/types";
import { playerPairKey } from "./constraints";

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildInitialTeams(session: Session, players: Player[]): { teams: Team[]; warnings: string[] } {
  const warnings: string[] = [];
  const pool = shuffle(players);

  const teams: Team[] = [];
  const oddMode = session.config.oddMode;

  if (pool.length < 4) {
    warnings.push("Need at least 4 players to start doubles matches.");
    return { teams, warnings };
  }

  if (pool.length % 2 === 0 || oddMode === "none") {
    for (let i = 0; i + 1 < pool.length; i += 2) {
      teams.push({
        id: nanoid(8),
        playerIds: [pool[i].id, pool[i + 1].id],
        stats: { played: 0, wins: 0, losses: 0 },
        isActive: false,
      });
    }
    return { teams, warnings };
  }

  // odd count with 3-player rotation team: last 3 players become one team of 3
  for (let i = 0; i + 1 < pool.length - 3; i += 2) {
    teams.push({
      id: nanoid(8),
      playerIds: [pool[i].id, pool[i + 1].id],
      stats: { played: 0, wins: 0, losses: 0 },
      isActive: false,
    });
  }
  const last = pool.slice(pool.length - 3);
  teams.push({
    id: nanoid(8),
    playerIds: [last[0].id, last[1].id, last[2].id], // A,B,C
    stats: { played: 0, wins: 0, losses: 0 },
    isActive: false,
    pairPreference: [last[0].id, last[1].id], // เริ่ม AB ก่อน
    pendingOddChoice: true,
  });

  warnings.push("Odd player mode: created one 3-player team (rotation required when they play).");
  return { teams, warnings };
}

export function teammateHistoryFromTeams(teams: Team[]) {
  const hist: Record<string, true> = {};
  for (const t of teams) {
    const ids = t.playerIds;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        hist[playerPairKey(ids[i], ids[j])] = true;
      }
    }
  }
  return hist;
}

export function rebuildTeamsAvoidingTeammates(players: Player[], priorTeammateHistory: Record<string, true>) {
  // Greedy best-effort: pair players minimizing violations.
  const warnings: string[] = [];
  const pool = shuffle(players);
  const used = new Set<string>();
  const teams: Team[] = [];

  const scorePair = (a: string, b: string) => (priorTeammateHistory[playerPairKey(a, b)] ? 1 : 0);

  while (pool.length >= 2) {
    const p1 = pool.shift()!;
    if (used.has(p1.id)) continue;

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < pool.length; i++) {
      const p2 = pool[i];
      if (used.has(p2.id)) continue;
      const s = scorePair(p1.id, p2.id);
      if (s < bestScore) {
        bestScore = s;
        bestIdx = i;
        if (s === 0) break;
      }
    }

    if (bestIdx === -1) break;
    const p2 = pool.splice(bestIdx, 1)[0];

    if (bestScore > 0) warnings.push("Some teammate-repeat violations were unavoidable.");

    used.add(p1.id);
    used.add(p2.id);

    teams.push({
      id: nanoid(8),
      playerIds: [p1.id, p2.id],
      stats: { played: 0, wins: 0, losses: 0 },
      isActive: false,
    });
  }

  return { teams, warnings };
}
