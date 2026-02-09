import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import type { AuthAdapter } from '../../core/authAdapter';
import { firebaseAuth } from './firebaseApp';

export class FirebaseGoogleAdapter implements AuthAdapter {
  readonly id = 'google' as const;

  login = async (): Promise<string> => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(firebaseAuth, provider);
    return result.user.getIdToken();
  };

  logout = async (): Promise<void> => {
    await signOut(firebaseAuth);
  };

  isAuthenticated = (): boolean => firebaseAuth.currentUser !== null;

  getIdToken = async (forceRefresh: boolean = false): Promise<string> => {
    const user = firebaseAuth.currentUser;
    if (!user) throw new Error('Not authenticated');
    return user.getIdToken(forceRefresh);
  };

  onAuthStateChanged = (callback: (loggedIn: boolean) => void): (() => void) =>
    onAuthStateChanged(firebaseAuth, (user) => callback(!!user));
}
