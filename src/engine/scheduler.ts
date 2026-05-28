import type { Player, Session, Team } from "../app/types";
import { computeActiveSet, hasMet, matchWouldViolateActive, safeOpponentOptions, partitionByRecord } from "./constraints";

export type ProposedMatch = { teamAId: string; teamBId: string; isFallback?: boolean };

function pickCoverage(session: Session, teams: Team[], playersById?: Map<string, Player>): ProposedMatch | null {
  const activeSet = computeActiveSet(session, teams);

  const eligible = teams.filter((t) => !t.isActive && !activeSet.has(t.id));
  if (eligible.length < 2) return null;

  // Prefer played == 0, then fewer opponent options (harder to schedule), then lowest played count.
  const ranked = [...eligible].sort((a, b) => {
    const aNeedsFirstMatch = a.playerIds.some((pid) => (playersById?.get(pid)?.stats.played ?? 0) === 0) ? 0 : 1;
    const bNeedsFirstMatch = b.playerIds.some((pid) => (playersById?.get(pid)?.stats.played ?? 0) === 0) ? 0 : 1;
    if (aNeedsFirstMatch !== bNeedsFirstMatch) return aNeedsFirstMatch - bNeedsFirstMatch;

    const ap0 = a.stats.played === 0 ? 0 : 1;
    const bp0 = b.stats.played === 0 ? 0 : 1;
    if (ap0 !== bp0) return ap0 - bp0;
    const ao = safeOpponentOptions(session, teams, a.id, activeSet);
    const bo = safeOpponentOptions(session, teams, b.id, activeSet);
    if (ao !== bo) return ao - bo;
    return a.stats.played - b.stats.played;
  });

  const teamHasUnplayedMembers = (team: Team) => team.playerIds.some((pid) => (playersById?.get(pid)?.stats.played ?? 0) === 0);
  const teamLastPlayedAt = (team: Team) =>
    Math.max(
      ...team.playerIds.map((pid) => {
        const h = playersById?.get(pid)?.playHistory ?? [];
        return h.length ? h[h.length - 1] : 0;
      })
    );

  const latestPlayedAtAmongEligible = Math.max(...ranked.map((t) => teamLastPlayedAt(t)), 0);
  const wasJustPlayed = (team: Team) => teamLastPlayedAt(team) > 0 && teamLastPlayedAt(team) === latestPlayedAtAmongEligible;

  const candidates: Array<{ a: Team; b: Team; seen: boolean; justPlayed: boolean; allowRematchForUnplayed: boolean }> = [];
  for (const a of ranked) {
    for (const b of ranked) {
      if (a.id === b.id) continue;
      if (matchWouldViolateActive(activeSet, a.id, b.id)) continue;
      candidates.push({
        a,
        b,
        seen: hasMet(session, a.id, b.id),
        justPlayed: wasJustPlayed(a) || wasJustPlayed(b),
        allowRematchForUnplayed: teamHasUnplayedMembers(a) || teamHasUnplayedMembers(b),
      });
    }
  }
  if (!candidates.length) return null;

  // Pass 1: unseen + avoid just-played teams when we still have alternatives.
  const strictUnseen = candidates.find((c) => !c.seen && !c.justPlayed);
  if (strictUnseen) return { teamAId: strictUnseen.a.id, teamBId: strictUnseen.b.id };

  // Pass 2: unseen pair is still preferred even if it includes teams that just played.
  const unseen = candidates.find((c) => !c.seen);
  if (unseen) return { teamAId: unseen.a.id, teamBId: unseen.b.id };

  // Pass 3: rematch fallback (still prefer not-just-played, then 3-player rotation need).
  const rematch = candidates.find((c) => !c.justPlayed && c.allowRematchForUnplayed)
    ?? candidates.find((c) => !c.justPlayed)
    ?? candidates.find((c) => c.allowRematchForUnplayed)
    ?? candidates[0];

  return { teamAId: rematch.a.id, teamBId: rematch.b.id, isFallback: true };
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
  // Ultimate fallback: allow rematch so host can always continue assigning matches.
  for (const a of eligible) {
    for (const b of eligible) {
      if (a.id === b.id) continue;
      if (matchWouldViolateActive(activeSet, a.id, b.id)) continue;
      return { teamAId: a.id, teamBId: b.id, isFallback: true };
    }
  }
  return null;
}

export function proposeNextMatch(session: Session, teams: Team[], playersById?: Map<string, Player>): ProposedMatch | null {
  if (session.phase === "coverage") return pickCoverage(session, teams, playersById);
  return pickBracket(session, teams);
}
