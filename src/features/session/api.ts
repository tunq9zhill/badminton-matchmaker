import { nanoid } from "nanoid";
import {
  collection, doc, setDoc, writeBatch,
  onSnapshot, query, orderBy, limit, getDoc, runTransaction, updateDoc
} from "firebase/firestore";
import { db, ensureAnonAuth } from "../../app/firebase";
import { sha256Base64 } from "../../app/hash";
import type { Session, Player, Team, Court, Match } from "../../app/types";
import { COL, type ResultRow } from "./schema";
import { deleteDoc } from "firebase/firestore";


function generateSessionCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createSession(params: { courtCount: number }) {
  const user = await ensureAnonAuth();
  const sessionId = generateSessionCode();
  const secret = nanoid(24);
  const hostSecretHash = await sha256Base64(secret);

  const session: Session = {
    id: sessionId,
    createdAt: Date.now(),
    hostUid: user.uid,
    hostSecretHash,
    phase: "coverage",
    config: { courtCount: params.courtCount, scoring: 21, oddMode: "three_player_rotation" },
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


export async function sessionExists(sessionId: string) {
  const s = await getDoc(doc(db, COL.sessions, sessionId.toUpperCase()));
  return s.exists();
}

export function subscribeSession(sessionId: string, cb: (s: Session | null) => void) {
  const sid = sessionId.toUpperCase();
  return onSnapshot(doc(db, COL.sessions, sid), (snap) => {
    cb(snap.exists() ? (snap.data() as Session) : null);
  });
}

export function subscribePlayers(sessionId: string, cb: (rows: Player[]) => void) {
  const sid = sessionId.toUpperCase();
  return onSnapshot(collection(db, COL.sessions, sid, COL.players), (snap) => {
    cb(snap.docs.map((d) => d.data() as Player));
  });
}

export function subscribeTeams(sessionId: string, cb: (rows: Team[]) => void) {
  const sid = sessionId.toUpperCase();
  return onSnapshot(collection(db, COL.sessions, sid, COL.teams), (snap) => {
    cb(snap.docs.map((d) => d.data() as Team));
  });
}

export function subscribeCourts(sessionId: string, cb: (rows: Court[]) => void) {
  const sid = sessionId.toUpperCase();
  return onSnapshot(collection(db, COL.sessions, sid, COL.courts), (snap) => {
    cb(snap.docs.map((d) => d.data() as Court).sort((a,b)=>Number(a.id)-Number(b.id)));
  });
}

export function subscribeMatches(sessionId: string, cb: (rows: Match[]) => void) {
  const sid = sessionId.toUpperCase();
  return onSnapshot(collection(db, COL.sessions, sid, COL.matches), (snap) => {
    cb(snap.docs.map((d) => d.data() as Match));
  });
}

export function subscribeRecentResults(sessionId: string, cb: (rows: ResultRow[]) => void) {
  const sid = sessionId.toUpperCase();
  const qy = query(
    collection(db, COL.sessions, sid, COL.results),
    orderBy("endedAt", "desc"),
    limit(20)
  );

  return onSnapshot(qy, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ResultRow[];
    cb(rows);
  });
}

export async function assertHost(sessionId: string) {
  const sid = sessionId.toUpperCase();
  const user = await ensureAnonAuth();
  const s = await getDoc(doc(db, COL.sessions, sid));
  if (!s.exists()) throw new Error("Session not found");
  const session = s.data() as Session;
  if (session.hostUid !== user.uid) throw new Error("Not host on this device");
  return { session, user };
}

export async function upsertPlayers(sessionId: string, names: string[]) {
  const sid = sessionId.toUpperCase();
  await assertHost(sid);
  const b = writeBatch(db);
  for (const name of names) {
    const id = nanoid(8);
    const p: Player = { id, name: name.trim(), stats: { played: 0, wins: 0, losses: 0 } };
    b.set(doc(db, COL.sessions, sid, COL.players, id), p);
  }
  await b.commit();
}

export async function clearAll(sessionId: string, keepNames: boolean) {
  await assertHost(sessionId.toUpperCase());
  // For brevity we “soft reset” by recreating session core fields and deleting subcollections is omitted.
  // In production, you’d use a backend admin job or callable function to delete subcollections.
  await runTransaction(db, async (tx) => {
    const ref = doc(db, COL.sessions, sessionId.toUpperCase());
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
  const sid = sessionId.toUpperCase();
  await assertHost(sid);
  await updateDoc(doc(db, COL.sessions, sid), { locked });
}

export async function updateSessionCore(sessionId: string, patch: Partial<Session>) {
  const sid = sessionId.toUpperCase();
  await assertHost(sid);
  await updateDoc(doc(db, COL.sessions, sid), patch as any);
}

export async function updatePlayerAvatar(sessionId: string, playerId: string, avatarDataUrl?: string) {
  const sid = sessionId.toUpperCase();
  await assertHost(sid);
  await updateDoc(doc(db, COL.sessions, sid, COL.players, playerId), {
    avatarDataUrl: avatarDataUrl ?? null,
  });
}

export async function deletePlayer(sessionId: string, playerId: string) {
  const sid = sessionId.toUpperCase();
  await assertHost(sid);
  await deleteDoc(doc(db, COL.sessions, sid, COL.players, playerId));
}
