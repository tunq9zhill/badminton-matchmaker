import { nanoid } from "nanoid";
import type { MatchQueueItem, Session, Team } from "../app/types";
import { computeActiveSet, hasMet, matchWouldViolateActive, teamPairKey } from "./constraints";

type RebuildQueueOptions = {
  returnedTeamIds?: string[];
  justFinishedTeamIds?: string[];
  now?: number;
};

function queueItem(teamAId: string, teamBId: string | null, createdAt: number, isFallback = false): MatchQueueItem {
  return {
    id: nanoid(10),
    teamAId,
    teamBId,
    createdAt,
    isFallback,
  };
}

function normalizeQueueItem(item: MatchQueueItem, createdAt: number): MatchQueueItem {
  return {
    id: item.id || nanoid(10),
    teamAId: item.teamAId,
    teamBId: item.teamBId ?? null,
    isFallback: item.isFallback ?? false,
    createdAt: item.createdAt ?? createdAt,
  };
}

export function buildInitialMatchQueue(teams: Team[], now = Date.now()) {
  const queue: MatchQueueItem[] = [];

  for (let index = 0; index < teams.length; index += 2) {
    queue.push(queueItem(teams[index].id, teams[index + 1]?.id ?? null, now + index));
  }

  return queue;
}

export function getMatchQueue(session: Session): MatchQueueItem[] {
  if (session.matchQueue?.length) {
    return session.matchQueue.map((item, index) => normalizeQueueItem(item, (session.startedAt ?? session.createdAt) + index));
  }

  const queue: MatchQueueItem[] = [];
  const startedAt = session.startedAt ?? session.createdAt;
  for (let index = 0; index < session.queueTeams.length; index += 2) {
    queue.push(queueItem(session.queueTeams[index], session.queueTeams[index + 1] ?? null, startedAt + index));
  }

  return queue;
}

export function flattenMatchQueue(queue: MatchQueueItem[]) {
  const teamIds: string[] = [];
  const seen = new Set<string>();

  for (const item of queue) {
    for (const teamId of [item.teamAId, item.teamBId].filter((id): id is string => !!id)) {
      if (seen.has(teamId)) continue;
      seen.add(teamId);
      teamIds.push(teamId);
    }
  }

  return teamIds;
}

export function queueSessionPatch(queue: MatchQueueItem[]) {
  return {
    matchQueue: queue,
    queueTeams: flattenMatchQueue(queue),
  };
}

export function getFirstReadyQueueItem(session: Session) {
  return getMatchQueue(session).find((item) => !!item.teamAId && !!item.teamBId) ?? null;
}

export function removeQueueItem(queue: MatchQueueItem[], itemId: string) {
  return queue.filter((item) => item.id !== itemId);
}

export function insertQueueItemAt(queue: MatchQueueItem[], item: MatchQueueItem, index: number) {
  const withoutDuplicate = removeQueueItem(queue, item.id);
  const restored = [...withoutDuplicate];
  const safeIndex = Math.min(Math.max(index, 0), restored.length);
  restored.splice(safeIndex, 0, item);
  return restored;
}

export function findReadyQueueItem(queue: MatchQueueItem[], teamAId: string, teamBId: string) {
  return queue.find((item) => item.teamAId === teamAId && item.teamBId === teamBId) ?? null;
}

export function autoFillWaitingMatches(
  queue: MatchQueueItem[],
  session: Session,
  teams: Team[],
  options: Pick<RebuildQueueOptions, "justFinishedTeamIds"> = {},
) {
  const working = [...queue];
  const teamById = new Map(teams.filter((team) => !team.archived).map((team) => [team.id, team]));
  const activeSet = computeActiveSet(session, teams);
  const justFinished = new Set(options.justFinishedTeamIds ?? []);

  while (true) {
    const readyPairKeys = new Set(
      working
        .filter((item) => !!item.teamBId)
        .map((item) => teamPairKey(item.teamAId, item.teamBId!)),
    );
    const seenWaitingTeamIds = new Set<string>();
    const waitingItems = working
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (item.teamBId || seenWaitingTeamIds.has(item.teamAId)) return false;
        seenWaitingTeamIds.add(item.teamAId);
        const team = teamById.get(item.teamAId);
        return !!team && !activeSet.has(item.teamAId);
      });

    if (waitingItems.length < 2) return working;

    const waitingSince = new Map(waitingItems.map(({ item }) => [item.teamAId, item.createdAt]));
    const pair = pickWaitingPair(session, waitingItems.map(({ item }) => item.teamAId), teamById, waitingSince, justFinished, activeSet, readyPairKeys);
    if (!pair) return working;

    const firstItem = waitingItems.find(({ item }) => item.teamAId === pair.teamAId)!;
    const secondItem = waitingItems.find(({ item }) => item.teamAId === pair.teamBId)!;
    const keep = firstItem.index < secondItem.index ? firstItem : secondItem;
    const remove = firstItem.index < secondItem.index ? secondItem : firstItem;

    working[keep.index] = {
      ...keep.item,
      teamAId: pair.teamAId,
      teamBId: pair.teamBId,
      createdAt: Math.min(waitingSince.get(pair.teamAId) ?? keep.item.createdAt, waitingSince.get(pair.teamBId) ?? keep.item.createdAt),
      isFallback: hasMet(session, pair.teamAId, pair.teamBId),
    };
    working.splice(remove.index, 1);
  }
}

export function rebuildMatchQueue(session: Session, teams: Team[], options: RebuildQueueOptions = {}) {
  const now = options.now ?? Date.now();
  const returnedTeamIds = options.returnedTeamIds ?? [];
  const justFinished = new Set(options.justFinishedTeamIds ?? []);
  const returned = new Set(returnedTeamIds);
  const teamById = new Map(teams.filter((team) => !team.archived).map((team) => [team.id, team]));
  const activeSet = computeActiveSet(session, teams);
  returned.forEach((teamId) => activeSet.delete(teamId));

  const waitingSince = new Map<string, number>();
  const orderedTeamIds: string[] = [];

  const addWaitingTeam = (teamId: string | null | undefined, createdAt: number) => {
    if (!teamId || waitingSince.has(teamId)) return;
    const team = teamById.get(teamId);
    if (!team || activeSet.has(teamId)) return;
    waitingSince.set(teamId, createdAt);
    orderedTeamIds.push(teamId);
  };

  for (const item of getMatchQueue(session)) {
    addWaitingTeam(item.teamAId, item.createdAt);
    addWaitingTeam(item.teamBId, item.createdAt);
  }

  returnedTeamIds.forEach((teamId, index) => addWaitingTeam(teamId, now + index));

  teams
    .filter((team) => !team.archived && !activeSet.has(team.id))
    .forEach((team, index) => addWaitingTeam(team.id, now + returnedTeamIds.length + index));

  const activeFutureCount = Array.from(activeSet).filter((teamId) => teamById.has(teamId)).length;
  const remaining = orderedTeamIds
    .filter((teamId) => teamById.has(teamId) && !activeSet.has(teamId))
    .sort((a, b) => compareWaitingTeams(a, b, teamById, waitingSince, justFinished));

  const ready: MatchQueueItem[] = [];
  const waiting: MatchQueueItem[] = [];

  while (remaining.length > 0) {
    const baseId = remaining.shift()!;
    const opponentId = pickOpponent(session, baseId, remaining, teamById, waitingSince, justFinished, activeSet, activeFutureCount);

    if (!opponentId) {
      waiting.push(queueItem(baseId, null, waitingSince.get(baseId) ?? now));
      continue;
    }

    const opponentIndex = remaining.indexOf(opponentId);
    if (opponentIndex >= 0) remaining.splice(opponentIndex, 1);

    ready.push(queueItem(baseId, opponentId, Math.min(waitingSince.get(baseId) ?? now, waitingSince.get(opponentId) ?? now), hasMet(session, baseId, opponentId)));
  }

  return autoFillWaitingMatches([...ready, ...waiting], session, teams, {
    justFinishedTeamIds: options.justFinishedTeamIds,
  });
}

function compareWaitingTeams(
  aId: string,
  bId: string,
  teamById: Map<string, Team>,
  waitingSince: Map<string, number>,
  justFinished: Set<string>,
) {
  const a = teamById.get(aId)!;
  const b = teamById.get(bId)!;
  const aWait = waitingSince.get(aId) ?? 0;
  const bWait = waitingSince.get(bId) ?? 0;
  if (aWait !== bWait) return aWait - bWait;
  if (a.stats.played !== b.stats.played) return a.stats.played - b.stats.played;
  const aJust = justFinished.has(aId) ? 1 : 0;
  const bJust = justFinished.has(bId) ? 1 : 0;
  if (aJust !== bJust) return aJust - bJust;
  return aId.localeCompare(bId);
}

function pickOpponent(
  session: Session,
  baseId: string,
  candidates: string[],
  teamById: Map<string, Team>,
  waitingSince: Map<string, number>,
  justFinished: Set<string>,
  activeSet: Set<string>,
  activeFutureCount: number,
) {
  const base = teamById.get(baseId);
  if (!base) return null;

  const viable = candidates.filter((candidateId) => {
    if (!teamById.has(candidateId)) return false;
    return !matchWouldViolateActive(activeSet, baseId, candidateId);
  });
  if (!viable.length) return null;

  const unseen = viable.filter((candidateId) => !hasMet(session, baseId, candidateId));
  if (!unseen.length && activeFutureCount > 0) return null;

  let pool = unseen.length ? unseen : viable;
  const nonJustPlayed = pool.filter((candidateId) => !justFinished.has(candidateId));
  if (nonJustPlayed.length) pool = nonJustPlayed;

  return [...pool].sort((aId, bId) => compareOpponentCandidates(base, aId, bId, teamById, waitingSince, justFinished))[0] ?? null;
}

function pickWaitingPair(
  session: Session,
  teamIds: string[],
  teamById: Map<string, Team>,
  waitingSince: Map<string, number>,
  justFinished: Set<string>,
  activeSet: Set<string>,
  readyPairKeys: Set<string>,
) {
  const candidates: Array<{ teamAId: string; teamBId: string }> = [];

  for (let index = 0; index < teamIds.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < teamIds.length; nextIndex += 1) {
      const teamAId = teamIds[index];
      const teamBId = teamIds[nextIndex];
      if (!teamById.has(teamAId) || !teamById.has(teamBId)) continue;
      if (matchWouldViolateActive(activeSet, teamAId, teamBId)) continue;
      if (readyPairKeys.has(teamPairKey(teamAId, teamBId))) continue;
      candidates.push({ teamAId, teamBId });
    }
  }

  return candidates.sort((a, b) => compareWaitingPairs(session, a, b, teamById, waitingSince, justFinished))[0] ?? null;
}

function compareWaitingPairs(
  session: Session,
  a: { teamAId: string; teamBId: string },
  b: { teamAId: string; teamBId: string },
  teamById: Map<string, Team>,
  waitingSince: Map<string, number>,
  justFinished: Set<string>,
) {
  const aHasMet = hasMet(session, a.teamAId, a.teamBId) ? 1 : 0;
  const bHasMet = hasMet(session, b.teamAId, b.teamBId) ? 1 : 0;
  if (aHasMet !== bHasMet) return aHasMet - bHasMet;

  const aOldestWait = Math.min(waitingSince.get(a.teamAId) ?? 0, waitingSince.get(a.teamBId) ?? 0);
  const bOldestWait = Math.min(waitingSince.get(b.teamAId) ?? 0, waitingSince.get(b.teamBId) ?? 0);
  if (aOldestWait !== bOldestWait) return aOldestWait - bOldestWait;

  const aTotalPlayed = teamById.get(a.teamAId)!.stats.played + teamById.get(a.teamBId)!.stats.played;
  const bTotalPlayed = teamById.get(b.teamAId)!.stats.played + teamById.get(b.teamBId)!.stats.played;
  if (aTotalPlayed !== bTotalPlayed) return aTotalPlayed - bTotalPlayed;

  const aJustFinished = (justFinished.has(a.teamAId) ? 1 : 0) + (justFinished.has(a.teamBId) ? 1 : 0);
  const bJustFinished = (justFinished.has(b.teamAId) ? 1 : 0) + (justFinished.has(b.teamBId) ? 1 : 0);
  if (aJustFinished !== bJustFinished) return aJustFinished - bJustFinished;

  const aBalance = Math.abs(teamById.get(a.teamAId)!.stats.played - teamById.get(a.teamBId)!.stats.played);
  const bBalance = Math.abs(teamById.get(b.teamAId)!.stats.played - teamById.get(b.teamBId)!.stats.played);
  if (aBalance !== bBalance) return aBalance - bBalance;

  return `${a.teamAId}${a.teamBId}`.localeCompare(`${b.teamAId}${b.teamBId}`);
}

function compareOpponentCandidates(
  base: Team,
  aId: string,
  bId: string,
  teamById: Map<string, Team>,
  waitingSince: Map<string, number>,
  justFinished: Set<string>,
) {
  const a = teamById.get(aId)!;
  const b = teamById.get(bId)!;
  const aJust = justFinished.has(aId) ? 1 : 0;
  const bJust = justFinished.has(bId) ? 1 : 0;
  if (aJust !== bJust) return aJust - bJust;

  const aWait = waitingSince.get(aId) ?? 0;
  const bWait = waitingSince.get(bId) ?? 0;
  if (aWait !== bWait) return aWait - bWait;

  if (a.stats.played !== b.stats.played) return a.stats.played - b.stats.played;

  const aBalance = Math.abs(a.stats.played - base.stats.played);
  const bBalance = Math.abs(b.stats.played - base.stats.played);
  if (aBalance !== bBalance) return aBalance - bBalance;

  return aId.localeCompare(bId);
}
