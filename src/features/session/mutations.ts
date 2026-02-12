import { nanoid } from "nanoid";
import {
  doc, collection, runTransaction, writeBatch, updateDoc
} from "firebase/firestore";
import { db, ensureAnonAuth } from "../../app/firebase";
import type { Match, Player, Session, Team } from "../../app/types";
import { COL, type ResultRow } from "./schema";
import { proposeNextMatch } from "../../engine/scheduler";
import { getDoc, getDocs } from "firebase/firestore";
import { rebuildTeamsAvoidingTeammates, teammateHistoryFromTeams } from "../../engine/pairing";


function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function removeFrom(arr: string[], ids: string[]) {
  const set = new Set(ids);
  return arr.filter((x) => !set.has(x));
}

function addTo(arr: string[], ids: string[]) {
  return uniq([...arr, ...ids]);
}

export async function startOnce(sessionId: string) {
  const user = await ensureAnonAuth();

  await runTransaction(db, async (tx) => {
    const sRef = doc(db, COL.sessions, sessionId);
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists()) throw new Error("Session missing");
    const session = sSnap.data() as Session;
    if (session.hostUid !== user.uid) throw new Error("Not host");
    if (session.locked) return; // already started

    // Lock edits; actual team creation is done by host UI via a separate flow in this demo.
    tx.update(sRef, { locked: true, startedAt: Date.now() });
  });
}

export async function setTeamsAndQueue(sessionId: string, teams: Team[]) {
  const user = await ensureAnonAuth();

  const b = writeBatch(db);
  const sRef = doc(db, COL.sessions, sessionId);
  // store teams
  for (const t of teams) {
    b.set(doc(db, COL.sessions, sessionId, COL.teams, t.id), t);
  }
  // reset courts + matches are left as-is in this demo; in production delete/cleanup.
  await b.commit();

  await runTransaction(db, async (tx) => {
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists()) throw new Error("Session missing");
    const s = sSnap.data() as Session;
    if (s.hostUid !== user.uid) throw new Error("Not host");

    tx.update(sRef, {
      queueTeams: teams.map((t) => t.id),
      activeTeams: [],
      phase: "coverage",
    });
  });
}

export async function assignNextForCourt(sessionId: string, courtId: string) {
  const user = await ensureAnonAuth();

  // 1) Read outside transaction (allowed): session + all teams
  const sRef = doc(db, COL.sessions, sessionId);
  const sSnap = await getDoc(sRef);
  if (!sSnap.exists()) throw new Error("Missing session");
  const session = sSnap.data() as Session;
  if (session.hostUid !== user.uid) throw new Error("Not host");

  const teamsSnap = await getDocs(collection(db, COL.sessions, sessionId, COL.teams));
  const teamsAll = teamsSnap.docs.map((d) => d.data() as Team);

  // ✅ ใช้เฉพาะทีมที่ไม่ archived และไม่ active
  const teams = teamsAll.filter((t) => !t.archived); // (จะกรอง isActive เพิ่มก็ได้ แต่ engine น่าจะเช็คอยู่แล้ว)

  const proposed = proposeNextMatch(session, teams);

  // 2) Commit with transaction (atomic): re-check invariants and write
  await runTransaction(db, async (tx) => {
    const sSnap2 = await tx.get(sRef);
    const cRef = doc(db, COL.sessions, sessionId, COL.courts, courtId);
    const cSnap = await tx.get(cRef);

    if (!sSnap2.exists() || !cSnap.exists()) throw new Error("Missing session/court");
    const s2 = sSnap2.data() as Session;
    if (s2.hostUid !== user.uid) throw new Error("Not host");

    if (!proposed) {
      tx.update(cRef, { currentMatchId: null });
      return;
    }

    // Re-read only the two teams involved (doc refs only)
    const aRef = doc(db, COL.sessions, sessionId, COL.teams, proposed.teamAId);
    const bRef = doc(db, COL.sessions, sessionId, COL.teams, proposed.teamBId);
    const aSnap = await tx.get(aRef);
    const bSnap = await tx.get(bRef);
    if (!aSnap.exists() || !bSnap.exists()) throw new Error("Missing teams");

    const a = aSnap.data() as Team;
    const b = bSnap.data() as Team;

    // Strict constraints: must be inactive and not in activeTeams
    if (a.isActive || b.isActive) return;
    if (s2.activeTeams.includes(a.id) || s2.activeTeams.includes(b.id)) return;

    const matchId = nanoid(10);
    const m: Match = {
      id: matchId,
      courtId,
      teamAId: a.id,
      teamBId: b.id,
      status: "in_progress",
      startedAt: Date.now(),
      isFallback: proposed.isFallback ?? false,
      createdAt: Date.now(),
    };

    tx.set(doc(db, COL.sessions, sessionId, COL.matches, matchId), m);

    tx.update(aRef, { isActive: true });
    tx.update(bRef, { isActive: true });

    tx.update(sRef, {
      activeTeams: addTo(s2.activeTeams, [a.id, b.id]),
      queueTeams: removeFrom(s2.queueTeams, [a.id, b.id]),
    });

    tx.update(cRef, { currentMatchId: matchId });
  });
}


export async function beginMatch(sessionId: string, matchId: string) {
  const user = await ensureAnonAuth();
  await runTransaction(db, async (tx) => {
    const sRef = doc(db, COL.sessions, sessionId);
    const mRef = doc(db, COL.sessions, sessionId, COL.matches, matchId);
    const sSnap = await tx.get(sRef);
    const mSnap = await tx.get(mRef);
    if (!sSnap.exists() || !mSnap.exists()) throw new Error("Missing session/match");
    const s = sSnap.data() as Session;
    if (s.hostUid !== user.uid) throw new Error("Not host");
    const m = mSnap.data() as Match;
    if (m.status !== "scheduled") return;
    tx.update(mRef, { status: "in_progress", startedAt: Date.now() });
  });
}

export async function cancelMatchAndReschedule(sessionId: string, matchId: string) {
  const user = await ensureAnonAuth();

  await runTransaction(db, async (tx) => {
    const sRef = doc(db, COL.sessions, sessionId);
    const mRef = doc(db, COL.sessions, sessionId, COL.matches, matchId);

    const sSnap = await tx.get(sRef);
    const mSnap = await tx.get(mRef);
    if (!sSnap.exists() || !mSnap.exists()) throw new Error("Missing session/match");

    const s = sSnap.data() as Session;
    if (s.hostUid !== user.uid) throw new Error("Not host");
    const m = mSnap.data() as Match;

    // mark match canceled
    tx.update(mRef, { status: "canceled", endedAt: Date.now() });

    // teams become inactive
    const aRef = doc(db, COL.sessions, sessionId, COL.teams, m.teamAId);
    const bRef = doc(db, COL.sessions, sessionId, COL.teams, m.teamBId);
    tx.update(aRef, { isActive: false });
    tx.update(bRef, { isActive: false });

    tx.update(sRef, {
      activeTeams: removeFrom(s.activeTeams, [m.teamAId, m.teamBId]),
      queueTeams: addTo(s.queueTeams, [m.teamAId, m.teamBId]),
    });

    // clear court current match (reschedule will set new)
    const cRef = doc(db, COL.sessions, sessionId, COL.courts, m.courtId);
    tx.update(cRef, { currentMatchId: null });
  });

}

export async function finishMatch(
  sessionId: string,
  matchId: string,
  winnerTeamId: string,
  payload: {
    teamAPlayedPlayerIds?: string[];
    teamBPlayedPlayerIds?: string[];
    scoreA?: number;
    scoreB?: number;
  }
) {
  const user = await ensureAnonAuth();

  await runTransaction(db, async (tx) => {
    const sRef = doc(db, COL.sessions, sessionId);
    const mRef = doc(db, COL.sessions, sessionId, COL.matches, matchId);

    // -----------------------
    // 1) READS (ALL FIRST)
    // -----------------------
    const [sSnap, mSnap] = await Promise.all([tx.get(sRef), tx.get(mRef)]);
    if (!sSnap.exists() || !mSnap.exists()) throw new Error("Missing session/match");

    const s = sSnap.data() as Session;
    if (s.hostUid !== user.uid) throw new Error("Not host");

    const m = mSnap.data() as Match;
    if (m.status === "finished" || m.status === "canceled") return;

    const aRef = doc(db, COL.sessions, sessionId, COL.teams, m.teamAId);
    const bRef = doc(db, COL.sessions, sessionId, COL.teams, m.teamBId);

    const [aSnap, bSnap] = await Promise.all([tx.get(aRef), tx.get(bRef)]);
    if (!aSnap.exists() || !bSnap.exists()) throw new Error("Missing teams");

    const teamA = aSnap.data() as Team;
    const teamB = bSnap.data() as Team;

    const aWin = winnerTeamId === teamA.id;
    const bWin = winnerTeamId === teamB.id;

    // determine who actually played (for 3-player team)
    const teamAPlayed =
    payload.teamAPlayedPlayerIds ??
    (teamA.playerIds.length === 3 ? (teamA.pairPreference ?? teamA.playerIds.slice(0, 2)) : teamA.playerIds);

    const teamBPlayed =
    payload.teamBPlayedPlayerIds ??
    (teamB.playerIds.length === 3 ? (teamB.pairPreference ?? teamB.playerIds.slice(0, 2)) : teamB.playerIds);

    // pre-read all player docs that we will update
    const playerRefs = [...teamAPlayed, ...teamBPlayed].map((pid) =>
      doc(db, COL.sessions, sessionId, COL.players, pid)
    );
    const playerSnaps = await Promise.all(playerRefs.map((r) => tx.get(r)));

    // -----------------------
    // 2) WRITES (AFTER ALL READS)
    // -----------------------
    const endedAt = Date.now();

    // match update (include scores here)
    tx.update(mRef, {
      status: "finished",
      endedAt,
      winnerTeamId,
      scoreA: payload.scoreA ?? null,
      scoreB: payload.scoreB ?? null,
      teamAPlayedPlayerIds: teamAPlayed,
      teamBPlayedPlayerIds: teamBPlayed,
    });

    // team stats + inactive
    tx.update(aRef, {
      isActive: false,
      stats: {
        played: teamA.stats.played + 1,
        wins: teamA.stats.wins + (aWin ? 1 : 0),
        losses: teamA.stats.losses + (aWin ? 0 : 1),
      },
      rotationIndex:
        teamA.playerIds.length === 3 ? ((teamA.rotationIndex ?? 0) + 1) % 3 : (teamA.rotationIndex ?? null),
    });

    tx.update(bRef, {
      isActive: false,
      stats: {
        played: teamB.stats.played + 1,
        wins: teamB.stats.wins + (bWin ? 1 : 0),
        losses: teamB.stats.losses + (bWin ? 0 : 1),
      },
      rotationIndex:
        teamB.playerIds.length === 3 ? ((teamB.rotationIndex ?? 0) + 1) % 3 : (teamB.rotationIndex ?? null),
    });

    // player stats update (only those who played)
    playerSnaps.forEach((ps, idx) => {
      if (!ps.exists()) return;
      const p = ps.data() as Player;
      const pid = playerRefs[idx].id;

      const isInA = teamAPlayed.includes(pid);
      const didWin = isInA ? aWin : bWin;

      const oldHist = (p.playHistory ?? []);
        tx.update(playerRefs[idx], {
        stats: {
            played: p.stats.played + 1,
            wins: p.stats.wins + (didWin ? 1 : 0),
            losses: p.stats.losses + (didWin ? 0 : 1),
        },
        playHistory: [...oldHist, endedAt],
        });
    });

    // metHistory
    const metKey = [m.teamAId, m.teamBId].sort().join("__");

    tx.update(sRef, {
      metHistory: { ...s.metHistory, [metKey]: true },
      activeTeams: removeFrom(s.activeTeams, [m.teamAId, m.teamBId]),
      queueTeams: addTo(s.queueTeams, [m.teamAId, m.teamBId]),
    });

    // result row
    const r: ResultRow = {
      id: nanoid(10),
      endedAt,
      courtId: m.courtId,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      winnerTeamId,
      isFallback: m.isFallback ?? false,
      scoreA: payload.scoreA ?? null,
      scoreB: payload.scoreB ?? null,
      teamAPlayedPlayerIds: teamAPlayed,
      teamBPlayedPlayerIds: teamBPlayed,
    };
    tx.set(doc(db, COL.sessions, sessionId, COL.results, r.id), r);

    // clear court current match
    tx.update(doc(db, COL.sessions, sessionId, COL.courts, m.courtId), { currentMatchId: null });
  });
}



export async function resetTableStats(sessionId: string) {
  const user = await ensureAnonAuth();
  const sRef = doc(db, COL.sessions, sessionId);
  const sSnap = await getDoc(sRef);
  if (!sSnap.exists()) throw new Error("Missing session");
  const s = sSnap.data() as Session;
  if (s.hostUid !== user.uid) throw new Error("Not host");

  const playersSnap = await getDocs(collection(db, COL.sessions, sessionId, COL.players));
  const b = writeBatch(db);
  playersSnap.docs.forEach((d) => {
    b.update(d.ref, { stats: { played: 0, wins: 0, losses: 0 }, playHistory: [] });
  });
  await b.commit();
}


export async function resetPairing(sessionId: string) {
  const user = await ensureAnonAuth();

  // Read snapshot
  const sRef = doc(db, COL.sessions, sessionId);
  const sSnap = await getDoc(sRef);
  if (!sSnap.exists()) throw new Error("Missing session");
  const s = sSnap.data() as Session;
  if (s.hostUid !== user.uid) throw new Error("Not host");

  const playersSnap = await getDocs(collection(db, COL.sessions, sessionId, COL.players));
  const players = playersSnap.docs.map((d) => d.data() as Player);

  const teamsSnap = await getDocs(collection(db, COL.sessions, sessionId, COL.teams));


  // Rebuild teams avoiding teammate repeats (best-effort)
  const { teams: newTeams, warnings } = rebuildTeamsAvoidingTeammates(players, s.teammateHistory);

  // Keep stats: map player/team stats is tricky because new teams are new ids.
  // Spec says keep player + team stats; team stats can't map 1:1 if teams change.
  // We keep PLAYER stats and reset TEAM stats (honest + consistent).
  // If you want “preserve team stats by player pairs”, tell me—ทำได้แต่ต้อง matching logic เพิ่ม.

  const b = writeBatch(db);

  // Cancel all matches + clear courts
  const matchesSnap = await getDocs(collection(db, COL.sessions, sessionId, COL.matches));
  for (const d of matchesSnap.docs) b.delete(d.ref);

  const courtsSnap = await getDocs(collection(db, COL.sessions, sessionId, COL.courts));
  for (const c of courtsSnap.docs) b.update(c.ref, { currentMatchId: null });

  // Delete old teams
  for (const tDoc of teamsSnap.docs) {
    b.update(tDoc.ref, { archived: true, isActive: false });
  }

  // Create new teams
  for (const t of newTeams) {
    b.set(doc(db, COL.sessions, sessionId, COL.teams, t.id), { ...t, archived: false });
  }

  await b.commit();

  // Reset session queues/phase
  await updateDoc(sRef, {
    phase: "coverage",
    activeTeams: [],
    queueTeams: newTeams.map((t) => t.id),
    // teammateHistory should include ALL past teammate pairs (spec)
    // We keep existing + add new
    teammateHistory: { ...s.teammateHistory, ...teammateHistoryFromTeams(newTeams) },
    // metHistory stays (spec says keep finished history)
    metHistory: s.metHistory,
  });

  return { warnings };
}

export async function resetAll(sessionId: string, keepNames: boolean) {
  const user = await ensureAnonAuth();

  const sRef = doc(db, COL.sessions, sessionId);
  const sSnap = await getDoc(sRef);
  if (!sSnap.exists()) throw new Error("Missing session");
  const s = sSnap.data() as Session;
  if (s.hostUid !== user.uid) throw new Error("Not host");

  const b = writeBatch(db);

  // delete matches/results/teams
  for (const colName of [COL.matches, COL.results, COL.teams] as const) {
    const snap = await getDocs(collection(db, COL.sessions, sessionId, colName));
    for (const d of snap.docs) b.delete(d.ref);
  }

  // reset courts
  const courtsSnap = await getDocs(collection(db, COL.sessions, sessionId, COL.courts));
  for (const c of courtsSnap.docs) b.update(c.ref, { currentMatchId: null });

  // players: delete or keep names (and reset stats if keep)
  const playersSnap = await getDocs(collection(db, COL.sessions, sessionId, COL.players));
  for (const pdoc of playersSnap.docs) {
    if (!keepNames) b.delete(pdoc.ref);
    else b.update(pdoc.ref, { stats: { played: 0, wins: 0, losses: 0 } });
  }

  // reset session
  b.update(sRef, {
    phase: "coverage",
    activeTeams: [],
    queueTeams: [],
    teammateHistory: {},
    metHistory: {},
    startedAt: null,
    locked: false,
  } as any);

  await b.commit();
}

export async function updateMatchScore(sessionId: string, matchId: string, scoreA: number, scoreB: number) {
  const user = await ensureAnonAuth();
  await runTransaction(db, async (tx) => {
    const sRef = doc(db, COL.sessions, sessionId);
    const mRef = doc(db, COL.sessions, sessionId, COL.matches, matchId);
    const sSnap = await tx.get(sRef);
    const mSnap = await tx.get(mRef);
    if (!sSnap.exists() || !mSnap.exists()) throw new Error("Missing session/match");
    const s = sSnap.data() as Session;
    if (s.hostUid !== user.uid) throw new Error("Not host");
    tx.update(mRef, { scoreA, scoreB });
  });
}
