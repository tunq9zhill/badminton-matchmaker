export const env = {
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
  },
};

export function assertEnv() {
  const missing = Object.entries(env.firebase).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing Firebase env vars: ${missing.join(", ")}`);
  }
}
