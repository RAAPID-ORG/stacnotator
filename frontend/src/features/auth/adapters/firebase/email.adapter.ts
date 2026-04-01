import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import type { AuthAdapter } from '../../core/authAdapter';
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
    await sendEmailVerification(result.user);
    return result.user.getIdToken();
  };

  sendVerificationEmail = async (): Promise<void> => {
    const user = firebaseAuth.currentUser;
    if (!user) throw new Error('Not authenticated');
    await sendEmailVerification(user);
  };

  sendPasswordResetEmail = async (email: string): Promise<void> => {
    await firebaseSendPasswordResetEmail(firebaseAuth, email);
  };

  changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
    const user = firebaseAuth.currentUser;
    if (!user || !user.email) throw new Error('Not authenticated');
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
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
