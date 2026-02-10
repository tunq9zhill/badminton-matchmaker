import type { Session, Team } from "../app/types";

export function teamPairKey(a: string, b: string) {
  return [a, b].sort().join("__");
}
export function playerPairKey(a: string, b: string) {
  return [a, b].sort().join("__");
}

export function computeActiveSet(session: Session, teams: Team[]) {
  const active = new Set(session.activeTeams);
  // defensive: reconcile with team.isActive
  for (const t of teams) if (t.isActive) active.add(t.id);
  return active;
}

export function isTeamEligible(session: Session, team: Team) {
  if (team.isActive) return false;
  if (session.activeTeams.includes(team.id)) return false;
  // IMPORTANT: team must not be in both lists
  if (session.queueTeams.includes(team.id) && session.activeTeams.includes(team.id)) return false;
  return true;
}

export function matchWouldViolateActive(activeSet: Set<string>, a: string, b: string) {
  return activeSet.has(a) || activeSet.has(b) || a === b;
}

export function hasMet(session: Session, a: string, b: string) {
  return !!session.metHistory[teamPairKey(a, b)];
}

export function safeOpponentOptions(session: Session, teams: Team[], teamId: string, activeSet: Set<string>) {
  const team = teams.find((t) => t.id === teamId);
  if (!team || team.isActive) return 0;
  let count = 0;
  for (const other of teams) {
    if (other.id === teamId) continue;
    if (other.isActive) continue;
    if (matchWouldViolateActive(activeSet, teamId, other.id)) continue;
    if (hasMet(session, teamId, other.id)) continue;
    count++;
  }
  return count;
}

export function partitionByRecord(teams: Team[]) {
  const winners: Team[] = [];
  const losers: Team[] = [];
  for (const t of teams) {
    if (t.stats.wins >= t.stats.losses) winners.push(t);
    else losers.push(t);
  }
  return { winners, losers };
}
