import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import type { AuthAdapter } from '../../core/authAdapter';
import { firebaseAuth } from './firebaseApp';

// firebaseAuth is non-null when this adapter is instantiated (Firebase mode only)
const auth = firebaseAuth!;

export class FirebaseGoogleAdapter implements AuthAdapter {
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
    if (!user) throw new Error('Not authenticated');
    return user.getIdToken(forceRefresh);
  };

  onAuthStateChanged = (callback: (loggedIn: boolean) => void): (() => void) =>
    onAuthStateChanged(auth, (user) => callback(!!user));
}
