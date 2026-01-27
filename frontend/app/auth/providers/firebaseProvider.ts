import { initializeApp, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import type { AuthProvider } from '~/auth/providers/authProvider';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

// Try to get existing app, otherwise initialize
let app;
try {
  app = getApp();
} catch {
  app = initializeApp(firebaseConfig);
}
const auth = getAuth(app);

export class FirebaseGoogleProvider implements AuthProvider {
  readonly id = 'google' as const;

  login = async (): Promise<string> => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    return result.user.getIdToken();
  };

  logout = async (): Promise<void> => {
    await signOut(auth);
  };

  isAuthenticated = (): boolean => auth.currentUser !== null;

  getIdToken = async (forceRefresh: boolean = false): Promise<string> => {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Not authenticated');
    }
    return user.getIdToken(forceRefresh);
  };

  onAuthStateChanged = (callback: (loggedIn: boolean) => void): (() => void) =>
    onAuthStateChanged(auth, (user) => {
      callback(!!user);
    });
}
