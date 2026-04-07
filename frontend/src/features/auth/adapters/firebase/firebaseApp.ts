import { type FirebaseApp, initializeApp, getApp } from 'firebase/app';
import { type Auth, getAuth } from 'firebase/auth';

/**
 * Firebase is initialized exactly once.
 * Configure via Vite env vars:
 * - VITE_FIREBASE_API_KEY
 * - VITE_FIREBASE_AUTH_DOMAIN
 * - VITE_FIREBASE_PROJECT_ID
 *
 * When these vars are absent (local auth mode), firebase is not
 * initialized and firebaseAuth is null.
 */

let firebaseAuth: Auth | null = null;

if (import.meta.env.VITE_FIREBASE_API_KEY) {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  };

  let app: FirebaseApp;
  try {
    app = getApp();
  } catch {
    app = initializeApp(firebaseConfig);
  }

  firebaseAuth = getAuth(app);
}

export { firebaseAuth };
