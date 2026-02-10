import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, type User } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { assertEnv, env } from "./env";

assertEnv();

const app = initializeApp(env.firebase);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Offline + brief disconnect robustness (best-effort persistence)
enableIndexedDbPersistence(db).catch(() => {
  // Multiple tabs or unsupported browser – safe to ignore.
});

export async function ensureAnonAuth(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  await signInAnonymously(auth);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) { unsub(); resolve(u); }
    });
  });
}
