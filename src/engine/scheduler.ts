import type { Session, Team } from "../app/types";
import { computeActiveSet, hasMet, matchWouldViolateActive, safeOpponentOptions, partitionByRecord } from "./constraints";

export type ProposedMatch = { teamAId: string; teamBId: string; isFallback?: boolean };

function pickCoverage(session: Session, teams: Team[]): ProposedMatch | null {
  const activeSet = computeActiveSet(session, teams);

  const eligible = teams.filter((t) => !t.isActive && !activeSet.has(t.id));
  if (eligible.length < 2) return null;

  // Prefer played == 0, then fewer opponent options (harder to schedule), then lowest played count.
  const ranked = [...eligible].sort((a, b) => {
    const ap0 = a.stats.played === 0 ? 0 : 1;
    const bp0 = b.stats.played === 0 ? 0 : 1;
    if (ap0 !== bp0) return ap0 - bp0;
    const ao = safeOpponentOptions(session, teams, a.id, activeSet);
    const bo = safeOpponentOptions(session, teams, b.id, activeSet);
    if (ao !== bo) return ao - bo;
    return a.stats.played - b.stats.played;
  });

  for (const a of ranked) {
    for (const b of ranked) {
      if (a.id === b.id) continue;
      if (matchWouldViolateActive(activeSet, a.id, b.id)) continue;
      if (hasMet(session, a.id, b.id)) continue;
      return { teamAId: a.id, teamBId: b.id };
    }
  }
  return null;
}

function pickBracket(session: Session, teams: Team[]): ProposedMatch | null {
  const activeSet = computeActiveSet(session, teams);
  const eligible = teams.filter((t) => !t.isActive && !activeSet.has(t.id));
  if (eligible.length < 2) return null;

  const { winners, losers } = partitionByRecord(eligible);

  const tryGroup = (group: Team[]) => {
    const ranked = [...group].sort((a, b) => {
      // fewer options first to avoid dead ends
      const ao = safeOpponentOptions(session, teams, a.id, activeSet);
      const bo = safeOpponentOptions(session, teams, b.id, activeSet);
      if (ao !== bo) return ao - bo;
      // then by record closeness
      const ar = a.stats.wins - a.stats.losses;
      const br = b.stats.wins - b.stats.losses;
      return br - ar;
    });
    for (const a of ranked) {
      for (const b of ranked) {
        if (a.id === b.id) continue;
        if (hasMet(session, a.id, b.id)) continue;
        return { teamAId: a.id, teamBId: b.id };
      }
    }
    return null;
  };

  // Prefer winners vs winners, then losers vs losers
  const ww = tryGroup(winners);
  if (ww) return ww;
  const ll = tryGroup(losers);
  if (ll) return ll;

  // Fallback (winner vs loser) only if it avoids idling AND never met
  for (const a of winners) {
    for (const b of losers) {
      if (hasMet(session, a.id, b.id)) continue;
      return { teamAId: a.id, teamBId: b.id, isFallback: true };
    }
  }
  return null;
}

export function proposeNextMatch(session: Session, teams: Team[]): ProposedMatch | null {
  if (session.phase === "coverage") return pickCoverage(session, teams);
  return pickBracket(session, teams);
}
