import { nanoid } from "nanoid";
import {
  collection, doc, setDoc, serverTimestamp, writeBatch,
  onSnapshot, query, orderBy, limit, getDoc, runTransaction, updateDoc
} from "firebase/firestore";
import { db, ensureAnonAuth } from "../../app/firebase";
import { sha256Base64 } from "../../app/hash";
import type { Session, Player, Team, Court, Match } from "../../app/types";
import { COL, type ResultRow } from "./schema";
import { deleteDoc } from "firebase/firestore";


export async function createSession(params: { courtCount: number; oddMode: "three_player_rotation" | "none" }) {
  const user = await ensureAnonAuth();
  const sessionId = nanoid(10);
  const secret = nanoid(24);
  const hostSecretHash = await sha256Base64(secret);

  const session: Session = {
    id: sessionId,
    createdAt: Date.now(),
    hostUid: user.uid,
    hostSecretHash,
    phase: "coverage",
    config: { courtCount: params.courtCount, scoring: 21, oddMode: params.oddMode },
    activeTeams: [],
    queueTeams: [],
    teammateHistory: {},
    metHistory: {},
    locked: false,
  };

  await setDoc(doc(db, COL.sessions, sessionId), session);

  // initialize courts
  const b = writeBatch(db);
  for (let i = 1; i <= params.courtCount; i++) {
    const c: Court = { id: String(i), currentMatchId: null };
    b.set(doc(db, COL.sessions, sessionId, COL.courts, c.id), c);
  }
  await b.commit();

  return { sessionId, secret };
}

export function subscribeSession(sessionId: string, cb: (s: Session | null) => void) {
  return onSnapshot(doc(db, COL.sessions, sessionId), (snap) => {
    cb(snap.exists() ? (snap.data() as Session) : null);
  });
}

export function subscribePlayers(sessionId: string, cb: (rows: Player[]) => void) {
  return onSnapshot(collection(db, COL.sessions, sessionId, COL.players), (snap) => {
    cb(snap.docs.map((d) => d.data() as Player));
  });
}

export function subscribeTeams(sessionId: string, cb: (rows: Team[]) => void) {
  return onSnapshot(collection(db, COL.sessions, sessionId, COL.teams), (snap) => {
    cb(snap.docs.map((d) => d.data() as Team));
  });
}

export function subscribeCourts(sessionId: string, cb: (rows: Court[]) => void) {
  return onSnapshot(collection(db, COL.sessions, sessionId, COL.courts), (snap) => {
    cb(snap.docs.map((d) => d.data() as Court).sort((a,b)=>Number(a.id)-Number(b.id)));
  });
}

export function subscribeMatches(sessionId: string, cb: (rows: Match[]) => void) {
  return onSnapshot(collection(db, COL.sessions, sessionId, COL.matches), (snap) => {
    cb(snap.docs.map((d) => d.data() as Match));
  });
}

export function subscribeRecentResults(sessionId: string, cb: (rows: ResultRow[]) => void) {
  const qy = query(
    collection(db, COL.sessions, sessionId, COL.results),
    orderBy("endedAt", "desc"),
    limit(20)
  );

  return onSnapshot(qy, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ResultRow[];
    cb(rows);
  });
}

export async function assertHost(sessionId: string) {
  const user = await ensureAnonAuth();
  const s = await getDoc(doc(db, COL.sessions, sessionId));
  if (!s.exists()) throw new Error("Session not found");
  const session = s.data() as Session;
  if (session.hostUid !== user.uid) throw new Error("Not host on this device");
  return { session, user };
}

export async function upsertPlayers(sessionId: string, names: string[]) {
  await assertHost(sessionId);
  const b = writeBatch(db);
  for (const name of names) {
    const id = nanoid(8);
    const p: Player = { id, name: name.trim(), stats: { played: 0, wins: 0, losses: 0 } };
    b.set(doc(db, COL.sessions, sessionId, COL.players, id), p);
  }
  await b.commit();
}

export async function clearAll(sessionId: string, keepNames: boolean) {
  await assertHost(sessionId);
  // For brevity we “soft reset” by recreating session core fields and deleting subcollections is omitted.
  // In production, you’d use a backend admin job or callable function to delete subcollections.
  await runTransaction(db, async (tx) => {
    const ref = doc(db, COL.sessions, sessionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Session missing");
    const s = snap.data() as Session;

    const reset: Session = {
      ...s,
      phase: "coverage",
      activeTeams: [],
      queueTeams: [],
      teammateHistory: {},
      metHistory: {},
      startedAt: undefined,
      locked: false,
    };
    tx.set(ref, reset, { merge: false });
  });

  if (!keepNames) {
    // NOTE: Without admin privileges, bulk delete is not ideal.
    // This demo omits mass deletion to keep client-only deployability.
  }
}

export async function setLocked(sessionId: string, locked: boolean) {
  await assertHost(sessionId);
  await updateDoc(doc(db, COL.sessions, sessionId), { locked });
}

export async function updateSessionCore(sessionId: string, patch: Partial<Session>) {
  await assertHost(sessionId);
  await updateDoc(doc(db, COL.sessions, sessionId), patch as any);
}

export async function deletePlayer(sessionId: string, playerId: string) {
  await assertHost(sessionId);
  await deleteDoc(doc(db, COL.sessions, sessionId, COL.players, playerId));
}
