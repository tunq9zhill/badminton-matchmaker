import { useEffect, useState } from "react";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "./firebase";

export function useFirestoreConnectionPing() {
  // Firestore doesn’t expose a simple “connected” boolean like RTDB.
  // We simulate health by subscribing to a tiny doc and observing snapshot errors.
  const [state, setState] = useState<"ok" | "connecting" | "offline">("connecting");

  useEffect(() => {
    setState("connecting");
    const ref = doc(db, "_health", "ping");
    const unsub = onSnapshot(
      ref,
      () => setState("ok"),
      () => setState("offline")
    );
    return () => unsub();
  }, []);

  return state;
}
