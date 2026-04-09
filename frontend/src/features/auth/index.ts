import { authManager } from './core/authManager';
import { LocalAdapter } from './adapters/local/local.adapter';
import { FirebaseGoogleAdapter } from './adapters/firebase/google.adapter';
import { FirebaseEmailAdapter } from './adapters/firebase/email.adapter';

const authMode =
  (import.meta.env.VITE_AUTH_MODE as string) ||
  (import.meta.env.VITE_FIREBASE_API_KEY ? 'firebase' : 'local');

export const IS_LOCAL_AUTH = authMode === 'local';

// Register adapters once at module load.
if (IS_LOCAL_AUTH) {
  authManager.registerProvider(new LocalAdapter());
} else {
  authManager.registerProvider(new FirebaseGoogleAdapter());
  authManager.registerProvider(new FirebaseEmailAdapter());
}

export { authManager };

export const AUTH_PROVIDERS = {
  GOOGLE: 'google',
  EMAIL: 'email',
} as const;
