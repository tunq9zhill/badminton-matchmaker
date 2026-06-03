import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db, ensureAnonAuth } from "../../app/firebase";
import type { Court, Match, MatchQueueItem, Player, Session, Team } from "../../app/types";
import { flattenMatchQueue, getMatchQueue } from "../../engine/queue";
import { COL, type ResultRow } from "./schema";

export type GameState = {
  session: Session;
  players: Player[];
  teams: Team[];
  courts: Court[];
  matches: Match[];
  results: ResultRow[];
};

type RecoverySnapshot = {
  id: "latest";
  savedAt: number;
  reason: string;
  state: GameState;
};

type ValidationResult = {
  valid: boolean;
  issues: string[];
};

type RecoveryResult =
  | { status: "synced"; state: GameState; issues: string[] }
  | { status: "restored"; state: GameState; issues: string[] }
  | { status: "failed"; state: GameState | null; issues: string[] };

const LATEST_RECOVERY_ID = "latest";
const LOCAL_RECOVERY_PREFIX = "courtmate:recovery:";

function uniqueIds<T extends { id: string }>(rows: T[], label: string, issues: string[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id) {
      issues.push(`${label} is missing an id.`);
      continue;
    }
    if (seen.has(row.id)) issues.push(`${label} has duplicated id ${row.id}.`);
    seen.add(row.id);
  }
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join("__");
}

function matchQueuePairKey(item: MatchQueueItem) {
  return `${item.teamAId}__${item.teamBId ?? "waiting"}`;
}

function getActiveMatches(state: GameState) {
  return state.matches.filter((match) => match.status === "scheduled" || match.status === "in_progress");
}

function compactIssues(issues: string[]) {
  return Array.from(new Set(issues)).slice(0, 8);
}

export async function readSessionState(sessionId: string): Promise<GameState> {
  const user = await ensureAnonAuth();
  const sSnap = await getDoc(doc(db, COL.sessions, sessionId));
  if (!sSnap.exists()) throw new Error("Session not found");

  const session = sSnap.data() as Session;
  if (session.hostUid !== user.uid) throw new Error("Not host on this device");

  const [playersSnap, teamsSnap, courtsSnap, matchesSnap, resultsSnap] = await Promise.all([
    getDocs(collection(db, COL.sessions, sessionId, COL.players)),
    getDocs(collection(db, COL.sessions, sessionId, COL.teams)),
    getDocs(collection(db, COL.sessions, sessionId, COL.courts)),
    getDocs(collection(db, COL.sessions, sessionId, COL.matches)),
    getDocs(collection(db, COL.sessions, sessionId, COL.results)),
  ]);

  return {
    session,
    players: playersSnap.docs
      .map((d) => d.data() as Player)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.name.localeCompare(b.name)),
    teams: teamsSnap.docs.map((d) => d.data() as Team),
    courts: courtsSnap.docs.map((d) => d.data() as Court).sort((a, b) => Number(a.id) - Number(b.id)),
    matches: matchesSnap.docs.map((d) => d.data() as Match),
    results: resultsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ResultRow[],
  };
}

export function validateGameState(state: GameState): ValidationResult {
  const issues: string[] = [];
  const playerById = new Map(state.players.map((player) => [player.id, player]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const courtById = new Map(state.courts.map((court) => [court.id, court]));
  const matchById = new Map(state.matches.map((match) => [match.id, match]));
  const resultById = new Map(state.results.map((result) => [result.id, result]));
  const activeMatches = getActiveMatches(state);
  const activeMatchTeamIds = new Set(activeMatches.flatMap((match) => [match.teamAId, match.teamBId]));
  const activeMatchIds = new Set(activeMatches.map((match) => match.id));
  const activeCourtMatchIds = new Set(state.courts.map((court) => court.currentMatchId).filter((id): id is string => !!id));
  const queue = getMatchQueue(state.session);
  const queueTeamIds = new Set(flattenMatchQueue(queue));
  const activeTeams = state.teams.filter((team) => !team.archived);

  uniqueIds(state.players, "Player", issues);
  uniqueIds(state.teams, "Team", issues);
  uniqueIds(state.courts, "Court", issues);
  uniqueIds(state.matches, "Match", issues);
  uniqueIds(state.results, "Result", issues);

  if (!state.session.id) issues.push("Session is missing an id.");
  if (!state.session.config?.courtCount || state.session.config.courtCount < 1) issues.push("Session has invalid court count.");
  if (!Array.isArray(state.session.activeTeams)) issues.push("Session active team list is invalid.");
  if (!Array.isArray(state.session.queueTeams)) issues.push("Session queue team list is invalid.");

  for (const team of state.teams) {
    const uniquePlayerIds = new Set(team.playerIds);
    if (uniquePlayerIds.size !== team.playerIds.length) issues.push(`Team ${team.id} has duplicated players.`);
    if (team.playerIds.length < 2 || team.playerIds.length > 3) issues.push(`Team ${team.id} has invalid player count.`);
    for (const playerId of team.playerIds) {
      if (!playerById.has(playerId)) issues.push(`Team ${team.id} references missing player ${playerId}.`);
    }
    if (team.stats.played < 0 || team.stats.wins < 0 || team.stats.losses < 0) issues.push(`Team ${team.id} has invalid stats.`);
    if (team.stats.wins + team.stats.losses > team.stats.played) issues.push(`Team ${team.id} stats exceed played count.`);
  }

  for (const player of state.players) {
    if (!player.name?.trim()) issues.push(`Player ${player.id} has no name.`);
    if (player.stats.played < 0 || player.stats.wins < 0 || player.stats.losses < 0) issues.push(`Player ${player.id} has invalid stats.`);
    if (player.stats.wins + player.stats.losses > player.stats.played) issues.push(`Player ${player.id} stats exceed played count.`);
    if ((player.playHistory?.length ?? 0) > player.stats.played) issues.push(`Player ${player.id} has more play history than match count.`);
  }

  for (const teamId of state.session.activeTeams) {
    const team = teamById.get(teamId);
    if (!team || team.archived) issues.push(`Active team list references missing team ${teamId}.`);
  }

  for (const teamId of state.session.queueTeams) {
    const team = teamById.get(teamId);
    if (!team || team.archived) issues.push(`Queue references missing team ${teamId}.`);
  }

  const queueFlattened = flattenMatchQueue(queue);
  const queueTeamSeen = new Set<string>();
  for (const teamId of queueFlattened) {
    if (queueTeamSeen.has(teamId)) issues.push(`Queue references team ${teamId} more than once.`);
    queueTeamSeen.add(teamId);
  }

  if (state.session.matchQueue?.length) {
    const flattened = flattenMatchQueue(state.session.matchQueue);
    if (flattened.join("|") !== state.session.queueTeams.join("|")) {
      issues.push("Session queueTeams does not match matchQueue order.");
    }
  }

  for (const item of queue) {
    const teamA = teamById.get(item.teamAId);
    const teamB = item.teamBId ? teamById.get(item.teamBId) : null;
    if (!teamA || teamA.archived) issues.push(`Queue item ${item.id} references missing Team A.`);
    if (item.teamBId && (!teamB || teamB.archived)) issues.push(`Queue item ${item.id} references missing Team B.`);
    if (item.teamBId && item.teamAId === item.teamBId) issues.push(`Queue item ${item.id} has the same team twice.`);
    if (activeMatchTeamIds.has(item.teamAId) || (item.teamBId && activeMatchTeamIds.has(item.teamBId))) {
      issues.push(`Queue item ${item.id} contains a team already active on court.`);
    }
  }

  for (const match of state.matches) {
    if (!teamById.has(match.teamAId) || !teamById.has(match.teamBId)) issues.push(`Match ${match.id} references missing team.`);
    if (!courtById.has(match.courtId)) issues.push(`Match ${match.id} references missing court.`);
    if (match.teamAId === match.teamBId) issues.push(`Match ${match.id} uses the same team twice.`);
    if (match.teamAPlayedPlayerIds && match.teamAPlayedPlayerIds.some((id) => !teamById.get(match.teamAId)?.playerIds.includes(id))) {
      issues.push(`Match ${match.id} has invalid Team A played players.`);
    }
    if (match.teamBPlayedPlayerIds && match.teamBPlayedPlayerIds.some((id) => !teamById.get(match.teamBId)?.playerIds.includes(id))) {
      issues.push(`Match ${match.id} has invalid Team B played players.`);
    }
  }

  for (const court of state.courts) {
    if (!court.currentMatchId) continue;
    const match = matchById.get(court.currentMatchId);
    if (!match) {
      issues.push(`Court ${court.id} references missing match ${court.currentMatchId}.`);
      continue;
    }
    if (match.courtId !== court.id) issues.push(`Court ${court.id} references a match assigned to court ${match.courtId}.`);
    if (!activeMatchIds.has(match.id)) issues.push(`Court ${court.id} references a match that is not active.`);
  }

  for (const match of activeMatches) {
    if (!activeCourtMatchIds.has(match.id)) issues.push(`Active match ${match.id} is not reachable from a court.`);
  }

  for (const team of activeTeams) {
    const isReachable = activeMatchTeamIds.has(team.id) || queueTeamIds.has(team.id);
    if (state.session.locked && activeTeams.length >= 2 && !isReachable) {
      issues.push(`Team ${team.id} is not reachable from court or queue.`);
    }
    if (team.isActive && !activeMatchTeamIds.has(team.id)) issues.push(`Team ${team.id} is marked active but is not on court.`);
  }

  for (const teamId of activeMatchTeamIds) {
    const team = teamById.get(teamId);
    if (team && !team.isActive) issues.push(`Team ${teamId} is on court but is not marked active.`);
    if (!state.session.activeTeams.includes(teamId)) issues.push(`Team ${teamId} is on court but missing from activeTeams.`);
  }

  const inactiveTeams = activeTeams.filter((team) => !activeMatchTeamIds.has(team.id));
  const inactiveUnqueuedTeams = inactiveTeams.filter((team) => !queueTeamIds.has(team.id));
  if (state.session.locked && activeTeams.length >= 2 && inactiveUnqueuedTeams.length > 0) {
    issues.push("Playable teams exist outside the active courts and queue.");
  }

  const readyQueueItems = queue.filter((item) => !!item.teamBId);
  if (state.session.locked && inactiveTeams.length >= 2 && readyQueueItems.length === 0) {
    issues.push("Queue has no ready VS matchup while enough teams are available.");
  }

  for (const result of state.results) {
    if (!teamById.has(result.teamAId) || !teamById.has(result.teamBId)) issues.push(`Result ${result.id} references missing team.`);
    if (!courtById.has(result.courtId)) issues.push(`Result ${result.id} references missing court.`);
    if (result.winnerTeamId && result.winnerTeamId !== result.teamAId && result.winnerTeamId !== result.teamBId) {
      issues.push(`Result ${result.id} has invalid winner.`);
    }
    if (!resultById.has(result.id)) issues.push(`Result ${result.id} is unreachable.`);
  }

  for (const key of Object.keys(state.session.metHistory ?? {})) {
    const [teamAId, teamBId] = key.split("__");
    if (!teamById.has(teamAId) || !teamById.has(teamBId)) issues.push(`Match history references missing team pair ${key}.`);
  }

  if (state.session.locked && state.players.length >= 4 && activeTeams.length === 0 && queueTeamIds.size === 0) {
    issues.push("Session is locked but has no active teams.");
  }

  return { valid: issues.length === 0, issues: compactIssues(issues) };
}

function findSnapshotRegression(current: GameState, snapshot: GameState) {
  const issues: string[] = [];
  const currentPlayers = new Map(current.players.map((player) => [player.id, player]));
  const currentTeams = new Map(current.teams.map((team) => [team.id, team]));
  const currentMatches = new Map(current.matches.map((match) => [match.id, match]));
  const currentResults = new Map(current.results.map((result) => [result.id, result]));
  const currentCourts = new Map(current.courts.map((court) => [court.id, court]));
  const currentQueueById = new Map(getMatchQueue(current.session).map((item) => [item.id, item]));

  if (!snapshot.session.locked && snapshot.teams.filter((team) => !team.archived).length === 0) return [];

  for (const player of snapshot.players) {
    const currentPlayer = currentPlayers.get(player.id);
    if (!currentPlayer) {
      issues.push(`Player ${player.name} disappeared.`);
      continue;
    }
    if (currentPlayer.stats.played < player.stats.played) issues.push(`Player ${player.name} match count moved backwards.`);
    if ((currentPlayer.playHistory?.length ?? 0) < (player.playHistory?.length ?? 0)) issues.push(`Player ${player.name} play history moved backwards.`);
  }

  for (const team of snapshot.teams.filter((entry) => !entry.archived)) {
    const currentTeam = currentTeams.get(team.id);
    if (!currentTeam || currentTeam.archived) {
      issues.push(`Team ${team.id} disappeared.`);
      continue;
    }
    if (currentTeam.playerIds.join("|") !== team.playerIds.join("|")) issues.push(`Team ${team.id} players changed unexpectedly.`);
    if (currentTeam.stats.played < team.stats.played) issues.push(`Team ${team.id} match count moved backwards.`);
  }

  for (const match of snapshot.matches) {
    const currentMatch = currentMatches.get(match.id);
    if (!currentMatch) {
      const matchingResult = current.results.find((result) => result.teamAId === match.teamAId && result.teamBId === match.teamBId);
      if (!matchingResult) issues.push(`Match ${match.id} disappeared.`);
      continue;
    }
    if (pairKey(currentMatch.teamAId, currentMatch.teamBId) !== pairKey(match.teamAId, match.teamBId)) {
      issues.push(`Match ${match.id} changed teams unexpectedly.`);
    }
  }

  for (const result of snapshot.results) {
    if (!currentResults.has(result.id)) issues.push(`Result ${result.id} disappeared.`);
  }

  for (const [metKey] of Object.entries(snapshot.session.metHistory ?? {})) {
    if (!current.session.metHistory?.[metKey]) issues.push(`Match history pair ${metKey} disappeared.`);
  }

  for (const item of getMatchQueue(snapshot.session)) {
    const currentItem = currentQueueById.get(item.id);
    if (!currentItem) {
      issues.push(`Queue item ${matchQueuePairKey(item)} disappeared.`);
      continue;
    }
    if (matchQueuePairKey(currentItem) !== matchQueuePairKey(item)) {
      issues.push(`Queue item ${item.id} changed from a VS matchup to a different state.`);
    }
  }

  for (const court of snapshot.courts) {
    if (!court.currentMatchId) continue;
    const currentCourt = currentCourts.get(court.id);
    if (!currentCourt || currentCourt.currentMatchId !== court.currentMatchId) {
      issues.push(`Court ${court.id} lost its active match.`);
    }
  }

  return compactIssues(issues);
}

function localSnapshotKey(sessionId: string) {
  return `${LOCAL_RECOVERY_PREFIX}${sessionId}`;
}

function saveLocalSnapshot(sessionId: string, snapshot: RecoverySnapshot) {
  try {
    window.localStorage.setItem(localSnapshotKey(sessionId), JSON.stringify(snapshot));
  } catch {
    // Local backup is best-effort. The persisted Firestore snapshot remains primary.
  }
}

function readLocalSnapshot(sessionId: string): RecoverySnapshot | null {
  try {
    const raw = window.localStorage.getItem(localSnapshotKey(sessionId));
    return raw ? (JSON.parse(raw) as RecoverySnapshot) : null;
  } catch {
    return null;
  }
}

async function readPersistedSnapshot(sessionId: string) {
  try {
    const snap = await getDoc(doc(db, COL.sessions, sessionId, COL.recovery, LATEST_RECOVERY_ID));
    return snap.exists() ? (snap.data() as RecoverySnapshot) : null;
  } catch {
    return null;
  }
}

export async function readLatestValidSnapshot(sessionId: string) {
  const persisted = await readPersistedSnapshot(sessionId);
  if (persisted && validateGameState(persisted.state).valid) return persisted;

  const local = typeof window === "undefined" ? null : readLocalSnapshot(sessionId);
  if (local && validateGameState(local.state).valid) return local;

  return null;
}

export async function saveValidSnapshot(state: GameState, reason: string) {
  const validation = validateGameState(state);
  if (!validation.valid) return { saved: false, issues: validation.issues };

  const snapshot: RecoverySnapshot = {
    id: LATEST_RECOVERY_ID,
    savedAt: Date.now(),
    reason,
    state,
  };

  if (typeof window !== "undefined") saveLocalSnapshot(state.session.id, snapshot);
  try {
    await setDoc(doc(db, COL.sessions, state.session.id, COL.recovery, LATEST_RECOVERY_ID), snapshot);
  } catch {
    // Firestore rules may not allow the recovery subcollection yet.
    // Keep the local backup and never block the real game action.
  }
  return { saved: true, issues: [] };
}

export async function saveValidSnapshotFromCurrent(sessionId: string, reason: string) {
  try {
    const state = await readSessionState(sessionId);
    return saveValidSnapshot(state, reason);
  } catch (error: any) {
    return {
      saved: false,
      issues: [error?.message ?? "Unable to inspect current session state."],
    };
  }
}

async function commitBatch(ops: Array<(batch: ReturnType<typeof writeBatch>) => void>) {
  for (let index = 0; index < ops.length; index += 450) {
    const batch = writeBatch(db);
    ops.slice(index, index + 450).forEach((apply) => apply(batch));
    await batch.commit();
  }
}

export async function restoreSnapshot(sessionId: string, snapshot: RecoverySnapshot) {
  const current = await readSessionState(sessionId);
  if (current.session.hostUid !== snapshot.state.session.hostUid) throw new Error("Recovery snapshot host mismatch");

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const sRef = doc(db, COL.sessions, sessionId);

  ops.push((batch) => batch.set(sRef, snapshot.state.session));

  const restoreCollection = <T extends { id: string }>(collectionName: string, currentRows: T[], snapshotRows: T[]) => {
    const snapshotIds = new Set(snapshotRows.map((row) => row.id));
    for (const row of snapshotRows) {
      ops.push((batch) => batch.set(doc(db, COL.sessions, sessionId, collectionName, row.id), row));
    }
    for (const row of currentRows) {
      if (!snapshotIds.has(row.id)) {
        ops.push((batch) => batch.delete(doc(db, COL.sessions, sessionId, collectionName, row.id)));
      }
    }
  };

  restoreCollection(COL.players, current.players, snapshot.state.players);
  restoreCollection(COL.teams, current.teams, snapshot.state.teams);
  restoreCollection(COL.courts, current.courts, snapshot.state.courts);
  restoreCollection(COL.matches, current.matches, snapshot.state.matches);
  restoreCollection(COL.results, current.results, snapshot.state.results);

  await commitBatch(ops);
  if (typeof window !== "undefined") {
    saveLocalSnapshot(sessionId, {
      ...snapshot,
      savedAt: Date.now(),
      reason: `restore:${snapshot.reason}`,
    });
  }
  try {
    await setDoc(doc(db, COL.sessions, sessionId, COL.recovery, LATEST_RECOVERY_ID), {
      ...snapshot,
      savedAt: Date.now(),
      reason: `restore:${snapshot.reason}`,
    });
  } catch {
    // Local snapshot already updated; recovery must not fail only because
    // the optional persisted snapshot path is blocked by Firestore rules.
  }
}

export async function recoverSessionState(sessionId: string): Promise<RecoveryResult> {
  let current: GameState | null = null;
  try {
    current = await readSessionState(sessionId);
  } catch (error: any) {
    return { status: "failed", state: null, issues: [error?.message ?? "Failed to read current session state."] };
  }

  const currentValidation = validateGameState(current);
  const latest = await readLatestValidSnapshot(sessionId);
  const regressionIssues = latest ? findSnapshotRegression(current, latest.state) : [];

  if (currentValidation.valid && regressionIssues.length === 0) {
    await saveValidSnapshot(current, "manual-refresh");
    return { status: "synced", state: current, issues: [] };
  }

  if (latest) {
    await restoreSnapshot(sessionId, latest);
    return {
      status: "restored",
      state: latest.state,
      issues: compactIssues([...currentValidation.issues, ...regressionIssues]),
    };
  }

  return {
    status: "failed",
    state: current,
    issues: compactIssues(currentValidation.issues.length ? currentValidation.issues : regressionIssues),
  };
}

export async function commitGameState<T>(sessionId: string, reason: string, applyMutation: () => Promise<T>) {
  const before = await readSessionState(sessionId).catch(() => null);
  if (before) await saveValidSnapshot(before, `before:${reason}`);

  const result = await applyMutation();

  const after = await readSessionState(sessionId).catch(() => null);
  if (!after) return result;

  const validation = validateGameState(after);
  if (validation.valid) {
    await saveValidSnapshot(after, reason);
    return result;
  }

  const latest = await readLatestValidSnapshot(sessionId);
  if (latest) {
    await restoreSnapshot(sessionId, latest);
    throw new Error(`Recovered from invalid ${reason}: ${validation.issues[0]}`);
  }

  if (before && validateGameState(before).valid) {
    const fallback: RecoverySnapshot = {
      id: LATEST_RECOVERY_ID,
      savedAt: Date.now(),
      reason: `before:${reason}`,
      state: before,
    };
    await restoreSnapshot(sessionId, fallback);
    throw new Error(`Recovered from invalid ${reason}: ${validation.issues[0]}`);
  }

  throw new Error(`Invalid game state after ${reason}: ${validation.issues[0]}`);
}
