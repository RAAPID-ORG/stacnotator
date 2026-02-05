import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import type { AuthAdapter } from '../../domain/authAdapter';
import { firebaseAuth } from './firebaseApp';

export class FirebaseEmailAdapter implements AuthAdapter {
  readonly id = 'email' as const;

  login = async (email?: string, password?: string): Promise<string> => {
    if (!email || !password) throw new Error('Email and password are required');
    const result = await signInWithEmailAndPassword(firebaseAuth, email, password);
    return result.user.getIdToken();
  };

  register = async (email: string, password: string): Promise<string> => {
    const result = await createUserWithEmailAndPassword(firebaseAuth, email, password);
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
